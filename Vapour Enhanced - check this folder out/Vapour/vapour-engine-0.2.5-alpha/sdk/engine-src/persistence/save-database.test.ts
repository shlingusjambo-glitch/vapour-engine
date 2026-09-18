import { describe, expect, it, vi } from "vitest";
import { SaveDatabase } from "./save-database.js";

type Store = "world" | "chunks";

describe("SaveDatabase", () => {
  it("provides typed session persistence when IndexedDB is unavailable", async () => {
    const diagnostic = vi.fn();
    const saves = new SaveDatabase<Store>({
      name: "test", version: 1, stores: ["world", "chunks"],
      diagnostic,
    });
    await saves.put("world", "answer", 42);
    expect(await saves.get<number>("world", "answer")).toBe(42);
    expect(saves.persistent).toBe(false);
  });

  it("deletes namespaced data without touching another world", async () => {
    const saves = new SaveDatabase<Store>({ name: "test", version: 1, stores: ["world", "chunks"] });
    await saves.put("chunks", "a::0,0,0", { 1: 2 });
    await saves.put("chunks", "a::1,0,0", { 3: 4 });
    await saves.put("chunks", "b::0,0,0", { 5: 6 });
    expect(await saves.deletePrefix("chunks", "a::")).toBe(2);
    expect(await saves.get("chunks", "a::0,0,0")).toBeUndefined();
    expect(await saves.get("chunks", "b::0,0,0")).toEqual({ 5: 6 });
  });

  it("validates schemas before browser APIs are touched", () => {
    expect(() => new SaveDatabase({ name: "", version: 1, stores: ["x"] })).toThrow(/names/);
    expect(() => new SaveDatabase({ name: "x", version: 0, stores: ["x"] })).toThrow(/versions/);
    expect(() => new SaveDatabase({ name: "x", version: 1, stores: ["x", "x"] })).toThrow(/unique/);
  });
});
