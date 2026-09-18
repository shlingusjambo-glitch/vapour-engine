/** Vapour Engine public API.
 *
 * Every symbol the engine exposes is re-exported here. The engine is organised
 * internally into subsystem directories (see `src/<subsystem>/index.ts`); this
 * barrel is the single stable import path for games, the editor, and tools, and
 * it is kept exhaustive so that reorganising internals never breaks a project.
 */
export * from "./core/index.js";
export * from "./render/index.js";
export * from "./resources/index.js";
export * from "./scene/index.js";
export * from "./framework/index.js";
export * from "./diagnostics/index.js";
export * from "./animation/index.js";
export * from "./http/index.js";
export * from "./particles/index.js";
export * from "./tilemap/index.js";
export * from "./text/index.js";
export * from "./assets/index.js";
export * from "./physics/index.js";
export * from "./voxel/index.js";
export * from "./world/index.js";
export * from "./audio/index.js";
export * from "./input/index.js";
export * from "./ui/index.js";
export * from "./ai/index.js";
export * from "./net/index.js";
export * from "./xr/index.js";
export * from "./scripting/index.js";
export * from "./integration/index.js";
// Gameplay moved to `@vapour/gameplay` in Alpha 0.2.5. Re-exported here so
// projects written against `@vapour/engine` keep working unchanged.
export * from "@vapour/gameplay";
export * from "./persistence/index.js";
//# sourceMappingURL=index.js.map