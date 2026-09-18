import { spatialChunkKey } from "./world-streaming.js";
/** Adds persistent per-cell state to ChunkStreamManager's synchronous disposal
 * contract. State is captured before resources are released and saves drain in
 * the background; `flush()` provides an explicit save/checkpoint boundary. */
export class PersistentChunkStreamSource {
    #source;
    #store;
    #pending = new Set();
    #failures = [];
    constructor(source, store) {
        this.#source = source;
        this.#store = store;
    }
    async load(coordinate, context) {
        const state = await this.#store.load(spatialChunkKey(coordinate));
        if (context.signal.aborted)
            throw abortError();
        return this.#source.load(coordinate, context, state);
    }
    dispose(cell, coordinate) {
        const state = this.#source.capture(cell, coordinate);
        const key = spatialChunkKey(coordinate);
        let task;
        task = Promise.resolve(this.#store.save(key, state))
            .catch((error) => { this.#failures.push(error); })
            .finally(() => { this.#pending.delete(task); });
        this.#pending.add(task);
        this.#source.dispose?.(cell, coordinate);
    }
    stats() {
        return { pendingSaves: this.#pending.size, failedSaves: this.#failures.length };
    }
    /** Waits for every save scheduled before or during this call. Throws one
     * aggregate error after all writes finish so shutdown never loses later cells. */
    async flush() {
        while (this.#pending.size > 0)
            await Promise.all([...this.#pending]);
        if (this.#failures.length > 0) {
            const failures = this.#failures.splice(0);
            throw new AggregateError(failures, `${failures.length} streamed world cell save(s) failed.`);
        }
    }
}
function abortError() {
    const error = new Error("World cell load was aborted.");
    error.name = "AbortError";
    return error;
}
//# sourceMappingURL=persistent-streaming.js.map