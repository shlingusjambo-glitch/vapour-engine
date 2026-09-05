import { describe, expect, it } from "vitest";
import {
  angleBetweenQuat, compose, decompose, equalsMat4, equalsQuat, equalsVec3, eulerFromQuat, fromQuat,
  identity, invert, invertQuat, lookAt, multiplyMat4, multiplyQuat, nlerp, normalMatrix, orthographic,
  perspective, QUAT_IDENTITY, quatFromAxisAngle, quatFromEuler, quatFromTo, quatLookRotation,
  rotateTowards, rotateVector, slerp, transformDirection, transformPoint, transpose, VEC3_FORWARD,
} from "./index.js";

describe("quaternions", () => {
  it("round-trips euler angles through the inspector's Y-X-Z order", () => {
    for (const euler of [[0, 0, 0], [30, 45, 60], [-15, 170, 5]]) {
      const round = eulerFromQuat(quatFromEuler(euler));
      expect(equalsQuat(quatFromEuler(round), quatFromEuler(euler), 1e-6)).toBe(true);
    }
  });

  it("rejects the zero quaternion rather than producing NaN", () => {
    expect(() => multiplyQuat([0, 0, 0, 0], QUAT_IDENTITY)).toThrow(/zero quaternion/);
    expect(() => quatFromAxisAngle([0, 0, 0], 1)).toThrow(/zero-length/);
  });

  it("rotates vectors consistently with its matrix form", () => {
    const rotation = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
    const direct = rotateVector(rotation, [0, 0, -1]);
    const viaMatrix = transformDirection(fromQuat(rotation), [0, 0, -1]);
    expect(equalsVec3(direct, viaMatrix, 1e-9)).toBe(true);
    expect(equalsVec3(direct, [-1, 0, 0], 1e-9)).toBe(true);
  });

  it("composes and inverts back to identity", () => {
    const rotation = quatFromEuler([25, 40, -10]);
    expect(equalsQuat(multiplyQuat(rotation, invertQuat(rotation)), QUAT_IDENTITY)).toBe(true);
  });

  it("slerps and nlerps along the short arc", () => {
    const from = QUAT_IDENTITY;
    const to = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
    expect(angleBetweenQuat(slerp(from, to, 0.5), from)).toBeCloseTo(Math.PI / 4, 5);
    // nlerp is close to slerp for a modest arc, which is why blending uses it.
    expect(angleBetweenQuat(nlerp(from, to, 0.5), slerp(from, to, 0.5))).toBeLessThan(0.02);
  });

  it("slerps the short way even when the inputs face opposite hemispheres", () => {
    const to = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
    const negated = to.map((component) => -component);
    expect(equalsQuat(slerp(QUAT_IDENTITY, negated, 0.5), slerp(QUAT_IDENTITY, to, 0.5))).toBe(true);
  });

  it("builds the rotation between two directions, including the opposite case", () => {
    const rotation = quatFromTo([1, 0, 0], [0, 1, 0]);
    expect(equalsVec3(rotateVector(rotation, [1, 0, 0]), [0, 1, 0], 1e-6)).toBe(true);
    const flip = quatFromTo([1, 0, 0], [-1, 0, 0]);
    expect(equalsVec3(rotateVector(flip, [1, 0, 0]), [-1, 0, 0], 1e-6)).toBe(true);
  });

  it("aims -Z along the requested forward direction", () => {
    const rotation = quatLookRotation([1, 0, 0]);
    expect(equalsVec3(rotateVector(rotation, VEC3_FORWARD), [1, 0, 0], 1e-6)).toBe(true);
  });

  it("falls back to a world axis when the look direction is parallel to up", () => {
    const rotation = quatLookRotation([0, 1, 0]);
    expect(equalsVec3(rotateVector(rotation, VEC3_FORWARD), [0, 1, 0], 1e-6)).toBe(true);
  });

  it("steps toward a target orientation by a bounded angle", () => {
    const target = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
    const stepped = rotateTowards(QUAT_IDENTITY, target, 0.1);
    expect(angleBetweenQuat(QUAT_IDENTITY, stepped)).toBeCloseTo(0.1, 5);
    expect(equalsQuat(rotateTowards(QUAT_IDENTITY, target, 10), target)).toBe(true);
  });
});

