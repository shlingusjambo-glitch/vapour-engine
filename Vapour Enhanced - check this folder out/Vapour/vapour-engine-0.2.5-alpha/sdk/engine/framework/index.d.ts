/** Game framework utilities.
 *
 * The systems every real game eventually writes for itself: signals, timers,
 * coroutines, tweens, pools, and the tag/layer/group classification that
 * physics, rendering, and gameplay queries all filter on.
 *
 * Two conventions run through the whole subsystem:
 *
 * - **Time is explicit.** Nothing here uses `setTimeout` or `performance.now`.
 *   Timers, coroutines, and tweens are advanced by the caller, so they pause
 *   when the game pauses, follow slow motion, and reproduce exactly under a
 *   replay or a server tick.
 * - **Mistakes throw.** Releasing a pooled object twice, using an undefined
 *   layer, or tweening mismatched value shapes reports the problem at the call
 *   site instead of corrupting state that surfaces somewhere else.
 */
export * from "./signal.js";
export * from "./scheduler.js";
export * from "./tween.js";
export * from "./pool.js";
export * from "./tags.js";
export * from "./storage.js";
export * from "./settings.js";
export * from "./localization.js";
export * from "./save.js";
export * from "./application.js";
//# sourceMappingURL=index.d.ts.map