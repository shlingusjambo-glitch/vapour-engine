import { describe, expect, it } from "vitest";
import {
  eulerFromQuaternion,
  inverseTransformDirection,
  invertQuaternion,
  multiplyQuaternions,
  normalizeQuaternion,
  quaternionFromAxisAngle,
  quaternionFromEuler,
  quaternionFromMatrix,
  rotateVector,
  roundAngle,
} from "./rotation.js";

function rotate(quaternion: readonly number[], vector: readonly [number, number, number]): [number, number, number] {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = vector;
  // v + 2 * cross(q.xyz, cross(q.xyz, v) + w * v)
  const tx = 2 * (y! * vz - z! * vy);
  const ty = 2 * (z! * vx - x! * vz);
  const tz = 2 * (x! * vy - y! * vx);
  return [
    vx + w! * tx + (y! * tz - z! * ty),
    vy + w! * ty + (z! * tx - x! * tz),
    vz + w! * tz + (x! * ty - y! * tx),
  ];
}

describe("euler and quaternion conversion", () => {
  it("round-trips representative orientations", () => {
    const cases: [number, number, number][] = [
      [0, 0, 0],
      [30, 0, 0],
      [0, 45, 0],
      [0, 0, 90],
      [15, -60, 33],
      [-80, 170, -25],
    ];
    for (const euler of cases) {
      const roundTripped = eulerFromQuaternion(quaternionFromEuler(euler));
      for (let axis = 0; axis < 3; axis += 1) {
        expect(roundTripped[axis]).toBeCloseTo(euler[axis]!, 3);
      }
    }
  });

  it("treats identity as zero degrees", () => {
    expect(eulerFromQuaternion([0, 0, 0, 1])).toEqual([0, 0, 0]);
    expect(quaternionFromEuler([0, 0, 0])).toEqual([0, 0, 0, 1]);
  });

  it("yaws around world +Y in the expected direction", () => {
    const rotated = rotate(quaternionFromEuler([0, 90, 0]), [0, 0, -1]);
    expect(rotated[0]).toBeCloseTo(-1, 5);
    expect(rotated[1]).toBeCloseTo(0, 5);
    expect(rotated[2]).toBeCloseTo(0, 5);
  });

  it("pitches around the local X axis", () => {
    const rotated = rotate(quaternionFromEuler([-90, 0, 0]), [0, 0, -1]);
    expect(rotated[1]).toBeCloseTo(-1, 5);
  });

  it("produces unit quaternions for every input", () => {
    for (let angle = -360; angle <= 360; angle += 37) {
      const quaternion = quaternionFromEuler([angle, angle / 2, -angle]);
      expect(Math.hypot(...quaternion)).toBeCloseTo(1, 6);
    }
  });

  it("degrades gracefully at the gimbal-lock pole", () => {
    const euler = eulerFromQuaternion(quaternionFromEuler([90, 40, 0]));
    expect(euler.every((angle) => Number.isFinite(angle))).toBe(true);
    expect(euler[0]).toBeCloseTo(90, 2);
    // Straight up: yaw absorbs the roll and the result stays a valid rotation.
    const restored = quaternionFromEuler(euler);
    expect(Math.hypot(...restored)).toBeCloseTo(1, 6);
  });

  it("rejects unusable rotation data instead of emitting NaN", () => {
    expect(() => normalizeQuaternion([0, 0, 0, 0])).toThrow(/zero quaternion/);
    expect(() => normalizeQuaternion([1, 2, 3])).toThrow(/four finite components/);
    expect(() => quaternionFromEuler([Number.NaN, 0, 0])).toThrow(/finite/);
  });

  it("rounds display angles without producing negative zero", () => {
    expect(roundAngle(-0.0000001)).toBe(0);
    expect(Object.is(roundAngle(-0.0000001), -0)).toBe(false);
    expect(roundAngle(12.34567)).toBe(12.346);
  });
});

describe("quaternion algebra for gizmo edits", () => {
  it("composes rotations in apply-b-then-a order", () => {
    const yaw90 = quaternionFromAxisAngle([0, 1, 0], Math.PI / 2);
    const combined = multiplyQuaternions(yaw90, yaw90);
    const rotated = rotateVector(combined, [0, 0, -1]);
    expect(rotated[2]).toBeCloseTo(1, 5);
  });

  it("cancels a rotation with its inverse", () => {
    const rotation = quaternionFromEuler([25, -70, 15]);
    const identity = multiplyQuaternions(rotation, invertQuaternion(rotation));
    expect(identity[3]).toBeCloseTo(1, 6);
    expect(Math.hypot(identity[0], identity[1], identity[2])).toBeCloseTo(0, 6);
  });

  it("builds axis-angle rotations that leave the axis fixed", () => {
    const axis: [number, number, number] = [0.3, 0.9, -0.2];
    const rotation = quaternionFromAxisAngle(axis, 1.1);
    const rotated = rotateVector(rotation, axis);
    for (let component = 0; component < 3; component += 1) {
      expect(rotated[component]!).toBeCloseTo(axis[component]!, 5);
    }
  });

  it("rejects a zero axis or non-finite angle", () => {
    expect(() => quaternionFromAxisAngle([0, 0, 0], 1)).toThrow(/zero length/);
    expect(() => quaternionFromAxisAngle([0, 1, 0], Number.NaN)).toThrow(/finite/);
  });

  it("recovers a rotation from a scaled transform basis", () => {
    const rotation = quaternionFromEuler([12, 48, -33]);
    const columns = [
      rotateVector(rotation, [3, 0, 0]),
      rotateVector(rotation, [0, 3, 0]),
      rotateVector(rotation, [0, 0, 3]),
    ];
    const matrix = [
      ...columns[0]!, 0,
      ...columns[1]!, 0,
      ...columns[2]!, 0,
      5, 6, 7, 1,
    ];
    const recovered = quaternionFromMatrix(matrix);
    const sample: [number, number, number] = [0.2, -0.7, 0.4];
    const expected = rotateVector(rotation, sample);
    const actual = rotateVector(recovered, sample);
    for (let component = 0; component < 3; component += 1) {
      expect(actual[component]!).toBeCloseTo(expected[component]!, 5);
    }
  });

  it("recovers rotations at every branch of the trace decomposition", () => {
    for (const euler of [[0, 0, 0], [180, 0, 0], [0, 180, 0], [0, 0, 180], [90, 90, 0]] as [number, number, number][]) {
      const rotation = quaternionFromEuler(euler);
      const matrix = [
        ...rotateVector(rotation, [1, 0, 0]), 0,
        ...rotateVector(rotation, [0, 1, 0]), 0,
        ...rotateVector(rotation, [0, 0, 1]), 0,
        0, 0, 0, 1,
      ];
      const sample: [number, number, number] = [0.4, 0.5, -0.6];
      const expected = rotateVector(rotation, sample);
      const actual = rotateVector(quaternionFromMatrix(matrix), sample);
      for (let component = 0; component < 3; component += 1) {
        expect(actual[component]!).toBeCloseTo(expected[component]!, 4);
      }
    }
  });

  it("brings a world direction back into a scaled parent's space", () => {
    const parent = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 0, 0, 1];
    expect(inverseTransformDirection(parent, [2, 0, 0])).toEqual([1, 0, 0]);
    expect(() => inverseTransformDirection(new Array(16).fill(0), [1, 0, 0])).toThrow(/zero scale/);
  });
});
