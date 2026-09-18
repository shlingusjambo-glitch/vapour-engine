import { describe, expect, it, vi } from "vitest";
import { createPhysicsWorld2d, PhysicsWorld2dBridge } from "./physics-2d.js";
function fake() {
    const batches = [];
    return { batches, apply_commands: vi.fn((json) => { const batch = JSON.parse(json); batches.push(batch); return batch.length; }), step_json: vi.fn(() => JSON.stringify({ bodies: [], events: [] })), raycast_json: vi.fn(() => JSON.stringify({ bodyId: 7, distance: 2, point: [0, 1], normal: [0, 1] })), overlap_shape_json: vi.fn(() => "[7,9]"), cast_shape_json: vi.fn(() => JSON.stringify({ bodyId: 7, distance: 1.5, position: [0, 1.5], normal: [0, 1] })), move_character_json: vi.fn(() => JSON.stringify({ translation: [1, 0], grounded: true, slidingDownSlope: false, collisions: [7] })), body_count: () => 0, free: vi.fn() };
}
describe("PhysicsWorld2dBridge", () => {
    it("batches language-neutral commands into one WASM crossing", () => {
        const wasm = fake(), world = new PhysicsWorld2dBridge(wasm);
        world.insert({ id: 1, bodyType: "dynamic", position: [0, 2], shape: { type: "circle", radius: 0.5 } });
        world.applyImpulse(1, [2, 0]);
        expect(world.pendingCommands).toBe(2);
        expect(world.step(1 / 60)).toEqual({ bodies: [], events: [] });
        expect(wasm.batches[0]).toMatchObject([{ type: "insert", descriptor: { id: 1, rotation: 0, friction: 0.5, layer: 1 } }, { type: "applyImpulse", id: 1, impulse: [2, 0] }]);
    });
    it("batches forces at points, torque, and angular velocity", () => { const wasm = fake(), world = new PhysicsWorld2dBridge(wasm); world.addForceAtPoint(1, [10, 0], [0, 1]); world.addTorque(1, 2); world.applyTorqueImpulse(1, 3); world.setAngularVelocity(1, 4); world.flush(); expect(wasm.batches[0]).toEqual([{ type: "addForceAtPoint", id: 1, force: [10, 0], point: [0, 1] }, { type: "addTorque", id: 1, torque: 2 }, { type: "applyTorqueImpulse", id: 1, torque: 3 }, { type: "setAngularVelocity", id: 1, velocity: 4 }]); });
    it("supports convex polygons and typed ray queries", () => {
        const wasm = fake(), world = new PhysicsWorld2dBridge(wasm);
        world.insert({ id: 2, bodyType: "static", position: [0, 0], shape: { type: "convexPolygon", points: [[-1, -1], [1, -1], [0, 1]] } });
        expect(world.raycast([0, 3], [0, -1], 10)).toMatchObject({ bodyId: 7, distance: 2 });
        expect(wasm.raycast_json).toHaveBeenCalledWith(expect.any(Float32Array), expect.any(Float32Array), 10, 1, 0xffff_ffff, false);
    });
    it("exposes exact overlap and swept-shape queries", () => { const world = new PhysicsWorld2dBridge(fake()); expect(world.overlapShape([0, 0], 0, { type: "circle", radius: 1 })).toEqual([7, 9]); expect(world.castShape([0, 3], 0, [0, -1], 10, { type: "circle", radius: 0.5 })).toMatchObject({ bodyId: 7, distance: 1.5 }); });
    it("runs the native slope and stair character controller", () => { const world = new PhysicsWorld2dBridge(fake()); expect(world.moveCharacter(1 / 60, [0, 1], 0, [1, -0.1], { shape: { type: "capsule", halfHeight: 0.5, radius: 0.3 } })).toEqual({ translation: [1, 0], grounded: true, slidingDownSlope: false, collisions: [7] }); });
    it("rejects malformed values before Rust", () => {
        const world = new PhysicsWorld2dBridge(fake());
        expect(() => world.insert({ id: 0, bodyType: "dynamic", position: [0, 0], shape: { type: "circle", radius: 1 } })).toThrow("positive safe integer");
        expect(() => world.insert({ id: 1, bodyType: "static", position: [0, 0], shape: { type: "convexPolygon", points: [[0, 0], [1, 0]] } })).toThrow("at least three");
        expect(() => world.raycast([0, 0], [Number.NaN, 0], 1)).toThrow("2 finite numbers");
    });
    it("batches materials and combine rules", () => {
        const wasm = fake(), world = new PhysicsWorld2dBridge(wasm);
        world.defineMaterial({ name: "ice", friction: 0.02, restitution: 0, frictionCombine: "min" });
        world.insert({ id: 1, bodyType: "dynamic", position: [0, 2], shape: { type: "circle", radius: 0.5 }, material: "ice", restitutionCombine: "max" });
        world.setMaterial(1, "ice");
        world.flush();
        expect(wasm.batches[0]).toEqual([
            { type: "defineMaterial", material: { name: "ice", friction: 0.02, restitution: 0, frictionCombine: "min", restitutionCombine: "average" } },
            expect.objectContaining({ type: "insert", descriptor: expect.objectContaining({ material: "ice", frictionCombine: "average", restitutionCombine: "max" }) }),
            { type: "setMaterial", id: 1, name: "ice" },
        ]);
        expect(() => world.setMaterial(1, " ")).toThrow("cannot be empty");
    });
    it("loads the shared WASM module", async () => {
        const instance = fake(), initialize = vi.fn(async () => undefined);
        const world = await createPhysicsWorld2d({ gravity: [0, -1], moduleUrl: "/runtime.js", loadModule: async () => ({ default: initialize, PhysicsEngine2d: class {
                    constructor(x, y) { expect([x, y]).toEqual([0, -1]); return instance; }
                } }) });
        expect(initialize).toHaveBeenCalled();
        world.destroy();
        expect(instance.free).toHaveBeenCalled();
    });
});
//# sourceMappingURL=physics-2d.test.js.map