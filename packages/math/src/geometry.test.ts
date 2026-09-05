import { describe, expect, it } from "vitest";
import {
  aabb, aabbCenter, aabbContainsPoint, aabbFromPoints, aabbIntersects, closestPointOnAabb, compose,
  emptyAabb, equalsVec3, expandAabb, frustumContainsPoint, frustumFromViewProjection,
  frustumIntersectsAabb, frustumIntersectsSphere, isEmptyAabb, lookAt, multiplyMat4, perspective,
  plane, planeDistanceToPoint, planeFromPointNormal, QUAT_IDENTITY, ray, rayIntersectsAabb,
  rayIntersectsPlane, rayIntersectsSphere, rayPoint, sphere, sphereFromAabb, sphereIntersects,
  sphereIntersectsAabb, transformAabb, unionAabb,
} from "./index.js";

describe("bounding volumes", () => {
  it("rejects an inverted box but allows the sentinel empty box", () => {
    expect(() => aabb([1, 1, 1], [0, 0, 0])).toThrow(/min <= max/);
    expect(isEmptyAabb(emptyAabb())).toBe(true);
  });

  it("grows from points and unions", () => {
    const box = aabbFromPoints([[0, 0, 0], [1, 2, 3], [-1, 0, 1]]);
    expect(box.min).toEqual([-1, 0, 0]);
    expect(box.max).toEqual([1, 2, 3]);
    expect(unionAabb(emptyAabb(), box)).toEqual(box);
    expect(expandAabb(box, [5, 5, 5]).max).toEqual([5, 5, 5]);
  });

  it("tests containment and overlap", () => {
    const box = aabb([0, 0, 0], [1, 1, 1]);
    expect(aabbContainsPoint(box, [0.5, 0.5, 0.5])).toBe(true);
    expect(aabbContainsPoint(box, [1.5, 0.5, 0.5])).toBe(false);
    expect(aabbIntersects(box, aabb([0.5, 0.5, 0.5], [2, 2, 2]))).toBe(true);
    expect(aabbIntersects(box, aabb([2, 2, 2], [3, 3, 3]))).toBe(false);
    expect(closestPointOnAabb(box, [5, -5, 0.5])).toEqual([1, 0, 0.5]);
  });

  it("transforms a box conservatively through a rotation", () => {
    const box = aabb([-1, -1, -1], [1, 1, 1]);
    const matrix = compose([10, 0, 0], QUAT_IDENTITY, [2, 2, 2]);
    const world = transformAabb(box, matrix);
    expect(equalsVec3(aabbCenter(world), [10, 0, 0], 1e-9)).toBe(true);
    expect(world.max[0]).toBeCloseTo(12);
  });

  it("overlaps spheres against spheres and boxes", () => {
    expect(sphereIntersects(sphere([0, 0, 0], 1), sphere([1.5, 0, 0], 1))).toBe(true);
    expect(sphereIntersects(sphere([0, 0, 0], 1), sphere([3, 0, 0], 1))).toBe(false);
    expect(sphereIntersectsAabb(sphere([2, 0, 0], 1.5), aabb([0, 0, 0], [1, 1, 1]))).toBe(true);
    expect(sphereIntersectsAabb(sphere([5, 0, 0], 1), aabb([0, 0, 0], [1, 1, 1]))).toBe(false);
    expect(sphereFromAabb(aabb([-1, -1, -1], [1, 1, 1])).radius).toBeCloseTo(Math.sqrt(3));
    expect(() => sphere([0, 0, 0], -1)).toThrow(/non-negative/);
  });
});

