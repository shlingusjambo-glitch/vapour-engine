import { describe, expect, it, vi } from "vitest";
import { ResourceManager, type ResourceLoader } from "./resource-manager.js";
import { ResourceBundle, validateBundle } from "./bundle.js";
import { releaseAll } from "./handle.js";

/** A loader that records how many times each id was actually loaded, so tests
 * can assert on deduplication and caching rather than on timing. */
function countingLoader(type: string, options: { bytes?: number; fail?: string } = {}): ResourceLoader<string> & { loads: string[]; disposals: string[] } {
  const loads: string[] = [];
  const disposals: string[] = [];
  return {
    type,
    loads,
    disposals,
    async load(id) {
      loads.push(id);
      if (options.fail === id) throw new Error(`no such ${type}`);
      return { value: `${type}/${id}`, byteEstimate: options.bytes ?? 0 };
    },
    dispose(value) {
      disposals.push(value);
    },
  };
}

describe("ResourceManager", () => {
  it("refuses to load an unregistered type and names the ones it knows", async () => {
    const manager = new ResourceManager();
    manager.register(countingLoader("texture"));
    await expect(manager.load("mesh", "cube")).rejects.toThrow(/No loader is registered for resource type "mesh".*texture/s);
  });

  it("rejects a duplicate loader registration", () => {
    const manager = new ResourceManager();
    manager.register(countingLoader("texture"));
    expect(() => manager.register(countingLoader("texture"))).toThrow(/already registered/);
  });

  it("loads a resource and hands back a usable handle", async () => {
    const manager = new ResourceManager();
    manager.register(countingLoader("texture"));
    const handle = await manager.load<string>("texture", "grass");
    expect(handle.value).toBe("texture/grass");
    expect(handle.type).toBe("texture");
    expect(handle.id).toBe("grass");
    expect(manager.isLoaded("texture", "grass")).toBe(true);
  });

  it("deduplicates concurrent loads of the same resource", async () => {
    const manager = new ResourceManager();
    const loader = countingLoader("texture");
    manager.register(loader);
    const [a, b, c] = await Promise.all([
      manager.load<string>("texture", "grass"),
      manager.load<string>("texture", "grass"),
      manager.load<string>("texture", "grass"),
    ]);
    expect(loader.loads).toEqual(["grass"]);
    // Three independent references, all valid.
    expect([a.value, b.value, c.value]).toEqual(["texture/grass", "texture/grass", "texture/grass"]);
    expect(manager.stats().handles).toBe(3);
  });

  it("disposes only when the last handle is released", async () => {
    const manager = new ResourceManager();
    const loader = countingLoader("texture");
    manager.register(loader);
    const first = await manager.load<string>("texture", "grass");
    const second = first.retain();
    first.release();
    expect(loader.disposals).toEqual([]);
    expect(manager.isLoaded("texture", "grass")).toBe(true);
    second.release();
    expect(loader.disposals).toEqual(["texture/grass"]);
    expect(manager.isLoaded("texture", "grass")).toBe(false);
  });

  it("throws on use after release and on a double release", async () => {
    const manager = new ResourceManager();
    manager.register(countingLoader("texture"));
    const handle = await manager.load<string>("texture", "grass");
    handle.release();
    expect(() => handle.value).toThrow(/used after its handle was released/);
    expect(() => handle.release()).toThrow(/released twice/);
    expect(() => handle.retain()).toThrow(/cannot be retained/);
  });

  it("releases dependencies with their parent", async () => {
    const manager = new ResourceManager();
    const textures = countingLoader("texture");
    manager.register(textures);
    manager.register({
      type: "material",
      async load(id, context) {
        const base = await context.require<string>("texture", `${id}-base`);
        const normal = await context.require<string>("texture", `${id}-normal`);
        return `material(${base}, ${normal})`;
      },
    });

    const handle = await manager.load<string>("material", "stone");
    expect(handle.value).toBe("material(texture/stone-base, texture/stone-normal)");
    expect(manager.isLoaded("texture", "stone-base")).toBe(true);

    handle.release();
    // The material's dependencies had no other owner, so they go with it.
    expect(manager.isLoaded("texture", "stone-base")).toBe(false);
    expect(textures.disposals.sort()).toEqual(["texture/stone-base", "texture/stone-normal"]);
  });

  it("keeps a shared dependency alive while another parent still needs it", async () => {
    const manager = new ResourceManager();
    manager.register(countingLoader("texture"));
    manager.register({
      type: "material",
      async load(id, context) {
        return `material(${await context.require<string>("texture", "shared")})`;
      },
    });
    const first = await manager.load<string>("material", "a");
    const second = await manager.load<string>("material", "b");
    first.release();
    expect(manager.isLoaded("texture", "shared")).toBe(true);
    second.release();
    expect(manager.isLoaded("texture", "shared")).toBe(false);
  });

  it("detects a dependency cycle and names the path", async () => {
    const manager = new ResourceManager();
    manager.register({
      type: "node",
      async load(id, context) {
        const next = id === "a" ? "b" : "a";
        await context.require("node", next);
        return id;
      },
    });
    await expect(manager.load("node", "a")).rejects.toThrow(/dependency cycle: node:a -> node:b -> node:a/);
  });

  it("does not cache a failure, so a retry can succeed", async () => {
    const manager = new ResourceManager();
    let attempt = 0;
    manager.register({
      type: "remote",
      async load(id) {
        attempt += 1;
        if (attempt === 1) throw new Error("network down");
        return `${id}@${attempt}`;
      },
    });
    await expect(manager.load("remote", "config")).rejects.toThrow(/failed to load: network down/);
    const handle = await manager.load<string>("remote", "config");
    expect(handle.value).toBe("config@2");
  });

  it("releases already-loaded dependencies when a load fails partway", async () => {
    const manager = new ResourceManager();
    const textures = countingLoader("texture");
    manager.register(textures);
    manager.register({
      type: "material",
      async load(_id, context) {
        await context.require("texture", "ok");
        throw new Error("bad material");
      },
    });
    await expect(manager.load("material", "broken")).rejects.toThrow(/bad material/);
    expect(manager.isLoaded("texture", "ok")).toBe(false);
    expect(textures.disposals).toEqual(["texture/ok"]);
  });

  it("reports progress to each waiting caller", async () => {
    const manager = new ResourceManager();
    manager.register({
      type: "big",
      async load(id, context) {
        context.report(0.5);
        context.report(1);
        return id;
      },
    });
    const progress: number[] = [];
    await manager.load("big", "world", { onProgress: (value) => progress.push(value) });
    expect(progress).toEqual([0.5, 1]);
  });

  it("lets one caller cancel without abandoning the shared load", async () => {
    const manager = new ResourceManager();
    let resolve!: (value: string) => void;
    manager.register({
      type: "slow",
      load: () => new Promise<string>((r) => { resolve = r; }),
    });
    const controller = new AbortController();
    const cancelled = manager.load("slow", "level", { signal: controller.signal });
    const patient = manager.load<string>("slow", "level");
    controller.abort(new Error("user navigated away"));
    await expect(cancelled).rejects.toThrow(/user navigated away/);
    resolve("slow/level");
    await expect(patient).resolves.toMatchObject({ id: "level" });
  });

  it("aborts the underlying load once every caller has cancelled", async () => {
    const manager = new ResourceManager();
    const seen: AbortSignal[] = [];
    manager.register({
      type: "slow",
      load: (_id, context) => {
        seen.push(context.signal);
        return new Promise<string>(() => {});
      },
    });
    const controller = new AbortController();
    const pending = manager.load("slow", "level", { signal: controller.signal });
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(seen[0]!.aborted).toBe(true);
  });

  it("retains unreferenced resources under the retain policy until asked to unload", async () => {
    const manager = new ResourceManager({ cachePolicy: "retain" });
    const loader = countingLoader("texture");
    manager.register(loader);
    (await manager.load<string>("texture", "grass")).release();
    expect(manager.isLoaded("texture", "grass")).toBe(true);
    // A second load is served from cache.
    (await manager.load<string>("texture", "grass")).release();
    expect(loader.loads).toEqual(["grass"]);
    expect(manager.unloadUnused()).toBe(1);
    expect(manager.isLoaded("texture", "grass")).toBe(false);
  });

  it("evicts the least recently released resource when the cache budget is exceeded", async () => {
    const manager = new ResourceManager({ cachePolicy: "retain", maxCachedBytes: 150 });
    manager.register(countingLoader("texture", { bytes: 100 }));
    (await manager.load<string>("texture", "first")).release();
    (await manager.load<string>("texture", "second")).release();
    expect(manager.isLoaded("texture", "first")).toBe(false);
    expect(manager.isLoaded("texture", "second")).toBe(true);
  });

  it("cascades unloadUnused through a dependency chain", async () => {
    const manager = new ResourceManager({ cachePolicy: "retain" });
    manager.register(countingLoader("texture"));
    manager.register({
      type: "material",
      async load(id, context) {
        await context.require("texture", id);
        return id;
      },
    });
    (await manager.load("material", "stone")).release();
    expect(manager.unloadUnused()).toBe(2);
    expect(manager.stats().cached).toBe(0);
  });

  it("reports statistics and an inspectable entry list", async () => {
    const manager = new ResourceManager();
    manager.register(countingLoader("texture", { bytes: 64 }));
    const handle = await manager.load<string>("texture", "grass");
    expect(manager.stats()).toMatchObject({ referenced: 1, cached: 0, handles: 1, estimatedBytes: 64 });
    expect(manager.inspect()).toEqual([
      { type: "texture", id: "grass", state: "ready", refCount: 1, byteEstimate: 64, dependencies: [] },
    ]);
    handle.release();
  });

  it("rejects work after disposal and disposes live values", async () => {
    const manager = new ResourceManager();
    const loader = countingLoader("texture");
    manager.register(loader);
    await manager.load("texture", "grass");
    manager.dispose();
    expect(loader.disposals).toEqual(["texture/grass"]);
    await expect(manager.load("texture", "grass")).rejects.toThrow(/has been disposed/);
  });

  it("rejects an empty resource id", async () => {
    const manager = new ResourceManager();
    manager.register(countingLoader("texture"));
    await expect(manager.load("texture", "   ")).rejects.toThrow(/non-empty id/);
  });

  it("serves get() from cache and never starts a load", async () => {
    const manager = new ResourceManager();
    const loader = countingLoader("texture");
    manager.register(loader);
    expect(manager.get("texture", "grass")).toBeUndefined();
    const first = await manager.load<string>("texture", "grass");
    const second = manager.get<string>("texture", "grass");
    expect(second?.value).toBe("texture/grass");
    expect(loader.loads).toEqual(["grass"]);
    releaseAll([first, second!]);
    expect(manager.isLoaded("texture", "grass")).toBe(false);
  });
});

