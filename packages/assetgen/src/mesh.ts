/** The geometry representation everything in `@vapour/assetgen` produces.
 *
 * A generated asset ends up as GPU buffers, so the representation is flat typed
 * arrays from the start rather than an object graph that has to be flattened
 * later. Every generator, every operator, and every compiler stage speaks this
 * one type, which is what lets them compose: a shape grammar can extrude a
 * profile, subtract a window from it, weld the result, and hand it to the LOD
 * generator without conversions in between.
 *
 * Positions are required. Normals, UVs, and colours are optional and generated
 * on demand, because a boolean operation that has to maintain four attribute
 * streams through every split is both slower and more fragile than one that
 * regenerates them afterwards.
 */
import { EPSILON, type Vec3 } from "@vapour/math";

export interface MeshData {
  /** `[x, y, z]` per vertex. */
  readonly positions: Float32Array;
  /** Triangle indices, three per face, counter-clockwise when seen from front. */
  readonly indices: Uint32Array;
  readonly normals?: Float32Array;
  /** `[u, v]` per vertex. */
  readonly uvs?: Float32Array;
  /** `[r, g, b, a]` per vertex, linear. */
  readonly colors?: Float32Array;
  /** Per-triangle material slot index, for multi-material assets. */
  readonly materialSlots?: Uint16Array;
}

export interface MeshStats {
  readonly vertices: number;
  readonly triangles: number;
  readonly hasNormals: boolean;
  readonly hasUvs: boolean;
  readonly hasColors: boolean;
  readonly materialSlots: number;
}

export function meshStats(mesh: MeshData): MeshStats {
  return {
    vertices: mesh.positions.length / 3,
    triangles: mesh.indices.length / 3,
    hasNormals: mesh.normals !== undefined,
    hasUvs: mesh.uvs !== undefined,
    hasColors: mesh.colors !== undefined,
    materialSlots: mesh.materialSlots === undefined ? 1 : new Set(mesh.materialSlots).size,
  };
}

/**
 * Validates a mesh's internal consistency.
 *
 * Generated geometry is produced by code an AI agent wrote, so the failure mode
 * this guards against is real and common: an index that points past the end of
 * the vertex array, or a normals array that does not match the positions. Both
 * produce silent corruption on the GPU and an obvious message here.
 */
export function validateMesh(mesh: MeshData, label = "mesh"): MeshData {
  const vertexCount = mesh.positions.length / 3;
  if (!Number.isInteger(vertexCount)) {
    throw new Error(`The ${label} has ${mesh.positions.length} position components, which is not a multiple of three.`);
  }
  if (mesh.indices.length % 3 !== 0) {
    throw new Error(`The ${label} has ${mesh.indices.length} indices, which is not a multiple of three.`);
  }
  for (let index = 0; index < mesh.indices.length; index += 1) {
    const value = mesh.indices[index]!;
    if (value >= vertexCount) {
      throw new Error(`The ${label} has index ${value} at position ${index}, but only ${vertexCount} vertices.`);
    }
  }
  const check = (name: string, array: ArrayLike<number> | undefined, stride: number): void => {
    if (array === undefined) return;
    if (array.length !== vertexCount * stride) {
      throw new Error(`The ${label} has ${vertexCount} vertices but ${array.length / stride} ${name}. They must match.`);
    }
  };
  check("normals", mesh.normals, 3);
  check("UVs", mesh.uvs, 2);
  check("colours", mesh.colors, 4);
  if (mesh.materialSlots !== undefined && mesh.materialSlots.length !== mesh.indices.length / 3) {
    throw new Error(`The ${label} has ${mesh.indices.length / 3} triangles but ${mesh.materialSlots.length} material slots.`);
  }
  for (let index = 0; index < mesh.positions.length; index += 1) {
    if (!Number.isFinite(mesh.positions[index]!)) {
      throw new Error(`The ${label} has a non-finite position at component ${index}.`);
    }
  }
  return mesh;
}

/**
 * Accumulates geometry, then produces a {@link MeshData}.
 *
 * Builders are the working representation: they hold plain arrays that grow,
 * because generation is naturally incremental — a wall pushes four vertices, a
 * roof pushes a few hundred — and converting to typed arrays once at the end is
 * far cheaper than resizing them along the way.
 */
