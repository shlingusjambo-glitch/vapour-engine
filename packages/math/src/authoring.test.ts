import { describe, expect, it } from "vitest";
import {
  constantCurve, cubicBezierEasing, curve, curveDuration, curveRange, EASING_NAMES, easing,
  evaluateCurve, evaluateGradient, gradient, gradientBetween, isEasingName, linearCurve,
  linearToSrgb, luminance, premultiply, rgbaFromHex, rgbaFromHsv, rgbaToHex, sampleCurve,
  sampleGradient, srgbToLinear,
} from "./index.js";

describe("easing", () => {
  it("maps the unit interval to itself for every named easing", () => {
    for (const name of EASING_NAMES) {
      const fn = easing(name);
      expect(fn(0)).toBeCloseTo(0, 6);
      expect(fn(1)).toBeCloseTo(1, 6);
    }
  });

  it("clamps input so an overshooting tween cannot escape the curve", () => {
    expect(easing("linear")(2)).toBe(1);
    expect(easing("linear")(-1)).toBe(0);
  });

  it("recognises and rejects easing names", () => {
    expect(isEasingName("outCubic")).toBe(true);
    expect(isEasingName("nope")).toBe(false);
    expect(() => easing("nope" as never)).toThrow(/Unknown easing/);
  });

  it("solves a cubic bezier easing", () => {
    const ease = cubicBezierEasing(0.42, 0, 0.58, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 3);
    // Ease-in-out starts slower than linear.
    expect(ease(0.25)).toBeLessThan(0.25);
    expect(() => cubicBezierEasing(1.5, 0, 0.5, 1)).toThrow(/\[0, 1\]/);
  });
});

describe("curves", () => {
  it("requires keys and rejects duplicate times", () => {
    expect(() => curve([])).toThrow(/at least one key/);
    expect(() => curve([{ time: 0, value: 0 }, { time: 0, value: 1 }])).toThrow(/two keys at time/);
  });

  it("sorts keys and interpolates linearly", () => {
    const value = curve([{ time: 1, value: 10 }, { time: 0, value: 0 }]);
    expect(value.keys[0]!.time).toBe(0);
    expect(evaluateCurve(value, 0.5)).toBeCloseTo(5);
  });

  it("holds a constant curve at every time", () => {
    const value = constantCurve(7);
    expect(evaluateCurve(value, -100)).toBe(7);
    expect(evaluateCurve(value, 100)).toBe(7);
    expect(curveDuration(value)).toBe(0);
  });

  it("clamps, loops, and ping-pongs outside the key range", () => {
    const keys = [{ time: 0, value: 0 }, { time: 1, value: 10 }];
    expect(evaluateCurve(curve(keys), 2)).toBe(10);
    expect(evaluateCurve(curve(keys, { postWrap: "loop" }), 1.5)).toBeCloseTo(5);
    expect(evaluateCurve(curve(keys, { postWrap: "pingPong" }), 1.5)).toBeCloseTo(5);
    expect(evaluateCurve(curve(keys, { preWrap: "loop" }), -0.25)).toBeCloseTo(7.5);
  });

  it("steps rather than blends when interpolation is constant", () => {
    const value = curve([{ time: 0, value: 0 }, { time: 1, value: 10 }], { interpolation: "constant" });
    expect(evaluateCurve(value, 0.99)).toBe(0);
    expect(evaluateCurve(value, 1)).toBe(10);
  });

  it("matches linear interpolation when a cubic curve has no tangents", () => {
    const keys = [{ time: 0, value: 0 }, { time: 2, value: 10 }];
    expect(evaluateCurve(curve(keys, { interpolation: "cubic" }), 1)).toBeCloseTo(evaluateCurve(curve(keys), 1));
  });

  it("flattens with zero tangents, producing an ease-in-out", () => {
    const value = curve([
      { time: 0, value: 0, outTangent: 0 },
      { time: 1, value: 10, inTangent: 0 },
    ], { interpolation: "cubic" });
    expect(evaluateCurve(value, 0.5)).toBeCloseTo(5);
    expect(evaluateCurve(value, 0.1)).toBeLessThan(1);
  });

  it("samples into a table and reports its range", () => {
    const value = linearCurve(0, 10);
    const samples = sampleCurve(value, 11);
    expect(samples).toHaveLength(11);
    expect(samples[5]).toBeCloseTo(5);
    expect(curveRange(value)).toEqual([0, 10]);
    expect(() => sampleCurve(value, 1)).toThrow(/at least two/);
  });

  it("rejects a non-finite evaluation time", () => {
    expect(() => evaluateCurve(linearCurve(0, 1), Number.NaN)).toThrow(/finite time/);
  });
});

