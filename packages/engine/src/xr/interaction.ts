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
export function raycastTargets(pose: XrPose, targets: readonly RayTarget[], options: RayOptions = {}): RayHit | undefined {
  const maxDistance = options.maxDistance ?? 10;
  const softness = options.softness ?? 0.035;
  if (!(maxDistance > 0)) throw new Error("A ray max distance must be positive.");
  if (!(softness >= 0)) throw new Error("Ray softness must not be negative.");

  const direction = normalize(pose.forward);
  let best: RayHit | undefined;
  let bestScore = Infinity;
  let bestPriority = -Infinity;

  for (const target of targets) {
    if (!(target.radius > 0)) throw new Error(`Ray target "${target.id}" needs a positive radius.`);
    const toTarget = subtract(target.position, pose.position);
    const along = dot(toTarget, direction);
    if (along <= 0 || along > maxDistance) continue;
    const closest = add(pose.position, scale(direction, along));
    const offset = length(subtract(target.position, closest));
    // The cone widens with distance, so a distant target is as easy to hit as a
    // near one of the same apparent size.
    const allowed = target.radius + softness * along;
    if (offset > allowed) continue;

    const priority = target.priority ?? 0;
    if (priority < bestPriority) continue;
    if (priority === bestPriority && along >= bestScore) continue;
    bestPriority = priority;
    bestScore = along;
    best = { id: target.id, distance: along, point: closest };
  }
  return best;
}

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
export class XrGrabController {
  readonly #grabs = new Map<XrHand, XrGrabState>();
  #twoHandedStart: { separation: number; angle: number; id: string } | undefined;

