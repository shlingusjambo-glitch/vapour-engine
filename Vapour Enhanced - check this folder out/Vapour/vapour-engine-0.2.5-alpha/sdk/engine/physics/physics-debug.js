/** Physics debug rendering and statistics.
 *
 * Two separate jobs, both read-only against the rest of the engine:
 *
 * - Drawing collider shapes, joints, and contacts into the shared
 *   `DebugDraw` buffer (`../diagnostics/debug-draw.js`), following its
 *   existing immediate-mode conventions exactly.
 * - Publishing the solver's own numbers (`PhysicsStats3d`, straight off
 *   `PhysicsWorld3dBridge.step()`) into the shared counter registry
 *   (`../diagnostics/counters.js`), so the overlay shows physics cost with no
 *   physics-specific code of its own.
 *
 * Every collider is drawn as a wireframe oriented bounding box — "a wireframe
 * or bounds-based representation is fine" for debug draw, and a fixed shape
 * (12 edges, always) is what makes the primitive count predictable: a scene
 * with N leaf colliders and M joints and K contacts costs exactly
 * `12*N + M + K` debug-draw primitives, which is also what makes this module
 * testable without a renderer.
 */
import { compose, transformPoint } from "@vapour/math";
import { DEBUG_CATEGORIES, DEBUG_COLORS } from "../diagnostics/debug-draw.js";
import { COUNTERS } from "../diagnostics/counters.js";
const CATEGORY = DEBUG_CATEGORIES.physics;
/** Local-space half-extents of the box that bounds a collider shape. */
function localHalfExtents(shape) {
    switch (shape.type) {
        case "box":
            return shape.halfExtents;
        case "sphere":
            return [shape.radius, shape.radius, shape.radius];
        case "capsule":
        case "cylinder":
            return [shape.radius, shape.halfHeight + (shape.type === "capsule" ? shape.radius : 0), shape.radius];
        case "plane":
            // Infinite in its own plane; drawn as a large flat marker instead.
            return [10, 0.01, 10];
        case "convexMesh":
            return extentsOf(shape.points);
        case "triangleMesh":
            return extentsOf(shape.vertices);
        case "heightfield": {
            const halfWidth = ((shape.columns - 1) * shape.scale[0]) / 2;
            const halfDepth = ((shape.rows - 1) * shape.scale[2]) / 2;
            const min = Math.min(...shape.heights);
            const max = Math.max(...shape.heights);
            return [halfWidth, ((max - min) * shape.scale[1]) / 2 || 0.01, halfDepth];
        }
        case "compound":
            return extentsOf(shape.children.map((child) => child.position));
    }
}
function extentsOf(points) {
    let [minX, minY, minZ] = [Infinity, Infinity, Infinity];
    let [maxX, maxY, maxZ] = [-Infinity, -Infinity, -Infinity];
    for (const [x, y, z] of points) {
        if (x < minX)
            minX = x;
        if (y < minY)
            minY = y;
        if (z < minZ)
            minZ = z;
        if (x > maxX)
            maxX = x;
        if (y > maxY)
            maxY = y;
        if (z > maxZ)
            maxZ = z;
    }
    return [(maxX - minX) / 2 || 0.01, (maxY - minY) / 2 || 0.01, (maxZ - minZ) / 2 || 0.01];
}
/** Colour convention: sleeping bodies read as dim/white, static geometry as
 * white, and awake dynamic/kinematic bodies as green — the same "asleep is
 * quiet, awake is doing work" convention {@link PhysicsStats3d} reports. */
function colliderColor(bodyType, sleeping) {
    if (bodyType === "static")
        return DEBUG_COLORS.white;
    if (sleeping)
        return DEBUG_COLORS.cyan;
    return DEBUG_COLORS.green;
}
/** Draws one oriented wireframe box: exactly 12 `line()` calls, always. */
function drawObb(draw, transform, halfExtents, options) {
    const [hx, hy, hz] = halfExtents;
    const local = [
        [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz],
        [-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz],
    ];
    const corners = local.map((point) => transformPoint(transform, point));
    const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (const [a, b] of edges)
        draw.line(corners[a], corners[b], options);
}
/** Draws one body's collider: 12 lines for a simple shape, `12 * children`
 * for a compound, each child positioned by its own local offset. */
