/** Integration: glue that proves separately-tested subsystems compose.
 *
 * Each module here joins two real subsystem APIs — networking and animation,
 * XR and ownership, navigation and locomotion, streaming and navmeshes — and
 * documents which side wins when they disagree. Nothing here is a new system:
 * if a module grows its own simulation it belongs in a subsystem directory.
 *
 * `@vapour/engine` depends on neither `@vapour/net` nor `@vapour/assetgen`, so
 * their types are matched structurally (same field names as the real types)
 * and their functions are injected where behaviour is needed.
 */
export * from "./networked-character.js";
export * from "./networked-grab.js";
export * from "./nav-locomotion.js";
export * from "./generated-assets.js";
export * from "./streaming-navmesh.js";
export * from "./audio-follow.js";
//# sourceMappingURL=index.js.map