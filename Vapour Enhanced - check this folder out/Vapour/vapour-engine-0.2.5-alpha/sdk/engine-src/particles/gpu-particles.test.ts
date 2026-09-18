import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { curve, gradientBetween } from "@vapour/math";
import {
  GPU_PARTICLE_LUT_SAMPLES,
  GpuParticleSystem,
  bakeParticleLuts,
  gpuParticleDescriptor,
  type GpuParticleDescriptor,
  type GpuParticleHost,
  type GpuParticleHostStats,
} from "./gpu-particles.js";
import { ParticleEmitter } from "./particles.js";

function fakeHost(supported = true) {
  const systems = new Map<string, GpuParticleDescriptor>();
  const host = {
    systems,
    supportsGpuParticles: vi.fn(() => supported),
    createParticleSystem: vi.fn((id: string, descriptor: GpuParticleDescriptor) => {
      systems.set(id, descriptor);
    }),
    updateParticleSystem: vi.fn(),
    clearParticleSystem: vi.fn(),
    releaseParticleSystem: vi.fn((id: string) => systems.delete(id)),
    particleSystemStats: vi.fn((): GpuParticleHostStats | undefined => undefined),
  } satisfies GpuParticleHost & { systems: typeof systems };
  return host;
}

describe("the renderer's parity fixture", () => {
  it("is what ParticleEmitter produces for the documented seed and burst", () => {
    // `a_gpu_burst_matches_the_typescript_emitter` in
    // crates/vapour-render/src/surface/particles.rs compares one GPU step
    // against this file; regenerate it here if the emitter's sampling changes.
    const path = fileURLToPath(new URL("../../../../crates/vapour-render/src/surface/particles_golden.json", import.meta.url));
    const golden = JSON.parse(readFileSync(path, "utf8")) as [[number, number, number], number, number][];
    const emitter = new ParticleEmitter({ capacity: 8, burst: 8, rate: 0, seed: 1 });
    emitter.play();
    const dt = 1 / 60;
    emitter.update(dt);
    const buffers = emitter.buffers();
    expect(buffers.count).toBe(8);
    expect(golden).toHaveLength(8);
    for (let index = 0; index < 8; index += 1) {
      const [position, rotation, lifetime] = golden[index]!;
      expect([...buffers.positions.subarray(index * 3, index * 3 + 3)]).toEqual(position);
      expect(buffers.rotations[index]).toBe(rotation);
      expect(dt / buffers.ages[index]!).toBeCloseTo(lifetime, 6);
    }
  });
});

