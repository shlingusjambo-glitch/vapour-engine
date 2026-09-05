import { describe, expect, it } from "vitest";
import { SceneDocument, defaultTransform } from "./scene-document.js";

describe("SceneDocument", () => {
  it("creates source-control-stable serialization", () => {
    const scene = new SceneDocument();
    const b = scene.addEntity("B");
    const a = scene.addEntity("A");
    const json = JSON.parse(scene.serialize()) as { entities: { id: string }[] };
    expect(json.entities.map((entity) => entity.id)).toEqual([a.id, b.id].sort());
  });

  it("rejects hierarchy cycles", () => {
    const scene = new SceneDocument();
    const parent = scene.addEntity("Parent");
    const child = scene.addEntity("Child", parent.id);
    expect(() => scene.setParent(parent.id, child.id)).toThrow("cycle");
  });

  it("updates a real transform component", () => {
    const scene = new SceneDocument();
    const entity = scene.addEntity();
    const transform = defaultTransform();
    transform.position = [1, 2, 3];
    scene.setTransform(entity.id, transform);
    expect((scene.entity(entity.id)?.components[0]?.data as { position: number[] }).position).toEqual([1, 2, 3]);
  });

  it("adds, updates, and removes custom components with change events", () => {
    const scene = new SceneDocument();
    const entity = scene.addEntity();
    let changes = 0;
    scene.addEventListener("change", () => { changes += 1; });
    scene.addComponent(entity.id, { typeName: "game.Health", version: 1, data: { maximum: 100 } });
    scene.updateComponentData(entity.id, "game.Health", { maximum: 125 });
    expect(entity.components.find((value) => value.typeName === "game.Health")?.data).toEqual({ maximum: 125 });
    scene.removeComponent(entity.id, "game.Health");
    expect(changes).toBe(3);
    expect(() => scene.removeComponent(entity.id, "vapour.Transform")).toThrow("cannot be removed");
  });

  it("rejects duplicate and invalid component records", () => {
    const scene = new SceneDocument();
    const entity = scene.addEntity();
    expect(() => scene.addComponent(entity.id, { typeName: "vapour.Transform", version: 1, data: {} })).toThrow("already has");
    expect(() => scene.addComponent(entity.id, { typeName: "", version: 0, data: {} })).toThrow("empty typeName");
  });
});
