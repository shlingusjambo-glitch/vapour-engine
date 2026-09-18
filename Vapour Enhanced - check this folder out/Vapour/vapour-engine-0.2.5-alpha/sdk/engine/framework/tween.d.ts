/** Tweening on the simulation clock.
 *
 * Animating a number over time is one of the things every game reimplements,
 * usually with `setInterval` and a hand-rolled ease. Tweens here run on the
 * same explicitly advanced clock as {@link Scheduler}, so they pause when the
 * game pauses, slow down in slow motion, and reproduce exactly under a replay.
 *
 * Values are interpolated component-wise, so the same tween drives a number, a
 * position, a colour, or any fixed-length numeric tuple.
 */
import { type EasingName } from "@vapour/math";
export type TweenValue = number | readonly number[];
export type TweenLoopMode = "once" | "loop" | "pingPong";
export interface TweenOptions<T extends TweenValue> {
    readonly from: T;
    readonly to: T;
    readonly durationSeconds: number;
    readonly easing?: EasingName;
    /** Simulation seconds to wait before the first update. */
    readonly delaySeconds?: number;
    readonly loop?: TweenLoopMode;
    readonly onUpdate: (value: T) => void;
    readonly onComplete?: () => void;
}
export type TweenState = "delayed" | "running" | "completed" | "cancelled";
export interface TweenHandle {
    readonly state: TweenState;
    /** Progress in `[0, 1]` before easing. */
    readonly progress: number;
    cancel(): void;
    /** Jumps to the end, invoking `onUpdate` and `onComplete` once. */
    complete(): void;
}
/**
 * Runs tweens against an explicitly advanced clock.
 *
 * One `TweenRunner` per timeline is the usual arrangement: gameplay tweens on
 * the paused-with-the-game clock, UI tweens on an unpaused one, so a menu still
 * animates while the world is frozen.
 */
export declare class TweenRunner {
    #private;
    get count(): number;
    /** Starts a tween. It does not update until the first {@link advance}, so a
     * caller that wants the start value applied immediately should set it. */
    to<T extends TweenValue>(options: TweenOptions<T>): TweenHandle;
    advance(deltaSeconds: number): void;
    /** Cancels every tween without invoking `onComplete`. */
    clear(): void;
}
//# sourceMappingURL=tween.d.ts.map