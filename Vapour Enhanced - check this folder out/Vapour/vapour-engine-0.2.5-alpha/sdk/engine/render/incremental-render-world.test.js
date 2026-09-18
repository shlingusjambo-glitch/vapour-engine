import { describe, expect, it } from "vitest";
import { SceneDocument, } from "../core/scene-document.js";
import { extractRenderWorld } from "./render-world.js";
import { IncrementalRenderWorld } from "./incremental-render-world.js";
function transform(position = [0, 0, 0], scale = [1, 1, 1]) {
    return {
        typeName: "vapour.Transform",
        version: 1,
        data: {
            position: [...position],
            rotation: [0, 0, 0, 1],
            scale: [...scale],
        },
    };
}
function entity(id, options = {}) {
    return {
        id,
        name: id,
        ...(options.parent === undefined ? {} : { parent: options.parent }),
        enabled: options.enabled ?? true,
        components: options.components ?? [
            transform(),
            {
                typeName: "vapour.MeshRenderer",
                version: 1,
                data: {
                    mesh: options.mesh ?? "builtin:cube",
                    material: "mat",
                    baseColor: [1, 1, 1, 1],
                },
            },
        ],
    };
}
function scene(entities) {
    return { formatVersion: 1, id: "s", name: "s", entities };
}
/** The incremental path is only useful if it is indistinguishable from the full
 * one, so every behavioural test compares the two directly. */
