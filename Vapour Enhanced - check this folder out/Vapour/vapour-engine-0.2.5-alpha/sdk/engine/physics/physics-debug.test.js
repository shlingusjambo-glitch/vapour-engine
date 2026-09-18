import { describe, expect, it } from "vitest";
import { DebugDraw } from "../diagnostics/debug-draw.js";
import { Diagnostics } from "../diagnostics/counters.js";
import { drawColliderDebug3d, drawPhysicsDebugScene3d, recordPhysicsStats3d, PHYSICS_DEBUG_COUNTERS, } from "./physics-debug.js";
const IDENTITY_ROTATION = [0, 0, 0, 1];
function body(overrides) {
    return {
        bodyType: "dynamic",
        position: [0, 0, 0],
        rotation: IDENTITY_ROTATION,
        sleeping: false,
        ...overrides,
    };
}
describe("drawColliderDebug3d", () => {
    it("draws a simple shape as exactly 12 lines, one per box edge", () => {
        const draw = new DebugDraw();
        drawColliderDebug3d(draw, body({ id: 1, shape: { type: "box", halfExtents: [1, 1, 1] } }));
        expect(draw.count).toBe(12);
        expect(draw.primitives().every((p) => p.kind === "line")).toBe(true);
    });
    it("draws a compound as 12 lines per child", () => {
        const draw = new DebugDraw();
        drawColliderDebug3d(draw, body({
            id: 1,
            shape: {
                type: "compound",
                children: [
                    { position: [0, 0, 0], rotation: IDENTITY_ROTATION, shape: { type: "box", halfExtents: [1, 1, 1] } },
                    { position: [1, 0, 0], rotation: IDENTITY_ROTATION, shape: { type: "sphere", radius: 0.5 } },
                ],
            },
        }));
        expect(draw.count).toBe(24);
    });
    it("tints a sleeping body differently from an awake one", () => {
        const draw = new DebugDraw();
        drawColliderDebug3d(draw, body({ id: 1, shape: { type: "sphere", radius: 1 }, sleeping: false }));
        drawColliderDebug3d(draw, body({ id: 2, shape: { type: "sphere", radius: 1 }, sleeping: true }));
        const primitives = draw.primitives();
        expect(primitives[0].color).not.toEqual(primitives[12].color);
    });
});
describe("drawPhysicsDebugScene3d", () => {
    it("matches an exact primitive count for a known scene: bodies, joints, contacts", () => {
        const draw = new DebugDraw();
        const bodies = [
            body({ id: 1, bodyType: "static", shape: { type: "box", halfExtents: [10, 0.5, 10] } }), // 12
            body({ id: 2, shape: { type: "sphere", radius: 0.5 }, position: [0, 2, 0] }), // 12
            body({ id: 3, shape: { type: "capsule", radius: 0.3, halfHeight: 0.5 }, position: [1, 2, 0], sleeping: true }), // 12
            body({
                id: 4,
                shape: {
                    type: "compound",
                    children: [
                        { position: [0, 0, 0], rotation: IDENTITY_ROTATION, shape: { type: "box", halfExtents: [0.5, 0.5, 0.5] } },
                        { position: [0, 1, 0], rotation: IDENTITY_ROTATION, shape: { type: "box", halfExtents: [0.5, 0.5, 0.5] } },
                    ],
                },
            }), // 24
        ];
        const joints = [
            { id: 1, bodyA: 2, bodyB: 3, joint: { kind: "ball", anchorA: [0, 0, 0], anchorB: [0, 0, 0] } }, // 1
            { id: 2, bodyA: 3, bodyB: 4, joint: { kind: "ball", anchorA: [0, 0, 0], anchorB: [0, 0, 0] } }, // 1
        ];
        const contacts = [
            { bodyA: 1, bodyB: 2, point: [0, 0.5, 0], normal: [0, 1, 0], distance: 0 }, // 1
            { bodyA: 1, bodyB: 3, point: [1, 0.5, 0], normal: [0, 1, 0], distance: 0 }, // 1
            { bodyA: 2, bodyB: 3, point: [0.5, 2, 0], normal: [1, 0, 0], distance: 0 }, // 1
        ];
        drawPhysicsDebugScene3d(draw, { bodies, joints, contacts });
        // 12*3 (simple shapes) + 24 (one compound, two children) + 2 (joints) + 3 (contacts)
        expect(draw.count).toBe(60 + 2 + 3);
    });
    it("skips a joint whose body was not included in the scene", () => {
        const draw = new DebugDraw();
        const bodies = [body({ id: 1, shape: { type: "sphere", radius: 1 } })];
        const joints = [{ id: 1, bodyA: 1, bodyB: 99, joint: { kind: "ball", anchorA: [0, 0, 0], anchorB: [0, 0, 0] } }];
        drawPhysicsDebugScene3d(draw, { bodies, joints });
        expect(draw.count).toBe(12); // the sphere only; the dangling joint drew nothing
    });
});
describe("recordPhysicsStats3d", () => {
    it("publishes every field of a known PhysicsStats3d into the counter registry exactly", () => {
        const diagnostics = new Diagnostics();
        const stats = {
            bodies: 42,
            dynamic: 30,
            kinematic: 2,
            fixed: 10,
            awake: 25,
            sleeping: 17,
            joints: 6,
            materials: 3,
            contactPairs: 14,
            manifolds: 12,
            contactPoints: 38,
        };
        recordPhysicsStats3d(diagnostics, stats, 4.5);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsBodies).value).toBe(42);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsDynamic).value).toBe(30);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsKinematic).value).toBe(2);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsFixed).value).toBe(10);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsAwake).value).toBe(25);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsSleeping).value).toBe(17);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsJoints).value).toBe(6);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsManifolds).value).toBe(12);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsContactPairs).value).toBe(14);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsContacts).value).toBe(38);
        expect(diagnostics.counter(PHYSICS_DEBUG_COUNTERS.physicsStep).value).toBe(4.5);
    });
});
//# sourceMappingURL=physics-debug.test.js.map