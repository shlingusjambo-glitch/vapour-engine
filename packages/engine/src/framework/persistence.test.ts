import { describe, expect, it, vi } from "vitest";
import { MemoryStore, NamespacedStore, StorageQuotaError, WebStorageStore, createPersistentStore, type WebStorageLike } from "./storage.js";
import { Settings } from "./settings.js";
import { Localization } from "./localization.js";
import { SaveCorruptError, SaveProfile, SaveVersionError } from "./save.js";

/** A `Storage` stand-in that can be told to fail, so the failure paths that
 * only occur in private windows and at quota are actually covered. */
function fakeStorage(options: { failOn?: string; quota?: boolean } = {}): WebStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      if (options.failOn === key || options.quota) {
        const error = new Error(options.quota ? "quota exceeded" : "denied");
        throw error;
      }
      map.set(key, value);
    },
    removeItem: (key) => { map.delete(key); },
  };
}

describe("storage", () => {
  it("stores and enumerates values in memory", () => {
    const store = new MemoryStore();
    store.set("b", "2");
    store.set("a", "1");
    expect(store.get("a")).toBe("1");
    expect(store.has("a")).toBe(true);
    expect(store.keys()).toEqual(["a", "b"]);
    store.delete("a");
    expect(store.get("a")).toBeUndefined();
    store.clear();
    expect(store.keys()).toEqual([]);
  });

  it("wraps a Storage object and translates quota failures", () => {
    const store = new WebStorageStore(fakeStorage());
    store.set("k", "v");
    expect(store.get("k")).toBe("v");
    const full = new WebStorageStore(fakeStorage({ quota: true }));
    expect(() => full.set("k", "v")).toThrow(StorageQuotaError);
    expect(() => full.set("k", "v")).toThrow(/exceeded the browser's storage quota/);
  });

  it("reports why localStorage is unavailable instead of throwing later", () => {
    expect(WebStorageStore.tryCreate({})).toEqual({ unavailable: "This environment has no localStorage." });
    const refusing = WebStorageStore.tryCreate({ localStorage: fakeStorage({ failOn: "__vapour_probe__" }) });
    expect(refusing).toMatchObject({ unavailable: expect.stringContaining("present but unusable") });
  });

  it("isolates namespaces from each other", () => {
    const shared = new MemoryStore();
    const game = new NamespacedStore(shared, "game");
    const editor = new NamespacedStore(shared, "editor");
    game.set("settings", "a");
    editor.set("settings", "b");
    expect(game.get("settings")).toBe("a");
    expect(editor.get("settings")).toBe("b");
    expect(game.keys()).toEqual(["settings"]);
    game.clear();
    expect(editor.get("settings")).toBe("b");
    expect(() => new NamespacedStore(shared, " ")).toThrow(/must not be empty/);
    expect(() => new NamespacedStore(shared, "a:b")).toThrow(/must not contain/);
  });

  it("falls back to memory and says why", () => {
    const good = createPersistentStore("game", { localStorage: fakeStorage() });
    expect(good.persistent).toBe(true);
    const bad = createPersistentStore("game", {});
    expect(bad.persistent).toBe(false);
    expect(bad.reason).toMatch(/no localStorage/);
    // A non-persistent store still works, so the game still runs.
    bad.store.set("k", "v");
    expect(bad.store.get("k")).toBe("v");
  });
});

const schema = {
  masterVolume: { kind: "number", default: 0.8, min: 0, max: 1, step: 0.05 },
  invertY: { kind: "boolean", default: false },
  quality: { kind: "string", default: "high", options: ["low", "medium", "high"] },
} as const;

describe("Settings", () => {
  it("starts at the schema defaults", () => {
    const settings = new Settings(schema);
    expect(settings.snapshot()).toEqual({ masterVolume: 0.8, invertY: false, quality: "high" });
    expect(settings.keys).toEqual(["invertY", "masterVolume", "quality"]);
  });

  it("clamps and quantizes numbers", () => {
    const settings = new Settings(schema);
    settings.set("masterVolume", 5);
    expect(settings.get("masterVolume")).toBe(1);
    settings.set("masterVolume", -1);
    expect(settings.get("masterVolume")).toBe(0);
    settings.set("masterVolume", 0.33);
    expect(settings.get("masterVolume")).toBe(0.35);
  });

  it("emits a change with the previous value, and only when it changes", () => {
    const settings = new Settings(schema);
    const changed = vi.fn();
    settings.changed.on(changed);
    settings.set("invertY", true);
    expect(changed).toHaveBeenCalledExactlyOnceWith({ key: "invertY", value: true, previous: false });
    settings.set("invertY", true);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("rejects wrong types and unknown keys", () => {
    const settings = new Settings(schema);
    expect(() => settings.set("masterVolume", "loud" as never)).toThrow(/expects a finite number/);
    expect(() => settings.set("quality", "ultra" as never)).toThrow(/expects one of low, medium, high/);
    expect(() => settings.get("nope" as never)).toThrow(/Unknown setting "nope"/);
  });

  it("validates the schema itself", () => {
    expect(() => new Settings({})).toThrow(/at least one setting/);
    expect(() => new Settings({ a: { kind: "number", default: Number.NaN } })).toThrow(/not a finite number/);
    expect(() => new Settings({ a: { kind: "number", default: 0, min: 5, max: 1 } })).toThrow(/greater than max/);
    expect(() => new Settings({ a: { kind: "string", default: "x", options: ["y"] } })).toThrow(/not one of its options/);
  });

  it("persists and reloads through a store", () => {
    const store = new MemoryStore();
    const first = new Settings(schema, { store });
    first.set("quality", "low");
    const second = new Settings(schema, { store });
    expect(second.get("quality")).toBe("low");
  });

  it("degrades a corrupt or outdated stored value to the default and reports it", () => {
    const store = new MemoryStore();
    store.set("settings", JSON.stringify({ masterVolume: "loud", removedOption: 1, quality: "medium" }));
    const onInvalid = vi.fn();
    const settings = new Settings(schema, { store, onInvalid });
    expect(settings.get("masterVolume")).toBe(0.8);
    expect(settings.get("quality")).toBe("medium");
    expect(onInvalid).toHaveBeenCalledWith("masterVolume", "loud", expect.stringContaining("expects a finite number"));
    expect(onInvalid).toHaveBeenCalledWith("removedOption", 1, "unknown setting");
  });

  it("reports unreadable stored settings instead of throwing at startup", () => {
    const store = new MemoryStore();
    store.set("settings", "{not json");
    const onInvalid = vi.fn();
    expect(() => new Settings(schema, { store, onInvalid })).not.toThrow();
    expect(onInvalid).toHaveBeenCalledWith("settings", "{not json", expect.stringContaining("not valid JSON"));
    store.set("settings", "[1,2]");
    new Settings(schema, { store, onInvalid });
    expect(onInvalid).toHaveBeenCalledWith("settings", [1, 2], "stored settings are not an object");
  });

  it("resets one setting or all of them", () => {
    const settings = new Settings(schema);
    settings.set("quality", "low");
    settings.set("invertY", true);
    settings.reset("quality");
    expect(settings.get("quality")).toBe("high");
    expect(settings.get("invertY")).toBe(true);
    settings.reset();
    expect(settings.snapshot()).toEqual({ masterVolume: 0.8, invertY: false, quality: "high" });
  });
});

describe("Localization", () => {
  const build = (onMissing?: (key: string, locale: string) => void): Localization => {
    const localization = new Localization({ sourceLocale: "en", ...(onMissing ? { onMissing } : {}) });
    localization.register("en", {
      "menu.play": "Play",
      "hud.greeting": "Hello, {name}!",
      "hud.braces": "{{literal}}",
      "inventory.items": { one: "{count} item", other: "{count} items" },
    });
    localization.register("pt", { "menu.play": "Jogar" });
    localization.register("pt-BR", { "hud.greeting": "Olá, {name}!" });
    return localization;
  };

  it("resolves in the active locale", () => {
    const localization = build();
    expect(localization.translate("menu.play")).toBe("Play");
    localization.setLocale("pt");
    expect(localization.t("menu.play")).toBe("Jogar");
  });

  it("falls back through language then source locale", () => {
    const localization = build();
    localization.setLocale("pt-BR");
    expect(localization.fallbackChain()).toEqual(["pt-BR", "pt", "en"]);
    expect(localization.translate("hud.greeting", { name: "Ana" })).toBe("Olá, Ana!");
    expect(localization.translate("menu.play")).toBe("Jogar");   // from pt
    expect(localization.translate("inventory.items", { count: 2 })).toBe("2 items"); // from en
  });

  it("returns the key and reports it when nothing resolves", () => {
    const onMissing = vi.fn();
    const localization = build(onMissing);
    expect(localization.translate("nope.at.all")).toBe("nope.at.all");
    expect(onMissing).toHaveBeenCalledWith("nope.at.all", "en");
    expect(localization.has("nope.at.all")).toBe(false);
    expect(localization.has("menu.play")).toBe(true);
  });

  it("interpolates variables, escapes braces, and leaves omissions visible", () => {
    const localization = build();
    expect(localization.translate("hud.greeting", { name: "Sam" })).toBe("Hello, Sam!");
    expect(localization.translate("hud.braces")).toBe("{literal}");
    expect(localization.translate("hud.greeting")).toBe("Hello, {name}!");
  });

  it("selects CLDR plural categories", () => {
    const localization = build();
    expect(localization.translate("inventory.items", { count: 1 })).toBe("1 item");
    expect(localization.translate("inventory.items", { count: 5 })).toBe("5 items");
    expect(localization.translate("inventory.items")).toBe("{count} items");
  });

  it("picks the best locale from a browser preference list", () => {
    const localization = build();
    expect(localization.selectLocale(["pt-BR", "en"])).toBe("pt-BR");
    expect(localization.selectLocale(["pt-PT"])).toBe("pt");
    expect(localization.selectLocale(["de"])).toBe("en");
  });

  it("normalizes locale spelling", () => {
    const localization = build();
    localization.setLocale("PT_br");
    expect(localization.locale).toBe("pt-BR");
    expect(() => localization.setLocale("  ")).toThrow(/must not be empty/);
  });

  it("emits when the locale changes, once", () => {
    const localization = build();
    const changed = vi.fn();
    localization.localeChanged.on(changed);
    localization.setLocale("pt");
    localization.setLocale("pt");
    expect(changed).toHaveBeenCalledExactlyOnceWith("pt");
  });

  it("reports the translation gap for CI", () => {
    const localization = build();
    expect(localization.missingKeys("pt")).toEqual(["hud.braces", "hud.greeting", "inventory.items"]);
    expect(localization.locales).toEqual(["en", "pt", "pt-BR"]);
  });

  it("merges a later table over an earlier one", () => {
    const localization = build();
    localization.register("pt", { "menu.play": "Jogar agora", "hud.braces": "{{x}}" });
    localization.setLocale("pt");
    expect(localization.translate("menu.play")).toBe("Jogar agora");
    expect(localization.translate("hud.braces")).toBe("{x}");
  });
});

interface SaveV3 { name: string; level: number; skills: string[] }

describe("SaveProfile", () => {
  const profile = (store = new MemoryStore()): SaveProfile<SaveV3> =>
    new SaveProfile<SaveV3>({
      store,
      version: 3,
      migrations: {
        1: (data) => ({ ...(data as object), level: 1 }),
        2: (data) => ({ ...(data as object), skills: [] }),
      },
    });

  it("round-trips a save", () => {
    const store = new MemoryStore();
    const saves = profile(store);
    saves.save("slot1", { name: "Ana", level: 4, skills: ["dash"] });
    expect(saves.load("slot1")).toEqual({ name: "Ana", level: 4, skills: ["dash"] });
    expect(saves.has("slot1")).toBe(true);
    expect(saves.load("empty")).toBeUndefined();
  });

  it("migrates an older save forward through every step", () => {
    const store = new MemoryStore();
    store.set("save.old", JSON.stringify({ formatVersion: 1, version: 1, savedAt: "2024-01-01T00:00:00.000Z", data: { name: "Ana" } }));
    expect(profile(store).load("old")).toEqual({ name: "Ana", level: 1, skills: [] });
  });

  it("refuses a save from a newer build rather than misreading it", () => {
    const store = new MemoryStore();
    store.set("save.future", JSON.stringify({ formatVersion: 1, version: 9, savedAt: "", data: {} }));
    expect(() => profile(store).load("future")).toThrow(SaveVersionError);
    expect(() => profile(store).load("future")).toThrow(/written by version 9, but this build reads version 3/);
  });

  it("reports corrupt data, a missing envelope, and a missing migration", () => {
    const store = new MemoryStore();
    store.set("save.bad", "{not json");
    expect(() => profile(store).load("bad")).toThrow(/is not valid JSON/);
    store.set("save.bare", JSON.stringify({ hello: 1 }));
    expect(() => profile(store).load("bare")).toThrow(/missing its version envelope/);
    store.set("save.gap", JSON.stringify({ formatVersion: 1, version: 1, savedAt: "", data: {} }));
    const noMigrations = new SaveProfile<SaveV3>({ store, version: 3 });
    expect(() => noMigrations.load("gap")).toThrow(/no migration is registered from version 1 to 2/);
  });

  it("surfaces a failing migration with its version", () => {
    const store = new MemoryStore();
    store.set("save.x", JSON.stringify({ formatVersion: 1, version: 1, savedAt: "", data: {} }));
    const saves = new SaveProfile<SaveV3>({ store, version: 2, migrations: { 1: () => { throw new Error("bad shape"); } } });
    expect(() => saves.load("x")).toThrow(/migration from version 1 failed: bad shape/);
    expect(() => saves.load("x")).toThrow(SaveCorruptError);
  });

  it("runs a validator over migrated data", () => {
    const store = new MemoryStore();
    const saves = new SaveProfile<SaveV3>({
      store,
      version: 1,
      validate: (data) => {
        if (typeof (data as SaveV3).name !== "string") throw new Error("name must be a string");
        return data as SaveV3;
      },
    });
    saves.save("ok", { name: "Ana", level: 1, skills: [] });
    expect(saves.load("ok")).toMatchObject({ name: "Ana" });
    store.set("save.bad", JSON.stringify({ formatVersion: 1, version: 1, savedAt: "", data: { name: 5 } }));
    expect(() => saves.load("bad")).toThrow(/did not pass validation: name must be a string/);
  });

  it("lists slots without deserializing, marking corrupt ones", () => {
    const store = new MemoryStore();
    const saves = profile(store);
    saves.save("b", { name: "B", level: 1, skills: [] });
    saves.save("a", { name: "A", level: 1, skills: [] });
    store.set("save.broken", "{{{");
    const listed = saves.list();
    expect(listed.map((entry) => entry.slot)).toEqual(["a", "b", "broken"]);
    expect(listed[0]).toMatchObject({ version: 3 });
    expect(listed[2]).toMatchObject({ version: 0, savedAt: "" });
  });

  it("deletes a slot and validates its arguments", () => {
    const store = new MemoryStore();
    const saves = profile(store);
    saves.save("a", { name: "A", level: 1, skills: [] });
    saves.delete("a");
    expect(saves.has("a")).toBe(false);
    expect(() => saves.save("  ", { name: "", level: 1, skills: [] })).toThrow(/must not be empty/);
    expect(() => new SaveProfile({ store, version: 0 })).toThrow(/at least 1/);
    expect(() => new SaveProfile({ store, version: 2, migrations: { 5: (d) => d } })).toThrow(/between 1 and 1/);
  });
});
