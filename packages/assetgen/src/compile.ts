/** Compiling generated geometry into everything a runtime actually needs.
 *
 * Generation produces triangles. A game needs more than triangles: it needs
 * collision the physics engine can use, navigation the AI can walk, UVs the
 * material can sample, and cheaper versions for distance. Producing those
 * *from the description* rather than asking the author for them is the point —
 * an agent that had to hand-author a collider for every generated building
 * would be back where it started.
 */
import { MeshBuilder, meshStats, triangleCentroid, triangleNormal, validateMesh, weldVertices, type MeshData } from "./mesh.js";
import { meshBounds } from "./transform.js";
import { hullOfMesh } from "./hull.js";
import type { Aperture, GeneratedBuilding } from "./architecture.js";

export type CollisionKind = "box" | "convex" | "mesh";

export interface CollisionShape {
  readonly kind: CollisionKind;
  /** Half extents and centre, for `box`. */
  readonly box?: { readonly center: readonly [number, number, number]; readonly halfExtents: readonly [number, number, number] };
  /** Hull or triangle geometry, for `convex` and `mesh`. */
  readonly mesh?: MeshData;
}

export interface CollisionOptions {
  readonly kind?: CollisionKind;
  /** Simplify a `mesh` collider to at most this many triangles. */
  readonly maxTriangles?: number;
}

/**
 * Derives a collision shape.
 *
 * `box` suits props and crates, `convex` suits anything dynamic, and `mesh`
 * suits static level geometry — which is also the only case where an exact
 * shape is affordable, because a triangle-mesh collider cannot move.
 */
export function generateCollision(mesh: MeshData, options: CollisionOptions = {}): CollisionShape {
  validateMesh(mesh, "mesh to collide");
  const kind = options.kind ?? "convex";
  if (kind === "box") {
    const bounds = meshBounds(mesh);
    return {
      kind,
      box: {
        center: [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2],
        halfExtents: [
          Math.max((bounds.max[0] - bounds.min[0]) / 2, 1e-4),
          Math.max((bounds.max[1] - bounds.min[1]) / 2, 1e-4),
          Math.max((bounds.max[2] - bounds.min[2]) / 2, 1e-4),
        ],
      },
    };
  }
  if (kind === "convex") return { kind, mesh: hullOfMesh(mesh) };
  const limit = options.maxTriangles;
  const collider = limit !== undefined && meshStats(mesh).triangles > limit ? simplifyMesh(mesh, { maxTriangles: limit }) : mesh;
  return { kind, mesh: collider };
}

export interface SimplifyOptions {
  /** Target triangle count. The result is at most this, usually well under. */
  readonly maxTriangles?: number;
  /** Grid cells along the longest axis. Lower is coarser. Overrides the target. */
  readonly resolution?: number;
}

/**
 * Simplifies by vertex clustering: snap vertices to a grid, then drop the
 * triangles that collapse.
 *
 * Clustering is chosen over edge-collapse deliberately. It is O(n), it never
 * fails on the non-manifold output that generation and CSG produce, and its
 * error is bounded by the cell size — so a LOD budget translates directly into
 * a visual tolerance. Edge collapse gives better silhouettes and needs clean
 * manifold input, which generated geometry frequently is not.
 */
export function simplifyMesh(mesh: MeshData, options: SimplifyOptions = {}): MeshData {
  validateMesh(mesh, "mesh to simplify");
  const triangles = mesh.indices.length / 3;
  if (triangles === 0) return mesh;

  const bounds = meshBounds(mesh);
  const extent = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
  if (extent < 1e-9) return mesh;

  let resolution = options.resolution;
  if (resolution === undefined) {
    const target = options.maxTriangles ?? Math.max(1, Math.floor(triangles / 4));
    if (!Number.isInteger(target) || target < 1) throw new Error("A simplification target must be a whole number of at least 1.");
    // Triangle count falls roughly with the square of the grid resolution, so
    // this is the inverse of that relationship, clamped to something sane.
    resolution = Math.max(2, Math.min(256, Math.round(Math.sqrt(target) * 2)));
  }
  if (!Number.isInteger(resolution) || resolution < 2) throw new Error("A simplification resolution must be a whole number of at least 2.");

  const cell = extent / resolution;
  const builder = new MeshBuilder();
  const cluster = new Map<string, number>();
  const key = (index: number): string =>
    `${Math.round(mesh.positions[index * 3]! / cell)}_${Math.round(mesh.positions[index * 3 + 1]! / cell)}_${Math.round(mesh.positions[index * 3 + 2]! / cell)}`;

  // Each cluster's representative is the average of the vertices in it, which
  // keeps the simplified surface centred on the original instead of snapping
  // outward to a grid corner.
  const sums = new Map<string, { x: number; y: number; z: number; count: number }>();
  for (let index = 0; index < mesh.positions.length / 3; index += 1) {
    const bucket = key(index);
    const entry = sums.get(bucket) ?? { x: 0, y: 0, z: 0, count: 0 };
    entry.x += mesh.positions[index * 3]!;
    entry.y += mesh.positions[index * 3 + 1]!;
    entry.z += mesh.positions[index * 3 + 2]!;
    entry.count += 1;
    sums.set(bucket, entry);
  }

  const representative = (index: number): number => {
    const bucket = key(index);
    let vertex = cluster.get(bucket);
    if (vertex === undefined) {
      const entry = sums.get(bucket)!;
      vertex = builder.vertex([entry.x / entry.count, entry.y / entry.count, entry.z / entry.count]);
      cluster.set(bucket, vertex);
    }
    return vertex;
  };

  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const a = representative(mesh.indices[triangle * 3]!);
    const b = representative(mesh.indices[triangle * 3 + 1]!);
    const c = representative(mesh.indices[triangle * 3 + 2]!);
    if (a === b || b === c || a === c) continue;
    if (mesh.materialSlots) builder.setMaterialSlot(mesh.materialSlots[triangle]!);
    builder.triangle(a, b, c);
  }
  return builder.build();
}

