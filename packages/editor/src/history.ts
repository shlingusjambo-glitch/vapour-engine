export interface HistoryEntry {
  readonly label: string;
  undo(): void;
  redo(): void;
}

/**
 * Undo/redo stack for editor mutations.
 *
 * Continuous edits — dragging a gizmo, holding an arrow key on a number field —
 * would otherwise push one entry per frame and make Ctrl+Z useless. Passing a
 * `coalesceKey` folds consecutive edits of the same thing into a single entry
 * that undoes back to where the gesture started. Ending the gesture (pointer
 * release, blur, or selecting something else) closes the group.
 */
export class History extends EventTarget {
  readonly #undo: HistoryEntry[] = [];
  readonly #redo: HistoryEntry[] = [];
  readonly #limit: number;
  #coalesceKey: string | undefined;

  constructor(limit = 200) {
    super();
    if (!Number.isInteger(limit) || limit < 1) throw new Error("History limit must be a positive integer.");
    this.#limit = limit;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  get depth(): number {
    return this.#undo.length;
  }

  /** Peeks at the label that Ctrl+Z would reverse. */
  get nextUndoLabel(): string | undefined {
    return this.#undo.at(-1)?.label;
  }

  get nextRedoLabel(): string | undefined {
    return this.#redo.at(-1)?.label;
  }

  /**
   * Performs a mutation and records it. `redo` runs immediately, so callers
   * describe the change once instead of applying it and then registering it.
   */
  perform(label: string, undo: () => void, redo: () => void, coalesceKey?: string): void {
    redo();
    const open = coalesceKey !== undefined && this.#coalesceKey === coalesceKey ? this.#undo.at(-1) : undefined;
    if (open !== undefined) {
      // Keep the group's original undo so one Ctrl+Z reverses the whole gesture.
      open.redo = redo;
    } else {
      this.#undo.push({ label, undo, redo });
      if (this.#undo.length > this.#limit) this.#undo.shift();
      this.#coalesceKey = coalesceKey;
    }
    this.#redo.length = 0;
    this.#changed();
  }

  /** Closes any open coalescing group, so the next edit starts a new entry. */
  endGesture(): void {
    this.#coalesceKey = undefined;
  }

  undo(): string | undefined {
    this.endGesture();
    const entry = this.#undo.pop();
    if (entry === undefined) return undefined;
    entry.undo();
    this.#redo.push(entry);
    this.#changed();
    return entry.label;
  }

  redo(): string | undefined {
    this.endGesture();
    const entry = this.#redo.pop();
    if (entry === undefined) return undefined;
    entry.redo();
    this.#undo.push(entry);
    this.#changed();
    return entry.label;
  }

  clear(): void {
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.endGesture();
    this.#changed();
  }

  #changed(): void {
    this.dispatchEvent(new Event("change"));
  }
}
