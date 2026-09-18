/** `@vapour/math` — the linear algebra, easing, curve, gradient, colour, and
 * geometry primitives shared by every Vapour subsystem.
 *
 * Everything here is plain data on numeric tuples and plain objects, so values
 * serialize into scene JSON, cross the WASM boundary, and transfer to a worker
 * without adapters. Conventions the rest of the engine relies on:
 *
 * - Vectors are `[x, y, z]` tuples; quaternions are `[x, y, z, w]`.
 * - Matrices are column-major flat arrays of 16 numbers, matching WGSL.
 * - The coordinate system is right-handed with `-Z` forward and `+Y` up.
 * - Projections target WebGPU's `[0, 1]` clip-space depth range.
 * - Colours are authored in sRGB and converted to linear before lighting.
 * - Invalid input throws with an actionable message rather than propagating NaN.
 */
export * from "./scalar.js";
export * from "./vec2.js";
export * from "./vec3.js";
export * from "./vec4.js";
export * from "./quat.js";
export * from "./mat4.js";
export * from "./geometry.js";
export * from "./easing.js";
export * from "./curve.js";
export * from "./gradient.js";
export * from "./color.js";
