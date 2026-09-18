import type { PhysicsWorld3dBridge } from "./physics-3d.js";
/** Query surface shared with the native Rapier bridge and headless fixtures. */
export type LocomotionWorld3d = Pick<PhysicsWorld3dBridge, "moveCharacter" | "overlapShape" | "raycast">;
export type Position3d = readonly [number, number, number];
export interface ThirdPersonMotor3dOptions {
    /** Feet in world metres. Rendering can use this position without a capsule offset. */
    readonly position: Position3d;
    readonly yaw?: number;
    readonly height?: number;
    readonly radius?: number;
    readonly speed?: number;
    readonly sprintSpeed?: number;
    readonly acceleration?: number;
    readonly deceleration?: number;
    readonly gravity?: number;
    readonly jumpSpeed?: number;
    readonly turnSpeed?: number;
    readonly coyoteSeconds?: number;
    readonly jumpBufferSeconds?: number;
    readonly stepHeight?: number;
    readonly layer?: number;
    readonly mask?: number;
}
export interface ThirdPersonMotor3dInput {
    /** World X/Z direction; magnitude is clamped to one to avoid diagonal boosts. */
    readonly move: readonly [number, number];
    readonly sprint?: boolean;
    /** Held button state. Only its rising edge requests a jump. */
    readonly jump?: boolean;
}
export interface ThirdPersonMotor3dState {
    readonly position: Position3d;
    readonly velocity: Position3d;
    /** Radians, with zero facing -Z. */
    readonly yaw: number;
    readonly grounded: boolean;
    readonly collisions: readonly number[];
}
/** Accelerated, swept capsule locomotion over Vapour's native character query.
 * This is a query shape, not a second rigid body. Call from fixedUpdate after
 * flushing world edits; adding an overlapping collider would collide with self.
 */
export declare class ThirdPersonMotor3d {
    #private;
    constructor(world: LocomotionWorld3d, options: ThirdPersonMotor3dOptions);
    get state(): ThirdPersonMotor3dState;
    /** Teleport only to a validated spawn/exit. Clears momentum and jump history. */
    teleport(position: Position3d, yaw?: number): void;
    update(deltaSeconds: number, input: ThirdPersonMotor3dInput): ThirdPersonMotor3dState;
}
export interface SafeCharacterPosition3dOptions {
    readonly height?: number;
    readonly radius?: number;
    readonly maxRise?: number;
    readonly maxDrop?: number;
    readonly layer?: number;
    readonly mask?: number;
}
/** Finds solid, sufficiently flat ground and full capsule clearance. Returns
 * feet; undefined leaves the character in its current safe state. */
export declare function findSafeCharacterPosition3d(world: Pick<LocomotionWorld3d, "raycast" | "overlapShape">, candidate: Position3d, options?: SafeCharacterPosition3dOptions): Position3d | undefined;
/** Internal shared validation for bounded, deterministic controller stepping. */
export declare function locomotionSteps(dt: number): number;
export declare function copyPosition(value: Position3d): [number, number, number];
export declare function finite(value: number, label: string): number;
export declare function positive(value: number, label: string): number;
export declare function nonnegative(value: number, label: string): number;
export declare function collisionBits(value: number): number;
export declare function approachAngle(current: number, target: number, amount: number): number;
//# sourceMappingURL=locomotion-3d.d.ts.map