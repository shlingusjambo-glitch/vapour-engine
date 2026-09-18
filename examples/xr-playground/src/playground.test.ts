import { describe, expect, it } from "vitest";
import { syntheticXrFrame } from "@vapour/engine";
import { XrPlayground, controller, trackedHand } from "./playground.js";

const head = [0, 1.65, 0] as const;

describe("xr playground", () => {
  it("drives grabbing through XR input bindings and pulses haptics", async () => {
    const playground = new XrPlayground();
    const at = (squeeze: number, position: readonly [number, number, number]) =>
      ({ ...syntheticXrFrame({ headPosition: head, time: 16 }), inputs: [controller("right", position, { squeeze })] });
    await playground.frame(at(0, [0.3, 1.0, -0.5]), 1 / 72);
    await playground.frame(at(1, [0.3, 1.0, -0.5]), 1 / 72);
    expect(playground.stats().held).toBe("crate");
    await playground.frame(at(1, [0.6, 1.2, -0.5]), 1 / 72);
    expect(playground.crate.position[0]).toBeCloseTo(0.6);
    await playground.frame(at(0, [0.6, 1.2, -0.5]), 1 / 72);
    expect(playground.stats().held).toBeUndefined();
    expect(playground.stats().hapticsPlayed).toBe(1);
  });

  it("recognises hand poses and clicks world-space UI with a pinch", async () => {
    const playground = new XrPlayground();
    // A right hand at the panel's height, 1 m in front of it, pointing -Z at the "resume" button.
    const open = { ...syntheticXrFrame({ headPosition: head }), inputs: [trackedHand("right", [-0.25, 1.65, -0.5], 0.1), trackedHand("left", [-0.3, 1.2, -0.4], 0.1)] };
    await playground.frame(open, 1 / 72);
    expect(playground.stats().leftPose).toBe("open");
    const pinch = { ...open, inputs: [trackedHand("right", [-0.25, 1.65, -0.5], 0.01), trackedHand("left", [-0.3, 1.2, -0.4], 0.01)] };
    await playground.frame(pinch, 1 / 72);
    expect(playground.stats().leftPose).toBe("pinch");
    expect(playground.stats().uiClicks).toBe(1);
  });

  it("moves and snap-turns from thumbsticks bound through the action map", async () => {
    const playground = new XrPlayground();
    const frame = (stick: readonly [number, number], turn: number) =>
      ({ ...syntheticXrFrame({ headPosition: head }), inputs: [controller("left", [-0.3, 1.2, -0.4], { stick }), controller("right", [0.3, 1.2, -0.4], { stick: [turn, 0] })] });
    for (let step = 0; step < 72; step += 1) await playground.frame(frame([0, 1], 0), 1 / 72);
    const moved = playground.stats().playerPosition;
    expect(Math.hypot(moved[0], moved[2])).toBeGreaterThan(1.5);
    await playground.frame(frame([0, 0], 1), 1 / 72);
    // The snap commits halfway through its comfort fade, not on the push frame.
    for (let step = 0; step < 30; step += 1) await playground.frame(frame([0, 0], 0), 1 / 72);
    expect(Math.abs(playground.stats().playerYaw)).toBeCloseTo(Math.PI / 4, 1);
  });
});
