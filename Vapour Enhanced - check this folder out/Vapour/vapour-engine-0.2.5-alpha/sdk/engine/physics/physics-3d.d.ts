export type PhysicsBodyType3d = "static" | "dynamic" | "kinematicPosition" | "kinematicVelocity";
export type ColliderShape3d = {
    readonly type: "box";
    readonly halfExtents: readonly [number, number, number];
} | {
    readonly type: "sphere";
    readonly radius: number;
} | {
    readonly type: "capsule";
    readonly halfHeight: number;
    readonly radius: number;
} | {
    readonly type: "cylinder";
    readonly halfHeight: number;
    readonly radius: number;
} | {
    readonly type: "plane";
    readonly normal: readonly [number, number, number];
} | {
    readonly type: "convexMesh";
    readonly points: readonly (readonly [number, number, number])[];
} | {
    readonly type: "triangleMesh";
    readonly vertices: readonly (readonly [number, number, number])[];
    readonly indices: readonly (readonly [number, number, number])[];
} | {
    readonly type: "heightfield";
    readonly rows: number;
    readonly columns: number;
    readonly heights: readonly number[];
    readonly scale: readonly [number, number, number];
} | {
    readonly type: "compound";
    readonly children: readonly CompoundColliderChild3d[];
};
export interface CompoundColliderChild3d {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly shape: ColliderShape3d;
}
/**
 * How two colliders' friction or restitution coefficients are reconciled.
 *
 * `min` is the rule that makes "slippery wins" work, `max` the one that makes
 * "bouncy wins" work, and `average` is the default because it is the least
 * surprising. When the two sides disagree Rapier takes the stronger rule, in
 * the order `max` > `multiply` > `min` > `average`.
 */
export type CombineRule = "average" | "min" | "max" | "multiply";
/**
 * A named surface. Define it once with {@link PhysicsWorld3dBridge.defineMaterial}
 * and reference it from any number of bodies; retuning "ice" then changes every
 * icy collider built after the redefinition (and, via `setMaterial`, before).
 */
export interface PhysicsMaterial {
    readonly name: string;
    readonly friction: number;
    readonly restitution: number;
    readonly frictionCombine?: CombineRule;
    readonly restitutionCombine?: CombineRule;
}
/**
 * Explicit mass, centre of mass, and inertia, replacing the density-derived
 * values. Offsetting the centre of mass is what makes a bottom-heavy buoy
 * right itself and a top-heavy crate tip.
 */