/** A LOD chain generated from one source mesh. */
export interface GeneratedLod {
  readonly levels: readonly MeshData[];
  readonly triangleCounts: readonly number[];
}

/** Produces successively coarser versions, each roughly a quarter of the last. */
export function generateLodChain(mesh: MeshData, levels = 3): GeneratedLod {
  if (!Number.isInteger(levels) || levels < 1) throw new Error("An LOD chain needs at least one level.");
  const chain: MeshData[] = [mesh];
  let current = mesh;
  for (let level = 1; level < levels; level += 1) {
    const target = Math.max(4, Math.floor(meshStats(current).triangles / 4));
    const simplified = simplifyMesh(current, { maxTriangles: target });
    // Once simplification stops removing anything, more levels are wasted work.
    if (meshStats(simplified).triangles >= meshStats(current).triangles) break;
    chain.push(simplified);
    current = simplified;
  }
  return { levels: chain, triangleCounts: chain.map((level) => meshStats(level).triangles) };
}

export interface UvOptions {
  /** World units per UV unit. Larger values tile the texture less often. */
  readonly scale?: number;
}

/**
 * Generates triplanar UVs: each triangle is projected along whichever axis its
 * normal most points down.
 *
 * Not a substitute for authored UVs on a hero asset, but exactly right for
 * generated architecture and terrain, where the alternative is a texture
 * smeared across a wall. Because the projection is per triangle, vertices are
 * split so that neighbouring faces using different axes do not share UVs.
 */
export function generateTriplanarUvs(mesh: MeshData, options: UvOptions = {}): MeshData {
  validateMesh(mesh, "mesh to unwrap");
  const scale = options.scale ?? 1;
  if (!(scale > 0)) throw new Error("A UV scale must be positive.");
  const builder = new MeshBuilder();

  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    const normal = triangleNormal(mesh, triangle);
    const [ax, ay, az] = [Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])];
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    if (mesh.materialSlots) builder.setMaterialSlot(mesh.materialSlots[triangle]!);
    const corners: number[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = mesh.indices[triangle * 3 + corner]!;
      const [x, y, z] = [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!];
      const uv: [number, number] = axis === 0 ? [z / scale, y / scale] : axis === 1 ? [x / scale, z / scale] : [x / scale, y / scale];
      corners.push(
        builder.vertex([x, y, z], {
          uv,
          ...(mesh.normals ? { normal: [mesh.normals[index * 3]!, mesh.normals[index * 3 + 1]!, mesh.normals[index * 3 + 2]!] } : {}),
        }),
      );
    }
    builder.triangle(corners[0]!, corners[1]!, corners[2]!);
  }
  return builder.build();
}

export interface NavSurface {
  /** Height of the walkable plane. */
  readonly level: number;
  /** `[minX, minZ, maxX, maxZ]` of the walkable region. */
  readonly bounds: readonly [number, number, number, number];
  readonly name?: string;
}

export interface NavLink {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly width: number;
  readonly kind: "door" | "passage" | "stairs";
}

export interface NavGeometry {
  readonly surfaces: readonly NavSurface[];
  readonly links: readonly NavLink[];
  /** Triangles the navmesh baker should treat as walkable ground. */
  readonly walkable: MeshData;
}

