/** Vegetation, rocks, and terrain: the assets an outdoor scene is made of.
 *
 * Vegetation is where procedural generation earns its keep most obviously. A
 * forest is thousands of trees that must all be different and none of which
 * anyone will author. The requirement is not "a beautiful tree" but "a
 * plausible tree, from a seed, in a millisecond, at a controllable triangle
 * budget" — and crucially, the *same* tree for the same seed on every machine,
 * so a multiplayer world replicates a seed rather than a mesh.
 *
 * Every generator here is therefore driven by an explicit seeded PRNG rather
 * than `Math.random`, and none of them reads global state.
 */
import { MeshBuilder, computeNormals, mergeMeshes, weldVertices, type MeshData } from "./mesh.js";
import { cylinder, plane, sphere } from "./primitives.js";
import { meshBounds, placeMesh, scaleMesh, translateMesh } from "./transform.js";

/** Material slots the nature generators assign. */
export const NATURE_SLOTS = { bark: 0, foliage: 1, rock: 2, ground: 3 } as const;

/**
 * A small, fast, platform-identical PRNG.
 *
 * `Math.random` cannot be used here: two clients generating "tree 41" must get
 * the same tree, and an unseeded generator makes that impossible. xorshift32 is
 * chosen for being identical everywhere rather than for statistical quality,
 * which does not matter for placing branches.
 */
export function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

export type TreeKind = "conifer" | "broadleaf" | "palm" | "dead";

export interface TreeSpec {
  readonly kind?: TreeKind;
  readonly height?: number;
  /** Trunk radius at the base, as a fraction of height. */
  readonly trunkRadius?: number;
  /** Recursion depth for branches. Two is plenty for a background tree. */
  readonly branchDepth?: number;
  readonly seed?: number;
  /** Sides on the trunk and branch cylinders. Six is fine at any distance. */
  readonly segments?: number;
}

export interface GeneratedTree {
  readonly mesh: MeshData;
  readonly height: number;
  /** Radius of the canopy, for placement spacing and for wind effects. */
  readonly canopyRadius: number;
  readonly stats: { readonly triangles: number; readonly branches: number };
}

/**
 * A tree, built by recursively branching a tapered trunk.
 *
 * The canopy is deliberately geometry rather than billboards: a generated asset
 * that needs a bespoke shader to look right is not a portable asset, and LOD
 * generation reduces the leaf clusters perfectly well.
 */
export function generateTree(spec: TreeSpec = {}): GeneratedTree {
  const kind = spec.kind ?? "broadleaf";
  const height = requirePositive(spec.height ?? 6, "Tree height");
  const trunkFraction = spec.trunkRadius ?? 0.035;
  if (!(trunkFraction > 0 && trunkFraction < 0.5)) throw new Error("A tree's trunkRadius must be a fraction of height in (0, 0.5).");
  const depth = spec.branchDepth ?? 2;
  if (!Number.isInteger(depth) || depth < 0 || depth > 4) throw new Error("A tree's branchDepth must be a whole number in [0, 4].");
  const segments = spec.segments ?? 6;
  if (!Number.isInteger(segments) || segments < 3) throw new Error("A tree needs at least three trunk segments.");
  const random = seededRandom(spec.seed ?? 1);

  const parts: MeshData[] = [];
  let branches = 0;
  let canopyRadius = height * 0.1;

  /** One tapered limb, then its children. */
  const branch = (
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
    length: number,
    radius: number,
    level: number,
  ): void => {
    branches += 1;
    const tip: [number, number, number] = [
      origin[0] + direction[0] * length,
      origin[1] + direction[1] * length,
      origin[2] + direction[2] * length,
    ];
    const limb = cylinder({ radius, topRadius: radius * 0.65, height: length, segments, capped: level === 0 });
    const pitch = (Math.atan2(Math.hypot(direction[0], direction[2]), direction[1]) * 180) / Math.PI;
    const yaw = (Math.atan2(direction[0], direction[2]) * 180) / Math.PI;
    parts.push(
      withSlot(
        placeMesh(limb, {
          position: [(origin[0] + tip[0]) / 2, (origin[1] + tip[1]) / 2, (origin[2] + tip[2]) / 2],
          rotation: [pitch, yaw, 0],
        }),
        NATURE_SLOTS.bark,
      ),
    );

    if (level >= depth) {
      if (kind !== "dead") {
        const leafRadius = length * (kind === "conifer" ? 0.5 : 0.75);
        canopyRadius = Math.max(canopyRadius, Math.hypot(tip[0], tip[2]) + leafRadius);
        parts.push(withSlot(translateMesh(sphere({ radius: leafRadius, segments: segments + 2, rings: segments }), tip), NATURE_SLOTS.foliage));
      }
      return;
    }

    const children = kind === "palm" ? 5 : kind === "conifer" ? 4 : 3;
    for (let child = 0; child < children; child += 1) {
      const spreadAngle = kind === "conifer" ? 0.9 : kind === "palm" ? 1.3 : 0.7;
      const theta = (child / children) * Math.PI * 2 + random() * 0.8;
      const tilt = spreadAngle * (0.7 + random() * 0.6);
      const next: [number, number, number] = normalize([
        direction[0] + Math.cos(theta) * tilt,
        direction[1] * (kind === "palm" ? 0.3 : 0.85),
        direction[2] + Math.sin(theta) * tilt,
      ]);
      branch(tip, next, length * (0.55 + random() * 0.2), radius * 0.6, level + 1);
    }
  };

  const trunkLength = kind === "palm" ? height * 0.85 : height * 0.55;
  branch([0, 0, 0], [0, 1, 0], trunkLength, height * trunkFraction, 0);

  const mesh = weldVertices(mergeMeshes(parts));
  return {
    mesh: computeNormals(mesh, { smooth: false }),
    height: meshBounds(mesh).max[1],
    canopyRadius,
    stats: { triangles: mesh.indices.length / 3, branches },
  };
}