describe("colour and gradients", () => {
  it("parses every hex form", () => {
    expect(rgbaFromHex("#fff")).toEqual([1, 1, 1, 1]);
    expect(rgbaFromHex("#ffffff")).toEqual([1, 1, 1, 1]);
    expect(rgbaFromHex("#00000080")[3]).toBeCloseTo(128 / 255);
    expect(rgbaFromHex("#0008")[3]).toBeCloseTo(136 / 255);
    expect(() => rgbaFromHex("#12345")).toThrow(/hex colour/);
    expect(rgbaToHex([1, 0, 0, 1])).toBe("#ff0000");
    expect(rgbaToHex([1, 0, 0, 1], true)).toBe("#ff0000ff");
  });

  it("round-trips sRGB and linear without touching alpha", () => {
    const authored = rgbaFromHex("#3a7bd5cc");
    const round = linearToSrgb(srgbToLinear(authored));
    expect(round[0]).toBeCloseTo(authored[0], 6);
    expect(round[3]).toBe(authored[3]);
    // Mid grey is much darker in linear space; that gap is the whole point.
    expect(srgbToLinear([0.5, 0.5, 0.5, 1])[0]).toBeLessThan(0.25);
  });

  it("premultiplies and measures luminance", () => {
    expect(premultiply([1, 1, 1, 0.5])).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(luminance([0, 1, 0, 1])).toBeCloseTo(0.7152);
  });

  it("converts HSV to sRGB across every sector", () => {
    expect(rgbaFromHsv(0, 1, 1)).toEqual([1, 0, 0, 1]);
    expect(rgbaFromHsv(120, 1, 1)).toEqual([0, 1, 0, 1]);
    expect(rgbaFromHsv(240, 1, 1)).toEqual([0, 0, 1, 1]);
    expect(rgbaFromHsv(-120, 1, 1)).toEqual([0, 0, 1, 1]);
    expect(rgbaFromHsv(0, 0, 0.5)[0]).toBeCloseTo(0.5);
  });

  it("blends colour and alpha on independent schedules", () => {
    const value = gradient(
      [{ time: 0, color: [1, 0, 0] }, { time: 1, color: [0, 0, 1] }],
      [{ time: 0, alpha: 1 }, { time: 0.5, alpha: 0 }],
    );
    const middle = evaluateGradient(value, 0.5);
    expect(middle[0]).toBeCloseTo(0.5);
    expect(middle[2]).toBeCloseTo(0.5);
    expect(middle[3]).toBeCloseTo(0);
    // Past the last alpha key the value holds.
    expect(evaluateGradient(value, 1)[3]).toBe(0);
  });

  it("steps between keys in fixed mode", () => {
    const value = gradient(
      [{ time: 0, color: [1, 0, 0] }, { time: 0.5, color: [0, 1, 0] }],
      [{ time: 0, alpha: 1 }],
      "fixed",
    );
    expect(evaluateGradient(value, 0.49)[0]).toBe(1);
    expect(evaluateGradient(value, 0.51)[1]).toBe(1);
  });

  it("bakes into an RGBA8 lookup strip", () => {
    const strip = sampleGradient(gradientBetween([0, 0, 0, 1], [1, 1, 1, 1]), 3);
    expect(strip).toHaveLength(12);
    expect(strip[0]).toBe(0);
    expect(strip[8]).toBe(255);
    expect(() => sampleGradient(gradientBetween([0, 0, 0, 1], [1, 1, 1, 1]), 1)).toThrow(/at least two/);
  });

  it("rejects gradient key times outside [0, 1]", () => {
    expect(() => gradient([{ time: 2, color: [0, 0, 0] }])).toThrow(/\[0, 1\]/);
    expect(() => gradient([])).toThrow(/at least one/);
  });
});
