/** Animation: clips, poses, blending, layers, and state machines.
 *
 * Clips target bones **by name**, not by index. That single choice is what lets
 * one walk cycle play on every character the asset system generates, and what
 * makes retargeting between skeletons possible at all.
 *
 * Time is explicit throughout: the game calls `update(deltaSeconds)`, so
 * animation pauses with the game, follows slow motion, and reproduces exactly
 * in a replay or on a server tick.
 */
export * from "./clip.js";
export * from "./animator.js";
export * from "./blend-tree.js";
export * from "./skinning.js";
export * from "./ik.js";
export * from "./retarget.js";