describe("preload and bundles", () => {
  it("validates bundle data", () => {
    expect(() => validateBundle({ formatVersion: 2 as never, name: "x", resources: [] })).toThrow(/Unsupported resource bundle version/);
    expect(() => validateBundle({ formatVersion: 1, name: " ", resources: [] })).toThrow(/non-empty name/);
    expect(() =>
      validateBundle({ formatVersion: 1, name: "level", resources: [{ type: "texture", id: "a" }, { type: "texture", id: "a" }] }),
    ).toThrow(/more than once/);
  });

  it("loads and releases a bundle as one unit", async () => {
    const manager = new ResourceManager();
    const loader = countingLoader("texture");
    manager.register(loader);
    const bundle = new ResourceBundle(manager, {
      formatVersion: 1,
      name: "forest",
      resources: [{ type: "texture", id: "bark" }, { type: "texture", id: "leaf" }],
    });
    expect(bundle.state).toBe("unloaded");
    await bundle.load();
    expect(bundle.state).toBe("loaded");
    expect(bundle.handles).toHaveLength(2);
    bundle.release();
    expect(manager.stats().referenced).toBe(0);
    expect(loader.disposals.sort()).toEqual(["texture/bark", "texture/leaf"]);
  });

  it("is idempotent, so a streaming system can call load() freely", async () => {
    const manager = new ResourceManager();
    const loader = countingLoader("texture");
    manager.register(loader);
    const bundle = new ResourceBundle(manager, { formatVersion: 1, name: "hud", resources: [{ type: "texture", id: "icon" }] });
    await Promise.all([bundle.load(), bundle.load()]);
    await bundle.load();
    expect(loader.loads).toEqual(["icon"]);
    expect(bundle.handles).toHaveLength(1);
  });

  it("releases partial progress when a preload fails, and says what failed", async () => {
    const manager = new ResourceManager();
    const loader = countingLoader("texture", { fail: "missing" });
    manager.register(loader);
    await expect(
      manager.preload([{ type: "texture", id: "present" }, { type: "texture", id: "missing" }]),
    ).rejects.toThrow(/Preload failed for 1 resource\(s\)[\s\S]*texture:missing/);
    expect(manager.stats().referenced).toBe(0);
    expect(loader.disposals).toEqual(["texture/present"]);
  });

  it("marks a bundle failed and reports its name", async () => {
    const manager = new ResourceManager();
    manager.register(countingLoader("texture", { fail: "gone" }));
    const bundle = new ResourceBundle(manager, { formatVersion: 1, name: "level-2", resources: [{ type: "texture", id: "gone" }] });
    await expect(bundle.load()).rejects.toThrow(/Resource bundle "level-2" failed to load/);
    expect(bundle.state).toBe("failed");
  });

  it("emits lifecycle events for diagnostics", async () => {
    const manager = new ResourceManager();
    manager.register(countingLoader("texture"));
    const loaded = vi.fn();
    const unloaded = vi.fn();
    manager.addEventListener("resourceloaded", loaded);
    manager.addEventListener("resourceunloaded", unloaded);
    (await manager.load("texture", "grass")).release();
    expect(loaded).toHaveBeenCalledOnce();
    expect(unloaded).toHaveBeenCalledOnce();
  });
});
