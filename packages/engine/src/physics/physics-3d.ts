export type PhysicsBodyType3d =
  "static" | "dynamic" | "kinematicPosition" | "kinematicVelocity";
export type ColliderShape3d =
  | {
      readonly type: "box";
      readonly halfExtents: readonly [number, number, number];
    }
  | { readonly type: "sphere"; readonly radius: number }
  | {
      readonly type: "capsule";
      readonly halfHeight: number;
      readonly radius: number;
    }
  | {
      readonly type: "cylinder";
      readonly halfHeight: number;
      readonly radius: number;
    }
  | {
      readonly type: "plane";
      readonly normal: readonly [number, number, number];
    }
  | {
      readonly type: "convexMesh";
      readonly points: readonly (readonly [number, number, number])[];
    }
  | {
      readonly type: "triangleMesh";
      readonly vertices: readonly (readonly [number, number, number])[];
      readonly indices: readonly (readonly [number, number, number])[];
    }
  | {
      readonly type: "heightfield";
      readonly rows: number;
      readonly columns: number;
      readonly heights: readonly number[];
      readonly scale: readonly [number, number, number];
    }
  | {
      readonly type: "compound";
      readonly children: readonly CompoundColliderChild3d[];
    };
export interface CompoundColliderChild3d {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly shape: ColliderShape3d;
}
export interface PhysicsBodyDescriptor3d {
  readonly id: number;
  readonly bodyType: PhysicsBodyType3d;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly linearVelocity?: readonly [number, number, number];
  readonly angularVelocity?: readonly [number, number, number];
  readonly gravityScale?: number;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  readonly continuousCollisionDetection?: boolean;
  readonly shape: ColliderShape3d;
  readonly density?: number;
  readonly friction?: number;
  readonly restitution?: number;
  readonly sensor?: boolean;
  readonly layer?: number;
  readonly mask?: number;
}
export type PhysicsEventKind =
  "collisionEnter" | "collisionExit" | "triggerEnter" | "triggerExit";
export interface PhysicsEvent3d {
  readonly kind: PhysicsEventKind;
  readonly bodyA: number;
  readonly bodyB: number;
}
export interface PhysicsBodySnapshot3d {
  readonly id: number;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly linearVelocity: readonly [number, number, number];
  readonly angularVelocity: readonly [number, number, number];
  readonly sleeping: boolean;
}
export interface PhysicsStep3d {
  readonly bodies: readonly PhysicsBodySnapshot3d[];
  readonly events: readonly PhysicsEvent3d[];
}
export interface RaycastHit3d {
  readonly bodyId: number;
  readonly distance: number;
  readonly point: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
}
export interface ShapeCastHit3d {
  readonly bodyId: number;
  readonly distance: number;
  readonly position: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
}
export interface CharacterController3dOptions {
  readonly shape: ColliderShape3d;
  readonly offset?: number;
  readonly slide?: boolean;
  readonly autostepMaxHeight?: number | null;
  readonly autostepMinWidth?: number;
  readonly autostepDynamicBodies?: boolean;
  readonly maxSlopeClimbDegrees?: number;
  readonly minSlopeSlideDegrees?: number;
  readonly snapToGround?: number | null;
  readonly layer?: number;
  readonly mask?: number;
  readonly includeSensors?: boolean;
}
export interface CharacterMovement3d {
  readonly translation: readonly [number, number, number];
  readonly grounded: boolean;
  readonly slidingDownSlope: boolean;
  readonly collisions: readonly number[];
}

/**
 * A constraint between two bodies.
 *
 * The set is deliberately small and named for what games build with them: a
 * hinge is a door and an elbow, a slider is a piston and a drawer, a ball is a
 * shoulder and a tow hitch, a spring is suspension and a rope bridge.
 *
 * Anchors are given in each body's **own local space**, which is what makes a
 * joint description independent of where the bodies happen to be when it is
 * created — a door hinge is "the left edge of the door" regardless of which way
 * the door is currently swinging.
 */
