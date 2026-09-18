import { describe, expect, it } from "vitest";
import { SceneDocument, type SceneEntityData, type TransformData } from "../core/scene-document.js";
import { PrefabLibrary, addInstanceToScene, validatePrefab, type PrefabData } from "./prefab.js";

function entity(id: string, name: string, parent?: string): SceneEntityData {
  return {
    id,
    name,
    ...(parent === undefined ? {} : { parent }),
    enabled: true,
    components: [
      { typeName: "vapour.Transform", version: 1, data: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      { typeName: "game.Light", version: 1, data: { intensity: 1, color: { r: 1, g: 1, b: 1 } } },
    ],
  };
}

const lamp: PrefabData = {
  formatVersion: 1,
  id: "lamp",
  name: "Streetlight",
  root: "post",
  entities: [entity("post", "Post"), entity("bulb", "Bulb", "post")],
};

/** Deterministic ids make instance output comparable, which is also what
 * networked instantiation relies on. */
const sequentialIds = () => {
  let next = 0;
  return (prefabId: string, localId: string) => `${prefabId}.${localId}.${next++}`;
};

describe("prefab validation", () => {
  it("rejects an unsupported version", () => {
    expect(() => validatePrefab({ ...lamp, formatVersion: 2 as never })).toThrow(/Unsupported prefab version 2/);
  });

  it("requires an id, a name, and at least one entity", () => {
    expect(() => validatePrefab({ ...lamp, id: " " })).toThrow(/non-empty id/);
    expect(() => validatePrefab({ ...lamp, name: " " })).toThrow(/non-empty name/);
    expect(() => validatePrefab({ ...lamp, entities: [] })).toThrow(/at least one entity/);
  });

  it("rejects a root that is not one of its entities", () => {
    expect(() => validatePrefab({ ...lamp, root: "missing" })).toThrow(/names root "missing"/);
  });

  it("rejects a duplicate local id and a dangling parent", () => {
    expect(() => validatePrefab({ ...lamp, entities: [entity("post", "A"), entity("post", "B")] })).toThrow(/more than once/);
    expect(() => validatePrefab({ ...lamp, entities: [entity("post", "Post"), entity("bulb", "Bulb", "ghost")] })).toThrow(/which it does not define/);
  });

  it("rejects a nested prefab attached to an unknown entity", () => {
    expect(() =>
      validatePrefab({ ...lamp, children: [{ id: "sign", prefabId: "sign", parent: "ghost" }] }),
    ).toThrow(/unknown entity "ghost"/);
  });
});

describe("PrefabLibrary", () => {
  it("registers and looks up prefabs", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    expect(library.has("lamp")).toBe(true);
    expect(library.ids).toEqual(["lamp"]);
    expect(() => library.register(lamp)).toThrow(/already registered/);
    expect(() => library.require("bench")).toThrow(/not registered.*Registered prefabs: lamp/s);
  });

  it("instantiates with fresh ids and preserves the internal hierarchy", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const instance = library.instantiate("lamp", { idFactory: sequentialIds() });
    expect(instance.entities.map((e) => e.id)).toEqual(["lamp.post.0", "lamp.bulb.1"]);
    expect(instance.rootId).toBe("lamp.post.0");
    // The bulb still hangs off the post, remapped to the new ids.
    expect(instance.entities[1]!.parent).toBe("lamp.post.0");
    // The root has no parent unless one was requested.
    expect(instance.entities[0]!.parent).toBeUndefined();
  });

  it("produces independent entities on each instantiation", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const first = library.instantiate("lamp", { idFactory: sequentialIds() });
    const second = library.instantiate("lamp", { idFactory: sequentialIds() });
    (first.entities[0]!.components[1]!.data as { intensity: number }).intensity = 99;
    expect((second.entities[0]!.components[1]!.data as { intensity: number }).intensity).toBe(1);
  });

  it("attaches the instance root beneath a scene parent", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const instance = library.instantiate("lamp", { parent: "street", idFactory: sequentialIds() });
    expect(instance.entities[0]!.parent).toBe("street");
  });

  it("applies a transform and a name to the instance root", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const instance = library.instantiate("lamp", { name: "Corner lamp", transform: { position: [3, 0, 4] }, idFactory: sequentialIds() });
    const root = instance.entities[0]!;
    expect(root.name).toBe("Corner lamp");
    expect((root.components[0]!.data as TransformData).position).toEqual([3, 0, 4]);
    // Untouched channels keep the prefab's authored values.
    expect((root.components[0]!.data as TransformData).scale).toEqual([1, 1, 1]);
  });

  it("applies overrides to a single component field", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const instance = library.instantiate("lamp", {
      overrides: [{ entity: "bulb", component: "game.Light", field: "intensity", value: 4 }],
      idFactory: sequentialIds(),
    });
    expect((instance.entities[1]!.components[1]!.data as { intensity: number }).intensity).toBe(4);
    // Every other instance is unaffected.
    expect((library.instantiate("lamp", { idFactory: sequentialIds() }).entities[1]!.components[1]!.data as { intensity: number }).intensity).toBe(1);
  });

  it("overrides a nested field path", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const instance = library.instantiate("lamp", {
      overrides: [{ entity: "bulb", component: "game.Light", field: "color.g", value: 0 }],
      idFactory: sequentialIds(),
    });
    expect((instance.entities[1]!.components[1]!.data as { color: { g: number } }).color.g).toBe(0);
  });

  it("reports overrides that target something that does not exist", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const bad = (field: string, entity = "bulb", component = "game.Light") =>
      () => library.instantiate("lamp", { overrides: [{ entity, component, field, value: 1 }], idFactory: sequentialIds() });
    expect(bad("intensity", "ghost")).toThrow(/does not define/);
    expect(bad("intensity", "bulb", "game.Missing")).toThrow(/does not have/);
    expect(bad("nope")).toThrow(/names "nope", which the component does not define/);
    expect(bad("intensity.deeper")).toThrow(/stops at "intensity", which is not an object/);
  });

  it("expands nested prefabs and attaches them to the named entity", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    library.register({
      formatVersion: 1,
      id: "street",
      name: "Street",
      root: "road",
      entities: [entity("road", "Road")],
      children: [{ id: "lampA", prefabId: "lamp" }, { id: "lampB", prefabId: "lamp", parent: "road" }],
    });
    const instance = library.instantiate("street", { idFactory: sequentialIds() });
    expect(instance.entities).toHaveLength(5);
    const road = instance.entities[0]!;
    const lampRoots = instance.entities.filter((e) => e.name === "Post");
    expect(lampRoots).toHaveLength(2);
    for (const post of lampRoots) expect(post.parent).toBe(road.id);
  });

  it("applies a nested prefab's overrides at the nesting site", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    library.register({
      formatVersion: 1,
      id: "street",
      name: "Street",
      root: "road",
      entities: [entity("road", "Road")],
      children: [{ id: "lampA", prefabId: "lamp", overrides: [{ entity: "bulb", component: "game.Light", field: "intensity", value: 7 }] }],
    });
    const instance = library.instantiate("street", { idFactory: sequentialIds() });
    const bulb = instance.entities.find((e) => e.name === "Bulb")!;
    expect((bulb.components[1]!.data as { intensity: number }).intensity).toBe(7);
  });

  it("maps nested parts so an outer caller can address them", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    library.register({
      formatVersion: 1, id: "street", name: "Street", root: "road",
      entities: [entity("road", "Road")],
      children: [{ id: "lampA", prefabId: "lamp" }],
    });
    const instance = library.instantiate("street", { idFactory: sequentialIds() });
    expect(instance.idMap.get("lampA")).toBe(instance.entities.find((e) => e.name === "Post")!.id);
    expect(instance.idMap.get("lampA/bulb")).toBe(instance.entities.find((e) => e.name === "Bulb")!.id);
  });

  it("detects a nesting cycle and names the path", () => {
    const library = new PrefabLibrary();
    library.register({ formatVersion: 1, id: "a", name: "A", root: "r", entities: [entity("r", "R")], children: [{ id: "n", prefabId: "b" }] });
    library.register({ formatVersion: 1, id: "b", name: "B", root: "r", entities: [entity("r", "R")], children: [{ id: "n", prefabId: "a" }] });
    expect(() => library.instantiate("a")).toThrow(/nesting cycle: a -> b -> a/);
  });

  it("produces identical ids for a deterministic factory, which networking relies on", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const server = library.instantiate("lamp", { idFactory: sequentialIds() });
    const client = library.instantiate("lamp", { idFactory: sequentialIds() });
    expect(client.entities.map((e) => e.id)).toEqual(server.entities.map((e) => e.id));
  });

  it("defaults to unique ids so two instances never collide", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const a = library.instantiate("lamp");
    const b = library.instantiate("lamp");
    expect(new Set([...a.entities, ...b.entities].map((e) => e.id)).size).toBe(4);
  });

  it("adds an instance to a scene and rejects an id collision", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const document = new SceneDocument(SceneDocument.empty("Level"));
    const instance = library.instantiate("lamp", { idFactory: sequentialIds() });
    const withLamp = addInstanceToScene(document.data, instance);
    expect(withLamp.entities).toHaveLength(2);
    expect(() => addInstanceToScene(withLamp, instance)).toThrow(/which the scene already contains/);
  });

  it("produces a scene the scene document accepts", () => {
    const library = new PrefabLibrary();
    library.register(lamp);
    const document = new SceneDocument(SceneDocument.empty("Level"));
    const instance = library.instantiate("lamp", { idFactory: sequentialIds() });
    expect(() => document.replace(addInstanceToScene(document.data, instance))).not.toThrow();
    expect(document.data.entities.map((e) => e.name)).toEqual(["Post", "Bulb"]);
  });
});
