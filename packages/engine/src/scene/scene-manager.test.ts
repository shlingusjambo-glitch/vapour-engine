import { describe, expect, it, vi } from "vitest";
import { ResourceManager } from "../resources/resource-manager.js";
import { SceneDocument, type SceneData } from "../core/scene-document.js";
import { SCENE_RESOURCE_TYPE, SceneManager } from "./scene-manager.js";

function scene(id: string, entityNames: readonly string[] = []): SceneData {
  return {
    formatVersion: 1,
    id,
    name: id,
    entities: entityNames.map((name) => ({
      id: `${id}-${name}`,
      name,
      enabled: true,
      components: [{ typeName: "vapour.Transform", version: 1, data: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }],
    })),
  };
}

function managerWith(scenes: Record<string, SceneData>, options: { fail?: string } = {}): { manager: SceneManager; resources: ResourceManager; loads: string[] } {
  const resources = new ResourceManager();
  const loads: string[] = [];
  resources.register({
    type: SCENE_RESOURCE_TYPE,
    async load(id) {
      loads.push(id);
      if (options.fail === id) throw new Error("missing scene file");
      const data = scenes[id];
      if (!data) throw new Error(`unknown scene ${id}`);
      return data;
    },
  });
  return { manager: new SceneManager(resources), resources, loads };
}

