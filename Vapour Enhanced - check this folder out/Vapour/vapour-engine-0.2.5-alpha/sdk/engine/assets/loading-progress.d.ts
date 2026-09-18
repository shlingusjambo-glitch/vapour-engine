export type LoadingTaskState = "pending" | "running" | "complete" | "failed" | "cancelled";
export type LoadingSessionState = "idle" | "running" | "complete" | "failed" | "cancelled";
export interface LoadingTaskDefinition {
    readonly id: string;
    readonly label: string;
    readonly weight?: number;
    readonly parent?: string;
}
export interface LoadingTaskSnapshot {
    readonly id: string;
    readonly label: string;
    readonly parent?: string;
    readonly weight: number;
    readonly progress: number;
    readonly state: LoadingTaskState;
    readonly detail?: string;
    readonly error?: unknown;
}
export interface LoadingSnapshot {
    readonly state: LoadingSessionState;
    readonly progress: number;
    readonly activeTask?: LoadingTaskSnapshot;
    readonly tasks: readonly LoadingTaskSnapshot[];
    readonly error?: unknown;
}
export interface LoadingTaskContext {
    readonly signal: AbortSignal;
    report(progress: number, detail?: string): void;
}
/** Tracks a real loading operation without coupling it to a particular UI.
 * Tasks may be nested; a parent's progress is the weighted aggregate of its
 * children and root task weights determine overall session progress. */
export declare class LoadingSession {
    #private;
    constructor(definitions: readonly LoadingTaskDefinition[]);
    get signal(): AbortSignal;
    get state(): LoadingSessionState;
    get progress(): number;
    subscribe(listener: (snapshot: LoadingSnapshot) => void, emitImmediately?: boolean): () => void;
    start(id: string, detail?: string): void;
    report(id: string, progress: number, detail?: string): void;
    complete(id: string, detail?: string): void;
    fail(id: string, error: unknown): void;
    /** Fails the most recently active leaf, or the first pending leaf when work
     * throws before a task was explicitly started. Useful at orchestration
     * boundaries that should not need to duplicate the current task ID. */
    failActive(error: unknown): void;
    cancel(reason?: unknown): void;
    run<T>(id: string, operation: (context: LoadingTaskContext) => T | Promise<T>): Promise<T>;
    snapshot(): LoadingSnapshot;
}
//# sourceMappingURL=loading-progress.d.ts.map