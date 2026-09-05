/** 4x4 matrix maths in the layout Vapour's renderer and WGSL shaders use.
 *
 * Matrices are **column-major** flat arrays of 16 numbers: element `[col*4+row]`.
 * Translation therefore sits at indices 12, 13, 14. This matches WGSL's
 * `mat4x4<f32>` memory layout, so a matrix built here can be written straight
 * into a uniform buffer with no transpose, and it matches glTF's node matrices
 * so imported scenes need no conversion either.
 *
 * Projections target WebGPU's `[0, 1]` clip-space depth range, not OpenGL's
 * `[-1, 1]`.
 */
import { EPSILON } from "./scalar.js";
import type { Quat } from "./quat.js";
import { normalizeQuat, quatFromBasis } from "./quat.js";
import type { Vec3, Vec3Like } from "./vec3.js";

export type Mat4 = number[];
export type Mat4Like = readonly number[];
/** Column-major 3x3, used for normal matrices. */
export type Mat3 = number[];

export const MAT4_IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function identity(): Mat4 {
  return MAT4_IDENTITY.slice();
}

export function toMat4(value: Mat4Like, label = "A matrix"): Mat4 {
  if (value.length !== 16) throw new Error(`${label} requires sixteen components.`);
  const out = value.slice() as Mat4;
  if (out.some((component) => !Number.isFinite(component))) throw new Error(`${label} requires finite components.`);
  return out;
}

/** Applies `right` first, then `left`. */
export function multiplyMat4(left: Mat4Like, right: Mat4Like): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        left[row]! * right[column * 4]! +
        left[4 + row]! * right[column * 4 + 1]! +
        left[8 + row]! * right[column * 4 + 2]! +
        left[12 + row]! * right[column * 4 + 3]!;
    }
  }
  return out;
}

export function transpose(value: Mat4Like): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) out[row * 4 + column] = value[column * 4 + row]!;
  }
  return out;
}

export function fromTranslation(translation: Vec3Like): Mat4 {
  const out = identity();
  out[12] = translation[0]!;
  out[13] = translation[1]!;
  out[14] = translation[2]!;
  return out;
}

export function fromScale(scale: Vec3Like): Mat4 {
  const out = identity();
  out[0] = scale[0]!;
  out[5] = scale[1]!;
  out[10] = scale[2]!;
  return out;
}

export function fromQuat(rotation: readonly number[]): Mat4 {
  const [x, y, z, w] = normalizeQuat(rotation);
  const [x2, y2, z2] = [x + x, y + y, z + z];
  const [xx, xy, xz] = [x * x2, x * y2, x * z2];
  const [yy, yz, zz] = [y * y2, y * z2, z * z2];
  const [wx, wy, wz] = [w * x2, w * y2, w * z2];
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1,
  ];
}

/**
 * Builds a transform applying scale, then rotation, then translation.
 *
 * This is the order every Vapour transform component uses, so a scene's
 * `position`/`rotation`/`scale` fields compose to exactly this matrix.
 */
export function compose(translation: Vec3Like, rotation: readonly number[], scale: Vec3Like): Mat4 {
  const out = fromQuat(rotation);
  for (let column = 0; column < 3; column += 1) {
    const factor = scale[column]!;
    out[column * 4] = out[column * 4]! * factor;
    out[column * 4 + 1] = out[column * 4 + 1]! * factor;
    out[column * 4 + 2] = out[column * 4 + 2]! * factor;
  }
  out[12] = translation[0]!;
  out[13] = translation[1]!;
  out[14] = translation[2]!;
  return out;
}

