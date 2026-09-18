/** Particle simulation.
 *
 * Explosions, smoke, sparks, weather, dust, fire, magic — all of them are the
 * same thing: many short-lived points with a position, a velocity, and
 * properties that change over their lifetime. The design consequence is that a
 * particle system is a *data layout* problem before it is a visual one.
 *
 * So particles live in flat typed arrays, not objects. Ten thousand particle
 * objects allocate ten thousand times, scatter across the heap, and hand the
 * garbage collector a frame-time spike exactly when the explosion goes off. The
 * arrays here are allocated once at the emitter's capacity and reused forever;
 * a running system allocates nothing.
 *
 * Simulation is deterministic given a seed, so an effect looks the same on
 * every machine and can be replicated by seed rather than by particle.
 */
import { type Curve, type Gradient } from "@vapour/math";
export interface EmitterShape {
    readonly kind: "point" | "sphere" | "box" | "cone";
    /** Sphere or cone radius; box half-extents. */
    readonly size?: readonly [number, number, number];
    /** Cone half-angle in degrees. */
    readonly angle?: number;
}
export interface ParticleEmitterOptions {
    /** Maximum live particles. Buffers are sized to this once. */
    readonly capacity?: number;
    /** Particles emitted per second while playing. */
    readonly rate?: number;
    /** Particles emitted at once when the system starts or `burst()` is called. */
    readonly burst?: number;
    /** Lifetime range in seconds, as `[min, max]`. */
    readonly lifetime?: readonly [number, number];
    /** Initial speed range, as `[min, max]`. */
    readonly speed?: readonly [number, number];
    readonly shape?: EmitterShape;
    /** Constant acceleration. Gravity, wind, an updraft. */
    readonly gravity?: readonly [number, number, number];
    /** Velocity retained per second; below 1 the particle slows. */
    readonly drag?: number;
    /** Size over normalized lifetime. */
    readonly size?: Curve;
    /** Colour and alpha over normalized lifetime. */
    readonly color?: Gradient;
    /** Rotation speed range in radians per second. */
    readonly angularSpeed?: readonly [number, number];
    /** Simulate in world space (default) or follow the emitter. */
    readonly space?: "world" | "local";
    readonly seed?: number;
    /** Stop emitting after this long. Omit to emit forever. */
    readonly duration?: number;
    readonly loop?: boolean;
    readonly trail?: {
        readonly segments?: number;
        readonly minDistance?: number;
    };
    readonly collision?: ParticleCollisionOptions;
}
export interface ParticleCollisionHit {
    readonly point: readonly [number, number, number];
    readonly normal: readonly [number, number, number];
}
export interface ParticleCollisionOptions {
    readonly query: (from: readonly [number, number, number], to: readonly [number, number, number]) => ParticleCollisionHit | undefined;
    readonly response?: "bounce" | "kill" | "stop";
    readonly restitution?: number;
}
export interface ParticleStats {
    readonly alive: number;
    readonly capacity: number;
    readonly emitted: number;
    readonly expired: number;
    /** Emissions dropped because the buffer was full. */
    readonly dropped: number;
    readonly collisions: number;
}
/** The buffers a renderer reads. Only the first `count` entries are live. */
export interface ParticleBuffers {
    readonly count: number;
    /** `[x, y, z]` per particle. */
    readonly positions: Float32Array;
    /** Size per particle. */
    readonly sizes: Float32Array;
    /** `[r, g, b, a]` per particle. */
    readonly colors: Float32Array;
    /** Rotation in radians per particle. */
    readonly rotations: Float32Array;
    /** Normalized age in `[0, 1]`, for texture sheet animation. */
    readonly ages: Float32Array;
    /** `trailSegments * 3` values per particle, newest point first. */
    readonly trailPositions: Float32Array;
    readonly trailCounts: Uint16Array;
    readonly trailSegments: number;
}
/**
 * One particle system.
 *
 * `update` advances the simulation; `buffers()` exposes the result for a
 * renderer. Nothing here draws, which is what lets the same emitter feed the
 * WebGPU renderer, a 2D canvas, or a test.
 */
export declare class ParticleEmitter {
    #private;
    readonly capacity: number;
    constructor(options?: ParticleEmitterOptions);
    get playing(): boolean;
    get aliveCount(): number;
    /** Where new particles appear. Moved each frame to follow an entity. */
    setOrigin(origin: readonly [number, number, number]): void;
    play(): void;
    /** Stops emitting. Live particles finish their lifetimes. */
    stop(): void;
    /** Stops and removes every particle immediately. */
    clear(): void;
    /** Emits a burst now, regardless of the rate. */
    burst(count?: number): number;
    /** Emits particles, returning how many actually fit. */
    emit(count: number): number;
    /** Advances the simulation. */
    update(deltaSeconds: number): void;
    /** The current frame's render data. Valid until the next `update`. */
    buffers(): ParticleBuffers;
    stats(): ParticleStats;
    /** Restarts the sequence, so a replay produces identical particles. */
    reseed(seed: number): void;
}
/**
 * A pool of emitters, so an explosion does not allocate one.
 *
 * Effects are spawned at exactly the moments a game is already busy — an
 * impact, a death, a spell — which is the worst possible time to allocate a
 * thousand-particle buffer.
 */
export declare class ParticleSystemPool {
    #private;
    constructor(factory: () => ParticleEmitter, options?: {
        readonly prewarm?: number;
        readonly maxActive?: number;
    });
    get activeCount(): number;
    get idleCount(): number;
    /** Takes an emitter and plays it at a position, or `undefined` when full. */
    spawn(origin: readonly [number, number, number]): ParticleEmitter | undefined;
    /** Advances every active system, retiring those that have finished. */
    update(deltaSeconds: number): void;
    /** Every active system, for a renderer to draw. */
    active(): readonly ParticleEmitter[];
    clear(): void;
}
//# sourceMappingURL=particles.d.ts.map