import type {
  CharacterController3dOptions,
  PhysicsWorld3dBridge,
} from "./physics-3d.js";

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
export class ThirdPersonMotor3d {
  readonly #world: LocomotionWorld3d;
  readonly #height: number;
  readonly #speed: number;
  readonly #sprintSpeed: number;
  readonly #acceleration: number;
  readonly #deceleration: number;
  readonly #gravity: number;
  readonly #jumpSpeed: number;
  readonly #turnSpeed: number;
  readonly #coyoteSeconds: number;
  readonly #jumpBufferSeconds: number;
  readonly #query: CharacterController3dOptions;
  #position: [number, number, number];
  #velocity: [number, number, number] = [0, 0, 0];
  #yaw: number;
  #grounded = false;
  #collisions: readonly number[] = [];
  #coyote = 0;
  #jumpBuffer = 0;
  #jumpHeld = false;

  constructor(world: LocomotionWorld3d, options: ThirdPersonMotor3dOptions) {
    this.#world = world;
    this.#position = copyPosition(options.position);
    this.#yaw = finite(options.yaw ?? 0, "Character yaw");
    this.#height = positive(options.height ?? 1.8, "Character height");
    const radius = positive(options.radius ?? 0.3, "Character radius");
    if (radius * 2 >= this.#height) throw new Error("Character height must exceed twice its capsule radius.");
    this.#speed = positive(options.speed ?? 4.2, "Character speed");
    this.#sprintSpeed = positive(options.sprintSpeed ?? 7.4, "Character sprint speed");
    this.#acceleration = positive(options.acceleration ?? 24, "Character acceleration");
    this.#deceleration = positive(options.deceleration ?? 32, "Character deceleration");
    this.#gravity = positive(options.gravity ?? 24, "Character gravity");
    this.#jumpSpeed = positive(options.jumpSpeed ?? 7, "Character jump speed");
    this.#turnSpeed = positive(options.turnSpeed ?? 12, "Character turn speed");
    this.#coyoteSeconds = nonnegative(options.coyoteSeconds ?? 0.1, "Character coyote time");
    this.#jumpBufferSeconds = nonnegative(options.jumpBufferSeconds ?? 0.12, "Character jump buffer");
    this.#query = {
      shape: { type: "capsule", radius, halfHeight: this.#height / 2 - radius },
      offset: 0.025, slide: true,
      autostepMaxHeight: nonnegative(options.stepHeight ?? 0.28, "Character step height"),
      autostepMinWidth: radius, autostepDynamicBodies: false,
      maxSlopeClimbDegrees: 45, minSlopeSlideDegrees: 50, snapToGround: 0.25,
      layer: collisionBits(options.layer ?? 1), mask: collisionBits(options.mask ?? 0xffff_ffff), includeSensors: false,
    };
  }

  get state(): ThirdPersonMotor3dState {
    return { position: [...this.#position], velocity: [...this.#velocity], yaw: this.#yaw, grounded: this.#grounded, collisions: [...this.#collisions] };
  }

  /** Teleport only to a validated spawn/exit. Clears momentum and jump history. */
  teleport(position: Position3d, yaw = this.#yaw): void {
    const next = copyPosition(position);
    finite(yaw, "Character yaw");
    this.#position = next; this.#yaw = yaw;
    this.#velocity = [0, 0, 0]; this.#grounded = false;
    this.#collisions = []; this.#coyote = 0; this.#jumpBuffer = 0; this.#jumpHeld = false;
  }

  update(deltaSeconds: number, input: ThirdPersonMotor3dInput): ThirdPersonMotor3dState {
    const steps = locomotionSteps(deltaSeconds);
    const x = finite(input.move[0], "Character move X"), z = finite(input.move[1], "Character move Z");
    const length = Math.max(1, Math.hypot(x, z));
    const jump = input.jump === true;
    if (jump && !this.#jumpHeld) this.#jumpBuffer = this.#jumpBufferSeconds + deltaSeconds / steps;
    this.#jumpHeld = jump;
    const contacts = new Set<number>();
    for (let step = 0; step < steps; step++) {
      this.#step(deltaSeconds / steps, x / length, z / length, input.sprint === true);
      for (const id of this.#collisions) contacts.add(id);
    }
    this.#collisions = [...contacts];
    return this.state;
  }

  #step(dt: number, x: number, z: number, sprint: boolean): void {
    this.#coyote = this.#grounded ? this.#coyoteSeconds : Math.max(0, this.#coyote - dt);
    const topSpeed = sprint ? this.#sprintSpeed : this.#speed;
    const targetX = x * topSpeed, targetZ = z * topSpeed;
    const dx = targetX - this.#velocity[0], dz = targetZ - this.#velocity[2];
    const change = Math.hypot(dx, dz), acceleration = Math.hypot(x, z) > 0 ? this.#acceleration : this.#deceleration;
    const fraction = change === 0 ? 0 : Math.min(1, acceleration * dt / change);
    const previousX = this.#velocity[0], previousZ = this.#velocity[2];
    this.#velocity[0] += dx * fraction; this.#velocity[2] += dz * fraction;
    if (Math.hypot(x, z) > 0.001) this.#yaw = approachAngle(this.#yaw, Math.atan2(-x, -z), this.#turnSpeed * dt);

    if (this.#jumpBuffer > 0 && (this.#grounded || this.#coyote > 0)) {
      this.#velocity[1] = this.#jumpSpeed; this.#grounded = false; this.#coyote = 0; this.#jumpBuffer = 0;
    }
    this.#jumpBuffer = Math.max(0, this.#jumpBuffer - dt);
    if (this.#grounded && this.#velocity[1] <= 0) this.#velocity[1] = -1;
    const oldY = this.#velocity[1];
    this.#velocity[1] = Math.max(-60, oldY - this.#gravity * dt);
    const desired: [number, number, number] = [
      (previousX + this.#velocity[0]) * 0.5 * dt,
      (oldY + this.#velocity[1]) * 0.5 * dt,
      (previousZ + this.#velocity[2]) * 0.5 * dt,
    ];
    const result = this.#world.moveCharacter(dt,
      [this.#position[0], this.#position[1] + this.#height / 2, this.#position[2]],
      [0, 0, 0, 1], desired,
      { ...this.#query, snapToGround: this.#velocity[1] > 0 ? null : this.#query.snapToGround! });
    for (let axis = 0; axis < 3; axis++) this.#position[axis] = this.#position[axis]! + result.translation[axis]!;
    this.#grounded = result.grounded && this.#velocity[1] <= 0;
    this.#collisions = result.collisions;
    if (this.#grounded || (desired[1] > 0 && result.translation[1] < desired[1] - 0.001)) this.#velocity[1] = 0;
    // Remove only blocked velocity, preserving tangential sliding and the
    // acceleration curve when a ground contact did not constrain movement.
    for (const axis of [0, 2] as const) {
      if (Math.abs(result.translation[axis]) + 0.001 < Math.abs(desired[axis])) this.#velocity[axis] = result.translation[axis] / dt;
    }
  }
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
export function findSafeCharacterPosition3d(
  world: Pick<LocomotionWorld3d, "raycast" | "overlapShape">,
  candidate: Position3d,
  options: SafeCharacterPosition3dOptions = {},
): Position3d | undefined {
  copyPosition(candidate);
  const height = positive(options.height ?? 1.8, "Exit character height");
  const radius = positive(options.radius ?? 0.3, "Exit character radius");
  if (radius * 2 >= height) throw new Error("Exit character height must exceed twice its radius.");
  const rise = nonnegative(options.maxRise ?? 0.45, "Exit maximum rise");
  const drop = positive(options.maxDrop ?? 1.5, "Exit maximum drop");
  const filter = { layer: collisionBits(options.layer ?? 1), mask: collisionBits(options.mask ?? 0xffff_ffff), includeSensors: false };
  const hit = world.raycast([candidate[0], candidate[1] + rise + 0.05, candidate[2]], [0, -1, 0], rise + drop + 0.05, filter);
  if (hit === undefined || hit.normal[1] < Math.SQRT1_2) return undefined;
  const feet: Position3d = [candidate[0], hit.point[1] + 0.035, candidate[2]];
  const overlaps = world.overlapShape([feet[0], feet[1] + height / 2, feet[2]], [0, 0, 0, 1],
    { type: "capsule", halfHeight: height / 2 - radius, radius }, filter);
  return overlaps.length === 0 ? feet : undefined;
}

/** Internal shared validation for bounded, deterministic controller stepping. */
export function locomotionSteps(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) throw new Error("Locomotion delta must be finite and in (0, 0.25] seconds; advance long gaps through fixed updates.");
  return Math.ceil(dt / (1 / 60) - 1e-10);
}
export function copyPosition(value: Position3d): [number, number, number] {
  if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error("A locomotion position needs three finite coordinates.");
  return [value[0], value[1], value[2]];
}
export function finite(value: number, label: string): number { if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`); return value; }
export function positive(value: number, label: string): number { if (finite(value, label) <= 0) throw new Error(`${label} must be positive.`); return value; }
export function nonnegative(value: number, label: string): number { if (finite(value, label) < 0) throw new Error(`${label} must not be negative.`); return value; }
export function collisionBits(value: number): number { if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error("Locomotion collision layers and masks must be unsigned 32-bit integers."); return value; }
export function approachAngle(current: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + Math.max(-amount, Math.min(amount, delta));
}