export class MeshBuilder {
  readonly #positions: number[] = [];
  readonly #normals: number[] = [];
  readonly #uvs: number[] = [];
  readonly #colors: number[] = [];
  readonly #indices: number[] = [];
  readonly #slots: number[] = [];
  #hasNormals = false;
  #hasUvs = false;
  #hasColors = false;
  #slot = 0;

  get vertexCount(): number {
    return this.#positions.length / 3;
  }

  get triangleCount(): number {
    return this.#indices.length / 3;
  }

  /** Material slot assigned to triangles added from now on. */
  setMaterialSlot(slot: number): this {
    if (!Number.isInteger(slot) || slot < 0 || slot > 0xffff) {
      throw new Error(`A material slot must be a whole number in [0, 65535] (got ${slot}).`);
    }
    this.#slot = slot;
    return this;
  }

  /** Adds a vertex and returns its index. */
  vertex(position: readonly number[], options: { normal?: readonly number[]; uv?: readonly number[]; color?: readonly number[] } = {}): number {
    const index = this.vertexCount;
    this.#positions.push(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
    // Absent attributes are back-filled with defaults, so a builder that starts
    // adding UVs halfway through still produces a consistent array.
    if (options.normal) {
      this.#backfill(this.#normals, index * 3, 3, [0, 1, 0]);
      this.#normals.push(options.normal[0] ?? 0, options.normal[1] ?? 0, options.normal[2] ?? 0);
      this.#hasNormals = true;
    } else if (this.#hasNormals) {
      this.#normals.push(0, 1, 0);
    }
    if (options.uv) {
      this.#backfill(this.#uvs, index * 2, 2, [0, 0]);
      this.#uvs.push(options.uv[0] ?? 0, options.uv[1] ?? 0);
      this.#hasUvs = true;
    } else if (this.#hasUvs) {
      this.#uvs.push(0, 0);
    }
    if (options.color) {
      this.#backfill(this.#colors, index * 4, 4, [1, 1, 1, 1]);
      this.#colors.push(options.color[0] ?? 1, options.color[1] ?? 1, options.color[2] ?? 1, options.color[3] ?? 1);
      this.#hasColors = true;
    } else if (this.#hasColors) {
      this.#colors.push(1, 1, 1, 1);
    }
    return index;
  }

  triangle(a: number, b: number, c: number): this {
    const count = this.vertexCount;
    for (const index of [a, b, c]) {
      if (!Number.isInteger(index) || index < 0 || index >= count) {
        throw new Error(`Triangle references vertex ${index}, but the builder has ${count} vertices.`);
      }
    }
    this.#indices.push(a, b, c);
    this.#slots.push(this.#slot);
    return this;
  }

  /** Adds a convex polygon as a triangle fan. */
  polygon(indices: readonly number[]): this {
    if (indices.length < 3) throw new Error(`A polygon needs at least three vertices (got ${indices.length}).`);
    for (let index = 1; index + 1 < indices.length; index += 1) {
      this.triangle(indices[0]!, indices[index]!, indices[index + 1]!);
    }
    return this;
  }

  /** Adds a quad as two triangles, wound `a, b, c, d` around its perimeter. */
  quad(a: number, b: number, c: number, d: number): this {
    return this.triangle(a, b, c).triangle(a, c, d);
  }

