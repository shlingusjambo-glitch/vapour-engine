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
export declare class Signal<T = void> {
    #private;
    /** Adds a listener. `order` sorts ascending; equal orders keep insertion order. */
    on(listener: SignalListener<T>, order?: number): Unsubscribe;
    /** Adds a listener that removes itself after its first call. */
    once(listener: SignalListener<T>, order?: number): Unsubscribe;
    off(listener: SignalListener<T>): void;
    get listenerCount(): number;
    emit(payload: T): void;
    clear(): void;
    /** Resolves on the next emission. Rejects if `signal` aborts first. */
    next(options?: {
        readonly signal?: AbortSignal;
    }): Promise<T>;
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
export declare class EventBus<Channels extends object> {
    #private;
    /** The signal for a channel, created on first use. */
    channel<K extends keyof Channels & string>(name: K): Signal<Channels[K]>;
    on<K extends keyof Channels & string>(name: K, listener: SignalListener<Channels[K]>, order?: number): Unsubscribe;
    once<K extends keyof Channels & string>(name: K, listener: SignalListener<Channels[K]>, order?: number): Unsubscribe;
    off<K extends keyof Channels & string>(name: K, listener: SignalListener<Channels[K]>): void;
    emit<K extends keyof Channels & string>(name: K, payload: Channels[K]): void;
    /** Channels that currently have at least one listener, for diagnostics. */
    activeChannels(): readonly string[];
    clear(): void;
}
//# sourceMappingURL=signal.d.ts.map