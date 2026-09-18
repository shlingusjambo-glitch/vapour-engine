/**
 * Bounded FIFO scheduler for browser Worker jobs.
 *
 * The pool owns worker readiness, backpressure, transfer-list dispatch,
 * failure isolation, and the rule that one response finishes one task. The
 * job protocol remains application-defined, so terrain generation, navmesh
 * baking, compression, asset import, and AI planning can share this machinery.
 */
export class WorkerTaskPool {
    #options;
    #slots = [];
    #queue = [];
    #started = false;
    #destroyed = false;
    constructor(options) {
        if (!Number.isInteger(options.size) || options.size < 1) {
            throw new Error("Worker pool size must be a positive integer.");
        }
        if ((options.initialize === undefined) !== (options.isReady === undefined)) {
            throw new Error("Worker pool initialization and readiness detection must be configured together.");
        }
        this.#options = options;
    }
    start() {
        this.#requireAlive();
        if (this.#started)
            return;
        this.#started = true;
        for (let index = 0; index < this.#options.size; index += 1) {
            try {
                const worker = this.#options.createWorker(index);
                const slot = {
                    index,
                    worker,
                    ready: this.#options.initialize === undefined,
                    busy: false,
                    failed: false,
                    currentTransferred: false,
                };
                worker.onmessage = (event) => { void this.#receive(slot, event.data); };
                worker.onerror = (event) => { this.#fail(slot, event); };
                this.#slots.push(slot);
                this.#options.initialize?.(worker, index);
            }
            catch (error) {
                this.#options.onError?.(error, index);
            }
        }
        if (this.#slots.length === 0) {
            throw new Error("Worker pool could not create any workers.");
        }
        this.#dispatch();
    }
    submit(request) {
        this.#requireAlive();
        if (!this.#started)
            this.start();
        this.#queue.push(request);
        this.#dispatch();
    }
    stats() {
        let initializing = 0;
        let active = 0;
        let failed = 0;
        for (const slot of this.#slots) {
            if (slot.failed)
                failed += 1;
            else if (!slot.ready)
                initializing += 1;
            else if (slot.busy)
                active += 1;
        }
        return {
            workers: this.#slots.length,
            initializing,
            active,
            queued: this.#queue.length,
            failed,
        };
    }
    /** Removes work that has not started. Active jobs are allowed to finish;
     * callers should use revision tokens or AbortSignals to ignore stale output. */
    clearQueued() {
        this.#requireAlive();
        const removed = this.#queue.length;
        this.#queue.length = 0;
        return removed;
    }
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        this.#queue.length = 0;
        for (const slot of this.#slots) {
            slot.worker.onmessage = null;
            slot.worker.onerror = null;
            slot.worker.terminate();
        }
        this.#slots.length = 0;
    }
    async #receive(slot, response) {
        if (this.#destroyed || slot.failed)
            return;
        if (!slot.ready) {
            if (!this.#options.isReady(response))
                return;
            try {
                this.#options.onReady?.(slot.worker, slot.index);
                slot.ready = true;
            }
            catch (error) {
                this.#fail(slot, error);
                return;
            }
            this.#dispatch();
            return;
        }
        if (!slot.busy)
            return;
        slot.busy = false;
        delete slot.current;
        slot.currentTransferred = false;
        try {
            await this.#options.onResponse(response, slot.index);
        }
        catch (error) {
            this.#options.onError?.(error, slot.index);
        }
        this.#dispatch();
    }
    #dispatch() {
        if (this.#destroyed)
            return;
        for (const slot of this.#slots) {
            if (!slot.ready || slot.busy || slot.failed)
                continue;
            const request = this.#queue.shift();
            if (request === undefined)
                break;
            try {
                slot.busy = true;
                slot.current = request;
                const transfer = this.#options.transfer?.(request);
                slot.currentTransferred = transfer !== undefined && transfer.length > 0;
                slot.worker.postMessage(request, transfer);
            }
            catch (error) {
                slot.busy = false;
                this.#fail(slot, error);
            }
        }
    }
    #fail(slot, error) {
        if (slot.failed || this.#destroyed)
            return;
        slot.failed = true;
        slot.busy = false;
        slot.worker.terminate();
        const interrupted = slot.current;
        // Non-transferred messages remain valid and can safely move to another
        // worker. Transferred buffers are detached, so their owner must rebuild
        // the request after receiving the failure callback.
        if (interrupted !== undefined && !slot.currentTransferred) {
            this.#queue.unshift(interrupted);
        }
        delete slot.current;
        slot.currentTransferred = false;
        this.#options.onError?.(error, slot.index, interrupted);
        this.#dispatch();
    }
    #requireAlive() {
        if (this.#destroyed)
            throw new Error("Worker task pool is destroyed.");
    }
}
//# sourceMappingURL=worker-task-pool.js.map