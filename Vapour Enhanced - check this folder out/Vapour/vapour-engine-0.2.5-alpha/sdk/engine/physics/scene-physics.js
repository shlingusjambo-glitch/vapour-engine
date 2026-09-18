import { builtinComponentSchemas, normalizeComponentData, ComponentSchemaRegistry } from "../core/component-schema.js";
/**
 * Owns the scene-to-native-physics contract. It incrementally reconciles
 * serialized components, advances both native worlds, writes dynamic poses
 * back into the scene, and translates numeric solver IDs into stable scene IDs.
 */
export class ScenePhysicsRuntime {
    #scene;
    #physics2d;
    #physics3d;
    #onContact;
    #schemas = new ComponentSchemaRegistry(builtinComponentSchemas());
    #bound = new Map();
    #entityByBody = new Map();
    #destroyed = false;
    constructor(scene, options) {
        this.#scene = scene;
        this.#physics2d = options.physics2d;
        this.#physics3d = options.physics3d;
        this.#onContact = options.onContact;
        if (this.#physics2d === undefined && this.#physics3d === undefined)
            throw new Error("ScenePhysicsRuntime requires a 2D or 3D native physics world.");
    }
    get bodyCount() { return this.#bound.size; }
    /** Registers a named surface with every configured world, so a serialized
     * collider's `material: "ice"` resolves. Define materials before the first
     * `prepare` or `fixedUpdate`; a body naming an unknown material is rejected
     * by the solver. */
    defineMaterial(material) {
        this.#alive();
        this.#physics2d?.defineMaterial(material);
        this.#physics3d?.defineMaterial(material);
    }
    /** Reconciles serialized bodies before gameplay scripts issue queries. */
    prepare() { this.#alive(); this.#reconcile(); this.#physics2d?.flush(); this.#physics3d?.flush(); }
    moveCharacter2d(entityId, desiredTranslation, timestep) {
        this.prepare();
        const entity = this.#requireEntity(entityId), record = component(entity, "vapour.CharacterController2D");
        if (record === undefined)
            throw new Error(`Entity '${entity.name}' has no Character Controller 2D component.`);
        if (component(entity, "vapour.Collider2D") !== undefined)
            throw new Error(`Character '${entity.name}' cannot also have a Collider 2D; the controller owns its swept shape.`);
        if (this.#physics2d === undefined)
            throw new Error(`Character '${entity.name}' requires a configured 2D physics world.`);
        const data = normalized(this.#schemas, "vapour.CharacterController2D", record.data), pose = transform(entity);
        const size = tuple(data.size, 2, "CharacterController2D.size"), radius = number(data.radius, "CharacterController2D.radius"), shapeName = text(data.shape, "CharacterController2D.shape");
        const shape = shapeName === "circle" ? { type: "circle", radius } : shapeName === "rectangle" ? { type: "rectangle", halfExtents: [size[0] * 0.5, size[1] * 0.5] } : { type: "capsule", halfHeight: Math.max(0.001, size[1] * 0.5 - radius), radius };
        const result = this.#physics2d.moveCharacter(timestep, [pose.position[0], pose.position[1]], yaw(pose.rotation), desiredTranslation, characterOptions(data, shape));
        this.#scene.setTransform(entityId, { ...pose, position: [pose.position[0] + result.translation[0], pose.position[1] + result.translation[1], pose.position[2]] });
        return { ...result, collisions: result.collisions.flatMap((id) => { const value = this.#entityByBody.get(id); return value === undefined ? [] : [value]; }) };
    }
    moveCharacter3d(entityId, desiredTranslation, timestep) {
        this.prepare();
        const entity = this.#requireEntity(entityId), record = component(entity, "vapour.CharacterController3D");
        if (record === undefined)
            throw new Error(`Entity '${entity.name}' has no Character Controller 3D component.`);
        if (component(entity, "vapour.Collider3D") !== undefined)
            throw new Error(`Character '${entity.name}' cannot also have a Collider 3D; the controller owns its swept shape.`);
        if (this.#physics3d === undefined)
            throw new Error(`Character '${entity.name}' requires a configured 3D physics world.`);
        const data = normalized(this.#schemas, "vapour.CharacterController3D", record.data), pose = transform(entity);
        const size = tuple(data.size, 3, "CharacterController3D.size"), radius = number(data.radius, "CharacterController3D.radius"), shapeName = text(data.shape, "CharacterController3D.shape");
        const shape = shapeName === "sphere" ? { type: "sphere", radius } : shapeName === "box" ? { type: "box", halfExtents: [size[0] * 0.5, size[1] * 0.5, size[2] * 0.5] } : { type: "capsule", halfHeight: Math.max(0.001, size[1] * 0.5 - radius), radius };
        const result = this.#physics3d.moveCharacter(timestep, pose.position, pose.rotation, desiredTranslation, characterOptions(data, shape));
        this.#scene.setTransform(entityId, { ...pose, position: [pose.position[0] + result.translation[0], pose.position[1] + result.translation[1], pose.position[2] + result.translation[2]] });
        return { ...result, collisions: result.collisions.flatMap((id) => { const value = this.#entityByBody.get(id); return value === undefined ? [] : [value]; }) };
    }
    /** Reconciles authoring changes, performs one fixed step, and synchronizes
     * dynamic body poses. Call exactly once per GameRuntime fixed update. */
    fixedUpdate(timestep) {
        this.#alive();
        const contacts = [];
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
    destroy() {
        if (this.#destroyed)
            return;
        for (const binding of this.#bound.values())
            this.#remove(binding);
        this.#physics2d?.flush();
        this.#physics3d?.flush();
        this.#bound.clear();
        this.#entityByBody.clear();
        this.#destroyed = true;
    }
    #reconcile() {
        const live = new Set();
        for (const entity of this.#scene.data.entities) {
            if (!entity.enabled)
                continue;
            const candidate = this.#descriptor(entity);
            if (candidate === undefined)
                continue;
            live.add(entity.id);
            const existing = this.#bound.get(entity.id);
            if (existing?.fingerprint === candidate.fingerprint)
                continue;
            if (existing !== undefined)
                this.#remove(existing);
            const collision = this.#entityByBody.get(candidate.id);
            if (collision !== undefined && collision !== entity.id)
                throw new Error(`Physics ID collision between scene entities '${collision}' and '${entity.id}'. Change one entity ID.`);
            if (candidate.dimension === "2d") {
                if (this.#physics2d === undefined)
                    throw new Error(`Entity '${entity.name}' requires 2D physics, but no 2D world was configured.`);
                this.#physics2d.insert(candidate.descriptor);
            }
            else {
                if (this.#physics3d === undefined)
                    throw new Error(`Entity '${entity.name}' requires 3D physics, but no 3D world was configured.`);
                this.#physics3d.insert(candidate.descriptor);
            }
            const binding = { id: candidate.id, dimension: candidate.dimension, fingerprint: candidate.fingerprint, bodyType: candidate.descriptor.bodyType };
            this.#bound.set(entity.id, binding);
            this.#entityByBody.set(candidate.id, entity.id);
        }
        for (const [entityId, binding] of [...this.#bound])
            if (!live.has(entityId)) {
                this.#remove(binding);
                this.#bound.delete(entityId);
            }
    }
    #descriptor(entity) {
        const collider2d = component(entity, "vapour.Collider2D"), collider3d = component(entity, "vapour.Collider3D");
        if (collider2d !== undefined && collider3d !== undefined)
            throw new Error(`Entity '${entity.name}' cannot have both 2D and 3D colliders.`);
        if (collider2d === undefined && collider3d === undefined)
            return undefined;
        const id = stablePhysicsId(entity.id), pose = transform(entity);
        if (collider2d !== undefined) {
            const collider = normalized(this.#schemas, "vapour.Collider2D", collider2d.data), rigid = optionalNormalized(this.#schemas, entity, "vapour.Rigidbody2D");
            const shapeName = text(collider.shape, "Collider2D.shape");
            const size = tuple(collider.size, 2, "Collider2D.size");
            const radius = number(collider.radius, "Collider2D.radius");
            const shape = shapeName === "circle" ? { type: "circle", radius } : shapeName === "capsule" ? { type: "capsule", halfHeight: size[1] * 0.5, radius } : { type: "rectangle", halfExtents: [size[0] * 0.5, size[1] * 0.5] };
            const descriptor = { id, bodyType: bodyType(rigid), position: [pose.position[0], pose.position[1]], rotation: yaw(pose.rotation), shape, ...bodySettings(rigid), ...colliderSettings(collider) };
            return { dimension: "2d", id, descriptor, fingerprint: fingerprint(descriptor) };
        }
        const collider = normalized(this.#schemas, "vapour.Collider3D", collider3d.data), rigid = optionalNormalized(this.#schemas, entity, "vapour.Rigidbody3D");
        const shapeName = text(collider.shape, "Collider3D.shape"), size = tuple(collider.size, 3, "Collider3D.size"), radius = number(collider.radius, "Collider3D.radius"), height = number(collider.height, "Collider3D.height");
        const shape = shapeName === "sphere" ? { type: "sphere", radius } : shapeName === "capsule" || shapeName === "cylinder" ? { type: shapeName, halfHeight: height * 0.5, radius } : { type: "box", halfExtents: [size[0] * 0.5, size[1] * 0.5, size[2] * 0.5] };
        const descriptor = { id, bodyType: bodyType(rigid), position: [...pose.position], rotation: [...pose.rotation], shape, ...bodySettings(rigid), ...colliderSettings(collider), ...massSettings(rigid) };
        return { dimension: "3d", id, descriptor, fingerprint: fingerprint(descriptor) };
    }
    #pushKinematicTargets() {
        for (const [entityId, binding] of this.#bound) {
            if (binding.bodyType !== "kinematicPosition")
                continue;
            const pose = transform(this.#requireEntity(entityId));
            if (binding.dimension === "2d")
                this.#physics2d.setKinematicTarget(binding.id, [pose.position[0], pose.position[1]], yaw(pose.rotation));
            else
                this.#physics3d.setKinematicTarget(binding.id, pose.position, pose.rotation);
        }
    }
    #dispatch(dimension, events, contacts) {
        for (const event of events) {
            const entityA = this.#entityByBody.get(event.bodyA), entityB = this.#entityByBody.get(event.bodyB);
            if (entityA !== undefined && entityB !== undefined) {
                const contact = { dimension, kind: event.kind, entityA, entityB };
                contacts.push(contact);
                this.#onContact?.(contact);
            }
        }
    }
    #remove(binding) { if (binding.dimension === "2d")
        this.#physics2d.remove(binding.id);
    else
        this.#physics3d.remove(binding.id); this.#entityByBody.delete(binding.id); }
    #requireEntity(id) { const entity = this.#scene.entity(id); if (entity === undefined)
        throw new Error(`Physics body references removed entity '${id}'.`); return entity; }
    #alive() { if (this.#destroyed)
        throw new Error("ScenePhysicsRuntime has been destroyed."); }
}
function stablePhysicsId(value) { let hash = 0xcbf29ce484222325n; for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
} return Number(hash % 9007199254740990n) + 1; }
function fingerprint(descriptor) {
    // Position kinematics move through setKinematicTarget. Recreating a body
    // whenever its authored pose changes discards contacts and attached joints,
    // and turns a swept kinematic move into an instantaneous teleport.
    if (descriptor.bodyType !== "dynamic" && descriptor.bodyType !== "kinematicPosition")
        return JSON.stringify(descriptor);
    const { position: _position, rotation: _rotation, ...simulationSettings } = descriptor;
    return JSON.stringify(simulationSettings);
}
function component(entity, typeName) { return entity.components.find((value) => value.typeName === typeName); }
function transform(entity) { const value = component(entity, "vapour.Transform")?.data; if (value === undefined)
    throw new Error(`Physics entity '${entity.name}' has no Transform.`); return structuredClone(value); }
function normalized(registry, typeName, value) { return normalizeComponentData(registry.require(typeName), value); }
function optionalNormalized(registry, entity, typeName) { const value = component(entity, typeName); return value === undefined ? undefined : normalized(registry, typeName, value.data); }
function bodyType(value) { return value === undefined ? "static" : text(value.bodyType, "Rigidbody.bodyType"); }
function bodySettings(value) { return value === undefined ? {} : { gravityScale: number(value.gravityScale, "Rigidbody.gravityScale"), linearDamping: number(value.linearDamping, "Rigidbody.linearDamping"), angularDamping: number(value.angularDamping, "Rigidbody.angularDamping"), continuousCollisionDetection: boolean(value.continuousCollisionDetection) }; }
function colliderSettings(value) {
    // Materials, combine rules, and mass live outside the built-in schema so a
    // collider authored before Mirage still normalizes; the schema keeps unknown
    // keys, and only well-formed values are forwarded.
    return {
        density: number(value.density, "Collider.density"), friction: number(value.friction, "Collider.friction"), restitution: number(value.restitution, "Collider.restitution"), sensor: boolean(value.sensor), layer: number(value.layer, "Collider.layer"), mask: number(value.mask, "Collider.mask"),
        ...(typeof value.material === "string" && value.material.trim() !== "" ? { material: value.material } : {}),
        ...(isCombineRule(value.frictionCombine) ? { frictionCombine: value.frictionCombine } : {}),
        ...(isCombineRule(value.restitutionCombine) ? { restitutionCombine: value.restitutionCombine } : {}),
    };
}
function isCombineRule(value) { return value === "average" || value === "min" || value === "max" || value === "multiply"; }
/** `Rigidbody3D.mass` (> 0) with optional `centerOfMass` and `principalInertia` overrides density. */
function massSettings(value) {
    if (value === undefined || typeof value.mass !== "number")
        return {};
    const mass = number(value.mass, "Rigidbody3D.mass");
    if (mass <= 0)
        return {};
    const centerOfMass = Array.isArray(value.centerOfMass) ? tuple(value.centerOfMass, 3, "Rigidbody3D.centerOfMass") : [0, 0, 0];
    const principalInertia = Array.isArray(value.principalInertia) ? tuple(value.principalInertia, 3, "Rigidbody3D.principalInertia") : undefined;
    return { massProperties: { mass, centerOfMass, ...(principalInertia ? { principalInertia } : {}) } };
}
function tuple(value, length, label) { if (!Array.isArray(value) || value.length !== length || !value.every((item) => typeof item === "number" && Number.isFinite(item)))
    throw new Error(`${label} requires ${String(length)} finite numbers.`); return value; }
function number(value, label) { if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be finite.`); return value; }
function text(value, label) { if (typeof value !== "string")
    throw new Error(`${label} must be text.`); return value; }
function boolean(value) { if (typeof value !== "boolean")
    throw new Error("Physics boolean setting is malformed."); return value; }
function characterOptions(data, shape) { return { shape, offset: number(data.offset, "CharacterController.offset"), slide: boolean(data.slide), autostepMaxHeight: boolean(data.autostep) ? number(data.stepHeight, "CharacterController.stepHeight") : null, autostepMinWidth: number(data.stepWidth, "CharacterController.stepWidth"), autostepDynamicBodies: false, maxSlopeClimbDegrees: number(data.maxSlope, "CharacterController.maxSlope"), minSlopeSlideDegrees: number(data.slideSlope, "CharacterController.slideSlope"), snapToGround: number(data.groundSnap, "CharacterController.groundSnap"), layer: number(data.layer, "CharacterController.layer"), mask: number(data.mask, "CharacterController.mask"), includeSensors: false }; }
function yaw(rotation) { const [x, y, z, w] = rotation; return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)); }
//# sourceMappingURL=scene-physics.js.map