/** 2D particles: a thin adapter over the existing particle system
 * (`particles/particles.js`), not a second implementation of it.
 *
 * `ParticleEmitter` already simulates in 3D with flat typed-array buffers,
 * which is exactly what a 2D game wants too — a 2D particle is just a 3D
 * particle whose z stays pinned at 0. Gravity and the emitter's origin are
 * easy to constrain through its existing options. Initial *direction*
 * is not: every built-in shape but `box` samples a full 3D unit sphere for
 * it (see `#sampleShape` in particles.ts), so a point/sphere/cone emitter
 * would drift off the XY plane even with 2D gravity. Rather than reimplement
 * emission (out of bounds for this module, and `particles/**` is read-only
 * here), this wraps the one call that can observe drift — `update()` — and
 * re-flattens z on the live position/trail buffers it already returns by
 * reference. Every other member is the real `ParticleEmitter`, unmodified.
 */
import {
  ParticleEmitter,
  type EmitterShape,
  type ParticleBuffers,
  type ParticleEmitterOptions,
  type ParticleStats,
} from "../particles/particles.js";

export interface EmitterShape2D {
  readonly kind: EmitterShape["kind"];
  /** Sphere/cone radius (x); box half-extents as `[x, y]`. */
  readonly size?: readonly [number, number];
  readonly angle?: number;
}

export interface ParticleEmitter2DOptions
  extends Omit<ParticleEmitterOptions, "gravity" | "shape"> {
  /** Constant 2D acceleration. Defaults to `[0, -9.81]` — screen-down, using
   * the engine's Y-up convention (the same one `ParticleEmitter` already
   * defaults to in 3D). */
  readonly gravity?: readonly [number, number];
  readonly shape?: EmitterShape2D;
}

/** A `ParticleEmitter` constrained to the XY plane. Construct with
 * {@link createParticleEmitter2D}. */
export class ParticleEmitter2D {
  readonly #emitter: ParticleEmitter;

  /** @internal use {@link createParticleEmitter2D}. */
  constructor(emitter: ParticleEmitter) {
    this.#emitter = emitter;
  }

  get capacity(): number {
    return this.#emitter.capacity;
  }

  get playing(): boolean {
    return this.#emitter.playing;
  }

  get aliveCount(): number {
    return this.#emitter.aliveCount;
  }

  setOrigin(origin: readonly [number, number]): void {
    this.#emitter.setOrigin([origin[0], origin[1], 0]);
  }

  play(): void {
    this.#emitter.play();
  }

  stop(): void {
    this.#emitter.stop();
  }

  clear(): void {
    this.#emitter.clear();
  }

  burst(count?: number): number {
    return this.#emitter.burst(count);
  }

  emit(count: number): number {
    return this.#emitter.emit(count);
  }

  reseed(seed: number): void {
    this.#emitter.reseed(seed);
  }

  stats(): ParticleStats {
    return this.#emitter.stats();
  }

  /** Advances the simulation, then flattens every live particle (and trail
   * point) back onto z = 0 — undoing whatever 3D drift the underlying
   * emitter's shape sampling introduced. */
  update(deltaSeconds: number): void {
    this.#emitter.update(deltaSeconds);
    const buffers = this.#emitter.buffers();
    for (let index = 0; index < buffers.count; index += 1)
      buffers.positions[index * 3 + 2] = 0;
    const trailLength = buffers.trailSegments * 3;
    if (trailLength > 0) {
      for (let index = 0; index < buffers.count; index += 1) {
        const count = buffers.trailCounts[index]!;
        const base = index * trailLength;
        for (let segment = 0; segment < count; segment += 1)
          buffers.trailPositions[base + segment * 3 + 2] = 0;
      }
    }
  }

  /** Live particle buffers — z is guaranteed 0 after each {@link update}. */
  buffers(): ParticleBuffers {
    return this.#emitter.buffers();
  }
}

/** Builds a {@link ParticleEmitter2D}: gravity and emitter shape have their Z
 * component forced to 0, and every other option — lifetime, rate, colour,
 * drag, trails, collision — passes straight through to `ParticleEmitter`. */
export function createParticleEmitter2D(
  options: ParticleEmitter2DOptions = {},
): ParticleEmitter2D {
  const { gravity: gravity2d, shape: shape2d, ...rest } = options;
  const gravity = gravity2d ?? [0, -9.81];
  const shape: EmitterShape | undefined = shape2d && {
    kind: shape2d.kind,
    ...(shape2d.angle === undefined ? {} : { angle: shape2d.angle }),
    ...(shape2d.size === undefined
      ? {}
      : { size: [shape2d.size[0], shape2d.size[1], 0] as const }),
  };
  const emitter = new ParticleEmitter({
    ...rest,
    gravity: [gravity[0], gravity[1], 0],
    ...(shape ? { shape } : {}),
  });
  const emitter2d = new ParticleEmitter2D(emitter);
  emitter2d.setOrigin([0, 0]);
  return emitter2d;
}

/** Reads a 2D emitter's live particles as `[x, y]` pairs. */
export function planarPositions(
  buffers: ParticleBuffers,
): readonly (readonly [number, number])[] {
  const points: [number, number][] = [];
  for (let index = 0; index < buffers.count; index += 1)
    points.push([buffers.positions[index * 3]!, buffers.positions[index * 3 + 1]!]);
  return points;
}
