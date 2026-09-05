import { describe, expect, it, vi } from "vitest";
import { TweenRunner } from "./tween.js";

describe("TweenRunner", () => {
  it("interpolates a number over its duration", () => {
    const runner = new TweenRunner();
    const seen: number[] = [];
    runner.to({ from: 0, to: 10, durationSeconds: 1, onUpdate: (value) => seen.push(value) });
    runner.advance(0.5);
    expect(seen).toEqual([5]);
    runner.advance(0.5);
    expect(seen).toEqual([5, 10]);
  });

  it("interpolates numeric tuples component-wise", () => {
    const runner = new TweenRunner();
    let latest: readonly number[] = [];
    runner.to({ from: [0, 10, 0], to: [10, 0, 5], durationSeconds: 1, onUpdate: (value) => { latest = [...value]; } });
    runner.advance(0.5);
    expect(latest).toEqual([5, 5, 2.5]);
  });

  it("reuses one array per tween instead of allocating each update", () => {
    const runner = new TweenRunner();
    const arrays: readonly number[][] = [];
    const seen: (readonly number[])[] = [];
    runner.to({ from: [0, 0], to: [1, 1], durationSeconds: 1, onUpdate: (value) => seen.push(value) });
    runner.advance(0.25);
    runner.advance(0.25);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(arrays).toEqual([]);
  });

  it("applies easing", () => {
    const runner = new TweenRunner();
    let latest = 0;
    runner.to({ from: 0, to: 1, durationSeconds: 1, easing: "inQuad", onUpdate: (value) => { latest = value; } });
    runner.advance(0.5);
    expect(latest).toBeCloseTo(0.25);
  });

  it("waits out a delay before its first update", () => {
    const runner = new TweenRunner();
    const onUpdate = vi.fn();
    const handle = runner.to({ from: 0, to: 1, durationSeconds: 1, delaySeconds: 0.5, onUpdate });
    expect(handle.state).toBe("delayed");
    runner.advance(0.25);
    expect(onUpdate).not.toHaveBeenCalled();
    runner.advance(0.5);
    // The overshoot past the delay counts toward the tween.
    expect(handle.state).toBe("running");
    expect(onUpdate).toHaveBeenCalledWith(0.25);
  });

  it("calls onComplete once and stops tracking the tween", () => {
    const runner = new TweenRunner();
    const onComplete = vi.fn();
    const handle = runner.to({ from: 0, to: 1, durationSeconds: 1, onUpdate: vi.fn(), onComplete });
    runner.advance(2);
    expect(handle.state).toBe("completed");
    expect(onComplete).toHaveBeenCalledOnce();
    expect(runner.count).toBe(0);
    runner.advance(1);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("clamps the final value to the target rather than overshooting", () => {
    const runner = new TweenRunner();
    let latest = 0;
    runner.to({ from: 0, to: 10, durationSeconds: 1, onUpdate: (value) => { latest = value; } });
    runner.advance(5);
    expect(latest).toBe(10);
  });

  it("loops without drifting across a long delta", () => {
    const runner = new TweenRunner();
    let latest = 0;
    runner.to({ from: 0, to: 1, durationSeconds: 1, loop: "loop", onUpdate: (value) => { latest = value; } });
    runner.advance(2.25);
    expect(latest).toBeCloseTo(0.25);
    expect(runner.count).toBe(1);
  });

  it("reverses direction on each ping-pong cycle", () => {
    const runner = new TweenRunner();
    let latest = 0;
    runner.to({ from: 0, to: 1, durationSeconds: 1, loop: "pingPong", onUpdate: (value) => { latest = value; } });
    runner.advance(0.25);
    expect(latest).toBeCloseTo(0.25);
    runner.advance(1);
    // One full cycle later it is travelling back down.
    expect(latest).toBeCloseTo(0.75);
  });

  it("completes immediately when the duration is zero", () => {
    const runner = new TweenRunner();
    const onUpdate = vi.fn();
    const handle = runner.to({ from: 0, to: 1, durationSeconds: 0, onUpdate });
    runner.advance(0);
    expect(onUpdate).toHaveBeenCalledWith(1);
    expect(handle.state).toBe("completed");
  });

  it("cancels without completing", () => {
    const runner = new TweenRunner();
    const onComplete = vi.fn();
    const handle = runner.to({ from: 0, to: 1, durationSeconds: 1, onUpdate: vi.fn(), onComplete });
    handle.cancel();
    runner.advance(2);
    expect(handle.state).toBe("cancelled");
    expect(onComplete).not.toHaveBeenCalled();
    expect(runner.count).toBe(0);
  });

  it("jumps to the end on complete()", () => {
    const runner = new TweenRunner();
    let latest = 0;
    const onComplete = vi.fn();
    const handle = runner.to({ from: 0, to: 10, durationSeconds: 10, onUpdate: (value) => { latest = value; }, onComplete });
    handle.complete();
    expect(latest).toBe(10);
    expect(handle.state).toBe("completed");
    expect(onComplete).toHaveBeenCalledOnce();
    handle.complete();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("reports progress before easing", () => {
    const runner = new TweenRunner();
    const handle = runner.to({ from: 0, to: 1, durationSeconds: 2, easing: "inQuad", onUpdate: vi.fn() });
    runner.advance(0.5);
    expect(handle.progress).toBeCloseTo(0.25);
  });

  it("validates its options", () => {
    const runner = new TweenRunner();
    const onUpdate = vi.fn();
    expect(() => runner.to({ from: 0, to: 1, durationSeconds: -1, onUpdate })).toThrow(/non-negative duration/);
    expect(() => runner.to({ from: 0, to: 1, durationSeconds: 1, delaySeconds: -1, onUpdate })).toThrow(/delay must be finite/);
    expect(() => runner.to({ from: 0, to: 1, durationSeconds: 1, onUpdate: undefined as never })).toThrow(/onUpdate callback/);
    expect(() => runner.to({ from: 0, to: 1, durationSeconds: 1, easing: "swoosh" as never, onUpdate })).toThrow(/Unknown tween easing/);
    expect(() => runner.to({ from: 0, to: [1] as never, durationSeconds: 1, onUpdate })).toThrow(/both be numbers or both be numeric arrays/);
    expect(() => runner.to({ from: [0, 0], to: [1], durationSeconds: 1, onUpdate })).toThrow(/same length \(got 2 and 1\)/);
    expect(() => runner.advance(-1)).toThrow(/non-negative delta/);
  });

  it("clears every tween without completing them", () => {
    const runner = new TweenRunner();
    const onComplete = vi.fn();
    runner.to({ from: 0, to: 1, durationSeconds: 1, onUpdate: vi.fn(), onComplete });
    runner.clear();
    runner.advance(2);
    expect(runner.count).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
