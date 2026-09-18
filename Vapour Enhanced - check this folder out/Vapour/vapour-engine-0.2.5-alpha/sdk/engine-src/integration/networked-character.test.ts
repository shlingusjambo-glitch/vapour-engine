import { describe, expect, it } from "vitest";
import { angleBetweenQuat, distance, lerpVec3, quatFromAxisAngle, slerp } from "@vapour/math";
import { Animator, type AnimationClip, type SkinnedSkeleton } from "../index.js";
import { NetworkedCharacter, type BodyReconciler, type NetworkedBodyState } from "./networked-character.js";

const skeleton: SkinnedSkeleton = {
  bones: [
    { name: "Root", parent: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    { name: "Spine", parent: 0, position: [0, 1, 0], rotation: [0, 0, 0, 1] },
  ],
};

/** One second of walking straight ahead (-Z) at 2 m/s. */
const walk: AnimationClip = {
  name: "walk",
  duration: 1,
  loop: "loop",
  channels: [{ target: "Root", property: "position", keyframes: [{ time: 0, value: [0, 0, 0] }, { time: 1, value: [0, 0, -2] }] }],
};

/**
 * `@vapour/engine` cannot import `@vapour/net`, so this is
 * `applyRigidBodyAuthority`'s contract (snap past 1 m or pi/4, else close 30 %
 * and take server velocities) restated with the same math helpers. In a game,
 * pass the real function.
 */
const reconcile: BodyReconciler = (local, authority) => {
  const snapped = distance(local.position, authority.position) > 1 || angleBetweenQuat(local.rotation, authority.rotation) > Math.PI / 4 || authority.sleeping;
  if (snapped) return { state: authority, snapped: true };
  return {
    snapped: false,
    state: {
      position: lerpVec3(local.position, authority.position, 0.3),
      rotation: slerp(local.rotation, authority.rotation, 0.3),
      linearVelocity: authority.linearVelocity,
      angularVelocity: authority.angularVelocity,
      sleeping: false,
    },
  };
};

const spawn: NetworkedBodyState = { position: [0, 0, 0], rotation: [0, 0, 0, 1], linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0], sleeping: false };

describe("NetworkedCharacter (M120)", () => {
  it("advances by the animator's root motion between snapshots, rotated into the rendered facing", () => {
    const animator = new Animator();
    animator.play(walk);
    // Facing +X: yaw of -90 degrees about Y maps -Z onto +X.
    const facing = quatFromAxisAngle([0, 1, 0], -Math.PI / 2);
    const character = new NetworkedCharacter({ ...spawn, rotation: facing }, { skeleton, reconcile });
    character.animate(animator.update(0));
    for (let frame = 0; frame < 30; frame += 1) character.animate(animator.update(1 / 60));
    expect(character.state.position[0]).toBeCloseTo(1, 5);
    expect(character.state.position[2]).toBeCloseTo(0, 5);
  });

  it("lets a small server disagreement correct the predicted pose without discarding root motion", () => {
    const animator = new Animator();
    animator.play(walk);
    const character = new NetworkedCharacter(spawn, { skeleton, reconcile });
    character.animate(animator.update(0));
    for (let frame = 0; frame < 15; frame += 1) character.animate(animator.update(1 / 60));
    expect(character.state.position[2]).toBeCloseTo(-0.5, 5);

    const result = character.reconcile({ ...spawn, position: [0, 0, -0.4], linearVelocity: [0, 0, -2] });
    expect(result.snapped).toBe(false);
    expect(result.error).toBeCloseTo(0.1, 5);
    expect(character.state.position[2]).toBeCloseTo(-0.47, 5);
    expect(character.state.linearVelocity).toEqual([0, 0, -2]);

    // Root motion keeps applying on top of the corrected pose.
    character.animate(animator.update(1 / 60));
    expect(character.state.position[2]).toBeCloseTo(-0.47 - 2 / 60, 5);
  });

  it("snaps to the server on a large error and restarts root motion from the snapped pose", () => {
    const animator = new Animator();
    animator.play(walk);
    const character = new NetworkedCharacter(spawn, { skeleton, reconcile });
    character.animate(animator.update(0));
    for (let frame = 0; frame < 30; frame += 1) character.animate(animator.update(1 / 60));

    const result = character.reconcile({ ...spawn, position: [5, 0, 5] });
    expect(result.snapped).toBe(true);
    expect(character.state.position).toEqual([5, 0, 5]);
    // The frame after a snap only re-anchors the pose; no stale delta lurches the character.
    expect(character.animate(animator.update(1 / 60))).toEqual([0, 0, 0]);
    expect(character.state.position).toEqual([5, 0, 5]);
    character.animate(animator.update(1 / 60));
    expect(character.state.position[2]).toBeCloseTo(5 - 2 / 60, 5);
  });

  it("ignores the backwards jump when a looping clip wraps", () => {
    const animator = new Animator();
    animator.play(walk);
    const character = new NetworkedCharacter(spawn, { skeleton, reconcile });
    character.animate(animator.update(0));
    for (let frame = 0; frame < 90; frame += 1) character.animate(animator.update(1 / 60));
    // 1.5 s of a 1 s loop: the 2 m snap back at the wrap must not undo the walk.
    expect(character.state.position[2]).toBeCloseTo(-3 + 2 / 60, 1);
  });

  it("puts the character to sleep where the server says, root motion notwithstanding", () => {
    const animator = new Animator();
    animator.play(walk);
    const character = new NetworkedCharacter(spawn, { skeleton, reconcile });
    character.animate(animator.update(0));
    character.animate(animator.update(0.25));
    const result = character.reconcile({ ...spawn, position: [0, 0, -0.5], sleeping: true });
    expect(result.snapped).toBe(true);
    expect(character.state.sleeping).toBe(true);
    expect(character.state.position).toEqual([0, 0, -0.5]);
  });
});
