import { describe, expect, it } from "vitest";
import { curve, gradientBetween } from "@vapour/math";
import { ParticleEmitter, ParticleSystemPool } from "./particles.js";

/** Runs an emitter for a simulated duration. */
function run(emitter: ParticleEmitter, seconds: number, dt = 1 / 60): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) emitter.update(dt);
}

describe("emission", () => {
  it("emits at its configured rate", () => {
    const emitter = new ParticleEmitter({ rate: 60, lifetime: [10, 10] });
    emitter.play();
    run(emitter, 1);
    // Roughly one per frame at 60/s, allowing for the fractional accumulator.
    expect(emitter.aliveCount).toBeGreaterThan(55);
    expect(emitter.aliveCount).toBeLessThanOrEqual(61);
  });

  it("accumulates fractional emission, so a slow rate still emits", () => {
    // A rate below one per frame must not round to never emitting.
    const emitter = new ParticleEmitter({ rate: 2, lifetime: [100, 100] });
    emitter.play();
    run(emitter, 5);
    expect(emitter.aliveCount).toBeGreaterThanOrEqual(9);
    expect(emitter.aliveCount).toBeLessThanOrEqual(11);
  });

  it("bursts on play and on demand", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 25, lifetime: [10, 10] });
    emitter.play();
    expect(emitter.aliveCount).toBe(25);
    expect(emitter.burst(5)).toBe(5);
    expect(emitter.aliveCount).toBe(30);
  });

  it("drops rather than growing when full", () => {
    // Growing the buffer mid-explosion is the allocation spike the flat layout
    // exists to avoid.
    const emitter = new ParticleEmitter({ capacity: 10, rate: 0, lifetime: [10, 10] });
    expect(emitter.emit(25)).toBe(10);
    expect(emitter.aliveCount).toBe(10);
    expect(emitter.stats().dropped).toBe(15);
  });

  it("stops emitting but lets live particles finish", () => {
    const emitter = new ParticleEmitter({ rate: 60, lifetime: [0.5, 0.5] });
    emitter.play();
    run(emitter, 0.2);
    const alive = emitter.aliveCount;
    emitter.stop();
    expect(emitter.playing).toBe(false);
    run(emitter, 0.1);
    expect(emitter.aliveCount).toBeGreaterThan(0);
    expect(emitter.aliveCount).toBeLessThanOrEqual(alive);
    run(emitter, 1);
    expect(emitter.aliveCount).toBe(0);
  });

  it("clears everything immediately", () => {
    const emitter = new ParticleEmitter({ rate: 100, lifetime: [10, 10] });
    emitter.play();
    run(emitter, 0.5);
    emitter.clear();
    expect(emitter.aliveCount).toBe(0);
    expect(emitter.playing).toBe(false);
  });

  it("stops at its duration unless looping", () => {
    const once = new ParticleEmitter({ rate: 60, duration: 0.5, loop: false, lifetime: [0.1, 0.1] });
    once.play();
    run(once, 1);
    expect(once.playing).toBe(false);

    const looping = new ParticleEmitter({ rate: 60, duration: 0.5, loop: true, lifetime: [0.1, 0.1] });
    looping.play();
    run(looping, 2);
    expect(looping.playing).toBe(true);
  });

  it("validates its options", () => {
    expect(() => new ParticleEmitter({ capacity: 0 })).toThrow(/at least 1/);
    expect(() => new ParticleEmitter({ rate: -1 })).toThrow(/must not be negative/);
    expect(() => new ParticleEmitter({ burst: 1.5 })).toThrow(/non-negative whole number/);
    expect(() => new ParticleEmitter({ lifetime: [0, 1] })).toThrow(/positive \[min, max\]/);
    expect(() => new ParticleEmitter({ lifetime: [2, 1] })).toThrow(/positive \[min, max\]/);
    expect(() => new ParticleEmitter({ speed: [5, 1] })).toThrow(/ordered \[min, max\]/);
    expect(() => new ParticleEmitter({ duration: 0 })).toThrow(/must be positive/);
    expect(() => new ParticleEmitter({ trail: { segments: 257 } })).toThrow(/\[0, 256\]/);
    expect(() => new ParticleEmitter({ trail: { minDistance: -1 } })).toThrow(/non-negative/);
    expect(() => new ParticleEmitter({ collision: { query: () => undefined, restitution: 2 } })).toThrow(/\[0, 1\]/);
    expect(() => new ParticleEmitter().update(-1)).toThrow(/non-negative delta/);
    expect(() => new ParticleEmitter().burst(-1)).toThrow(/non-negative whole number/);
  });
});