export interface RockSpec {
  readonly radius?: number;
  /** How far vertices are displaced, as a fraction of radius. */
  readonly roughness?: number;
  readonly seed?: number;
  readonly segments?: number;
}

/**
 * A rock: a sphere with its vertices pushed in and out.
 *
 * Displacement is applied per *welded* vertex, so neighbouring faces move
 * together and the result stays a closed solid — which is what lets it serve as
 * its own convex collider.
 */
export function generateRock(spec: RockSpec = {}): MeshData {
  const radius = requirePositive(spec.radius ?? 0.5, "Rock radius");
  const roughness = spec.roughness ?? 0.35;
  if (!(roughness >= 0 && roughness < 1)) throw new Error("A rock's roughness must lie in [0, 1).");
  const segments = spec.segments ?? 12;
  if (!Number.isInteger(segments) || segments < 4) throw new Error("A rock needs at least four segments.");
  const random = seededRandom(spec.seed ?? 1);

  const base = weldVertices(sphere({ radius, segments, rings: Math.max(3, Math.round(segments * 0.6)) }), radius * 1e-4);
  const positions = new Float32Array(base.positions);
  // A few random lobes, evaluated per vertex, give a rock silhouette without
  // needing a noise field — and stay identical for a given seed.
  const lobes = Array.from({ length: 4 }, () => ({
    direction: normalize([random() * 2 - 1, random() * 2 - 1, random() * 2 - 1]),
    amount: (random() * 2 - 1) * roughness,
  }));
  for (let index = 0; index < positions.length / 3; index += 1) {
    const p = normalize([positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!]);
    let displacement = 1;
    for (const lobe of lobes) {
      displacement += lobe.amount * Math.max(0, p[0] * lobe.direction[0] + p[1] * lobe.direction[1] + p[2] * lobe.direction[2]);
    }
    const scale = radius * Math.max(0.3, displacement);
    positions[index * 3] = p[0] * scale;
    positions[index * 3 + 1] = p[1] * scale;
    positions[index * 3 + 2] = p[2] * scale;
  }
  return withSlot(computeNormals({ ...base, positions }, { smooth: false }), NATURE_SLOTS.rock);
}

export interface GrassSpec {
  /** Blades in the clump. */
  readonly blades?: number;
  readonly height?: number;
  readonly radius?: number;
  readonly seed?: number;
}

/**
 * A clump of grass as crossed quads.
 *
 * Cheap by construction: grass is drawn in enormous numbers, so a blade is two
 * triangles and a clump is a handful. Anything more detailed is wasted at the
 * distance grass is actually seen from.
 */
