import { describe, expect, it } from "vitest";
import {
  add, angleBetween, clampLength, cross, distance, dot, equalsVec2, equalsVec3, length, lerpVec3,
  normalize, normalize2, normalizeOr, orthogonal, project, projectOnPlane, reflect, rotate2, scale,
  signedAngle2, subtract, toVec3, VEC3_FORWARD, VEC3_UP, cross2, perpendicular2, normalize4, lerpVec4,
} from "./index.js";

describe("vec3", () => {
  it("performs component-wise arithmetic", () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(subtract([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });

  it("measures length and distance", () => {
    expect(length([3, 4, 0])).toBe(5);
    expect(distance([0, 0, 0], [0, 3, 4])).toBe(5);
  });

  it("rejects a zero-length normalize but allows an explicit fallback", () => {
    expect(() => normalize([0, 0, 0])).toThrow(/zero-length/);
    expect(normalizeOr([0, 0, 0])).toEqual(VEC3_FORWARD);
    expect(normalize([0, 5, 0])).toEqual([0, 1, 0]);
  });

  it("validates input shape and finiteness", () => {
    expect(() => toVec3([1, 2])).toThrow(/three components/);
    expect(() => toVec3([1, 2, Number.NaN])).toThrow(/finite/);
  });

  it("clamps magnitude without changing direction", () => {
    const clamped = clampLength([0, 10, 0], 4);
    expect(clamped).toEqual([0, 4, 0]);
    expect(clampLength([0, 1, 0], 4)).toEqual([0, 1, 0]);
  });

  it("projects onto vectors and planes", () => {
    expect(project([3, 4, 0], [1, 0, 0])).toEqual([3, 0, 0]);
    expect(projectOnPlane([3, 4, 0], [1, 0, 0])).toEqual([0, 4, 0]);
    expect(() => project([1, 1, 1], [0, 0, 0])).toThrow(/zero-length/);
  });

  it("reflects about a surface normal", () => {
    expect(reflect([1, -1, 0], VEC3_UP)).toEqual([1, 1, 0]);
  });

  it("measures the unsigned angle between directions", () => {
    expect(angleBetween([1, 0, 0], [0, 1, 0])).toBeCloseTo(Math.PI / 2);
    expect(angleBetween([1, 0, 0], [-1, 0, 0])).toBeCloseTo(Math.PI);
  });

  it("builds a perpendicular unit vector for any input", () => {
    for (const input of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]]) {
      const perpendicular = orthogonal(input);
      expect(length(perpendicular)).toBeCloseTo(1);
      expect(dot(perpendicular, normalize(input))).toBeCloseTo(0);
    }
  });

  it("interpolates and compares with tolerance", () => {
    expect(lerpVec3([0, 0, 0], [10, 10, 10], 0.5)).toEqual([5, 5, 5]);
    expect(equalsVec3([1, 1, 1], [1, 1, 1 + 1e-9])).toBe(true);
  });
});

describe("vec2 and vec4", () => {
  it("rotates and finds perpendiculars in 2D", () => {
    const rotated = rotate2([1, 0], Math.PI / 2);
    expect(equalsVec2(rotated, [0, 1], 1e-9)).toBe(true);
    expect(equalsVec2(perpendicular2([1, 0]), [0, 1])).toBe(true);
    expect(cross2([1, 0], [0, 1])).toBe(1);
  });

  it("reports signed 2D angles", () => {
    expect(signedAngle2([1, 0], [0, 1])).toBeCloseTo(Math.PI / 2);
    expect(signedAngle2([0, 1], [1, 0])).toBeCloseTo(-Math.PI / 2);
  });

  it("normalizes 2D and 4D vectors", () => {
    expect(normalize2([0, 3])).toEqual([0, 1]);
    expect(normalize4([0, 0, 0, 2])).toEqual([0, 0, 0, 1]);
    expect(lerpVec4([0, 0, 0, 0], [2, 2, 2, 2], 0.5)).toEqual([1, 1, 1, 1]);
  });
});
