import { describe, expect, it, vi } from "vitest";
import { RuntimeLoop } from "./runtime-loop.js";

describe("RuntimeLoop", () => {
  it("clamps frame time and reports deterministic fixed steps", async () => {
    const frames: Array<{ deltaSeconds: number; fixedSteps: number }> = [];
    let scheduled: FrameRequestCallback | undefined;
    const loop = new RuntimeLoop({ update: (time) => frames.push(time) }, {
      fixedHz: 50,
      maxDeltaSeconds: 0.1,
      now: () => 1000,
      requestFrame: (callback) => { scheduled = callback; return 1; },
      cancelFrame: () => {},
    });
    await loop.start();
    scheduled!(1050);
    expect(frames[0]).toMatchObject({ deltaSeconds: 0.05, fixedSteps: 2 });
    scheduled!(2050);
    expect(frames[1]).toMatchObject({ deltaSeconds: 0.1, fixedSteps: 5 });
  });

  it("caps catch-up work and stops after an update error", async () => {
    const report = vi.fn();
    let scheduled: FrameRequestCallback | undefined;
    const loop = new RuntimeLoop({ update: () => { throw new Error("frame failed"); }, error: report }, {
      maxFixedStepsPerFrame: 3,
      now: () => 0,
      requestFrame: (callback) => { scheduled = callback; return 7; },
      cancelFrame: () => {},
    });
    await loop.start();
    scheduled!(1000);
    expect(report).toHaveBeenCalledOnce();
    expect(loop.running).toBe(false);
  });

  it("runs lifecycle hooks exactly once", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const loop = new RuntimeLoop({ start, update: () => {}, stop }, {
      now: () => 0, requestFrame: () => 1, cancelFrame: () => {},
    });
    await loop.start();
    await loop.start();
    loop.stop();
    loop.stop();
    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
