export interface InventoryStack<TId = string> {
  readonly id: TId;
  count: number;
}

export interface SlotRange {
  readonly start: number;
  readonly end: number;
}

export interface InventoryChange<TStack> {
  readonly revision: number;
  readonly changedSlots: readonly number[];
  readonly slots: readonly (TStack | null)[];
}

export interface InventoryOptions<TStack extends InventoryStack<unknown>> {
  readonly slots: number;
  readonly maxStack: (stack: Readonly<TStack>) => number;
  readonly canStack?: (existing: Readonly<TStack>, incoming: Readonly<TStack>) => boolean;
  readonly accepts?: (slot: number, stack: Readonly<TStack>) => boolean;
  readonly clone?: (stack: Readonly<TStack>) => TStack;
}

/** Generic, observable slot inventory with atomic mutations and no dependency
 * on rendering, UI, persistence, or a particular item-ID type. */
export class InventoryContainer<TStack extends InventoryStack<unknown>> {
  readonly #slots: Array<TStack | null>;
  readonly #maxStack: InventoryOptions<TStack>["maxStack"];
  readonly #canStack: NonNullable<InventoryOptions<TStack>["canStack"]>;
  readonly #accepts: NonNullable<InventoryOptions<TStack>["accepts"]>;
  readonly #clone: NonNullable<InventoryOptions<TStack>["clone"]>;
  readonly #listeners = new Set<(change: InventoryChange<TStack>) => void>();
  readonly #dirty = new Set<number>();
  #revision = 0;
  #batchDepth = 0;

  constructor(options: InventoryOptions<TStack>) {
    if (!Number.isInteger(options.slots) || options.slots <= 0) throw new Error("Inventory slot count must be a positive integer.");
    this.#slots = new Array<TStack | null>(options.slots).fill(null);
    this.#maxStack = options.maxStack;
    this.#canStack = options.canStack ?? ((existing, incoming) => Object.is(existing.id, incoming.id));
    this.#accepts = options.accepts ?? (() => true);
    this.#clone = options.clone ?? ((stack) => ({ ...stack }) as TStack);
  }

