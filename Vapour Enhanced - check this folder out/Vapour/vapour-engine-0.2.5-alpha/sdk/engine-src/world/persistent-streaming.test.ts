import { describe, expect, it, vi } from "vitest";
import { ChunkStreamManager } from "./world-streaming.js";
import { PersistentChunkStreamSource } from "./persistent-streaming.js";

describe("PersistentChunkStreamSource", () => {
  it("restores cell state and checkpoints it before disposal", async () => {
    const states = new Map([["0,0,0", { doors: ["garage"] }]]);
    const dispose = vi.fn();
    const source = new PersistentChunkStreamSource({
      load: (_coordinate, _context, state) => ({ doors: [...(state?.doors ?? [])] }),
      capture: (cell: { doors: string[] }) => ({ doors: [...cell.doors] }),
      dispose,
    }, {
      load: (key) => states.get(key),
      save: (key, state) => { states.set(key, state); },
    });
    const manager = new ChunkStreamManager(source, { unloadDelayUpdates: 0 });
    manager.update([{ coordinate: { x: 0, y: 0, z: 0 }, radius: 0 }]);
    await manager.settleActiveLoads();
    const cell = manager.entry({ x: 0, y: 0, z: 0 })!.value!;
    cell.doors.push("shop");
    manager.update([]);
    expect(dispose).toHaveBeenCalledOnce();
    await source.flush();
    expect(states.get("0,0,0")?.doors).toEqual(["garage", "shop"]);
  });

  it("reports failed saves after draining all writes", async () => {
    const source = new PersistentChunkStreamSource({ load: () => ({}), capture: () => ({}) }, {
      load: () => undefined,
      save: async () => { throw new Error("quota"); },
    });
    source.dispose({}, { x: 1, y: 0, z: 2 });
    await expect(source.flush()).rejects.toThrow("1 streamed world cell save");
    expect(source.stats()).toEqual({ pendingSaves: 0, failedSaves: 0 });
  });
});
