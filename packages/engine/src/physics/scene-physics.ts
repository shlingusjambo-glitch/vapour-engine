import { builtinComponentSchemas, normalizeComponentData, ComponentSchemaRegistry } from "../core/component-schema.js";
import type { PhysicsBodyDescriptor2d, PhysicsEvent2d, PhysicsWorld2dBridge } from "./physics-2d.js";
import type { PhysicsBodyDescriptor3d, PhysicsEvent3d, PhysicsWorld3dBridge } from "./physics-3d.js";
import type { SceneDocument, SceneEntityData, TransformData } from "../core/scene-document.js";

export type ScenePhysicsDimension = "2d" | "3d";
export interface ScenePhysicsContact {
  readonly dimension: ScenePhysicsDimension;
  readonly kind: PhysicsEvent2d["kind"];
  readonly entityA: string;
  readonly entityB: string;
}
export interface ScenePhysicsRuntimeOptions {
  readonly physics2d?: PhysicsWorld2dBridge;
  readonly physics3d?: PhysicsWorld3dBridge;
  readonly onContact?: (contact: ScenePhysicsContact) => void;
}
export interface SceneCharacterMovement2d { readonly translation: readonly [number, number]; readonly grounded: boolean; readonly slidingDownSlope: boolean; readonly collisions: readonly string[]; }
export interface SceneCharacterMovement3d { readonly translation: readonly [number, number, number]; readonly grounded: boolean; readonly slidingDownSlope: boolean; readonly collisions: readonly string[]; }

interface BoundBody { readonly id: number; readonly dimension: ScenePhysicsDimension; readonly fingerprint: string; readonly bodyType: string; }

/**
 * Owns the scene-to-native-physics contract. It incrementally reconciles
 * serialized components, advances both native worlds, writes dynamic poses
 * back into the scene, and translates numeric solver IDs into stable scene IDs.
 */
export class ScenePhysicsRuntime {
  readonly #scene: SceneDocument;
  readonly #physics2d: PhysicsWorld2dBridge | undefined;
  readonly #physics3d: PhysicsWorld3dBridge | undefined;
  readonly #onContact: ((contact: ScenePhysicsContact) => void) | undefined;
  readonly #schemas = new ComponentSchemaRegistry(builtinComponentSchemas());
  readonly #bound = new Map<string, BoundBody>();
  readonly #entityByBody = new Map<number, string>();
  #destroyed = false;