export function drawColliderDebug3d(draw, body, options = {}) {
    const color = options.color ?? colliderColor(body.bodyType, body.sleeping);
    const drawOptions = { category: CATEGORY, ...options, color };
    const bodyTransform = compose(body.position, body.rotation, [1, 1, 1]);
    if (body.shape.type === "compound") {
        for (const child of body.shape.children) {
            const childTransform = multiplyCompose(bodyTransform, child.position, child.rotation);
            drawObb(draw, childTransform, localHalfExtents(child.shape), drawOptions);
        }
        return;
    }
    drawObb(draw, bodyTransform, localHalfExtents(body.shape), drawOptions);
}
function multiplyCompose(parent, localPosition, localRotation) {
    const local = compose(localPosition, localRotation, [1, 1, 1]);
    // Column-major, "apply right first": parent * local places the child in
    // the parent's space, matching how `compound` colliders are interpreted
    // when Rapier builds them.
    return matMul(parent, local);
}
function matMul(a, b) {
    const out = new Array(16).fill(0);
    for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
            out[column * 4 + row] =
                a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
        }
    }
    return out;
}
/** Draws one joint as a single line between its two world-space anchors. */
export function drawJointDebug3d(draw, joint, bodies, options = {}) {
    const a = bodies.get(joint.bodyA);
    const b = bodies.get(joint.bodyB);
    if (!a || !b)
        return; // a body the caller did not include; nothing to anchor to
    const anchorA = transformPoint(compose(a.position, a.rotation, [1, 1, 1]), joint.joint.anchorA);
    const anchorB = transformPoint(compose(b.position, b.rotation, [1, 1, 1]), joint.joint.anchorB);
    draw.line(anchorA, anchorB, { category: CATEGORY, color: DEBUG_COLORS.magenta, ...options });
}
/** Draws one contact as a short marker along its normal: a single line. */
export function drawContactDebug3d(draw, contact, options = {}) {
    const length = 0.1;
    const from = contact.point;
    const to = [
        contact.point[0] + contact.normal[0] * length,
        contact.point[1] + contact.normal[1] * length,
        contact.point[2] + contact.normal[2] * length,
    ];
    draw.line(from, to, { category: CATEGORY, color: DEBUG_COLORS.orange, ...options });
}
/** Draws a whole scene's worth of physics debug state: every body's
 * collider, every joint's anchor line, and every contact's marker. */
export function drawPhysicsDebugScene3d(draw, scene) {
    const bodies = new Map(scene.bodies.map((body) => [body.id, body]));
    for (const body of scene.bodies)
        drawColliderDebug3d(draw, body);
    for (const joint of scene.joints ?? [])
        drawJointDebug3d(draw, joint, bodies);
    for (const contact of scene.contacts ?? [])
        drawContactDebug3d(draw, contact);
}
/** Physics counter names. `physicsStep`, `physicsBodies`, and `physicsContacts`
 * reuse the engine-wide {@link COUNTERS}, so the overlay's existing physics
 * row keeps working; the rest are new, under the same `physics.` prefix so
 * {@link Diagnostics.grouped} still sections them together. */
export const PHYSICS_DEBUG_COUNTERS = {
    physicsStep: COUNTERS.physicsStep,
    physicsBodies: COUNTERS.physicsBodies,
    physicsContacts: COUNTERS.physicsContacts,
    physicsDynamic: "physics.dynamicBodies",
    physicsKinematic: "physics.kinematicBodies",
    physicsFixed: "physics.fixedBodies",
    physicsAwake: "physics.awakeBodies",
    physicsSleeping: "physics.sleepingBodies",
    physicsJoints: "physics.joints",
    physicsManifolds: "physics.manifolds",
    physicsContactPairs: "physics.contactPairs",
};
/**
 * Publishes one step's {@link PhysicsStats3d} into the counter registry.
 *
 * Body counts split by type and sleep state, contact/manifold counts, and
 * (when the caller measured it) the step's own wall-clock cost — the numbers
 * that explain whether a physics frame is cheap or is the hitch.
 */
export function recordPhysicsStats3d(diagnostics, stats, stepTimeMs) {
    diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsBodies, stats.bodies);
    diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsDynamic, stats.dynamic);
    diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsKinematic, stats.kinematic);
    diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsFixed, stats.fixed);
    diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsAwake, stats.awake);
    diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsSleeping, stats.sleeping);
    diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsJoints, stats.joints);
    diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsManifolds, stats.manifolds);
    diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsContactPairs, stats.contactPairs);
    diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsContacts, stats.contactPoints);
    if (stepTimeMs !== undefined)
        diagnostics.set(PHYSICS_DEBUG_COUNTERS.physicsStep, stepTimeMs, { unit: "milliseconds" });
}
//# sourceMappingURL=physics-debug.js.map