import { describe, expect, it } from "vitest";
import {
  Animator,
  bakeNavMesh,
  Crowd,
  StateMachine,
  ThirdPersonMotor3d,
  type AnimationClip,
  type CharacterMovement3d,
  type LocomotionWorld3d,
  type NavMeshInput,
  type RaycastHit3d,
} from "../index.js";
import { AnimatorStateBinding, NavMotorBinding } from "./nav-locomotion.js";

/** Flat floor at y = 0 with an invisible wall at x = wallX (same fixture shape as locomotion-3d.test.ts). */
class FloorWorld implements LocomotionWorld3d {
  constructor(private readonly wallX = Infinity) {}
  moveCharacter(_dt: number, position: readonly [number, number, number], _rotation: readonly [number, number, number, number], desired: readonly [number, number, number]): CharacterMovement3d {
    const feet = position[1] - 0.9;
    const y = Math.max(desired[1], -feet);
    const x = Math.min(desired[0], this.wallX - position[0]);
    return { translation: [x, y, desired[2]], grounded: feet + y <= 0.001, slidingDownSlope: false, collisions: x < desired[0] ? [7] : [] };
  }
  overlapShape() { return []; }
  raycast(origin: readonly [number, number, number], direction: readonly [number, number, number], distance: number): RaycastHit3d | undefined {
    if (direction[1] >= 0) return undefined;
    const hitDistance = origin[1] / -direction[1];
    return hitDistance <= distance ? { bodyId: 99, distance: hitDistance, point: [origin[0], 0, origin[2]], normal: [0, 1, 0] } : undefined;
  }
}

function ground(size: number): NavMeshInput {
  const half = size / 2;
  return { positions: new Float32Array([-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half]), indices: new Uint32Array([0, 2, 1, 0, 3, 2]) };
}

describe("NavMotorBinding (M122)", () => {
  it("walks a physics motor along a crowd path to arrival", () => {
    const crowd = new Crowd(bakeNavMesh(ground(40), { cellSize: 0.5, agentRadius: 0.3 }));
    const agent = crowd.addAgent({ position: [-8, 0, 0], maxSpeed: 4 });
    const motor = new ThirdPersonMotor3d(new FloorWorld(), { position: [0, 0, 0], speed: 4 });
    const binding = new NavMotorBinding(agent, motor);
    expect(motor.state.position).toEqual([-8, 0, 0]);
    expect(crowd.setDestination(agent, [8, 0, 0])).toBe(true);

    for (let step = 0; step < 60 * 8; step += 1) {
      crowd.update(1 / 60);
      binding.update(1 / 60);
    }
    expect(agent.state).toBe("arrived");
    expect(Math.hypot(motor.state.position[0] - 8, motor.state.position[2])).toBeLessThan(1);
    expect(motor.state.grounded).toBe(true);
    // Once arrived the agent's velocity is zero and the motor coasts to a stop.
    expect(binding.input().move).toEqual([0, 0]);
  });

  it("keeps the agent where physics stopped it, so navigation cannot walk through a wall", () => {
    const crowd = new Crowd(bakeNavMesh(ground(40), { cellSize: 0.5, agentRadius: 0.3 }));
    const agent = crowd.addAgent({ position: [-8, 0, 0], maxSpeed: 4 });
    const motor = new ThirdPersonMotor3d(new FloorWorld(2), { position: [0, 0, 0], speed: 4 });
    const binding = new NavMotorBinding(agent, motor);
    crowd.setDestination(agent, [8, 0, 0]);

    let blocked = false;
    for (let step = 0; step < 60 * 8; step += 1) {
      crowd.update(1 / 60);
      if (binding.update(1 / 60).collisions.includes(7)) blocked = true;
    }
    expect(blocked).toBe(true);
    expect(motor.state.position[0]).toBeLessThanOrEqual(2 + 1e-6);
    expect(agent.position[0]).toBeCloseTo(motor.state.position[0], 9);
    expect(agent.state).toBe("moving");
    // Still trying: the desired direction points at the wall.
    expect(binding.input().move[0]).toBeGreaterThan(0.9);
  });
});

const idle: AnimationClip = { name: "idle", duration: 1, loop: "loop", channels: [{ target: "Root", property: "position", keyframes: [{ time: 0, value: [0, 0, 0] }] }] };
const run: AnimationClip = { name: "run", duration: 1, loop: "loop", channels: [{ target: "Root", property: "position", keyframes: [{ time: 0, value: [0, 0.1, 0] }] }] };

describe("AnimatorStateBinding (M122)", () => {
  it("drives animator transitions from the AI state machine", () => {
    interface Npc { targetDistance: number }
    const brain = new StateMachine<Npc>("idle", {
      idle: { update: (npc) => (npc.targetDistance < 10 ? "chase" : undefined) },
      chase: { update: (npc) => (npc.targetDistance >= 10 ? "idle" : undefined) },
    });
    const animator = new Animator();
    animator.setStateMachine({
      initial: "idle",
      states: [
        { name: "idle", clip: idle, transitions: [{ to: "run", conditions: [{ parameter: "moving", operator: "==", value: true }] }] },
        { name: "run", clip: run, transitions: [{ to: "idle", conditions: [{ parameter: "moving", operator: "==", value: false }] }] },
      ],
    });
    const binding = new AnimatorStateBinding(brain, animator, { idle: { moving: false }, chase: { moving: true, speed: 4 } });

    const npc: Npc = { targetDistance: 20 };
    const tick = () => { brain.update(npc, 1 / 60); binding.apply(); return animator.update(1 / 60); };

    tick();
    expect(animator.state).toBe("idle");
    npc.targetDistance = 5;
    tick();
    expect(brain.state).toBe("chase");
    expect(animator.state).toBe("run");
    expect(animator.getParameter("speed")).toBe(4);
    // The animator's own 0.2 s fade is untouched: the AI flips a flag, animation blends.
    for (let frame = 0; frame < 12; frame += 1) tick();
    expect(animator.pose().get("Root")?.position?.[1]).toBeCloseTo(0.1, 5);
    npc.targetDistance = 30;
    tick();
    expect(animator.state).toBe("idle");
  });

  it("refuses an AI state with no animation mapping", () => {
    const brain = new StateMachine<void>("flee", { flee: { update: () => undefined } });
    expect(() => new AnimatorStateBinding(brain, new Animator(), { idle: {} })).toThrow(/"flee"/);
  });
});
