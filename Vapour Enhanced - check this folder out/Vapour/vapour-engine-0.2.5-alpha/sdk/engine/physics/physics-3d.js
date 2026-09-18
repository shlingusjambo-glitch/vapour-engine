/** Loads Vapour's shared Rust/WASM artifact and constructs a Rapier world. */
export async function createPhysicsWorld3d(options = {}) {
    const gravity = options.gravity ?? [0, -9.81, 0];
    vector(gravity, "gravity");
    const moduleUrl = options.moduleUrl ?? "/vapour_runtime.js";
    const loader = options.loadModule ??
        (async (url) => (await import(/* @vite-ignore */ url)));
    try {
        const module = await loader(moduleUrl);
        await module.default();
        return new PhysicsWorld3dBridge(new module.PhysicsEngine3d(gravity[0], gravity[1], gravity[2]));
    }
    catch (error) {
        throw new Error(`Vapour's Rust 3D physics runtime could not load from '${moduleUrl}': ${message(error)}`, { cause: error });
    }
}
/** Coarse-grained VS/TypeScript facade over the Rust Rapier world. Mutations
 * queue locally and cross into WASM as one command array per fixed step. */
export class PhysicsWorld3dBridge {
    #wasm;
    #commands = [];
    constructor(wasm) {
        this.#wasm = wasm;
    }
    get pendingCommands() {
        return this.#commands.length;
    }
    get bodyCount() {
        return this.#wasm.body_count();
    }
    destroy() {
        this.#commands.length = 0;
        this.#wasm.free();
    }
    insert(descriptor) {
        validateId(descriptor.id);
        this.#commands.push({ type: "insert", descriptor: defaults(descriptor) });
    }
    remove(id) {
        validateId(id);
        this.#commands.push({ type: "remove", id });
    }
    addForce(id, force) {
        validateId(id);
        vector(force, "force");
        this.#commands.push({ type: "addForce", id, force: [...force] });
    }
    addForceAtPoint(id, force, point) {
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
    addTorque(id, torque) {
        validateId(id);
        vector(torque, "torque");
        this.#commands.push({ type: "addTorque", id, torque: [...torque] });
    }
    applyImpulse(id, impulse) {
        validateId(id);
        vector(impulse, "impulse");
        this.#commands.push({ type: "applyImpulse", id, impulse: [...impulse] });
    }
    applyTorqueImpulse(id, torque) {
        validateId(id);
        vector(torque, "torque impulse");
        this.#commands.push({
            type: "applyTorqueImpulse",
            id,
            torque: [...torque],
        });
    }
    setLinearVelocity(id, velocity) {
        validateId(id);
        vector(velocity, "linear velocity");
        this.#commands.push({
            type: "setLinearVelocity",
            id,
            velocity: [...velocity],
        });
    }
    setAngularVelocity(id, velocity) {
        validateId(id);
        vector(velocity, "angular velocity");
        this.#commands.push({
            type: "setAngularVelocity",
            id,
            velocity: [...velocity],
        });
    }
    setKinematicTarget(id, position, rotation) {
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
    setGravity(gravity) {
        vector(gravity, "gravity");
        this.#commands.push({ type: "setGravity", gravity: [...gravity] });
    }
    /** Registers or redefines a named surface. Bodies inserted afterwards may
     * reference it; bodies already built keep their coefficients until
     * {@link setMaterial}. */
    defineMaterial(material) {
        this.#commands.push({ type: "defineMaterial", material: validateMaterial(material) });
    }
    /** Re-surfaces an existing body: wet asphalt, an iced-over ramp. */
    setMaterial(id, name) {
        validateId(id);
        this.#commands.push({ type: "setMaterial", id, name: materialName(name) });
    }
    /** Solver contacts from the last step, for debug rendering. Empty on WASM
     * builds that predate contact reporting. */
    contacts() {
        if (this.#wasm.contacts_json === undefined)
            return [];
        let value;
        try {
            value = JSON.parse(this.#wasm.contacts_json());
        }
        catch (error) {
            throw new Error(`Rust 3D physics returned invalid contacts: ${message(error)}`, { cause: error });
        }
        if (!Array.isArray(value))
            throw new Error("Rust 3D physics contacts must be an array.");
        return value;
    }
    flush() {
        if (this.#commands.length === 0)
            return 0;
        const count = this.#commands.length;
        const json = JSON.stringify(this.#commands);
        try {
            const applied = this.#wasm.apply_commands(json);
            this.#commands.length = 0;
            return applied;
        }
        catch (error) {
            throw new Error(`Rust 3D physics rejected a ${String(count)}-command batch: ${message(error)}`, { cause: error });
        }
    }
    step(timestep) {
        if (!Number.isFinite(timestep) || timestep <= 0)
            throw new Error("3D physics timestep must be finite and positive.");
        this.flush();
        let value;
        try {
            value = JSON.parse(this.#wasm.step_json(timestep));
        }
        catch (error) {
            throw new Error(`Rust 3D physics returned an invalid step: ${message(error)}`, { cause: error });
        }
        return validateStep(value);
    }
    raycast(origin, direction, maxDistance, options = {}) {
        vector(origin, "ray origin");
        if (options.excludeBody !== undefined)
            validateId(options.excludeBody);
        vector(direction, "ray direction");
        if (!Number.isFinite(maxDistance) || maxDistance <= 0)
            throw new Error("Ray maximum distance must be finite and positive.");
        // Queries must observe bodies queued since the previous simulation step.
        // Vehicle suspension casts commonly run immediately after construction.
        this.flush();
        const layer = bits(options.layer ?? 1, "ray layer"), mask = bits(options.mask ?? 0xffff_ffff, "ray mask");
        let value;
        try {
            value = JSON.parse(this.#wasm.raycast_json(Float32Array.from(origin), Float32Array.from(direction), maxDistance, layer, mask, options.includeSensors ?? false, options.excludeBody ?? 0));
        }
        catch (error) {
            throw new Error(`Rust 3D physics raycast failed: ${message(error)}`, {
                cause: error,
            });
        }
        if (value === null)
            return undefined;
        if (!isRayHit(value))
            throw new Error("Rust 3D physics returned a malformed raycast hit.");
        return value;
    }
    overlapShape(position, rotation, shape, options = {}) {
        vector(position, "overlap position");
        quaternion(rotation);
        validateShape(shape);
        const layer = bits(options.layer ?? 1, "overlap layer"), mask = bits(options.mask ?? 0xffff_ffff, "overlap mask");
        let value;
        try {
            value = JSON.parse(this.#wasm.overlap_shape_json(Float32Array.from(position), Float32Array.from(rotation), JSON.stringify(shape), layer, mask, options.includeSensors ?? false));
        }
        catch (error) {
            throw new Error(`Rust 3D physics overlap failed: ${message(error)}`, {
                cause: error,
            });
        }
        if (!Array.isArray(value) ||
            !value.every((id) => Number.isSafeInteger(id) && id > 0))
            throw new Error("Rust 3D physics returned malformed overlap IDs.");
        return value;
    }
    castShape(position, rotation, direction, maxDistance, shape, options = {}) {
        vector(position, "shape-cast position");
        quaternion(rotation);
        vector(direction, "shape-cast direction");
        positive(maxDistance, "shape-cast maximum distance");
        validateShape(shape);
        const layer = bits(options.layer ?? 1, "shape-cast layer"), mask = bits(options.mask ?? 0xffff_ffff, "shape-cast mask");
        let value;
        try {
            value = JSON.parse(this.#wasm.cast_shape_json(Float32Array.from(position), Float32Array.from(rotation), Float32Array.from(direction), maxDistance, JSON.stringify(shape), layer, mask, options.includeSensors ?? false));
        }
        catch (error) {
            throw new Error(`Rust 3D physics shape cast failed: ${message(error)}`, {
                cause: error,
            });
        }
        if (value === null)
            return undefined;
        if (!isShapeHit(value))
            throw new Error("Rust 3D physics returned a malformed shape-cast hit.");
        return value;
    }
    moveCharacter(timestep, position, rotation, desiredTranslation, options) {
        positive(timestep, "character timestep");
        vector(position, "character position");
        quaternion(rotation);
        vector(desiredTranslation, "character desired translation");
        validateShape(options.shape);
        const descriptor = characterDefaults(options);
        let value;
        try {
            value = JSON.parse(this.#wasm.move_character_json(timestep, Float32Array.from(position), Float32Array.from(rotation), Float32Array.from(desiredTranslation), JSON.stringify(descriptor)));
        }
        catch (error) {
            throw new Error(`Rust 3D character controller failed: ${message(error)}`, { cause: error });
        }
        if (!isCharacterMovement(value))
            throw new Error("Rust 3D physics returned malformed character movement.");
        return value;
    }
}
function defaults(value) {
    vector(value.position, "body position");
    quaternion(value.rotation);
    validateShape(value.shape);
    if (value.massProperties !== undefined) {
        positive(value.massProperties.mass, "mass");
        vector(value.massProperties.centerOfMass, "centre of mass");
        if (value.massProperties.principalInertia !== undefined) {
            vector(value.massProperties.principalInertia, "principal inertia");
            if (value.massProperties.principalInertia.some((item) => item < 0))
                throw new Error("Physics principal inertia must be non-negative.");
        }
    }
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
        material: value.material === undefined ? null : materialName(value.material),
        frictionCombine: combineRule(value.frictionCombine),
        restitutionCombine: combineRule(value.restitutionCombine),
        massProperties: value.massProperties === undefined ? null : structuredClone(value.massProperties),
    };
}
const COMBINE_RULES = ["average", "min", "max", "multiply"];
function combineRule(value) {
    const rule = value ?? "average";
    if (!COMBINE_RULES.includes(rule))
        throw new Error(`Physics combine rule must be one of ${COMBINE_RULES.join(", ")}.`);
    return rule;
}
function materialName(value) {
    if (typeof value !== "string" || value.trim() === "")
        throw new Error("Physics material name cannot be empty.");
    return value;
}
/** Validates a material before it crosses the WASM boundary. */
export function validateMaterial(value) {
    const name = materialName(value.name);
    for (const [item, label] of [[value.friction, "friction"], [value.restitution, "restitution"]])
        if (!Number.isFinite(item) || item < 0)
            throw new Error(`Physics material '${name}' ${label} must be finite and non-negative.`);
    return {
        name,
        friction: value.friction,
        restitution: value.restitution,
        frictionCombine: combineRule(value.frictionCombine),
        restitutionCombine: combineRule(value.restitutionCombine),
    };
}
function validateShape(shape) {
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
            if (triangle.length !== 3 ||
                triangle.some((index) => !Number.isSafeInteger(index) ||
                    index < 0 ||
                    index >= shape.vertices.length))
                throw new Error("Physics triangle mesh indices must reference three existing vertices.");
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
    if (!Number.isSafeInteger(shape.rows) ||
        !Number.isSafeInteger(shape.columns) ||
        shape.rows < 2 ||
        shape.columns < 2)
        throw new Error("Physics heightfield requires integer rows and columns of at least 2.");
    if (shape.heights.length !== shape.rows * shape.columns ||
        !shape.heights.every(Number.isFinite))
        throw new Error(`Physics heightfield requires exactly ${String(shape.rows * shape.columns)} finite heights.`);
    vector(shape.scale, "heightfield scale");
    if (shape.scale.some((value) => value <= 0))
        throw new Error("Physics heightfield scale must be positive.");
}
function points(value, label, minimum) {
    if (value.length < minimum)
        throw new Error(`Physics ${label} needs at least ${String(minimum)} points.`);
    for (const point of value)
        vector(point, `${label} point`);
}
function characterDefaults(value) {
    const offset = value.offset ?? 0.01, stepWidth = value.autostepMinWidth ?? 0.2, climb = value.maxSlopeClimbDegrees ?? 45, slideAngle = value.minSlopeSlideDegrees ?? 50;
    positive(offset, "character offset");
    positive(stepWidth, "character autostep minimum width");
    angle(climb, "maximum slope climb");
    angle(slideAngle, "minimum slope slide");
    if (value.autostepMaxHeight !== undefined && value.autostepMaxHeight !== null)
        positive(value.autostepMaxHeight, "character autostep maximum height");
    if (value.snapToGround !== undefined &&
        value.snapToGround !== null &&
        value.snapToGround < 0)
        throw new Error("Physics character ground snap distance must be non-negative.");
    return {
        shape: structuredClone(value.shape),
        offset,
        slide: value.slide ?? true,
        autostepMaxHeight: value.autostepMaxHeight === undefined ? 0.3 : value.autostepMaxHeight,
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
function validateId(id) {
    if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error("Physics body ID must be a positive safe integer.");
}
function vector(value, label) {
    if (value.length !== 3 || !value.every(Number.isFinite))
        throw new Error(`Physics ${label} requires 3 finite numbers.`);
}
function quaternion(value) {
    if (value.length !== 4 || !value.every(Number.isFinite))
        throw new Error("Physics rotation requires 4 finite quaternion numbers.");
    if (value.every((item) => item === 0))
        throw new Error("Physics rotation quaternion cannot have zero length.");
}
function positive(value, label) {
    if (!Number.isFinite(value) || value <= 0)
        throw new Error(`Physics ${label} must be finite and positive.`);
}
function bits(value, label) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
        throw new Error(`Physics ${label} must be an unsigned 32-bit integer.`);
    return value;
}
function validateStep(value) {
    if (typeof value !== "object" || value === null)
        throw new Error("Rust 3D physics step must be an object.");
    const step = value;
    if (!Array.isArray(step.bodies) || !Array.isArray(step.events))
        throw new Error("Rust 3D physics step requires bodies and events arrays.");
    return step;
}
function isRayHit(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const hit = value;
    return (Number.isSafeInteger(hit.bodyId) &&
        typeof hit.distance === "number" &&
        Number.isFinite(hit.distance) &&
        Array.isArray(hit.point) &&
        hit.point.length === 3 &&
        Array.isArray(hit.normal) &&
        hit.normal.length === 3);
}
function isShapeHit(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const hit = value;
    return (Number.isSafeInteger(hit.bodyId) &&
        typeof hit.distance === "number" &&
        Number.isFinite(hit.distance) &&
        Array.isArray(hit.position) &&
        hit.position.length === 3 &&
        Array.isArray(hit.normal) &&
        hit.normal.length === 3);
}
function isCharacterMovement(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const movement = value;
    return (Array.isArray(movement.translation) &&
        movement.translation.length === 3 &&
        movement.translation.every(Number.isFinite) &&
        typeof movement.grounded === "boolean" &&
        typeof movement.slidingDownSlope === "boolean" &&
        Array.isArray(movement.collisions) &&
        movement.collisions.every((id) => Number.isSafeInteger(id) && id > 0));
}
function angle(value, label) {
    if (!Number.isFinite(value) || value < 0 || value > 90)
        throw new Error(`Physics character ${label} must be between 0 and 90 degrees.`);
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Validates a joint before it crosses the WASM boundary.
 *
 * The Rust side rejects bad joints too, but its error arrives as an opaque
 * string from inside a command batch. Checking here names the field and the
 * joint, which is the difference between a fixable message and a puzzle.
 */
export function validateJoint3d(spec) {
    if (!Number.isInteger(spec.id) || spec.id <= 0)
        throw new Error(`A joint id must be a positive whole number (got ${spec.id}).`);
    if (spec.bodyA === spec.bodyB)
        throw new Error(`Joint ${spec.id} cannot connect body ${spec.bodyA} to itself.`);
    const finite = (values, label) => {
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
                throw new Error(`Joint ${spec.id} has limits [${spec.joint.limits.join(", ")}], which must be ordered as [min, max].`);
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
        ]) {
            if (!Number.isFinite(value) || value < 0)
                throw new Error(`Joint ${spec.id} has a negative or non-finite ${label}.`);
        }
    }
    return spec;
}
/** A joint command, validated. */
export function addJointCommand(spec) {
    return { type: "addJoint", spec: validateJoint3d(spec) };
}
/** A hinge, which is what a door, a lid, an elbow, and a wheel all are. */
export function hingeJoint(id, bodyA, bodyB, options) {
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
export function ragdollJoints(bodies, connections, firstJointId = 1) {
    const byBone = new Map(bodies.map((body) => [body.bone, body]));
    const joints = [];
    let id = firstJointId;
    for (const [parent, child] of connections) {
        const a = byBone.get(parent);
        const b = byBone.get(child);
        if (!a || !b)
            continue;
        // The anchor is the child's origin, expressed in each body's local space.
        joints.push(validateJoint3d({
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
        }));
    }
    return joints;
}
/** The connections a humanoid ragdoll needs, in the standard bone names. */
export const HUMANOID_RAGDOLL_CONNECTIONS = [
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
//# sourceMappingURL=physics-3d.js.map