import { type DebugDraw, type DebugDrawOptions } from "../diagnostics/debug-draw.js";
import { type Diagnostics } from "../diagnostics/counters.js";
import type { ColliderShape3d, ContactPoint3d, JointSpec3d, PhysicsBodyType3d, PhysicsStats3d } from "./physics-3d.js";
/** Everything the debug drawer needs about one body: its collider and where
 * it is right now. Shaped to be trivially built from a `PhysicsBodyDescriptor3d`
 * plus the matching `PhysicsBodySnapshot3d`. */
export interface PhysicsDebugBody3d {
    readonly id: number;
    readonly bodyType: PhysicsBodyType3d;
    readonly shape: ColliderShape3d;
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly sleeping: boolean;
}
/** Draws one body's collider: 12 lines for a simple shape, `12 * children`
 * for a compound, each child positioned by its own local offset. */
export declare function drawColliderDebug3d(draw: DebugDraw, body: PhysicsDebugBody3d, options?: DebugDrawOptions): void;
/** Draws one joint as a single line between its two world-space anchors. */
export declare function drawJointDebug3d(draw: DebugDraw, joint: JointSpec3d, bodies: ReadonlyMap<number, PhysicsDebugBody3d>, options?: DebugDrawOptions): void;
/** Draws one contact as a short marker along its normal: a single line. */
export declare function drawContactDebug3d(draw: DebugDraw, contact: ContactPoint3d, options?: DebugDrawOptions): void;
export interface PhysicsDebugScene3d {
    readonly bodies: readonly PhysicsDebugBody3d[];
    readonly joints?: readonly JointSpec3d[];
    readonly contacts?: readonly ContactPoint3d[];
}
/** Draws a whole scene's worth of physics debug state: every body's
 * collider, every joint's anchor line, and every contact's marker. */
export declare function drawPhysicsDebugScene3d(draw: DebugDraw, scene: PhysicsDebugScene3d): void;
/** Physics counter names. `physicsStep`, `physicsBodies`, and `physicsContacts`
 * reuse the engine-wide {@link COUNTERS}, so the overlay's existing physics
 * row keeps working; the rest are new, under the same `physics.` prefix so
 * {@link Diagnostics.grouped} still sections them together. */
export declare const PHYSICS_DEBUG_COUNTERS: {
    readonly physicsStep: "physics.step";
    readonly physicsBodies: "physics.bodies";
    readonly physicsContacts: "physics.contacts";
    readonly physicsDynamic: "physics.dynamicBodies";
    readonly physicsKinematic: "physics.kinematicBodies";
    readonly physicsFixed: "physics.fixedBodies";
    readonly physicsAwake: "physics.awakeBodies";
    readonly physicsSleeping: "physics.sleepingBodies";
    readonly physicsJoints: "physics.joints";
    readonly physicsManifolds: "physics.manifolds";
    readonly physicsContactPairs: "physics.contactPairs";
};
/**
 * Publishes one step's {@link PhysicsStats3d} into the counter registry.
 *
 * Body counts split by type and sleep state, contact/manifold counts, and
 * (when the caller measured it) the step's own wall-clock cost — the numbers
 * that explain whether a physics frame is cheap or is the hitch.
 */
export declare function recordPhysicsStats3d(diagnostics: Diagnostics, stats: PhysicsStats3d, stepTimeMs?: number): void;
//# sourceMappingURL=physics-debug.d.ts.map