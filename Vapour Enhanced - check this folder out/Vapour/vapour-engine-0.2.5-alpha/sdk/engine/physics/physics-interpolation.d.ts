import type { PhysicsBodySnapshot3d } from "./physics-3d.js";
export interface InterpolatedBody3d {
    readonly id: number;
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
}
/**
 * Interpolates one body's transform between two steps.
 *
 * A sleeping body's `from` and `to` positions are identical anyway, so no
 * special case is needed for it — the lerp is a no-op.
 */
export declare function interpolateBody3d(from: PhysicsBodySnapshot3d, to: PhysicsBodySnapshot3d, alpha: number): InterpolatedBody3d;
/**
 * Interpolates every body present in both snapshots.
 *
 * A body only in `to` (spawned since `from`) is rendered at its `to`
 * transform unchanged — there is no earlier state to blend from. A body only
 * in `from` (removed since) is dropped, matching the world it no longer
 * exists in.
 */
export declare function interpolateBodies3d(from: readonly PhysicsBodySnapshot3d[], to: readonly PhysicsBodySnapshot3d[], alpha: number): readonly InterpolatedBody3d[];
//# sourceMappingURL=physics-interpolation.d.ts.map