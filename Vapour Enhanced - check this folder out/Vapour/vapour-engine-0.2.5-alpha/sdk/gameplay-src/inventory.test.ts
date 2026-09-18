import { describe, expect, it, vi } from "vitest";
import { InventoryContainer, type InventoryStack } from "./inventory.js";

interface Stack extends InventoryStack<number> { quality?: string }
const create = () => new InventoryContainer<Stack>({
  slots: 4,
  maxStack: (stack) => stack.id === 9 ? 1 : 10,
  canStack: (a, b) => a.id === b.id && a.quality === b.quality,
});

describe("InventoryContainer", () => {
  it("stacks first, fills empty slots, and returns overflow", () => {
    const inventory = create();
    inventory.set(0, { id: 1, count: 8 });
    const leftover = inventory.add({ id: 1, count: 25 });
    expect(inventory.snapshot()).toEqual([{ id: 1, count: 10 }, { id: 1, count: 10 }, { id: 1, count: 10 }, { id: 1, count: 3 }]);
    expect(leftover).toBeNull();
    expect(inventory.add({ id: 2, count: 4 })).toEqual({ id: 2, count: 4 });
  });

  it("keeps metadata variants separate", () => {
    const inventory = create();
    inventory.add({ id: 1, count: 2, quality: "rare" });
    inventory.add({ id: 1, count: 2, quality: "common" });
    expect(inventory.get(0)?.quality).toBe("rare");
    expect(inventory.get(1)?.quality).toBe("common");
  });

  it("performs removal atomically", () => {
    const inventory = create();
    inventory.set(0, { id: 1, count: 3 });
    inventory.set(1, { id: 1, count: 4 });
    expect(inventory.remove(1, 8)).toBe(false);
    expect(inventory.count(1)).toBe(7);
    expect(inventory.remove(1, 5)).toBe(true);
    expect(inventory.count(1)).toBe(2);
  });

  it("batches changes into one revision", () => {
    const inventory = create();
    const listener = vi.fn();
    inventory.subscribe(listener);
    inventory.restore([{ id: 1, count: 2 }, null, { id: 2, count: 3 }]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].changedSlots).toEqual([0, 1, 2, 3]);
    expect(inventory.revision).toBe(1);
  });

  it("enforces slot policies and stack limits", () => {
    const inventory = new InventoryContainer<Stack>({ slots: 2, maxStack: () => 10, accepts: (slot, stack) => slot === 0 || stack.id === 9 });
    expect(() => inventory.set(1, { id: 1, count: 1 })).toThrow(/does not accept/);
    expect(() => inventory.set(0, { id: 1, count: 11 })).toThrow(/exceeds/);
    inventory.set(0, { id: 9, count: 1 });
    inventory.swap(0, 1);
    expect(inventory.get(1)?.id).toBe(9);
  });

  it("returns defensive stack copies", () => {
    const inventory = create();
    inventory.set(0, { id: 1, count: 2 });
    const copy = inventory.get(0)!;
    copy.count = 9;
    expect(inventory.get(0)?.count).toBe(2);
  });
});
