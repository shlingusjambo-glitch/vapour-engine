export interface DamageRequest<TSource = unknown> {
  readonly amount: number;
  readonly kind: string;
  readonly source?: TSource;
  readonly tags?: readonly string[];
  readonly time?: number;
}

export interface DamageContext<TSource = unknown> extends DamageRequest<TSource> {
  amount: number;
  readonly target: Combatant<TSource>;
}

export interface DamageModifier<TSource = unknown> {
  readonly id: string;
  readonly priority?: number;
  readonly applies?: (context: Readonly<DamageContext<TSource>>) => boolean;
  /** Return a new amount, or null to cancel the hit. */
  readonly modify: (context: Readonly<DamageContext<TSource>>) => number | null;
}

export interface DamageResult<TSource = unknown> {
  readonly accepted: boolean;
  readonly reason?: "dead" | "invulnerable" | "cancelled" | "zero";
  readonly requested: number;
  readonly applied: number;
  readonly before: number;
  readonly after: number;
  readonly killed: boolean;
  readonly kind: string;
  readonly source?: TSource;
}

export type CombatEvent<TSource = unknown> =
  | { readonly type: "damaged"; readonly result: DamageResult<TSource> }
  | { readonly type: "healed"; readonly amount: number; readonly before: number; readonly after: number }
  | { readonly type: "died"; readonly result: DamageResult<TSource> }
  | { readonly type: "revived"; readonly health: number }
  | { readonly type: "health-set"; readonly before: number; readonly after: number };

export interface CombatantOptions {
  readonly maxHealth: number;
  readonly health?: number;
  readonly invulnerabilitySeconds?: number;
  readonly clock?: () => number;
}

/** Deterministic health/damage lifecycle. Presentation, equipment lookup,
 * particles, drops, and game rules attach through modifiers and events. */
export class Combatant<TSource = unknown> {
  readonly #modifiers = new Map<string, DamageModifier<TSource>>();
  readonly #listeners = new Set<(event: CombatEvent<TSource>) => void>();
  readonly #clock: () => number;
  #maxHealth: number;
  #health: number;
  #invulnerabilitySeconds: number;
  #invulnerableUntil = -Infinity;

  constructor(options: CombatantOptions) {
    this.#maxHealth = positive(options.maxHealth, "Maximum health");
    this.#health = Math.min(this.#maxHealth, nonnegative(options.health ?? options.maxHealth, "Health"));
    this.#invulnerabilitySeconds = nonnegative(options.invulnerabilitySeconds ?? 0, "Invulnerability duration");
    this.#clock = options.clock ?? (() => performance.now() / 1000);
  }

