import { type CombineRule, type PhysicsEventKind, type PhysicsMaterial } from "./physics-3d.js";
export type PhysicsBodyType2d = "static" | "dynamic" | "kinematicPosition" | "kinematicVelocity";
export type ColliderShape2d = {
    readonly type: "rectangle";
    readonly halfExtents: readonly [number, number];
} | {
    readonly type: "circle";
    readonly radius: number;
} | {
    readonly type: "capsule";
    readonly halfHeight: number;
    readonly radius: number;
} | {
    readonly type: "convexPolygon";
    readonly points: readonly (readonly [number, number])[];
};
export interface PhysicsBodyDescriptor2d {
    readonly id: number;
    readonly bodyType: PhysicsBodyType2d;
    readonly position: readonly [number, number];
    readonly rotation?: number;
    readonly linearVelocity?: readonly [number, number];
    readonly angularVelocity?: number;
    readonly gravityScale?: number;
    readonly linearDamping?: number;
    readonly angularDamping?: number;
    readonly continuousCollisionDetection?: boolean;
    readonly shape: ColliderShape2d;
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
}
export interface PhysicsEvent2d {
    readonly kind: PhysicsEventKind;
    readonly bodyA: number;
    readonly bodyB: number;
}
export interface PhysicsBodySnapshot2d {
    readonly id: number;
    readonly position: readonly [number, number];
    readonly rotation: number;
    readonly linearVelocity: readonly [number, number];
    readonly angularVelocity: number;
    readonly sleeping: boolean;
}
export interface PhysicsStep2d {
    readonly bodies: readonly PhysicsBodySnapshot2d[];
    readonly events: readonly PhysicsEvent2d[];
}
export interface RaycastHit2d {
    readonly bodyId: number;
    readonly distance: number;
    readonly point: readonly [number, number];
    readonly normal: readonly [number, number];
}
export interface ShapeCastHit2d {
    readonly bodyId: number;
    readonly distance: number;
    readonly position: readonly [number, number];
    readonly normal: readonly [number, number];
}
export interface CharacterController2dOptions {
    readonly shape: ColliderShape2d;
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
export interface CharacterMovement2d {
    readonly translation: readonly [number, number];
    readonly grounded: boolean;
    readonly slidingDownSlope: boolean;
    readonly collisions: readonly number[];
}
export type CompleteDescriptor2d = Omit<Required<PhysicsBodyDescriptor2d>, "shape" | "material"> & {
    readonly shape: ColliderShape2d;
    readonly material: string | null;
};
export type PhysicsCommand2d = {
    readonly type: "insert";
    readonly descriptor: CompleteDescriptor2d;
} | {
    readonly type: "remove";
    readonly id: number;
} | {
    readonly type: "addForce";
    readonly id: number;
    readonly force: readonly [number, number];
} | {
    readonly type: "addForceAtPoint";
    readonly id: number;
    readonly force: readonly [number, number];
    readonly point: readonly [number, number];
} | {
    readonly type: "addTorque";
    readonly id: number;
    readonly torque: number;
} | {
    readonly type: "applyImpulse";
    readonly id: number;
    readonly impulse: readonly [number, number];
} | {
    readonly type: "applyTorqueImpulse";
    readonly id: number;
    readonly torque: number;
} | {
    readonly type: "setLinearVelocity";
    readonly id: number;
    readonly velocity: readonly [number, number];
} | {
    readonly type: "setAngularVelocity";
    readonly id: number;
    readonly velocity: number;
} | {
    readonly type: "setKinematicTarget";
    readonly id: number;
    readonly position: readonly [number, number];
    readonly rotation: number;
} | {
    readonly type: "setGravity";
    readonly gravity: readonly [number, number];
} | {
    readonly type: "defineMaterial";
    readonly material: Required<PhysicsMaterial>;
} | {
    readonly type: "setMaterial";
    readonly id: number;
    readonly name: string;
};
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
interface PhysicsWasmModule {
    default(moduleOrPath?: WebAssembly.Module | URL | RequestInfo): Promise<unknown>;
    PhysicsEngine2d: new (gravityX: number, gravityY: number) => PhysicsEngine2dWasm;
}
export type PhysicsWasmModuleLoader2d = (moduleUrl: string) => Promise<PhysicsWasmModule>;
export interface CreatePhysicsWorld2dOptions {
    readonly gravity?: readonly [number, number];
    readonly moduleUrl?: string;
    readonly loadModule?: PhysicsWasmModuleLoader2d;
}
/** Loads the shared Rust/WASM artifact and constructs a native 2D world. */
export declare function createPhysicsWorld2d(options?: CreatePhysicsWorld2dOptions): Promise<PhysicsWorld2dBridge>;
/** Batched, language-neutral facade shared by VS and TypeScript gameplay. */
export declare class PhysicsWorld2dBridge {
    #private;
    constructor(wasm: PhysicsEngine2dWasm);
    get pendingCommands(): number;
    get bodyCount(): number;
    destroy(): void;
    insert(descriptor: PhysicsBodyDescriptor2d): void;
    remove(id: number): void;
    addForce(id: number, force: readonly [number, number]): void;
    addForceAtPoint(id: number, force: readonly [number, number], point: readonly [number, number]): void;
    addTorque(id: number, torque: number): void;
    applyImpulse(id: number, impulse: readonly [number, number]): void;
    applyTorqueImpulse(id: number, torque: number): void;
    setLinearVelocity(id: number, velocity: readonly [number, number]): void;
    setAngularVelocity(id: number, velocity: number): void;
    setKinematicTarget(id: number, position: readonly [number, number], rotation: number): void;
    setGravity(gravity: readonly [number, number]): void;
    /** Registers or redefines a named surface; see the 3D bridge for semantics. */
    defineMaterial(material: PhysicsMaterial): void;
    setMaterial(id: number, name: string): void;
    flush(): number;
    step(timestep: number): PhysicsStep2d;
    raycast(origin: readonly [number, number], direction: readonly [number, number], maxDistance: number, options?: {
        readonly layer?: number;
        readonly mask?: number;
        readonly includeSensors?: boolean;
    }): RaycastHit2d | undefined;
    overlapShape(position: readonly [number, number], rotation: number, shape: ColliderShape2d, options?: {
        readonly layer?: number;
        readonly mask?: number;
        readonly includeSensors?: boolean;
    }): readonly number[];
    castShape(position: readonly [number, number], rotation: number, direction: readonly [number, number], maxDistance: number, shape: ColliderShape2d, options?: {
        readonly layer?: number;
        readonly mask?: number;
        readonly includeSensors?: boolean;
    }): ShapeCastHit2d | undefined;
    moveCharacter(timestep: number, position: readonly [number, number], rotation: number, desiredTranslation: readonly [number, number], options: CharacterController2dOptions): CharacterMovement2d;
}
export {};
//# sourceMappingURL=physics-2d.d.ts.map