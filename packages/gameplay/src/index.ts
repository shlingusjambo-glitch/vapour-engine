/** `@vapour/gameplay` — the gameplay framework layered on the engine core.
 *
 * These systems are *game* concerns rather than engine-runtime concerns:
 * inventories, crafting recipes, health and damage, status effects, and
 * branching narrative. They are deliberately independent of the renderer, the
 * scene graph, and the WASM boundary — each one is pure data plus deterministic
 * transitions, so it can be unit tested, run on a server with no display, and
 * replicated across a network without dragging the runtime along with it.
 *
 * Every symbol here is also re-exported from `@vapour/engine` so that projects
 * written before Mirage keep working unchanged.
 */
export * from "./combat.js";
export * from "./crafting.js";
export * from "./inventory.js";
export * from "./narrative.js";
export * from "./status-effects.js";
export * from "./open-world.js";
