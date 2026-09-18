/** XR interaction: rays, direct grab, two-handed manipulation, and locomotion.
 *
 * The brief's requirement is that game developers should not have to build
 * standard VR interaction themselves — and the reason that matters is that the
 * standard behaviours are subtle. Ray-pointing that jitters, a grab that
 * teleports objects, a snap turn with no blink, and smooth locomotion that
 * ignores head orientation are not stylistic choices; they are the difference
 * between a comfortable experience and one that makes people ill.
 *
 * Everything here is pure state and maths over injected poses, so it runs and
 * is tested without a headset. The parts that genuinely need hardware — stereo
 * presentation, foveation — are not here and are not claimed.
 */
import type { XrHand, XrVector3 } from "./xr-locomotion.js";
export interface XrPose {
    readonly position: XrVector3;
    /** Forward direction, unit length. */
    readonly forward: XrVector3;
    readonly up?: XrVector3;
}
export interface RayTarget {
    readonly id: string;
    /** Centre of the target's bounding sphere. */
    readonly position: XrVector3;
    readonly radius: number;
    /** Higher wins when two targets are equally close along the ray. */
    readonly priority?: number;
}
export interface RayHit {
    readonly id: string;
    readonly distance: number;
    readonly point: XrVector3;
}
export interface RayOptions {
    readonly maxDistance?: number;
    /**
     * Widens the ray into a cone, in radians at one metre.
     *
     * A mathematically thin ray is unusable in VR: hand tremor is roughly a
     * degree, so a thin ray flickers between targets and off them entirely. Every
     * shipped VR interface widens it.
     */
    readonly softness?: number;
}
/**
 * The nearest target a ray hits.
 *
 * Targets are spheres rather than meshes deliberately: a pointer needs to be
 * forgiving, and precise mesh intersection makes small controls almost
 * impossible to hit with a tremoring hand.
 */
export declare function raycastTargets(pose: XrPose, targets: readonly RayTarget[], options?: RayOptions): RayHit | undefined;
export interface XrGrabbable {
    readonly id: string;
    readonly position: XrVector3;
    /** Distance within which a direct grab connects. */
    readonly radius: number;
}
export type GrabMode = "direct" | "ray";
export interface XrGrabState {
    readonly id: string;
    readonly hand: XrHand;
    readonly mode: GrabMode;
    /** Offset from the hand to the object when the grab began. */
    readonly offset: XrVector3;
    /** Distance along the ray at grab time, for ray grabs. */
    readonly rayDistance: number;
}
export interface TwoHandedTransform {
    readonly position: XrVector3;
    /** Scale relative to when the second hand joined. */
    readonly scale: number;
    /** Rotation about the up axis, in radians, since the second hand joined. */
    readonly yaw: number;
}
/**
 * Grabbing with one or two hands.
 *
 * Two-handed manipulation is included because it is the natural way to scale
 * and rotate an object in VR — pulling your hands apart to make something
 * bigger is a gesture people try unprompted — and because retrofitting it means
 * changing how single-handed grabs store their offsets.
 */
export declare class XrGrabController {
    #private;
    get held(): readonly XrGrabState[];
    heldBy(hand: XrHand): XrGrabState | undefined;
    isHeld(id: string): boolean;
    /** True when both hands hold the same object. */
    get twoHanded(): boolean;
    /** Grabs whatever is within reach of the hand, if anything. */
    grabDirect(hand: XrHand, pose: XrPose, grabbables: readonly XrGrabbable[]): XrGrabState | undefined;
    /** Grabs the target a ray is pointing at, keeping it at its current distance. */
    grabByRay(hand: XrHand, pose: XrPose, targets: readonly RayTarget[], options?: RayOptions): XrGrabState | undefined;
    release(hand: XrHand): string | undefined;
    releaseAll(): void;
    /**
     * Where a held object should be this frame.
     *
     * Returns a position rather than moving anything, so the caller decides
     * whether to snap it there (a UI panel) or drive it with physics (a crate).
     */
    resolve(hand: XrHand, pose: XrPose): XrVector3 | undefined;
    /**
     * The transform two hands imply for the object they both hold.
     *
     * Position is the midpoint, scale is the change in separation, and yaw is the
     * change in the angle between them — the three degrees of freedom people
     * actually use two hands for.
     */
    resolveTwoHanded(left: XrPose, right: XrPose): TwoHandedTransform | undefined;
}
export type TurnStyle = "snap" | "smooth";
export interface LocomotionOptions {
    readonly turnStyle?: TurnStyle;
    /** Degrees per snap turn. */
    readonly snapDegrees?: number;
    /** Degrees per second when turning smoothly. */
    readonly smoothTurnSpeed?: number;
    readonly moveSpeed?: number;
    /** Move relative to the head, or to the controller. */
    readonly moveReference?: "head" | "hand";
    /** Seconds of blink at each end of a teleport or snap turn. */
    readonly comfortFadeSeconds?: number;
    readonly deadZone?: number;
}
export interface LocomotionInput {
    /** Movement stick, `[-1, 1]`. */
    readonly moveX?: number;
    readonly moveY?: number;
    /** Turn stick, `[-1, 1]`. */
    readonly turnX?: number;
}
export interface LocomotionResult {
    readonly position: XrVector3;
    /** Player yaw in radians. */
    readonly yaw: number;
    /** How much of the comfort fade is applied, in `[0, 1]`. */
    readonly fade: number;
    readonly turned: boolean;
}
/**
 * Smooth and snap locomotion with comfort fades.
 *
 * Snap turning is the default because smooth turning is the single most common
 * cause of simulator sickness, and the snap's brief fade is what keeps even the
 * snap comfortable. Games that want smooth turning should offer both — this
 * exposes the choice rather than picking for the player.
 */
export declare class XrLocomotion {
    #private;
    constructor(options?: LocomotionOptions);
    get position(): XrVector3;
    get yaw(): number;
    /** Fade opacity in `[0, 1]`, for the comfort blink. */
    get fade(): number;
    setPosition(position: XrVector3): void;
    /** Queues a teleport, which takes effect at the midpoint of the fade. */
    teleport(destination: XrVector3): void;
    update(input: LocomotionInput, headForward: XrVector3, deltaSeconds: number): LocomotionResult;
}
export interface TeleportArc {
    /** Sampled points along the arc, for drawing it. */
    readonly points: readonly XrVector3[];
    /** Where it lands, or `undefined` when nothing valid was hit. */
    readonly destination: XrVector3 | undefined;
    readonly valid: boolean;
}
export interface TeleportArcOptions {
    readonly speed?: number;
    readonly gravity?: number;
    readonly steps?: number;
    readonly maxTime?: number;
}
/**
 * A ballistic teleport arc.
 *
 * An arc rather than a straight ray because it lets a player aim at the floor
 * without pointing straight down, and because its landing point is visible
 * before committing — which is what makes teleport comfortable in the first
 * place. Validity is decided by an injected predicate, so a navmesh, a physics
 * raycast, or a simple height test all work.
 */
export declare function teleportArc(pose: XrPose, isValidLanding: (point: XrVector3) => boolean, groundHeightAt: (x: number, z: number) => number | undefined, options?: TeleportArcOptions): TeleportArc;
//# sourceMappingURL=interaction.d.ts.map