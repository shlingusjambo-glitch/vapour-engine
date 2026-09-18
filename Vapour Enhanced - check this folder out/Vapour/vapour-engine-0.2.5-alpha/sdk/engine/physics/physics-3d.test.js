import { describe, expect, it, vi } from "vitest";
import { createPhysicsWorld3d, PhysicsWorld3dBridge, } from "./physics-3d.js";
function fake() {
    const batches = [];
    return {
        batches,
        apply_commands: vi.fn((json) => {
            const batch = JSON.parse(json);
            batches.push(batch);
            return batch.length;
        }),
        step_json: vi.fn(() => JSON.stringify({ bodies: [], events: [] })),
        raycast_json: vi.fn(() => JSON.stringify({
            bodyId: 7,
            distance: 3,
            point: [0, 0, 1],
            normal: [0, 0, 1],
        })),
        overlap_shape_json: vi.fn(() => "[7,9]"),
        cast_shape_json: vi.fn(() => JSON.stringify({
            bodyId: 7,
            distance: 2.5,
            position: [0, 0, 1.5],
            normal: [0, 0, 1],
        })),
        move_character_json: vi.fn(() => JSON.stringify({
            translation: [1, 0, 0],
            grounded: true,
            slidingDownSlope: false,
            collisions: [7],
        })),
        body_count: () => 0,
        joint_count: () => 0,
        free: vi.fn(),
    };
}
describe("PhysicsWorld3dBridge", () => {
    it("batches validated body mutations across the WASM boundary", () => {
        const wasm = fake(), world = new PhysicsWorld3dBridge(wasm);
        world.insert({
            id: 1,
            bodyType: "dynamic",
            position: [0, 2, 0],
            rotation: [0, 0, 0, 1],
            shape: { type: "sphere", radius: 0.5 },
        });
        world.applyImpulse(1, [2, 0, 0]);
        expect(world.pendingCommands).toBe(2);
        expect(world.step(1 / 60)).toEqual({ bodies: [], events: [] });
        expect(wasm.batches[0]).toMatchObject([
            { type: "insert", descriptor: { id: 1, friction: 0.5, layer: 1 } },
            { type: "applyImpulse", id: 1, impulse: [2, 0, 0] },
        ]);
    });
    it("batches forces at points, torque, and angular velocity", () => {
        const wasm = fake(), world = new PhysicsWorld3dBridge(wasm);
        world.addForceAtPoint(1, [10, 0, 0], [0, 1, 0]);
        world.addTorque(1, [0, 2, 0]);
        world.applyTorqueImpulse(1, [0, 0, 3]);
        world.setAngularVelocity(1, [1, 2, 3]);
        world.flush();
        expect(wasm.batches[0]).toEqual([
            { type: "addForceAtPoint", id: 1, force: [10, 0, 0], point: [0, 1, 0] },
            { type: "addTorque", id: 1, torque: [0, 2, 0] },
            { type: "applyTorqueImpulse", id: 1, torque: [0, 0, 3] },
            { type: "setAngularVelocity", id: 1, velocity: [1, 2, 3] },
        ]);
    });
    it("uses typed ray vectors and returns stable hits", () => {
        const wasm = fake(), world = new PhysicsWorld3dBridge(wasm);
        expect(world.raycast([0, 0, 4], [0, 0, -1], 10)).toMatchObject({
            bodyId: 7,
            distance: 3,
        });
        expect(wasm.raycast_json).toHaveBeenCalledWith(expect.any(Float32Array), expect.any(Float32Array), 10, 1, 0xffff_ffff, false, 0);
        world.raycast([0, 0, 4], [0, 0, -1], 10, { excludeBody: 3 });
        expect(wasm.raycast_json).toHaveBeenLastCalledWith(expect.any(Float32Array), expect.any(Float32Array), 10, 1, 0xffff_ffff, false, 3);
    });
    it("exposes exact overlap and swept-shape queries", () => {
        const world = new PhysicsWorld3dBridge(fake());
        expect(world.overlapShape([0, 0, 0], [0, 0, 0, 1], {
            type: "sphere",
            radius: 1,
        })).toEqual([7, 9]);
        expect(world.castShape([0, 0, 4], [0, 0, 0, 1], [0, 0, -1], 10, {
            type: "sphere",
            radius: 0.5,
        })).toMatchObject({ bodyId: 7, distance: 2.5 });
    });
    it("runs the native slope and stair character controller", () => {
        const world = new PhysicsWorld3dBridge(fake());
        expect(world.moveCharacter(1 / 60, [0, 1, 0], [0, 0, 0, 1], [1, -0.1, 0], {
            shape: { type: "capsule", halfHeight: 0.5, radius: 0.3 },
        })).toEqual({
            translation: [1, 0, 0],
            grounded: true,
            slidingDownSlope: false,
            collisions: [7],
        });
    });
    it("batches reusable plane, mesh, convex, and heightfield colliders", () => {
        const wasm = fake(), world = new PhysicsWorld3dBridge(wasm);
        const base = {
            bodyType: "static",
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        world.insert({
            ...base,
            id: 1,
            shape: { type: "plane", normal: [0, 1, 0] },
        });
        world.insert({
            ...base,
            id: 2,
            shape: {
                type: "triangleMesh",
                vertices: [
                    [0, 0, 0],
                    [1, 0, 0],
                    [0, 0, 1],
                ],
                indices: [[0, 1, 2]],
            },
        });
        world.insert({
            ...base,
            id: 3,
            shape: {
                type: "convexMesh",
                points: [
                    [0, 1, 0],
                    [-1, -1, -1],
                    [1, -1, -1],
                    [0, -1, 1],
                ],
            },
        });
        world.insert({
            ...base,
            id: 4,
            shape: {
                type: "heightfield",
                rows: 2,
                columns: 2,
                heights: [0, 1, 0, 1],
                scale: [10, 2, 10],
            },
        });
        world.flush();
        expect(wasm.batches[0]?.map((command) => command.descriptor.shape.type)).toEqual(["plane", "triangleMesh", "convexMesh", "heightfield"]);
    });
    it("batches nested compound colliders with local child transforms", () => {
        const wasm = fake(), world = new PhysicsWorld3dBridge(wasm);
        world.insert({
            id: 5,
            bodyType: "dynamic",
            position: [0, 2, 0],
            rotation: [0, 0, 0, 1],
            shape: {
                type: "compound",
                children: [
                    {
                        position: [-1, 0, 0],
                        rotation: [0, 0, 0, 1],
                        shape: { type: "sphere", radius: 0.5 },
                    },
                    {
                        position: [1, 0, 0],
                        rotation: [0, 0, 0, 1],
                        shape: {
                            type: "compound",
                            children: [
                                {
                                    position: [0, 0.5, 0],
                                    rotation: [0, 0, 0, 1],
                                    shape: { type: "box", halfExtents: [0.5, 0.5, 0.5] },
                                },
                            ],
                        },
                    },
                ],
            },
        });
        world.flush();
        expect((wasm.batches[0]?.[0]).descriptor.shape.children[1].shape.type).toBe("compound");
    });
    it("rejects malformed static-world geometry before crossing WASM", () => {
        const world = new PhysicsWorld3dBridge(fake());
        const base = {
            id: 1,
            bodyType: "static",
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        expect(() => world.insert({
            ...base,
            shape: {
                type: "heightfield",
                rows: 3,
                columns: 3,
                heights: [0],
                scale: [1, 1, 1],
            },
        })).toThrow(/exactly 9/);
        expect(() => world.insert({
            ...base,
            shape: {
                type: "triangleMesh",
                vertices: [
                    [0, 0, 0],
                    [1, 0, 0],
                    [0, 0, 1],
                ],
                indices: [[0, 1, 4]],
            },
        })).toThrow(/existing vertices/);
        expect(() => world.insert({ ...base, shape: { type: "plane", normal: [0, 0, 0] } })).toThrow(/cannot be zero/);
    });
    it("rejects empty compounds and malformed child transforms before WASM", () => {
        const world = new PhysicsWorld3dBridge(fake());
        const base = {
            id: 1,
            bodyType: "static",
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        expect(() => world.insert({ ...base, shape: { type: "compound", children: [] } })).toThrow(/at least one child/);
        expect(() => world.insert({
            ...base,
            shape: {
                type: "compound",
                children: [
                    {
                        position: [0, Number.NaN, 0],
                        rotation: [0, 0, 0, 1],
                        shape: { type: "sphere", radius: 1 },
                    },
                ],
            },
        })).toThrow(/3 finite numbers/);
    });
    it("reports invalid values before calling Rust", () => {
        const world = new PhysicsWorld3dBridge(fake());
        expect(() => world.insert({
            id: 0,
            bodyType: "dynamic",
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            shape: { type: "sphere", radius: 1 },
        })).toThrow("positive safe integer");
        expect(() => world.raycast([0, 0, 0], [0, Number.NaN, 0], 1)).toThrow("3 finite numbers");
    });
    it("loads and initializes the shared WASM module", async () => {
        const instance = fake();
        const initialize = vi.fn(async () => undefined);
        const world = await createPhysicsWorld3d({
            gravity: [0, -1, 0],
            moduleUrl: "/runtime.js",
            loadModule: async () => ({
                default: initialize,
                PhysicsEngine3d: class {
                    constructor(x, y, z) {
                        expect([x, y, z]).toEqual([0, -1, 0]);
                        return instance;
                    }
                },
            }),
        });
        expect(initialize).toHaveBeenCalled();
        world.destroy();
        expect(instance.free).toHaveBeenCalled();
    });
    it("batches materials, combine rules, and explicit mass properties", () => {
        const wasm = fake(), world = new PhysicsWorld3dBridge(wasm);
        world.defineMaterial({ name: "ice", friction: 0.02, restitution: 0.1, frictionCombine: "min" });
        world.insert({
            id: 1,
            bodyType: "dynamic",
            position: [0, 2, 0],
            rotation: [0, 0, 0, 1],
            shape: { type: "box", halfExtents: [0.5, 0.5, 0.5] },
            material: "ice",
            massProperties: { mass: 4, centerOfMass: [0.2, -0.3, 0] },
        });
        world.insert({
            id: 2,
            bodyType: "dynamic",
            position: [0, 2, 0],
            rotation: [0, 0, 0, 1],
            shape: { type: "sphere", radius: 0.5 },
            restitutionCombine: "max",
        });
        world.setMaterial(2, "ice");
        world.flush();
        expect(wasm.batches[0]).toEqual([
            { type: "defineMaterial", material: { name: "ice", friction: 0.02, restitution: 0.1, frictionCombine: "min", restitutionCombine: "average" } },
            expect.objectContaining({ type: "insert", descriptor: expect.objectContaining({ id: 1, material: "ice", frictionCombine: "average", massProperties: { mass: 4, centerOfMass: [0.2, -0.3, 0] } }) }),
            expect.objectContaining({ type: "insert", descriptor: expect.objectContaining({ id: 2, material: null, restitutionCombine: "max", massProperties: null }) }),
            { type: "setMaterial", id: 2, name: "ice" },
        ]);
        expect(() => world.defineMaterial({ name: " ", friction: 0, restitution: 0 })).toThrow("cannot be empty");
        expect(() => world.defineMaterial({ name: "mud", friction: -1, restitution: 0 })).toThrow("non-negative");
        expect(() => world.setMaterial(1, "")).toThrow("cannot be empty");
        expect(() => world.insert({ id: 3, bodyType: "dynamic", position: [0, 0, 0], rotation: [0, 0, 0, 1], shape: { type: "sphere", radius: 1 }, massProperties: { mass: 0, centerOfMass: [0, 0, 0] } })).toThrow("mass must be finite and positive");
        expect(() => world.insert({ id: 3, bodyType: "dynamic", position: [0, 0, 0], rotation: [0, 0, 0, 1], shape: { type: "sphere", radius: 1 }, massProperties: { mass: 1, centerOfMass: [0, 0, 0], principalInertia: [1, -1, 1] } })).toThrow("non-negative");
    });
    it("reads stats from the step and contacts from the optional query", () => {
        const wasm = fake();
        const stats = { bodies: 2, dynamic: 1, kinematic: 0, fixed: 1, awake: 1, sleeping: 1, joints: 0, materials: 1, contactPairs: 1, manifolds: 1, contactPoints: 4 };
        wasm.step_json = vi.fn(() => JSON.stringify({ bodies: [], events: [], stats }));
        const world = new PhysicsWorld3dBridge(wasm);
        expect(world.step(1 / 60).stats).toEqual(stats);
        expect(world.contacts()).toEqual([]);
        wasm.contacts_json = () => JSON.stringify([{ bodyA: 1, bodyB: 2, point: [0, 0, 0], normal: [0, 1, 0], distance: -0.001 }]);
        expect(world.contacts()).toHaveLength(1);
    });
});
//# sourceMappingURL=physics-3d.test.js.map