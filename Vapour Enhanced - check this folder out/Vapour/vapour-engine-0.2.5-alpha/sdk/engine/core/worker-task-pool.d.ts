export interface WorkerEndpoint<Request, Response> {
    onmessage: ((event: MessageEvent<Response>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage(message: Request, transfer?: Transferable[]): void;
    terminate(): void;
}
export interface WorkerTaskPoolOptions<Request, Response> {
    readonly size: number;
    readonly createWorker: (index: number) => WorkerEndpoint<Request, Response>;
    /** Starts worker-local state. The worker becomes schedulable only after
     * `isReady` accepts a response. Omit both hooks for immediately-ready workers. */
    readonly initialize?: (worker: WorkerEndpoint<Request, Response>, index: number) => void;
    readonly isReady?: (response: Response) => boolean;
    /** Runs after the ready response and before queued work can reach this worker.
     * Useful for broadcasting registries or immutable generation settings. */
    readonly onReady?: (worker: WorkerEndpoint<Request, Response>, index: number) => void;
    /** May be async. The worker is not assigned another task until it settles. */
    readonly onResponse: (response: Response, workerIndex: number) => void | Promise<void>;
    readonly onError?: (error: unknown, workerIndex: number, interrupted?: Request) => void;
    readonly transfer?: (request: Request) => Transferable[] | undefined;
}
export interface WorkerTaskPoolStats {
    readonly workers: number;
    readonly initializing: number;
    readonly active: number;
    readonly queued: number;
    readonly failed: number;
}
/**
 * Bounded FIFO scheduler for browser Worker jobs.
 *
 * The pool owns worker readiness, backpressure, transfer-list dispatch,
 * failure isolation, and the rule that one response finishes one task. The
 * job protocol remains application-defined, so terrain generation, navmesh
 * baking, compression, asset import, and AI planning can share this machinery.
 */
export declare class WorkerTaskPool<Request, Response> {
    #private;
    constructor(options: WorkerTaskPoolOptions<Request, Response>);
    start(): void;
    submit(request: Request): void;
    stats(): WorkerTaskPoolStats;
    /** Removes work that has not started. Active jobs are allowed to finish;
     * callers should use revision tokens or AbortSignals to ignore stale output. */
    clearQueued(): number;
    destroy(): void;
}
//# sourceMappingURL=worker-task-pool.d.ts.map