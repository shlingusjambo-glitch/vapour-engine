import { describe, expect, it } from "vitest";
import {
  HUMANOID_RAGDOLL_CONNECTIONS, addJointCommand, hingeJoint, ragdollJoints, validateJoint3d,
  type JointSpec3d,
} from "./physics-3d.js";

const fixed = (id = 1): JointSpec3d => ({
  id,
  bodyA: 1,
  bodyB: 2,
  joint: { kind: "fixed", anchorA: [0, 0, 0], anchorB: [0, 0, 0] },
});

describe("validateJoint3d", () => {
  it("accepts a well-formed joint", () => {
    expect(validateJoint3d(fixed())).toEqual(fixed());
  });

  it("names the joint and the field when something is wrong", () => {
    // The Rust side rejects these too, but its error arrives as an opaque
    // string from inside a command batch.
    expect(() => validateJoint3d({ ...fixed(), id: 0 })).toThrow(/joint id must be a positive whole number/);
    expect(() => validateJoint3d({ ...fixed(), bodyB: 1 })).toThrow(/Joint 1 cannot connect body 1 to itself/);
    expect(() => validateJoint3d({ ...fixed(), joint: { kind: "fixed", anchorA: [Number.NaN, 0, 0], anchorB: [0, 0, 0] } }))
      .toThrow(/Joint 1 has a non-finite anchorA/);
  });

  it("rejects a zero-length or non-finite axis", () => {
    const hinge = (axis: readonly [number, number, number]): JointSpec3d => ({
      ...fixed(),
      joint: { kind: "hinge", anchorA: [0, 0, 0], anchorB: [0, 0, 0], axis },
    });
    expect(() => validateJoint3d(hinge([0, 0, 0]))).toThrow(/zero-length axis/);
    expect(() => validateJoint3d(hinge([Number.NaN, 1, 0]))).toThrow(/non-finite axis/);
  });

  it("requires limits ordered as min, max", () => {
    expect(() =>
      validateJoint3d({ ...fixed(), joint: { kind: "hinge", anchorA: [0, 0, 0], anchorB: [0, 0, 0], axis: [0, 1, 0], limits: [1, -1] } }),
    ).toThrow(/limits \[1, -1\], which must be ordered as \[min, max\]/);
  });

  it("rejects a negative motor force", () => {
    expect(() =>
      validateJoint3d({ ...fixed(), joint: { kind: "slider", anchorA: [0, 0, 0], anchorB: [0, 0, 0], axis: [1, 0, 0], motor: [1, -5] } }),
    ).toThrow(/negative motor force/);
  });

  it("rejects negative spring parameters", () => {
    const spring = (changes: Partial<{ restLength: number; stiffness: number; damping: number }>): JointSpec3d => ({
      ...fixed(),
      joint: { kind: "spring", anchorA: [0, 0, 0], anchorB: [0, 0, 0], restLength: 1, stiffness: 1, damping: 1, ...changes },
    });
    expect(() => validateJoint3d(spring({ restLength: -1 }))).toThrow(/negative or non-finite restLength/);
    expect(() => validateJoint3d(spring({ stiffness: -1 }))).toThrow(/negative or non-finite stiffness/);
    expect(() => validateJoint3d(spring({ damping: Number.NaN }))).toThrow(/negative or non-finite damping/);
  });
});

describe("hingeJoint", () => {
  it("builds a door hinge with a default vertical axis", () => {
    const door = hingeJoint(1, 10, 11, { anchorA: [0, 0, 0], anchorB: [-0.5, 0, 0], limits: [0, Math.PI / 2] });
    expect(door.joint).toMatchObject({ kind: "hinge", axis: [0, 1, 0], limits: [0, Math.PI / 2] });
    expect(door.bodyA).toBe(10);
  });

  it("omits an unspecified motor rather than sending a default one", () => {
    expect(hingeJoint(1, 1, 2, { anchorA: [0, 0, 0], anchorB: [0, 0, 0] }).joint).not.toHaveProperty("motor");
  });

  it("validates as it builds", () => {
    expect(() => hingeJoint(1, 1, 1, { anchorA: [0, 0, 0], anchorB: [0, 0, 0] })).toThrow(/itself/);
    expect(() => hingeJoint(1, 1, 2, { anchorA: [0, 0, 0], anchorB: [0, 0, 0], axis: [0, 0, 0] })).toThrow(/zero-length axis/);
  });
});

describe("addJointCommand", () => {
  it("produces a validated command", () => {
    expect(addJointCommand(fixed())).toEqual({ type: "addJoint", spec: fixed() });
    expect(() => addJointCommand({ ...fixed(), id: -1 })).toThrow(/positive whole number/);
  });
});

describe("ragdollJoints", () => {
  const bodies = [
    { id: 1, bone: "Hips", position: [0, 1, 0] as const },
    { id: 2, bone: "Spine", position: [0, 1.3, 0] as const },
    { id: 3, bone: "Chest", position: [0, 1.5, 0] as const },
    { id: 4, bone: "Head", position: [0, 1.75, 0] as const },
    { id: 5, bone: "LeftUpperLeg", position: [0.1, 1, 0] as const },
  ];

  it("connects the bones it was given and skips the ones it was not", () => {
    const joints = ragdollJoints(bodies, HUMANOID_RAGDOLL_CONNECTIONS);
    // Only connections whose both ends exist become joints.
    expect(joints).toHaveLength(4);
    expect(joints.every((joint) => joint.joint.kind === "ball")).toBe(true);
    expect(new Set(joints.map((joint) => joint.id)).size).toBe(joints.length);
  });

  it("anchors each joint at the child's origin in both local spaces", () => {
    const [hipToSpine] = ragdollJoints(bodies, [["Hips", "Spine"]]);
    expect(hipToSpine!.joint.anchorB).toEqual([0, 0, 0]);
    // The parent's anchor is the offset from parent to child.
    expect(hipToSpine!.joint.anchorA[1]).toBeCloseTo(0.3, 6);
  });

  it("numbers joints from a chosen id, so a second ragdoll does not collide", () => {
    const first = ragdollJoints(bodies, HUMANOID_RAGDOLL_CONNECTIONS, 1);
    const second = ragdollJoints(bodies, HUMANOID_RAGDOLL_CONNECTIONS, 100);
    const overlap = new Set(first.map((joint) => joint.id));
    expect(second.some((joint) => overlap.has(joint.id))).toBe(false);
  });

  it("produces nothing from an empty body list", () => {
    expect(ragdollJoints([], HUMANOID_RAGDOLL_CONNECTIONS)).toEqual([]);
  });

  it("covers the standard humanoid skeleton", () => {
    const named = new Set(HUMANOID_RAGDOLL_CONNECTIONS.flat());
    for (const bone of ["Hips", "Spine", "Chest", "Head", "LeftHand", "RightFoot"]) {
      expect(named).toContain(bone);
    }
  });
});
