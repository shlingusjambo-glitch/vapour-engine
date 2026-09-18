import type { PhysicsEvent2d, PhysicsWorld2dBridge } from "./physics-2d.js";
import type { PhysicsMaterial, PhysicsWorld3dBridge } from "./physics-3d.js";
import type { SceneDocument } from "../core/scene-document.js";
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
export interface SceneCharacterMovement2d {
    readonly translation: readonly [number, number];
    readonly grounded: boolean;
    readonly slidingDownSlope: boolean;
    readonly collisions: readonly string[];
}
export interface SceneCharacterMovement3d {
    readonly translation: readonly [number, number, number];
    readonly grounded: boolean;
    readonly slidingDownSlope: boolean;
    readonly collisions: readonly string[];
}
/**
 * Owns the scene-to-native-physics contract. It incrementally reconciles
 * serialized components, advances both native worlds, writes dynamic poses
 * back into the scene, and translates numeric solver IDs into stable scene IDs.
 */
export declare class ScenePhysicsRuntime {
    #private;
    constructor(scene: SceneDocument, options: ScenePhysicsRuntimeOptions);
    get bodyCount(): number;
    /** Registers a named surface with every configured world, so a serialized
     * collider's `material: "ice"` resolves. Define materials before the first
     * `prepare` or `fixedUpdate`; a body naming an unknown material is rejected
     * by the solver. */
    defineMaterial(material: PhysicsMaterial): void;
    /** Reconciles serialized bodies before gameplay scripts issue queries. */
    prepare(): void;
    moveCharacter2d(entityId: string, desiredTranslation: readonly [number, number], timestep: number): SceneCharacterMovement2d;
    moveCharacter3d(entityId: string, desiredTranslation: readonly [number, number, number], timestep: number): SceneCharacterMovement3d;
    /** Reconciles authoring changes, performs one fixed step, and synchronizes
     * dynamic body poses. Call exactly once per GameRuntime fixed update. */
    fixedUpdate(timestep: number): readonly ScenePhysicsContact[];
    /** Removes native bodies. The injected worlds remain caller-owned. */
    destroy(): void;
}
//# sourceMappingURL=scene-physics.d.ts.map