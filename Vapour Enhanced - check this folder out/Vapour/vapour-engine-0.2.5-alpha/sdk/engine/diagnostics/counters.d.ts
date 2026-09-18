/** Runtime counters and timings.
 *
 * The audit's blunt finding was that nobody could tell why a Vapour game was
 * slow. This module is the shared surface that fixes that: every subsystem
 * reports into one registry, and one overlay or one JSON dump then explains the
 * frame.
 *
 * Two properties matter more than breadth here:
 *
 * - **Cheap enough to leave on.** A counter is a number increment; a timer is
 *   two clock reads. Diagnostics that must be switched off to get a fast build
 *   are diagnostics nobody has when they need them.
 * - **Honest about sampling.** Values are reported as rolling windows with a
 *   mean, a maximum, and a 95th percentile, because a mean frame time hides
 *   exactly the spikes that make a game feel bad.
 */
export type CounterUnit = "count" | "bytes" | "milliseconds" | "ratio";
export interface CounterSample {
    readonly name: string;
    readonly unit: CounterUnit;
    /** The most recent value. */
    readonly value: number;
    readonly mean: number;
    readonly min: number;
    readonly max: number;
    /** 95th percentile over the window; where hitches show up. */
    readonly p95: number;
    readonly samples: number;
}
export interface CounterOptions {
    readonly unit?: CounterUnit;
    /** How many samples the rolling window keeps. */
    readonly window?: number;
}
/** One named measurement with a fixed-size rolling window. */
export declare class Counter {
    #private;
    readonly name: string;
    readonly unit: CounterUnit;
    constructor(name: string, options?: CounterOptions);
    /** Replaces the current value — for gauges like "draw calls this frame". */
    set(value: number): void;
    /** Adds to the current value without recording a sample. Pair with
     * {@link commit} for counters accumulated across a frame. */
    add(delta: number): void;
    /** Records the accumulated value as one sample and resets the accumulator. */
    commit(): void;
    get value(): number;
    sample(): CounterSample;
    reset(): void;
}
/**
 * The engine-wide counter registry.
 *
 * Subsystems create counters lazily by name, so a subsystem that is not in use
 * costs nothing, and the overlay discovers whatever exists rather than needing
 * a hard-coded list.
 */
export declare class Diagnostics {
    #private;
    constructor(options?: {
        readonly now?: () => number;
    });
    /** Turning diagnostics off makes every record a no-op while keeping call
     * sites intact, so instrumentation never has to be deleted to ship. */
    get enabled(): boolean;
    set enabled(value: boolean);
    counter(name: string, options?: CounterOptions): Counter;
    set(name: string, value: number, options?: CounterOptions): void;
    add(name: string, delta: number, options?: CounterOptions): void;
    /** Starts a named timing region. Nested regions need distinct names. */
    begin(name: string): void;
    /** Ends a timing region, recording its duration in milliseconds. */
    end(name: string): number;
    /** Times a synchronous block, ending the region even if it throws. */
    measure<T>(name: string, body: () => T): T;
    /** Commits every accumulating counter. Call once at the end of a frame. */
    commitFrame(): void;
    snapshot(): readonly CounterSample[];
    /** Samples grouped by their `subsystem.` name prefix, which is how the
     * overlay renders sections without knowing what exists. */
    grouped(): ReadonlyMap<string, readonly CounterSample[]>;
    /** A machine-readable dump for bug reports and automated performance runs. */
    report(): string;
    reset(): void;
    get names(): readonly string[];
}
/** Standard counter names, so subsystems and tooling agree on spelling.
 * A name is `subsystem.metric`, which is what {@link Diagnostics.grouped} uses. */
export declare const COUNTERS: {
    readonly frameTime: "frame.time";
    readonly frameCpu: "frame.cpu";
    readonly frameGpu: "frame.gpu";
    readonly fps: "frame.fps";
    readonly drawCalls: "render.drawCalls";
    readonly triangles: "render.triangles";
    readonly instances: "render.instances";
    readonly culled: "render.culled";
    readonly renderExtract: "render.extract";
    readonly physicsStep: "physics.step";
    readonly physicsBodies: "physics.bodies";
    readonly physicsContacts: "physics.contacts";
    readonly audioVoices: "audio.voices";
    readonly networkIn: "network.bytesIn";
    readonly networkOut: "network.bytesOut";
    readonly networkRtt: "network.rtt";
    readonly entities: "scene.entities";
    readonly scenesLoaded: "scene.loaded";
    readonly resourcesReferenced: "resources.referenced";
    readonly resourcesCached: "resources.cached";
    readonly resourceBytes: "resources.bytes";
};
//# sourceMappingURL=counters.d.ts.map