  constructor(scene: SceneDocument, options: ScenePhysicsRuntimeOptions) {
    this.#scene = scene;
    this.#physics2d = options.physics2d;
    this.#physics3d = options.physics3d;
    this.#onContact = options.onContact;
    if (this.#physics2d === undefined && this.#physics3d === undefined) throw new Error("ScenePhysicsRuntime requires a 2D or 3D native physics world.");
  }

  get bodyCount(): number { return this.#bound.size; }

  /** Reconciles serialized bodies before gameplay scripts issue queries. */
  prepare(): void { this.#alive(); this.#reconcile(); this.#physics2d?.flush(); this.#physics3d?.flush(); }

  moveCharacter2d(entityId: string, desiredTranslation: readonly [number, number], timestep: number): SceneCharacterMovement2d {
    this.prepare();
    const entity = this.#requireEntity(entityId), record = component(entity, "vapour.CharacterController2D");
    if (record === undefined) throw new Error(`Entity '${entity.name}' has no Character Controller 2D component.`);
    if (component(entity, "vapour.Collider2D") !== undefined) throw new Error(`Character '${entity.name}' cannot also have a Collider 2D; the controller owns its swept shape.`);
    if (this.#physics2d === undefined) throw new Error(`Character '${entity.name}' requires a configured 2D physics world.`);
    const data = normalized(this.#schemas, "vapour.CharacterController2D", record.data), pose = transform(entity);
    const size = tuple(data.size, 2, "CharacterController2D.size"), radius = number(data.radius, "CharacterController2D.radius"), shapeName = text(data.shape, "CharacterController2D.shape");
    const shape: PhysicsBodyDescriptor2d["shape"] = shapeName === "circle" ? { type: "circle", radius } : shapeName === "rectangle" ? { type: "rectangle", halfExtents: [size[0]! * 0.5, size[1]! * 0.5] } : { type: "capsule", halfHeight: Math.max(0.001, size[1]! * 0.5 - radius), radius };
    const result = this.#physics2d.moveCharacter(timestep, [pose.position[0], pose.position[1]], yaw(pose.rotation), desiredTranslation, characterOptions(data, shape));
    this.#scene.setTransform(entityId, { ...pose, position: [pose.position[0] + result.translation[0], pose.position[1] + result.translation[1], pose.position[2]] });
    return { ...result, collisions: result.collisions.flatMap((id) => { const value = this.#entityByBody.get(id); return value === undefined ? [] : [value]; }) };
  }

  moveCharacter3d(entityId: string, desiredTranslation: readonly [number, number, number], timestep: number): SceneCharacterMovement3d {
    this.prepare();
    const entity = this.#requireEntity(entityId), record = component(entity, "vapour.CharacterController3D");
    if (record === undefined) throw new Error(`Entity '${entity.name}' has no Character Controller 3D component.`);
    if (component(entity, "vapour.Collider3D") !== undefined) throw new Error(`Character '${entity.name}' cannot also have a Collider 3D; the controller owns its swept shape.`);
    if (this.#physics3d === undefined) throw new Error(`Character '${entity.name}' requires a configured 3D physics world.`);
    const data = normalized(this.#schemas, "vapour.CharacterController3D", record.data), pose = transform(entity);
    const size = tuple(data.size, 3, "CharacterController3D.size"), radius = number(data.radius, "CharacterController3D.radius"), shapeName = text(data.shape, "CharacterController3D.shape");
    const shape: PhysicsBodyDescriptor3d["shape"] = shapeName === "sphere" ? { type: "sphere", radius } : shapeName === "box" ? { type: "box", halfExtents: [size[0]! * 0.5, size[1]! * 0.5, size[2]! * 0.5] } : { type: "capsule", halfHeight: Math.max(0.001, size[1]! * 0.5 - radius), radius };
    const result = this.#physics3d.moveCharacter(timestep, pose.position, pose.rotation, desiredTranslation, characterOptions(data, shape));
    this.#scene.setTransform(entityId, { ...pose, position: [pose.position[0] + result.translation[0], pose.position[1] + result.translation[1], pose.position[2] + result.translation[2]] });
    return { ...result, collisions: result.collisions.flatMap((id) => { const value = this.#entityByBody.get(id); return value === undefined ? [] : [value]; }) };
  }

  /** Reconciles authoring changes, performs one fixed step, and synchronizes
   * dynamic body poses. Call exactly once per GameRuntime fixed update. */
  fixedUpdate(timestep: number): readonly ScenePhysicsContact[] {
    this.#alive();
    const contacts: ScenePhysicsContact[] = [];
    this.#reconcile();
    this.#pushKinematicTargets();
    if (this.#physics2d !== undefined) {
      const step = this.#physics2d.step(timestep);
      for (const body of step.bodies) {
        const entityId = this.#entityByBody.get(body.id), binding = entityId === undefined ? undefined : this.#bound.get(entityId);
        if (entityId !== undefined && binding?.dimension === "2d" && binding.bodyType === "dynamic") {
          const current = transform(this.#requireEntity(entityId));
          const half = body.rotation * 0.5;
          this.#scene.setTransform(entityId, { ...current, position: [body.position[0], body.position[1], current.position[2]], rotation: [0, 0, Math.sin(half), Math.cos(half)] });
        }
      }
      this.#dispatch("2d", step.events, contacts);
    }
    if (this.#physics3d !== undefined) {
      const step = this.#physics3d.step(timestep);
      for (const body of step.bodies) {
        const entityId = this.#entityByBody.get(body.id), binding = entityId === undefined ? undefined : this.#bound.get(entityId);
        if (entityId !== undefined && binding?.dimension === "3d" && binding.bodyType === "dynamic") {
          const current = transform(this.#requireEntity(entityId));
          this.#scene.setTransform(entityId, { ...current, position: [...body.position], rotation: [...body.rotation] });
        }
      }
      this.#dispatch("3d", step.events, contacts);
    }
    return contacts;
  }

  /** Removes native bodies. The injected worlds remain caller-owned. */
  destroy(): void {
    if (this.#destroyed) return;
    for (const binding of this.#bound.values()) this.#remove(binding);
    this.#physics2d?.flush(); this.#physics3d?.flush();
    this.#bound.clear(); this.#entityByBody.clear(); this.#destroyed = true;
  }

  #reconcile(): void {
    const live = new Set<string>();
    for (const entity of this.#scene.data.entities) {
      if (!entity.enabled) continue;
      const candidate = this.#descriptor(entity);
      if (candidate === undefined) continue;
      live.add(entity.id);
      const existing = this.#bound.get(entity.id);
      if (existing?.fingerprint === candidate.fingerprint) continue;
      if (existing !== undefined) this.#remove(existing);
      const collision = this.#entityByBody.get(candidate.id);
      if (collision !== undefined && collision !== entity.id) throw new Error(`Physics ID collision between scene entities '${collision}' and '${entity.id}'. Change one entity ID.`);
      if (candidate.dimension === "2d") {
        if (this.#physics2d === undefined) throw new Error(`Entity '${entity.name}' requires 2D physics, but no 2D world was configured.`);
        this.#physics2d.insert(candidate.descriptor);
      } else {
        if (this.#physics3d === undefined) throw new Error(`Entity '${entity.name}' requires 3D physics, but no 3D world was configured.`);
        this.#physics3d.insert(candidate.descriptor);
      }
      const binding = { id: candidate.id, dimension: candidate.dimension, fingerprint: candidate.fingerprint, bodyType: candidate.descriptor.bodyType };
      this.#bound.set(entity.id, binding); this.#entityByBody.set(candidate.id, entity.id);
    }
    for (const [entityId, binding] of [...this.#bound]) if (!live.has(entityId)) { this.#remove(binding); this.#bound.delete(entityId); }
  }

  #descriptor(entity: SceneEntityData): ({ dimension: "2d"; id: number; fingerprint: string; descriptor: PhysicsBodyDescriptor2d } | { dimension: "3d"; id: number; fingerprint: string; descriptor: PhysicsBodyDescriptor3d }) | undefined {
    const collider2d = component(entity, "vapour.Collider2D"), collider3d = component(entity, "vapour.Collider3D");
    if (collider2d !== undefined && collider3d !== undefined) throw new Error(`Entity '${entity.name}' cannot have both 2D and 3D colliders.`);
    if (collider2d === undefined && collider3d === undefined) return undefined;
    const id = stablePhysicsId(entity.id), pose = transform(entity);
    if (collider2d !== undefined) {
      const collider = normalized(this.#schemas, "vapour.Collider2D", collider2d.data), rigid = optionalNormalized(this.#schemas, entity, "vapour.Rigidbody2D");
      const shapeName = text(collider.shape, "Collider2D.shape");
      const size = tuple(collider.size, 2, "Collider2D.size");
      const radius = number(collider.radius, "Collider2D.radius");
      const shape: PhysicsBodyDescriptor2d["shape"] = shapeName === "circle" ? { type: "circle", radius } : shapeName === "capsule" ? { type: "capsule", halfHeight: size[1]! * 0.5, radius } : { type: "rectangle", halfExtents: [size[0]! * 0.5, size[1]! * 0.5] };
      const descriptor: PhysicsBodyDescriptor2d = { id, bodyType: bodyType(rigid), position: [pose.position[0], pose.position[1]], rotation: yaw(pose.rotation), shape, ...bodySettings(rigid), ...colliderSettings(collider) };
      return { dimension: "2d", id, descriptor, fingerprint: fingerprint(descriptor) };
    }
    const collider = normalized(this.#schemas, "vapour.Collider3D", collider3d!.data), rigid = optionalNormalized(this.#schemas, entity, "vapour.Rigidbody3D");
    const shapeName = text(collider.shape, "Collider3D.shape"), size = tuple(collider.size, 3, "Collider3D.size"), radius = number(collider.radius, "Collider3D.radius"), height = number(collider.height, "Collider3D.height");
    const shape: PhysicsBodyDescriptor3d["shape"] = shapeName === "sphere" ? { type: "sphere", radius } : shapeName === "capsule" || shapeName === "cylinder" ? { type: shapeName, halfHeight: height * 0.5, radius } : { type: "box", halfExtents: [size[0]! * 0.5, size[1]! * 0.5, size[2]! * 0.5] };
    const descriptor: PhysicsBodyDescriptor3d = { id, bodyType: bodyType(rigid), position: [...pose.position], rotation: [...pose.rotation], shape, ...bodySettings(rigid), ...colliderSettings(collider) };
    return { dimension: "3d", id, descriptor, fingerprint: fingerprint(descriptor) };
  }

  #pushKinematicTargets(): void {
    for (const [entityId, binding] of this.#bound) {
      if (binding.bodyType !== "kinematicPosition") continue;
      const pose = transform(this.#requireEntity(entityId));
      if (binding.dimension === "2d") this.#physics2d!.setKinematicTarget(binding.id, [pose.position[0], pose.position[1]], yaw(pose.rotation));
      else this.#physics3d!.setKinematicTarget(binding.id, pose.position, pose.rotation);
    }
  }

  #dispatch(dimension: ScenePhysicsDimension, events: readonly (PhysicsEvent2d | PhysicsEvent3d)[], contacts: ScenePhysicsContact[]): void {
    for (const event of events) {
      const entityA = this.#entityByBody.get(event.bodyA), entityB = this.#entityByBody.get(event.bodyB);
      if (entityA !== undefined && entityB !== undefined) { const contact = { dimension, kind: event.kind, entityA, entityB }; contacts.push(contact); this.#onContact?.(contact); }
    }
  }
  #remove(binding: BoundBody): void { if (binding.dimension === "2d") this.#physics2d!.remove(binding.id); else this.#physics3d!.remove(binding.id); this.#entityByBody.delete(binding.id); }
  #requireEntity(id: string): SceneEntityData { const entity = this.#scene.entity(id); if (entity === undefined) throw new Error(`Physics body references removed entity '${id}'.`); return entity; }
  #alive(): void { if (this.#destroyed) throw new Error("ScenePhysicsRuntime has been destroyed."); }
}

function stablePhysicsId(value: string): number { let hash = 0xcbf29ce484222325n; for (const byte of new TextEncoder().encode(value)) { hash ^= BigInt(byte); hash = BigInt.asUintN(64, hash * 0x100000001b3n); } return Number(hash % 9007199254740990n) + 1; }
function fingerprint(descriptor: PhysicsBodyDescriptor2d | PhysicsBodyDescriptor3d): string {
  if (descriptor.bodyType !== "dynamic") return JSON.stringify(descriptor);
  const { position: _position, rotation: _rotation, ...simulationSettings } = descriptor;
  return JSON.stringify(simulationSettings);
}
function component(entity: SceneEntityData, typeName: string) { return entity.components.find((value) => value.typeName === typeName); }
function transform(entity: SceneEntityData): TransformData { const value = component(entity, "vapour.Transform")?.data as TransformData | undefined; if (value === undefined) throw new Error(`Physics entity '${entity.name}' has no Transform.`); return structuredClone(value); }
function normalized(registry: ComponentSchemaRegistry, typeName: string, value: unknown): Record<string, unknown> { return normalizeComponentData(registry.require(typeName), value); }
function optionalNormalized(registry: ComponentSchemaRegistry, entity: SceneEntityData, typeName: string): Record<string, unknown> | undefined { const value = component(entity, typeName); return value === undefined ? undefined : normalized(registry, typeName, value.data); }
function bodyType(value: Record<string, unknown> | undefined): PhysicsBodyDescriptor2d["bodyType"] { return value === undefined ? "static" : text(value.bodyType, "Rigidbody.bodyType") as PhysicsBodyDescriptor2d["bodyType"]; }
function bodySettings(value: Record<string, unknown> | undefined) { return value === undefined ? {} : { gravityScale: number(value.gravityScale, "Rigidbody.gravityScale"), linearDamping: number(value.linearDamping, "Rigidbody.linearDamping"), angularDamping: number(value.angularDamping, "Rigidbody.angularDamping"), continuousCollisionDetection: boolean(value.continuousCollisionDetection) }; }
function colliderSettings(value: Record<string, unknown>) { return { density: number(value.density, "Collider.density"), friction: number(value.friction, "Collider.friction"), restitution: number(value.restitution, "Collider.restitution"), sensor: boolean(value.sensor), layer: number(value.layer, "Collider.layer"), mask: number(value.mask, "Collider.mask") }; }
function tuple(value: unknown, length: number, label: string): number[] { if (!Array.isArray(value) || value.length !== length || !value.every((item) => typeof item === "number" && Number.isFinite(item))) throw new Error(`${label} requires ${String(length)} finite numbers.`); return value; }
function number(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite.`); return value; }
function text(value: unknown, label: string): string { if (typeof value !== "string") throw new Error(`${label} must be text.`); return value; }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw new Error("Physics boolean setting is malformed."); return value; }
function characterOptions<T>(data: Record<string, unknown>, shape: T) { return { shape, offset: number(data.offset, "CharacterController.offset"), slide: boolean(data.slide), autostepMaxHeight: boolean(data.autostep) ? number(data.stepHeight, "CharacterController.stepHeight") : null, autostepMinWidth: number(data.stepWidth, "CharacterController.stepWidth"), autostepDynamicBodies: false, maxSlopeClimbDegrees: number(data.maxSlope, "CharacterController.maxSlope"), minSlopeSlideDegrees: number(data.slideSlope, "CharacterController.slideSlope"), snapToGround: number(data.groundSnap, "CharacterController.groundSnap"), layer: number(data.layer, "CharacterController.layer"), mask: number(data.mask, "CharacterController.mask"), includeSensors: false }; }
function yaw(rotation: readonly [number, number, number, number]): number { const [x, y, z, w] = rotation; return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)); }