  get held(): readonly XrGrabState[] {
    return [...this.#grabs.values()];
  }

  heldBy(hand: XrHand): XrGrabState | undefined {
    return this.#grabs.get(hand);
  }

  isHeld(id: string): boolean {
    return [...this.#grabs.values()].some((grab) => grab.id === id);
  }

  /** True when both hands hold the same object. */
  get twoHanded(): boolean {
    const left = this.#grabs.get("left");
    const right = this.#grabs.get("right");
    return left !== undefined && right !== undefined && left.id === right.id;
  }

  /** Grabs whatever is within reach of the hand, if anything. */
  grabDirect(hand: XrHand, pose: XrPose, grabbables: readonly XrGrabbable[]): XrGrabState | undefined {
    let best: XrGrabbable | undefined;
    let bestDistance = Infinity;
    for (const candidate of grabbables) {
      const distance = length(subtract(candidate.position, pose.position));
      if (distance > candidate.radius || distance >= bestDistance) continue;
      bestDistance = distance;
      best = candidate;
    }
    if (!best) return undefined;
    return this.#begin(hand, best.id, "direct", subtract(best.position, pose.position), bestDistance);
  }

  /** Grabs the target a ray is pointing at, keeping it at its current distance. */
  grabByRay(hand: XrHand, pose: XrPose, targets: readonly RayTarget[], options?: RayOptions): XrGrabState | undefined {
    const hit = raycastTargets(pose, targets, options);
    if (!hit) return undefined;
    const target = targets.find((candidate) => candidate.id === hit.id)!;
    return this.#begin(hand, hit.id, "ray", subtract(target.position, pose.position), hit.distance);
  }

  release(hand: XrHand): string | undefined {
    const grab = this.#grabs.get(hand);
    if (!grab) return undefined;
    this.#grabs.delete(hand);
    this.#twoHandedStart = undefined;
    return grab.id;
  }

  releaseAll(): void {
    this.#grabs.clear();
    this.#twoHandedStart = undefined;
  }

  /**
   * Where a held object should be this frame.
   *
   * Returns a position rather than moving anything, so the caller decides
   * whether to snap it there (a UI panel) or drive it with physics (a crate).
   */
  resolve(hand: XrHand, pose: XrPose): XrVector3 | undefined {
    const grab = this.#grabs.get(hand);
    if (!grab) return undefined;
    if (grab.mode === "direct") return add(pose.position, grab.offset);
    // Ray grabs follow the ray at their captured distance, which is what makes
    // a distant object feel attached to the pointer rather than reeled in.
    return add(pose.position, scale(normalize(pose.forward), grab.rayDistance));
  }

  /**
   * The transform two hands imply for the object they both hold.
   *
   * Position is the midpoint, scale is the change in separation, and yaw is the
   * change in the angle between them — the three degrees of freedom people
   * actually use two hands for.
   */
  resolveTwoHanded(left: XrPose, right: XrPose): TwoHandedTransform | undefined {
    if (!this.twoHanded) {
      this.#twoHandedStart = undefined;
      return undefined;
    }
    const separation = length(subtract(right.position, left.position));
    const angle = Math.atan2(right.position[2] - left.position[2], right.position[0] - left.position[0]);
    const id = this.#grabs.get("left")!.id;

    if (!this.#twoHandedStart || this.#twoHandedStart.id !== id) {
      this.#twoHandedStart = { separation: Math.max(separation, 1e-4), angle, id };
    }
    return {
      position: scale(add(left.position, right.position), 0.5),
      scale: separation / this.#twoHandedStart.separation,
      yaw: wrapAngle(angle - this.#twoHandedStart.angle),
    };
  }

  #begin(hand: XrHand, id: string, mode: GrabMode, offset: XrVector3, rayDistance: number): XrGrabState {
    const grab: XrGrabState = { id, hand, mode, offset, rayDistance };
    this.#grabs.set(hand, grab);
    // A second hand joining resets the two-handed reference, so scale starts
    // at one rather than jumping.
    this.#twoHandedStart = undefined;
    return grab;
  }
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
export class XrLocomotion {
  readonly #options: Required<LocomotionOptions>;
  #position: XrVector3 = [0, 0, 0];
  #yaw = 0;
  #fade = 0;
  #fadeRemaining = 0;
  #pendingYaw = 0;
  #pendingTeleport: XrVector3 | undefined;
  #turnHeld = false;

  constructor(options: LocomotionOptions = {}) {
    this.#options = {
      turnStyle: options.turnStyle ?? "snap",
      snapDegrees: options.snapDegrees ?? 30,
      smoothTurnSpeed: options.smoothTurnSpeed ?? 90,
      moveSpeed: options.moveSpeed ?? 2.5,
      moveReference: options.moveReference ?? "head",
      comfortFadeSeconds: options.comfortFadeSeconds ?? 0.1,
      deadZone: options.deadZone ?? 0.2,
    };
    if (!(this.#options.snapDegrees > 0)) throw new Error("A snap turn must be a positive number of degrees.");
    if (!(this.#options.moveSpeed >= 0)) throw new Error("A locomotion move speed must not be negative.");
    if (!(this.#options.deadZone >= 0 && this.#options.deadZone < 1)) throw new Error("A locomotion dead zone must lie in [0, 1).");
    if (!(this.#options.comfortFadeSeconds >= 0)) throw new Error("A comfort fade must not be negative.");
  }

  get position(): XrVector3 {
    return this.#position;
  }

  get yaw(): number {
    return this.#yaw;
  }

  /** Fade opacity in `[0, 1]`, for the comfort blink. */
  get fade(): number {
    return this.#fade;
  }

  setPosition(position: XrVector3): void {
    this.#position = [position[0], position[1], position[2]];
  }

  /** Queues a teleport, which takes effect at the midpoint of the fade. */
  teleport(destination: XrVector3): void {
    this.#pendingTeleport = [destination[0], destination[1], destination[2]];
    this.#fadeRemaining = this.#options.comfortFadeSeconds;
    if (this.#options.comfortFadeSeconds === 0) this.#commitTeleport();
  }

  update(input: LocomotionInput, headForward: XrVector3, deltaSeconds: number): LocomotionResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("Locomotion requires a finite, non-negative delta.");
    let turned = false;

    // Turn input is read *before* the fade is advanced, so a snap and its blink
    // begin on the same frame. Advancing the fade first delays it by a frame,
    // which reads as the world turning slightly before the blink covers it.
    const turnX = this.#applyDeadZone(input.turnX ?? 0);
    if (this.#options.turnStyle === "snap") {
      // One turn per push: a held stick that snapped every frame would spin.
      if (turnX !== 0 && !this.#turnHeld) {
        this.#pendingYaw = -Math.sign(turnX) * (this.#options.snapDegrees * Math.PI) / 180;
        if (this.#options.comfortFadeSeconds > 0) this.#fadeRemaining = this.#options.comfortFadeSeconds;
        else {
          this.#yaw = wrapAngle(this.#yaw + this.#pendingYaw);
          this.#pendingYaw = 0;
          turned = true;
        }
      }
      this.#turnHeld = turnX !== 0;
    } else if (turnX !== 0) {
      this.#yaw = wrapAngle(this.#yaw - turnX * (this.#options.smoothTurnSpeed * Math.PI) / 180 * deltaSeconds);
      turned = true;
    }

    // Comfort fade: the teleport or snap lands halfway through, so the player
    // never sees the world move.
    if (this.#fadeRemaining > 0) {
      const total = this.#options.comfortFadeSeconds;
      this.#fadeRemaining = Math.max(0, this.#fadeRemaining - deltaSeconds);
      const progress = 1 - this.#fadeRemaining / total;
      this.#fade = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
      if (progress >= 0.5) {
        if (this.#pendingTeleport) this.#commitTeleport();
        if (this.#pendingYaw !== 0) {
          this.#yaw = wrapAngle(this.#yaw + this.#pendingYaw);
          this.#pendingYaw = 0;
          turned = true;
        }
      }
      if (this.#fadeRemaining === 0) this.#fade = 0;
    }

    const moveX = this.#applyDeadZone(input.moveX ?? 0);
    const moveY = this.#applyDeadZone(input.moveY ?? 0);
    if (moveX !== 0 || moveY !== 0) {
      // Movement follows where the player is looking, flattened to the ground.
      // Ignoring head orientation is the other classic comfort failure.
      const flat = normalize([headForward[0], 0, headForward[2]]);
      const right: XrVector3 = [-flat[2], 0, flat[0]];
      const speed = this.#options.moveSpeed * deltaSeconds;
      this.#position = [
        this.#position[0] + (right[0] * moveX + flat[0] * moveY) * speed,
        this.#position[1],
        this.#position[2] + (right[2] * moveX + flat[2] * moveY) * speed,
      ];
    }

    return { position: this.#position, yaw: this.#yaw, fade: this.#fade, turned };
  }

  #commitTeleport(): void {
    if (!this.#pendingTeleport) return;
    this.#position = this.#pendingTeleport;
    this.#pendingTeleport = undefined;
  }

  /** Rescales from the dead-zone edge, so the usable range still spans 0 to 1. */
  #applyDeadZone(value: number): number {
    const magnitude = Math.abs(value);
    if (magnitude <= this.#options.deadZone) return 0;
    const scaled = (magnitude - this.#options.deadZone) / (1 - this.#options.deadZone);
    return Math.sign(value) * Math.min(1, scaled);
  }
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
export function teleportArc(
  pose: XrPose,
  isValidLanding: (point: XrVector3) => boolean,
  groundHeightAt: (x: number, z: number) => number | undefined,
  options: TeleportArcOptions = {},
): TeleportArc {
  const speed = options.speed ?? 8;
  const gravity = options.gravity ?? -9.81;
  const steps = options.steps ?? 24;
  const maxTime = options.maxTime ?? 2;
  if (!(speed > 0)) throw new Error("A teleport arc speed must be positive.");
  if (!Number.isInteger(steps) || steps < 2) throw new Error("A teleport arc needs at least two steps.");

  const direction = normalize(pose.forward);
  const velocity = scale(direction, speed);
  const points: XrVector3[] = [pose.position];

  for (let step = 1; step <= steps; step += 1) {
    const t = (step / steps) * maxTime;
    const point: XrVector3 = [
      pose.position[0] + velocity[0] * t,
      pose.position[1] + velocity[1] * t + 0.5 * gravity * t * t,
      pose.position[2] + velocity[2] * t,
    ];
    const ground = groundHeightAt(point[0], point[2]);
    if (ground !== undefined && point[1] <= ground) {
      const landing: XrVector3 = [point[0], ground, point[2]];
      points.push(landing);
      const valid = isValidLanding(landing);
      return { points, destination: valid ? landing : undefined, valid };
    }
    points.push(point);
  }
  return { points, destination: undefined, valid: false };
}

function add(a: XrVector3, b: XrVector3): XrVector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: XrVector3, b: XrVector3): XrVector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: XrVector3, factor: number): XrVector3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function dot(a: XrVector3, b: XrVector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: XrVector3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: XrVector3): XrVector3 {
  const magnitude = length(a);
  if (magnitude < 1e-9) return [0, 0, -1];
  return [a[0] / magnitude, a[1] / magnitude, a[2] / magnitude];
}

function wrapAngle(radians: number): number {
  const wrapped = ((radians + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}
