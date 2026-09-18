/** GPU particle systems.
 *
 * A `GpuParticleSystem` has the same shape as `ParticleEmitter` — `play`,
 * `stop`, `burst`, `update`, `setOrigin`, `stats` — but the particles never
 * exist in JavaScript. The host (the Rust renderer, `vapour-render`'s
 * `surface/particles.rs`) simulates them in a compute pass and draws them
 * with an indirect draw, so ten thousand particles cost this side one small
 * call per frame: "spawn N at this origin, advance by dt".
 *
 * Emission scheduling — rate, fractional debt, bursts, duration, looping —
 * stays here, exactly as `ParticleEmitter` does it, so the two agree on
 * *when* particles appear; the renderer's spawn sampling mirrors
 * `ParticleEmitter.#spawn` so they also agree on *where* (a real-device test
 * in the renderer checks a burst against `ParticleEmitter`'s output).
 *
 * When the host cannot simulate on the GPU — a headless host, a stale WASM
 * build — the system falls back to an ordinary `ParticleEmitter`, exposed as
 * `emitter`, and behaves identically from the caller's side.
 */
import { evaluateCurve, evaluateGradient, type Curve, type Gradient } from "@vapour/math";
import { ParticleEmitter, type EmitterShape, type ParticleEmitterOptions } from "./particles.js";

/** Samples per look-up table; mirrors `PARTICLE_LUT_SAMPLES` in the renderer. */
export const GPU_PARTICLE_LUT_SAMPLES = 32;
/** Mirrors `MAX_PARTICLE_CAPACITY` in the renderer. */
export const GPU_PARTICLE_MAX_CAPACITY = 1 << 20;

/** What the renderer needs to create a system. Mirrors
 * `ParticleSystemDescriptor` in `vapour-render` (its JSON form). */
export interface GpuParticleDescriptor {
  readonly capacity: number;
  readonly lifetime: readonly [number, number];
  readonly speed: readonly [number, number];
  readonly gravity: readonly [number, number, number];
  readonly drag: number;
  readonly shape: EmitterShape["kind"];
  readonly shapeSize: readonly [number, number, number];
  readonly coneAngle: number;
  readonly angularSpeed: readonly [number, number];
  readonly seed: number;
  readonly blend: "alpha" | "additive";
  /** `GPU_PARTICLE_LUT_SAMPLES` sizes over normalized lifetime. */
  readonly sizeLut: readonly number[];
  /** `GPU_PARTICLE_LUT_SAMPLES` RGBA colours over normalized lifetime. */
  readonly colorLut: readonly number[];
}

/** Mirrors `ParticleSystemStats` in the renderer: exact on the CPU path,
 * `null` where the GPU path never reads its population back. */
export interface GpuParticleHostStats {
  readonly gpu: boolean;
  readonly requested: number;
  readonly alive: number | null;
  readonly emitted: number | null;
  readonly expired: number | null;
  readonly dropped: number | null;
}

/** The slice of a render host a GPU particle system drives. */
export interface GpuParticleHost {
  /** Whether systems can be created right now (an initialized renderer
   * whose WASM build has particle support). */
  supportsGpuParticles(): boolean;
  createParticleSystem(id: string, descriptor: GpuParticleDescriptor): void;
  updateParticleSystem(id: string, deltaSeconds: number, spawn: number, origin: readonly [number, number, number]): void;
  clearParticleSystem(id: string): void;
  releaseParticleSystem(id: string): boolean;
  particleSystemStats(id: string): GpuParticleHostStats | undefined;
}

export interface GpuParticleSystemOptions extends Omit<ParticleEmitterOptions, "collision" | "trail"> {
  /** How billboards blend into the HDR scene. Additive suits sparks and
   * fire; alpha suits smoke and dust. */
  readonly blend?: "alpha" | "additive";
}

export interface GpuParticleSystemStats {
  readonly mode: "gpu" | "cpu";
  readonly capacity: number;
  /** Spawns this side asked for. */
  readonly requested: number;
  /** Exact on the CPU path; on the GPU path an upper bound (see `aliveCount`). */
  readonly alive: number;
  readonly emitted: number | undefined;
  readonly expired: number | undefined;
  readonly dropped: number | undefined;
}

const DEFAULTS = {
  capacity: 1024,
  rate: 50,
  burst: 0,
  lifetime: [1, 2] as const,
  speed: [1, 3] as const,
  gravity: [0, -9.81, 0] as const,
  drag: 1,
  angularSpeed: [0, 0] as const,
  seed: 1,
  loop: true,
  blend: "alpha" as const,
};

