import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameRuntime, type GameContext, type GameHooks, type GameScriptModule } from "./game-runtime.js";
import type { PackedFrame, RenderHost, RenderStats } from "../render/host/index.js";

/** A stand-in for the WebGPU host, so the loop is testable without a GPU. */
function fakeHost() {
  const frames: PackedFrame[] = [];
  return {
    initialized: true,
    frames,
    renderedAt: [] as number[],
    initialize: vi.fn(async () => undefined),
    submitFrame: vi.fn((frame: PackedFrame) => {
      // The renderer copies on submission, so record a snapshot rather than a
      // view that the builder will overwrite next frame.
      frames.push({ ...frame, meshTable: [...frame.meshTable], matrices: Float32Array.from(frame.matrices) });
    }),
    submitLayers: vi.fn(),
    renderFrame: vi.fn(function (this: { renderedAt: number[] }, now: number): RenderStats {
      this.renderedAt.push(now);
      return { fps: 60, frameTimeMs: 16, cpuEncodeMs: 1, drawCalls: 1, triangles: 12 };
    }),
    uploadMesh: vi.fn(),
    releaseMesh: vi.fn(() => true),
    uploadTexture: vi.fn(),
    releaseTexture: vi.fn(() => true),
    defineMaterial: vi.fn(),
    releaseMaterial: vi.fn(() => true),
    setPostProcess: vi.fn(),
    postProcess: vi.fn(() => ({ exposure: 1, toneMapping: "aces" as const })),
    destroy: vi.fn(),
  };
}

function runtimeWith(hooks: GameHooks, options: Record<string, unknown> = {}) {
  const host = fakeHost();
  const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement;
  const runtime = new GameRuntime(canvas, hooks, { host: host as RenderHost, ...options });
  return { runtime, host };
}

const originalRaf = globalThis.requestAnimationFrame;
const originalCaf = globalThis.cancelAnimationFrame;

beforeEach(() => {
  // Never actually schedule: tests drive the loop through `step`.
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: () => 1 });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: () => undefined });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { pointerLockElement: null } });
});

afterEach(() => {
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: originalRaf });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: originalCaf });
});

