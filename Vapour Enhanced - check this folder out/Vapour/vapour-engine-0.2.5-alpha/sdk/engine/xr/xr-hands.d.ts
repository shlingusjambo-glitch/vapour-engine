/** Hand-pose recognition and queued haptics.
 *
 * A tracked hand is 25 joints and no meaning. Games want "is the player
 * pinching" and "is that a fist", and want the answer not to flicker when a
 * fingertip hovers on the threshold. Recognition here is deliberately simple —
 * distances and curl ratios over the WebXR joint set — with per-pose
 * *hysteresis*: a pose engages at one threshold and releases at a looser one,
 * so a hand that is 51% then 49% pinched reads as one steady pinch.
 *
 * Haptics are queued rather than fired because gameplay code pulses from
 * collision callbacks and animation events that do not know about each other.
 * A queue with a per-hand cap coalesces them into something a controller can
 * actually play and lets a device with no actuator no-op without every caller
 * checking.
 */
import type { XrHandedness, XrInputSnapshot, XrJointSnapshot } from "./xr.js";
export type XrHandPose = "open" | "fist" | "pinch" | "point";
export interface HandPoseThresholds {
    /** Thumb-tip to index-tip distance, metres, at which a pinch engages. */
    readonly pinchEngage?: number;
    /** Distance at which an engaged pinch releases. Must be ≥ `pinchEngage`. */
    readonly pinchRelease?: number;
    /** Average finger curl (0 straight … 1 fully curled) at which a fist engages. */
    readonly fistEngage?: number;
    readonly fistRelease?: number;
    /** Curl below which a finger counts as extended for `point` and `open`. */
    readonly extendedCurl?: number;
}
export interface HandPoseState {
    readonly hand: XrHandedness;
    readonly pose: XrHandPose | undefined;
    readonly pinchDistance: number | undefined;
    /** Per-finger curl: thumb, index, middle, ring, little. */
    readonly curl: readonly [number, number, number, number, number];
    readonly tracked: boolean;
}
declare const FINGERS: readonly ["thumb", "index-finger", "middle-finger", "ring-finger", "pinky-finger"];
/**
 * Curl of one finger in `[0, 1]`: 0 when the tip is as far from the wrist as
 * the finger is long, 1 when the tip has folded back to the base joint.
 */
export declare function fingerCurl(joints: ReadonlyMap<string, XrJointSnapshot>, finger: (typeof FINGERS)[number]): number | undefined;
/** Recognises poses per hand with hysteresis across frames. */
export declare class HandPoseRecognizer {
    #private;
    constructor(thresholds?: HandPoseThresholds);
    /** Current pose for a hand, or undefined when nothing is engaged. */
    pose(hand: XrHandedness): XrHandPose | undefined;
    update(input: XrInputSnapshot): HandPoseState;
}
/** A queued pulse for one hand. */
export interface HapticPulse {
    readonly hand: Exclude<XrHandedness, "none">;
    readonly intensity: number;
    readonly durationMs: number;
}
/** The pulse sink: the session manager's `pulse`, or anything shaped like it. */
export type HapticActuator = (hand: Exclude<XrHandedness, "none">, intensity: number, durationMs: number) => Promise<boolean>;
export interface HapticsStats {
    readonly queued: number;
    readonly played: number;
    readonly dropped: number;
    /** Pulses the device reported it could not play. */
    readonly unsupported: number;
}
/**
 * Queues pulses per hand and plays them through an actuator.
 *
 * Pulses queued in the same frame for the same hand are merged into one whose
 * intensity is the maximum and duration the longest — a controller cannot
 * play two overlapping rumbles, and the strongest one is what the player
 * should feel.
 */
export declare class XrHaptics {
    #private;
    constructor(actuator: HapticActuator, options?: {
        readonly maxPerHand?: number;
    });
    pulse(hand: HapticPulse["hand"], intensity: number, durationMs: number): void;
    /** Plays one merged pulse per hand and clears the queue. Never throws for an unsupported device. */
    flush(): Promise<void>;
    stats(): HapticsStats;
}
export {};
//# sourceMappingURL=xr-hands.d.ts.map