export interface MassProperties3d {
    readonly mass: number;
    /** In the body's own local space. */
    readonly centerOfMass: readonly [number, number, number];
    /** Principal moments; derived from the shape and `mass` when omitted. */
    readonly principalInertia?: readonly [number, number, number];
}
/** What the solver carried in the last step. */
export interface PhysicsStats3d {
    readonly bodies: number;
    readonly dynamic: number;
    readonly kinematic: number;
    readonly fixed: number;
    readonly awake: number;
    readonly sleeping: number;
    readonly joints: number;
    readonly materials: number;
    readonly contactPairs: number;
    readonly manifolds: number;
    readonly contactPoints: number;
}
/** One solver contact in world space; `normal` points out of `bodyA`. */
export interface ContactPoint3d {
    readonly bodyA: number;
    readonly bodyB: number;
    readonly point: readonly [number, number, number];
    readonly normal: readonly [number, number, number];
    readonly distance: number;
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
    /** A material name; replaces `friction`/`restitution` and supplies combine rules. */
    readonly material?: string;
    readonly frictionCombine?: CombineRule;
    readonly restitutionCombine?: CombineRule;
    readonly massProperties?: MassProperties3d;
}
export type PhysicsEventKind = "collisionEnter" | "collisionExit" | "triggerEnter" | "triggerExit";
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
    /** Absent only from WASM builds that predate physics statistics. */
    readonly stats?: PhysicsStats3d;
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
export type JointDescriptor3d = {
    readonly kind: "fixed";
    readonly anchorA: readonly [number, number, number];
    readonly anchorB: readonly [number, number, number];
} | {
    readonly kind: "hinge";
    readonly anchorA: readonly [number, number, number];
    readonly anchorB: readonly [number, number, number];
    readonly axis: readonly [number, number, number];
    /** Angular limits in radians, as `[min, max]`. */
    readonly limits?: readonly [number, number];
    /** Target angular velocity and maximum force, as `[velocity, force]`. */
    readonly motor?: readonly [number, number];
} | {
    readonly kind: "slider";
    readonly anchorA: readonly [number, number, number];
    readonly anchorB: readonly [number, number, number];
    readonly axis: readonly [number, number, number];
    /** Travel limits along the axis, as `[min, max]`. */
    readonly limits?: readonly [number, number];
    readonly motor?: readonly [number, number];
} | {
    readonly kind: "ball";
    readonly anchorA: readonly [number, number, number];
    readonly anchorB: readonly [number, number, number];
} | {
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
/** A descriptor with every default applied, as it crosses into WASM. */
export type CompleteDescriptor3d = Omit<Required<PhysicsBodyDescriptor3d>, "material" | "massProperties"> & {
    readonly material: string | null;
    readonly massProperties: MassProperties3d | null;
};
export type PhysicsCommand3d = {
    readonly type: "insert";
    readonly descriptor: CompleteDescriptor3d;
} | {
    readonly type: "remove";
    readonly id: number;
} | {
    readonly type: "addForce";
    readonly id: number;
    readonly force: readonly [number, number, number];
} | {
    readonly type: "addForceAtPoint";
    readonly id: number;
    readonly force: readonly [number, number, number];
    readonly point: readonly [number, number, number];
} | {
    readonly type: "addTorque";
    readonly id: number;
    readonly torque: readonly [number, number, number];
} | {
    readonly type: "applyImpulse";
    readonly id: number;
    readonly impulse: readonly [number, number, number];
} | {
    readonly type: "applyTorqueImpulse";
    readonly id: number;
    readonly torque: readonly [number, number, number];
} | {
    readonly type: "setLinearVelocity";
    readonly id: number;
    readonly velocity: readonly [number, number, number];
} | {
    readonly type: "setAngularVelocity";
    readonly id: number;
    readonly velocity: readonly [number, number, number];
} | {
    readonly type: "setKinematicTarget";
    readonly id: number;
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
} | {
    readonly type: "addJoint";
    readonly spec: JointSpec3d;
} | {
    readonly type: "removeJoint";
    readonly id: number;
} | {
    readonly type: "setJointMotor";
    readonly id: number;
    readonly targetVelocity: number;
    readonly maxForce: number;
} | {
    readonly type: "setGravity";
    readonly gravity: readonly [number, number, number];
} | {
    readonly type: "defineMaterial";
    readonly material: Required<PhysicsMaterial>;
} | {
    readonly type: "setMaterial";
    readonly id: number;
    readonly name: string;
};
export interface PhysicsEngine3dWasm {
    apply_commands(json: string): number;
    step_json(timestep: number): string;
    raycast_json(origin: Float32Array, direction: Float32Array, maxDistance: number, layer: number, mask: number, includeSensors: boolean, excludeBody: number): string;
    overlap_shape_json(position: Float32Array, rotation: Float32Array, shape: string, layer: number, mask: number, includeSensors: boolean): string;
    cast_shape_json(position: Float32Array, rotation: Float32Array, direction: Float32Array, maxDistance: number, shape: string, layer: number, mask: number, includeSensors: boolean): string;
    move_character_json(timestep: number, position: Float32Array, rotation: Float32Array, desiredTranslation: Float32Array, descriptor: string): string;
    body_count(): number;
    joint_count(): number;
    /** Absent from WASM builds that predate contact reporting. */
    contacts_json?(): string;
    free(): void;
}
interface PhysicsWasmModule {
    default(moduleOrPath?: WebAssembly.Module | URL | RequestInfo): Promise<unknown>;
    PhysicsEngine3d: new (gravityX: number, gravityY: number, gravityZ: number) => PhysicsEngine3dWasm;
}
export type PhysicsWasmModuleLoader = (moduleUrl: string) => Promise<PhysicsWasmModule>;
export interface CreatePhysicsWorld3dOptions {
    readonly gravity?: readonly [number, number, number];
    readonly moduleUrl?: string;
    readonly loadModule?: PhysicsWasmModuleLoader;
}
/** Loads Vapour's shared Rust/WASM artifact and constructs a Rapier world. */
export declare function createPhysicsWorld3d(options?: CreatePhysicsWorld3dOptions): Promise<PhysicsWorld3dBridge>;
/** Coarse-grained VS/TypeScript facade over the Rust Rapier world. Mutations
 * queue locally and cross into WASM as one command array per fixed step. */
export declare class PhysicsWorld3dBridge {
    #private;
    constructor(wasm: PhysicsEngine3dWasm);
    get pendingCommands(): number;
    get bodyCount(): number;
    destroy(): void;
    insert(descriptor: PhysicsBodyDescriptor3d): void;
    remove(id: number): void;
    addForce(id: number, force: readonly [number, number, number]): void;
    addForceAtPoint(id: number, force: readonly [number, number, number], point: readonly [number, number, number]): void;
    addTorque(id: number, torque: readonly [number, number, number]): void;
    applyImpulse(id: number, impulse: readonly [number, number, number]): void;
    applyTorqueImpulse(id: number, torque: readonly [number, number, number]): void;
    setLinearVelocity(id: number, velocity: readonly [number, number, number]): void;
    setAngularVelocity(id: number, velocity: readonly [number, number, number]): void;
    setKinematicTarget(id: number, position: readonly [number, number, number], rotation: readonly [number, number, number, number]): void;
    setGravity(gravity: readonly [number, number, number]): void;
    /** Registers or redefines a named surface. Bodies inserted afterwards may
     * reference it; bodies already built keep their coefficients until
     * {@link setMaterial}. */
    defineMaterial(material: PhysicsMaterial): void;
    /** Re-surfaces an existing body: wet asphalt, an iced-over ramp. */
    setMaterial(id: number, name: string): void;
    /** Solver contacts from the last step, for debug rendering. Empty on WASM
     * builds that predate contact reporting. */
    contacts(): readonly ContactPoint3d[];
    flush(): number;
    step(timestep: number): PhysicsStep3d;
    raycast(origin: readonly [number, number, number], direction: readonly [number, number, number], maxDistance: number, options?: {
        readonly layer?: number;
        readonly mask?: number;
        readonly includeSensors?: boolean;
        /** A body the ray ignores — the one it is cast from. */
        readonly excludeBody?: number;
    }): RaycastHit3d | undefined;
    overlapShape(position: readonly [number, number, number], rotation: readonly [number, number, number, number], shape: ColliderShape3d, options?: {
        readonly layer?: number;
        readonly mask?: number;
        readonly includeSensors?: boolean;
    }): readonly number[];
    castShape(position: readonly [number, number, number], rotation: readonly [number, number, number, number], direction: readonly [number, number, number], maxDistance: number, shape: ColliderShape3d, options?: {
        readonly layer?: number;
        readonly mask?: number;
        readonly includeSensors?: boolean;
    }): ShapeCastHit3d | undefined;
    moveCharacter(timestep: number, position: readonly [number, number, number], rotation: readonly [number, number, number, number], desiredTranslation: readonly [number, number, number], options: CharacterController3dOptions): CharacterMovement3d;
}
/** Validates a material before it crosses the WASM boundary. */
export declare function validateMaterial(value: PhysicsMaterial): Required<PhysicsMaterial>;
/**
 * Validates a joint before it crosses the WASM boundary.
 *
 * The Rust side rejects bad joints too, but its error arrives as an opaque
 * string from inside a command batch. Checking here names the field and the
 * joint, which is the difference between a fixable message and a puzzle.
 */
export declare function validateJoint3d(spec: JointSpec3d): JointSpec3d;
/** A joint command, validated. */
export declare function addJointCommand(spec: JointSpec3d): PhysicsCommand3d;
/** A hinge, which is what a door, a lid, an elbow, and a wheel all are. */
export declare function hingeJoint(id: number, bodyA: number, bodyB: number, options: {
    readonly anchorA: readonly [number, number, number];
    readonly anchorB: readonly [number, number, number];
    readonly axis?: readonly [number, number, number];
    readonly limits?: readonly [number, number];
    readonly motor?: readonly [number, number];
}): JointSpec3d;
/**
 * A ragdoll: one ball joint per limb connection.
 *
 * Built from a character's bone positions, so the joints line up with the
 * capsules the asset system already generated for the same skeleton. The two
 * agreeing is what stops a ragdoll from folding through its own body.
 */
export declare function ragdollJoints(bodies: readonly {
    readonly id: number;
    readonly bone: string;
    readonly position: readonly [number, number, number];
}[], connections: readonly (readonly [string, string])[], firstJointId?: number): readonly JointSpec3d[];
/** The connections a humanoid ragdoll needs, in the standard bone names. */
export declare const HUMANOID_RAGDOLL_CONNECTIONS: readonly (readonly [
    string,
    string
])[];
export {};
//# sourceMappingURL=physics-3d.d.ts.map