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
import { type Curve, type Gradient } from "@vapour/math";
import { ParticleEmitter, type EmitterShape, type ParticleEmitterOptions } from "./particles.js";
/** Samples per look-up table; mirrors `PARTICLE_LUT_SAMPLES` in the renderer. */
export declare const GPU_PARTICLE_LUT_SAMPLES = 32;
/** Mirrors `MAX_PARTICLE_CAPACITY` in the renderer. */
export declare const GPU_PARTICLE_MAX_CAPACITY: number;
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
/** Bakes the size curve and colour gradient into the renderer's tables. */
export declare function bakeParticleLuts(size: Curve | undefined, color: Gradient | undefined): {
    sizeLut: number[];
    colorLut: number[];
};
/** Turns emitter options into the renderer's descriptor, validating the
 * same way `ParticleEmitter` does so both paths reject the same input. */
export declare function gpuParticleDescriptor(options: GpuParticleSystemOptions): GpuParticleDescriptor;
/**
 * One particle system simulated by the renderer.
 *
 * Mirrors `ParticleEmitter`'s API. `update` is the only per-frame call; it
 * schedules emission here and hands the host one spawn count and delta.
 */
export declare class GpuParticleSystem {
    #private;
    readonly id: string;
    readonly capacity: number;
    /** Which path this system runs on, fixed at construction. */
    readonly mode: "gpu" | "cpu";
    /** The CPU fallback, present only in `"cpu"` mode. Its `buffers()` are
     * the caller's to draw. */
    readonly emitter: ParticleEmitter | undefined;
    constructor(host: GpuParticleHost, options?: GpuParticleSystemOptions, id?: string);
    get playing(): boolean;
    /** Live particles. Exact on the CPU path. On the GPU path the population
     * never leaves the device, so this is an upper bound: everything spawned
     * less than the maximum lifetime ago, capped at capacity. It reaches zero
     * exactly when the system is certainly empty, which is what pooling needs. */
    get aliveCount(): number;
    setOrigin(origin: readonly [number, number, number]): void;
    play(): void;
    /** Stops emitting. Live particles finish their lifetimes. */
    stop(): void;
    /** Stops and removes every particle immediately. */
    clear(): void;
    burst(count?: number): number;
    /** Queues particles for the next `update`. Returns how many were queued;
     * the renderer drops what does not fit, which its stats report. */
    emit(count: number): number;
    /** Advances the simulation: schedules emission and steps the host. */
    update(deltaSeconds: number): void;
    stats(): GpuParticleSystemStats;
    /** Frees the renderer's buffers. The system cannot be used afterwards. */
    release(): void;
}
//# sourceMappingURL=gpu-particles.d.ts.map