export type JointDescriptor3d =
  | {
      readonly kind: "fixed";
      readonly anchorA: readonly [number, number, number];
      readonly anchorB: readonly [number, number, number];
    }
  | {
      readonly kind: "hinge";
      readonly anchorA: readonly [number, number, number];
      readonly anchorB: readonly [number, number, number];
      readonly axis: readonly [number, number, number];
      /** Angular limits in radians, as `[min, max]`. */
      readonly limits?: readonly [number, number];
      /** Target angular velocity and maximum force, as `[velocity, force]`. */
      readonly motor?: readonly [number, number];
    }
  | {
      readonly kind: "slider";
      readonly anchorA: readonly [number, number, number];
      readonly anchorB: readonly [number, number, number];
      readonly axis: readonly [number, number, number];
      /** Travel limits along the axis, as `[min, max]`. */
      readonly limits?: readonly [number, number];
      readonly motor?: readonly [number, number];
    }
  | {
      readonly kind: "ball";
      readonly anchorA: readonly [number, number, number];
      readonly anchorB: readonly [number, number, number];
    }
  | {
      readonly kind: "spring";
      readonly anchorA: readonly [number, number, number];
      readonly anchorB: readonly [number, number, number];
      readonly restLength: number;
      readonly stiffness: number;
      readonly damping: number;
    };

export interface JointSpec3d {
  readonly id: number;
  readonly bodyA: number;
  readonly bodyB: number;
  readonly joint: JointDescriptor3d;
  /**
   * Whether the two connected bodies collide with each other.
   *
   * Off by default: a hinge whose halves collide jitters at the joint, which is
   * almost never what an author wants and is hard to diagnose after the fact.
   */
  readonly collideConnected?: boolean;
}

export type PhysicsCommand3d =
  | {
      readonly type: "insert";
      readonly descriptor: Required<PhysicsBodyDescriptor3d>;
    }
  | { readonly type: "remove"; readonly id: number }
  | {
      readonly type: "addForce";
      readonly id: number;
      readonly force: readonly [number, number, number];
    }
  | {
      readonly type: "addForceAtPoint";
      readonly id: number;
      readonly force: readonly [number, number, number];
      readonly point: readonly [number, number, number];
    }
  | {
      readonly type: "addTorque";
      readonly id: number;
      readonly torque: readonly [number, number, number];
    }
  | {
      readonly type: "applyImpulse";
      readonly id: number;
      readonly impulse: readonly [number, number, number];
    }
  | {
      readonly type: "applyTorqueImpulse";
      readonly id: number;
      readonly torque: readonly [number, number, number];
    }
  | {
      readonly type: "setLinearVelocity";
      readonly id: number;
      readonly velocity: readonly [number, number, number];
    }
  | {
      readonly type: "setAngularVelocity";
      readonly id: number;
      readonly velocity: readonly [number, number, number];
    }
  | {
      readonly type: "setKinematicTarget";
      readonly id: number;
      readonly position: readonly [number, number, number];
      readonly rotation: readonly [number, number, number, number];
    }
  | { readonly type: "addJoint"; readonly spec: JointSpec3d }
  | { readonly type: "removeJoint"; readonly id: number }
  | {
      readonly type: "setJointMotor";
      readonly id: number;
      readonly targetVelocity: number;
      readonly maxForce: number;
    }
  | {
      readonly type: "setGravity";
      readonly gravity: readonly [number, number, number];
    };

export interface PhysicsEngine3dWasm {
  apply_commands(json: string): number;
  step_json(timestep: number): string;
  raycast_json(
    origin: Float32Array,
    direction: Float32Array,
    maxDistance: number,
    layer: number,
    mask: number,
    includeSensors: boolean,
  ): string;
  overlap_shape_json(
    position: Float32Array,
    rotation: Float32Array,
    shape: string,
    layer: number,
    mask: number,
    includeSensors: boolean,
  ): string;
  cast_shape_json(
    position: Float32Array,
    rotation: Float32Array,
    direction: Float32Array,
    maxDistance: number,
    shape: string,
    layer: number,
    mask: number,
    includeSensors: boolean,
  ): string;
  move_character_json(
    timestep: number,
    position: Float32Array,
    rotation: Float32Array,
    desiredTranslation: Float32Array,
    descriptor: string,
  ): string;
  body_count(): number;
  joint_count(): number;
  free(): void;
}

