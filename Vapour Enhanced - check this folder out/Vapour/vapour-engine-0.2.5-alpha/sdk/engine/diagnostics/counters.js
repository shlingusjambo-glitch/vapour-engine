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
const DEFAULT_WINDOW = 120;
/** One named measurement with a fixed-size rolling window. */
export class Counter {
    name;
    unit;
    #values;
    #count = 0;
    #cursor = 0;
    #latest = 0;
    constructor(name, options = {}) {
        const trimmed = name.trim();
        if (!trimmed)
            throw new Error("A counter requires a non-empty name.");
        const window = options.window ?? DEFAULT_WINDOW;
        if (!Number.isInteger(window) || window < 1)
            throw new Error(`Counter "${trimmed}" requires a window of at least one sample.`);
        this.name = trimmed;
        this.unit = options.unit ?? "count";
        // A ring buffer, so a session running for hours does not grow its history.
        this.#values = new Float64Array(window);
    }
    /** Replaces the current value — for gauges like "draw calls this frame". */
    set(value) {
        if (!Number.isFinite(value))
            throw new Error(`Counter "${this.name}" received a non-finite value.`);
        this.#latest = value;
        this.#values[this.#cursor] = value;
        this.#cursor = (this.#cursor + 1) % this.#values.length;
        this.#count = Math.min(this.#count + 1, this.#values.length);
    }
    /** Adds to the current value without recording a sample. Pair with
     * {@link commit} for counters accumulated across a frame. */
    add(delta) {
        if (!Number.isFinite(delta))
            throw new Error(`Counter "${this.name}" received a non-finite delta.`);
        this.#latest += delta;
    }
    /** Records the accumulated value as one sample and resets the accumulator. */
    commit() {
        const value = this.#latest;
        this.set(value);
        this.#latest = 0;
    }
    get value() {
        return this.#latest;
    }
    sample() {
        const count = this.#count;
        if (count === 0) {
            return { name: this.name, unit: this.unit, value: this.#latest, mean: 0, min: 0, max: 0, p95: 0, samples: 0 };
        }
        let sum = 0;
        let min = Infinity;
        let max = -Infinity;
        const sorted = new Float64Array(count);
        for (let index = 0; index < count; index += 1) {
            const value = this.#values[index];
            sorted[index] = value;
            sum += value;
            if (value < min)
                min = value;
            if (value > max)
                max = value;
        }
        sorted.sort();
        // Nearest-rank p95, clamped so a short window still returns a real sample.
        const rank = Math.min(count - 1, Math.ceil(0.95 * count) - 1);
        return {
            name: this.name,
            unit: this.unit,
            value: this.#latest,
            mean: sum / count,
            min,
            max,
            p95: sorted[Math.max(0, rank)],
            samples: count,
        };
    }
    reset() {
        this.#values.fill(0);
        this.#count = 0;
        this.#cursor = 0;
        this.#latest = 0;
    }
}
/**
 * The engine-wide counter registry.
 *
 * Subsystems create counters lazily by name, so a subsystem that is not in use
 * costs nothing, and the overlay discovers whatever exists rather than needing
 * a hard-coded list.
 */
export class Diagnostics {
    #counters = new Map();
    #openTimers = new Map();
    #now;
    #enabled = true;
    constructor(options = {}) {
        this.#now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    }
    /** Turning diagnostics off makes every record a no-op while keeping call
     * sites intact, so instrumentation never has to be deleted to ship. */
    get enabled() {
        return this.#enabled;
    }
    set enabled(value) {
        this.#enabled = value;
    }
    counter(name, options = {}) {
        let counter = this.#counters.get(name);
        if (!counter) {
            counter = new Counter(name, options);
            this.#counters.set(counter.name, counter);
        }
        return counter;
    }
    set(name, value, options) {
        if (!this.#enabled)
            return;
        this.counter(name, options).set(value);
    }
    add(name, delta, options) {
        if (!this.#enabled)
            return;
        this.counter(name, options).add(delta);
    }
    /** Starts a named timing region. Nested regions need distinct names. */
    begin(name) {
        if (!this.#enabled)
            return;
        if (this.#openTimers.has(name)) {
            throw new Error(`Timing region "${name}" was begun twice without an end. Regions with the same name cannot nest.`);
        }
        this.#openTimers.set(name, this.#now());
    }
    /** Ends a timing region, recording its duration in milliseconds. */
    end(name) {
        if (!this.#enabled)
            return 0;
        const started = this.#openTimers.get(name);
        if (started === undefined)
            throw new Error(`Timing region "${name}" was ended without being begun.`);
        this.#openTimers.delete(name);
        const elapsed = this.#now() - started;
        this.counter(name, { unit: "milliseconds" }).set(elapsed);
        return elapsed;
    }
    /** Times a synchronous block, ending the region even if it throws. */
    measure(name, body) {
        this.begin(name);
        try {
            return body();
        }
        finally {
            if (this.#enabled)
                this.end(name);
        }
    }
    /** Commits every accumulating counter. Call once at the end of a frame. */
    commitFrame() {
        if (!this.#enabled)
            return;
        for (const counter of this.#counters.values()) {
            // Only counters accumulated with add() have a pending value to commit;
            // set() already recorded one, and committing it again would double count.
            if (counter.value !== 0)
                counter.commit();
        }
    }
    snapshot() {
        return [...this.#counters.values()].map((counter) => counter.sample()).sort((a, b) => a.name.localeCompare(b.name));
    }
    /** Samples grouped by their `subsystem.` name prefix, which is how the
     * overlay renders sections without knowing what exists. */
    grouped() {
        const groups = new Map();
        for (const sample of this.snapshot()) {
            const group = sample.name.includes(".") ? sample.name.slice(0, sample.name.indexOf(".")) : "general";
            const list = groups.get(group) ?? [];
            list.push(sample);
            groups.set(group, list);
        }
        return groups;
    }
    /** A machine-readable dump for bug reports and automated performance runs. */
    report() {
        return JSON.stringify({
            capturedAt: new Date().toISOString(),
            counters: this.snapshot().map((sample) => ({
                name: sample.name,
                unit: sample.unit,
                value: round(sample.value),
                mean: round(sample.mean),
                min: round(sample.min),
                max: round(sample.max),
                p95: round(sample.p95),
                samples: sample.samples,
            })),
        }, null, 2);
    }
    reset() {
        for (const counter of this.#counters.values())
            counter.reset();
        this.#openTimers.clear();
    }
    get names() {
        return [...this.#counters.keys()].sort();
    }
}
function round(value) {
    return Math.round(value * 1000) / 1000;
}
/** Standard counter names, so subsystems and tooling agree on spelling.
 * A name is `subsystem.metric`, which is what {@link Diagnostics.grouped} uses. */
export const COUNTERS = {
    frameTime: "frame.time",
    frameCpu: "frame.cpu",
    frameGpu: "frame.gpu",
    fps: "frame.fps",
    drawCalls: "render.drawCalls",
    triangles: "render.triangles",
    instances: "render.instances",
    culled: "render.culled",
    renderExtract: "render.extract",
    physicsStep: "physics.step",
    physicsBodies: "physics.bodies",
    physicsContacts: "physics.contacts",
    audioVoices: "audio.voices",
    networkIn: "network.bytesIn",
    networkOut: "network.bytesOut",
    networkRtt: "network.rtt",
    entities: "scene.entities",
    scenesLoaded: "scene.loaded",
    resourcesReferenced: "resources.referenced",
    resourcesCached: "resources.cached",
    resourceBytes: "resources.bytes",
};
//# sourceMappingURL=counters.js.map