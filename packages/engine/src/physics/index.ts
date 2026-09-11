/** Physics: 2D and 3D Rust-backed simulation and its scene integration.
 *
 * Public surface of the `physics` subsystem. Import from `@vapour/engine`;
 * this barrel exists so subsystem boundaries stay explicit inside the package.
 */
export * from "./physics-2d.js";
export * from "./physics-3d.js";
export * from "./interaction.js";
export * from "./scene-physics.js";
export * from "./voxel-physics.js";
export { ThirdPersonMotor3d, findSafeCharacterPosition3d } from './locomotion-3d.js';
export type { LocomotionWorld3d, Position3d, ThirdPersonMotor3dOptions, ThirdPersonMotor3dInput, ThirdPersonMotor3dState, SafeCharacterPosition3dOptions } from './locomotion-3d.js';
export * from './vehicle-3d.js';
