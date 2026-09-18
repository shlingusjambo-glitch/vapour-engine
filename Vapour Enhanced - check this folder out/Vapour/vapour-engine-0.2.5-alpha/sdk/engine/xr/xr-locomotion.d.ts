import type { CharacterController3dOptions, CharacterMovement3d, PhysicsWorld3dBridge } from "../physics/physics-3d.js";
export type XrVector3 = readonly [number, number, number];
export type XrHand = "left" | "right";
export interface XrTrackedHand {
    readonly hand: XrHand;
    readonly position: XrVector3;
    readonly tracked: boolean;
}
export interface XrHandContact {
    readonly touching: boolean;
    readonly point?: XrVector3;
    readonly normal?: XrVector3;
    readonly bodyId?: number;
}
export interface XrResolvedHandContact extends XrHandContact {
    readonly touching: true;
    /** Collision-constrained sphere center for the tracked hand follower. */
    readonly constrainedPosition: XrVector3;
    readonly slip: number;
}
export interface XrHandCollisionOptions {
    readonly layer?: number;
    readonly mask?: number;
    readonly includeSensors?: boolean;
    /** Shrinks the first sweep slightly to avoid starting-contact ambiguity. */
    readonly precision?: number;
    readonly defaultSingleHandSlip?: number;
    readonly defaultBracedSlip?: number;
    /** Allows authored materials to control ice, rock, bark, or climbing grip. */
    readonly surfaceSlip?: (bodyId: number) => number | undefined;
}
/** Swept-sphere contact resolver with projected surface sliding and an
 * anti-tunneling ray fallback. It is intentionally a physics query utility,
 * not a game-specific player controller. */
export declare class XrHandCollisionResolver {
    #private;
    constructor(physics: PhysicsWorld3dBridge, options?: XrHandCollisionOptions);
    resolve(start: XrVector3, movement: XrVector3, radius: number, singleHand?: boolean): XrResolvedHandContact | undefined;
    /** A hand can unstick only when it exceeded the threshold and the direct
     * head-to-hand corridor is clear. */
    shouldUnstick(head: XrVector3, hand: XrVector3, constrained: XrVector3, radius: number, distance?: number): boolean;
}
export interface XrArmLocomotionSample {
    readonly deltaSeconds: number;
    readonly headPosition: XrVector3;
    readonly hands: readonly XrTrackedHand[];
    readonly contacts: Readonly<Partial<Record<XrHand, XrHandContact>>>;
}
export interface XrArmLocomotionConfig {
    /** Largest legal hand distance from the head. Longer tracking jumps are
     * clamped, preventing lost tracking from launching the player. */
    readonly maxArmLength?: number;
    /** Maximum player translation produced during one simulation second. */
    readonly maxSpeed?: number;
    /** Velocity-history window used for release impulses. */
    readonly velocitySamples?: number;
    /** Multiplier applied to the filtered release velocity. */
    readonly launchMultiplier?: number;
    /** Maximum launch velocity after filtering. */
    readonly maxLaunchSpeed?: number;
    /** Downward acceleration when neither hand supports the player. */
    readonly gravity?: number;
}
export interface XrArmLocomotionResult {
    readonly translation: XrVector3;
    readonly velocity: XrVector3;
    readonly launchVelocity: XrVector3;
    readonly supportedHands: readonly XrHand[];
}
/** Deterministic, allocation-light arm locomotion solver for climbing and
 * hand-propelled movement. Collision detection stays in the physics engine;
 * games provide its current contact results. This keeps movement reusable for
 * climbing, zero-G pushing, accessibility variants, and Gorilla-style games. */
export declare class XrArmLocomotionSolver {
    #private;
    constructor(config?: XrArmLocomotionConfig);
    reset(): void;
    sample(value: XrArmLocomotionSample): XrArmLocomotionResult;
}
export interface XrPhysicsRigOptions {
    readonly character: CharacterController3dOptions;
    readonly rotation?: readonly [number, number, number, number];
}
/** Applies XR locomotion output through Vapour's native character controller,
 * retaining slope, autostep, filtering, and collision behavior. */
export declare class XrPhysicsRig {
    #private;
    constructor(physics: PhysicsWorld3dBridge, position: XrVector3, options: XrPhysicsRigOptions);
    get position(): XrVector3;
    get velocity(): XrVector3;
    move(deltaSeconds: number, locomotion: XrArmLocomotionResult): CharacterMovement3d;
    teleport(position: XrVector3): void;
}
//# sourceMappingURL=xr-locomotion.d.ts.map