describe("simulation", () => {
  it("accelerates particles under gravity", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 1, speed: [0, 0], gravity: [0, -10, 0], lifetime: [10, 10] });
    emitter.play();
    run(emitter, 1);
    const y = emitter.buffers().positions[1]!;
    // Roughly ½gt², allowing for discrete integration.
    expect(y).toBeLessThan(-4);
    expect(y).toBeGreaterThan(-6);
  });

  it("slows particles under drag", () => {
    const fast = new ParticleEmitter({ rate: 0, burst: 1, speed: [10, 10], gravity: [0, 0, 0], drag: 1, lifetime: [10, 10], seed: 5 });
    const slowed = new ParticleEmitter({ rate: 0, burst: 1, speed: [10, 10], gravity: [0, 0, 0], drag: 0.1, lifetime: [10, 10], seed: 5 });
    fast.play();
    slowed.play();
    run(fast, 1);
    run(slowed, 1);
    const travel = (emitter: ParticleEmitter): number => {
      const p = emitter.buffers().positions;
      return Math.hypot(p[0]!, p[1]!, p[2]!);
    };
    expect(travel(slowed)).toBeLessThan(travel(fast));
  });

  it("expires particles at their lifetime", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 10, lifetime: [0.5, 0.5] });
    emitter.play();
    run(emitter, 0.4);
    expect(emitter.aliveCount).toBe(10);
    run(emitter, 0.3);
    expect(emitter.aliveCount).toBe(0);
    expect(emitter.stats().expired).toBe(10);
  });

  it("keeps the live range contiguous as particles expire", () => {
    // Swap-removal must not leave holes a renderer would draw.
    const emitter = new ParticleEmitter({ rate: 0, burst: 50, lifetime: [0.1, 0.6], seed: 3 });
    emitter.play();
    run(emitter, 0.3);
    const buffers = emitter.buffers();
    expect(buffers.count).toBeGreaterThan(0);
    expect(buffers.count).toBeLessThan(50);
    for (let index = 0; index < buffers.count; index += 1) {
      expect(Number.isFinite(buffers.positions[index * 3]!)).toBe(true);
      expect(buffers.ages[index]!).toBeGreaterThanOrEqual(0);
      expect(buffers.ages[index]!).toBeLessThan(1);
    }
  });

  it("spins particles at their angular speed", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 1, angularSpeed: [2, 2], lifetime: [10, 10] });
    emitter.play();
    const before = emitter.buffers().rotations[0]!;
    run(emitter, 1);
    expect(emitter.buffers().rotations[0]! - before).toBeCloseTo(2, 1);
  });

  it("records bounded trail history without reallocating", () => {
    const emitter = new ParticleEmitter({
      rate: 0, burst: 1, speed: [1, 1], gravity: [0, 0, 0], lifetime: [10, 10],
      shape: { kind: "cone", angle: 0, size: [0, 0, 0] }, trail: { segments: 3, minDistance: 0 },
    });
    emitter.play();
    const first = emitter.buffers();
    emitter.update(0.25);
    emitter.update(0.25);
    emitter.update(0.25);
    const buffers = emitter.buffers();
    expect(buffers.trailPositions).toBe(first.trailPositions);
    expect(buffers.trailSegments).toBe(3);
    expect(buffers.trailCounts[0]).toBe(3);
    expect(buffers.trailPositions[1]).toBeCloseTo(buffers.positions[1]!, 5);
    expect(buffers.trailPositions[4]!).toBeLessThan(buffers.trailPositions[1]!);
  });

  it("bounces from collision queries and counts the contact", () => {
    const emitter = new ParticleEmitter({
      rate: 0, burst: 1, speed: [0, 0], gravity: [0, -10, 0], lifetime: [10, 10],
      collision: {
        query: (from, to) => from[1] >= 0 && to[1] < 0 ? { point: [to[0], 0, to[2]], normal: [0, 1, 0] } : undefined,
        response: "bounce", restitution: 1,
      },
    });
    emitter.setOrigin([0, 1, 0]);
    emitter.play();
    emitter.update(0.5);
    expect(emitter.buffers().positions[1]).toBeCloseTo(0, 5);
    emitter.update(0.1);
    expect(emitter.buffers().positions[1]!).toBeGreaterThan(0);
    expect(emitter.stats().collisions).toBe(1);
  });

  it("supports stop and kill collision responses", () => {
    const plane = (_from: readonly [number, number, number], to: readonly [number, number, number]) =>
      to[1] < 0 ? { point: [to[0], 0, to[2]] as const, normal: [0, 1, 0] as const } : undefined;
    const stopped = new ParticleEmitter({ rate: 0, burst: 1, speed: [0, 0], gravity: [0, -10, 0], lifetime: [10, 10], collision: { query: plane, response: "stop" } });
    stopped.setOrigin([0, 1, 0]);
    stopped.play();
    stopped.update(0.5);
    expect(stopped.aliveCount).toBe(1);
    expect(stopped.buffers().positions[1]).toBe(0);

    const killed = new ParticleEmitter({ rate: 0, burst: 1, speed: [0, 0], gravity: [0, -10, 0], lifetime: [10, 10], collision: { query: plane, response: "kill" } });
    killed.setOrigin([0, 1, 0]);
    killed.play();
    killed.update(0.5);
    expect(killed.aliveCount).toBe(0);
    expect(killed.stats()).toMatchObject({ collisions: 1, expired: 1 });
  });

  it("rejects malformed collision results with an actionable error", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 1, collision: { query: () => ({ point: [0, 0, 0], normal: [0, 0, 0] }) } });
    emitter.play();
    expect(() => emitter.update(0.1)).toThrow(/normal cannot be zero/);
  });
});

