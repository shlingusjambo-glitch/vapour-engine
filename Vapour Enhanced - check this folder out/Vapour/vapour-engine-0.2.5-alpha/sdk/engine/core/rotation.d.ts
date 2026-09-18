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
export declare function quaternionFromEuler(euler: EulerDegrees): Quaternion;
export declare function eulerFromQuaternion(quaternion: readonly number[]): EulerDegrees;
export declare function normalizeQuaternion(value: readonly number[]): Quaternion;
/** Rounds display angles so editing a value does not accumulate float noise. */
export declare function roundAngle(value: number, decimals?: number): number;
/** Hamilton product: applies `b` first, then `a`. */
export declare function multiplyQuaternions(a: readonly number[], b: readonly number[]): Quaternion;
/** Inverse of a unit quaternion, which is simply its conjugate. */
export declare function invertQuaternion(value: readonly number[]): Quaternion;
export declare function quaternionFromAxisAngle(axis: readonly number[], radians: number): Quaternion;
export declare function rotateVector(quaternion: readonly number[], vector: readonly number[]): [number, number, number];
/**
 * Extracts the rotation from a column-major transform by orthonormalizing its
 * basis. Non-uniform scale and shear are discarded, which is what a gizmo
 * wants: it needs the frame's orientation, not its stretch.
 */
export declare function quaternionFromMatrix(matrix: readonly number[]): Quaternion;
/** Inverse of a transform's linear part applied to a direction. Gizmos drag in
 * world space but transforms are stored in parent space, so world deltas must
 * come back through the parent's basis. */
export declare function inverseTransformDirection(matrix: readonly number[], direction: readonly number[]): [number, number, number];
//# sourceMappingURL=rotation.d.ts.map