/** Bakes the size curve and colour gradient into the renderer's tables. */
export function bakeParticleLuts(size: Curve | undefined, color: Gradient | undefined): { sizeLut: number[]; colorLut: number[] } {
  const sizeLut: number[] = [];
  const colorLut: number[] = [];
  for (let index = 0; index < GPU_PARTICLE_LUT_SAMPLES; index += 1) {
    const t = index / (GPU_PARTICLE_LUT_SAMPLES - 1);
    sizeLut.push(size ? evaluateCurve(size, t) : 1);
    // The same defaults `ParticleEmitter.buffers()` uses: unit size, white
    // fading out over the lifetime.
    colorLut.push(...(color ? evaluateGradient(color, t) : [1, 1, 1, 1 - t]));
  }
  return { sizeLut, colorLut };
}

/** Turns emitter options into the renderer's descriptor, validating the
 * same way `ParticleEmitter` does so both paths reject the same input. */
export function gpuParticleDescriptor(options: GpuParticleSystemOptions): GpuParticleDescriptor {
  const capacity = options.capacity ?? DEFAULTS.capacity;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > GPU_PARTICLE_MAX_CAPACITY) throw new Error(`A GPU particle system needs a capacity in [1, ${GPU_PARTICLE_MAX_CAPACITY}].`);
  // The emitter's constructor validates everything else, so a rejected
  // option throws the same message here as on the CPU path. Capacity 1
  // keeps the throwaway instance from allocating the real pool.
  new ParticleEmitter({ ...options, capacity: 1 });
  const shape = options.shape ?? { kind: "point" };
  const size = shape.size ?? [1, 1, 1];
  return {
    capacity,
    lifetime: options.lifetime ?? DEFAULTS.lifetime,
    speed: options.speed ?? DEFAULTS.speed,
    gravity: options.gravity ?? DEFAULTS.gravity,
    drag: options.drag ?? DEFAULTS.drag,
    shape: shape.kind,
    shapeSize: [size[0], size[1], size[2]],
    coneAngle: shape.angle ?? 25,
    angularSpeed: options.angularSpeed ?? DEFAULTS.angularSpeed,
    seed: (options.seed ?? DEFAULTS.seed) >>> 0,
    blend: options.blend ?? DEFAULTS.blend,
    ...bakeParticleLuts(options.size, options.color),
  };
}

let nextSystemId = 0;

/**
 * One particle system simulated by the renderer.
 *
 * Mirrors `ParticleEmitter`'s API. `update` is the only per-frame call; it
 * schedules emission here and hands the host one spawn count and delta.
 */
export class GpuParticleSystem {
  readonly id: string;
  readonly capacity: number;
  /** Which path this system runs on, fixed at construction. */
  readonly mode: "gpu" | "cpu";
  /** The CPU fallback, present only in `"cpu"` mode. Its `buffers()` are
   * the caller's to draw. */
  readonly emitter: ParticleEmitter | undefined;

  readonly #host: GpuParticleHost;
  readonly #rate: number;
  readonly #burst: number;
  readonly #lifetimeMax: number;
  readonly #duration: number | undefined;
  readonly #loop: boolean;
  #origin: readonly [number, number, number] = [0, 0, 0];
  #playing = false;
  #elapsed = 0;
  #emissionDebt = 0;
  #pendingSpawn = 0;
  #requested = 0;
  #clock = 0;
  /** Recent spawn batches as `[clock, count]`, for the alive upper bound. */
  #batches: [number, number][] = [];
  #released = false;

  constructor(host: GpuParticleHost, options: GpuParticleSystemOptions = {}, id = `particles:${nextSystemId++}`) {
    const descriptor = gpuParticleDescriptor(options);
    this.#host = host;
    this.id = id;
    this.capacity = descriptor.capacity;
    this.#rate = options.rate ?? DEFAULTS.rate;
    this.#burst = options.burst ?? DEFAULTS.burst;
    this.#lifetimeMax = descriptor.lifetime[1];
    this.#loop = options.loop ?? DEFAULTS.loop;
    if (options.duration !== undefined) this.#duration = options.duration;
    if (host.supportsGpuParticles()) {
      host.createParticleSystem(id, descriptor);
      this.mode = "gpu";
    } else {
      this.mode = "cpu";
      this.emitter = new ParticleEmitter(options);
    }
  }