describe("matrices", () => {
  it("multiplies applying the right operand first", () => {
    const translate = compose([1, 0, 0], QUAT_IDENTITY, [1, 1, 1]);
    const scale = compose([0, 0, 0], QUAT_IDENTITY, [2, 2, 2]);
    // translate * scale scales first, then translates.
    expect(equalsVec3(transformPoint(multiplyMat4(translate, scale), [1, 0, 0]), [3, 0, 0])).toBe(true);
  });

  it("round-trips compose and decompose", () => {
    const translation = [3, -2, 7];
    const rotation = quatFromEuler([20, -35, 12]);
    const scale = [2, 0.5, 3];
    const parts = decompose(compose(translation, rotation, scale));
    expect(equalsVec3(parts.translation, translation, 1e-9)).toBe(true);
    expect(equalsQuat(parts.rotation, rotation, 1e-6)).toBe(true);
    expect(equalsVec3(parts.scale, scale, 1e-9)).toBe(true);
  });

  it("absorbs a mirroring transform into a negative X scale so the round trip holds", () => {
    const mirrored = compose([0, 0, 0], QUAT_IDENTITY, [-1, 1, 1]);
    const parts = decompose(mirrored);
    expect(equalsMat4(compose(parts.translation, parts.rotation, parts.scale), mirrored, 1e-9)).toBe(true);
  });

  it("refuses to decompose or invert a degenerate matrix", () => {
    expect(() => decompose(compose([0, 0, 0], QUAT_IDENTITY, [0, 1, 1]))).toThrow(/zero-scale/);
    expect(() => invert(new Array<number>(16).fill(0))).toThrow(/singular/);
  });

  it("inverts back to identity", () => {
    const matrix = compose([1, 2, 3], quatFromEuler([10, 20, 30]), [1, 2, 3]);
    expect(equalsMat4(multiplyMat4(matrix, invert(matrix)), identity(), 1e-9)).toBe(true);
  });

  it("keeps normals perpendicular under non-uniform scale", () => {
    const matrix = compose([0, 0, 0], QUAT_IDENTITY, [1, 4, 1]);
    // A 45-degree surface normal must stay perpendicular to the scaled surface.
    const tangent = transformDirection(matrix, [1, 1, 0]);
    const normals = normalMatrix(matrix);
    const normal = [
      normals[0]! * 1 + normals[3]! * -1 + normals[6]! * 0,
      normals[1]! * 1 + normals[4]! * -1 + normals[7]! * 0,
      normals[2]! * 1 + normals[5]! * -1 + normals[8]! * 0,
    ];
    expect(tangent[0]! * normal[0]! + tangent[1]! * normal[1]! + tangent[2]! * normal[2]!).toBeCloseTo(0, 9);
  });

  it("transposes symmetrically", () => {
    const matrix = compose([1, 2, 3], quatFromEuler([5, 10, 15]), [1, 1, 1]);
    expect(equalsMat4(transpose(transpose(matrix)), matrix, 1e-12)).toBe(true);
  });

  it("builds a view matrix that puts the target on -Z", () => {
    const view = lookAt([0, 0, 5], [0, 0, 0]);
    expect(equalsVec3(transformPoint(view, [0, 0, 0]), [0, 0, -5], 1e-9)).toBe(true);
  });

  it("projects into WebGPU's [0, 1] depth range", () => {
    const projection = perspective(60, 1, 0.1, 100);
    // A point on the near plane maps to depth 0, the far plane to depth 1.
    expect(transformPoint(projection, [0, 0, -0.1])[2]).toBeCloseTo(0, 6);
    expect(transformPoint(projection, [0, 0, -100])[2]).toBeCloseTo(1, 6);
    const ortho = orthographic(2, 1, 0.1, 100);
    expect(transformPoint(ortho, [0, 0, -0.1])[2]).toBeCloseTo(0, 6);
    expect(transformPoint(ortho, [0, 0, -100])[2]).toBeCloseTo(1, 6);
  });

  it("validates projection parameters instead of emitting a broken matrix", () => {
    expect(() => perspective(0, 1, 0.1, 100)).toThrow(/Field of view/);
    expect(() => perspective(60, 0, 0.1, 100)).toThrow(/Aspect ratio/);
    expect(() => perspective(60, 1, 0, 100)).toThrow(/near < far/);
    expect(() => orthographic(2, 1, 100, 1)).toThrow(/near < far/);
  });
});
