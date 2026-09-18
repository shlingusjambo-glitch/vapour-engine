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
export type Unschedule = () => void;
/** What a coroutine may yield to suspend itself. */
export type CoroutineYield = {
    readonly kind: "seconds";
    readonly seconds: number;
} | {
    readonly kind: "frames";
    readonly frames: number;
} | {
    readonly kind: "until";
    readonly predicate: () => boolean;
} | {
    readonly kind: "promise";
    readonly promise: Promise<unknown>;
};
export type Coroutine = Generator<CoroutineYield | void, void, unknown>;
/** Suspends a coroutine for a duration on the simulation clock. */
export declare function waitSeconds(seconds: number): CoroutineYield;
/** Suspends until the given number of scheduler steps have elapsed. */
export declare function waitFrames(frames: number): CoroutineYield;
/** Suspends until a predicate becomes true, checked once per step. */
export declare function waitUntil(predicate: () => boolean): CoroutineYield;
/**
 * Suspends until a promise settles.
 *
 * This is the one escape hatch to wall time — loading, network, and file I/O
 * genuinely are asynchronous — so a coroutine that uses it is no longer
 * deterministic. Prefer the clock-based waits inside gameplay.
 */
export declare function waitFor(promise: Promise<unknown>): CoroutineYield;
export interface TimerHandle {
    readonly id: number;
    cancel(): void;
    /** Seconds remaining before the next fire. */
    readonly remaining: number;
}
export interface CoroutineHandle {
    readonly id: number;
    readonly done: boolean;
    cancel(): void;
}
export interface SchedulerStats {
    readonly timers: number;
    readonly coroutines: number;
    readonly elapsedSeconds: number;
    readonly steps: number;
}
/**
 * Runs timers and coroutines against an explicitly advanced clock.
 *
 * A game normally owns one scheduler for gameplay and advances it only while
 * unpaused, so pausing is a property of *not calling advance* rather than
 * something every timer has to check.
 */
export declare class Scheduler {
    #private;
    get elapsedSeconds(): number;
    get steps(): number;
    /** Runs `callback` once after `seconds` of simulation time. */
    after(seconds: number, callback: () => void): TimerHandle;
    /**
     * Runs `callback` every `seconds`.
     *
     * A large delta fires the timer as many times as fit, so a timer never
     * silently loses ticks after a hitch; use {@link after} and re-schedule if
     * that catch-up is not what you want.
     */
    every(seconds: number, callback: () => void): TimerHandle;
    /** Starts a coroutine. It runs up to its first yield immediately, matching
     * the intuition that starting a coroutine does something now. */
    run(factory: () => Coroutine): CoroutineHandle;
    /** Advances the clock, firing timers and resuming coroutines. */
    advance(deltaSeconds: number): void;
    /** Cancels every timer and coroutine. Coroutines are `return`ed so their
     * `finally` blocks run, which is where gameplay puts its cleanup. */
    clear(): void;
    stats(): SchedulerStats;
}
//# sourceMappingURL=scheduler.d.ts.map