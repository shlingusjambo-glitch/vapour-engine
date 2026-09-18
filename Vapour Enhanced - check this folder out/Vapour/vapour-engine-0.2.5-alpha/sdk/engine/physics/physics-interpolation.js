/** Interpolating rendered body transforms between two physics steps.
 *
 * A worker (or a same-thread fallback, see `physics-worker-protocol.ts`) steps
 * physics on its own fixed schedule, which rarely lines up with the render
 * frame. Rendering the latest published step directly is what makes physics
 * look like it is ticking at its own low rate; interpolating between the
 * previous and latest published snapshots by how far into the current
 * physics tick the render frame falls (`alpha`, in `[0, 1]`) is what makes it
 * look smooth at any render rate.
 *
 * Pure functions only: a snapshot is exactly what
 * `PhysicsWorkerChannel.consume()` returns, and interpolating it needs no
 * state of its own — the caller keeps the previous snapshot around.
 */
import { nlerp } from "@vapour/math";
function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}
/**
 * Interpolates one body's transform between two steps.
 *
 * A sleeping body's `from` and `to` positions are identical anyway, so no
 * special case is needed for it — the lerp is a no-op.
 */
export function interpolateBody3d(from, to, alpha) {
    if (from.id !== to.id)
        throw new Error(`Cannot interpolate body ${String(from.id)} against body ${String(to.id)}: they must be the same body.`);
    const t = clamp01(alpha);
    return {
        id: to.id,
        position: [
            from.position[0] + (to.position[0] - from.position[0]) * t,
            from.position[1] + (to.position[1] - from.position[1]) * t,
            from.position[2] + (to.position[2] - from.position[2]) * t,
        ],
        rotation: nlerp(from.rotation, to.rotation, t),
    };
}
/**
 * Interpolates every body present in both snapshots.
 *
 * A body only in `to` (spawned since `from`) is rendered at its `to`
 * transform unchanged — there is no earlier state to blend from. A body only
 * in `from` (removed since) is dropped, matching the world it no longer
 * exists in.
 */
export function interpolateBodies3d(from, to, alpha) {
    const previous = new Map(from.map((body) => [body.id, body]));
    const result = [];
    for (const body of to) {
        const earlier = previous.get(body.id);
        result.push(earlier ? interpolateBody3d(earlier, body, alpha) : { id: body.id, position: body.position, rotation: body.rotation });
    }
    return result;
}
//# sourceMappingURL=physics-interpolation.js.map