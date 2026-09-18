import { describe, expect, it, vi } from "vitest";
import { Pool, numberArrayPool } from "./pool.js";

interface Particle { x: number; alive: boolean }

const particlePool = (options: { maxIdle?: number; prewarm?: number; dispose?: (value: Particle) => void } = {}) =>
  new Pool<Particle>({
    create: () => ({ x: 0, alive: false }),
    reset: (value) => { value.x = 0; value.alive = false; },
    ...options,
  });

describe("Pool", () => {
  it("creates on demand and reuses what was released", () => {
    const pool = particlePool();
    const first = pool.acquire();
    first.x = 5;
    pool.release(first);
    const second = pool.acquire();
    expect(second).toBe(first);
    // reset ran, so the reused object is clean.
    expect(second.x).toBe(0);
    expect(pool.stats).toMatchObject({ created: 1, reused: 1, active: 1, idle: 0 });
  });

  it("prewarms so the first frame does not allocate", () => {
    const pool = particlePool({ prewarm: 3 });
    expect(pool.stats).toMatchObject({ idle: 3, created: 3 });
    pool.acquire();
    expect(pool.stats).toMatchObject({ idle: 2, created: 3, reused: 1 });
  });

  it("discards beyond maxIdle so a burst does not pin memory", () => {
    const dispose = vi.fn();
    const pool = particlePool({ maxIdle: 1, dispose });
    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b);
    expect(pool.stats).toMatchObject({ idle: 1, discarded: 1 });
    expect(dispose).toHaveBeenCalledExactlyOnceWith(b);
  });

  it("refuses a double release and a foreign object", () => {
    const pool = particlePool();
    const value = pool.acquire();
    pool.release(value);
    expect(() => pool.release(value)).toThrow(/released twice or never acquired/);
    expect(() => pool.release({ x: 0, alive: false })).toThrow(/did not currently own/);
  });

  it("releases through use() even when the body throws", () => {
    const pool = particlePool();
    expect(() => pool.use(() => { throw new Error("boom"); })).toThrow(/boom/);
    expect(pool.stats).toMatchObject({ active: 0, idle: 1 });
    expect(pool.use((value) => { value.x = 3; return value.x; })).toBe(3);
  });

  it("releases everything outstanding", () => {
    const pool = particlePool();
    pool.acquire();
    pool.acquire();
    pool.releaseAll();
    expect(pool.stats).toMatchObject({ active: 0, idle: 2 });
  });

  it("trims idle instances down to a keep count", () => {
    const dispose = vi.fn();
    const pool = particlePool({ prewarm: 4, dispose });
    expect(pool.trim(1)).toBe(3);
    expect(pool.stats.idle).toBe(1);
    expect(dispose).toHaveBeenCalledTimes(3);
    expect(() => pool.trim(-1)).toThrow(/non-negative whole number/);
  });

  it("clears active and idle instances alike", () => {
    const dispose = vi.fn();
    const pool = particlePool({ dispose });
    pool.acquire();
    pool.release(pool.acquire());
    pool.clear();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(pool.stats).toMatchObject({ active: 0, idle: 0 });
  });

  it("validates its options", () => {
    expect(() => new Pool<Particle>({ create: undefined as never })).toThrow(/create function/);
    expect(() => particlePool({ maxIdle: 0 })).toThrow(/maxIdle must be positive/);
    expect(() => particlePool({ prewarm: -1 })).toThrow(/non-negative whole number/);
  });

  it("pools zeroed numeric scratch arrays", () => {
    const pool = numberArrayPool(3, { prewarm: 1 });
    const value = pool.acquire();
    expect(value).toEqual([0, 0, 0]);
    value[0] = 9;
    pool.release(value);
    expect(pool.acquire()).toEqual([0, 0, 0]);
    expect(() => numberArrayPool(0)).toThrow(/positive whole length/);
  });
});
