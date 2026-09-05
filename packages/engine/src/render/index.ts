/** Rendering: presentation hosts, scene extraction, cameras, lights, and 2D renderers.
 *
 * Public surface of the `render` subsystem. Import from `@vapour/engine`;
 * this barrel exists so subsystem boundaries stay explicit inside the package.
 */
export * from "./host/index.js";
export * from "./headless-render-host.js";
export * from "./render-world.js";
export * from "./incremental-render-world.js";
export * from "./culling.js";
export * from "./lod.js";
export * from "./shadows.js";
export * from "./render-layers.js";
export * from "./lights.js";
export * from "./environment.js";
export * from "./projection.js";
export * from "./picking.js";
export * from "./editor-camera.js";
export * from "./sprite-2d.js";
export * from "./ui-renderer-2d.js";
