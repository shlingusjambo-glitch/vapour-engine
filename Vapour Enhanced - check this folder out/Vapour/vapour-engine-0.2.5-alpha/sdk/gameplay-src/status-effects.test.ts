import { describe, expect, it, vi } from "vitest";
import { StatusEffectSet } from "./status-effects.js";

describe("StatusEffectSet", () => {
  it("applies, refreshes, expires, and exposes Map-like reads", () => {
    const effects = new StatusEffectSet<"speed">();
    const listener = vi.fn();
    effects.subscribe(listener);
    effects.set("speed", 5);
    effects.update(2);
    expect(effects.get("speed")).toBe(3);
    expect([...effects]).toEqual([["speed", 3]]);
    effects.set("speed", 4);
    effects.update(4);
    expect(effects.has("speed")).toBe(false);
    expect(listener.mock.calls.map((call) => call[0].type)).toEqual(["applied", "refreshed", "expired"]);
  });

  it("emits deterministic periodic ticks including frame catch-up", () => {
    const effects = new StatusEffectSet([{ id: "poison", tickInterval: 2 }]);
    const ticks: number[] = [];
    effects.subscribe((event) => { if (event.type === "tick") ticks.push(event.tick); });
    effects.set("poison", 10);
    effects.update(5.1);
    expect(ticks).toEqual([1, 2]);
    effects.update(4.9);
    expect(ticks).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not tick beyond expiration and reports clear snapshots", () => {
    const effects = new StatusEffectSet([{ id: "short", tickInterval: 1 }]);
    const listener = vi.fn();
    effects.subscribe(listener);
    effects.set("short", 2.5);
    effects.update(10);
    expect(listener.mock.calls.filter((call) => call[0].type === "tick")).toHaveLength(2);
    effects.set("short", 3);
    effects.clear();
    expect(listener.mock.calls.at(-1)?.[0].effects[0].id).toBe("short");
  });

  it("validates durations and deltas", () => {
    expect(() => new StatusEffectSet([{ id: "bad", tickInterval: 0 }])).toThrow(/positive/);
    const effects = new StatusEffectSet();
    expect(() => effects.set("x", 0)).toThrow(/positive/);
    expect(() => effects.update(-1)).toThrow(/non-negative/);
  });
});