  /** Appends another mesh, offsetting its indices. */
  append(mesh: MeshData, options: { materialSlot?: number } = {}): this {
    validateMesh(mesh, "appended mesh");
    const offset = this.vertexCount;
    const previousSlot = this.#slot;
    if (options.materialSlot !== undefined) this.setMaterialSlot(options.materialSlot);
    const count = mesh.positions.length / 3;
    for (let index = 0; index < count; index += 1) {
      this.vertex([mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!], {
        ...(mesh.normals ? { normal: [mesh.normals[index * 3]!, mesh.normals[index * 3 + 1]!, mesh.normals[index * 3 + 2]!] } : {}),
        ...(mesh.uvs ? { uv: [mesh.uvs[index * 2]!, mesh.uvs[index * 2 + 1]!] } : {}),
        ...(mesh.colors
          ? { color: [mesh.colors[index * 4]!, mesh.colors[index * 4 + 1]!, mesh.colors[index * 4 + 2]!, mesh.colors[index * 4 + 3]!] }
          : {}),
      });
    }
    for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
      if (options.materialSlot === undefined && mesh.materialSlots) this.setMaterialSlot(mesh.materialSlots[triangle]!);
      this.triangle(
        offset + mesh.indices[triangle * 3]!,
        offset + mesh.indices[triangle * 3 + 1]!,
        offset + mesh.indices[triangle * 3 + 2]!,
      );
    }
    this.#slot = previousSlot;
    return this;
  }

  build(): MeshData {
    const mesh: MeshData = {
      positions: new Float32Array(this.#positions),
      indices: new Uint32Array(this.#indices),
      ...(this.#hasNormals ? { normals: new Float32Array(this.#normals) } : {}),
      ...(this.#hasUvs ? { uvs: new Float32Array(this.#uvs) } : {}),
      ...(this.#hasColors ? { colors: new Float32Array(this.#colors) } : {}),
      ...(this.#slots.some((slot) => slot !== 0) ? { materialSlots: new Uint16Array(this.#slots) } : {}),
    };
    return validateMesh(mesh, "built mesh");
  }

  #backfill(target: number[], required: number, stride: number, fill: readonly number[]): void {
    while (target.length < required) {
      for (let component = 0; component < stride; component += 1) target.push(fill[component]!);
    }
  }
}

/** An empty mesh. Useful as a fold identity and as a "nothing here" result. */
export function emptyMesh(): MeshData {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) };
}

/** Concatenates meshes without merging vertices. */
export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  const builder = new MeshBuilder();
  for (const mesh of meshes) builder.append(mesh);
  return builder.build();
}

/** Triangle centroid, used by simplification and by material assignment. */
export function triangleCentroid(mesh: MeshData, triangle: number): Vec3 {
  const [a, b, c] = [mesh.indices[triangle * 3]!, mesh.indices[triangle * 3 + 1]!, mesh.indices[triangle * 3 + 2]!];
  return [
    (mesh.positions[a * 3]! + mesh.positions[b * 3]! + mesh.positions[c * 3]!) / 3,
    (mesh.positions[a * 3 + 1]! + mesh.positions[b * 3 + 1]! + mesh.positions[c * 3 + 1]!) / 3,
    (mesh.positions[a * 3 + 2]! + mesh.positions[b * 3 + 2]! + mesh.positions[c * 3 + 2]!) / 3,
  ];
}

/** Unnormalized triangle normal; its length is twice the triangle's area. */
export function triangleNormal(mesh: MeshData, triangle: number): Vec3 {
  const [a, b, c] = [mesh.indices[triangle * 3]!, mesh.indices[triangle * 3 + 1]!, mesh.indices[triangle * 3 + 2]!];
  const ax = mesh.positions[a * 3]!, ay = mesh.positions[a * 3 + 1]!, az = mesh.positions[a * 3 + 2]!;
  const bx = mesh.positions[b * 3]! - ax, by = mesh.positions[b * 3 + 1]! - ay, bz = mesh.positions[b * 3 + 2]! - az;
  const cx = mesh.positions[c * 3]! - ax, cy = mesh.positions[c * 3 + 1]! - ay, cz = mesh.positions[c * 3 + 2]! - az;
  return [by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx];
}

export function triangleArea(mesh: MeshData, triangle: number): number {
  const normal = triangleNormal(mesh, triangle);
  return Math.hypot(normal[0], normal[1], normal[2]) / 2;
}

/** Total surface area, used to budget texel density and LOD thresholds. */
export function surfaceArea(mesh: MeshData): number {
  let total = 0;
  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) total += triangleArea(mesh, triangle);
  return total;
}

/**
 * Signed volume via the divergence theorem.
 *
 * Only meaningful for a closed, consistently wound mesh — which is exactly why
 * it is useful: a negative or wildly wrong volume is a fast check that a
 * generator produced inside-out or open geometry.
 */