  get playing(): boolean {
    return this.emitter ? this.emitter.playing : this.#playing;
  }

  /** Live particles. Exact on the CPU path. On the GPU path the population
   * never leaves the device, so this is an upper bound: everything spawned
   * less than the maximum lifetime ago, capped at capacity. It reaches zero
   * exactly when the system is certainly empty, which is what pooling needs. */
  get aliveCount(): number {
    if (this.emitter) return this.emitter.aliveCount;
    let alive = 0;
    for (const [time, count] of this.#batches) if (this.#clock - time < this.#lifetimeMax) alive += count;
    return Math.min(alive, this.capacity);
  }

  setOrigin(origin: readonly [number, number, number]): void {
    if (!origin.every(Number.isFinite)) throw new Error("A particle origin must be finite.");
    this.#origin = [origin[0], origin[1], origin[2]];
    this.emitter?.setOrigin(origin);
  }

  play(): void {
    if (this.emitter) {
      this.emitter.play();
      return;
    }
    this.#playing = true;
    this.#elapsed = 0;
    if (this.#burst > 0) this.emit(this.#burst);
  }

  /** Stops emitting. Live particles finish their lifetimes. */
  stop(): void {
    this.#playing = false;
    this.emitter?.stop();
  }

  /** Stops and removes every particle immediately. */
  clear(): void {
    this.#playing = false;
    this.#emissionDebt = 0;
    this.#elapsed = 0;
    this.#pendingSpawn = 0;
    this.#batches = [];
    if (this.emitter) this.emitter.clear();
    else this.#host.clearParticleSystem(this.id);
  }

  burst(count = this.#burst): number {
    if (!Number.isInteger(count) || count < 0) throw new Error("A burst count must be a non-negative whole number.");
    return this.emit(count);
  }

  /** Queues particles for the next `update`. Returns how many were queued;
   * the renderer drops what does not fit, which its stats report. */
  emit(count: number): number {
    if (this.emitter) return this.emitter.emit(count);
    this.#pendingSpawn += count;
    return count;
  }

  /** Advances the simulation: schedules emission and steps the host. */
  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("A particle update requires a finite, non-negative delta.");
    if (this.emitter) {
      this.emitter.update(deltaSeconds);
      return;
    }
    if (this.#released) throw new Error(`Particle system '${this.id}' has been released.`);
    if (deltaSeconds === 0 && this.#pendingSpawn === 0) return;

    if (this.#playing && deltaSeconds > 0) {
      this.#elapsed += deltaSeconds;
      if (this.#duration !== undefined && this.#elapsed >= this.#duration) {
        if (this.#loop) this.#elapsed -= this.#duration;
        else this.#playing = false;
      }
    }
    if (this.#playing && this.#rate > 0) {
      this.#emissionDebt += this.#rate * deltaSeconds;
      const whole = Math.floor(this.#emissionDebt);
      if (whole > 0) {
        this.#emissionDebt -= whole;
        this.#pendingSpawn += whole;
      }
    }
    const spawn = Math.min(this.#pendingSpawn, this.capacity);
    this.#pendingSpawn = 0;
    this.#host.updateParticleSystem(this.id, deltaSeconds, spawn, this.#origin);
    this.#clock += deltaSeconds;
    this.#requested += spawn;
    if (spawn > 0) this.#batches.push([this.#clock, spawn]);
    // Batches older than any lifetime can never count again.
    while (this.#batches.length > 0 && this.#clock - this.#batches[0]![0] >= this.#lifetimeMax) this.#batches.shift();
  }

  stats(): GpuParticleSystemStats {
    if (this.emitter) {
      const stats = this.emitter.stats();
      return { mode: "cpu", capacity: this.capacity, requested: stats.emitted + stats.dropped, alive: stats.alive, emitted: stats.emitted, expired: stats.expired, dropped: stats.dropped };
    }
    const host = this.#host.particleSystemStats(this.id);
    return {
      mode: "gpu",
      capacity: this.capacity,
      requested: host?.requested ?? this.#requested,
      alive: host?.alive ?? this.aliveCount,
      emitted: host?.emitted ?? undefined,
      expired: host?.expired ?? undefined,
      dropped: host?.dropped ?? undefined,
    };
  }

  /** Frees the renderer's buffers. The system cannot be used afterwards. */
  release(): void {
    if (this.#released) return;
    this.#released = true;
    if (!this.emitter) this.#host.releaseParticleSystem(this.id);
  }
}