interface PhysicsWasmModule {
  default(
    moduleOrPath?: WebAssembly.Module | URL | RequestInfo,
  ): Promise<unknown>;
  PhysicsEngine3d: new (
    gravityX: number,
    gravityY: number,
    gravityZ: number,
  ) => PhysicsEngine3dWasm;
}
export type PhysicsWasmModuleLoader = (
  moduleUrl: string,
) => Promise<PhysicsWasmModule>;
export interface CreatePhysicsWorld3dOptions {
  readonly gravity?: readonly [number, number, number];
  readonly moduleUrl?: string;
  readonly loadModule?: PhysicsWasmModuleLoader;
}

/** Loads Vapour's shared Rust/WASM artifact and constructs a Rapier world. */
export async function createPhysicsWorld3d(
  options: CreatePhysicsWorld3dOptions = {},
): Promise<PhysicsWorld3dBridge> {
  const gravity = options.gravity ?? [0, -9.81, 0];
  vector(gravity, "gravity");
  const moduleUrl = options.moduleUrl ?? "/vapour_runtime.js";
  const loader =
    options.loadModule ??
    (async (url) =>
      (await import(/* @vite-ignore */ url)) as PhysicsWasmModule);
  try {
    const module = await loader(moduleUrl);
    await module.default();
    return new PhysicsWorld3dBridge(
      new module.PhysicsEngine3d(gravity[0], gravity[1], gravity[2]),
    );
  } catch (error) {
    throw new Error(
      `Vapour's Rust 3D physics runtime could not load from '${moduleUrl}': ${message(error)}`,
      { cause: error },
    );
  }
}

/** Coarse-grained VS/TypeScript facade over the Rust Rapier world. Mutations
 * queue locally and cross into WASM as one command array per fixed step. */