describe("GameRuntime", () => {
  it("runs VS and TypeScript modules in deterministic order over one GameContext", async () => {
    const calls: string[] = [];
    const { runtime } = runtimeWith({
      start: () => { calls.push("game:start"); }, fixedUpdate: () => { calls.push("game:fixed"); },
      update: () => { calls.push("game:update"); }, lateUpdate: () => { calls.push("game:late"); }, afterRender: () => { calls.push("game:after"); }, stop: () => { calls.push("game:stop"); },
    }, { fixedHz: 10, scripts: [
      { id: "ts", order: 20, module: { start: () => { calls.push("ts:start"); }, fixedUpdate: () => { calls.push("ts:fixed"); }, update: () => { calls.push("ts:update"); }, lateUpdate: () => { calls.push("ts:late"); }, afterRender: () => { calls.push("ts:after"); }, stop: () => { calls.push("ts:stop"); } } },
      { id: "vs", order: 10, module: { start: () => { calls.push("vs:start"); }, fixedUpdate: () => { calls.push("vs:fixed"); }, update: () => { calls.push("vs:update"); }, lateUpdate: () => { calls.push("vs:late"); }, afterRender: () => { calls.push("vs:after"); }, stop: () => { calls.push("vs:stop"); } } },
    ] });
    await runtime.start(); const base = performance.now(); runtime.step(base + 100); runtime.stop();
    expect(calls).toEqual(["game:start", "vs:start", "ts:start", "game:fixed", "vs:fixed", "ts:fixed", "game:update", "vs:update", "ts:update", "game:late", "vs:late", "ts:late", "game:after", "vs:after", "ts:after", "game:stop", "ts:stop", "vs:stop"]);
    expect(runtime.scriptIds).toEqual(["vs", "ts"]);
  });

  it("dispatches contacts and identifies a failing module and phase", async () => {
    const contact = vi.fn();
    const { runtime } = runtimeWith({}, { scripts: [{ id: "player.vs", module: { collisionEnter: contact, triggerExit: () => { throw new Error("bad trigger"); } } }] });
    await runtime.start(); runtime.collisionEnter("player", "wall");
    expect(contact).toHaveBeenCalledWith(expect.anything(), "player", "wall");
    expect(() => runtime.triggerExit("player", "water")).toThrow("Game script 'player.vs' failed during triggerExit: bad trigger");
    runtime.destroy();
  });

  it("advances scene physics at the fixed rate and dispatches contacts to both entities", async () => {
    const collision = vi.fn();
    const physics = { prepare: vi.fn(), fixedUpdate: vi.fn(() => [{ dimension: "2d", kind: "collisionEnter", entityA: "player", entityB: "wall" }]), destroy: vi.fn() };
    const { runtime } = runtimeWith({}, { fixedHz: 10, scenePhysics: physics, scripts: [{ id: "logic", module: { collisionEnter: collision } }] });
    await runtime.start(); runtime.step(performance.now() + 100);
    expect(physics.fixedUpdate).toHaveBeenCalledWith(0.1);
    expect(collision).toHaveBeenNthCalledWith(1, expect.anything(), "player", "wall");
    expect(collision).toHaveBeenNthCalledWith(2, expect.anything(), "wall", "player");
    runtime.destroy(); expect(physics.destroy).toHaveBeenCalled();
  });

  it("rejects duplicate script identities", () => {
    expect(() => runtimeWith({}, { scripts: [{ id: "logic", module: {} }, { id: "logic", module: {} }] })).toThrow("Duplicate game script ID 'logic'");
  });

  it("hot-replaces modules while preserving state", async () => {
    const calls: string[] = []; let score = 42;
    const originalModule: GameScriptModule = {
      start: () => { calls.push("old:start"); }, captureState: () => ({ score }), stop: () => { calls.push("old:stop"); }, restoreState: (_, state) => { score = (state as { score: number }).score; },
    };
    const { runtime } = runtimeWith({}, { scripts: [{ id: "logic", module: originalModule }] });
    await runtime.start(); score = 99;
    await runtime.replaceScript("logic", {
      restoreState: (_, state) => { score = (state as { score: number }).score; calls.push(`new:restore:${String(score)}`); },
      start: () => { calls.push("new:start"); }, update: () => { calls.push(`new:update:${String(score)}`); },
    });
    runtime.step(performance.now() + 16);
    expect(calls).toEqual(["old:start", "old:stop", "new:restore:99", "new:start", "new:update:99"]);
    runtime.destroy();
  });

  it("rolls back a failed hot replacement", async () => {
    const calls: string[] = [];
    const old: GameScriptModule = { start: () => { calls.push("old:start"); }, stop: () => { calls.push("old:stop"); }, restoreState: () => { calls.push("old:restore"); }, update: () => { calls.push("old:update"); } };
    const { runtime } = runtimeWith({}, { scripts: [{ id: "logic", module: old }] }); await runtime.start();
    await expect(runtime.replaceScript("logic", { restoreState: () => { throw new Error("incompatible state"); } })).rejects.toThrow("failed during restoreState: incompatible state");
    runtime.step(performance.now() + 16);
    expect(calls).toEqual(["old:start", "old:stop", "old:restore", "old:start", "old:update"]);
    runtime.destroy();
  });
  it("provides an injected engine audio service through the game context", async () => {
    let context: GameContext | undefined;
    const audio = { unlock: vi.fn() };
    const { runtime } = runtimeWith({ start: (game) => { context = game; } }, { audio });
    await runtime.start();
    expect(context!.audio).toBe(audio);
    runtime.destroy();
  });

  it("runs start before the first frame", async () => {
    const order: string[] = [];
    const { runtime } = runtimeWith({
      start: () => { order.push("start"); },
      update: () => { order.push("update"); },
    });
    await runtime.start();
    expect(order).toEqual(["start"]);
    runtime.step(16);
    expect(order).toEqual(["start", "update"]);
    runtime.destroy();
  });

  it("submits an engine-native overlay as a preserved screen-space layer", async () => {
    const matrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const { runtime, host } = runtimeWith({ update(game) { game.frame.setCamera(matrix, 60, 0.1, 100); game.frame.draw("world", matrix); game.overlay.setOrthographicCamera(matrix, 6, 0.1, 100); game.overlay.draw("hud", matrix); } });
    await runtime.start(); runtime.step(performance.now() + 16);
    expect(host.submitFrame).not.toHaveBeenCalled();
    expect(host.submitLayers).toHaveBeenCalledWith([
      expect.objectContaining({ clearColor: true, clearDepth: true, frame: expect.objectContaining({ meshTable: ["world"] }) }),
      expect.objectContaining({ clearColor: false, clearDepth: false, frame: expect.objectContaining({ meshTable: ["hud"] }) }),
    ]);
    runtime.destroy();
  });

  it("waits for an async start so loading finishes before the loop", async () => {
    let loaded = false;
    const { runtime } = runtimeWith({
      start: async () => {
        await Promise.resolve();
        loaded = true;
      },
      update: () => { expect(loaded).toBe(true); },
    });
    await runtime.start();
    expect(loaded).toBe(true);
    runtime.step(16);
    runtime.destroy();
  });

  it("takes a whole number of fixed steps at a constant rate", async () => {
    const steps: number[] = [];
    // 110 ms at 50 Hz is five whole 20 ms steps with 10 ms carried forward.
    const { runtime } = runtimeWith({ fixedUpdate: (_, dt) => { steps.push(dt); } }, { fixedHz: 50, maxDeltaSeconds: 0.2 });
    await runtime.start();
    runtime.step(performance.now() + 110);
    expect(steps).toHaveLength(5);
    expect(steps.every((value) => Math.abs(value - 0.02) < 1e-9)).toBe(true);
    runtime.destroy();
  });

  it("carries the remainder forward instead of dropping it", async () => {
    // Two 30 ms frames at 50 Hz owe three steps in total, not two: the 10 ms
    // left over from the first frame must survive into the second.
    let count = 0;
    const { runtime } = runtimeWith({ fixedUpdate: () => { count += 1; } }, { fixedHz: 50, maxDeltaSeconds: 0.2 });
    await runtime.start();
    const base = performance.now();
    runtime.step(base + 30);
    expect(count).toBe(1);
    runtime.step(base + 60);
    expect(count).toBe(3);
    runtime.destroy();
  });

  it("clamps a huge delta so a restored tab does not teleport the world", async () => {
    let seen = Number.NaN;
    const { runtime } = runtimeWith({ update: (_, dt) => { seen = dt; } }, { maxDeltaSeconds: 0.1 });
    await runtime.start();
    runtime.step(performance.now() + 60_000);
    expect(seen).toBe(0.1);
    runtime.destroy();
  });

  it("caps fixed-step catch-up so a stall cannot spiral", async () => {
    let count = 0;
    const { runtime } = runtimeWith({ fixedUpdate: () => { count += 1; } }, { fixedHz: 60, maxDeltaSeconds: 10 });
    await runtime.start();
    runtime.step(performance.now() + 10_000);
    // Ten seconds at 60 Hz would be 600 steps; the accumulator is capped well
    // below that so the next frame still arrives promptly.
    expect(count).toBeLessThanOrEqual(8);
    expect(count).toBeGreaterThan(0);
    runtime.destroy();
  });

  it("never passes a negative delta if the clock goes backwards", async () => {
    let seen = Number.NaN;
    const { runtime } = runtimeWith({ update: (_, dt) => { seen = dt; } });
    await runtime.start();
    runtime.step(performance.now() - 5_000);
    expect(seen).toBe(0);
    runtime.destroy();
  });

  it("submits the frame the game recorded, then renders it", async () => {
    const { runtime, host } = runtimeWith({
      update: (game) => {
        game.frame.setCamera(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1]), 60, 0.1, 100);
        game.frame.draw("builtin:cube", new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]));
      },
    });
    await runtime.start();
    runtime.step(16);
    expect(host.submitFrame).toHaveBeenCalledTimes(1);
    expect(host.renderFrame).toHaveBeenCalledTimes(1);
    const frame = host.frames[0]!;
    expect(frame.meshTable).toEqual(["builtin:cube"]);
    expect(frame.matrices[12]).toBe(5);
    // Simulation must be submitted before the draw it produced.
    expect(host.submitFrame.mock.invocationCallOrder[0]!).toBeLessThan(host.renderFrame.mock.invocationCallOrder[0]!);
    runtime.destroy();
  });

  it("clears the frame between updates so draws do not accumulate", async () => {
    const { runtime, host } = runtimeWith({
      update: (game) => { game.frame.draw("builtin:cube", new Float32Array(16).fill(0)); },
    });
    await runtime.start();
    runtime.step(16);
    runtime.step(32);
    expect(host.frames[0]!.meshIndices).toHaveLength(1);
    expect(host.frames[1]!.meshIndices).toHaveLength(1);
    runtime.destroy();
  });

  it("stops the loop and reports when a frame throws", async () => {
    const onError = vi.fn();
    const { runtime } = runtimeWith({
      update: () => { throw new Error("bad frame"); },
    }, { onError });
    await runtime.start();
    // The scheduled tick catches; `step` itself propagates for tests.
    expect(() => runtime.step(16)).toThrow(/bad frame/);
    runtime.destroy();
    expect(runtime.running).toBe(false);
  });

  it("runs stop exactly once, even if called twice", async () => {
    const stop = vi.fn();
    const { runtime } = runtimeWith({ stop });
    await runtime.start();
    runtime.stop();
    runtime.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(runtime.running).toBe(false);
  });

  it("exposes time that advances with the clock", async () => {
    const samples: { elapsed: number; frame: number }[] = [];
    const { runtime } = runtimeWith({
      update: (game) => { samples.push({ elapsed: game.time.elapsedSeconds, frame: game.time.frame }); },
    });
    await runtime.start();
    const base = performance.now();
    runtime.step(base + 20);
    runtime.step(base + 40);
    expect(samples[0]!.frame).toBe(0);
    expect(samples[1]!.frame).toBe(1);
    expect(samples[1]!.elapsed).toBeGreaterThan(samples[0]!.elapsed);
    runtime.destroy();
  });

  it("passes mesh uploads through to the renderer", async () => {
    let context: GameContext | undefined;
    const { runtime, host } = runtimeWith({ start: (game) => { context = game; } });
    await runtime.start();
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
    context!.uploadMesh("chunk:0", mesh);
    expect(host.uploadMesh).toHaveBeenCalledWith("chunk:0", mesh);
    expect(context!.releaseMesh("chunk:0")).toBe(true);
    runtime.destroy();
  });

  it("lets a game stop itself and reports viewport size", async () => {
    let context: GameContext | undefined;
    const { runtime } = runtimeWith({ start: (game) => { context = game; } });
    await runtime.start();
    expect(context!.width).toBe(800);
    expect(context!.height).toBe(600);
    expect(context!.pointerLocked).toBe(false);
    context!.quit();
    expect(runtime.running).toBe(false);
    runtime.destroy();
  });

  it("rejects a nonsensical fixed rate", () => {
    const canvas = { clientWidth: 1, clientHeight: 1 } as HTMLCanvasElement;
    expect(() => new GameRuntime(canvas, {}, { fixedHz: 0, host: fakeHost() as RenderHost })).toThrow(/positive/);
  });

  it("refuses to step before it has started", () => {
    const { runtime } = runtimeWith({});
    expect(() => runtime.step(16)).toThrow(/has not started/);
  });
});
