/** Typed signals and a message bus.
 *
 * `EventTarget` is the right tool at the engine's browser boundary, but it is a
 * poor fit for gameplay: payloads are untyped, listener order is unspecified in
 * practice, and every dispatch allocates an event object. Gameplay code fires
 * events thousands of times a second, so signals here are typed, ordered,
 * allocation-free per dispatch, and safe to mutate during emission.
 */

export type SignalListener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

interface Subscription<T> {
  readonly listener: SignalListener<T>;
  readonly once: boolean;
  readonly order: number;
  active: boolean;
}

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
export class Signal<T = void> {
  readonly #subscriptions: Subscription<T>[] = [];
  #emitting = false;
  #dirty = false;

  /** Adds a listener. `order` sorts ascending; equal orders keep insertion order. */
  on(listener: SignalListener<T>, order = 0): Unsubscribe {
    return this.#add(listener, false, order);
  }

  /** Adds a listener that removes itself after its first call. */
  once(listener: SignalListener<T>, order = 0): Unsubscribe {
    return this.#add(listener, true, order);
  }

  off(listener: SignalListener<T>): void {
    for (const subscription of this.#subscriptions) {
      if (subscription.listener === listener && subscription.active) {
        subscription.active = false;
        this.#dirty = true;
        return;
      }
    }
  }

  get listenerCount(): number {
    return this.#subscriptions.reduce((count, subscription) => count + (subscription.active ? 1 : 0), 0);
  }

  emit(payload: T): void {
    if (this.#subscriptions.length === 0) return;
    // Snapshot so subscribe/unsubscribe during emission cannot skip a listener.
    const snapshot = this.#subscriptions.slice();
    const wasEmitting = this.#emitting;
    this.#emitting = true;
    try {
      for (const subscription of snapshot) {
        if (!subscription.active) continue;
        if (subscription.once) {
          subscription.active = false;
          this.#dirty = true;
        }
        subscription.listener(payload);
      }
    } finally {
      this.#emitting = wasEmitting;
      if (!this.#emitting) this.#compact();
    }
  }

  clear(): void {
    for (const subscription of this.#subscriptions) subscription.active = false;
    this.#dirty = true;
    if (!this.#emitting) this.#compact();
  }

  /** Resolves on the next emission. Rejects if `signal` aborts first. */
  next(options: { readonly signal?: AbortSignal } = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason instanceof Error ? options.signal.reason : new Error("Waiting for a signal was cancelled."));
        return;
      }
      const unsubscribe = this.once((payload) => {
        options.signal?.removeEventListener("abort", onAbort);
        resolve(payload);
      });
      const onAbort = (): void => {
        unsubscribe();
        reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Waiting for a signal was cancelled."));
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  #add(listener: SignalListener<T>, once: boolean, order: number): Unsubscribe {
    if (typeof listener !== "function") throw new Error("A signal listener must be a function.");
    if (!Number.isFinite(order)) throw new Error("A signal listener order must be a finite number.");
    const subscription: Subscription<T> = { listener, once, order, active: true };
    const index = this.#subscriptions.findIndex((existing) => existing.order > order);
    if (index === -1) this.#subscriptions.push(subscription);
    else this.#subscriptions.splice(index, 0, subscription);
    return () => {
      if (!subscription.active) return;
      subscription.active = false;
      this.#dirty = true;
      if (!this.#emitting) this.#compact();
    };
  }

  #compact(): void {
    if (!this.#dirty) return;
    this.#dirty = false;
    for (let index = this.#subscriptions.length - 1; index >= 0; index -= 1) {
      if (!this.#subscriptions[index]!.active) this.#subscriptions.splice(index, 1);
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
export class EventBus<Channels extends object> {
  readonly #signals = new Map<keyof Channels, Signal<never>>();

  /** The signal for a channel, created on first use. */
  channel<K extends keyof Channels & string>(name: K): Signal<Channels[K]> {
    let signal = this.#signals.get(name);
    if (!signal) {
      signal = new Signal<never>();
      this.#signals.set(name, signal);
    }
    return signal as unknown as Signal<Channels[K]>;
  }

  on<K extends keyof Channels & string>(name: K, listener: SignalListener<Channels[K]>, order = 0): Unsubscribe {
    return this.channel(name).on(listener, order);
  }

  once<K extends keyof Channels & string>(name: K, listener: SignalListener<Channels[K]>, order = 0): Unsubscribe {
    return this.channel(name).once(listener, order);
  }

  off<K extends keyof Channels & string>(name: K, listener: SignalListener<Channels[K]>): void {
    this.channel(name).off(listener);
  }

  emit<K extends keyof Channels & string>(name: K, payload: Channels[K]): void {
    this.#signals.get(name)?.emit(payload as never);
  }

  /** Channels that currently have at least one listener, for diagnostics. */
  activeChannels(): readonly string[] {
    return [...this.#signals.entries()]
      .filter(([, signal]) => signal.listenerCount > 0)
      .map(([name]) => String(name))
      .sort();
  }

  clear(): void {
    for (const signal of this.#signals.values()) signal.clear();
    this.#signals.clear();
  }
}