/** Triangles whose normal is within `maxSlopeDegrees` of straight up. */
export function extractWalkableSurface(mesh: MeshData, maxSlopeDegrees = 45): MeshData {
  validateMesh(mesh, "mesh to walk");
  if (!(maxSlopeDegrees >= 0 && maxSlopeDegrees < 90)) throw new Error("A walkable slope must lie in [0, 90) degrees.");
  const limit = Math.cos((maxSlopeDegrees * Math.PI) / 180);
  const builder = new MeshBuilder();
  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    const normal = triangleNormal(mesh, triangle);
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    if (length < 1e-12) continue;
    if (normal[1] / length < limit) continue;
    const corners: number[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = mesh.indices[triangle * 3 + corner]!;
      corners.push(builder.vertex([mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!]));
    }
    builder.triangle(corners[0]!, corners[1]!, corners[2]!);
  }
  return weldVertices(builder.build());
}

/**
 * Derives navigation data from a generated building.
 *
 * This is the integration the brief asks for: a building described in text
 * produces, with no extra authoring, the walkable surfaces and the doorway
 * links an NPC needs to move through it. Windows are excluded — an agent that
 * routes through a first-floor window is a bug that is much easier to prevent
 * here than to debug later.
 */
export function generateNavGeometry(building: GeneratedBuilding, options: { maxSlopeDegrees?: number } = {}): NavGeometry {
  const surfaces: NavSurface[] = building.rooms.map((room) => {
    let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, z] of room.footprint) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return { level: room.level, bounds: [minX, minZ, maxX, maxZ] as const, name: room.name };
  });

  const links: NavLink[] = [];
  for (const aperture of building.apertures) {
    if (!aperture.walkable) continue;
    links.push(navLinkForAperture(aperture, building));
  }

  return {
    surfaces,
    links,
    walkable: extractWalkableSurface(building.mesh, options.maxSlopeDegrees ?? 45),
  };
}

/** A link crossing an aperture, placed on either side of the wall. */
function navLinkForAperture(aperture: Aperture, building: GeneratedBuilding): NavLink {
  // Perpendicular to the wall, in the ground plane.
  const across: [number, number, number] = [-aperture.along[2], 0, aperture.along[0]];
  const level = building.floorLevels[aperture.floorIndex] ?? 0;
  const reach = 0.6;
  return {
    from: [aperture.position[0] - across[0] * reach, level, aperture.position[2] - across[2] * reach],
    to: [aperture.position[0] + across[0] * reach, level, aperture.position[2] + across[2] * reach],
    width: aperture.width,
    kind: aperture.kind === "passage" ? "passage" : "door",
  };
}

/** Everything a generated asset carries into the runtime. */
export interface CompiledAsset {
  readonly mesh: MeshData;
  readonly lods: GeneratedLod;
  readonly collision: CollisionShape;
  readonly navigation?: NavGeometry;
  readonly stats: {
    readonly triangles: number;
    readonly vertices: number;
    readonly lodLevels: number;
    readonly collisionKind: CollisionKind;
  };
}

export interface CompileOptions {
  readonly lodLevels?: number;
  readonly collision?: CollisionOptions;
  readonly uvScale?: number;
  /** Skip triplanar UV generation when the mesh already has authored UVs. */
  readonly keepUvs?: boolean;
}

/** Compiles a raw generated mesh into a runtime-ready asset. */
export function compileAsset(mesh: MeshData, options: CompileOptions = {}): CompiledAsset {
  const unwrapped = options.keepUvs && mesh.uvs ? mesh : generateTriplanarUvs(mesh, { scale: options.uvScale ?? 2 });
  const lods = generateLodChain(unwrapped, options.lodLevels ?? 3);
  const collision = generateCollision(mesh, options.collision ?? { kind: "mesh", maxTriangles: 2000 });
  return {
    mesh: unwrapped,
    lods,
    collision,
    stats: {
      triangles: meshStats(unwrapped).triangles,
      vertices: meshStats(unwrapped).vertices,
      lodLevels: lods.levels.length,
      collisionKind: collision.kind,
    },
  };
}

/** Compiles a building, including its navigation data. */
export function compileBuilding(building: GeneratedBuilding, options: CompileOptions = {}): CompiledAsset {
  const compiled = compileAsset(building.mesh, { collision: { kind: "mesh" }, ...options });
  return { ...compiled, navigation: generateNavGeometry(building) };
}

/** Average triangle centroid, a cheap proxy for an asset's visual centre. */
export function meshCentroid(mesh: MeshData): [number, number, number] {
  const triangles = mesh.indices.length / 3;
  if (triangles === 0) throw new Error("An empty mesh has no centroid.");
  let [x, y, z] = [0, 0, 0];
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const centroid = triangleCentroid(mesh, triangle);
    x += centroid[0];
    y += centroid[1];
    z += centroid[2];
  }
  return [x / triangles, y / triangles, z / triangles];
}
