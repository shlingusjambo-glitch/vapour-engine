/** Networking: transports and the low-level session layer.
 *
 * Public surface of the `net` subsystem. Import from `@vapour/engine`;
 * this barrel exists so subsystem boundaries stay explicit inside the package.
 *
 * Authoritative replication lives in `@vapour/net`; `scene-sync` is the typed
 * adapter that drives this package's `SceneManager` from that client's scene
 * requests without either package importing the other.
 */
export * from "./networking.js";
export * from "./scene-sync.js";
//# sourceMappingURL=index.js.map