describe("shapes", () => {
  it("emits from a point by default", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 20, speed: [0, 0], gravity: [0, 0, 0], lifetime: [10, 10] });
    emitter.setOrigin([5, 1, -2]);
    emitter.play();
    const positions = emitter.buffers().positions;
    for (let index = 0; index < 20; index += 1) {
      expect(positions[index * 3]).toBeCloseTo(5, 5);
      expect(positions[index * 3 + 2]).toBeCloseTo(-2, 5);
    }
  });

  it("fills a sphere and a box", () => {
    const sphere = new ParticleEmitter({ rate: 0, burst: 200, speed: [0, 0], gravity: [0, 0, 0], lifetime: [10, 10], shape: { kind: "sphere", size: [2, 2, 2] }, seed: 7 });
    sphere.play();
    const positions = sphere.buffers().positions;
    let maxRadius = 0;
    for (let index = 0; index < 200; index += 1) {
      maxRadius = Math.max(maxRadius, Math.hypot(positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!));
    }
    expect(maxRadius).toBeLessThanOrEqual(2.001);
    expect(maxRadius).toBeGreaterThan(1);

    const box = new ParticleEmitter({ rate: 0, burst: 100, speed: [0, 0], gravity: [0, 0, 0], lifetime: [10, 10], shape: { kind: "box", size: [1, 0.1, 3] }, seed: 8 });
    box.play();
    const boxPositions = box.buffers().positions;
    for (let index = 0; index < 100; index += 1) {
      expect(Math.abs(boxPositions[index * 3 + 1]!)).toBeLessThanOrEqual(0.101);
      expect(Math.abs(boxPositions[index * 3 + 2]!)).toBeLessThanOrEqual(3.001);
    }
  });

  it("directs a cone upward within its angle", () => {
    const emitter = new ParticleEmitter({
      rate: 0, burst: 100, speed: [1, 1], gravity: [0, 0, 0], lifetime: [10, 10],
      shape: { kind: "cone", angle: 15, size: [0, 0, 0] }, seed: 9,
    });
    emitter.play();
    emitter.update(1);
    const positions = emitter.buffers().positions;
    for (let index = 0; index < emitter.aliveCount; index += 1) {
      const [x, y, z] = [positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!];
      expect(y).toBeGreaterThan(0);
      // Within the cone's half-angle, with a little slack for the tangent.
      expect(Math.atan2(Math.hypot(x, z), y)).toBeLessThan((16 * Math.PI) / 180);
    }
  });
});

describe("space", () => {
  it("leaves world-space particles behind when the emitter moves", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 5, speed: [0, 0], gravity: [0, 0, 0], lifetime: [10, 10], space: "world" });
    emitter.play();
    emitter.setOrigin([100, 0, 0]);
    expect(emitter.buffers().positions[0]).toBeCloseTo(0, 5);
  });

  it("carries local-space particles with the emitter", () => {
    // What makes a torch flame stay attached rather than trailing behind.
    const emitter = new ParticleEmitter({ rate: 0, burst: 5, speed: [0, 0], gravity: [0, 0, 0], lifetime: [10, 10], space: "local" });
    emitter.play();
    emitter.setOrigin([100, 0, 0]);
    expect(emitter.buffers().positions[0]).toBeCloseTo(100, 4);
  });

  it("carries local-space trail history with the emitter", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 1, speed: [1, 1], gravity: [0, 0, 0], lifetime: [10, 10], space: "local", trail: { segments: 4, minDistance: 0 } });
    emitter.play();
    emitter.update(0.1);
    const before = emitter.buffers().trailPositions[0]!;
    emitter.setOrigin([10, 0, 0]);
    expect(emitter.buffers().trailPositions[0]).toBeCloseTo(before + 10, 5);
  });
});

