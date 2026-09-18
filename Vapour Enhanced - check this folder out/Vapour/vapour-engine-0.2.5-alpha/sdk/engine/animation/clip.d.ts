/** Animation clips: sampled channels of transform data over time.
 *
 * A clip is plain data — a list of channels, each a list of keyframes — so it
 * serializes into scene JSON, imports from glTF without translation, and can be
 * generated procedurally by the asset system. Nothing here knows about a
 * skeleton: a clip targets bones *by name*, which is what lets one walk cycle
 * play on every character the generator produces.
 *
 * That indirection is the whole retargeting story. A clip bound to bone indices
 * only works on the exact skeleton it was authored against; a clip bound to
 * names works on anything following the same convention.
 */
import { type Quat, type Vec3 } from "@vapour/math";
export type ChannelProperty = "position" | "rotation" | "scale";
/** How values between keyframes are produced. */
export type Interpolation = "linear" | "step" | "cubic";
export interface Keyframe {
    readonly time: number;
    /** Three components for position and scale, four for rotation. */
    readonly value: readonly number[];
}
export interface AnimationChannel {
    /** Bone name this channel drives. */
    readonly target: string;
    readonly property: ChannelProperty;
    readonly keyframes: readonly Keyframe[];
    readonly interpolation?: Interpolation;
}
export type LoopMode = "once" | "loop" | "pingPong";
export interface AnimationClip {
    readonly name: string;
    /** Length in seconds. Sampling past it follows the loop mode. */
    readonly duration: number;
    readonly channels: readonly AnimationChannel[];
    readonly loop?: LoopMode;
}
/** One bone's sampled transform. Absent properties keep the rest pose. */
export interface BonePose {
    position?: Vec3;
    rotation?: Quat;
    scale?: Vec3;
}
/** A sampled pose: bone name to transform. */
export type Pose = Map<string, BonePose>;
export declare function validateClip(clip: AnimationClip): AnimationClip;
/** Maps a time onto the clip's duration according to its loop mode. */
export declare function wrapClipTime(clip: AnimationClip, time: number): number;
/** Samples one channel at a time already wrapped into the clip's range. */
export declare function sampleChannel(channel: AnimationChannel, time: number): number[];
/** Samples every channel into a pose. */
export declare function samplePose(clip: AnimationClip, time: number, into?: Pose): Pose;
/**
 * Blends two poses.
 *
 * Bones present in only one pose are taken from it unchanged rather than
 * blended toward a default — blending a bone against an implicit identity is
 * how a partially-authored clip yanks a character's arms to its sides.
 */
export declare function blendPoses(a: Pose, b: Pose, weight: number, into?: Pose): Pose;
/**
 * Restricts a pose to a set of bones.
 *
 * Masks are what make layers useful: an "aim" layer masked to the spine and
 * arms plays over a walk cycle without disturbing the legs.
 */
export declare function maskPose(pose: Pose, allowed: ReadonlySet<string>, into?: Pose): Pose;
/** A clip built from a single pose, useful as a default or a rest state. */
export declare function poseClip(name: string, pose: Pose, duration?: number): AnimationClip;
/** Bones a clip drives, for building masks and for validation. */
export declare function clipTargets(clip: AnimationClip): readonly string[];
/**
 * Bones a clip targets that a skeleton does not provide.
 *
 * Reported rather than ignored: a clip silently doing nothing because its bone
 * names do not match is one of the hardest animation bugs to notice.
 */
export declare function missingTargets(clip: AnimationClip, boneNames: Iterable<string>): readonly string[];
//# sourceMappingURL=clip.d.ts.map