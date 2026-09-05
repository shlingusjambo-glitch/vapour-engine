export interface StatusEffectDefinition<TId extends string = string> {
  readonly id: TId;
  readonly tickInterval?: number;
}

export interface StatusEffectSnapshot<TId extends string = string> {
  readonly id: TId;
  readonly remaining: number;
  readonly duration: number;
}

export type StatusEffectEvent<TId extends string = string> =
  | { readonly type: "applied" | "refreshed"; readonly effect: StatusEffectSnapshot<TId> }
  | { readonly type: "tick"; readonly effect: StatusEffectSnapshot<TId>; readonly tick: number }
  | { readonly type: "expired" | "removed"; readonly effect: StatusEffectSnapshot<TId> }
  | { readonly type: "cleared"; readonly effects: readonly StatusEffectSnapshot<TId>[] };

interface MutableEffect<TId extends string> {
  readonly id: TId;
  duration: number;
  remaining: number;
  tickElapsed: number;
  ticks: number;
}

/** Simulation-clock status effects with Map-like read methods. `update(dt)` is
 * deterministic and catches up periodic ticks after long frames. */
export class StatusEffectSet<TId extends string = string> {
  readonly #definitions = new Map<TId, StatusEffectDefinition<TId>>();
  readonly #effects = new Map<TId, MutableEffect<TId>>();
  readonly #listeners = new Set<(event: StatusEffectEvent<TId>) => void>();

  constructor(definitions: readonly StatusEffectDefinition<TId>[] = []) {
    for (const definition of definitions) this.define(definition);
  }

  get size(): number { return this.#effects.size; }

  define(definition: StatusEffectDefinition<TId>): void {
    if (!definition.id) throw new Error("Status effect ID must not be empty.");
    if (this.#definitions.has(definition.id)) throw new Error(`Status effect '${definition.id}' is already defined.`);
    if (definition.tickInterval !== undefined) positive(definition.tickInterval, "Status effect tick interval");
    this.#definitions.set(definition.id, Object.freeze({ ...definition }));
  }

  subscribe(listener: (event: StatusEffectEvent<TId>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  has(id: TId): boolean { return this.#effects.has(id); }
  get(id: TId): number | undefined { return this.#effects.get(id)?.remaining; }
  keys(): MapIterator<TId> { return this.#effects.keys(); }
  values(): MapIterator<number> { return this.#durationMap().values(); }
  entries(): MapIterator<[TId, number]> { return this.#durationMap().entries(); }
  [Symbol.iterator](): MapIterator<[TId, number]> { return this.entries(); }

  snapshot(): readonly StatusEffectSnapshot<TId>[] {
    return Object.freeze([...this.#effects.values()].map((effect) => this.#snapshot(effect)));
  }

  /** Applies or refreshes an effect and returns this for Map compatibility. */
  set(id: TId, duration: number): this {
    const seconds = positive(duration, "Status effect duration");
    const existing = this.#effects.get(id);
    if (existing) {
      existing.duration = seconds;
      existing.remaining = seconds;
      existing.tickElapsed = 0;
      existing.ticks = 0;
      this.#emit({ type: "refreshed", effect: this.#snapshot(existing) });
    } else {
      const effect: MutableEffect<TId> = { id, duration: seconds, remaining: seconds, tickElapsed: 0, ticks: 0 };
      this.#effects.set(id, effect);
      this.#emit({ type: "applied", effect: this.#snapshot(effect) });
    }
    return this;
  }

  delete(id: TId): boolean {
    const effect = this.#effects.get(id);
    if (!effect) return false;
    this.#effects.delete(id);
    this.#emit({ type: "removed", effect: this.#snapshot(effect) });
    return true;
  }

  clear(): void {
    if (this.#effects.size === 0) return;
    const effects = this.snapshot();
    this.#effects.clear();
    this.#emit({ type: "cleared", effects });
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("Status effect delta must be finite and non-negative.");
    if (deltaSeconds === 0) return;
    for (const effect of [...this.#effects.values()]) {
      const activeDelta = Math.min(deltaSeconds, effect.remaining);
      effect.remaining = Math.max(0, effect.remaining - deltaSeconds);
      const interval = this.#definitions.get(effect.id)?.tickInterval;
      if (interval !== undefined) {
        effect.tickElapsed += activeDelta;
        while (effect.tickElapsed >= interval) {
          effect.tickElapsed -= interval;
          effect.ticks++;
          this.#emit({ type: "tick", effect: this.#snapshot(effect), tick: effect.ticks });
        }
      }
      if (effect.remaining === 0 && this.#effects.delete(effect.id)) {
        this.#emit({ type: "expired", effect: this.#snapshot(effect) });
      }
    }
  }

  #durationMap(): Map<TId, number> {
    return new Map([...this.#effects].map(([id, effect]) => [id, effect.remaining]));
  }

  #snapshot(effect: MutableEffect<TId>): StatusEffectSnapshot<TId> {
    return Object.freeze({ id: effect.id, remaining: effect.remaining, duration: effect.duration });
  }

  #emit(event: StatusEffectEvent<TId>): void {
    for (const listener of this.#listeners) listener(event);
  }
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive.`);
  return value;
}