  get size(): number { return this.#slots.length; }
  get revision(): number { return this.#revision; }

  subscribe(listener: (change: InventoryChange<TStack>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get(slot: number): TStack | null {
    this.#assertSlot(slot);
    const stack = this.#slots[slot];
    return stack ? this.#clone(stack) : null;
  }

  snapshot(): readonly (TStack | null)[] {
    return Object.freeze(this.#slots.map((stack) => stack ? this.#clone(stack) : null));
  }

  set(slot: number, stack: Readonly<TStack> | null): void {
    this.#assertSlot(slot);
    if (stack && !this.#accepts(slot, stack)) throw new Error(`Inventory slot ${slot} does not accept this stack.`);
    this.#slots[slot] = stack ? this.#normalize(stack) : null;
    this.#mark(slot);
  }

  restore(slots: readonly (Readonly<TStack> | null)[]): void {
    if (slots.length > this.size) throw new Error(`Inventory snapshot has ${slots.length} slots; capacity is ${this.size}.`);
    this.batch(() => {
      for (let slot = 0; slot < this.size; slot++) this.set(slot, slots[slot] ?? null);
    });
  }

  /** Adds to compatible stacks before empty slots. Returns the uninserted stack. */
  add(stack: Readonly<TStack>, range: SlotRange = { start: 0, end: this.size }): TStack | null {
    this.#assertRange(range);
    const remaining = this.#clone(stack);
    remaining.count = this.#positiveInteger(remaining.count, "Stack count");
    this.batch(() => {
      for (let slot = range.start; slot < range.end && remaining.count > 0; slot++) {
        const existing = this.#slots[slot];
        if (!existing || !this.#canStack(existing, remaining) || !this.#accepts(slot, remaining)) continue;
        const available = this.#limit(existing) - existing.count;
        if (available <= 0) continue;
        const moved = Math.min(available, remaining.count);
        existing.count += moved;
        remaining.count -= moved;
        this.#mark(slot);
      }
      for (let slot = range.start; slot < range.end && remaining.count > 0; slot++) {
        if (this.#slots[slot] || !this.#accepts(slot, remaining)) continue;
        const moved = Math.min(this.#limit(remaining), remaining.count);
        const inserted = this.#clone(remaining);
        inserted.count = moved;
        this.#slots[slot] = inserted;
        remaining.count -= moved;
        this.#mark(slot);
      }
    });
    return remaining.count > 0 ? remaining : null;
  }

  count(id: TStack["id"], range: SlotRange = { start: 0, end: this.size }): number {
    this.#assertRange(range);
    let total = 0;
    for (let slot = range.start; slot < range.end; slot++) {
      const stack = this.#slots[slot];
      if (stack && Object.is(stack.id, id)) total += stack.count;
    }
    return total;
  }

  find(id: TStack["id"], range: SlotRange = { start: 0, end: this.size }): number {
    this.#assertRange(range);
    for (let slot = range.start; slot < range.end; slot++) {
      const stack = this.#slots[slot];
      if (stack && Object.is(stack.id, id) && stack.count > 0) return slot;
    }
    return -1;
  }

  /** Removes only when the full amount exists, so failed purchases are atomic. */
  remove(id: TStack["id"], amount: number, range: SlotRange = { start: 0, end: this.size }): boolean {
    const count = this.#positiveInteger(amount, "Remove amount");
    if (this.count(id, range) < count) return false;
    let remaining = count;
    this.batch(() => {
      for (let slot = range.start; slot < range.end && remaining > 0; slot++) {
        const stack = this.#slots[slot];
        if (!stack || !Object.is(stack.id, id)) continue;
        const moved = Math.min(stack.count, remaining);
        stack.count -= moved;
        remaining -= moved;
        if (stack.count === 0) this.#slots[slot] = null;
        this.#mark(slot);
      }
    });
    return true;
  }

  removeFromSlot(slot: number, amount: number): TStack | null {
    this.#assertSlot(slot);
    const count = this.#positiveInteger(amount, "Remove amount");
    const stack = this.#slots[slot];
    if (!stack) return null;
    const removed = this.#clone(stack);
    removed.count = Math.min(count, stack.count);
    stack.count -= removed.count;
    if (stack.count === 0) this.#slots[slot] = null;
    this.#mark(slot);
    return removed;
  }

  swap(first: number, second: number): void {
    this.#assertSlot(first);
    this.#assertSlot(second);
    if (first === second) return;
    const a = this.#slots[first] ?? null;
    const b = this.#slots[second] ?? null;
    if (a && !this.#accepts(second, a)) throw new Error(`Inventory slot ${second} does not accept this stack.`);
    if (b && !this.#accepts(first, b)) throw new Error(`Inventory slot ${first} does not accept this stack.`);
    this.#slots[first] = b;
    this.#slots[second] = a;
    this.batch(() => { this.#mark(first); this.#mark(second); });
  }

  clear(range: SlotRange = { start: 0, end: this.size }): void {
    this.#assertRange(range);
    this.batch(() => {
      for (let slot = range.start; slot < range.end; slot++) {
        if (!this.#slots[slot]) continue;
        this.#slots[slot] = null;
        this.#mark(slot);
      }
    });
  }

  batch<T>(operation: () => T): T {
    this.#batchDepth++;
    try { return operation(); }
    finally {
      this.#batchDepth--;
      if (this.#batchDepth === 0) this.#flush();
    }
  }

  #normalize(stack: Readonly<TStack>): TStack {
    const copy = this.#clone(stack);
    copy.count = this.#positiveInteger(copy.count, "Stack count");
    const limit = this.#limit(copy);
    if (copy.count > limit) throw new Error(`Stack count ${copy.count} exceeds its limit of ${limit}.`);
    return copy;
  }

  #limit(stack: Readonly<TStack>): number {
    return this.#positiveInteger(this.#maxStack(stack), "Maximum stack size");
  }

  #positiveInteger(value: number, label: string): number {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number.`);
    return Math.floor(value);
  }

  #assertSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.size) throw new RangeError(`Inventory slot ${slot} is outside 0..${this.size - 1}.`);
  }

  #assertRange(range: SlotRange): void {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end > this.size || range.start > range.end) {
      throw new RangeError(`Inventory range ${range.start}..${range.end} is outside capacity ${this.size}.`);
    }
  }

  #mark(slot: number): void {
    this.#dirty.add(slot);
    if (this.#batchDepth === 0) this.#flush();
  }

  #flush(): void {
    if (this.#dirty.size === 0) return;
    const changedSlots = Object.freeze([...this.#dirty].sort((a, b) => a - b));
    this.#dirty.clear();
    const change = Object.freeze({ revision: ++this.#revision, changedSlots, slots: this.snapshot() });
    for (const listener of this.#listeners) listener(change);
  }
}
