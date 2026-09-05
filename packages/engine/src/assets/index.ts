/** Assets: the stable-ID database, importers, mesh library, and load progress.
 *
 * Public surface of the `assets` subsystem. Import from `@vapour/engine`;
 * this barrel exists so subsystem boundaries stay explicit inside the package.
 */
export * from "./asset-database.js";
export * from "./gltf-import.js";
export * from "./loading-progress.js";
export * from "./mesh-library.js";
export * from "./project-templates.js";