export function signedVolume(mesh: MeshData): number {
  let volume = 0;
  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    const [a, b, c] = [mesh.indices[triangle * 3]!, mesh.indices[triangle * 3 + 1]!, mesh.indices[triangle * 3 + 2]!];
    const ax = mesh.positions[a * 3]!, ay = mesh.positions[a * 3 + 1]!, az = mesh.positions[a * 3 + 2]!;
    const bx = mesh.positions[b * 3]!, by = mesh.positions[b * 3 + 1]!, bz = mesh.positions[b * 3 + 2]!;
    const cx = mesh.positions[c * 3]!, cy = mesh.positions[c * 3 + 1]!, cz = mesh.positions[c * 3 + 2]!;
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

/** True when every edge is shared by exactly two triangles: the mesh is closed
 * and therefore safe to use as a solid for CSG and for physics. */
export function isClosed(mesh: MeshData): boolean {
  const edges = new Map<string, number>();
  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    const corners = [mesh.indices[triangle * 3]!, mesh.indices[triangle * 3 + 1]!, mesh.indices[triangle * 3 + 2]!];
    for (let corner = 0; corner < 3; corner += 1) {
      const a = corners[corner]!;
      const b = corners[(corner + 1) % 3]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const count of edges.values()) {
    if (count !== 2) return false;
  }
  return edges.size > 0;
}

/**
 * Merges vertices closer together than `tolerance`.
 *
 * Generators naturally produce duplicate vertices at seams — every wall of a
 * building meets its neighbours — and those duplicates break smooth shading,
 * inflate the vertex count, and make a mesh look open to {@link isClosed}.
 * Welding uses a spatial hash rather than an O(n²) scan, so it stays usable on
 * the hundreds of thousands of vertices a city block produces.
 */
export function weldVertices(mesh: MeshData, tolerance = 1e-5): MeshData {
  validateMesh(mesh, "mesh to weld");
  if (!(tolerance > 0)) throw new Error("A weld tolerance must be positive.");
  const count = mesh.positions.length / 3;
  const cell = tolerance * 2;
  const buckets = new Map<string, number[]>();
  const remap = new Uint32Array(count);
  const builder = new MeshBuilder();

  for (let index = 0; index < count; index += 1) {
    const [x, y, z] = [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!];
    const key = `${Math.floor(x / cell)}_${Math.floor(y / cell)}_${Math.floor(z / cell)}`;
    let match: number | undefined;
    // Check the 27 neighbouring cells: a point near a cell boundary has its
    // twin in an adjacent bucket, and missing those is how naive spatial
    // hashing leaves visible seams.
    for (let dx = -1; dx <= 1 && match === undefined; dx += 1) {
      for (let dy = -1; dy <= 1 && match === undefined; dy += 1) {
        for (let dz = -1; dz <= 1 && match === undefined; dz += 1) {
          const neighbours = buckets.get(`${Math.floor(x / cell) + dx}_${Math.floor(y / cell) + dy}_${Math.floor(z / cell) + dz}`);
          if (!neighbours) continue;
          for (const candidate of neighbours) {
            const dxx = mesh.positions[candidate * 3]! - x;
            const dyy = mesh.positions[candidate * 3 + 1]! - y;
            const dzz = mesh.positions[candidate * 3 + 2]! - z;
            if (dxx * dxx + dyy * dyy + dzz * dzz <= tolerance * tolerance) {
              match = candidate;
              break;
            }
          }
        }
      }
    }
    if (match !== undefined) {
      remap[index] = remap[match]!;
      continue;
    }
    const bucket = buckets.get(key) ?? [];
    bucket.push(index);
    buckets.set(key, bucket);
    remap[index] = builder.vertex([x, y, z], {
      ...(mesh.normals ? { normal: [mesh.normals[index * 3]!, mesh.normals[index * 3 + 1]!, mesh.normals[index * 3 + 2]!] } : {}),
      ...(mesh.uvs ? { uv: [mesh.uvs[index * 2]!, mesh.uvs[index * 2 + 1]!] } : {}),
      ...(mesh.colors
        ? { color: [mesh.colors[index * 4]!, mesh.colors[index * 4 + 1]!, mesh.colors[index * 4 + 2]!, mesh.colors[index * 4 + 3]!] }
        : {}),
    });
  }

  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    const a = remap[mesh.indices[triangle * 3]!]!;
    const b = remap[mesh.indices[triangle * 3 + 1]!]!;
    const c = remap[mesh.indices[triangle * 3 + 2]!]!;
    // Welding can collapse a sliver triangle to a line; dropping it here keeps
    // degenerate faces out of everything downstream.
    if (a === b || b === c || a === c) continue;
    if (mesh.materialSlots) builder.setMaterialSlot(mesh.materialSlots[triangle]!);
    builder.triangle(a, b, c);
  }
  return builder.build();
}

