/** Resources: loading, reference counting, dependencies, caching, and bundles.
 *
 * The engine's answer to "who owns this, and when is it freed?". Every other
 * subsystem that loads content — scenes, meshes, textures, audio, fonts,
 * generated assets — is expected to go through the resource manager rather than
 * keeping its own cache, so that a long-running session has one place that can
 * account for memory and one place that can free it.
 */
export * from "./handle.js";
export * from "./resource-manager.js";
export * from "./bundle.js";
