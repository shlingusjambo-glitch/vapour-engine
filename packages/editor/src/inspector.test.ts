import { describe, expect, it } from "vitest";
import { hexToLinear, linearToHex } from "./inspector.js";

describe("colour conversion between material data and the picker", () => {
  it("round-trips a colour through sRGB and back", () => {
    for (const hex of ["#000000", "#ffffff", "#d97757", "#3d7fff", "#0a0a0a"]) {
      expect(linearToHex(hexToLinear(hex))).toBe(hex);
    }
  });

  it("treats stored values as linear, not sRGB", () => {
    // Linear 0.5 is mid-grey in light, but sRGB ~0.735 on screen: a renderer
    // that skipped this conversion would show every material too dark.
    expect(linearToHex([0.5, 0.5, 0.5])).toBe("#bcbcbc");
    expect(hexToLinear("#808080")[0]).toBeCloseTo(0.2158, 3);
  });

  it("clamps out-of-range channels instead of emitting invalid hex", () => {
    expect(linearToHex([2, -1, 0])).toBe("#ff0000");
    expect(linearToHex([])).toBe("#000000");
  });

  it("accepts hex with or without a leading hash and rejects nonsense", () => {
    expect(hexToLinear("ffffff")).toEqual([1, 1, 1]);
    expect(() => hexToLinear("#fff")).toThrow(/six-digit/);
    expect(() => hexToLinear("not a colour")).toThrow(/six-digit/);
  });

  it("keeps the engine's default base colour stable through the picker", () => {
    // The MeshRenderer default must survive being displayed and re-read, or
    // simply opening the inspector would silently shift every material.
    const [r, g, b] = hexToLinear(linearToHex([0.24, 0.48, 1]));
    expect(r).toBeCloseTo(0.24, 2);
    expect(g).toBeCloseTo(0.48, 2);
    expect(b).toBeCloseTo(1, 2);
  });
});