/** Recomputes smooth normals by area-weighted averaging of face normals. */
export function computeNormals(mesh: MeshData, options: { smooth?: boolean } = {}): MeshData {
  validateMesh(mesh, "mesh to normalize");
  const smooth = options.smooth ?? true;
  if (!smooth) return computeFlatNormals(mesh);

  const count = mesh.positions.length / 3;
  const normals = new Float32Array(count * 3);
  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    // Unnormalized, so larger faces contribute proportionally more — which is
    // what makes the average follow the surface rather than the tessellation.
    const normal = triangleNormal(mesh, triangle);
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.indices[triangle * 3 + corner]!;
      normals[vertex * 3] = normals[vertex * 3]! + normal[0];
      normals[vertex * 3 + 1] = normals[vertex * 3 + 1]! + normal[1];
      normals[vertex * 3 + 2] = normals[vertex * 3 + 2]! + normal[2];
    }
  }
  for (let index = 0; index < count; index += 1) {
    const length = Math.hypot(normals[index * 3]!, normals[index * 3 + 1]!, normals[index * 3 + 2]!);
    if (length < EPSILON) {
      normals[index * 3 + 1] = 1;
      continue;
    }
    normals[index * 3] = normals[index * 3]! / length;
    normals[index * 3 + 1] = normals[index * 3 + 1]! / length;
    normals[index * 3 + 2] = normals[index * 3 + 2]! / length;
  }
  return { ...mesh, normals };
}

/** Splits every vertex so each face gets its own, producing faceted shading. */
function computeFlatNormals(mesh: MeshData): MeshData {
  const builder = new MeshBuilder();
  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    const normal = triangleNormal(mesh, triangle);
    const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    const unit: Vec3 = [normal[0] / length, normal[1] / length, normal[2] / length];
    if (mesh.materialSlots) builder.setMaterialSlot(mesh.materialSlots[triangle]!);
    const corners: number[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.indices[triangle * 3 + corner]!;
      corners.push(
        builder.vertex([mesh.positions[vertex * 3]!, mesh.positions[vertex * 3 + 1]!, mesh.positions[vertex * 3 + 2]!], {
          normal: unit,
          ...(mesh.uvs ? { uv: [mesh.uvs[vertex * 2]!, mesh.uvs[vertex * 2 + 1]!] } : {}),
        }),
      );
    }
    builder.triangle(corners[0]!, corners[1]!, corners[2]!);
  }
  return builder.build();
}

/** Flips winding and normals, turning a solid inside out. */
export function flipMesh(mesh: MeshData): MeshData {
  const indices = new Uint32Array(mesh.indices);
  for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
    const b = indices[triangle * 3 + 1]!;
    indices[triangle * 3 + 1] = indices[triangle * 3 + 2]!;
    indices[triangle * 3 + 2] = b;
  }
  const normals = mesh.normals ? new Float32Array(mesh.normals.map((value) => -value)) : undefined;
  return { ...mesh, indices, ...(normals ? { normals } : {}) };
}

/**
 * Splits triangle edges at vertices that lie on them, removing T-junctions.
 *
 * Boolean operations leave these behind: when a plane splits one polygon, the
 * neighbour sharing that edge may not be split at the same point, so a vertex
 * ends up sitting in the middle of someone else's edge. The surface is
 * geometrically watertight — the volume is exactly right — but topologically it
 * is full of edges used once, which means:
 *
 * - {@link isClosed} reports it as open, so it cannot be a CSG operand again,
 * - a physics mesh collider can leak at the seam,
 * - smooth normals break across the junction, showing as a visible crack.
 *
 * Repair splits each offending triangle so that every vertex lying on an edge
 * becomes a real corner of the triangles on both sides.
 */
