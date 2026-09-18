/** Timers and coroutines on the simulation clock.
 *
 * Deliberately **not** built on `setTimeout`. Game timing must follow the
 * simulation clock, not wall time: a paused game pauses its timers, a
 * slow-motion effect slows them, a background tab does not fire a thousand
 * queued callbacks at once, and a replay or a server tick reproduces exactly
 * the same sequence. All of that requires an explicitly advanced clock.
 *
 * Everything here is driven by {@link Scheduler.advance}, which a game calls
 * once per fixed step from `RuntimeLoop`. Given the same delta sequence, the
 * same callbacks fire in the same order — which is what makes networked
 * prediction and deterministic tests possible.
 */
/** Suspends a coroutine for a duration on the simulation clock. */
export function waitSeconds(seconds) {
    if (!(seconds >= 0) || !Number.isFinite(seconds))
        throw new Error("waitSeconds requires a finite, non-negative duration.");
    return { kind: "seconds", seconds };
}
/** Suspends until the given number of scheduler steps have elapsed. */
export function waitFrames(frames) {
    if (!Number.isInteger(frames) || frames < 0)
        throw new Error("waitFrames requires a non-negative whole number of frames.");
    return { kind: "frames", frames };
}
/** Suspends until a predicate becomes true, checked once per step. */
export function waitUntil(predicate) {
    if (typeof predicate !== "function")
        throw new Error("waitUntil requires a predicate function.");
    return { kind: "until", predicate };
}
/**
 * Suspends until a promise settles.
 *
 * This is the one escape hatch to wall time — loading, network, and file I/O
 * genuinely are asynchronous — so a coroutine that uses it is no longer
 * deterministic. Prefer the clock-based waits inside gameplay.
 */
export function waitFor(promise) {
    return { kind: "promise", promise };
}
/**
 * Runs timers and coroutines against an explicitly advanced clock.
 *
 * A game normally owns one scheduler for gameplay and advances it only while
 * unpaused, so pausing is a property of *not calling advance* rather than
 * something every timer has to check.
 */
