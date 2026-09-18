import { describe, expect, it, vi } from "vitest";
import { XrArmLocomotionSolver, XrHandCollisionResolver, XrPhysicsRig } from "./xr-locomotion.js";

describe("XrArmLocomotionSolver", () => {
  it("moves opposite a planted hand and averages two-hand support", () => {
    const solver = new XrArmLocomotionSolver({ gravity: 0 });
    solver.sample({ deltaSeconds: 0.02, headPosition: [0, 1.6, 0], hands: [
      { hand: "left", position: [-0.3, 1, 0], tracked: true }, { hand: "right", position: [0.3, 1, 0], tracked: true },
    ], contacts: { left: { touching: true }, right: { touching: true } } });
    const moved = solver.sample({ deltaSeconds: 0.02, headPosition: [0, 1.6, 0], hands: [
      { hand: "left", position: [-0.3, 0.9, 0], tracked: true }, { hand: "right", position: [0.3, 0.8, 0], tracked: true },
    ], contacts: { left: { touching: true }, right: { touching: true } } });
    expect(moved.translation[1]).toBeCloseTo(0.15); expect(moved.supportedHands).toEqual(["left", "right"]);
  });

  it("clamps tracking jumps and emits a bounded release launch", () => {
    const solver = new XrArmLocomotionSolver({ maxSpeed: 2, maxLaunchSpeed: 3, gravity: 0, velocitySamples: 2 });
    solver.sample({ deltaSeconds: 0.1, headPosition: [0, 1.6, 0], hands: [{ hand: "left", position: [0, 1, 0], tracked: true }], contacts: { left: { touching: true } } });
    solver.sample({ deltaSeconds: 0.1, headPosition: [0, 1.6, 0], hands: [{ hand: "left", position: [0, -20, 0], tracked: true }], contacts: { left: { touching: true } } });
    const released = solver.sample({ deltaSeconds: 0.1, headPosition: [0, 1.6, 0], hands: [{ hand: "left", position: [0, -20, 0], tracked: true }], contacts: {} });
    expect(Math.hypot(...released.launchVelocity)).toBeLessThanOrEqual(3); expect(released.launchVelocity[1]).toBeGreaterThan(0);
  });

  it("rejects duplicate hands and invalid contact IDs", () => {
    const solver = new XrArmLocomotionSolver();
    expect(() => solver.sample({ deltaSeconds: 0.01, headPosition: [0, 0, 0], hands: [
      { hand: "left", position: [0, 0, 0], tracked: true }, { hand: "left", position: [0, 0, 0], tracked: true },
    ], contacts: {} })).toThrow(/duplicate/);
    expect(() => solver.sample({ deltaSeconds: 0.01, headPosition: [0, 0, 0], hands: [{ hand: "right", position: [0, 0, 0], tracked: true }], contacts: { right: { touching: true, bodyId: 0 } } })).toThrow(/body ID/);
  });
});

describe("XrHandCollisionResolver", () => {
  it("sphere-sweeps, projects motion along surfaces, and reads authored slip", () => {
    const physics = {
      castShape: vi.fn().mockReturnValueOnce({ bodyId: 9, distance: 0.5, position: [0.5, 0, 0], normal: [-1, 0, 0] }).mockReturnValueOnce(undefined),
      raycast: vi.fn(() => undefined),
    };
    const resolver = new XrHandCollisionResolver(physics as never, { surfaceSlip: (id) => id === 9 ? 0.5 : undefined });
    const hit = resolver.resolve([0, 0, 0], [1, 1, 0], 0.05);
    expect(hit).toMatchObject({ touching: true, bodyId: 9, slip: 0.5, constrainedPosition: [0.5, 0.5, 0] });
    expect(physics.castShape).toHaveBeenCalledTimes(2);
  });

  it("uses a ray fallback against thin geometry and supports unsticking", () => {
    const physics = { castShape: vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(undefined), raycast: vi.fn(() => ({ bodyId: 2, distance: 1, point: [1, 0, 0], normal: [-1, 0, 0] })) };
    const resolver = new XrHandCollisionResolver(physics as never);
    expect(resolver.resolve([0, 0, 0], [2, 0, 0], 0.05)).toMatchObject({ bodyId: 2, constrainedPosition: [0, 0, 0] });
    expect(resolver.shouldUnstick([0, 0, 0], [2, 0, 0], [0, 0, 0], 0.05, 1)).toBe(true);
  });
});

describe("XrPhysicsRig", () => {
  it("routes locomotion through the native character controller", () => {
    const moveCharacter = vi.fn(() => ({ translation: [0, 0.1, 0] as const, grounded: false, slidingDownSlope: false, collisions: [] }));
    const rig = new XrPhysicsRig({ moveCharacter } as never, [0, 1, 0], { character: { shape: { type: "capsule", halfHeight: 0.6, radius: 0.25 } } });
    rig.move(0.02, { translation: [0, 0.1, 0], velocity: [0, 5, 0], launchVelocity: [0, 0, 0], supportedHands: ["left"] });
    expect(moveCharacter).toHaveBeenCalled(); expect(rig.position).toEqual([0, 1.1, 0]);
    rig.teleport([2, 3, 4]); expect(rig.position).toEqual([2, 3, 4]); expect(rig.velocity).toEqual([0, 0, 0]);
  });
});
