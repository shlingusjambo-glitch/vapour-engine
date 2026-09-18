/** The shared-memory handoff between a physics-stepping worker and the main
 * thread: a fixed layout over one `SharedArrayBuffer`, published with atomics
 * so the main thread never reads a step half-written by the worker.
 *
 * The layout is double-buffered — two body-state regions, `A` and `B` — and a
 * small integer header says which one currently holds the latest published
 * step. The worker always writes into the region the main thread is *not*
 * currently reading, then flips the header's active index. That alone is not
 * quite enough: a slow reader can still be copying region `A` out when the
 * worker races ahead, finishes region `B`, and starts overwriting `A` again
 * for the *next* step. The header's `generation` counter is what catches
 * that — it increments before and after every publish, so a reader that sees
 * the generation change during its copy knows the data it just read may be
 * torn, and retries rather than trusting it. This is an ordinary seqlock.
 *
 * `Atomics.store`/`Atomics.load` work identically on a `SharedArrayBuffer`
 * and on a plain `ArrayBuffer` (only the blocking `Atomics.wait` requires
 * sharing); that is what lets {@link PhysicsWorkerChannel} serve as both the
 * real cross-thread channel *and* the same-thread fallback documented below,
 * with no branch in its own code.
 */
import type { PhysicsBodySnapshot3d } from "./physics-3d.js";
/** Floats per body: id, position(3), rotation(4), linearVelocity(3), angularVelocity(3), sleeping(1). */
export declare const PHYSICS_WORKER_BODY_STRIDE = 15;
/** Total byte length a channel over `maxBodies` bodies needs. */
export declare function physicsWorkerBufferByteLength(maxBodies: number): number;
/**
 * Whether a real cross-thread channel can be used: the runtime has
 * `SharedArrayBuffer` at all, and — where the flag exists — the page is
 * cross-origin isolated. Node and older/unflagged browser contexts fail this,
 * which is exactly when {@link physicsWorkerBufferByteLength}'s buffer should
 * be a plain `ArrayBuffer` and the worker skipped in favour of stepping
 * physics synchronously on the main thread.
 */
export declare function isSharedPhysicsBufferAvailable(): boolean;
/** Allocates the right buffer type for this runtime: `SharedArrayBuffer` when
 * {@link isSharedPhysicsBufferAvailable}, otherwise a plain `ArrayBuffer` for
 * the same-thread fallback — same layout, same {@link PhysicsWorkerChannel}. */
export declare function createPhysicsWorkerBuffer(maxBodies: number): ArrayBufferLike;
export interface PhysicsWorkerSnapshot {
    readonly tick: number;
    readonly bodies: readonly PhysicsBodySnapshot3d[];
}
/**
 * One channel over one shared buffer. A worker (or, in the fallback, the same
 * thread) calls {@link publish} once per physics step; the main thread calls
 * {@link consume} once per render frame. Both sides construct the same class
 * over the same buffer — there is no separate "producer" or "consumer" type,
 * because there is no behavioural difference between them beyond which
 * method gets called.
 */
export declare class PhysicsWorkerChannel {
    #private;
    constructor(buffer: ArrayBufferLike, maxBodies: number);
    get maxBodies(): number;
    /** Writes one step's bodies into the buffer the reader is not using, then
     * publishes it. `bodies.length` must not exceed {@link maxBodies}. */
    publish(tick: number, bodies: readonly PhysicsBodySnapshot3d[]): void;
    /** Reads the most recently published step, retrying on a torn read (the
     * generation moved while copying). Returns `undefined` only if nothing has
     * ever been published, or `maxRetries` is exhausted — the latter would mean
     * a writer publishing faster than this reader can copy, which a single
     * physics-step producer should never sustain. */
    consume(maxRetries?: number): PhysicsWorkerSnapshot | undefined;
}
//# sourceMappingURL=physics-worker-protocol.d.ts.map