export class Scheduler {
    #timers = new Map();
    #coroutines = new Map();
    #nextId = 1;
    #elapsed = 0;
    #steps = 0;
    #advancing = false;
    get elapsedSeconds() {
        return this.#elapsed;
    }
    get steps() {
        return this.#steps;
    }
    /** Runs `callback` once after `seconds` of simulation time. */
    after(seconds, callback) {
        return this.#addTimer(seconds, callback, false);
    }
    /**
     * Runs `callback` every `seconds`.
     *
     * A large delta fires the timer as many times as fit, so a timer never
     * silently loses ticks after a hitch; use {@link after} and re-schedule if
     * that catch-up is not what you want.
     */
    every(seconds, callback) {
        if (!(seconds > 0))
            throw new Error("A repeating timer requires a positive interval.");
        return this.#addTimer(seconds, callback, true);
    }
    /** Starts a coroutine. It runs up to its first yield immediately, matching
     * the intuition that starting a coroutine does something now. */
    run(factory) {
        const iterator = factory();
        const id = this.#nextId++;
        const record = {
            id,
            iterator,
            wait: undefined,
            waitSeconds: 0,
            waitFrames: 0,
            promiseSettled: false,
            promiseError: undefined,
            done: false,
            cancelled: false,
        };
        this.#coroutines.set(id, record);
        this.#step(record, 0);
        return {
            id,
            get done() {
                return record.done;
            },
            cancel: () => this.#cancelCoroutine(record),
        };
    }
    /** Advances the clock, firing timers and resuming coroutines. */
    advance(deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
            throw new Error("Scheduler.advance requires a finite, non-negative delta.");
        }
        if (this.#advancing)
            throw new Error("Scheduler.advance was called re-entrantly from a timer or coroutine.");
        this.#advancing = true;
        try {
            this.#elapsed += deltaSeconds;
            this.#steps += 1;
            this.#advanceTimers(deltaSeconds);
            this.#advanceCoroutines(deltaSeconds);
        }
        finally {
            this.#advancing = false;
        }
    }
    /** Cancels every timer and coroutine. Coroutines are `return`ed so their
     * `finally` blocks run, which is where gameplay puts its cleanup. */
    clear() {
        for (const timer of this.#timers.values())
            timer.cancelled = true;
        this.#timers.clear();
        for (const record of [...this.#coroutines.values()])
            this.#cancelCoroutine(record);
        this.#coroutines.clear();
    }
    stats() {
        return { timers: this.#timers.size, coroutines: this.#coroutines.size, elapsedSeconds: this.#elapsed, steps: this.#steps };
    }
    #addTimer(seconds, callback, repeating) {
        if (!Number.isFinite(seconds) || seconds < 0)
            throw new Error("A timer requires a finite, non-negative delay.");
        if (typeof callback !== "function")
            throw new Error("A timer requires a callback function.");
        const id = this.#nextId++;
        const record = { id, callback, intervalSeconds: seconds, repeating, remaining: seconds, cancelled: false };
        this.#timers.set(id, record);
        return {
            id,
            get remaining() {
                return record.cancelled ? 0 : record.remaining;
            },
            cancel: () => {
                record.cancelled = true;
                this.#timers.delete(id);
            },
        };
    }
    #advanceTimers(deltaSeconds) {
        // Snapshot: a timer callback may add or cancel timers.
        for (const record of [...this.#timers.values()]) {
            if (record.cancelled)
                continue;
            record.remaining -= deltaSeconds;
            let guard = 0;
            while (!record.cancelled && record.remaining <= 0) {
                if (record.repeating) {
                    record.remaining += record.intervalSeconds;
                }
                else {
                    this.#timers.delete(record.id);
                    record.cancelled = true;
                }
                record.callback();
                // A pathological interval relative to the delta must not spin forever.
                if (++guard > 10_000)
                    throw new Error("A repeating timer fired more than 10000 times in one step; its interval is too small for this delta.");
                if (!record.repeating)
                    break;
            }
        }
    }
    #advanceCoroutines(deltaSeconds) {
        for (const record of [...this.#coroutines.values()]) {
            if (record.cancelled || record.done)
                continue;
            this.#step(record, deltaSeconds);
        }
    }
    #step(record, deltaSeconds) {
        // Resume repeatedly so a coroutine that yields nothing runs to its next
        // real wait within a single step rather than crawling one yield per frame.
        for (;;) {
            if (record.cancelled || record.done)
                return;
            const wait = record.wait;
            if (wait) {
                if (wait.kind === "seconds") {
                    record.waitSeconds -= deltaSeconds;
                    if (record.waitSeconds > 0)
                        return;
                    // Carry the overshoot into the next wait so a sequence of waits does
                    // not drift later and later behind the clock.
                    deltaSeconds = -record.waitSeconds;
                }
                else if (wait.kind === "frames") {
                    if (record.waitFrames > 0) {
                        record.waitFrames -= 1;
                        return;
                    }
                }
                else if (wait.kind === "until") {
                    if (!wait.predicate())
                        return;
                }
                else if (!record.promiseSettled) {
                    return;
                }
                record.wait = undefined;
            }
            let result;
            try {
                if (record.promiseError !== undefined) {
                    const error = record.promiseError;
                    record.promiseError = undefined;
                    result = record.iterator.throw(error);
                }
                else {
                    result = record.iterator.next();
                }
            }
            catch (error) {
                record.done = true;
                this.#coroutines.delete(record.id);
                throw error;
            }
            if (result.done) {
                record.done = true;
                this.#coroutines.delete(record.id);
                return;
            }
            const yielded = result.value;
            if (!yielded)
                continue;
            record.wait = yielded;
            if (yielded.kind === "seconds")
                record.waitSeconds = yielded.seconds;
            else if (yielded.kind === "frames")
                record.waitFrames = yielded.frames;
            else if (yielded.kind === "promise") {
                record.promiseSettled = false;
                void yielded.promise.then(() => {
                    record.promiseSettled = true;
                }, (error) => {
                    record.promiseSettled = true;
                    record.promiseError = error ?? new Error("A coroutine's promise rejected.");
                });
            }
            // Spend any carried overshoot on the new wait, so a chain of timed waits
            // stays locked to the clock. Only a positive wait consumes carry, which
            // is what keeps `while (true) yield waitSeconds(0)` from spinning.
            if (yielded.kind === "seconds" && yielded.seconds > 0 && deltaSeconds > 0)
                continue;
            // A zero-length wait still yields control for this step, matching the
            // usual "yield to let one frame pass" idiom.
            return;
        }
    }
    #cancelCoroutine(record) {
        if (record.cancelled || record.done)
            return;
        record.cancelled = true;
        record.done = true;
        this.#coroutines.delete(record.id);
        // `return()` runs the coroutine's finally blocks, where cleanup lives.
        record.iterator.return();
    }
}
//# sourceMappingURL=scheduler.js.map