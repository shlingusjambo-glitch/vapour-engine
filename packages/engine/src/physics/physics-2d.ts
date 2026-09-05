import type { PhysicsEventKind } from "./physics-3d.js";

export type PhysicsBodyType2d = "static" | "dynamic" | "kinematicPosition" | "kinematicVelocity";
export type ColliderShape2d =
  | { readonly type: "rectangle"; readonly halfExtents: readonly [number, number] }
  | { readonly type: "circle"; readonly radius: number }
  | { readonly type: "capsule"; readonly halfHeight: number; readonly radius: number }
  | { readonly type: "convexPolygon"; readonly points: readonly (readonly [number, number])[] };
export interface PhysicsBodyDescriptor2d {
  readonly id: number; readonly bodyType: PhysicsBodyType2d;
  readonly position: readonly [number, number]; readonly rotation?: number;
  readonly linearVelocity?: readonly [number, number]; readonly angularVelocity?: number;
  readonly gravityScale?: number; readonly linearDamping?: number; readonly angularDamping?: number;
  readonly continuousCollisionDetection?: boolean; readonly shape: ColliderShape2d;
  readonly density?: number; readonly friction?: number; readonly restitution?: number; readonly sensor?: boolean;
  readonly layer?: number; readonly mask?: number;
}
export interface PhysicsEvent2d { readonly kind: PhysicsEventKind; readonly bodyA: number; readonly bodyB: number; }
export interface PhysicsBodySnapshot2d { readonly id: number; readonly position: readonly [number, number]; readonly rotation: number; readonly linearVelocity: readonly [number, number]; readonly angularVelocity: number; readonly sleeping: boolean; }
export interface PhysicsStep2d { readonly bodies: readonly PhysicsBodySnapshot2d[]; readonly events: readonly PhysicsEvent2d[]; }
export interface RaycastHit2d { readonly bodyId: number; readonly distance: number; readonly point: readonly [number, number]; readonly normal: readonly [number, number]; }
export interface ShapeCastHit2d { readonly bodyId: number; readonly distance: number; readonly position: readonly [number, number]; readonly normal: readonly [number, number]; }
export interface CharacterController2dOptions { readonly shape: ColliderShape2d; readonly offset?: number; readonly slide?: boolean; readonly autostepMaxHeight?: number | null; readonly autostepMinWidth?: number; readonly autostepDynamicBodies?: boolean; readonly maxSlopeClimbDegrees?: number; readonly minSlopeSlideDegrees?: number; readonly snapToGround?: number | null; readonly layer?: number; readonly mask?: number; readonly includeSensors?: boolean; }
export interface CharacterMovement2d { readonly translation: readonly [number, number]; readonly grounded: boolean; readonly slidingDownSlope: boolean; readonly collisions: readonly number[]; }
type CompleteDescriptor2d = Omit<Required<PhysicsBodyDescriptor2d>, "shape"> & { readonly shape: ColliderShape2d };
export type PhysicsCommand2d =
  | { readonly type: "insert"; readonly descriptor: CompleteDescriptor2d }
  | { readonly type: "remove"; readonly id: number }
  | { readonly type: "addForce"; readonly id: number; readonly force: readonly [number, number] }
  | { readonly type: "addForceAtPoint"; readonly id: number; readonly force: readonly [number, number]; readonly point: readonly [number, number] }
  | { readonly type: "addTorque"; readonly id: number; readonly torque: number }
  | { readonly type: "applyImpulse"; readonly id: number; readonly impulse: readonly [number, number] }
  | { readonly type: "applyTorqueImpulse"; readonly id: number; readonly torque: number }
  | { readonly type: "setLinearVelocity"; readonly id: number; readonly velocity: readonly [number, number] }
  | { readonly type: "setAngularVelocity"; readonly id: number; readonly velocity: number }
  | { readonly type: "setKinematicTarget"; readonly id: number; readonly position: readonly [number, number]; readonly rotation: number }
  | { readonly type: "setGravity"; readonly gravity: readonly [number, number] };

export interface PhysicsEngine2dWasm {
  apply_commands(json: string): number;
  step_json(timestep: number): string;
  raycast_json(origin: Float32Array, direction: Float32Array, maxDistance: number, layer: number, mask: number, includeSensors: boolean): string;
  overlap_shape_json(position: Float32Array, rotation: number, shape: string, layer: number, mask: number, includeSensors: boolean): string;
  cast_shape_json(position: Float32Array, rotation: number, direction: Float32Array, maxDistance: number, shape: string, layer: number, mask: number, includeSensors: boolean): string;
  move_character_json(timestep: number, position: Float32Array, rotation: number, desiredTranslation: Float32Array, descriptor: string): string;
  body_count(): number;
  free(): void;
}
interface PhysicsWasmModule { default(moduleOrPath?: WebAssembly.Module | URL | RequestInfo): Promise<unknown>; PhysicsEngine2d: new (gravityX: number, gravityY: number) => PhysicsEngine2dWasm; }
export type PhysicsWasmModuleLoader2d = (moduleUrl: string) => Promise<PhysicsWasmModule>;
export interface CreatePhysicsWorld2dOptions { readonly gravity?: readonly [number, number]; readonly moduleUrl?: string; readonly loadModule?: PhysicsWasmModuleLoader2d; }

