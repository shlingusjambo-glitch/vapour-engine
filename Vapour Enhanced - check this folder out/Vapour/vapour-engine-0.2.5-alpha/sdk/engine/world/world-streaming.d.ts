export interface SpatialChunkCoordinate {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}
export interface ChunkStreamObserver {
    /** Chunk-space coordinate, not world-space metres. */
    readonly coordinate: SpatialChunkCoordinate;
    /** Horizontal chunk radius. */
    readonly radius: number;
    /** Vertical sections above and below the observer. Defaults to zero. */
    readonly verticalRadius?: number;
    /** Higher values make this observer's chunks win scheduling ties. */
    readonly priority?: number;
}
export interface ChunkLoadContext {
    readonly signal: AbortSignal;
    readonly requestId: number;
}
export interface ChunkStreamSource<T> {
    load(coordinate: SpatialChunkCoordinate, context: ChunkLoadContext): T | Promise<T>;
    /** Releases CPU/GPU resources owned by a loaded cell. Must be synchronous;
     * persistence should be scheduled separately before a cell becomes stale. */
    dispose?(value: T, coordinate: SpatialChunkCoordinate): void;
}
export type ChunkStreamShape = "cylinder" | "box" | "sphere";
export type ChunkStreamState = "queued" | "loading" | "ready" | "failed";
export interface ChunkStreamOptions {
    readonly maxConcurrentLoads?: number;
    readonly maxStartsPerUpdate?: number;
    /** Updates a ready chunk may remain outside every observer before unloading. */
    readonly unloadDelayUpdates?: number;
    /** Updates before a failed desired chunk may be retried. */
    readonly retryDelayUpdates?: number;
    readonly shape?: ChunkStreamShape;
    /** Custom load priority. Lower values start first. Observer priority is
     * applied after this score, and overlapping observers keep the best score. */
    readonly priority?: ChunkPriorityFunction;
}
export interface PlannedChunk {
    readonly coordinate: SpatialChunkCoordinate;
    readonly priority: number;
}
export type ChunkPriorityFunction = (coordinate: SpatialChunkCoordinate, observer: ChunkStreamObserver, offset: SpatialChunkCoordinate) => number;
export interface ChunkStreamEntry<T> {
    readonly coordinate: SpatialChunkCoordinate;
    readonly state: ChunkStreamState;
    readonly priority: number;
    readonly value?: T;
    readonly error?: unknown;
    readonly attempts: number;
}
export type ChunkStreamEvent<T> = {
    readonly type: "ready";
    readonly coordinate: SpatialChunkCoordinate;
    readonly value: T;
} | {
    readonly type: "unloaded";
    readonly coordinate: SpatialChunkCoordinate;
    readonly value: T;
} | {
    readonly type: "failed";
    readonly coordinate: SpatialChunkCoordinate;
    readonly error: unknown;
    readonly attempts: number;
};
export interface ChunkStreamStats {
    readonly queued: number;
    readonly loading: number;
    readonly ready: number;
    readonly failed: number;
    readonly desired: number;
}
/** Priority-based streaming scheduler for any spatially partitioned world.
 * It deliberately knows nothing about voxels or rendering: terrain tiles,
 * scene cells, navmesh regions, audio banks, and network-interest regions can
 * all provide a `ChunkStreamSource` and receive identical lifecycle behavior. */
export declare class ChunkStreamManager<T> {
    #private;
    constructor(source: ChunkStreamSource<T>, options?: ChunkStreamOptions);
    subscribe(listener: (event: ChunkStreamEvent<T>) => void): () => void;
    /** Reconciles desired cells and starts a bounded amount of new work. Call
     * once per frame or simulation tick. Async completions never require polling. */
    update(observers: readonly ChunkStreamObserver[]): ChunkStreamStats;
    entry(coordinate: SpatialChunkCoordinate): ChunkStreamEntry<T> | undefined;
    entries(): readonly ChunkStreamEntry<T>[];
    stats(): ChunkStreamStats;
    /** Waits only for loads currently in flight. It does not bypass the per-update
     * start budget by implicitly starting queued work. */
    settleActiveLoads(): Promise<void>;
    destroy(): void;
}
export declare function spatialChunkKey(coordinate: SpatialChunkCoordinate): string;
/** Computes a stable nearest-first interest plan without loading anything.
 * Games with an established worker/persistence pipeline can adopt Vapour's
 * generic scheduling policy independently, then migrate lifecycle ownership
 * to `ChunkStreamManager` when convenient. */
export declare function planChunkInterest(observers: readonly ChunkStreamObserver[], shape?: ChunkStreamShape, priorityFunction?: ChunkPriorityFunction): readonly PlannedChunk[];
//# sourceMappingURL=world-streaming.d.ts.map