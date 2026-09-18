/** Physics interaction: grabbing, carrying, throwing, and doors.
 *
 * Every physics sandbox needs these, every game reimplements them, and almost
 * every implementation gets the same thing wrong: it moves the held object by
 * setting its position directly. That teleports it, so it passes through walls,
 * gains no momentum when released, and can crush the player against geometry.
 *
 * The approach here is to move held objects with **velocity, not position** —
 * a spring toward the hold point, damped and force-limited. That single choice
 * gives correct behaviour for free: the object collides on the way, it arrives
 * with real momentum so throwing works, and a heavy object or one wedged behind
 * geometry simply fails to keep up instead of tunnelling through the world.
 */
import type { PhysicsCommand3d } from "./physics-3d.js";
export type Vec3Tuple = readonly [number, number, number];
export interface GrabOptions {
    /** How strongly the object is pulled toward the hold point. */
    readonly stiffness?: number;
    /** Damping, as a fraction of critical. 1 is critically damped. */
    readonly damping?: number;
    /** Maximum speed the hold may impart, so a grab cannot fling the world. */
    readonly maxSpeed?: number;
    /**
     * Distance beyond which the grab breaks.
     *
     * Without it, an object wedged behind geometry stays "held" forever from
     * across the level, which reads as a bug even though the physics is correct.
     */
    readonly breakDistance?: number;
    /** Angular stiffness for holding an object's orientation. Zero lets it spin. */
    readonly angularStiffness?: number;
}
export interface HeldObject {
    readonly bodyId: number;
    readonly options: Required<GrabOptions>;
    /** Where the object is being held, in world space. */
    holdPoint: Vec3Tuple;
    /** Desired orientation, or `undefined` to let it spin freely. */
    holdRotation: readonly [number, number, number, number] | undefined;
}
export declare const DEFAULT_GRAB_OPTIONS: Required<GrabOptions>;
export interface BodyPose {
    readonly position: Vec3Tuple;
    readonly rotation: readonly [number, number, number, number];
    readonly linearVelocity: Vec3Tuple;
    readonly angularVelocity: Vec3Tuple;
}
export interface GrabResult {
    /** Commands to apply this step. */
    readonly commands: readonly PhysicsCommand3d[];
    /** Grabs that broke because the object could not keep up. */
    readonly broken: readonly number[];
}
/**
 * Holds objects with a damped spring on velocity.
 *
 * One instance per grabbing hand — a player has one or two, a crane has one.
 * Objects are released explicitly or break away on their own.
 */
export declare class GrabController {
    #private;
    get heldBodies(): readonly number[];
    isHeld(bodyId: number): boolean;
    held(bodyId: number): HeldObject | undefined;
    /** Begins holding a body at a point. */
    grab(bodyId: number, holdPoint: Vec3Tuple, options?: GrabOptions): HeldObject;
    /** Moves where a held object is being held, each frame. */
    moveHold(bodyId: number, holdPoint: Vec3Tuple, holdRotation?: readonly [number, number, number, number]): void;
    release(bodyId: number): boolean;
    releaseAll(): void;
    /**
     * Releases a body with an added impulse — a throw.
     *
     * Returned as an impulse rather than a velocity so that mass matters: a
     * thrown crate should travel further than a thrown anvil for the same effort.
     */
    throwObject(bodyId: number, impulse: Vec3Tuple): readonly PhysicsCommand3d[];
    /**
     * Produces this step's hold commands from current body poses.
     *
     * Bodies with no pose are skipped rather than treated as being at the origin,
     * which would yank them across the level on the frame a snapshot is missing.
     */
    update(poses: ReadonlyMap<number, BodyPose>, deltaSeconds: number): GrabResult;
}
export type DoorState = "closed" | "opening" | "open" | "closing";
export interface DoorOptions {
    /** Joint id of the hinge this door swings on. */
    readonly jointId: number;
    /** Angular velocity the motor drives at. */
    readonly speed?: number;
    /** Motor force. Too low and the door cannot push objects out of the way. */
    readonly force?: number;
    /** Seconds the door takes to travel, after which it is considered arrived. */
    readonly travelSeconds?: number;
    /** Close automatically after this many seconds open. */
    readonly autoCloseSeconds?: number;
}
/**
 * A motorised door.
 *
 * Driven by a hinge motor rather than by animation, so the door pushes objects,
 * is blocked by them, and can be held open by a crate — the behaviours that
 * make a physics door worth having over a scripted one.
 */
export declare class PhysicsDoor {
    #private;
    readonly jointId: number;
    constructor(options: DoorOptions);
    get state(): DoorState;
    open(): void;
    close(): void;
    toggle(): void;
    /** Advances the door and returns the motor commands for this step. */
    update(deltaSeconds: number): readonly PhysicsCommand3d[];
}
/**
 * Where a held object should sit, given a viewer.
 *
 * Held in front of the eye at a fixed distance, which is the arrangement that
 * keeps an object visible without letting it clip into the camera.
 */
export declare function holdPointInFront(eye: Vec3Tuple, forward: Vec3Tuple, distance: number): Vec3Tuple;
/** A throw impulse from an aim direction and a strength. */
export declare function throwImpulse(forward: Vec3Tuple, strength: number): Vec3Tuple;
//# sourceMappingURL=interaction.d.ts.map