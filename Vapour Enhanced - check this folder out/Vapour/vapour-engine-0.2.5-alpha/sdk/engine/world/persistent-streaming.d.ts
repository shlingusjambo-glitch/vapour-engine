import type { ChunkLoadContext, ChunkStreamSource, SpatialChunkCoordinate } from "./world-streaming.js";
export interface WorldCellStateStore<State> {
    load(key: string): State | undefined | Promise<State | undefined>;
    save(key: string, state: State): void | Promise<void>;
}
export interface PersistentCellSource<Cell, State> {
    load(coordinate: SpatialChunkCoordinate, context: ChunkLoadContext, state: State | undefined): Cell | Promise<Cell>;
    capture(cell: Cell, coordinate: SpatialChunkCoordinate): State;
    dispose?(cell: Cell, coordinate: SpatialChunkCoordinate): void;
}
export interface PersistentChunkStreamStats {
    readonly pendingSaves: number;
    readonly failedSaves: number;
}
/** Adds persistent per-cell state to ChunkStreamManager's synchronous disposal
 * contract. State is captured before resources are released and saves drain in
 * the background; `flush()` provides an explicit save/checkpoint boundary. */
export declare class PersistentChunkStreamSource<Cell, State> implements ChunkStreamSource<Cell> {
    #private;
    constructor(source: PersistentCellSource<Cell, State>, store: WorldCellStateStore<State>);
    load(coordinate: SpatialChunkCoordinate, context: ChunkLoadContext): Promise<Cell>;
    dispose(cell: Cell, coordinate: SpatialChunkCoordinate): void;
    stats(): PersistentChunkStreamStats;
    /** Waits for every save scheduled before or during this call. Throws one
     * aggregate error after all writes finish so shutdown never loses later cells. */
    flush(): Promise<void>;
}
//# sourceMappingURL=persistent-streaming.d.ts.map