describe("planes and rays", () => {
  it("normalizes a plane and reports signed distance", () => {
    const p = plane([0, 5, 0], -10);
    expect(p.normal).toEqual([0, 1, 0]);
    expect(p.distance).toBe(-2);
    expect(planeDistanceToPoint(p, [0, 5, 0])).toBe(3);
    expect(planeDistanceToPoint(planeFromPointNormal([0, 2, 0], [0, 1, 0]), [0, 2, 0])).toBe(0);
    expect(() => plane([0, 0, 0], 1)).toThrow(/non-zero normal/);
  });

  it("normalizes a ray direction and walks along it", () => {
    const r = ray([0, 0, 0], [0, 10, 0]);
    expect(r.direction).toEqual([0, 1, 0]);
    expect(rayPoint(r, 3)).toEqual([0, 3, 0]);
    expect(() => ray([0, 0, 0], [0, 0, 0])).toThrow(/non-zero direction/);
  });

  it("intersects boxes, including from inside and parallel misses", () => {
    const box = aabb([-1, -1, -1], [1, 1, 1]);
    expect(rayIntersectsAabb(ray([0, 0, -5], [0, 0, 1]), box)).toBeCloseTo(4);
    expect(rayIntersectsAabb(ray([0, 0, 0], [0, 0, 1]), box)).toBe(0);
    expect(rayIntersectsAabb(ray([0, 0, 5], [0, 0, 1]), box)).toBeUndefined();
    // Parallel to the X slab and outside it.
    expect(rayIntersectsAabb(ray([5, 0, -5], [0, 0, 1]), box)).toBeUndefined();
  });

  it("intersects spheres and planes", () => {
    expect(rayIntersectsSphere(ray([0, 0, -5], [0, 0, 1]), sphere([0, 0, 0], 1))).toBeCloseTo(4);
    expect(rayIntersectsSphere(ray([0, 0, 5], [0, 0, 1]), sphere([0, 0, 0], 1))).toBeUndefined();
    expect(rayIntersectsSphere(ray([0, 0, 0], [0, 0, 1]), sphere([0, 0, 0], 1))).toBe(0);
    expect(rayIntersectsPlane(ray([0, 5, 0], [0, -1, 0]), planeFromPointNormal([0, 0, 0], [0, 1, 0]))).toBeCloseTo(5);
    // Parallel to the plane.
    expect(rayIntersectsPlane(ray([0, 5, 0], [1, 0, 0]), planeFromPointNormal([0, 0, 0], [0, 1, 0]))).toBeUndefined();
  });
});

describe("frustum culling", () => {
  const viewProjection = multiplyMat4(perspective(60, 16 / 9, 0.1, 100), lookAt([0, 0, 0], [0, 0, -1]));
  const frustum = frustumFromViewProjection(viewProjection);

  it("contains a point in front of the camera and rejects one behind it", () => {
    expect(frustumContainsPoint(frustum, [0, 0, -10])).toBe(true);
    expect(frustumContainsPoint(frustum, [0, 0, 10])).toBe(false);
    expect(frustumContainsPoint(frustum, [0, 0, -1000])).toBe(false);
  });

  it("keeps boxes that straddle a plane and rejects boxes fully outside", () => {
    expect(frustumIntersectsAabb(frustum, aabb([-1, -1, -11], [1, 1, -9]))).toBe(true);
    expect(frustumIntersectsAabb(frustum, aabb([-1, -1, 9], [1, 1, 11]))).toBe(false);
    // Straddling the near plane counts as visible.
    expect(frustumIntersectsAabb(frustum, aabb([-1, -1, -1], [1, 1, 1]))).toBe(true);
    // Far off to the side.
    expect(frustumIntersectsAabb(frustum, aabb([500, -1, -11], [502, 1, -9]))).toBe(false);
  });

  it("culls spheres by their radius", () => {
    expect(frustumIntersectsSphere(frustum, sphere([0, 0, -10], 1))).toBe(true);
    expect(frustumIntersectsSphere(frustum, sphere([0, 0, 10], 1))).toBe(false);
    // Centre is behind the near plane but the sphere still pokes into view.
    expect(frustumIntersectsSphere(frustum, sphere([0, 0, 0.5], 2))).toBe(true);
  });
});
