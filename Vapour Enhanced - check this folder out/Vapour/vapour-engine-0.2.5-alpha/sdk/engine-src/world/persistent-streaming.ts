import type { ChunkLoadContext, ChunkStreamSource, SpatialChunkCoordinate } from "./world-streaming.js";
import { spatialChunkKey } from "./world-streaming.js";

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
export class PersistentChunkStreamSource<Cell, State> implements ChunkStreamSource<Cell> {
  readonly #source: PersistentCellSource<Cell, State>;
  readonly #store: WorldCellStateStore<State>;
  readonly #pending = new Set<Promise<void>>();
  readonly #failures: unknown[] = [];

  constructor(source: PersistentCellSource<Cell, State>, store: WorldCellStateStore<State>) {
    this.#source = source;
    this.#store = store;
  }

  async load(coordinate: SpatialChunkCoordinate, context: ChunkLoadContext): Promise<Cell> {
    const state = await this.#store.load(spatialChunkKey(coordinate));
    if (context.signal.aborted) throw abortError();
    return this.#source.load(coordinate, context, state);
  }

  dispose(cell: Cell, coordinate: SpatialChunkCoordinate): void {
    const state = this.#source.capture(cell, coordinate);
    const key = spatialChunkKey(coordinate);
    let task!: Promise<void>;
    task = Promise.resolve(this.#store.save(key, state))
      .catch((error: unknown) => { this.#failures.push(error); })
      .finally(() => { this.#pending.delete(task); });
    this.#pending.add(task);
    this.#source.dispose?.(cell, coordinate);
  }

  stats(): PersistentChunkStreamStats {
    return { pendingSaves: this.#pending.size, failedSaves: this.#failures.length };
  }

  /** Waits for every save scheduled before or during this call. Throws one
   * aggregate error after all writes finish so shutdown never loses later cells. */
  async flush(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
    if (this.#failures.length > 0) {
      const failures = this.#failures.splice(0);
      throw new AggregateError(failures, `${failures.length} streamed world cell save(s) failed.`);
    }
  }
}

function abortError(): Error {
  const error = new Error("World cell load was aborted.");
  error.name = "AbortError";
  return error;
}