describe("SceneManager", () => {
  it("loads a scene and makes it active", async () => {
    const { manager } = managerWith({ level1: scene("level1", ["Player"]) });
    const loaded = await manager.load("level1");
    expect(loaded.name).toBe("level1");
    expect(manager.active?.id).toBe("level1");
    expect(manager.isLoaded("level1")).toBe(true);
  });

  it("rejects an empty scene id", async () => {
    const { manager } = managerWith({});
    await expect(manager.load("  ")).rejects.toThrow(/must not be empty/);
  });

  it("replaces other scenes in single mode but keeps additive ones layered", async () => {
    const { manager } = managerWith({ a: scene("a"), b: scene("b"), hud: scene("hud") });
    await manager.load("a");
    await manager.load("hud", { mode: "additive" });
    expect(manager.loaded.map((entry) => entry.id).sort()).toEqual(["a", "hud"]);
    await manager.load("b");
    // A single load clears everything, additive scenes included.
    expect(manager.loaded.map((entry) => entry.id)).toEqual(["b"]);
    expect(manager.active?.id).toBe("b");
  });

  it("keeps additive scenes out of the active slot by default", async () => {
    const { manager } = managerWith({ a: scene("a"), hud: scene("hud") });
    await manager.load("a");
    await manager.load("hud", { mode: "additive" });
    expect(manager.active?.id).toBe("a");
    await manager.load("hud", { mode: "additive", setActive: true });
    expect(manager.active?.id).toBe("hud");
  });

  it("deduplicates concurrent loads and returns the existing scene on reload", async () => {
    const { manager, loads } = managerWith({ a: scene("a") });
    const [first, second] = await Promise.all([manager.load("a"), manager.load("a")]);
    expect(first).toBe(second);
    await manager.load("a");
    expect(loads).toEqual(["a"]);
  });

  it("leaves the current world intact when a load fails", async () => {
    const { manager } = managerWith({ a: scene("a"), broken: scene("broken") }, { fail: "broken" });
    await manager.load("a");
    await expect(manager.load("broken")).rejects.toThrow(/missing scene file/);
    expect(manager.loaded.map((entry) => entry.id)).toEqual(["a"]);
    expect(manager.active?.id).toBe("a");
  });

  it("releases the scene resource when unloaded", async () => {
    const { manager, resources } = managerWith({ a: scene("a") });
    await manager.load("a");
    expect(resources.stats().referenced).toBe(1);
    manager.unload("a");
    expect(resources.stats().referenced).toBe(0);
    expect(manager.active).toBeUndefined();
  });

  it("promotes another scene when the active one unloads", async () => {
    const { manager } = managerWith({ a: scene("a"), b: scene("b") });
    await manager.load("a");
    await manager.load("b", { mode: "additive" });
    manager.unload("a");
    expect(manager.active?.id).toBe("b");
  });

  it("emits the lifecycle events in order", async () => {
    const { manager } = managerWith({ a: scene("a") });
    const events: string[] = [];
    for (const name of ["scenewillload", "sceneloaded", "scenewillunload", "sceneunloaded", "activescenechanged"]) {
      manager.addEventListener(name, () => events.push(name));
    }
    await manager.load("a");
    manager.unload("a");
    expect(events).toEqual(["scenewillload", "activescenechanged", "sceneloaded", "scenewillunload", "activescenechanged", "sceneunloaded"]);
  });

  it("runs a transition with out before unload and in after activation", async () => {
    const { manager } = managerWith({ a: scene("a"), b: scene("b") });
    await manager.load("a");
    const order: string[] = [];
    manager.addEventListener("sceneloaded", () => order.push("loaded"));
    await manager.transitionTo("b", {
      transition: {
        out: () => { order.push("out"); },
        in: () => { order.push("in"); },
      },
    });
    expect(order).toEqual(["out", "loaded", "in"]);
  });

  it("isolates loaded scenes from the cached resource value", async () => {
    const data = scene("a", ["Player"]);
    const { manager } = managerWith({ a: data });
    const loaded = await manager.load("a");
    loaded.document.addEntity("Spawned");
    manager.unload("a");
    // Mutating a loaded scene must not corrupt the next load of it.
    const reloaded = await manager.load("a");
    expect(reloaded.document.data.entities.map((entity) => entity.name)).toEqual(["Player"]);
  });

  it("composes persistent and loaded scenes into one world", async () => {
    const { manager } = managerWith({ a: scene("a", ["Tree"]), hud: scene("hud", ["Bar"]) });
    manager.persistent.addEntity("Player");
    await manager.load("a");
    await manager.load("hud", { mode: "additive" });
    const world = manager.compose();
    expect(world.entities.map((entity) => entity.name).sort()).toEqual(["Bar", "Player", "Tree"]);
    expect(manager.stats()).toMatchObject({ loaded: 2, additive: 1, persistentEntities: 1, totalEntities: 3 });
  });

  it("reports which scenes collide instead of silently dropping an entity", async () => {
    const clashing = scene("b");
    clashing.entities = scene("a", ["Tree"]).entities;
    const { manager } = managerWith({ a: scene("a", ["Tree"]), b: clashing });
    await manager.load("a");
    await manager.load("b", { mode: "additive" });
    expect(() => manager.compose()).toThrow(/appears in both "a" and "b"/);
  });

  it("keeps persistent entities across a single-mode change", async () => {
    const { manager } = managerWith({ a: scene("a"), b: scene("b") });
    manager.persistent.addEntity("Player");
    await manager.load("a");
    await manager.load("b");
    expect(manager.compose().entities.map((entity) => entity.name)).toContain("Player");
  });

  it("refuses to activate a scene that is not loaded", async () => {
    const { manager } = managerWith({ a: scene("a") });
    expect(() => manager.setActive("nope")).toThrow(/not loaded/);
  });

  it("reports an invalid scene document with the scene id", async () => {
    const resources = new ResourceManager();
    resources.register({ type: SCENE_RESOURCE_TYPE, load: async () => ({ formatVersion: 99, id: "x", name: "x", entities: [] }) as unknown as SceneData });
    const manager = new SceneManager(resources);
    await expect(manager.load("x")).rejects.toThrow(/Scene "x" is not a valid scene document/);
    expect(resources.stats().referenced).toBe(0);
  });

  it("unloads everything at once", async () => {
    const { manager } = managerWith({ a: scene("a"), b: scene("b") });
    await manager.load("a");
    await manager.load("b", { mode: "additive" });
    manager.unloadAll();
    expect(manager.loaded).toEqual([]);
    expect(manager.compose().entities).toEqual([]);
  });

  it("forwards progress from the scene loader", async () => {
    const resources = new ResourceManager();
    resources.register({
      type: SCENE_RESOURCE_TYPE,
      async load(id, context) {
        context.report(0.5);
        return scene(id);
      },
    });
    const manager = new SceneManager(resources);
    const progress = vi.fn();
    await manager.load("a", { onProgress: progress });
    expect(progress).toHaveBeenCalledWith(0.5);
  });
});