function expectMatchesFull(incremental, data) {
    expect(incremental.extract(data)).toEqual(extractRenderWorld(data));
}
describe("IncrementalRenderWorld", () => {
    it("matches the full extractor on the first frame", () => {
        const data = scene([entity("a"), entity("b", { parent: "a" })]);
        const incremental = new IncrementalRenderWorld();
        expectMatchesFull(incremental, data);
        expect(incremental.stats).toMatchObject({
            entities: 2,
            recomputed: 2,
            reused: 0,
            fullRebuild: true,
        });
    });
    it("recomputes nothing when the scene is unchanged", () => {
        const data = scene([entity("a"), entity("b"), entity("c")]);
        const incremental = new IncrementalRenderWorld();
        incremental.extract(data);
        expectMatchesFull(incremental, data);
        expect(incremental.stats).toMatchObject({
            recomputed: 0,
            reused: 3,
            fullRebuild: false,
        });
    });
    it("detects an in-place transform edit, which reference equality would miss", () => {
        const moving = entity("a");
        const data = scene([moving]);
        const incremental = new IncrementalRenderWorld();
        incremental.extract(data);
        // SceneDocument mutates component data in place; the entity object is the
        // same reference afterwards.
        moving.components[0].data.position = [5, 0, 0];
        expectMatchesFull(incremental, data);
        expect(incremental.stats.recomputed).toBe(1);
    });
    it("detects a material edit and a mesh swap", () => {
        const item = entity("a");
        const data = scene([item]);
        const incremental = new IncrementalRenderWorld();
        incremental.extract(data);
        item.components[1].data.baseColor = [
            1, 0, 0, 1,
        ];
        expectMatchesFull(incremental, data);
        expect(incremental.stats.recomputed).toBe(1);
        item.components[1].data.mesh = "builtin:sphere";
        expectMatchesFull(incremental, data);
    });
    it("dirties descendants when a parent moves", () => {
        const parent = entity("a");
        const data = scene([
            parent,
            entity("b", { parent: "a" }),
            entity("c", { parent: "b" }),
            entity("d"),
        ]);
        const incremental = new IncrementalRenderWorld();
        incremental.extract(data);
        parent.components[0].data.position = [0, 3, 0];
        expectMatchesFull(incremental, data);
        // a, b and c, but not the unrelated d.
        expect(incremental.stats.recomputed).toBe(3);
    });
    it("tracks enabling and disabling, including inherited deactivation", () => {
        const parent = entity("a");
        const data = scene([parent, entity("b", { parent: "a" })]);
        const incremental = new IncrementalRenderWorld();
        incremental.extract(data);
        parent.enabled = false;
        expectMatchesFull(incremental, data);
        expect(incremental.extract(data).instances).toEqual([]);
        parent.enabled = true;
        expectMatchesFull(incremental, data);
        expect(incremental.extract(data).instances).toHaveLength(2);
    });
    it("rebuilds fully when entities are added or removed", () => {
        const entities = [entity("a")];
        const data = scene(entities);
        const incremental = new IncrementalRenderWorld();
        incremental.extract(data);
        entities.push(entity("b"));
        expectMatchesFull(incremental, data);
        expect(incremental.stats.fullRebuild).toBe(true);
        entities.splice(0, 1);
        expectMatchesFull(incremental, data);
        expect(incremental.stats.fullRebuild).toBe(true);
    });
    it("rebuilds fully when an entity id is swapped for another, keeping the count", () => {
        const entities = [entity("a"), entity("b")];
        const data = scene(entities);
        const incremental = new IncrementalRenderWorld();
        incremental.extract(data);
        entities[1] = entity("c");
        expectMatchesFull(incremental, data);
        expect(incremental.stats.fullRebuild).toBe(true);
    });
    it("follows a reparent", () => {
        const child = entity("b");
        const data = scene([
            entity("a", { components: [transform([10, 0, 0])] }),
            child,
        ]);
        const incremental = new IncrementalRenderWorld();
        incremental.extract(data);
        child.parent = "a";
        expectMatchesFull(incremental, data);
    });
    it("reuses camera and light snapshots and updates them when they move", () => {
        const camera = entity("cam", {
            components: [
                transform([0, 2, 8]),
                { typeName: "vapour.Camera", version: 1, data: { fieldOfView: 70 } },
            ],
        });
        const light = entity("sun", {
            components: [
                transform(),
                {
                    typeName: "vapour.DirectionalLight",
                    version: 1,
                    data: { intensity: 3 },
                },
            ],
        });
        const data = scene([camera, light, entity("a")]);
        const incremental = new IncrementalRenderWorld();
        expectMatchesFull(incremental, data);
        expectMatchesFull(incremental, data);
        expect(incremental.stats.recomputed).toBe(0);
        camera.components[1].data.fieldOfView = 50;
        expectMatchesFull(incremental, data);
        expect(incremental.extract(data).camera?.fieldOfView).toBe(50);
    });
    it("keeps sprite instances and their sorting offsets identical to the full path", () => {
        const sprite = entity("s", {
            components: [
                transform([1, 2, 3]),
                {
                    typeName: "vapour.SpriteRenderer",
                    version: 1,
                    data: {
                        material: "atlas",
                        sortingLayer: 2,
                        order: 5,
                        color: [1, 1, 1, 1],
                    },
                },
            ],
        });
        const data = scene([sprite]);
        const incremental = new IncrementalRenderWorld();
        expectMatchesFull(incremental, data);
        sprite.components[1].data.order = 9;
        expectMatchesFull(incremental, data);
    });
    it("invalidate() forces a full rebuild", () => {
        const data = scene([entity("a")]);
        const incremental = new IncrementalRenderWorld();
        incremental.extract(data);
        incremental.invalidate();
        incremental.extract(data);
        expect(incremental.stats).toMatchObject({
            recomputed: 1,
            fullRebuild: true,
        });
    });
    it("propagates the same validation errors as the full extractor", () => {
        const incremental = new IncrementalRenderWorld();
        const bad = scene([
            entity("a", {
                components: [
                    transform(),
                    {
                        typeName: "vapour.MeshRenderer",
                        version: 1,
                        data: { mesh: "nope" },
                    },
                ],
            }),
        ]);
        expect(() => incremental.extract(bad)).toThrow(/unknown mesh 'nope'/);
        expect(() => extractRenderWorld(bad)).toThrow(/unknown mesh 'nope'/);
    });
    it("stays consistent with the full extractor across a long edit sequence", () => {
        const document = new SceneDocument(SceneDocument.empty("Level"));
        const incremental = new IncrementalRenderWorld();
        const root = document.addEntity("Root");
        document.addComponent(root.id, {
            typeName: "vapour.MeshRenderer",
            version: 1,
            data: { mesh: "builtin:cube", material: "m" },
        });
        expectMatchesFull(incremental, document.data);
        for (let step = 0; step < 5; step += 1) {
            const child = document.addEntity(`Child${step}`, root.id);
            document.addComponent(child.id, {
                typeName: "vapour.MeshRenderer",
                version: 1,
                data: { mesh: "builtin:sphere", material: "m" },
            });
            document.setTransform(child.id, {
                position: [step, 0, 0],
                rotation: [0, 0, 0, 1],
                scale: [1, 1, 1],
            });
            expectMatchesFull(incremental, document.data);
        }
        document.setTransform(root.id, {
            position: [0, 5, 0],
            rotation: [0, 0.3826834, 0, 0.9238795],
            scale: [2, 2, 2],
        });
        expectMatchesFull(incremental, document.data);
        document.updateEntity(root.id, { enabled: false });
        expectMatchesFull(incremental, document.data);
    });
    it("recomputes far less than it examines for a mostly-static scene", () => {
        const entities = Array.from({ length: 500 }, (_, index) => entity(`e${index}`));
        const data = scene(entities);
        const incremental = new IncrementalRenderWorld();
        incremental.extract(data);
        entities[3].components[0].data.position = [
            1, 1, 1,
        ];
        incremental.extract(data);
        expect(incremental.stats).toMatchObject({
            entities: 500,
            recomputed: 1,
            reused: 499,
        });
    });
});
describe("IncrementalRenderWorld observing a document", () => {
    it("recomputes only what the document reported changed", () => {
        const document = new SceneDocument(SceneDocument.empty("Level"));
        const ids = Array.from({ length: 5 }, (_, index) => {
            const created = document.addEntity(`E${index}`);
            document.addComponent(created.id, {
                typeName: "vapour.MeshRenderer",
                version: 1,
                data: { mesh: "builtin:cube", material: "m" },
            });
            return created.id;
        });
        const incremental = new IncrementalRenderWorld();
        const stop = incremental.observe(document);
        incremental.extract(document.data);
        document.setTransform(ids[2], {
            position: [1, 2, 3],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
        });
        expectMatchesFull(incremental, document.data);
        expect(incremental.stats).toMatchObject({
            recomputed: 1,
            observed: true,
            fullRebuild: false,
        });
        // An untouched frame recomputes nothing at all.
        incremental.extract(document.data);
        expect(incremental.stats).toMatchObject({ recomputed: 0, observed: true });
        stop();
    });
    it("treats an added or removed entity as structural", () => {
        const document = new SceneDocument(SceneDocument.empty("Level"));
        const first = document.addEntity("A");
        const incremental = new IncrementalRenderWorld();
        incremental.observe(document);
        incremental.extract(document.data);
        document.addEntity("B");
        expectMatchesFull(incremental, document.data);
        expect(incremental.stats.fullRebuild).toBe(true);
        document.removeEntity(first.id);
        expectMatchesFull(incremental, document.data);
        expect(incremental.stats.fullRebuild).toBe(true);
    });
    it("falls back to comparison once unobserved", () => {
        const document = new SceneDocument(SceneDocument.empty("Level"));
        const created = document.addEntity("A");
        const incremental = new IncrementalRenderWorld();
        const stop = incremental.observe(document);
        incremental.extract(document.data);
        stop();
        document.setTransform(created.id, {
            position: [9, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
        });
        expectMatchesFull(incremental, document.data);
        expect(incremental.stats).toMatchObject({ observed: false, recomputed: 1 });
    });
    it("observing a second document replaces the first", () => {
        const first = new SceneDocument(SceneDocument.empty("A"));
        const second = new SceneDocument(SceneDocument.empty("B"));
        const created = second.addEntity("X");
        const incremental = new IncrementalRenderWorld();
        incremental.observe(first);
        incremental.observe(second);
        incremental.extract(second.data);
        second.setTransform(created.id, {
            position: [1, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
        });
        expectMatchesFull(incremental, second.data);
        expect(incremental.stats.recomputed).toBe(1);
    });
});
//# sourceMappingURL=incremental-render-world.test.js.map