describe("appearance", () => {
  it("evaluates size and colour over lifetime", () => {
    const emitter = new ParticleEmitter({
      rate: 0, burst: 1, lifetime: [1, 1], gravity: [0, 0, 0], speed: [0, 0],
      size: curve([{ time: 0, value: 0.1 }, { time: 1, value: 2 }]),
      color: gradientBetween([1, 0, 0, 1], [0, 0, 1, 0]),
    });
    emitter.play();
    const start = emitter.buffers();
    expect(start.sizes[0]).toBeCloseTo(0.1, 5);
    expect(start.colors[0]).toBeCloseTo(1, 5);

    emitter.update(0.5);
    const middle = emitter.buffers();
    expect(middle.sizes[0]).toBeCloseTo(1.05, 2);
    expect(middle.colors[3]).toBeCloseTo(0.5, 2);
  });

  it("fades out by default", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 1, lifetime: [1, 1], gravity: [0, 0, 0] });
    emitter.play();
    expect(emitter.buffers().colors[3]).toBeCloseTo(1, 5);
    emitter.update(0.75);
    expect(emitter.buffers().colors[3]).toBeCloseTo(0.25, 5);
  });

  it("reports normalized age for texture sheets", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 1, lifetime: [2, 2], gravity: [0, 0, 0] });
    emitter.play();
    emitter.update(1);
    expect(emitter.buffers().ages[0]).toBeCloseTo(0.5, 5);
  });
});

describe("determinism and allocation", () => {
  it("produces identical output for the same seed", () => {
    const sample = (seed: number): number[] => {
      const emitter = new ParticleEmitter({ rate: 100, lifetime: [0.5, 1.5], shape: { kind: "sphere", size: [1, 1, 1] }, seed });
      emitter.play();
      run(emitter, 1);
      return [...emitter.buffers().positions.slice(0, 30)];
    };
    expect(sample(42)).toEqual(sample(42));
    expect(sample(43)).not.toEqual(sample(42));
  });

  it("reuses its buffers, so a running system allocates nothing", () => {
    const emitter = new ParticleEmitter({ rate: 200, lifetime: [0.5, 1] });
    emitter.play();
    const first = emitter.buffers();
    run(emitter, 1);
    const second = emitter.buffers();
    expect(second.positions).toBe(first.positions);
    expect(second.colors).toBe(first.colors);
  });

  it("reseeds for a reproducible replay", () => {
    const emitter = new ParticleEmitter({ rate: 0, burst: 5, seed: 1 });
    emitter.play();
    const first = [...emitter.buffers().positions.slice(0, 15)];
    emitter.clear();
    emitter.reseed(1);
    emitter.play();
    expect([...emitter.buffers().positions.slice(0, 15)]).toEqual(first);
  });

  it("handles ten thousand particles", () => {
    const emitter = new ParticleEmitter({ capacity: 10_000, rate: 20_000, lifetime: [1, 2], seed: 11 });
    emitter.play();
    run(emitter, 1);
    expect(emitter.aliveCount).toBeGreaterThan(5_000);
    const buffers = emitter.buffers();
    expect(buffers.positions).toHaveLength(30_000);
    expect(Number.isFinite(buffers.positions[0]!)).toBe(true);
  });
});

describe("ParticleSystemPool", () => {
  const factory = () => new ParticleEmitter({ capacity: 64, rate: 0, burst: 20, duration: 0.2, loop: false, lifetime: [0.2, 0.3] });

  it("reuses emitters rather than allocating one per explosion", () => {
    // Effects spawn exactly when a game is already busy — the worst possible
    // time to allocate a thousand-particle buffer.
    const pool = new ParticleSystemPool(factory, { prewarm: 2 });
    expect(pool.idleCount).toBe(2);
    const first = pool.spawn([0, 0, 0])!;
    expect(pool.activeCount).toBe(1);
    expect(pool.idleCount).toBe(1);

    for (let step = 0; step < 60; step += 1) pool.update(1 / 60);
    expect(pool.activeCount).toBe(0);
    expect(pool.spawn([1, 0, 0])).toBe(first);
  });

  it("refuses to exceed its active limit", () => {
    const pool = new ParticleSystemPool(factory, { maxActive: 2 });
    expect(pool.spawn([0, 0, 0])).toBeDefined();
    expect(pool.spawn([0, 0, 0])).toBeDefined();
    expect(pool.spawn([0, 0, 0])).toBeUndefined();
  });

  it("exposes active systems and clears", () => {
    const pool = new ParticleSystemPool(factory);
    pool.spawn([0, 0, 0]);
    expect(pool.active()).toHaveLength(1);
    pool.clear();
    expect(pool.activeCount).toBe(0);
    expect(pool.idleCount).toBe(1);
  });

  it("validates its options", () => {
    expect(() => new ParticleSystemPool(factory, { prewarm: -1 })).toThrow(/non-negative whole number/);
    expect(() => new ParticleSystemPool(factory, { maxActive: 0 })).toThrow(/at least one system/);
  });
});
