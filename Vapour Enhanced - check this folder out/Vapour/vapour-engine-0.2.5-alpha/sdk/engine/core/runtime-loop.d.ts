export interface RuntimeFrameTime {
    readonly deltaSeconds: number;
    readonly elapsedSeconds: number;
    readonly frame: number;
    readonly fixedDeltaSeconds: number;
    readonly fixedSteps: number;
}
export interface RuntimeLoopHooks {
    readonly start?: () => void | Promise<void>;
    readonly update: (time: RuntimeFrameTime) => void;
    readonly stop?: () => void;
    readonly error?: (error: unknown) => void;
}
export interface RuntimeLoopOptions {
    readonly fixedHz?: number;
    readonly maxDeltaSeconds?: number;
    readonly maxFixedStepsPerFrame?: number;
    readonly now?: () => number;
    readonly requestFrame?: (callback: FrameRequestCallback) => number;
    readonly cancelFrame?: (handle: number) => void;
}
/** Renderer-independent browser game lifecycle and fixed-step clock.
 *
 * The WebGPU `GameRuntime`, editor play mode, Three migration bridge, and
 * server-authoritative simulations can all use the same timing contract. The
 * loop clamps background-tab deltas and caps catch-up work to prevent a death
 * spiral, while still exposing exactly how many deterministic steps belong to
 * the current presentation frame. */
export declare class RuntimeLoop extends EventTarget {
    #private;
    constructor(hooks: RuntimeLoopHooks, options?: RuntimeLoopOptions);
    get running(): boolean;
    start(): Promise<void>;
    stop(): void;
    /** Advances deterministically without scheduling; used by tests, editor
     * stepping, replay tools, and non-window hosts. */
    step(nowMilliseconds: number): RuntimeFrameTime;
}
//# sourceMappingURL=runtime-loop.d.ts.map