export function generateGrassClump(spec: GrassSpec = {}): MeshData {
  const blades = spec.blades ?? 6;
  if (!Number.isInteger(blades) || blades < 1) throw new Error("A grass clump needs at least one blade.");
  const height = requirePositive(spec.height ?? 0.4, "Grass height");
  const radius = requirePositive(spec.radius ?? 0.15, "Grass clump radius");
  const random = seededRandom(spec.seed ?? 1);

  const parts: MeshData[] = [];
  for (let blade = 0; blade < blades; blade += 1) {
    const theta = random() * Math.PI * 2;
    const distance = random() * radius;
    const bladeHeight = height * (0.6 + random() * 0.6);
    const quad = plane({ width: height * 0.12, depth: bladeHeight, up: "z" });
    parts.push(
      placeMesh(quad, {
        position: [Math.cos(theta) * distance, bladeHeight / 2, Math.sin(theta) * distance],
        rotation: [0, (random() * 180), (random() * 20 - 10)],
      }),
    );
  }
  return withSlot(mergeMeshes(parts), NATURE_SLOTS.foliage);
}

export interface TerrainSpec {
  readonly width?: number;
  readonly depth?: number;
  /** Vertices along each axis, minus one. */
  readonly resolution?: number;
  /** Peak height of the generated relief. */
  readonly amplitude?: number;
  readonly seed?: number;
  /** Supply real elevation instead of generating it. Row-major, `(res+1)²`. */
  readonly heights?: readonly number[];
}

export interface GeneratedTerrain {
  readonly mesh: MeshData;
  /** Row-major heightfield, `(resolution + 1)²` samples. */
  readonly heights: Float32Array;
  readonly resolution: number;
  readonly size: readonly [number, number];
}

/**
 * A heightfield terrain patch.
 *
 * The heightfield is returned alongside the mesh because that is what physics
 * and navigation want: sampling a height at a point is O(1) against the grid
 * and a raycast against the triangles. Returning only triangles would force
 * every consumer to rebuild the grid.
 */
export function generateTerrain(spec: TerrainSpec = {}): GeneratedTerrain {
  const width = requirePositive(spec.width ?? 32, "Terrain width");
  const depth = requirePositive(spec.depth ?? 32, "Terrain depth");
  const resolution = spec.resolution ?? 32;
  if (!Number.isInteger(resolution) || resolution < 1) throw new Error("Terrain resolution must be a whole number of at least 1.");
  const amplitude = spec.amplitude ?? 3;
  const side = resolution + 1;
  const random = seededRandom(spec.seed ?? 1);

  let heights: Float32Array;
  if (spec.heights) {
    if (spec.heights.length !== side * side) {
      throw new Error(`Terrain heights must have ${side * side} samples for resolution ${resolution} (got ${spec.heights.length}).`);
    }
    heights = new Float32Array(spec.heights);
  } else {
    // Sum of a few sine lobes: smooth, seeded, and free of the periodic
    // artefacts a single frequency produces.
    const lobes = Array.from({ length: 4 }, () => ({
      fx: 0.5 + random() * 3,
      fz: 0.5 + random() * 3,
      phase: random() * Math.PI * 2,
      weight: random(),
    }));
    const total = lobes.reduce((sum, lobe) => sum + lobe.weight, 0) || 1;
    heights = new Float32Array(side * side);
    for (let row = 0; row < side; row += 1) {
      for (let column = 0; column < side; column += 1) {
        const u = column / resolution;
        const v = row / resolution;
        let value = 0;
        for (const lobe of lobes) value += lobe.weight * Math.sin(u * lobe.fx * Math.PI * 2 + lobe.phase) * Math.cos(v * lobe.fz * Math.PI * 2 + lobe.phase);
        heights[row * side + column] = (value / total) * amplitude;
      }
    }
  }

  const builder = new MeshBuilder();
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const u = column / resolution;
      const v = row / resolution;
      builder.vertex([(u - 0.5) * width, heights[row * side + column]!, (v - 0.5) * depth], { uv: [u, v] });
    }
  }
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const a = row * side + column;
      // Wound so the surface faces up. Rows advance along +Z and columns along
      // +X, so the quad must run column-then-row to put the normal on +Y — the
      // other order makes terrain invisible under backface culling and
      // unwalkable to the navmesh baker.
      builder.quad(a, a + side, a + side + 1, a + 1);
    }
  }
  const mesh = computeNormals(withSlot(builder.build(), NATURE_SLOTS.ground), { smooth: true });
  return { mesh, heights, resolution, size: [width, depth] };
}

