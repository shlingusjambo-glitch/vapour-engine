import { describe, expect, it } from "vitest";
import { CraftingRegistry } from "./crafting.js";

const recipes = () => {
  const registry = new CraftingRegistry<number, { id: number; count: number }>();
  registry.register({ id: "pick", pattern: [[1, 1, 1], [null, 2, null], [null, 2, null]], output: { id: 10, count: 1 } });
  registry.register({ id: "dye", pattern: [[[3, 4], 5]], output: { id: 11, count: 2 }, shapeless: true });
  return registry;
};

describe("CraftingRegistry", () => {
  it("matches shaped recipes at any valid offset and rejects extra cells", () => {
    const registry = recipes();
    const grid = [null, 1, 1, 1, null, null, 2, null, null, null, 2, null];
    const match = registry.match(grid, 4, 3);
    expect(match?.recipe.id).toBe("pick");
    expect(match?.rowOffset).toBe(0);
    expect(match?.columnOffset).toBe(1);
    expect(registry.match([...grid.slice(0, 11), 9], 4, 3)).toBeNull();
  });

  it("matches tagged shapeless ingredients independent of order", () => {
    const registry = recipes();
    expect(registry.match([5, null, 4, null], 2, 2)?.output).toEqual({ id: 11, count: 2 });
    expect(registry.match([5, 4, 3, null], 2, 2)).toBeNull();
  });

  it("backtracks across overlapping ingredient tags", () => {
    const registry = new CraftingRegistry<number, string>();
    registry.register({ id: "overlap", pattern: [[[1, 2], [1, 3]]], output: "ok", shapeless: true });
    expect(registry.match([1, 2], 2, 1)?.output).toBe("ok");
  });

  it("crafts against copies and consumes only matched slots", () => {
    const registry = recipes();
    const original = [null, { id: 1, count: 2 }, { id: 1, count: 1 }, { id: 1, count: 1 }, null, null, { id: 2, count: 1 }, null, null, null, { id: 2, count: 3 }, null];
    const result = registry.craft(original, 4, 3);
    expect(result?.grid[1]).toEqual({ id: 1, count: 1 });
    expect(result?.grid[2]).toBeNull();
    expect(result?.grid[10]).toEqual({ id: 2, count: 2 });
    expect(original[2]).toEqual({ id: 1, count: 1 });
  });

  it("plans tag consumption without double-spending shared IDs", () => {
    const registry = new CraftingRegistry<number, string>();
    const recipe = { id: "mix", pattern: [[[1, 2], [1]]], output: "ok", shapeless: true } as const;
    registry.register(recipe);
    expect(registry.planFromCounts(recipe, new Map([[1, 1], [2, 1]]))).toEqual(new Map([[2, 1], [1, 1]]));
    expect(registry.planFromCounts(recipe, new Map([[1, 1]]))).toBeNull();
  });

  it("validates recipe IDs, patterns, and grid dimensions", () => {
    const registry = recipes();
    expect(() => registry.register({ id: "pick", pattern: [[1]], output: { id: 1, count: 1 } })).toThrow(/already/);
    expect(() => registry.match([1], 2, 2)).toThrow(/expected 4/);
  });
});