export interface DecomposedTransform {
  readonly translation: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

/**
 * Splits an affine transform back into translation, rotation, and scale.
 *
 * A negative determinant means the matrix mirrors, which a quaternion cannot
 * express; the X axis absorbs the flip as a negative scale so that
 * `compose(decompose(m))` round-trips.
 */
export function decompose(value: Mat4Like): DecomposedTransform {
  const matrix = toMat4(value);
  const translation: Vec3 = [matrix[12]!, matrix[13]!, matrix[14]!];
  let sx = Math.hypot(matrix[0]!, matrix[1]!, matrix[2]!);
  const sy = Math.hypot(matrix[4]!, matrix[5]!, matrix[6]!);
  const sz = Math.hypot(matrix[8]!, matrix[9]!, matrix[10]!);
  if (determinant(matrix) < 0) sx = -sx;
  if (Math.abs(sx) < EPSILON || sy < EPSILON || sz < EPSILON) {
    throw new Error("Cannot decompose a matrix with a zero-scale axis.");
  }
  const right: Vec3 = [matrix[0]! / sx, matrix[1]! / sx, matrix[2]! / sx];
  const up: Vec3 = [matrix[4]! / sy, matrix[5]! / sy, matrix[6]! / sy];
  const back: Vec3 = [matrix[8]! / sz, matrix[9]! / sz, matrix[10]! / sz];
  return { translation, rotation: quatFromBasis(right, up, back), scale: [sx, sy, sz] };
}

export function determinant(value: Mat4Like): number {
  const m = value;
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
}

/** Throws on a singular matrix rather than returning silently wrong results. */
export function invert(value: Mat4Like): Mat4 {
  const m = value;
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) throw new Error("Cannot invert a singular matrix.");
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d,
    (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d,
    (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d,
    (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d,
    (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d,
    (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d,
    (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d,
    (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d,
    (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}

/** Transforms a position, applying translation and the perspective divide. */
export function transformPoint(matrix: Mat4Like, point: Vec3Like): Vec3 {
  const [x, y, z] = [point[0]!, point[1]!, point[2]!];
  const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
  const divisor = Math.abs(w) < EPSILON ? 1 : w;
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) / divisor,
    (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) / divisor,
    (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) / divisor,
  ];
}

/** Transforms a direction, ignoring translation. Not valid for normals under
 * non-uniform scale — use {@link normalMatrix} for those. */
export function transformDirection(matrix: Mat4Like, direction: Vec3Like): Vec3 {
  const [x, y, z] = [direction[0]!, direction[1]!, direction[2]!];
  return [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z,
  ];
}

/** Inverse-transpose of the upper-left 3x3, so normals survive non-uniform scale. */
export function normalMatrix(matrix: Mat4Like): Mat3 {
  const inverse = invert(matrix);
  return [inverse[0]!, inverse[4]!, inverse[8]!, inverse[1]!, inverse[5]!, inverse[9]!, inverse[2]!, inverse[6]!, inverse[10]!];
}

/** Right-handed view matrix looking from `eye` toward `target`. */
export function lookAt(eye: Vec3Like, target: Vec3Like, up: Vec3Like = [0, 1, 0]): Mat4 {
  const back: Vec3 = [eye[0]! - target[0]!, eye[1]! - target[1]!, eye[2]! - target[2]!];
  const backLength = Math.hypot(back[0], back[1], back[2]);
  if (backLength < EPSILON) throw new Error("A view matrix requires distinct eye and target positions.");
  const b: Vec3 = [back[0] / backLength, back[1] / backLength, back[2] / backLength];
  let right: Vec3 = [up[1]! * b[2] - up[2]! * b[1], up[2]! * b[0] - up[0]! * b[2], up[0]! * b[1] - up[1]! * b[0]];
  let rightLength = Math.hypot(right[0], right[1], right[2]);
  if (rightLength < EPSILON) {
    const fallback: Vec3 = Math.abs(b[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    right = [fallback[1] * b[2] - fallback[2] * b[1], fallback[2] * b[0] - fallback[0] * b[2], fallback[0] * b[1] - fallback[1] * b[0]];
    rightLength = Math.hypot(right[0], right[1], right[2]);
  }
  const r: Vec3 = [right[0] / rightLength, right[1] / rightLength, right[2] / rightLength];
  const u: Vec3 = [b[1] * r[2] - b[2] * r[1], b[2] * r[0] - b[0] * r[2], b[0] * r[1] - b[1] * r[0]];
  const dot = (a: Vec3, c: Vec3Like): number => a[0] * c[0]! + a[1] * c[1]! + a[2] * c[2]!;
  return [r[0], u[0], b[0], 0, r[1], u[1], b[1], 0, r[2], u[2], b[2], 0, -dot(r, eye), -dot(u, eye), -dot(b, eye), 1];
}

/** Perspective projection into WebGPU's `[0, 1]` depth range. */
export function perspective(fieldOfViewDegrees: number, aspectRatio: number, near: number, far: number): Mat4 {
  if (!(fieldOfViewDegrees > 0 && fieldOfViewDegrees < 180)) throw new Error("Field of view must be between 0 and 180 degrees.");
  if (!(aspectRatio > 0)) throw new Error("Aspect ratio must be positive.");
  if (!(near > 0 && far > near)) throw new Error("Perspective clip planes require 0 < near < far.");
  const focal = 1 / Math.tan((fieldOfViewDegrees * Math.PI) / 180 / 2);
  const range = 1 / (near - far);
  return [focal / aspectRatio, 0, 0, 0, 0, focal, 0, 0, 0, 0, far * range, -1, 0, 0, near * far * range, 0];
}

/** Orthographic projection into WebGPU's `[0, 1]` depth range. */
export function orthographic(verticalSize: number, aspectRatio: number, near: number, far: number): Mat4 {
  if (!(verticalSize > 0)) throw new Error("Orthographic vertical size must be positive.");
  if (!(aspectRatio > 0)) throw new Error("Aspect ratio must be positive.");
  if (!(far > near)) throw new Error("Orthographic clip planes require near < far.");
  const halfHeight = verticalSize / 2;
  const halfWidth = halfHeight * aspectRatio;
  return [1 / halfWidth, 0, 0, 0, 0, 1 / halfHeight, 0, 0, 0, 0, 1 / (near - far), 0, 0, 0, near / (near - far), 1];
}

export function equalsMat4(a: Mat4Like, b: Mat4Like, tolerance = EPSILON): boolean {
  return a.length === b.length && a.every((component, index) => Math.abs(component - b[index]!) <= tolerance);
}
