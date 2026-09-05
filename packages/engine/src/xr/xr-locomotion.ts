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
export class XrHandCollisionResolver {
  readonly #physics: PhysicsWorld3dBridge;
  readonly #options: Required<Omit<XrHandCollisionOptions, "surfaceSlip">> & {
    readonly surfaceSlip: ((bodyId: number) => number | undefined) | undefined;
  };

  constructor(physics: PhysicsWorld3dBridge, options: XrHandCollisionOptions = {}) {
    this.#physics = physics;
    this.#options = {
      layer: bits(options.layer ?? 1, "XR hand collision layer"), mask: bits(options.mask ?? 0xffff_ffff, "XR hand collision mask"),
      includeSensors: options.includeSensors ?? false,
      precision: range(options.precision ?? 0.995, 0.5, 1, "XR hand collision precision"),
      defaultSingleHandSlip: range(options.defaultSingleHandSlip ?? 0.001, 0, 1, "XR single-hand slip"),
      defaultBracedSlip: range(options.defaultBracedSlip ?? 0.03, 0, 1, "XR braced-hand slip"), surfaceSlip: options.surfaceSlip,
    };
  }

  resolve(start: XrVector3, movement: XrVector3, radius: number, singleHand = true): XrResolvedHandContact | undefined {
    vector(start, "XR hand sweep start"); vector(movement, "XR hand sweep movement"); positive(radius, "XR hand sweep radius");
    const distance = Math.sqrt(lengthSquared(movement)); if (distance <= Number.EPSILON) return undefined;
    const direction = scale(movement, 1 / distance); const precision = this.#options.precision;
    const query = { layer: this.#options.layer, mask: this.#options.mask, includeSensors: this.#options.includeSensors };
    const hit = this.#physics.castShape(start, [0, 0, 0, 1], direction, distance + radius * (1 - precision), { type: "sphere", radius: radius * precision }, query);
    if (hit === undefined) {
      const ray = this.#physics.raycast(start, direction, distance + radius * precision * 0.999, query);
      if (ray === undefined) return undefined;
      return Object.freeze({ touching: true, constrainedPosition: start, point: ray.point, normal: ray.normal, bodyId: ray.bodyId, slip: 0 });
    }
    const first = hit.position; const target = add(start, movement);
    const slip = range(this.#options.surfaceSlip?.(hit.bodyId) ?? (singleHand ? this.#options.defaultSingleHandSlip : this.#options.defaultBracedSlip), 0, 1, `XR surface ${String(hit.bodyId)} slip`);
    const projected = scale(projectOnPlane(subtract(target, first), hit.normal), slip);
    let constrained = first;
    const slideDistance = Math.sqrt(lengthSquared(projected));
    if (slideDistance > Number.EPSILON) {
      const slide = this.#physics.castShape(first, [0, 0, 0, 1], scale(projected, 1 / slideDistance), slideDistance, { type: "sphere", radius }, query);
      constrained = slide?.position ?? add(first, projected);
    }
    return Object.freeze({ touching: true, constrainedPosition: constrained, point: first, normal: hit.normal, bodyId: hit.bodyId, slip });
  }

  /** A hand can unstick only when it exceeded the threshold and the direct
   * head-to-hand corridor is clear. */
  shouldUnstick(head: XrVector3, hand: XrVector3, constrained: XrVector3, radius: number, distance = 1): boolean {
    vector(head, "XR head position"); vector(hand, "XR hand position"); vector(constrained, "XR constrained hand position");
    positive(radius, "XR hand radius"); positive(distance, "XR hand unstick distance");
    if (Math.sqrt(lengthSquared(subtract(hand, constrained))) <= distance) return false;
    const corridor = subtract(hand, head); const length = Math.sqrt(lengthSquared(corridor)); if (length <= radius) return true;
    return this.#physics.castShape(head, [0, 0, 0, 1], scale(corridor, 1 / length), Math.max(Number.EPSILON, length - radius), { type: "sphere", radius: radius * this.#options.precision }, { layer: this.#options.layer, mask: this.#options.mask, includeSensors: this.#options.includeSensors }) === undefined;
  }
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
export class XrArmLocomotionSolver {
  readonly #config: Required<XrArmLocomotionConfig>;
  readonly #previous = new Map<XrHand, XrVector3>();
  readonly #supported = new Set<XrHand>();
  readonly #history: [number, number, number][];
  #historyCursor = 0;
  #historyCount = 0;
  #verticalVelocity = 0;

  constructor(config: XrArmLocomotionConfig = {}) {
    this.#config = {
      maxArmLength: positive(config.maxArmLength ?? 1.55, "XR maximum arm length"),
      maxSpeed: positive(config.maxSpeed ?? 10, "XR maximum locomotion speed"),
      velocitySamples: integer(config.velocitySamples ?? 6, "XR velocity sample count"),
      launchMultiplier: nonNegative(config.launchMultiplier ?? 1.15, "XR launch multiplier"),
      maxLaunchSpeed: positive(config.maxLaunchSpeed ?? 7, "XR maximum launch speed"),
      gravity: nonNegative(config.gravity ?? 9.81, "XR locomotion gravity"),
    };
    this.#history = Array.from({ length: this.#config.velocitySamples }, () => [0, 0, 0]);
  }

  reset(): void {
    this.#previous.clear(); this.#supported.clear(); this.#historyCursor = 0;
    this.#historyCount = 0; this.#verticalVelocity = 0;
    for (const value of this.#history) value.fill(0);
  }

  sample(value: XrArmLocomotionSample): XrArmLocomotionResult {
    const dt = positive(value.deltaSeconds, "XR locomotion deltaSeconds");
    vector(value.headPosition, "XR head position");
    if (value.hands.length > 2) throw new Error("XR arm locomotion accepts at most one left and one right hand per sample.");
    const seen = new Set<XrHand>();
    const supported: XrHand[] = [];
    let dx = 0, dy = 0, dz = 0, contributions = 0;
    for (const hand of value.hands) {
      if (seen.has(hand.hand)) throw new Error(`XR arm locomotion received duplicate '${hand.hand}' hand tracking.`);
      seen.add(hand.hand); vector(hand.position, `XR ${hand.hand} hand position`);
      if (!hand.tracked) { this.#previous.delete(hand.hand); this.#supported.delete(hand.hand); continue; }
      const position = clampArm(hand.position, value.headPosition, this.#config.maxArmLength);
      const previous = this.#previous.get(hand.hand);
      const contact = value.contacts[hand.hand];
      if (contact?.touching) {
        validateContact(contact, hand.hand); supported.push(hand.hand);
        if (previous !== undefined) { dx += previous[0] - position[0]; dy += previous[1] - position[1]; dz += previous[2] - position[2]; contributions++; }
      }
      this.#previous.set(hand.hand, position);
    }
    const hadSupport = this.#supported.size > 0;
    this.#supported.clear(); for (const hand of supported) this.#supported.add(hand);
    if (contributions > 1) { dx /= contributions; dy /= contributions; dz /= contributions; }
    if (supported.length === 0) { this.#verticalVelocity -= this.#config.gravity * dt; dy += this.#verticalVelocity * dt; }
    else this.#verticalVelocity = 0;
    const translation = clampLength([dx, dy, dz], this.#config.maxSpeed * dt);
    const velocity: XrVector3 = [translation[0] / dt, translation[1] / dt, translation[2] / dt];
    this.#record(velocity);
    const launchVelocity = hadSupport && supported.length === 0
      ? clampLength(scale(this.#averageVelocity(), this.#config.launchMultiplier), this.#config.maxLaunchSpeed)
      : [0, 0, 0] as const;
    if (lengthSquared(launchVelocity) > 0) this.#verticalVelocity = launchVelocity[1];
    return Object.freeze({ translation, velocity, launchVelocity, supportedHands: Object.freeze(supported) });
  }

  #record(value: XrVector3): void {
    const target = this.#history[this.#historyCursor]!; target[0] = value[0]; target[1] = value[1]; target[2] = value[2];
    this.#historyCursor = (this.#historyCursor + 1) % this.#history.length;
    this.#historyCount = Math.min(this.#historyCount + 1, this.#history.length);
  }
  #averageVelocity(): XrVector3 {
    let x = 0, y = 0, z = 0;
    for (let index = 0; index < this.#historyCount; index++) { const value = this.#history[index]!; x += value[0]; y += value[1]; z += value[2]; }
    const divisor = Math.max(1, this.#historyCount); return [x / divisor, y / divisor, z / divisor];
  }
}

export interface XrPhysicsRigOptions {
  readonly character: CharacterController3dOptions;
  readonly rotation?: readonly [number, number, number, number];
}

/** Applies XR locomotion output through Vapour's native character controller,
 * retaining slope, autostep, filtering, and collision behavior. */
export class XrPhysicsRig {
  readonly #physics: PhysicsWorld3dBridge;
  readonly #options: XrPhysicsRigOptions;
  #position: [number, number, number];
  #velocity: [number, number, number] = [0, 0, 0];

  constructor(physics: PhysicsWorld3dBridge, position: XrVector3, options: XrPhysicsRigOptions) {
    vector(position, "XR rig position"); this.#physics = physics; this.#position = [...position]; this.#options = options;
  }
  get position(): XrVector3 { return this.#position; }
  get velocity(): XrVector3 { return this.#velocity; }
  move(deltaSeconds: number, locomotion: XrArmLocomotionResult): CharacterMovement3d {
    const dt = positive(deltaSeconds, "XR rig deltaSeconds");
    const desired: XrVector3 = locomotion.launchVelocity.some((component) => component !== 0)
      ? scale(locomotion.launchVelocity, dt) : locomotion.translation;
    const result = this.#physics.moveCharacter(dt, this.#position, this.#options.rotation ?? [0, 0, 0, 1], desired, this.#options.character);
    this.#position = add(this.#position, result.translation);
    this.#velocity = [result.translation[0] / dt, result.translation[1] / dt, result.translation[2] / dt];
    return result;
  }
  teleport(position: XrVector3): void { vector(position, "XR teleport position"); this.#position = [...position]; this.#velocity = [0, 0, 0]; }
}

function validateContact(contact: XrHandContact, hand: XrHand): void { if (contact.point !== undefined) vector(contact.point, `XR ${hand} contact point`); if (contact.normal !== undefined) vector(contact.normal, `XR ${hand} contact normal`); if (contact.bodyId !== undefined && (!Number.isSafeInteger(contact.bodyId) || contact.bodyId <= 0)) throw new Error(`XR ${hand} contact body ID must be a positive safe integer.`); }
function clampArm(hand: XrVector3, head: XrVector3, maximum: number): XrVector3 { const delta = subtract(hand, head); const clamped = clampLength(delta, maximum); return add(head, clamped); }
function add(a: XrVector3, b: XrVector3): [number, number, number] { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subtract(a: XrVector3, b: XrVector3): [number, number, number] { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a: XrVector3, amount: number): [number, number, number] { return [a[0] * amount, a[1] * amount, a[2] * amount]; }
function projectOnPlane(value: XrVector3, normal: XrVector3): [number, number, number] { const normalLength = lengthSquared(normal); if (normalLength <= Number.EPSILON) throw new Error("XR collision normal cannot be zero."); const amount = (value[0] * normal[0] + value[1] * normal[1] + value[2] * normal[2]) / normalLength; return [value[0] - normal[0] * amount, value[1] - normal[1] * amount, value[2] - normal[2] * amount]; }
function lengthSquared(a: XrVector3): number { return a[0] ** 2 + a[1] ** 2 + a[2] ** 2; }
function clampLength(value: XrVector3, maximum: number): [number, number, number] { const squared = lengthSquared(value); if (squared <= maximum * maximum) return [...value]; const amount = maximum / Math.sqrt(squared); return scale(value, amount); }
function vector(value: readonly number[], label: string): void { if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${label} requires three finite numbers.`); }
function positive(value: number, label: string): number { if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive.`); return value; }
function nonNegative(value: number, label: string): number { if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative.`); return value; }
function integer(value: number, label: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`); return value; }
function range(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} must be between ${String(minimum)} and ${String(maximum)}.`); return value; }
function bits(value: number, label: string): number { if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`${label} must be an unsigned 32-bit integer.`); return value; }
