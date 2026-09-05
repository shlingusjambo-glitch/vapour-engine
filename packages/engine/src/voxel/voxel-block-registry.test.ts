import { describe, expect, it } from "vitest";
import { VoxelBlockRegistry } from "./voxel-block-registry.js";

interface TestBlock { readonly id: number; readonly name: string; readonly damage: number; }

describe("VoxelBlockRegistry", () => {
  it("keeps stable IDs, deterministic order, and game metadata", () => {
    const blocks = new VoxelBlockRegistry<TestBlock>({ fallbackId: 2 });
    blocks.define({ id: 2, name: "Stone", damage: 3 });
    blocks.define({ id: 1, name: "Dirt", damage: 1 });
    expect(blocks.definitions().map((block) => block.id)).toEqual([1, 2]);
    expect(blocks.getOrFallback(999).name).toBe("Stone");
    expect(blocks.require(1).damage).toBe(1);
  });

  it("rejects silent conflicts but supports explicit plugin replacement", () => {
    const blocks = new VoxelBlockRegistry<TestBlock>();
    blocks.define({ id: 4, name: "Old", damage: 1 });
    expect(() => blocks.define({ id: 4, name: "Conflict", damage: 2 })).toThrow(/already defined/);
    blocks.define({ id: 4, name: "Hot Reloaded", damage: 3 }, { replace: true });
    expect(blocks.require(4).name).toBe("Hot Reloaded");
  });

  it("round trips merge-friendly JSON and validates malformed databases", () => {
    const source = new VoxelBlockRegistry<TestBlock>();
    source.define({ id: 8, name: "Water", damage: 0 });
    const restored = new VoxelBlockRegistry<TestBlock>();
    restored.load(source.serialize());
    expect(restored.require(8)).toEqual({ id: 8, name: "Water", damage: 0 });
    expect(() => restored.load('{"version":2,"blocks":[]}')).toThrow(/version/);
    const invalid = new VoxelBlockRegistry<TestBlock>();
    invalid.define({ id: 1, name: "Broken", damage: Number.NaN });
    expect(() => invalid.serialize()).toThrow(/finite/);
  });
});
