import { describe, expect, it, vi } from "vitest";
import { createComponentData, ComponentSchemaRegistry, builtinComponentSchemas } from "../core/component-schema.js";
import { PhysicsWorld2dBridge } from "./physics-2d.js";
import { PhysicsWorld3dBridge } from "./physics-3d.js";
import { SceneDocument } from "../core/scene-document.js";
import { ScenePhysicsRuntime } from "./scene-physics.js";
function component(typeName, changes = {}) {
    const schema = new ComponentSchemaRegistry(builtinComponentSchemas()).require(typeName);
    return { typeName, version: 1, data: { ...createComponentData(schema), ...changes } };
}
function fake2d() {
    const commands = [];
    let ids = [];
    const wasm = {
        apply_commands: vi.fn((json) => { const batch = JSON.parse(json); commands.push(...batch); for (const item of batch) {
            if (item.type === "insert")
                ids.push(item.descriptor.id);
            if (item.type === "remove")
                ids = ids.filter((id) => id !== item.id);
        } return batch.length; }),
        step_json: vi.fn(() => JSON.stringify({ bodies: ids.map((id) => ({ id, position: [3, 4], rotation: Math.PI / 2, linearVelocity: [0, 0], angularVelocity: 0, sleeping: false })), events: ids.length === 2 ? [{ kind: "collisionEnter", bodyA: ids[0], bodyB: ids[1] }] : [] })),
        raycast_json: () => "null", overlap_shape_json: () => "[]", cast_shape_json: () => "null", move_character_json: () => JSON.stringify({ translation: [1, 0], grounded: true, slidingDownSlope: false, collisions: ids.slice(0, 1) }), body_count: () => ids.length, free: () => undefined,
    };
    return { bridge: new PhysicsWorld2dBridge(wasm), commands };
}
function fake3d(commands = []) {
    const wasm = { apply_commands: (json) => { const batch = JSON.parse(json); commands.push(...batch); return batch.length; }, step_json: () => JSON.stringify({ bodies: [], events: [] }), raycast_json: () => "null", overlap_shape_json: () => "[]", cast_shape_json: () => "null", move_character_json: () => JSON.stringify({ translation: [0, 0, 0], grounded: false, slidingDownSlope: false, collisions: [] }), body_count: () => 0, joint_count: () => 0, free: () => undefined };
    return new PhysicsWorld3dBridge(wasm);
}
describe("ScenePhysicsRuntime", () => {
    it.each(["2D", "3D"])("preserves moving %s kinematic bodies and sends their new targets", (dimension) => {
        const scene = new SceneDocument(SceneDocument.empty("Moving platform"));
        const entity = scene.addEntity("Platform");
        scene.addComponent(entity.id, component(`vapour.Rigidbody${dimension}`, { bodyType: "kinematicPosition" }));
        scene.addComponent(entity.id, component(`vapour.Collider${dimension}`));
        const native2d = fake2d(), native3dCommands = [];
        const runtime = new ScenePhysicsRuntime(scene, { physics2d: native2d.bridge, physics3d: fake3d(native3dCommands) });
        const commands = dimension === "2D" ? native2d.commands : native3dCommands;
        runtime.fixedUpdate(1 / 60);
        scene.setTransform(entity.id, { position: [3, 2, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
        runtime.prepare();
        runtime.fixedUpdate(1 / 60);
        expect(commands.filter((value) => value.type === "insert")).toHaveLength(1);
        expect(commands.filter((value) => value.type === "remove")).toHaveLength(0);
        expect(commands.filter((value) => value.type === "setKinematicTarget").at(-1)?.position).toEqual(dimension === "2D" ? [3, 2] : [3, 2, 1]);
    });
    it("creates native bodies, syncs dynamic poses, and does not recreate them each step", () => {
        const scene = new SceneDocument(SceneDocument.empty("Physics")), entity = scene.addEntity("Ball");
        scene.addComponent(entity.id, component("vapour.Rigidbody2D"));
        scene.addComponent(entity.id, component("vapour.Collider2D", { shape: "circle", radius: 0.5 }));
        const native = fake2d(), runtime = new ScenePhysicsRuntime(scene, { physics2d: native.bridge });
        runtime.fixedUpdate(1 / 60);
        runtime.fixedUpdate(1 / 60);
        expect(native.commands.filter((value) => value.type === "insert")).toHaveLength(1);
        expect(scene.entity(entity.id).components[0].data.position).toEqual([3, 4, 0]);
        expect(runtime.bodyCount).toBe(1);
    });
    it("routes stable scene IDs in contact events and removes disabled bodies", () => {
        const scene = new SceneDocument(SceneDocument.empty("Contacts"));
        const first = scene.addEntity("First"), second = scene.addEntity("Second");
        for (const entity of [first, second]) {
            scene.addComponent(entity.id, component("vapour.Rigidbody2D"));
            scene.addComponent(entity.id, component("vapour.Collider2D"));
        }
        const native = fake2d(), contact = vi.fn(), runtime = new ScenePhysicsRuntime(scene, { physics2d: native.bridge, onContact: contact });
        runtime.fixedUpdate(1 / 60);
        expect(contact).toHaveBeenCalledWith({ dimension: "2d", kind: "collisionEnter", entityA: first.id, entityB: second.id });
        scene.updateEntity(first.id, { enabled: false });
        runtime.fixedUpdate(1 / 60);
        expect(native.commands.some((value) => value.type === "remove")).toBe(true);
    });
    it("rejects mixed-dimensional entities with an actionable error", () => {
        const scene = new SceneDocument(SceneDocument.empty("Invalid")), entity = scene.addEntity("Confused");
        scene.addComponent(entity.id, component("vapour.Collider2D"));
        scene.addComponent(entity.id, component("vapour.Collider3D"));
        const runtime = new ScenePhysicsRuntime(scene, { physics2d: fake2d().bridge, physics3d: fake3d() });
        expect(() => runtime.fixedUpdate(1 / 60)).toThrow("cannot have both 2D and 3D colliders");
    });
    it("serializes materials, combine rules, and mass overrides from component data", () => {
        const scene = new SceneDocument(SceneDocument.empty("Materials"));
        const crate = scene.addEntity("Crate"), plain = scene.addEntity("Plain");
        scene.addComponent(crate.id, component("vapour.Rigidbody3D", { mass: 4, centerOfMass: [0.2, -0.3, 0] }));
        scene.addComponent(crate.id, component("vapour.Collider3D", { material: "ice", frictionCombine: "min", restitutionCombine: "bogus" }));
        scene.addComponent(plain.id, component("vapour.Collider3D"));
        const commands = [], runtime = new ScenePhysicsRuntime(scene, { physics3d: fake3d(commands) });
        runtime.defineMaterial({ name: "ice", friction: 0.02, restitution: 0 });
        runtime.prepare();
        expect(commands[0]).toMatchObject({ type: "defineMaterial", material: { name: "ice" } });
        const inserted = commands.filter((value) => value.type === "insert").map((value) => value.descriptor);
        expect(inserted.find((value) => value.massProperties !== null)).toMatchObject({ material: "ice", frictionCombine: "min", restitutionCombine: "average", massProperties: { mass: 4, centerOfMass: [0.2, -0.3, 0] } });
        expect(inserted.find((value) => value.massProperties === null)).toMatchObject({ material: null, frictionCombine: "average" });
    });
    it("moves scene characters through Rust and translates collision IDs", () => {
        const scene = new SceneDocument(SceneDocument.empty("Controller"));
        const ground = scene.addEntity("Ground"), player = scene.addEntity("Player");
        scene.addComponent(ground.id, component("vapour.Collider2D"));
        scene.addComponent(player.id, component("vapour.CharacterController2D"));
        const native = fake2d(), runtime = new ScenePhysicsRuntime(scene, { physics2d: native.bridge });
        const movement = runtime.moveCharacter2d(player.id, [2, 0], 1 / 60);
        expect(movement).toMatchObject({ translation: [1, 0], grounded: true, collisions: [ground.id] });
        expect(scene.entity(player.id).components[0].data.position).toEqual([1, 0, 0]);
    });
});
//# sourceMappingURL=scene-physics.test.js.map