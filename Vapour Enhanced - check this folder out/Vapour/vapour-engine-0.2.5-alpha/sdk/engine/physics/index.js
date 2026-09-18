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
export * from './vehicle-3d.js';
export * from './ragdoll-blend.js';
export * from './physics-worker-protocol.js';
export * from './physics-interpolation.js';
export * from './physics-debug.js';
//# sourceMappingURL=index.js.map