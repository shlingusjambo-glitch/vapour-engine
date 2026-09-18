/** Typed, validated, persisted game settings.
 *
 * Settings are one of the few pieces of state that outlive every other system:
 * they load before the renderer exists and must survive a build that renames
 * or removes options. So a settings store is declared as a *schema* — each
 * option's type, default, and valid range — and stored values are validated
 * against it on read.
 *
 * That means a corrupted or out-of-date stored value degrades to the default
 * with a warning instead of feeding `NaN` into the renderer, and an option
 * removed in a later build is simply ignored.
 */
import { Signal } from "./signal.js";
import type { KeyValueStore } from "./storage.js";

export type SettingValue = number | boolean | string;

interface SettingBase<T extends SettingValue> {
  readonly default: T;
  /** Shown in a settings UI. */
  readonly label?: string;
}

export interface NumberSetting extends SettingBase<number> {
  readonly kind: "number";
  readonly min?: number;
  readonly max?: number;
  /** Quantizes the value, e.g. `0.05` for a volume slider. */
  readonly step?: number;
}

export interface BooleanSetting extends SettingBase<boolean> {
  readonly kind: "boolean";
}

export interface StringSetting extends SettingBase<string> {
  readonly kind: "string";
  /** When present, only these values are accepted. */
  readonly options?: readonly string[];
}

export type SettingDefinition = NumberSetting | BooleanSetting | StringSetting;

export type SettingsSchema = Record<string, SettingDefinition>;

export type SettingsValues<S extends SettingsSchema> = {
  [K in keyof S]: S[K] extends NumberSetting ? number : S[K] extends BooleanSetting ? boolean : string;
};

export interface SettingChange<S extends SettingsSchema> {
  readonly key: keyof S & string;
  readonly value: SettingValue;
  readonly previous: SettingValue;
}

export interface SettingsOptions {
  /** Where values persist. Omit for in-memory settings. */
  readonly store?: KeyValueStore;
  /** Key the serialized values are stored under. */
  readonly storageKey?: string;
  /** Called when a stored value is rejected, so a game can log or report it. */
  readonly onInvalid?: (key: string, value: unknown, reason: string) => void;
}

/**
 * A schema-validated settings store.
 *
 * Emits `changed` for every individual change, which is how audio volume, the
 * renderer's quality tier, and input sensitivity stay in sync without polling.
 */
export class Settings<S extends SettingsSchema> {
  readonly changed = new Signal<SettingChange<S>>();
  readonly #schema: S;
  readonly #values = new Map<string, SettingValue>();
  readonly #store: KeyValueStore | undefined;
  readonly #storageKey: string;
  readonly #onInvalid: ((key: string, value: unknown, reason: string) => void) | undefined;

  constructor(schema: S, options: SettingsOptions = {}) {
    if (Object.keys(schema).length === 0) throw new Error("A settings schema requires at least one setting.");
    for (const [key, definition] of Object.entries(schema)) validateDefinition(key, definition);
    this.#schema = schema;
    this.#store = options.store;
    this.#storageKey = options.storageKey ?? "settings";
    this.#onInvalid = options.onInvalid;
    for (const [key, definition] of Object.entries(schema)) this.#values.set(key, definition.default);
    this.load();
  }

