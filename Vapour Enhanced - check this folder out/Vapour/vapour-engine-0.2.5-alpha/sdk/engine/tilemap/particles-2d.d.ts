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
import { ParticleEmitter, type EmitterShape, type ParticleBuffers, type ParticleEmitterOptions, type ParticleStats } from "../particles/particles.js";
export interface EmitterShape2D {
    readonly kind: EmitterShape["kind"];
    /** Sphere/cone radius (x); box half-extents as `[x, y]`. */
    readonly size?: readonly [number, number];
    readonly angle?: number;
}
export interface ParticleEmitter2DOptions extends Omit<ParticleEmitterOptions, "gravity" | "shape"> {
    /** Constant 2D acceleration. Defaults to `[0, -9.81]` — screen-down, using
     * the engine's Y-up convention (the same one `ParticleEmitter` already
     * defaults to in 3D). */
    readonly gravity?: readonly [number, number];
    readonly shape?: EmitterShape2D;
}
/** A `ParticleEmitter` constrained to the XY plane. Construct with
 * {@link createParticleEmitter2D}. */
export declare class ParticleEmitter2D {
    #private;
    /** @internal use {@link createParticleEmitter2D}. */
    constructor(emitter: ParticleEmitter);
    get capacity(): number;
    get playing(): boolean;
    get aliveCount(): number;
    setOrigin(origin: readonly [number, number]): void;
    play(): void;
    stop(): void;
    clear(): void;
    burst(count?: number): number;
    emit(count: number): number;
    reseed(seed: number): void;
    stats(): ParticleStats;
    /** Advances the simulation, then flattens every live particle (and trail
     * point) back onto z = 0 — undoing whatever 3D drift the underlying
     * emitter's shape sampling introduced. */
    update(deltaSeconds: number): void;
    /** Live particle buffers — z is guaranteed 0 after each {@link update}. */
    buffers(): ParticleBuffers;
}
/** Builds a {@link ParticleEmitter2D}: gravity and emitter shape have their Z
 * component forced to 0, and every other option — lifetime, rate, colour,
 * drag, trails, collision — passes straight through to `ParticleEmitter`. */
export declare function createParticleEmitter2D(options?: ParticleEmitter2DOptions): ParticleEmitter2D;
/** Reads a 2D emitter's live particles as `[x, y]` pairs. */
export declare function planarPositions(buffers: ParticleBuffers): readonly (readonly [number, number])[];
//# sourceMappingURL=particles-2d.d.ts.map