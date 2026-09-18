/** Playback, blending, layers, and state machines.
 *
 * The animator sits between "a clip exists" and "a character moves". Its job is
 * almost entirely about *transitions*: nobody notices a clip playing correctly,
 * and everybody notices a character snapping between two of them.
 *
 * Three decisions shape it:
 *
 * - **Time is explicit.** `update(deltaSeconds)` is called by the game, so
 *   animation pauses with the game, follows slow motion, and reproduces exactly
 *   in a replay or on a server tick.
 * - **Layers are additive in structure, not in maths.** Each layer produces a
 *   full pose and is blended over the one below by weight and mask, which is
 *   simpler to reason about than additive-difference blending and covers the
 *   cases games actually use — an aim pose over a locomotion base.
 * - **State machines drive parameters, not clips directly.** A transition fires
 *   on a condition over named parameters, so gameplay sets `speed` and `
 *   grounded` and never touches a clip name.
 */
import { type AnimationClip, type Pose } from "./clip.js";
import { type BlendTree } from "./blend-tree.js";
export interface AnimatorLayerOptions {
    readonly name: string;
    /** Blend weight over the layers below. The base layer is always 1. */
    readonly weight?: number;
    /** Bones this layer may affect. Omit to affect all of them. */
    readonly mask?: Iterable<string>;
}
/** One layer of animation: a current clip, optionally fading from a previous. */
export declare class AnimatorLayer {
    #private;
    readonly name: string;
    weight: number;
    constructor(options: AnimatorLayerOptions);
    get currentClip(): AnimationClip | undefined;
    get isFading(): boolean;
    /** Fraction of the current clip elapsed, in `[0, 1]` for a non-looping clip. */
    get normalizedTime(): number;
    setMask(bones: Iterable<string> | undefined): void;
    /**
     * Plays a clip, optionally crossfading from the current one.
     *
     * Playing the clip already playing is a no-op rather than a restart, because
     * gameplay code calls `play("walk")` every frame while walking and restarting
     * on each call is the classic way to make a character twitch.
     */
    play(clip: AnimationClip, options?: {
        fadeSeconds?: number;
        speed?: number;
        restart?: boolean;
    }): void;
    stop(): void;
    /** @internal Advances clip times. */
    advance(deltaSeconds: number): void;
    /** @internal Produces this layer's pose, masked. */
    evaluate(into: Pose, scratch: Pose): Pose | undefined;
}
export type ParameterValue = number | boolean;
export interface TransitionCondition {
    readonly parameter: string;
    readonly operator: "==" | "!=" | ">" | ">=" | "<" | "<=";
    readonly value: ParameterValue;
}
export interface StateTransition {
    readonly to: string;
    readonly conditions: readonly TransitionCondition[];
    readonly fadeSeconds?: number;
    /** Require the current clip to finish before transitioning. */
    readonly waitForExit?: boolean;
}
export interface AnimatorState {
    readonly name: string;
    /** A state contains exactly one clip or blend tree. */
    readonly clip?: AnimationClip;
    readonly blendTree?: BlendTree;
    readonly speed?: number;
    readonly transitions?: readonly StateTransition[];
}
export interface AnimatorStateMachineOptions {
    readonly states: readonly AnimatorState[];
    readonly initial: string;
    /** Transitions checked from every state, for interrupts like "die". */
    readonly anyStateTransitions?: readonly StateTransition[];
}
export interface AnimationEvent {
    readonly clip: string;
    readonly name: string;
    readonly time: number;
}
export interface AnimatorStats {
    readonly layers: number;
    readonly state: string | undefined;
    readonly transitions: number;
    readonly elapsedSeconds: number;
}
/**
 * Drives layers, and optionally a state machine over them.
 *
 * The base layer is created automatically, because every animator has one and
 * requiring it to be added is friction with no upside.
 */
export declare class Animator {
    #private;
    constructor();
    get base(): AnimatorLayer;
    get layers(): readonly AnimatorLayer[];
    get state(): string | undefined;
    layer(name: string): AnimatorLayer;
    addLayer(options: AnimatorLayerOptions): AnimatorLayer;
    /** Convenience for the common case of playing on the base layer. */
    play(clip: AnimationClip, options?: {
        fadeSeconds?: number;
        speed?: number;
        restart?: boolean;
    }): void;
    setParameter(name: string, value: ParameterValue): void;
    getParameter(name: string): ParameterValue | undefined;
    /** Installs a state machine and enters its initial state. */
    setStateMachine(machine: AnimatorStateMachineOptions): void;
    /** Advances time, evaluates transitions, and produces the final pose. */
    update(deltaSeconds: number): Pose;
    /** The pose produced by the last update, without advancing time. */
    pose(): Pose;
    /** Events raised since the last call, clearing them. */
    drainEvents(): readonly AnimationEvent[];
    stats(): AnimatorStats;
}
//# sourceMappingURL=animator.d.ts.map