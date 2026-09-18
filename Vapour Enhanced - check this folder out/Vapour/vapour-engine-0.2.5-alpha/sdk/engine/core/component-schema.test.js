import { describe, expect, it } from "vitest";
import { ComponentSchemaRegistry, builtinComponentSchemas, createComponentData, createComponentRecord, normalizeComponentData, setComponentField, } from "./component-schema.js";
import { extractRenderWorld } from "../render/render-world.js";
import { SceneDocument, defaultTransform } from "./scene-document.js";
const registry = new ComponentSchemaRegistry(builtinComponentSchemas());
describe("component schemas", () => {
    it("creates records the scene document accepts", () => {
        const scene = new SceneDocument(SceneDocument.empty("Main"));
        const entity = scene.addEntity("Cube");
        for (const schema of registry.list()) {
            const other = scene.addEntity(schema.label);
            expect(() => scene.addComponent(other.id, createComponentRecord(schema))).not.toThrow();
        }
        scene.addComponent(entity.id, createComponentRecord(registry.require("vapour.MeshRenderer")));
        expect(() => new SceneDocument(JSON.parse(scene.serialize()))).not.toThrow();
    });
    it("produces defaults the renderer extraction consumes", () => {
        const scene = new SceneDocument(SceneDocument.empty("Main"));
        const cube = scene.addEntity("Cube");
        const camera = scene.addEntity("Camera");
        const light = scene.addEntity("Sun");
        scene.addComponent(cube.id, createComponentRecord(registry.require("vapour.MeshRenderer")));
        scene.addComponent(camera.id, createComponentRecord(registry.require("vapour.Camera")));
        scene.addComponent(light.id, createComponentRecord(registry.require("vapour.DirectionalLight")));
        const world = extractRenderWorld(scene.data);
        expect(world.instances).toHaveLength(1);
        expect(world.camera?.entityId).toBe(camera.id);
        expect(world.directionalLight?.entityId).toBe(light.id);
    });
    it("fills missing fields but rejects wrongly shaped ones", () => {
        const schema = registry.require("vapour.Camera");
        expect(normalizeComponentData(schema, {})).toEqual(createComponentData(schema));
        expect(normalizeComponentData(schema, { fieldOfView: 90 }).fieldOfView).toBe(90);
        expect(() => normalizeComponentData(schema, { fieldOfView: "wide" })).toThrow(/finite number/);
        expect(() => normalizeComponentData(schema, [])).toThrow(/must be an object/);
    });
    it("clamps edited fields to their declared range", () => {
        const schema = registry.require("vapour.Camera");
        const data = createComponentData(schema);
        expect(setComponentField(schema, data, "fieldOfView", 400).fieldOfView).toBe(179);
        expect(setComponentField(schema, data, "fieldOfView", -10).fieldOfView).toBe(1);
        expect(() => setComponentField(schema, data, "nope", 1)).toThrow(/has no field/);
    });
    it("preserves unknown keys so plugin data survives a round trip", () => {
        const schema = registry.require("vapour.DirectionalLight");
        const normalized = normalizeComponentData(schema, { intensity: 2, "studio.shadowBias": 0.01 });
        expect(normalized["studio.shadowBias"]).toBe(0.01);
    });
    it("rejects enum values outside the declared options", () => {
        const schema = registry.require("vapour.MeshRenderer");
        expect(() => setComponentField(schema, createComponentData(schema), "mesh", "builtin:teapot")).toThrow(/must be one of/);
    });
    it("validates stable text asset IDs and 2D vectors for plugin schemas", () => {
        const schema = { typeName: "test.TwoD", label: "2D", icon: "2", version: 1, summary: "", removable: true, fields: [{ kind: "text", key: "asset", label: "Asset", default: "asset:a" }, { kind: "vector2", key: "size", label: "Size", default: [1, 1] }] };
        expect(setComponentField(schema, createComponentData(schema), "asset", "asset:b").asset).toBe("asset:b");
        expect(setComponentField(schema, createComponentData(schema), "size", [2, 3]).size).toEqual([2, 3]);
        expect(() => setComponentField(schema, createComponentData(schema), "size", [2])).toThrow(/2 numbers/);
    });
    it("keeps registry keys unique and searchable", () => {
        const custom = {
            typeName: "studio.Spinner",
            label: "Spinner",
            icon: "◎",
            version: 1,
            summary: "Test schema.",
            removable: true,
            fields: [{ kind: "number", key: "speed", label: "Speed", default: 1 }],
        };
        const local = new ComponentSchemaRegistry(builtinComponentSchemas());
        local.register(custom);
        expect(() => local.register(custom)).toThrow(/already registered/);
        expect(local.list("spin").map((schema) => schema.typeName)).toEqual(["studio.Spinner"]);
        expect(local.list().length).toBe(builtinComponentSchemas().length + 1);
    });
    it("rejects schemas with duplicate field keys", () => {
        expect(() => new ComponentSchemaRegistry([
            {
                typeName: "studio.Broken",
                label: "Broken",
                icon: "x",
                version: 1,
                summary: "",
                removable: true,
                fields: [
                    { kind: "number", key: "speed", label: "A", default: 1 },
                    { kind: "number", key: "speed", label: "B", default: 2 },
                ],
            },
        ])).toThrow(/duplicate field keys/);
    });
    it("gives every mesh renderer default a drawable instance colour", () => {
        const scene = new SceneDocument(SceneDocument.empty("Main"));
        const entity = scene.addEntity("Cube");
        scene.setTransform(entity.id, { ...defaultTransform(), position: [1, 2, 3] });
        scene.addComponent(entity.id, createComponentRecord(registry.require("vapour.MeshRenderer")));
        const instance = extractRenderWorld(scene.data).instances[0];
        expect(instance.baseColor.every((channel) => Number.isFinite(channel))).toBe(true);
        expect([instance.modelMatrix[12], instance.modelMatrix[13], instance.modelMatrix[14]]).toEqual([1, 2, 3]);
    });
});
//# sourceMappingURL=component-schema.test.js.map