export class PhysicsWorld3dBridge {
  readonly #wasm: PhysicsEngine3dWasm;
  readonly #commands: PhysicsCommand3d[] = [];
  constructor(wasm: PhysicsEngine3dWasm) {
    this.#wasm = wasm;
  }
  get pendingCommands(): number {
    return this.#commands.length;
  }
  get bodyCount(): number {
    return this.#wasm.body_count();
  }
  destroy(): void {
    this.#commands.length = 0;
    this.#wasm.free();
  }
  insert(descriptor: PhysicsBodyDescriptor3d): void {
    validateId(descriptor.id);
    this.#commands.push({ type: "insert", descriptor: defaults(descriptor) });
  }
  remove(id: number): void {
    validateId(id);
    this.#commands.push({ type: "remove", id });
  }
  addForce(id: number, force: readonly [number, number, number]): void {
    validateId(id);
    vector(force, "force");
    this.#commands.push({ type: "addForce", id, force: [...force] });
  }
  addForceAtPoint(
    id: number,
    force: readonly [number, number, number],
    point: readonly [number, number, number],
  ): void {
    validateId(id);
    vector(force, "force");
    vector(point, "force point");
    this.#commands.push({
      type: "addForceAtPoint",
      id,
      force: [...force],
      point: [...point],
    });
  }
  addTorque(id: number, torque: readonly [number, number, number]): void {
    validateId(id);
    vector(torque, "torque");
    this.#commands.push({ type: "addTorque", id, torque: [...torque] });
  }
  applyImpulse(id: number, impulse: readonly [number, number, number]): void {
    validateId(id);
    vector(impulse, "impulse");
    this.#commands.push({ type: "applyImpulse", id, impulse: [...impulse] });
  }
  applyTorqueImpulse(
    id: number,
    torque: readonly [number, number, number],
  ): void {
    validateId(id);
    vector(torque, "torque impulse");
    this.#commands.push({
      type: "applyTorqueImpulse",
      id,
      torque: [...torque],
    });
  }
  setLinearVelocity(
    id: number,
    velocity: readonly [number, number, number],
  ): void {
    validateId(id);
    vector(velocity, "linear velocity");
    this.#commands.push({
      type: "setLinearVelocity",
      id,
      velocity: [...velocity],
    });
  }
  setAngularVelocity(
    id: number,
    velocity: readonly [number, number, number],
  ): void {
    validateId(id);
    vector(velocity, "angular velocity");
    this.#commands.push({
      type: "setAngularVelocity",
      id,
      velocity: [...velocity],
    });
  }
  setKinematicTarget(
    id: number,
    position: readonly [number, number, number],
    rotation: readonly [number, number, number, number],
  ): void {
    validateId(id);
    vector(position, "kinematic position");
    quaternion(rotation);
    this.#commands.push({
      type: "setKinematicTarget",
      id,
      position: [...position],
      rotation: [...rotation],
    });
  }
  setGravity(gravity: readonly [number, number, number]): void {
    vector(gravity, "gravity");
    this.#commands.push({ type: "setGravity", gravity: [...gravity] });
  }
  flush(): number {
    if (this.#commands.length === 0) return 0;
    const count = this.#commands.length;
    const json = JSON.stringify(this.#commands);
    try {
      const applied = this.#wasm.apply_commands(json);
      this.#commands.length = 0;
      return applied;
    } catch (error) {
      throw new Error(
        `Rust 3D physics rejected a ${String(count)}-command batch: ${message(error)}`,
        { cause: error },
      );
    }
  }
  step(timestep: number): PhysicsStep3d {
    if (!Number.isFinite(timestep) || timestep <= 0)
      throw new Error("3D physics timestep must be finite and positive.");
    this.flush();
    let value: unknown;
    try {
      value = JSON.parse(this.#wasm.step_json(timestep));
    } catch (error) {
      throw new Error(
        `Rust 3D physics returned an invalid step: ${message(error)}`,
        { cause: error },
      );
    }
    return validateStep(value);
  }
  raycast(
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
    maxDistance: number,
    options: {
      readonly layer?: number;
      readonly mask?: number;
      readonly includeSensors?: boolean;
    } = {},
  ): RaycastHit3d | undefined {
    vector(origin, "ray origin");
    vector(direction, "ray direction");
    if (!Number.isFinite(maxDistance) || maxDistance <= 0)
      throw new Error("Ray maximum distance must be finite and positive.");
    const layer = bits(options.layer ?? 1, "ray layer"),
      mask = bits(options.mask ?? 0xffff_ffff, "ray mask");
    let value: unknown;
    try {
      value = JSON.parse(
        this.#wasm.raycast_json(
          Float32Array.from(origin),
          Float32Array.from(direction),
          maxDistance,
          layer,
          mask,
          options.includeSensors ?? false,
        ),
      );
    } catch (error) {
      throw new Error(`Rust 3D physics raycast failed: ${message(error)}`, {
        cause: error,
      });
    }
    if (value === null) return undefined;
    if (!isRayHit(value))
      throw new Error("Rust 3D physics returned a malformed raycast hit.");
    return value;
  }
  overlapShape(
    position: readonly [number, number, number],
    rotation: readonly [number, number, number, number],
    shape: ColliderShape3d,
    options: {
      readonly layer?: number;
      readonly mask?: number;
      readonly includeSensors?: boolean;
    } = {},
  ): readonly number[] {
    vector(position, "overlap position");
    quaternion(rotation);
    validateShape(shape);
    const layer = bits(options.layer ?? 1, "overlap layer"),
      mask = bits(options.mask ?? 0xffff_ffff, "overlap mask");
    let value: unknown;
    try {
      value = JSON.parse(
        this.#wasm.overlap_shape_json(
          Float32Array.from(position),
          Float32Array.from(rotation),
          JSON.stringify(shape),
          layer,
          mask,
          options.includeSensors ?? false,
        ),
      );
    } catch (error) {
      throw new Error(`Rust 3D physics overlap failed: ${message(error)}`, {
        cause: error,
      });
    }
    if (
      !Array.isArray(value) ||
      !value.every((id) => Number.isSafeInteger(id) && id > 0)
    )
      throw new Error("Rust 3D physics returned malformed overlap IDs.");
    return value;
  }
  castShape(
    position: readonly [number, number, number],
    rotation: readonly [number, number, number, number],
    direction: readonly [number, number, number],
    maxDistance: number,
    shape: ColliderShape3d,
    options: {
      readonly layer?: number;
      readonly mask?: number;
      readonly includeSensors?: boolean;
    } = {},
  ): ShapeCastHit3d | undefined {
    vector(position, "shape-cast position");
    quaternion(rotation);
    vector(direction, "shape-cast direction");
    positive(maxDistance, "shape-cast maximum distance");
    validateShape(shape);
    const layer = bits(options.layer ?? 1, "shape-cast layer"),
      mask = bits(options.mask ?? 0xffff_ffff, "shape-cast mask");
    let value: unknown;
    try {
      value = JSON.parse(
        this.#wasm.cast_shape_json(
          Float32Array.from(position),
          Float32Array.from(rotation),
          Float32Array.from(direction),
          maxDistance,
          JSON.stringify(shape),
          layer,
          mask,
          options.includeSensors ?? false,
        ),
      );
    } catch (error) {
      throw new Error(`Rust 3D physics shape cast failed: ${message(error)}`, {
        cause: error,
      });
    }
    if (value === null) return undefined;
    if (!isShapeHit(value))
      throw new Error("Rust 3D physics returned a malformed shape-cast hit.");
    return value;
  }
  moveCharacter(
    timestep: number,
    position: readonly [number, number, number],
    rotation: readonly [number, number, number, number],
    desiredTranslation: readonly [number, number, number],
    options: CharacterController3dOptions,
  ): CharacterMovement3d {
    positive(timestep, "character timestep");
    vector(position, "character position");
    quaternion(rotation);
    vector(desiredTranslation, "character desired translation");
    validateShape(options.shape);
    const descriptor = characterDefaults(options);
    let value: unknown;
    try {
      value = JSON.parse(
        this.#wasm.move_character_json(
          timestep,
          Float32Array.from(position),
          Float32Array.from(rotation),
          Float32Array.from(desiredTranslation),
          JSON.stringify(descriptor),
        ),
      );
    } catch (error) {
      throw new Error(
        `Rust 3D character controller failed: ${message(error)}`,
        { cause: error },
      );
    }
    if (!isCharacterMovement(value))
      throw new Error("Rust 3D physics returned malformed character movement.");
    return value;
  }
}

