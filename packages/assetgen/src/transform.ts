/** Placing and reshaping generated geometry.
 *
 * Generators produce shapes centred on the origin; these operators put them
 * where they belong. Every one returns a new mesh rather than mutating, because
 * generated assets are built by composing expressions and an operator that
 * mutated its input would make a shape unusable twice.
 */
import { compose, decompose, invert, multiplyMat4, quatFromEuler, transformDirection, transformPoint, type Mat4, type Vec3 } from "@vapour/math";
import { emptyAabb, expandAabb, type Aabb } from "@vapour/math";
import { validateMesh, type MeshData } from "./mesh.js";

/** Applies a matrix to positions and normals. */
export function transformMesh(mesh: MeshData, matrix: Mat4): MeshData {
  validateMesh(mesh, "mesh to transform");
  const count = mesh.positions.length / 3;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const point = transformPoint(matrix, [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!]);
    positions.set(point, index * 3);
  }

  let normals: Float32Array | undefined;
  if (mesh.normals) {
    // Normals go through the inverse transpose, or non-uniform scale tilts them
    // off the surface. Building it once here is cheaper than per vertex.
    const inverse = invert(matrix);
    const normalMatrix: Mat4 = [
      inverse[0]!, inverse[4]!, inverse[8]!, 0,
      inverse[1]!, inverse[5]!, inverse[9]!, 0,
      inverse[2]!, inverse[6]!, inverse[10]!, 0,
      0, 0, 0, 1,
    ];
    normals = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const direction = transformDirection(normalMatrix, [mesh.normals[index * 3]!, mesh.normals[index * 3 + 1]!, mesh.normals[index * 3 + 2]!]);
      const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
      normals.set([direction[0] / length, direction[1] / length, direction[2] / length], index * 3);
    }
  }

  // A mirroring transform reverses winding; without flipping, every face of a
  // mirrored asset points inward.
  const mirrored = determinant3(matrix) < 0;
  const indices = mirrored ? flipWinding(mesh.indices) : mesh.indices;
  return { ...mesh, positions, indices, ...(normals ? { normals } : {}) };
}

export function translateMesh(mesh: MeshData, offset: readonly number[]): MeshData {
  return transformMesh(mesh, compose(offset, [0, 0, 0, 1], [1, 1, 1]));
}

/** Rotates by intrinsic Y→X→Z Euler angles in degrees, matching the engine. */
export function rotateMesh(mesh: MeshData, eulerDegrees: readonly number[]): MeshData {
  return transformMesh(mesh, compose([0, 0, 0], quatFromEuler(eulerDegrees), [1, 1, 1]));
}

export function scaleMesh(mesh: MeshData, scale: readonly number[] | number): MeshData {
  const factors = typeof scale === "number" ? [scale, scale, scale] : scale;
  if (factors.some((value) => value === 0)) throw new Error("Scaling a mesh by zero on any axis collapses it; use a positive scale.");
  return transformMesh(mesh, compose([0, 0, 0], [0, 0, 0, 1], factors));
}

/** Mirrors across a plane through the origin. Winding is corrected. */
export function mirrorMesh(mesh: MeshData, axis: "x" | "y" | "z"): MeshData {
  const scale: Vec3 = axis === "x" ? [-1, 1, 1] : axis === "y" ? [1, -1, 1] : [1, 1, -1];
  return transformMesh(mesh, compose([0, 0, 0], [0, 0, 0, 1], scale));
}

/** Position, rotation, and scale applied in the engine's usual order. */
export function placeMesh(mesh: MeshData, placement: { position?: readonly number[]; rotation?: readonly number[]; scale?: readonly number[] | number }): MeshData {
  const scale = placement.scale === undefined ? [1, 1, 1] : typeof placement.scale === "number" ? [placement.scale, placement.scale, placement.scale] : placement.scale;
  return transformMesh(mesh, compose(placement.position ?? [0, 0, 0], quatFromEuler(placement.rotation ?? [0, 0, 0]), scale));
}

export function meshBounds(mesh: MeshData): Aabb {
  validateMesh(mesh, "mesh to measure");
  if (mesh.positions.length === 0) throw new Error("Cannot measure the bounds of an empty mesh.");
  let bounds = emptyAabb();
  for (let index = 0; index < mesh.positions.length / 3; index += 1) {
    bounds = expandAabb(bounds, [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!]);
  }
  return bounds;
}

/** Moves a mesh so a chosen point of its bounds sits at the origin. */
export function centerMesh(mesh: MeshData, anchor: "center" | "base" | "top" = "center"): MeshData {
  const bounds = meshBounds(mesh);
  const centerX = (bounds.min[0] + bounds.max[0]) / 2;
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
  const y = anchor === "center" ? (bounds.min[1] + bounds.max[1]) / 2 : anchor === "base" ? bounds.min[1] : bounds.max[1];
  return translateMesh(mesh, [-centerX, -y, -centerZ]);
}

/** Scales a mesh uniformly so its largest dimension equals `size`. */
export function fitMesh(mesh: MeshData, size: number): MeshData {
  if (!(size > 0)) throw new Error("A fit size must be positive.");
  const bounds = meshBounds(mesh);
  const extent = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
  if (extent < 1e-9) throw new Error("Cannot fit a mesh with no extent.");
  return scaleMesh(mesh, size / extent);
}

/** Repeats a mesh along a line — fence posts, columns, street lamps. */
export function repeatMesh(mesh: MeshData, count: number, step: readonly number[]): MeshData[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("A repeat count must be a whole number of at least 1.");
  return Array.from({ length: count }, (_, index) =>
    translateMesh(mesh, [(step[0] ?? 0) * index, (step[1] ?? 0) * index, (step[2] ?? 0) * index]),
  );
}

/** Repeats a mesh on a grid — floor tiles, window arrays, city blocks. */
export function gridMesh(mesh: MeshData, columns: number, rows: number, spacing: readonly number[]): MeshData[] {
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new Error("Grid dimensions must be whole numbers of at least 1.");
  }
  const out: MeshData[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      out.push(translateMesh(mesh, [(spacing[0] ?? 0) * column, 0, (spacing[2] ?? spacing[1] ?? 0) * row]));
    }
  }
  return out;
}

/** Composes two transforms, so callers do not import matrix maths directly. */
export function combineTransforms(outer: Mat4, inner: Mat4): Mat4 {
  return multiplyMat4(outer, inner);
}

/** Splits a transform back into position, rotation, and scale. */
export function describeTransform(matrix: Mat4): { position: Vec3; rotation: readonly number[]; scale: Vec3 } {
  const parts = decompose(matrix);
  return { position: parts.translation, rotation: parts.rotation, scale: parts.scale };
}

function determinant3(m: Mat4): number {
  return (
    m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
    m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) +
    m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!)
  );
}

function flipWinding(indices: Uint32Array): Uint32Array {
  const out = new Uint32Array(indices);
  for (let triangle = 0; triangle < out.length / 3; triangle += 1) {
    const b = out[triangle * 3 + 1]!;
    out[triangle * 3 + 1] = out[triangle * 3 + 2]!;
    out[triangle * 3 + 2] = b;
  }
  return out;
}