/** Bilinear height lookup, so gameplay can place things on the terrain. */
export function sampleTerrainHeight(terrain: GeneratedTerrain, x: number, z: number): number {
  const [width, depth] = terrain.size;
  const side = terrain.resolution + 1;
  const u = (x / width + 0.5) * terrain.resolution;
  const v = (z / depth + 0.5) * terrain.resolution;
  const clamp = (value: number): number => Math.min(terrain.resolution, Math.max(0, value));
  const [cu, cv] = [clamp(u), clamp(v)];
  const [x0, z0] = [Math.floor(cu), Math.floor(cv)];
  const [x1, z1] = [Math.min(x0 + 1, terrain.resolution), Math.min(z0 + 1, terrain.resolution)];
  const [fx, fz] = [cu - x0, cv - z0];
  const h = (row: number, column: number): number => terrain.heights[row * side + column]!;
  return (
    h(z0, x0) * (1 - fx) * (1 - fz) + h(z0, x1) * fx * (1 - fz) + h(z1, x0) * (1 - fx) * fz + h(z1, x1) * fx * fz
  );
}

/**
 * Scatters instances over a terrain, avoiding slopes and each other.
 *
 * Returns placements rather than geometry, because a forest must be *instanced*
 * — merging ten thousand trees into one mesh is how a scene becomes
 * unrenderable.
 */
export function scatterOnTerrain(
  terrain: GeneratedTerrain,
  options: { count: number; seed?: number; minSpacing?: number; maxSlopeDegrees?: number; margin?: number },
): readonly { readonly position: readonly [number, number, number]; readonly rotationY: number; readonly scale: number }[] {
  const count = options.count;
  if (!Number.isInteger(count) || count < 0) throw new Error("A scatter count must be a non-negative whole number.");
  const random = seededRandom(options.seed ?? 1);
  const minSpacing = options.minSpacing ?? 0;
  const maxSlope = Math.cos(((options.maxSlopeDegrees ?? 35) * Math.PI) / 180);
  const margin = options.margin ?? 0;
  const [width, depth] = terrain.size;

  const placed: { position: [number, number, number]; rotationY: number; scale: number }[] = [];
  // Bounded attempts: a dense spacing on a small patch may simply not fit, and
  // looping forever is a worse failure than placing fewer instances.
  const attempts = count * 20;
  for (let attempt = 0; attempt < attempts && placed.length < count; attempt += 1) {
    const x = (random() - 0.5) * (width - margin * 2);
    const z = (random() - 0.5) * (depth - margin * 2);
    const y = sampleTerrainHeight(terrain, x, z);
    // Reject slopes using a finite-difference normal from the heightfield.
    const step = width / terrain.resolution;
    const dx = (sampleTerrainHeight(terrain, x + step, z) - sampleTerrainHeight(terrain, x - step, z)) / (2 * step);
    const dz = (sampleTerrainHeight(terrain, x, z + step) - sampleTerrainHeight(terrain, x, z - step)) / (2 * step);
    if (1 / Math.hypot(dx, dz, 1) < maxSlope) continue;
    if (minSpacing > 0 && placed.some((entry) => Math.hypot(entry.position[0] - x, entry.position[2] - z) < minSpacing)) continue;
    placed.push({ position: [x, y, z], rotationY: random() * 360, scale: 0.8 + random() * 0.4 });
  }
  return placed;
}

function withSlot(mesh: MeshData, slot: number): MeshData {
  return { ...mesh, materialSlots: new Uint16Array(mesh.indices.length / 3).fill(slot) };
}

function requirePositive(value: number, label: string): number {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`${label} must be a positive, finite number (got ${value}).`);
  return value;
}

function normalize(value: readonly number[]): [number, number, number] {
  const length = Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  if (length < 1e-9) return [0, 1, 0];
  return [(value[0] ?? 0) / length, (value[1] ?? 0) / length, (value[2] ?? 0) / length];
}