function defaults(
  value: PhysicsBodyDescriptor3d,
): Required<PhysicsBodyDescriptor3d> {
  vector(value.position, "body position");
  quaternion(value.rotation);
  validateShape(value.shape);
  return {
    ...value,
    position: [...value.position],
    rotation: [...value.rotation],
    linearVelocity: [...(value.linearVelocity ?? [0, 0, 0])],
    angularVelocity: [...(value.angularVelocity ?? [0, 0, 0])],
    gravityScale: value.gravityScale ?? 1,
    linearDamping: value.linearDamping ?? 0,
    angularDamping: value.angularDamping ?? 0,
    continuousCollisionDetection: value.continuousCollisionDetection ?? false,
    shape: structuredClone(value.shape),
    density: value.density ?? 1,
    friction: value.friction ?? 0.5,
    restitution: value.restitution ?? 0,
    sensor: value.sensor ?? false,
    layer: bits(value.layer ?? 1, "collision layer"),
    mask: bits(value.mask ?? 0xffff_ffff, "collision mask"),
  };
}
function validateShape(shape: ColliderShape3d): void {
  if (shape.type === "box") {
    vector(shape.halfExtents, "box half extents");
    if (shape.halfExtents.some((value) => value <= 0))
      throw new Error("Box half extents must be positive.");
    return;
  }
  if (shape.type === "sphere") {
    positive(shape.radius, "sphere radius");
    return;
  }
  if (shape.type === "capsule" || shape.type === "cylinder") {
    positive(shape.radius, `${shape.type} radius`);
    positive(shape.halfHeight, `${shape.type} half height`);
    return;
  }
  if (shape.type === "plane") {
    vector(shape.normal, "plane normal");
    if (shape.normal.every((value) => value === 0))
      throw new Error("Physics plane normal cannot be zero.");
    return;
  }
  if (shape.type === "convexMesh") {
    points(shape.points, "convex mesh", 4);
    return;
  }
  if (shape.type === "triangleMesh") {
    points(shape.vertices, "triangle mesh", 3);
    if (shape.indices.length === 0)
      throw new Error("Physics triangle mesh needs at least one triangle.");
    for (const triangle of shape.indices)
      if (
        triangle.length !== 3 ||
        triangle.some(
          (index) =>
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index >= shape.vertices.length,
        )
      )
        throw new Error(
          "Physics triangle mesh indices must reference three existing vertices.",
        );
    return;
  }
  if (shape.type === "compound") {
    if (shape.children.length === 0)
      throw new Error("Physics compound collider needs at least one child.");
    for (const [index, child] of shape.children.entries()) {
      vector(child.position, `compound child ${String(index)} position`);
      quaternion(child.rotation);
      validateShape(child.shape);
    }
    return;
  }
  if (
    !Number.isSafeInteger(shape.rows) ||
    !Number.isSafeInteger(shape.columns) ||
    shape.rows < 2 ||
    shape.columns < 2
  )
    throw new Error(
      "Physics heightfield requires integer rows and columns of at least 2.",
    );
  if (
    shape.heights.length !== shape.rows * shape.columns ||
    !shape.heights.every(Number.isFinite)
  )
    throw new Error(
      `Physics heightfield requires exactly ${String(shape.rows * shape.columns)} finite heights.`,
    );
  vector(shape.scale, "heightfield scale");
  if (shape.scale.some((value) => value <= 0))
    throw new Error("Physics heightfield scale must be positive.");
}
function points(
  value: readonly (readonly number[])[],
  label: string,
  minimum: number,
): void {
  if (value.length < minimum)
    throw new Error(
      `Physics ${label} needs at least ${String(minimum)} points.`,
    );
  for (const point of value) vector(point, `${label} point`);
}
function characterDefaults(value: CharacterController3dOptions) {
  const offset = value.offset ?? 0.01,
    stepWidth = value.autostepMinWidth ?? 0.2,
    climb = value.maxSlopeClimbDegrees ?? 45,
    slideAngle = value.minSlopeSlideDegrees ?? 50;
  positive(offset, "character offset");
  positive(stepWidth, "character autostep minimum width");
  angle(climb, "maximum slope climb");
  angle(slideAngle, "minimum slope slide");
  if (value.autostepMaxHeight !== undefined && value.autostepMaxHeight !== null)
    positive(value.autostepMaxHeight, "character autostep maximum height");
  if (
    value.snapToGround !== undefined &&
    value.snapToGround !== null &&
    value.snapToGround < 0
  )
    throw new Error(
      "Physics character ground snap distance must be non-negative.",
    );
  return {
    shape: structuredClone(value.shape),
    offset,
    slide: value.slide ?? true,
    autostepMaxHeight:
      value.autostepMaxHeight === undefined ? 0.3 : value.autostepMaxHeight,
    autostepMinWidth: stepWidth,
    autostepDynamicBodies: value.autostepDynamicBodies ?? false,
    maxSlopeClimbDegrees: climb,
    minSlopeSlideDegrees: slideAngle,
    snapToGround: value.snapToGround === undefined ? 0.2 : value.snapToGround,
    layer: bits(value.layer ?? 1, "character layer"),
    mask: bits(value.mask ?? 0xffff_ffff, "character mask"),
    includeSensors: value.includeSensors ?? false,
  };
}
function validateId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error("Physics body ID must be a positive safe integer.");
}
function vector(value: readonly number[], label: string): void {
  if (value.length !== 3 || !value.every(Number.isFinite))
    throw new Error(`Physics ${label} requires 3 finite numbers.`);
}
function quaternion(value: readonly number[]): void {
  if (value.length !== 4 || !value.every(Number.isFinite))
    throw new Error("Physics rotation requires 4 finite quaternion numbers.");
  if (value.every((item) => item === 0))
    throw new Error("Physics rotation quaternion cannot have zero length.");
}
function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Physics ${label} must be finite and positive.`);
}
function bits(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new Error(`Physics ${label} must be an unsigned 32-bit integer.`);
  return value;
}
function validateStep(value: unknown): PhysicsStep3d {
  if (typeof value !== "object" || value === null)
    throw new Error("Rust 3D physics step must be an object.");
  const step = value as Partial<PhysicsStep3d>;
  if (!Array.isArray(step.bodies) || !Array.isArray(step.events))
    throw new Error("Rust 3D physics step requires bodies and events arrays.");
  return step as PhysicsStep3d;
}
function isRayHit(value: unknown): value is RaycastHit3d {
  if (typeof value !== "object" || value === null) return false;
  const hit = value as Partial<RaycastHit3d>;
  return (
    Number.isSafeInteger(hit.bodyId) &&
    typeof hit.distance === "number" &&
    Number.isFinite(hit.distance) &&
    Array.isArray(hit.point) &&
    hit.point.length === 3 &&
    Array.isArray(hit.normal) &&
    hit.normal.length === 3
  );
}
function isShapeHit(value: unknown): value is ShapeCastHit3d {
  if (typeof value !== "object" || value === null) return false;
  const hit = value as Partial<ShapeCastHit3d>;
  return (
    Number.isSafeInteger(hit.bodyId) &&
    typeof hit.distance === "number" &&
    Number.isFinite(hit.distance) &&
    Array.isArray(hit.position) &&
    hit.position.length === 3 &&
    Array.isArray(hit.normal) &&
    hit.normal.length === 3
  );
}
function isCharacterMovement(value: unknown): value is CharacterMovement3d {
  if (typeof value !== "object" || value === null) return false;
  const movement = value as Partial<CharacterMovement3d>;
  return (
    Array.isArray(movement.translation) &&
    movement.translation.length === 3 &&
    movement.translation.every(Number.isFinite) &&
    typeof movement.grounded === "boolean" &&
    typeof movement.slidingDownSlope === "boolean" &&
    Array.isArray(movement.collisions) &&
    movement.collisions.every((id) => Number.isSafeInteger(id) && id > 0)
  );
}
function angle(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 90)
    throw new Error(
      `Physics character ${label} must be between 0 and 90 degrees.`,
    );
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validates a joint before it crosses the WASM boundary.
 *
 * The Rust side rejects bad joints too, but its error arrives as an opaque
 * string from inside a command batch. Checking here names the field and the
 * joint, which is the difference between a fixable message and a puzzle.
 */
export function validateJoint3d(spec: JointSpec3d): JointSpec3d {
  if (!Number.isInteger(spec.id) || spec.id <= 0)
    throw new Error(
      `A joint id must be a positive whole number (got ${spec.id}).`,
    );
  if (spec.bodyA === spec.bodyB)
    throw new Error(
      `Joint ${spec.id} cannot connect body ${spec.bodyA} to itself.`,
    );
  const finite = (values: readonly number[], label: string): void => {
    if (values.some((value) => !Number.isFinite(value)))
      throw new Error(`Joint ${spec.id} has a non-finite ${label}.`);
  };
  finite(spec.joint.anchorA, "anchorA");
  finite(spec.joint.anchorB, "anchorB");

  if (spec.joint.kind === "hinge" || spec.joint.kind === "slider") {
    finite(spec.joint.axis, "axis");
    if (Math.hypot(...spec.joint.axis) < 1e-6)
      throw new Error(`Joint ${spec.id} has a zero-length axis.`);
    if (spec.joint.limits) {
      finite(spec.joint.limits, "limits");
      if (spec.joint.limits[0] > spec.joint.limits[1]) {
        throw new Error(
          `Joint ${spec.id} has limits [${spec.joint.limits.join(", ")}], which must be ordered as [min, max].`,
        );
      }
    }
    if (spec.joint.motor) {
      finite(spec.joint.motor, "motor");
      if (spec.joint.motor[1] < 0)
        throw new Error(`Joint ${spec.id} has a negative motor force.`);
    }
  }
  if (spec.joint.kind === "spring") {
    for (const [value, label] of [
      [spec.joint.restLength, "restLength"],
      [spec.joint.stiffness, "stiffness"],
      [spec.joint.damping, "damping"],
    ] as const) {
      if (!Number.isFinite(value) || value < 0)
        throw new Error(
          `Joint ${spec.id} has a negative or non-finite ${label}.`,
        );
    }
  }
  return spec;
}

/** A joint command, validated. */
export function addJointCommand(spec: JointSpec3d): PhysicsCommand3d {
  return { type: "addJoint", spec: validateJoint3d(spec) };
}

/** A hinge, which is what a door, a lid, an elbow, and a wheel all are. */
export function hingeJoint(
  id: number,
  bodyA: number,
  bodyB: number,
  options: {
    readonly anchorA: readonly [number, number, number];
    readonly anchorB: readonly [number, number, number];
    readonly axis?: readonly [number, number, number];
    readonly limits?: readonly [number, number];
    readonly motor?: readonly [number, number];
  },
): JointSpec3d {
  return validateJoint3d({
    id,
    bodyA,
    bodyB,
    joint: {
      kind: "hinge",
      anchorA: options.anchorA,
      anchorB: options.anchorB,
      axis: options.axis ?? [0, 1, 0],
      ...(options.limits ? { limits: options.limits } : {}),
      ...(options.motor ? { motor: options.motor } : {}),
    },
  });
}

/**
 * A ragdoll: one ball joint per limb connection.
 *
 * Built from a character's bone positions, so the joints line up with the
 * capsules the asset system already generated for the same skeleton. The two
 * agreeing is what stops a ragdoll from folding through its own body.
 */
export function ragdollJoints(
  bodies: readonly {
    readonly id: number;
    readonly bone: string;
    readonly position: readonly [number, number, number];
  }[],
  connections: readonly (readonly [string, string])[],
  firstJointId = 1,
): readonly JointSpec3d[] {
  const byBone = new Map(bodies.map((body) => [body.bone, body]));
  const joints: JointSpec3d[] = [];
  let id = firstJointId;
  for (const [parent, child] of connections) {
    const a = byBone.get(parent);
    const b = byBone.get(child);
    if (!a || !b) continue;
    // The anchor is the child's origin, expressed in each body's local space.
    joints.push(
      validateJoint3d({
        id: id++,
        bodyA: a.id,
        bodyB: b.id,
        joint: {
          kind: "ball",
          anchorA: [
            b.position[0] - a.position[0],
            b.position[1] - a.position[1],
            b.position[2] - a.position[2],
          ],
          anchorB: [0, 0, 0],
        },
      }),
    );
  }
  return joints;
}

/** The connections a humanoid ragdoll needs, in the standard bone names. */
export const HUMANOID_RAGDOLL_CONNECTIONS: readonly (readonly [
  string,
  string,
])[] = [
  ["Hips", "Spine"],
  ["Spine", "Chest"],
  ["Chest", "Head"],
  ["Chest", "LeftUpperArm"],
  ["LeftUpperArm", "LeftLowerArm"],
  ["LeftLowerArm", "LeftHand"],
  ["Chest", "RightUpperArm"],
  ["RightUpperArm", "RightLowerArm"],
  ["RightLowerArm", "RightHand"],
  ["Hips", "LeftUpperLeg"],
  ["LeftUpperLeg", "LeftLowerLeg"],
  ["LeftLowerLeg", "LeftFoot"],
  ["Hips", "RightUpperLeg"],
  ["RightUpperLeg", "RightLowerLeg"],
  ["RightLowerLeg", "RightFoot"],
];
