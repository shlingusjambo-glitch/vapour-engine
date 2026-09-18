import type { PhysicsWorld3dBridge } from './physics-3d.js';
import type { BodyPose } from './interaction.js';
import { type LocomotionWorld3d, type Position3d, type SafeCharacterPosition3dOptions } from './locomotion-3d.js';
export interface ArcadeVehicleController3dOptions {
    /** Centre of the chassis query, not the bottom of the visual mesh. */
    readonly position: Position3d;
    readonly yaw?: number;
    readonly halfExtents?: Position3d;
    readonly wheelbase?: number;
    readonly wheelRadius?: number;
    readonly maxSpeed?: number;
    readonly reverseSpeed?: number;
    readonly acceleration?: number;
    readonly braking?: number;
    readonly drag?: number;
    readonly steeringLimit?: number;
    readonly layer?: number;
    readonly mask?: number;
}
export interface ArcadeVehicleInput3d {
    readonly throttle: number;
    /** Positive turns left, around +Y; zero faces -Z. */
    readonly steer: number;
    readonly brake?: number;
    readonly handbrake?: boolean;
}
export interface ArcadeVehicleState3d {
    readonly position: Position3d;
    readonly yaw: number;
    readonly speed: number;
    readonly steeringAngle: number;
    readonly wheelRotation: number;
    /** Visual load transfer; not simulated suspension forces. */
    readonly bodyRoll: number;
    readonly bodyPitch: number;
    readonly grounded: boolean;
    readonly collisions: readonly number[];
}
/** Experimental kinematic bicycle controller. Translation uses native Rapier
 * sweeps, rotation is clearance tested, and integration uses bounded fixed
 * substeps. It intentionally does not claim tire/rigid-body suspension physics. */
export declare class ArcadeVehicleController3d {
    #private;
    constructor(world: LocomotionWorld3d, options: ArcadeVehicleController3dOptions);
    get state(): ArcadeVehicleState3d;
    teleport(position: Position3d, yaw?: number): void;
    update(dt: number, input: ArcadeVehicleInput3d): ArcadeVehicleState3d;
    findExitPosition(options?: SafeCharacterPosition3dOptions): Position3d | undefined;
}
/** What the vehicle needs from a world: a ray per wheel and a force per wheel. */
export type VehicleWorld3d = Pick<PhysicsWorld3dBridge, 'raycast' | 'addForceAtPoint'>;
export interface WheelSuspension3d {
    /** Suspension length when unloaded, from the attach point to the axle. */
    readonly restLength: number;
    /** Spring constant, N/m. */
    readonly stiffness: number;
    /** Damper, N·s/m. */
    readonly damping: number;
    /** Maximum compression from rest, m. */
    readonly maxTravel: number;
}
export interface WheelDescriptor3d {
    /** Suspension attach point in chassis-local space. */
    readonly position: Position3d;
    readonly radius: number;
    readonly suspension?: Partial<WheelSuspension3d>;
    readonly steering?: boolean;
    readonly driven?: boolean;
    /** Tyre friction coefficient; the force circle radius is `friction × load`. */
    readonly friction?: number;
}
export interface RaycastVehicle3dOptions {
    /** The dynamic chassis body the caller inserted into the world. */
    readonly chassis: number;
    readonly wheels: readonly WheelDescriptor3d[];
    /** Torque per driven wheel at full throttle, N·m. */
    readonly maxEngineTorque?: number;
    /** Torque per wheel at full brake, N·m. */
    readonly maxBrakeTorque?: number;
    /** Steering lock, radians. */
    readonly maxSteeringAngle?: number;
    /** Inner wheel turns tighter than the outer, as a real steering linkage does. */
    readonly ackermann?: boolean;
    /** Wheel spin inertia, kg·m². */
    readonly wheelInertia?: number;
    /** Longitudinal force per unit slip ratio, as a multiple of tyre load. */
    readonly longitudinalStiffness?: number;
    /** Lateral force per radian of slip angle, as a multiple of tyre load. */
    readonly lateralStiffness?: number;
    /** Chassis-local forward; zero steering faces this way. */
    readonly forward?: Position3d;
    readonly up?: Position3d;
    readonly layer?: number;
    readonly mask?: number;
}
export interface RaycastVehicleInput3d {
    /** -1..1; negative drives in reverse. */
    readonly throttle: number;
    /** -1..1; positive turns toward the chassis' left. */
    readonly steer: number;
    /** 0..1, all wheels. */
    readonly brake?: number;
    /** Locks the non-steering wheels. */
    readonly handbrake?: boolean;
}
export interface WheelState3d {
    /** Axle position in world space, for placing the wheel mesh. */
    readonly position: Position3d;
    /** Accumulated spin, radians. */
    readonly spin: number;
    readonly steeringAngle: number;
    readonly compression: number;
    readonly grounded: boolean;
    readonly contactPoint: Position3d;
    readonly contactNormal: Position3d;
    readonly suspensionForce: number;
    readonly slipRatio: number;
    readonly slipAngle: number;
    /** rad/s. */
    readonly angularVelocity: number;
}
export interface RaycastVehicle3dState {
    readonly wheels: readonly WheelState3d[];
    /** Signed speed along the chassis forward axis, m/s. */
    readonly speed: number;
    readonly grounded: boolean;
}
/**
 * A raycast vehicle: one ray per wheel, a spring-damper on each ray, and a
 * slip-based tyre at each contact, all as forces on a dynamic chassis.
 *
 * It owns no body. The caller inserts the chassis, then each fixed step
 * passes that body's snapshot in and lets the vehicle queue forces. That is
 * what keeps it a controller rather than a second physics engine: the solver
 * still decides what happens when the car meets a wall or another car.
 *
 * The tyre model is deliberately a friction circle with linear stiffness in
 * slip ratio and slip angle. It saturates, so a wheel can spin and a car can
 * drift, and it is simple enough to tune by feel.
 */
export declare class RaycastVehicle3d {
    #private;
    constructor(world: VehicleWorld3d, options: RaycastVehicle3dOptions);
    get chassis(): number;
    get state(): RaycastVehicle3dState;
    /** Queues this step's suspension and tyre forces. Call once per fixed step
     * with the chassis snapshot from the previous step, before `world.step`. */
    update(dt: number, input: RaycastVehicleInput3d, chassis: BodyPose): RaycastVehicle3dState;
}
//# sourceMappingURL=vehicle-3d.d.ts.map