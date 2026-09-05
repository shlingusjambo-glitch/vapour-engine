import { describe, expect, it } from "vitest";
import {
  approximately, clamp, deltaAngle, inverseLerp, isPowerOfTwo, lerp, lerpAngle, moveTowards,
  nextPowerOfTwo, pingPong, remap, repeat, round, saturate, smoothDamp, smootherStep, smoothStep, wrapAngle,
} from "./index.js";

describe("scalar", () => {
  it("clamps and rejects an inverted range", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(() => clamp(0, 1, 0)).toThrow(/minimum <= maximum/);
  });

  it("interpolates without clamping unless asked", () => {
    expect(lerp(0, 10, 1.5)).toBe(15);
    expect(saturate(1.5)).toBe(1);
    expect(inverseLerp(10, 20, 15)).toBeCloseTo(0.5);
    expect(remap(15, 10, 20, 0, 100)).toBeCloseTo(50);
  });

  it("returns zero from inverseLerp on a degenerate range instead of dividing by zero", () => {
    expect(inverseLerp(5, 5, 7)).toBe(0);
  });

  it("smoothsteps with zero derivative at both edges", () => {
    expect(smoothStep(0, 1, 0)).toBe(0);
    expect(smoothStep(0, 1, 1)).toBe(1);
    expect(smoothStep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smootherStep(0, 1, 0.5)).toBeCloseTo(0.5);
  });

  it("moves toward a target without overshooting", () => {
    expect(moveTowards(0, 10, 3)).toBe(3);
    expect(moveTowards(0, 2, 3)).toBe(2);
    expect(moveTowards(10, 0, 3)).toBe(7);
    expect(() => moveTowards(0, 1, -1)).toThrow(/non-negative/);
  });

  it("repeats and ping-pongs with the sign of the length", () => {
    expect(repeat(-1, 4)).toBe(3);
    expect(repeat(9, 4)).toBe(1);
    expect(pingPong(5, 4)).toBe(3);
    expect(pingPong(9, 4)).toBe(1);
  });

  it("wraps angles into (-PI, PI]", () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(deltaAngle(Math.PI * 0.9, -Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2);
  });

  it("lerps angles the short way around", () => {
    const result = lerpAngle(Math.PI * 0.9, -Math.PI * 0.9, 0.5);
    expect(Math.abs(result)).toBeCloseTo(Math.PI);
  });

  it("compares with a relative tolerance", () => {
    expect(approximately(1, 1 + 1e-9)).toBe(true);
    expect(approximately(1, 1.1)).toBe(false);
  });

  it("rounds away negative zero so serialized scenes diff cleanly", () => {
    expect(Object.is(round(-0.0000001), 0)).toBe(true);
  });

  it("computes powers of two", () => {
    expect(nextPowerOfTwo(17)).toBe(32);
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(isPowerOfTwo(64)).toBe(true);
    expect(isPowerOfTwo(63)).toBe(false);
  });

  it("converges smoothDamp on the target without overshooting", () => {
    const state = { velocity: 0 };
    let value = 0;
    for (let step = 0; step < 200; step += 1) value = smoothDamp(value, 10, state, 0.2, 1 / 60);
    expect(value).toBeCloseTo(10, 3);
    expect(value).toBeLessThanOrEqual(10.0001);
  });

  it("snaps to the target when smoothTime is zero", () => {
    const state = { velocity: 0 };
    expect(smoothDamp(0, 5, state, 0, 1 / 60)).toBe(5);
  });
});
