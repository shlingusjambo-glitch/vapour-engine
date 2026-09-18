import { validateMaterial } from "./physics-3d.js";
/** Loads the shared Rust/WASM artifact and constructs a native 2D world. */
export async function createPhysicsWorld2d(options = {}) {
    const gravity = options.gravity ?? [0, -9.81];
    vector2(gravity, "gravity");
    const moduleUrl = options.moduleUrl ?? "/vapour_runtime.js";
    const loader = options.loadModule ?? (async (url) => await import(/* @vite-ignore */ url));
    try {
        const module = await loader(moduleUrl);
        await module.default();
        return new PhysicsWorld2dBridge(new module.PhysicsEngine2d(gravity[0], gravity[1]));
    }
    catch (error) {
        throw new Error(`Vapour's Rust 2D physics runtime could not load from '${moduleUrl}': ${message(error)}`, { cause: error });
    }
}
/** Batched, language-neutral facade shared by VS and TypeScript gameplay. */
export class PhysicsWorld2dBridge {
    #wasm;
    #commands = [];
    constructor(wasm) { this.#wasm = wasm; }
    get pendingCommands() { return this.#commands.length; }
    get bodyCount() { return this.#wasm.body_count(); }
    destroy() { this.#commands.length = 0; this.#wasm.free(); }
    insert(descriptor) { validateId(descriptor.id); this.#commands.push({ type: "insert", descriptor: defaults(descriptor) }); }
    remove(id) { validateId(id); this.#commands.push({ type: "remove", id }); }
    addForce(id, force) { validateId(id); vector2(force, "force"); this.#commands.push({ type: "addForce", id, force: [...force] }); }
    addForceAtPoint(id, force, point) { validateId(id); vector2(force, "force"); vector2(point, "force point"); this.#commands.push({ type: "addForceAtPoint", id, force: [...force], point: [...point] }); }
    addTorque(id, torque) { validateId(id); finite(torque, "torque"); this.#commands.push({ type: "addTorque", id, torque }); }
    applyImpulse(id, impulse) { validateId(id); vector2(impulse, "impulse"); this.#commands.push({ type: "applyImpulse", id, impulse: [...impulse] }); }
    applyTorqueImpulse(id, torque) { validateId(id); finite(torque, "torque impulse"); this.#commands.push({ type: "applyTorqueImpulse", id, torque }); }
    setLinearVelocity(id, velocity) { validateId(id); vector2(velocity, "linear velocity"); this.#commands.push({ type: "setLinearVelocity", id, velocity: [...velocity] }); }
    setAngularVelocity(id, velocity) { validateId(id); finite(velocity, "angular velocity"); this.#commands.push({ type: "setAngularVelocity", id, velocity }); }
    setKinematicTarget(id, position, rotation) { validateId(id); vector2(position, "kinematic position"); finite(rotation, "kinematic rotation"); this.#commands.push({ type: "setKinematicTarget", id, position: [...position], rotation }); }
    setGravity(gravity) { vector2(gravity, "gravity"); this.#commands.push({ type: "setGravity", gravity: [...gravity] }); }
    /** Registers or redefines a named surface; see the 3D bridge for semantics. */
    defineMaterial(material) { this.#commands.push({ type: "defineMaterial", material: validateMaterial(material) }); }
    setMaterial(id, name) { validateId(id); if (name.trim() === "")
        throw new Error("Physics material name cannot be empty."); this.#commands.push({ type: "setMaterial", id, name }); }
    flush() {
        if (this.#commands.length === 0)
            return 0;
        const count = this.#commands.length;
        try {
            const applied = this.#wasm.apply_commands(JSON.stringify(this.#commands));
            this.#commands.length = 0;
            return applied;
        }
        catch (error) {
            throw new Error(`Rust 2D physics rejected a ${String(count)}-command batch: ${message(error)}`, { cause: error });
        }
    }
    step(timestep) {
        if (!Number.isFinite(timestep) || timestep <= 0)
            throw new Error("2D physics timestep must be finite and positive.");
        this.flush();
        let value;
        try {
            value = JSON.parse(this.#wasm.step_json(timestep));
        }
        catch (error) {
            throw new Error(`Rust 2D physics returned an invalid step: ${message(error)}`, { cause: error });
        }
        if (typeof value !== "object" || value === null || !Array.isArray(value.bodies) || !Array.isArray(value.events))
            throw new Error("Rust 2D physics step requires bodies and events arrays.");
        return value;
    }
    raycast(origin, direction, maxDistance, options = {}) {
        vector2(origin, "ray origin");
        vector2(direction, "ray direction");
        positive(maxDistance, "ray maximum distance");
        const layer = bits(options.layer ?? 1, "ray layer"), mask = bits(options.mask ?? 0xffff_ffff, "ray mask");
        let value;
        try {
            value = JSON.parse(this.#wasm.raycast_json(Float32Array.from(origin), Float32Array.from(direction), maxDistance, layer, mask, options.includeSensors ?? false));
        }
        catch (error) {
            throw new Error(`Rust 2D physics raycast failed: ${message(error)}`, { cause: error });
        }
        if (value === null)
            return undefined;
        if (!isRayHit(value))
            throw new Error("Rust 2D physics returned a malformed raycast hit.");
        return value;
    }
    overlapShape(position, rotation, shape, options = {}) {
        vector2(position, "overlap position");
        finite(rotation, "overlap rotation");
        validateShape(shape);
        const layer = bits(options.layer ?? 1, "overlap layer"), mask = bits(options.mask ?? 0xffff_ffff, "overlap mask");
        let value;
        try {
            value = JSON.parse(this.#wasm.overlap_shape_json(Float32Array.from(position), rotation, JSON.stringify(shape), layer, mask, options.includeSensors ?? false));
        }
        catch (error) {
            throw new Error(`Rust 2D physics overlap failed: ${message(error)}`, { cause: error });
        }
        if (!Array.isArray(value) || !value.every((id) => Number.isSafeInteger(id) && id > 0))
            throw new Error("Rust 2D physics returned malformed overlap IDs.");
        return value;
    }
    castShape(position, rotation, direction, maxDistance, shape, options = {}) {
        vector2(position, "shape-cast position");
        finite(rotation, "shape-cast rotation");
        vector2(direction, "shape-cast direction");
        positive(maxDistance, "shape-cast maximum distance");
        validateShape(shape);
        const layer = bits(options.layer ?? 1, "shape-cast layer"), mask = bits(options.mask ?? 0xffff_ffff, "shape-cast mask");
        let value;
        try {
            value = JSON.parse(this.#wasm.cast_shape_json(Float32Array.from(position), rotation, Float32Array.from(direction), maxDistance, JSON.stringify(shape), layer, mask, options.includeSensors ?? false));
        }
        catch (error) {
            throw new Error(`Rust 2D physics shape cast failed: ${message(error)}`, { cause: error });
        }
        if (value === null)
            return undefined;
        if (!isShapeHit(value))
            throw new Error("Rust 2D physics returned a malformed shape-cast hit.");
        return value;
    }
    moveCharacter(timestep, position, rotation, desiredTranslation, options) {
        positive(timestep, "character timestep");
        vector2(position, "character position");
        finite(rotation, "character rotation");
        vector2(desiredTranslation, "character desired translation");
        validateShape(options.shape);
        const descriptor = characterDefaults(options);
        let value;
        try {
            value = JSON.parse(this.#wasm.move_character_json(timestep, Float32Array.from(position), rotation, Float32Array.from(desiredTranslation), JSON.stringify(descriptor)));
        }
        catch (error) {
            throw new Error(`Rust 2D character controller failed: ${message(error)}`, { cause: error });
        }
        if (!isCharacterMovement(value, 2))
            throw new Error("Rust 2D physics returned malformed character movement.");
        return value;
    }
}
function defaults(value) {
    vector2(value.position, "body position");
    finite(value.rotation ?? 0, "body rotation");
    validateShape(value.shape);
    return { ...value, position: [...value.position], rotation: value.rotation ?? 0, linearVelocity: [...(value.linearVelocity ?? [0, 0])], angularVelocity: value.angularVelocity ?? 0, gravityScale: value.gravityScale ?? 1, linearDamping: value.linearDamping ?? 0, angularDamping: value.angularDamping ?? 0, continuousCollisionDetection: value.continuousCollisionDetection ?? false, shape: structuredClone(value.shape), density: value.density ?? 1, friction: value.friction ?? 0.5, restitution: value.restitution ?? 0, sensor: value.sensor ?? false, layer: bits(value.layer ?? 1, "collision layer"), mask: bits(value.mask ?? 0xffff_ffff, "collision mask"), material: value.material === undefined ? null : materialName(value.material), frictionCombine: value.frictionCombine ?? "average", restitutionCombine: value.restitutionCombine ?? "average" };
}
function materialName(value) { if (value.trim() === "")
    throw new Error("Physics material name cannot be empty."); return value; }
function validateShape(shape) {
    if (shape.type === "rectangle") {
        vector2(shape.halfExtents, "rectangle half extents");
        if (shape.halfExtents.some((value) => value <= 0))
            throw new Error("Rectangle half extents must be positive.");
    }
    else if (shape.type === "convexPolygon") {
        if (shape.points.length < 3)
            throw new Error("Convex polygon requires at least three points.");
        shape.points.forEach((point) => vector2(point, "convex polygon point"));
    }
    else {
        positive(shape.radius, `${shape.type} radius`);
        if (shape.type === "capsule")
            positive(shape.halfHeight, "capsule half height");
    }
}
function characterDefaults(value) { const offset = value.offset ?? 0.01, stepWidth = value.autostepMinWidth ?? 0.2, climb = value.maxSlopeClimbDegrees ?? 45, slideAngle = value.minSlopeSlideDegrees ?? 50; positive(offset, "character offset"); positive(stepWidth, "character autostep minimum width"); angle(climb, "maximum slope climb"); angle(slideAngle, "minimum slope slide"); if (value.autostepMaxHeight !== undefined && value.autostepMaxHeight !== null)
    positive(value.autostepMaxHeight, "character autostep maximum height"); if (value.snapToGround !== undefined && value.snapToGround !== null && value.snapToGround < 0)
    throw new Error("Physics character ground snap distance must be non-negative."); return { shape: structuredClone(value.shape), offset, slide: value.slide ?? true, autostepMaxHeight: value.autostepMaxHeight === undefined ? 0.3 : value.autostepMaxHeight, autostepMinWidth: stepWidth, autostepDynamicBodies: value.autostepDynamicBodies ?? false, maxSlopeClimbDegrees: climb, minSlopeSlideDegrees: slideAngle, snapToGround: value.snapToGround === undefined ? 0.2 : value.snapToGround, layer: bits(value.layer ?? 1, "character layer"), mask: bits(value.mask ?? 0xffff_ffff, "character mask"), includeSensors: value.includeSensors ?? false }; }
function validateId(id) { if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error("Physics body ID must be a positive safe integer."); }
function vector2(value, label) { if (value.length !== 2 || !value.every(Number.isFinite))
    throw new Error(`Physics ${label} requires 2 finite numbers.`); }
function finite(value, label) { if (!Number.isFinite(value))
    throw new Error(`Physics ${label} must be finite.`); }
function positive(value, label) { if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Physics ${label} must be finite and positive.`); }
function bits(value, label) { if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new Error(`Physics ${label} must be an unsigned 32-bit integer.`); return value; }
function isRayHit(value) { if (typeof value !== "object" || value === null)
    return false; const hit = value; return Number.isSafeInteger(hit.bodyId) && typeof hit.distance === "number" && Number.isFinite(hit.distance) && Array.isArray(hit.point) && hit.point.length === 2 && Array.isArray(hit.normal) && hit.normal.length === 2; }
function isShapeHit(value) { if (typeof value !== "object" || value === null)
    return false; const hit = value; return Number.isSafeInteger(hit.bodyId) && typeof hit.distance === "number" && Number.isFinite(hit.distance) && Array.isArray(hit.position) && hit.position.length === 2 && Array.isArray(hit.normal) && hit.normal.length === 2; }
function isCharacterMovement(value, dimensions) { if (typeof value !== "object" || value === null)
    return false; const movement = value; return Array.isArray(movement.translation) && movement.translation.length === dimensions && movement.translation.every(Number.isFinite) && typeof movement.grounded === "boolean" && typeof movement.slidingDownSlope === "boolean" && Array.isArray(movement.collisions) && movement.collisions.every((id) => Number.isSafeInteger(id) && id > 0); }
function angle(value, label) { if (!Number.isFinite(value) || value < 0 || value > 90)
    throw new Error(`Physics character ${label} must be between 0 and 90 degrees.`); }
function message(error) { return error instanceof Error ? error.message : String(error); }
//# sourceMappingURL=physics-2d.js.map