describe("descriptor", () => {
  it("bakes the size curve and colour gradient into 32-sample tables", () => {
    const { sizeLut, colorLut } = bakeParticleLuts(
      curve([{ time: 0, value: 2 }, { time: 1, value: 0 }]),
      gradientBetween([1, 0, 0, 1], [0, 0, 1, 0]),
    );
    expect(sizeLut).toHaveLength(GPU_PARTICLE_LUT_SAMPLES);
    expect(colorLut).toHaveLength(GPU_PARTICLE_LUT_SAMPLES * 4);
    expect(sizeLut[0]).toBe(2);
    expect(sizeLut[31]).toBe(0);
    expect(colorLut.slice(0, 4)).toEqual([1, 0, 0, 1]);
    expect(colorLut.slice(124)).toEqual([0, 0, 1, 0]);
    // Without authored curves: unit size, white fading out — the emitter's defaults.
    const defaults = bakeParticleLuts(undefined, undefined);
    expect(defaults.sizeLut.every((size) => size === 1)).toBe(true);
    expect(defaults.colorLut.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(defaults.colorLut.slice(124)).toEqual([1, 1, 1, 0]);
  });

  it("carries the emitter's shape and rejects what the emitter rejects", () => {
    const descriptor = gpuParticleDescriptor({
      capacity: 64,
      shape: { kind: "cone", angle: 35, size: [0.5, 1, 1] },
      seed: -1,
      blend: "additive",
    });
    expect(descriptor).toMatchObject({ capacity: 64, shape: "cone", coneAngle: 35, shapeSize: [0.5, 1, 1], seed: 0xffffffff, blend: "additive", lifetime: [1, 2] });
    expect(() => gpuParticleDescriptor({ lifetime: [2, 1] })).toThrow(/lifetime/);
    expect(() => gpuParticleDescriptor({ capacity: 0 })).toThrow(/capacity/);
    expect(() => gpuParticleDescriptor({ capacity: 1 << 21 })).toThrow(/capacity/);
  });
});

describe("GpuParticleSystem on a GPU host", () => {
  it("creates the system once and drives it with one call per update", () => {
    const host = fakeHost();
    const system = new GpuParticleSystem(host, { capacity: 100, rate: 120, burst: 10, seed: 3 }, "sparks");
    expect(system.mode).toBe("gpu");
    expect(system.emitter).toBeUndefined();
    expect(host.createParticleSystem).toHaveBeenCalledWith("sparks", expect.objectContaining({ capacity: 100, seed: 3 }));
    system.setOrigin([1, 2, 3]);
    system.play();
    // The burst is queued for the next update, together with 120/s × 1/60 = 2.
    system.update(1 / 60);
    expect(host.updateParticleSystem).toHaveBeenLastCalledWith("sparks", 1 / 60, 12, [1, 2, 3]);
    // Fractional emission accumulates: 120 × 0.0125 = 1.5 → 1 now, 0.5 carried.
    system.update(0.0125);
    expect(host.updateParticleSystem).toHaveBeenLastCalledWith("sparks", 0.0125, 1, [1, 2, 3]);
    system.update(0.0125);
    expect(host.updateParticleSystem).toHaveBeenLastCalledWith("sparks", 0.0125, 2, [1, 2, 3]);
    expect(system.stats()).toMatchObject({ mode: "gpu", requested: 15, capacity: 100 });
  });

  it("caps a spawn request at capacity and reports the request", () => {
    const host = fakeHost();
    const system = new GpuParticleSystem(host, { capacity: 16, rate: 0 }, "burst");
    expect(system.burst(40)).toBe(40);
    system.update(0);
    expect(host.updateParticleSystem).toHaveBeenLastCalledWith("burst", 0, 16, [0, 0, 0]);
  });

  it("stops emitting after a non-looping duration and keeps emitting when looping", () => {
    const looping = new GpuParticleSystem(fakeHost(), { rate: 60, duration: 0.5, loop: true });
    const once = fakeHost();
    const oneShot = new GpuParticleSystem(once, { rate: 60, duration: 0.5, loop: false }, "once");
    looping.play();
    oneShot.play();
    for (let step = 0; step < 60; step += 1) {
      looping.update(1 / 60);
      oneShot.update(1 / 60);
    }
    expect(looping.playing).toBe(true);
    expect(oneShot.playing).toBe(false);
    const spawned = once.updateParticleSystem.mock.calls.reduce((sum, call) => sum + (call[2] as number), 0);
    expect(spawned).toBeGreaterThanOrEqual(29);
    expect(spawned).toBeLessThanOrEqual(31);
  });

  it("bounds the live count by what could still be alive", () => {
    const host = fakeHost();
    const system = new GpuParticleSystem(host, { capacity: 50, rate: 0, burst: 30, lifetime: [0.5, 1] }, "bound");
    expect(system.aliveCount).toBe(0);
    system.play();
    system.update(1 / 60);
    expect(system.aliveCount).toBe(30);
    system.burst(40);
    system.update(1 / 60);
    // 70 requested, but the pool holds 50.
    expect(system.aliveCount).toBe(50);
    system.update(1);
    // Everything spawned more than the maximum lifetime ago is certainly gone.
    expect(system.aliveCount).toBe(0);
    // Host statistics win when the renderer has exact numbers.
    host.particleSystemStats.mockReturnValueOnce({ gpu: false, requested: 70, alive: 12, emitted: 50, expired: 38, dropped: 20 });
    expect(system.stats()).toMatchObject({ alive: 12, emitted: 50, expired: 38, dropped: 20 });
  });

  it("clears and releases through the host", () => {
    const host = fakeHost();
    const system = new GpuParticleSystem(host, { rate: 0, burst: 5 }, "temp");
    system.play();
    system.update(1 / 60);
    system.clear();
    expect(host.clearParticleSystem).toHaveBeenCalledWith("temp");
    expect(system.playing).toBe(false);
    expect(system.aliveCount).toBe(0);
    system.release();
    expect(host.systems.has("temp")).toBe(false);
    expect(() => system.update(1 / 60)).toThrow(/released/);
    expect(() => system.setOrigin([Number.NaN, 0, 0])).toThrow(/finite/);
    expect(() => system.update(-1)).toThrow(/non-negative/);
  });
});

describe("GpuParticleSystem without GPU support", () => {
  it("falls back to a ParticleEmitter with the same options", () => {
    const host = fakeHost(false);
    const system = new GpuParticleSystem(host, { capacity: 32, rate: 0, burst: 8, seed: 1 });
    expect(system.mode).toBe("cpu");
    expect(host.createParticleSystem).not.toHaveBeenCalled();
    system.setOrigin([0, 5, 0]);
    system.play();
    system.update(1 / 60);
    expect(host.updateParticleSystem).not.toHaveBeenCalled();
    expect(system.aliveCount).toBe(8);
    const buffers = system.emitter!.buffers();
    expect(buffers.count).toBe(8);
    expect(buffers.positions[1]).toBeCloseTo(5, 1);
    expect(system.stats()).toMatchObject({ mode: "cpu", alive: 8, emitted: 8, requested: 8, dropped: 0 });
    system.clear();
    expect(system.aliveCount).toBe(0);
    system.release();
    expect(host.releaseParticleSystem).not.toHaveBeenCalled();
  });
});
