import {
  eulerFromQuat,
  invertQuat,
  multiplyQuat,
  normalizeQuat,
  quatFromAxisAngle,
  quatFromEuler,
  rotateVector as rotateVectorByQuat,
  round,
} from "@vapour/math";

/**
 * Rotation helpers for scenes and the editor inspector.
 *
 * The underlying maths lives in `@vapour/math`; this module keeps the engine's
 * long-standing names, its stricter argument validation, and the display
 * rounding the inspector depends on. New code should prefer `@vapour/math`
 * directly — these names remain for compatibility with existing projects.
 */

export type Quaternion = [number, number, number, number];
export type EulerDegrees = [number, number, number];

/**
 * Euler ↔ quaternion conversion for inspector editing.
 *
 * Scenes store rotations as quaternions because they interpolate and compose
 * without gimbal lock, but nobody authors a quaternion by hand. The editor
 * therefore shows degrees and converts on the way in and out.
 *
 * The order is intrinsic Y→X→Z (yaw, then pitch, then roll), matching the
 * convention Unity and Godot present in their inspectors, so imported content
 * and tutorials line up with what Vapour displays.
 */
export function quaternionFromEuler(euler: EulerDegrees): Quaternion {
  return quatFromEuler(euler);
}

export function eulerFromQuaternion(quaternion: readonly number[]): EulerDegrees {
  // Rounded for display: the inspector edits these numbers directly, and raw
  // conversion noise would make every re-render dirty the field.
  return eulerFromQuat(requireQuaternion(quaternion)).map((angle) => roundAngle(angle)) as EulerDegrees;
}

export function normalizeQuaternion(value: readonly number[]): Quaternion {
  return normalizeQuat(requireQuaternion(value));
}

/** Rounds display angles so editing a value does not accumulate float noise. */
export function roundAngle(value: number, decimals = 3): number {
  return round(value, decimals);
}

/** Hamilton product: applies `b` first, then `a`. */
export function multiplyQuaternions(a: readonly number[], b: readonly number[]): Quaternion {
  return multiplyQuat(requireQuaternion(a), requireQuaternion(b));
}

/** Inverse of a unit quaternion, which is simply its conjugate. */
export function invertQuaternion(value: readonly number[]): Quaternion {
  return invertQuat(requireQuaternion(value));
}

export function quaternionFromAxisAngle(axis: readonly number[], radians: number): Quaternion {
  if (!Number.isFinite(radians)) throw new Error("A rotation angle must be finite.");
  const length = Math.hypot(axis[0]!, axis[1]!, axis[2]!);
  if (!Number.isFinite(length) || length < 1e-8) throw new Error("A rotation axis cannot be zero length.");
  return quatFromAxisAngle(axis, radians);
}

export function rotateVector(quaternion: readonly number[], vector: readonly number[]): [number, number, number] {
  return rotateVectorByQuat(requireQuaternion(quaternion), vector);
}

function requireQuaternion(value: readonly number[]): readonly number[] {
  if (value.length !== 4 || value.some((component) => !Number.isFinite(component))) {
    throw new Error("A quaternion requires four finite components.");
  }
  return value;
}

/**
 * Extracts the rotation from a column-major transform by orthonormalizing its
 * basis. Non-uniform scale and shear are discarded, which is what a gizmo
 * wants: it needs the frame's orientation, not its stretch.
 */
export function quaternionFromMatrix(matrix: readonly number[]): Quaternion {
  const columns = [0, 1, 2].map((column) => {
    const vector = [matrix[column * 4]!, matrix[column * 4 + 1]!, matrix[column * 4 + 2]!];
    const length = Math.hypot(...vector);
    if (!Number.isFinite(length) || length < 1e-8) throw new Error("A transform basis column cannot be zero length.");
    return vector.map((component) => component / length);
  });
  const [m00, m01, m02] = [columns[0]![0]!, columns[1]![0]!, columns[2]![0]!];
  const [m10, m11, m12] = [columns[0]![1]!, columns[1]![1]!, columns[2]![1]!];
  const [m20, m21, m22] = [columns[0]![2]!, columns[1]![2]!, columns[2]![2]!];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    return normalizeQuaternion([(m21 - m12) / scale, (m02 - m20) / scale, (m10 - m01) / scale, scale / 4]);
  }
  if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalizeQuaternion([scale / 4, (m01 + m10) / scale, (m02 + m20) / scale, (m21 - m12) / scale]);
  }
  if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalizeQuaternion([(m01 + m10) / scale, scale / 4, (m12 + m21) / scale, (m02 - m20) / scale]);
  }
  const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalizeQuaternion([(m02 + m20) / scale, (m12 + m21) / scale, scale / 4, (m10 - m01) / scale]);
}

/** Inverse of a transform's linear part applied to a direction. Gizmos drag in
 * world space but transforms are stored in parent space, so world deltas must
 * come back through the parent's basis. */
export function inverseTransformDirection(matrix: readonly number[], direction: readonly number[]): [number, number, number] {
  const a = matrix[0]!, b = matrix[1]!, c = matrix[2]!;
  const d = matrix[4]!, e = matrix[5]!, f = matrix[6]!;
  const g = matrix[8]!, h = matrix[9]!, i = matrix[10]!;
  const determinant = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error("A transform with zero scale cannot be inverted for editing.");
  }
  const inverseDeterminant = 1 / determinant;
  const [vx, vy, vz] = [direction[0]!, direction[1]!, direction[2]!];
  return [
    ((e * i - f * h) * vx + (c * h - b * i) * vy + (b * f - c * e) * vz) * inverseDeterminant,
    ((f * g - d * i) * vx + (a * i - c * g) * vy + (c * d - a * f) * vz) * inverseDeterminant,
    ((d * h - e * g) * vx + (b * g - a * h) * vy + (a * e - b * d) * vz) * inverseDeterminant,
  ];
}
