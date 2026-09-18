/** Object pooling.
 *
 * Garbage collection is the dominant source of frame-time spikes in a browser
 * game: allocating a projectile, a particle, a contact record, or a vector per
 * frame is fine until there are ten thousand of them, at which point the pause
 * lands in the middle of a frame and shows up as a stutter. Pools trade a
 * little bookkeeping for a flat allocation profile.
 *
 * The pool is deliberately strict about double-release, because returning the
 * same object twice hands it to two owners at once — a bug that manifests as
 * two unrelated entities mysteriously sharing state.
 */
/** A pool of reusable objects. */
export class Pool {
    #options;
    #idle = [];
    #active = new Set();
    #maxIdle;
    #created = 0;
    #reused = 0;
    #discarded = 0;
    constructor(options) {
        if (typeof options.create !== "function")
            throw new Error("A pool requires a create function.");
        const maxIdle = options.maxIdle ?? Number.POSITIVE_INFINITY;
        if (!(maxIdle > 0))
            throw new Error("A pool's maxIdle must be positive.");
        const prewarm = options.prewarm ?? 0;
        if (!Number.isInteger(prewarm) || prewarm < 0)
            throw new Error("A pool's prewarm count must be a non-negative whole number.");
        this.#options = options;
        this.#maxIdle = maxIdle;
        for (let index = 0; index < prewarm; index += 1) {
            this.#idle.push(this.#create());
        }
    }
    get stats() {
        return { idle: this.#idle.length, active: this.#active.size, created: this.#created, reused: this.#reused, discarded: this.#discarded };
    }
    /** Takes an instance, creating one if the pool is empty. */
    acquire() {
        const recycled = this.#idle.pop();
        const value = recycled ?? this.#create();
        if (recycled) {
            this.#reused += 1;
            this.#options.reset?.(value);
        }
        this.#active.add(value);
        return value;
    }
    /** Returns an instance. Releasing something the pool did not hand out, or
     * releasing twice, throws rather than corrupting the pool. */
    release(value) {
        if (!this.#active.delete(value)) {
            throw new Error("Released an object that this pool did not currently own. It was either released twice or never acquired.");
        }
        if (this.#idle.length >= this.#maxIdle) {
            this.#discarded += 1;
            this.#options.dispose?.(value);
            return;
        }
        this.#idle.push(value);
    }
    /** Acquires, runs `body`, and releases — even if `body` throws. */
    use(body) {
        const value = this.acquire();
        try {
            return body(value);
        }
        finally {
            this.release(value);
        }
    }
    /** Releases every outstanding instance. Useful at a level transition, where
     * whatever was still in flight is no longer meaningful. */
    releaseAll() {
        for (const value of [...this.#active])
            this.release(value);
    }
    /** Disposes idle instances down to `keep`. */
    trim(keep = 0) {
        if (!Number.isInteger(keep) || keep < 0)
            throw new Error("Pool.trim requires a non-negative whole number to keep.");
        let removed = 0;
        while (this.#idle.length > keep) {
            const value = this.#idle.pop();
            this.#options.dispose?.(value);
            this.#discarded += 1;
            removed += 1;
        }
        return removed;
    }
    /** Disposes everything, active instances included. */
    clear() {
        for (const value of this.#active)
            this.#options.dispose?.(value);
        this.#active.clear();
        this.trim(0);
    }
    #create() {
        this.#created += 1;
        return this.#options.create();
    }
}
/** A pool of numeric arrays of one fixed length, for the vector and matrix
 * scratch space hot maths loops need without allocating. */
export function numberArrayPool(length, options = {}) {
    if (!Number.isInteger(length) || length <= 0)
        throw new Error("A number array pool requires a positive whole length.");
    return new Pool({
        ...options,
        create: () => new Array(length).fill(0),
        reset: (value) => value.fill(0),
    });
}
//# sourceMappingURL=pool.js.map