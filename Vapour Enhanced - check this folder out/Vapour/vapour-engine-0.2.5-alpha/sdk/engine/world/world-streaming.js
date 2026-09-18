/** Priority-based streaming scheduler for any spatially partitioned world.
 * It deliberately knows nothing about voxels or rendering: terrain tiles,
 * scene cells, navmesh regions, audio banks, and network-interest regions can
 * all provide a `ChunkStreamSource` and receive identical lifecycle behavior. */
export class ChunkStreamManager {
    #source;
    #maxConcurrent;
    #maxStarts;
    #unloadDelay;
    #retryDelay;
    #shape;
    #priorityFunction;
    #entries = new Map();
    #listeners = new Set();
    #activeLoads = new Set();
    #updateIndex = 0;
    #nextRequestId = 1;
    #destroyed = false;
    #desiredCount = 0;
    constructor(source, options = {}) {
        this.#source = source;
        this.#maxConcurrent = positiveInteger("maxConcurrentLoads", options.maxConcurrentLoads ?? 4);
        this.#maxStarts = positiveInteger("maxStartsPerUpdate", options.maxStartsPerUpdate ?? 4);
        this.#unloadDelay = nonnegativeInteger("unloadDelayUpdates", options.unloadDelayUpdates ?? 2);
        this.#retryDelay = nonnegativeInteger("retryDelayUpdates", options.retryDelayUpdates ?? 30);
        this.#shape = options.shape ?? "cylinder";
        this.#priorityFunction = options.priority;
    }
    subscribe(listener) {
        this.#requireAlive();
        this.#listeners.add(listener);
        return () => { this.#listeners.delete(listener); };
    }
    /** Reconciles desired cells and starts a bounded amount of new work. Call
     * once per frame or simulation tick. Async completions never require polling. */
    update(observers) {
        this.#requireAlive();
        this.#updateIndex += 1;
        const plan = planChunkInterest(observers, this.#shape, this.#priorityFunction);
        const desired = new Map(plan.map((entry) => [spatialChunkKey(entry.coordinate), entry.priority]));
        this.#desiredCount = plan.length;
        for (const [key, priority] of desired) {
            const existing = this.#entries.get(key);
            if (existing === undefined) {
                this.#entries.set(key, {
                    coordinate: parseSpatialChunkKey(key), state: "queued", priority,
                    desiredUpdate: this.#updateIndex, hasValue: false, attempts: 0, retryAfterUpdate: 0, requestId: 0,
                });
                continue;
            }
            existing.desiredUpdate = this.#updateIndex;
            existing.priority = priority;
            if (existing.state === "failed" && this.#updateIndex >= existing.retryAfterUpdate) {
                existing.state = "queued";
                delete existing.error;
            }
        }
        for (const [key, entry] of this.#entries) {
            if (entry.desiredUpdate === this.#updateIndex)
                continue;
            if (entry.state === "queued" || entry.state === "failed") {
                this.#entries.delete(key);
            }
            else if (entry.state === "loading") {
                entry.abort?.abort();
                this.#entries.delete(key);
            }
            else if (this.#updateIndex - entry.desiredUpdate >= this.#unloadDelay) {
                this.#unload(key, entry);
            }
        }
        const capacity = Math.max(0, this.#maxConcurrent - this.#activeLoads.size);
        const starts = Math.min(this.#maxStarts, capacity);
        const queued = [...this.#entries.values()]
            .filter((entry) => entry.state === "queued" && entry.desiredUpdate === this.#updateIndex)
            .sort(compareEntries);
        for (let index = 0; index < Math.min(starts, queued.length); index += 1)
            this.#start(queued[index]);
        return this.stats();
    }
    entry(coordinate) {
        validateCoordinate(coordinate);
        const entry = this.#entries.get(spatialChunkKey(coordinate));
        return entry === undefined ? undefined : publicEntry(entry);
    }
    entries() {
        return [...this.#entries.values()].sort(compareCoordinates).map(publicEntry);
    }
    stats() {
        let queued = 0;
        let loading = 0;
        let ready = 0;
        let failed = 0;
        for (const entry of this.#entries.values()) {
            if (entry.state === "queued")
                queued += 1;
            else if (entry.state === "loading")
                loading += 1;
            else if (entry.state === "ready")
                ready += 1;
            else
                failed += 1;
        }
        return { queued, loading, ready, failed, desired: this.#desiredCount };
    }
    /** Waits only for loads currently in flight. It does not bypass the per-update
     * start budget by implicitly starting queued work. */
    async settleActiveLoads() {
        await Promise.all([...this.#activeLoads]);
    }
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        for (const entry of this.#entries.values()) {
            entry.abort?.abort();
            if (entry.state === "ready" && entry.hasValue)
                this.#source.dispose?.(entry.value, entry.coordinate);
        }
        this.#entries.clear();
        this.#listeners.clear();
        this.#desiredCount = 0;
    }
    #start(entry) {
        entry.state = "loading";
        entry.attempts += 1;
        entry.requestId = this.#nextRequestId++;
        const abort = new AbortController();
        entry.abort = abort;
        const key = spatialChunkKey(entry.coordinate);
        let task;
        task = Promise.resolve()
            .then(() => this.#source.load(entry.coordinate, { signal: abort.signal, requestId: entry.requestId }))
            .then((value) => {
            const current = this.#entries.get(key);
            if (this.#destroyed || abort.signal.aborted || current !== entry) {
                this.#source.dispose?.(value, entry.coordinate);
                return;
            }
            entry.value = value;
            entry.hasValue = true;
            entry.state = "ready";
            delete entry.abort;
            this.#emit({ type: "ready", coordinate: entry.coordinate, value });
        })
            .catch((error) => {
            const current = this.#entries.get(key);
            if (abort.signal.aborted || current !== entry || this.#destroyed)
                return;
            entry.state = "failed";
            entry.error = error;
            delete entry.abort;
            entry.retryAfterUpdate = this.#updateIndex + this.#retryDelay;
            this.#emit({ type: "failed", coordinate: entry.coordinate, error, attempts: entry.attempts });
        })
            .finally(() => { this.#activeLoads.delete(task); });
        this.#activeLoads.add(task);
    }
    #unload(key, entry) {
        this.#entries.delete(key);
        if (!entry.hasValue)
            return;
        this.#source.dispose?.(entry.value, entry.coordinate);
        this.#emit({ type: "unloaded", coordinate: entry.coordinate, value: entry.value });
    }
    #emit(event) {
        for (const listener of this.#listeners)
            listener(event);
    }
    #requireAlive() {
        if (this.#destroyed)
            throw new Error("Chunk stream manager is destroyed.");
    }
}
export function spatialChunkKey(coordinate) {
    validateCoordinate(coordinate);
    return `${String(coordinate.x)},${String(coordinate.y)},${String(coordinate.z)}`;
}
/** Computes a stable nearest-first interest plan without loading anything.
 * Games with an established worker/persistence pipeline can adopt Vapour's
 * generic scheduling policy independently, then migrate lifecycle ownership
 * to `ChunkStreamManager` when convenient. */
export function planChunkInterest(observers, shape = "cylinder", priorityFunction) {
    const desired = new Map();
    for (const observer of observers) {
        validateCoordinate(observer.coordinate);
        const radius = nonnegativeInteger("observer radius", observer.radius);
        const verticalRadius = nonnegativeInteger("observer verticalRadius", observer.verticalRadius ?? 0);
        const observerPriority = observer.priority ?? 1;
        if (!(observerPriority > 0) || !Number.isFinite(observerPriority))
            throw new Error("Observer priority must be positive and finite.");
        for (let dx = -radius; dx <= radius; dx += 1) {
            for (let dz = -radius; dz <= radius; dz += 1) {
                for (let dy = -verticalRadius; dy <= verticalRadius; dy += 1) {
                    if (!insideShape(shape, dx, dy, dz, radius, verticalRadius))
                        continue;
                    const offset = { x: dx, y: dy, z: dz };
                    const coordinate = {
                        x: observer.coordinate.x + dx,
                        y: observer.coordinate.y + dy,
                        z: observer.coordinate.z + dz,
                    };
                    const normalizedY = verticalRadius === 0 ? 0 : dy / verticalRadius;
                    const rawPriority = priorityFunction?.(coordinate, observer, offset)
                        ?? dx * dx + dz * dz + normalizedY * normalizedY;
                    const priority = rawPriority / observerPriority;
                    if (!Number.isFinite(priority) || priority < 0)
                        throw new Error("Chunk priority functions must return a non-negative finite number.");
                    const key = spatialChunkKey(coordinate);
                    const previous = desired.get(key);
                    if (previous === undefined || priority < previous.priority)
                        desired.set(key, { coordinate, priority });
                }
            }
        }
    }
    return [...desired.values()].sort((a, b) => a.priority - b.priority || compareCoordinates(a, b));
}
function parseSpatialChunkKey(key) {
    const [x, y, z] = key.split(",").map(Number);
    return { x: x, y: y, z: z };
}
function insideShape(shape, x, y, z, radius, verticalRadius) {
    if (shape === "box")
        return true;
    const horizontal = radius === 0 ? 0 : (x * x + z * z) / (radius * radius);
    if (shape === "cylinder" || verticalRadius === 0)
        return horizontal <= 1;
    return horizontal + (y * y) / (verticalRadius * verticalRadius) <= 1;
}
function compareEntries(a, b) {
    return a.priority - b.priority || compareCoordinates(a, b);
}
function compareCoordinates(a, b) {
    return a.coordinate.y - b.coordinate.y || a.coordinate.z - b.coordinate.z || a.coordinate.x - b.coordinate.x;
}
function publicEntry(entry) {
    return {
        coordinate: entry.coordinate,
        state: entry.state,
        priority: entry.priority,
        ...(entry.hasValue ? { value: entry.value } : {}),
        ...(entry.error === undefined ? {} : { error: entry.error }),
        attempts: entry.attempts,
    };
}
function validateCoordinate(coordinate) {
    if (![coordinate.x, coordinate.y, coordinate.z].every(Number.isSafeInteger)) {
        throw new Error("Chunk coordinates must be safe integers.");
    }
}
function positiveInteger(label, value) {
    if (!Number.isInteger(value) || value < 1)
        throw new Error(`${label} must be a positive integer.`);
    return value;
}
function nonnegativeInteger(label, value) {
    if (!Number.isInteger(value) || value < 0)
        throw new Error(`${label} must be a non-negative integer.`);
    return value;
}
//# sourceMappingURL=world-streaming.js.map