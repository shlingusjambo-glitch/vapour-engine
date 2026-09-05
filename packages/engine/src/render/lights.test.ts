import { describe, expect, it } from "vitest";
import {
  LIGHT_KIND_AMBIENT,
  LIGHT_KIND_DIRECTIONAL,
  LIGHT_KIND_HEMISPHERE,
  LIGHT_KIND_POINT,
  LIGHT_KIND_SPOT,
  LIGHT_STRIDE,
  LightRig,
  MAX_LIGHTS,
  lightCount,
  normalizeLightRig,
} from "./lights.js";

/** Float32 storage rounds, so packed values are compared with tolerance. */
function expectClose(
  actual: readonly number[],
  expected: readonly number[],
): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) {
    expect(actual[index]!).toBeCloseTo(value, 6);
  }
}

/** Reads one packed record back out of a rig. */
function record(rig: LightRig, index: number): number[] {
  return [
    ...rig.pack().subarray(index * LIGHT_STRIDE, (index + 1) * LIGHT_STRIDE),
  ];
}

describe("LightRig", () => {
  it("packs each light kind into its own record", () => {
    const rig = new LightRig();
    rig
      .addAmbient([0.2, 0.3, 0.4], 1)
      .addHemisphere([0.4, 0.6, 0.9], [0.2, 0.2, 0.1], 0.5)
      .addDirectional([0, -1, 0], [1, 1, 1], 3)
      .addPoint([4, 5, 6], [1, 0.5, 0], 2, 12)
      .addSpot([1, 2, 3], [0, -1, 0], [1, 1, 1], 4, 20);

    expect(rig.count).toBe(5);
    expect(rig.pack()).toHaveLength(5 * LIGHT_STRIDE);
    expect(record(rig, 0)[0]).toBe(LIGHT_KIND_AMBIENT);
    expect(record(rig, 1)[0]).toBe(LIGHT_KIND_HEMISPHERE);
    expect(record(rig, 2)[0]).toBe(LIGHT_KIND_DIRECTIONAL);
    expect(record(rig, 3)[0]).toBe(LIGHT_KIND_POINT);
    expect(record(rig, 4)[0]).toBe(LIGHT_KIND_SPOT);
  });

  it("keeps a point light's position and range verbatim", () => {
    // Normalizing a position, as a direction would be, would move every torch
    // in a world to the origin.
    const rig = new LightRig();
    rig.addPoint([4, 5, 6], [1, 0.5, 0], 2, 12);
    const packed = record(rig, 0);
    expect(packed.slice(1, 4)).toEqual([4, 5, 6]);
    expectClose(packed.slice(4, 8), [1, 0.5, 0, 2]);
    expect(packed[11]).toBe(12);
  });

  it("carries a hemisphere's ground colour in the secondary lane", () => {
    const rig = new LightRig();
    rig.addHemisphere([0.4, 0.6, 0.9], [0.2, 0.2, 0.1], 0.5);
    const packed = record(rig, 0);
    expectClose(packed.slice(4, 8), [0.4, 0.6, 0.9, 0.5]);
    expectClose(packed.slice(8, 11), [0.2, 0.2, 0.1]);
  });

  it("packs spot cones as cosines, widest last", () => {
    // The shader divides by the span between the two, so the inner cosine must
    // stay at or above the outer one.
    const rig = new LightRig();
    rig.addSpot([0, 0, 0], [0, -1, 0], [1, 1, 1], 1, 10, Math.PI / 6, 0.5);
    const packed = record(rig, 0);
    expect(packed[12]!).toBeGreaterThanOrEqual(packed[13]!);
    expect(packed[13]!).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(packed[12]!).toBeCloseTo(Math.cos(Math.PI / 12), 6);
  });

  it("clamps a negative intensity rather than subtracting light", () => {
    const rig = new LightRig();
    rig.addAmbient([1, 1, 1], -5);
    expect(record(rig, 0)[7]).toBe(0);
  });

  it("clears reused storage so a light cannot inherit a range or cone", () => {
    const rig = new LightRig(2);
    rig.addSpot([0, 0, 0], [0, -1, 0], [1, 1, 1], 1, 30, Math.PI / 4, 1);
    rig.reset();
    rig.addAmbient([1, 1, 1], 1);
    const packed = record(rig, 0);
    expect(packed.slice(8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("grows past its initial capacity without losing earlier lights", () => {
    const rig = new LightRig(1);
    for (let index = 0; index < 10; index += 1) {
      rig.addPoint([index, 0, 0], [1, 1, 1], 1, 4);
    }
    expect(rig.count).toBe(10);
    for (let index = 0; index < 10; index += 1) {
      expect(record(rig, index)[1]).toBe(index);
    }
  });

  it("refuses more lights than the shader can hold", () => {
    // Silently dropping the surplus would lose lighting without saying so.
    const rig = new LightRig();
    for (let index = 0; index < MAX_LIGHTS; index += 1)
      rig.addAmbient([1, 1, 1], 0.1);
    expect(() => rig.addAmbient([1, 1, 1], 0.1)).toThrow(/at most/);
  });

  it("rejects a nonsensical capacity", () => {
    expect(() => new LightRig(0)).toThrow(/positive integer/);
  });
});

describe("normalizeLightRig", () => {
  it("widens the original seven-float light into a directional record", () => {
    // Games written against the single-light API must keep working.
    const normalized = normalizeLightRig(
      new Float32Array([0, -1, 0, 1, 0.9, 0.8, 3]),
    );
    expect(normalized.length % LIGHT_STRIDE).toBe(0);
    expect(normalized[0]).toBe(LIGHT_KIND_DIRECTIONAL);
    expect([...normalized.subarray(1, 4)]).toEqual([0, -1, 0]);
    // A lone directional light would leave back faces black, so a token
    // ambient fill accompanies it.
    expect(normalized[LIGHT_STRIDE]).toBe(LIGHT_KIND_AMBIENT);
    expect(lightCount(new Float32Array([0, -1, 0, 1, 0.9, 0.8, 3]))).toBe(2);
  });

  it("passes an already-packed rig through untouched", () => {
    const rig = new LightRig();
    rig.addAmbient([1, 1, 1], 1);
    const packed = rig.pack();
    expect(normalizeLightRig(packed)).toBe(packed);
  });

  it("leaves an empty submission empty so the renderer keeps its default", () => {
    expect(normalizeLightRig(new Float32Array(0))).toHaveLength(0);
    expect(lightCount(new Float32Array(0))).toBe(0);
  });

  it("rejects a partial record rather than reading a truncated light", () => {
    expect(() => normalizeLightRig(new Float32Array(20))).toThrow(
      /multiple of/,
    );
  });
});
