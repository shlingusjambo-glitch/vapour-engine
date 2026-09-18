import { describe, expect, it } from "vitest";
import { AmbienceEmitter, mixVehicleAudio } from "./open-world-audio.js";

describe("mixVehicleAudio", () => {
  it("crossfades engine bands and adds speed/slip layers", () => {
    const idle = mixVehicleAudio({ rpm: 0, load: 0, speedMetersPerSecond: 0, slip: 0 });
    expect(idle.layers.find((x) => x.layer === "idle")!.gain).toBeGreaterThan(0.5);
    const fast = mixVehicleAudio({ rpm: 0.9, load: 1, speedMetersPerSecond: 40, slip: 0.8, interior: true });
    expect(fast.layers.find((x) => x.layer === "high")!.gain).toBeGreaterThan(0.8);
    expect(fast.layers.find((x) => x.layer === "wind")!.gain).toBeGreaterThan(0.5);
    expect(fast.layers.find((x) => x.layer === "tire")!.gain).toBe(1);
    expect(fast.lowPassHz).toBeLessThan(5000);
  });
  it("rejects invalid telemetry", () => expect(() => mixVehicleAudio({ rpm: 2, load: 0, speedMetersPerSecond: 0, slip: 0 })).toThrow(/RPM/));
});

describe("AmbienceEmitter", () => {
  it("emits deterministic weighted variations at bounded intervals", () => {
    const definition = { id: "birds", variants: [{ clip: "a", weight: 4 }, { clip: "b", weight: 1, volume: 0.7 }], minInterval: 1, maxInterval: 2, seed: 42 } as const;
    const a = new AmbienceEmitter(definition), b = new AmbienceEmitter(definition);
    const first = a.update(20), second = b.update(20);
    expect(first).toEqual(second); expect(first.length).toBeGreaterThan(5); expect(first.every((event) => event.emitter === "birds")).toBe(true);
    expect(a.remainingSeconds).toBeGreaterThanOrEqual(0);
  });
  it("validates authored definitions", () => expect(() => new AmbienceEmitter({ id: "bad", variants: [], minInterval: 1, maxInterval: 2 })).toThrow(/at least one variant/));
});
