/** Typed signals and a message bus.
 *
 * `EventTarget` is the right tool at the engine's browser boundary, but it is a
 * poor fit for gameplay: payloads are untyped, listener order is unspecified in
 * practice, and every dispatch allocates an event object. Gameplay code fires
 * events thousands of times a second, so signals here are typed, ordered,
 * allocation-free per dispatch, and safe to mutate during emission.
 */
/**
 * A typed, ordered, one-payload event.
 *
 * Listeners run in subscription order, or by explicit `order` when supplied —
 * gameplay frequently needs "this must run before that", and relying on
 * registration order alone makes those dependencies invisible.
 *
 * Subscribing or unsubscribing *during* an emit is safe: the emit iterates a
 * snapshot, so a listener that removes itself does not skip its neighbour.
 */
export class Signal {
    #subscriptions = [];
    #emitting = false;
    #dirty = false;
    /** Adds a listener. `order` sorts ascending; equal orders keep insertion order. */
    on(listener, order = 0) {
        return this.#add(listener, false, order);
    }
    /** Adds a listener that removes itself after its first call. */
    once(listener, order = 0) {
        return this.#add(listener, true, order);
    }
    off(listener) {
        for (const subscription of this.#subscriptions) {
            if (subscription.listener === listener && subscription.active) {
                subscription.active = false;
                this.#dirty = true;
                return;
            }
        }
    }
    get listenerCount() {
        return this.#subscriptions.reduce((count, subscription) => count + (subscription.active ? 1 : 0), 0);
    }
    emit(payload) {
        if (this.#subscriptions.length === 0)
            return;
        // Snapshot so subscribe/unsubscribe during emission cannot skip a listener.
        const snapshot = this.#subscriptions.slice();
        const wasEmitting = this.#emitting;
        this.#emitting = true;
        try {
            for (const subscription of snapshot) {
                if (!subscription.active)
                    continue;
                if (subscription.once) {
                    subscription.active = false;
                    this.#dirty = true;
                }
                subscription.listener(payload);
            }
        }
        finally {
            this.#emitting = wasEmitting;
            if (!this.#emitting)
                this.#compact();
        }
    }
    clear() {
        for (const subscription of this.#subscriptions)
            subscription.active = false;
        this.#dirty = true;
        if (!this.#emitting)
            this.#compact();
    }
    /** Resolves on the next emission. Rejects if `signal` aborts first. */
    next(options = {}) {
        return new Promise((resolve, reject) => {
            if (options.signal?.aborted) {
                reject(options.signal.reason instanceof Error ? options.signal.reason : new Error("Waiting for a signal was cancelled."));
                return;
            }
            const unsubscribe = this.once((payload) => {
                options.signal?.removeEventListener("abort", onAbort);
                resolve(payload);
            });
            const onAbort = () => {
                unsubscribe();
                reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Waiting for a signal was cancelled."));
            };
            options.signal?.addEventListener("abort", onAbort, { once: true });
        });
    }
    #add(listener, once, order) {
        if (typeof listener !== "function")
            throw new Error("A signal listener must be a function.");
        if (!Number.isFinite(order))
            throw new Error("A signal listener order must be a finite number.");
        const subscription = { listener, once, order, active: true };
        const index = this.#subscriptions.findIndex((existing) => existing.order > order);
        if (index === -1)
            this.#subscriptions.push(subscription);
        else
            this.#subscriptions.splice(index, 0, subscription);
        return () => {
            if (!subscription.active)
                return;
            subscription.active = false;
            this.#dirty = true;
            if (!this.#emitting)
                this.#compact();
        };
    }
    #compact() {
        if (!this.#dirty)
            return;
        this.#dirty = false;
        for (let index = this.#subscriptions.length - 1; index >= 0; index -= 1) {
            if (!this.#subscriptions[index].active)
                this.#subscriptions.splice(index, 1);
        }
    }
}
/**
 * A named collection of signals, typed by a channel map.
 *
 * Systems that must not know about each other — an achievement tracker and the
 * combat system, say — meet on a bus instead of holding direct references. The
 * channel map keeps that decoupling type safe, so a typo in a channel name is a
 * compile error rather than an event nobody receives.
 *
 * The channel map may be an `interface` — the constraint is deliberately
 * `object` rather than `Record<string, unknown>`, which TypeScript interfaces do
 * not satisfy without an index signature nobody should have to add.
 *
 * ```ts
 * interface GameEvents {
 *   "player.died": { cause: string };
 *   "item.picked": { id: string; count: number };
 * }
 * const bus = new EventBus<GameEvents>();
 * bus.on("player.died", ({ cause }) => respawn(cause));
 * bus.emit("player.died", { cause: "fall" });
 * ```
 */
export class EventBus {
    #signals = new Map();
    /** The signal for a channel, created on first use. */
    channel(name) {
        let signal = this.#signals.get(name);
        if (!signal) {
            signal = new Signal();
            this.#signals.set(name, signal);
        }
        return signal;
    }
    on(name, listener, order = 0) {
        return this.channel(name).on(listener, order);
    }
    once(name, listener, order = 0) {
        return this.channel(name).once(listener, order);
    }
    off(name, listener) {
        this.channel(name).off(listener);
    }
    emit(name, payload) {
        this.#signals.get(name)?.emit(payload);
    }
    /** Channels that currently have at least one listener, for diagnostics. */
    activeChannels() {
        return [...this.#signals.entries()]
            .filter(([, signal]) => signal.listenerCount > 0)
            .map(([name]) => String(name))
            .sort();
    }
    clear() {
        for (const signal of this.#signals.values())
            signal.clear();
        this.#signals.clear();
    }
}
//# sourceMappingURL=signal.js.map