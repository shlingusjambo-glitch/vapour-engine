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
export interface PoolOptions<T> {
    /** Creates a fresh instance when the pool is empty. */
    create(): T;
    /** Returns an instance to a clean state before reuse. */
    reset?(value: T): void;
    /** Releases an instance permanently when the pool is trimmed or cleared. */
    dispose?(value: T): void;
    /** Instances created up front, so the first frame does not allocate. */
    readonly prewarm?: number;
    /**
     * Maximum idle instances kept. Beyond this, released instances are disposed
     * rather than retained, which bounds memory after a burst.
     */
    readonly maxIdle?: number;
}
export interface PoolStats {
    readonly idle: number;
    readonly active: number;
    readonly created: number;
    readonly reused: number;
    readonly discarded: number;
}
/** A pool of reusable objects. */
export declare class Pool<T extends object> {
    #private;
    constructor(options: PoolOptions<T>);
    get stats(): PoolStats;
    /** Takes an instance, creating one if the pool is empty. */
    acquire(): T;
    /** Returns an instance. Releasing something the pool did not hand out, or
     * releasing twice, throws rather than corrupting the pool. */
    release(value: T): void;
    /** Acquires, runs `body`, and releases — even if `body` throws. */
    use<R>(body: (value: T) => R): R;
    /** Releases every outstanding instance. Useful at a level transition, where
     * whatever was still in flight is no longer meaningful. */
    releaseAll(): void;
    /** Disposes idle instances down to `keep`. */
    trim(keep?: number): number;
    /** Disposes everything, active instances included. */
    clear(): void;
}
/** A pool of numeric arrays of one fixed length, for the vector and matrix
 * scratch space hot maths loops need without allocating. */
export declare function numberArrayPool(length: number, options?: Omit<PoolOptions<number[]>, "create" | "reset">): Pool<number[]>;
//# sourceMappingURL=pool.d.ts.map