  get keys(): readonly (keyof S & string)[] {
    return Object.keys(this.#schema).sort() as (keyof S & string)[];
  }

  definition<K extends keyof S & string>(key: K): S[K] {
    const definition = this.#schema[key];
    if (!definition) throw new Error(`Unknown setting "${key}". Known settings: ${this.keys.join(", ")}.`);
    return definition as S[K];
  }

  get<K extends keyof S & string>(key: K): SettingsValues<S>[K] {
    this.definition(key);
    return this.#values.get(key) as SettingsValues<S>[K];
  }

  /** Sets a value, coercing it into the schema's range. Rejects a value of the
   * wrong type outright, since that is a programming error rather than a
   * player moving a slider too far. */
  set<K extends keyof S & string>(key: K, value: SettingsValues<S>[K]): void {
    const definition = this.definition(key);
    const coerced = coerce(key, definition, value, "strict");
    const previous = this.#values.get(key)!;
    if (coerced === previous) return;
    this.#values.set(key, coerced);
    this.changed.emit({ key, value: coerced, previous });
    this.save();
  }

  /** Restores one setting, or all of them, to schema defaults. */
  reset<K extends keyof S & string>(key?: K): void {
    const keys = key === undefined ? this.keys : [key];
    for (const name of keys) this.set(name, this.#schema[name]!.default as SettingsValues<S>[typeof name]);
  }

  /** A plain object of every current value, for serialization or a UI. */
  snapshot(): SettingsValues<S> {
    return Object.fromEntries(this.#values) as SettingsValues<S>;
  }

  /** Applies many values at once, skipping and reporting invalid ones. Used for
   * loading a settings file the player may have edited by hand. */
  apply(values: Readonly<Record<string, unknown>>): void {
    for (const [key, value] of Object.entries(values)) {
      const definition = this.#schema[key];
      if (!definition) {
        // An option removed in a later build: ignore rather than fail.
        this.#onInvalid?.(key, value, "unknown setting");
        continue;
      }
      try {
        const coerced = coerce(key, definition, value, "lenient");
        const previous = this.#values.get(key)!;
        if (coerced === previous) continue;
        this.#values.set(key, coerced);
        this.changed.emit({ key: key as keyof S & string, value: coerced, previous });
      } catch (error) {
        this.#onInvalid?.(key, value, error instanceof Error ? error.message : String(error));
      }
    }
    this.save();
  }

  save(): void {
    this.#store?.set(this.#storageKey, JSON.stringify(this.snapshot()));
  }

  /** Reloads from the store, discarding unsaved in-memory changes. */
  load(): void {
    const raw = this.#store?.get(this.#storageKey);
    if (raw === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.#onInvalid?.(this.#storageKey, raw, `stored settings are not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      this.#onInvalid?.(this.#storageKey, parsed, "stored settings are not an object");
      return;
    }
    this.apply(parsed as Record<string, unknown>);
  }
}

function validateDefinition(key: string, definition: SettingDefinition): void {
  if (definition.kind === "number") {
    if (typeof definition.default !== "number" || !Number.isFinite(definition.default)) {
      throw new Error(`Setting "${key}" declares a number but its default is not a finite number.`);
    }
    if (definition.min !== undefined && definition.max !== undefined && definition.min > definition.max) {
      throw new Error(`Setting "${key}" has min ${definition.min} greater than max ${definition.max}.`);
    }
    if (definition.step !== undefined && !(definition.step > 0)) {
      throw new Error(`Setting "${key}" has a non-positive step.`);
    }
    return;
  }
  if (definition.kind === "boolean") {
    if (typeof definition.default !== "boolean") throw new Error(`Setting "${key}" declares a boolean but its default is not one.`);
    return;
  }
  if (typeof definition.default !== "string") throw new Error(`Setting "${key}" declares a string but its default is not one.`);
  if (definition.options && !definition.options.includes(definition.default)) {
    throw new Error(`Setting "${key}" has default "${definition.default}", which is not one of its options.`);
  }
}

function coerce(key: string, definition: SettingDefinition, value: unknown, mode: "strict" | "lenient"): SettingValue {
  if (definition.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Setting "${key}" expects a finite number but received ${describe(value)}.`);
    }
    let result = value;
    if (definition.step !== undefined) result = Math.round(result / definition.step) * definition.step;
    if (definition.min !== undefined) result = Math.max(definition.min, result);
    if (definition.max !== undefined) result = Math.min(definition.max, result);
    // Undo float noise introduced by the step quantization.
    return Number.parseFloat(result.toPrecision(12));
  }
  if (definition.kind === "boolean") {
    if (typeof value !== "boolean") throw new Error(`Setting "${key}" expects a boolean but received ${describe(value)}.`);
    return value;
  }
  if (typeof value !== "string") throw new Error(`Setting "${key}" expects a string but received ${describe(value)}.`);
  if (definition.options && !definition.options.includes(value)) {
    const message = `Setting "${key}" expects one of ${definition.options.join(", ")} but received "${value}".`;
    if (mode === "strict") throw new Error(message);
    throw new Error(message);
  }
  return value;
}

function describe(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "an array" : `${typeof value} ${JSON.stringify(value) ?? ""}`.trim();
}