/** Loads the shared Rust/WASM artifact and constructs a native 2D world. */
export async function createPhysicsWorld2d(options: CreatePhysicsWorld2dOptions = {}): Promise<PhysicsWorld2dBridge> {
  const gravity = options.gravity ?? [0, -9.81]; vector2(gravity, "gravity");
  const moduleUrl = options.moduleUrl ?? "/vapour_runtime.js";
  const loader = options.loadModule ?? (async (url) => await import(/* @vite-ignore */ url) as PhysicsWasmModule);
  try {
    const module = await loader(moduleUrl); await module.default();
    return new PhysicsWorld2dBridge(new module.PhysicsEngine2d(gravity[0], gravity[1]));
  } catch (error) { throw new Error(`Vapour's Rust 2D physics runtime could not load from '${moduleUrl}': ${message(error)}`, { cause: error }); }
}

/** Batched, language-neutral facade shared by VS and TypeScript gameplay. */
export class PhysicsWorld2dBridge {
  readonly #wasm: PhysicsEngine2dWasm;
  readonly #commands: PhysicsCommand2d[] = [];
  constructor(wasm: PhysicsEngine2dWasm) { this.#wasm = wasm; }
  get pendingCommands(): number { return this.#commands.length; }
  get bodyCount(): number { return this.#wasm.body_count(); }
  destroy(): void { this.#commands.length = 0; this.#wasm.free(); }
  insert(descriptor: PhysicsBodyDescriptor2d): void { validateId(descriptor.id); this.#commands.push({ type: "insert", descriptor: defaults(descriptor) }); }
  remove(id: number): void { validateId(id); this.#commands.push({ type: "remove", id }); }
  addForce(id: number, force: readonly [number, number]): void { validateId(id); vector2(force, "force"); this.#commands.push({ type: "addForce", id, force: [...force] }); }
  addForceAtPoint(id: number, force: readonly [number, number], point: readonly [number, number]): void { validateId(id); vector2(force, "force"); vector2(point, "force point"); this.#commands.push({ type: "addForceAtPoint", id, force: [...force], point: [...point] }); }
  addTorque(id: number, torque: number): void { validateId(id); finite(torque, "torque"); this.#commands.push({ type: "addTorque", id, torque }); }
  applyImpulse(id: number, impulse: readonly [number, number]): void { validateId(id); vector2(impulse, "impulse"); this.#commands.push({ type: "applyImpulse", id, impulse: [...impulse] }); }
  applyTorqueImpulse(id: number, torque: number): void { validateId(id); finite(torque, "torque impulse"); this.#commands.push({ type: "applyTorqueImpulse", id, torque }); }
  setLinearVelocity(id: number, velocity: readonly [number, number]): void { validateId(id); vector2(velocity, "linear velocity"); this.#commands.push({ type: "setLinearVelocity", id, velocity: [...velocity] }); }
  setAngularVelocity(id: number, velocity: number): void { validateId(id); finite(velocity, "angular velocity"); this.#commands.push({ type: "setAngularVelocity", id, velocity }); }
  setKinematicTarget(id: number, position: readonly [number, number], rotation: number): void { validateId(id); vector2(position, "kinematic position"); finite(rotation, "kinematic rotation"); this.#commands.push({ type: "setKinematicTarget", id, position: [...position], rotation }); }
  setGravity(gravity: readonly [number, number]): void { vector2(gravity, "gravity"); this.#commands.push({ type: "setGravity", gravity: [...gravity] }); }
  flush(): number {
    if (this.#commands.length === 0) return 0;
    const count = this.#commands.length;
    try { const applied = this.#wasm.apply_commands(JSON.stringify(this.#commands)); this.#commands.length = 0; return applied; }
    catch (error) { throw new Error(`Rust 2D physics rejected a ${String(count)}-command batch: ${message(error)}`, { cause: error }); }
  }
  step(timestep: number): PhysicsStep2d {
    if (!Number.isFinite(timestep) || timestep <= 0) throw new Error("2D physics timestep must be finite and positive.");
    this.flush();
    let value: unknown;
    try { value = JSON.parse(this.#wasm.step_json(timestep)); }
    catch (error) { throw new Error(`Rust 2D physics returned an invalid step: ${message(error)}`, { cause: error }); }
    if (typeof value !== "object" || value === null || !Array.isArray((value as Partial<PhysicsStep2d>).bodies) || !Array.isArray((value as Partial<PhysicsStep2d>).events)) throw new Error("Rust 2D physics step requires bodies and events arrays.");
    return value as PhysicsStep2d;
  }
  raycast(origin: readonly [number, number], direction: readonly [number, number], maxDistance: number, options: { readonly layer?: number; readonly mask?: number; readonly includeSensors?: boolean } = {}): RaycastHit2d | undefined {
    vector2(origin, "ray origin"); vector2(direction, "ray direction"); positive(maxDistance, "ray maximum distance");
    const layer = bits(options.layer ?? 1, "ray layer"), mask = bits(options.mask ?? 0xffff_ffff, "ray mask");
    let value: unknown;
    try { value = JSON.parse(this.#wasm.raycast_json(Float32Array.from(origin), Float32Array.from(direction), maxDistance, layer, mask, options.includeSensors ?? false)); }
    catch (error) { throw new Error(`Rust 2D physics raycast failed: ${message(error)}`, { cause: error }); }
    if (value === null) return undefined;
    if (!isRayHit(value)) throw new Error("Rust 2D physics returned a malformed raycast hit.");
    return value;
  }
  overlapShape(position: readonly [number, number], rotation: number, shape: ColliderShape2d, options: { readonly layer?: number; readonly mask?: number; readonly includeSensors?: boolean } = {}): readonly number[] {
    vector2(position, "overlap position"); finite(rotation, "overlap rotation"); validateShape(shape);
    const layer = bits(options.layer ?? 1, "overlap layer"), mask = bits(options.mask ?? 0xffff_ffff, "overlap mask");
    let value: unknown;
    try { value = JSON.parse(this.#wasm.overlap_shape_json(Float32Array.from(position), rotation, JSON.stringify(shape), layer, mask, options.includeSensors ?? false)); }
    catch (error) { throw new Error(`Rust 2D physics overlap failed: ${message(error)}`, { cause: error }); }
    if (!Array.isArray(value) || !value.every((id) => Number.isSafeInteger(id) && id > 0)) throw new Error("Rust 2D physics returned malformed overlap IDs.");
    return value;
  }
  castShape(position: readonly [number, number], rotation: number, direction: readonly [number, number], maxDistance: number, shape: ColliderShape2d, options: { readonly layer?: number; readonly mask?: number; readonly includeSensors?: boolean } = {}): ShapeCastHit2d | undefined {
    vector2(position, "shape-cast position"); finite(rotation, "shape-cast rotation"); vector2(direction, "shape-cast direction"); positive(maxDistance, "shape-cast maximum distance"); validateShape(shape);
    const layer = bits(options.layer ?? 1, "shape-cast layer"), mask = bits(options.mask ?? 0xffff_ffff, "shape-cast mask");
    let value: unknown;
    try { value = JSON.parse(this.#wasm.cast_shape_json(Float32Array.from(position), rotation, Float32Array.from(direction), maxDistance, JSON.stringify(shape), layer, mask, options.includeSensors ?? false)); }
    catch (error) { throw new Error(`Rust 2D physics shape cast failed: ${message(error)}`, { cause: error }); }
    if (value === null) return undefined;
    if (!isShapeHit(value)) throw new Error("Rust 2D physics returned a malformed shape-cast hit.");
    return value;
  }
  moveCharacter(timestep: number, position: readonly [number, number], rotation: number, desiredTranslation: readonly [number, number], options: CharacterController2dOptions): CharacterMovement2d {
    positive(timestep, "character timestep"); vector2(position, "character position"); finite(rotation, "character rotation"); vector2(desiredTranslation, "character desired translation"); validateShape(options.shape);
    const descriptor = characterDefaults(options); let value: unknown;
    try { value = JSON.parse(this.#wasm.move_character_json(timestep, Float32Array.from(position), rotation, Float32Array.from(desiredTranslation), JSON.stringify(descriptor))); }
    catch (error) { throw new Error(`Rust 2D character controller failed: ${message(error)}`, { cause: error }); }
    if (!isCharacterMovement(value, 2)) throw new Error("Rust 2D physics returned malformed character movement.");
    return value as CharacterMovement2d;
  }
}

function defaults(value: PhysicsBodyDescriptor2d): CompleteDescriptor2d {
  vector2(value.position, "body position"); finite(value.rotation ?? 0, "body rotation"); validateShape(value.shape);
  return { ...value, position: [...value.position], rotation: value.rotation ?? 0, linearVelocity: [...(value.linearVelocity ?? [0, 0])], angularVelocity: value.angularVelocity ?? 0, gravityScale: value.gravityScale ?? 1, linearDamping: value.linearDamping ?? 0, angularDamping: value.angularDamping ?? 0, continuousCollisionDetection: value.continuousCollisionDetection ?? false, shape: structuredClone(value.shape), density: value.density ?? 1, friction: value.friction ?? 0.5, restitution: value.restitution ?? 0, sensor: value.sensor ?? false, layer: bits(value.layer ?? 1, "collision layer"), mask: bits(value.mask ?? 0xffff_ffff, "collision mask") };
}
function validateShape(shape: ColliderShape2d): void {
  if (shape.type === "rectangle") { vector2(shape.halfExtents, "rectangle half extents"); if (shape.halfExtents.some((value) => value <= 0)) throw new Error("Rectangle half extents must be positive."); }
  else if (shape.type === "convexPolygon") { if (shape.points.length < 3) throw new Error("Convex polygon requires at least three points."); shape.points.forEach((point) => vector2(point, "convex polygon point")); }
  else { positive(shape.radius, `${shape.type} radius`); if (shape.type === "capsule") positive(shape.halfHeight, "capsule half height"); }
}
function characterDefaults(value: CharacterController2dOptions) { const offset = value.offset ?? 0.01, stepWidth = value.autostepMinWidth ?? 0.2, climb = value.maxSlopeClimbDegrees ?? 45, slideAngle = value.minSlopeSlideDegrees ?? 50; positive(offset, "character offset"); positive(stepWidth, "character autostep minimum width"); angle(climb, "maximum slope climb"); angle(slideAngle, "minimum slope slide"); if (value.autostepMaxHeight !== undefined && value.autostepMaxHeight !== null) positive(value.autostepMaxHeight, "character autostep maximum height"); if (value.snapToGround !== undefined && value.snapToGround !== null && value.snapToGround < 0) throw new Error("Physics character ground snap distance must be non-negative."); return { shape: structuredClone(value.shape), offset, slide: value.slide ?? true, autostepMaxHeight: value.autostepMaxHeight === undefined ? 0.3 : value.autostepMaxHeight, autostepMinWidth: stepWidth, autostepDynamicBodies: value.autostepDynamicBodies ?? false, maxSlopeClimbDegrees: climb, minSlopeSlideDegrees: slideAngle, snapToGround: value.snapToGround === undefined ? 0.2 : value.snapToGround, layer: bits(value.layer ?? 1, "character layer"), mask: bits(value.mask ?? 0xffff_ffff, "character mask"), includeSensors: value.includeSensors ?? false }; }
function validateId(id: number): void { if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Physics body ID must be a positive safe integer."); }
function vector2(value: readonly number[], label: string): void { if (value.length !== 2 || !value.every(Number.isFinite)) throw new Error(`Physics ${label} requires 2 finite numbers.`); }
function finite(value: number, label: string): void { if (!Number.isFinite(value)) throw new Error(`Physics ${label} must be finite.`); }
function positive(value: number, label: string): void { if (!Number.isFinite(value) || value <= 0) throw new Error(`Physics ${label} must be finite and positive.`); }
function bits(value: number, label: string): number { if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`Physics ${label} must be an unsigned 32-bit integer.`); return value; }
function isRayHit(value: unknown): value is RaycastHit2d { if (typeof value !== "object" || value === null) return false; const hit = value as Partial<RaycastHit2d>; return Number.isSafeInteger(hit.bodyId) && typeof hit.distance === "number" && Number.isFinite(hit.distance) && Array.isArray(hit.point) && hit.point.length === 2 && Array.isArray(hit.normal) && hit.normal.length === 2; }
function isShapeHit(value: unknown): value is ShapeCastHit2d { if (typeof value !== "object" || value === null) return false; const hit = value as Partial<ShapeCastHit2d>; return Number.isSafeInteger(hit.bodyId) && typeof hit.distance === "number" && Number.isFinite(hit.distance) && Array.isArray(hit.position) && hit.position.length === 2 && Array.isArray(hit.normal) && hit.normal.length === 2; }
function isCharacterMovement(value: unknown, dimensions: number): boolean { if (typeof value !== "object" || value === null) return false; const movement = value as Partial<CharacterMovement2d>; return Array.isArray(movement.translation) && movement.translation.length === dimensions && movement.translation.every(Number.isFinite) && typeof movement.grounded === "boolean" && typeof movement.slidingDownSlope === "boolean" && Array.isArray(movement.collisions) && movement.collisions.every((id) => Number.isSafeInteger(id) && id > 0); }
function angle(value: number, label: string): void { if (!Number.isFinite(value) || value < 0 || value > 90) throw new Error(`Physics character ${label} must be between 0 and 90 degrees.`); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