  get health(): number { return this.#health; }
  get maxHealth(): number { return this.#maxHealth; }
  get alive(): boolean { return this.#health > 0; }
  get healthFraction(): number { return this.#health / this.#maxHealth; }
  get invulnerableUntil(): number { return this.#invulnerableUntil; }

  subscribe(listener: (event: CombatEvent<TSource>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  addModifier(modifier: DamageModifier<TSource>): () => void {
    const id = modifier.id.trim();
    if (!id) throw new Error("Damage modifier ID must not be empty.");
    if (this.#modifiers.has(id)) throw new Error(`Damage modifier '${id}' is already registered.`);
    this.#modifiers.set(id, { ...modifier, id });
    return () => this.#modifiers.delete(id);
  }

  damage(request: DamageRequest<TSource>): DamageResult<TSource> {
    const requested = nonnegative(request.amount, "Damage amount");
    const before = this.#health;
    const base = { requested, before, after: before, applied: 0, killed: false, kind: request.kind, ...(request.source !== undefined ? { source: request.source } : {}) };
    if (!this.alive) return Object.freeze({ ...base, accepted: false, reason: "dead" });
    const time = request.time ?? this.#clock();
    if (time < this.#invulnerableUntil && !request.tags?.includes("bypass-invulnerability")) {
      return Object.freeze({ ...base, accepted: false, reason: "invulnerable" });
    }
    if (requested === 0) return Object.freeze({ ...base, accepted: false, reason: "zero" });

    const context: DamageContext<TSource> = { ...request, amount: requested, target: this };
    if (!request.tags?.includes("bypass-modifiers")) {
      const modifiers = [...this.#modifiers.values()].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
      for (const modifier of modifiers) {
        if (modifier.applies && !modifier.applies(context)) continue;
        const amount = modifier.modify(context);
        if (amount === null) return Object.freeze({ ...base, accepted: false, reason: "cancelled" });
        context.amount = nonnegative(amount, `Damage modifier '${modifier.id}' result`);
      }
    }
    if (context.amount === 0) return Object.freeze({ ...base, accepted: false, reason: "zero" });

    const applied = Math.min(before, context.amount);
    this.#health = Math.max(0, before - applied);
    this.#invulnerableUntil = time + this.#invulnerabilitySeconds;
    const result: DamageResult<TSource> = Object.freeze({ ...base, accepted: true, applied, after: this.#health, killed: before > 0 && this.#health === 0 });
    this.#emit({ type: "damaged", result });
    if (result.killed) this.#emit({ type: "died", result });
    return result;
  }

  heal(amount: number): number {
    const requested = nonnegative(amount, "Healing amount");
    if (!this.alive || requested === 0) return 0;
    const before = this.#health;
    this.#health = Math.min(this.#maxHealth, before + requested);
    const applied = this.#health - before;
    if (applied > 0) this.#emit({ type: "healed", amount: applied, before, after: this.#health });
    return applied;
  }

  setHealth(health: number): void {
    const before = this.#health;
    this.#health = Math.min(this.#maxHealth, nonnegative(health, "Health"));
    if (before !== this.#health) this.#emit({ type: "health-set", before, after: this.#health });
  }

  setMaxHealth(maxHealth: number, preserveFraction = false): void {
    const next = positive(maxHealth, "Maximum health");
    const health = preserveFraction ? this.healthFraction * next : Math.min(this.#health, next);
    this.#maxHealth = next;
    this.setHealth(health);
  }

  kill(kind = "script"): DamageResult<TSource> {
    return this.damage({ amount: this.#health, kind, tags: ["bypass-invulnerability", "bypass-modifiers"] });
  }

  revive(health = this.#maxHealth): void {
    if (this.alive) { this.setHealth(health); return; }
    this.#health = Math.min(this.#maxHealth, positive(health, "Revive health"));
    this.#invulnerableUntil = -Infinity;
    this.#emit({ type: "revived", health: this.#health });
  }

  setInvulnerabilityDuration(seconds: number): void {
    this.#invulnerabilitySeconds = nonnegative(seconds, "Invulnerability duration");
  }

  clearInvulnerability(): void { this.#invulnerableUntil = -Infinity; }

  #emit(event: CombatEvent<TSource>): void {
    for (const listener of this.#listeners) listener(event);
  }
}

export interface ArmorMitigationOptions {
  readonly points: () => number;
  readonly reductionPerPoint?: number;
  readonly maximumReduction?: number;
  readonly minimumDamage?: number;
  readonly bypassKinds?: ReadonlySet<string>;
}

export function armorDamageModifier<TSource>(options: ArmorMitigationOptions): DamageModifier<TSource> {
  const perPoint = nonnegative(options.reductionPerPoint ?? 0.04, "Armor reduction per point");
  const cap = Math.min(1, nonnegative(options.maximumReduction ?? 0.8, "Maximum armor reduction"));
  const minimum = nonnegative(options.minimumDamage ?? 0, "Minimum mitigated damage");
  return {
    id: "vapour:armor",
    priority: 100,
    applies: (context) => !options.bypassKinds?.has(context.kind),
    modify: (context) => Math.max(minimum, context.amount * (1 - Math.min(cap, Math.max(0, options.points()) * perPoint))),
  };
}

function nonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative.`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive.`);
  return value;
}