export function repairTJunctions(mesh: MeshData, tolerance = 1e-6): MeshData {
  validateMesh(mesh, "mesh to repair");
  if (!(tolerance > 0)) throw new Error("A T-junction tolerance must be positive.");
  const vertexCount = mesh.positions.length / 3;
  if (vertexCount === 0) return mesh;

  // Spatial hash over vertices, so each edge only tests nearby candidates
  // instead of every vertex in the mesh. The cell is sized from the mesh's own
  // extent rather than from the tolerance: a tolerance-sized grid over a
  // building-sized mesh would have billions of cells.
  let extent = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < vertexCount; index += 1) {
      const value = mesh.positions[index * 3 + axis]!;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    extent = Math.max(extent, max - min);
  }
  const cell = Math.max(extent / 32, tolerance * 10, 1e-6);
  const buckets = new Map<string, number[]>();
  const key = (x: number, y: number, z: number): string => `${Math.floor(x / cell)}_${Math.floor(y / cell)}_${Math.floor(z / cell)}`;
  for (let index = 0; index < vertexCount; index += 1) {
    const bucketKey = key(mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!);
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(index);
    buckets.set(bucketKey, bucket);
  }

  const position = (index: number): [number, number, number] => [
    mesh.positions[index * 3]!,
    mesh.positions[index * 3 + 1]!,
    mesh.positions[index * 3 + 2]!,
  ];

  /** Vertices strictly inside the segment, ordered from `a` to `b`. */
  const splitsOnEdge = (a: number, b: number): number[] => {
    const [ax, ay, az] = position(a);
    const [bx, by, bz] = position(b);
    const [ex, ey, ez] = [bx - ax, by - ay, bz - az];
    const lengthSquared = ex * ex + ey * ey + ez * ez;
    if (lengthSquared < tolerance * tolerance) return [];

    // March along the segment collecting the cells it passes through, rather
    // than sweeping its whole bounding box — the box of a long diagonal edge
    // contains vastly more cells than the edge actually touches.
    const length = Math.sqrt(lengthSquared);
    const steps = Math.ceil(length / (cell / 2)) + 1;
    const candidates = new Set<number>();
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const [px, py, pz] = [ax + ex * t, ay + ey * t, az + ez * t];
      const [gx, gy, gz] = [Math.floor(px / cell), Math.floor(py / cell), Math.floor(pz / cell)];
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            for (const candidate of buckets.get(`${gx + dx}_${gy + dy}_${gz + dz}`) ?? []) candidates.add(candidate);
          }
        }
      }
    }

    const found: { index: number; t: number }[] = [];
    for (const candidate of candidates) {
      if (candidate === a || candidate === b) continue;
      const [px, py, pz] = position(candidate);
      const t = ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / lengthSquared;
      if (t <= 0 || t >= 1) continue;
      const dx = px - (ax + ex * t);
      const dy = py - (ay + ey * t);
      const dz = pz - (az + ez * t);
      if (dx * dx + dy * dy + dz * dz > tolerance * tolerance) continue;
      if (found.some((entry) => Math.abs(entry.t - t) < 1e-9)) continue;
      found.push({ index: candidate, t });
    }
    return found.sort((left, right) => left.t - right.t).map((entry) => entry.index);
  };

  const builder = new MeshBuilder();
  const copy = (index: number): number =>
    builder.vertex(position(index), {
      ...(mesh.normals ? { normal: [mesh.normals[index * 3]!, mesh.normals[index * 3 + 1]!, mesh.normals[index * 3 + 2]!] } : {}),
      ...(mesh.uvs ? { uv: [mesh.uvs[index * 2]!, mesh.uvs[index * 2 + 1]!] } : {}),
      ...(mesh.colors
        ? { color: [mesh.colors[index * 4]!, mesh.colors[index * 4 + 1]!, mesh.colors[index * 4 + 2]!, mesh.colors[index * 4 + 3]!] }
        : {}),
    });

  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    const corners = [mesh.indices[triangle * 3]!, mesh.indices[triangle * 3 + 1]!, mesh.indices[triangle * 3 + 2]!];
    // Walk the perimeter, inserting any vertices found on each edge. The result
    // is the same triangle expressed as a polygon with collinear extra corners,
    // which fans correctly because it stays planar and convex.
    const perimeter: number[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const a = corners[corner]!;
      const b = corners[(corner + 1) % 3]!;
      perimeter.push(a, ...splitsOnEdge(a, b));
    }
    if (mesh.materialSlots) builder.setMaterialSlot(mesh.materialSlots[triangle]!);
    const mapped = perimeter.map(copy);
    if (mapped.length === 3) builder.triangle(mapped[0]!, mapped[1]!, mapped[2]!);
    else builder.polygon(mapped);
  }
  return builder.build();
}
