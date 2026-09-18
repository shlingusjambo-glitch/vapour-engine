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
/**
 * A schema-validated settings store.
 *
 * Emits `changed` for every individual change, which is how audio volume, the
 * renderer's quality tier, and input sensitivity stay in sync without polling.
 */
export class Settings {
    changed = new Signal();
    #schema;
    #values = new Map();
    #store;
    #storageKey;
    #onInvalid;
    constructor(schema, options = {}) {
        if (Object.keys(schema).length === 0)
            throw new Error("A settings schema requires at least one setting.");
        for (const [key, definition] of Object.entries(schema))
            validateDefinition(key, definition);
        this.#schema = schema;
        this.#store = options.store;
        this.#storageKey = options.storageKey ?? "settings";
        this.#onInvalid = options.onInvalid;
        for (const [key, definition] of Object.entries(schema))
            this.#values.set(key, definition.default);
        this.load();
    }
    get keys() {
        return Object.keys(this.#schema).sort();
    }
    definition(key) {
        const definition = this.#schema[key];
        if (!definition)
            throw new Error(`Unknown setting "${key}". Known settings: ${this.keys.join(", ")}.`);
        return definition;
    }
    get(key) {
        this.definition(key);
        return this.#values.get(key);
    }
    /** Sets a value, coercing it into the schema's range. Rejects a value of the
     * wrong type outright, since that is a programming error rather than a
     * player moving a slider too far. */
    set(key, value) {
        const definition = this.definition(key);
        const coerced = coerce(key, definition, value, "strict");
        const previous = this.#values.get(key);
        if (coerced === previous)
            return;
        this.#values.set(key, coerced);
        this.changed.emit({ key, value: coerced, previous });
        this.save();
    }
    /** Restores one setting, or all of them, to schema defaults. */
    reset(key) {
        const keys = key === undefined ? this.keys : [key];
        for (const name of keys)
            this.set(name, this.#schema[name].default);
    }
    /** A plain object of every current value, for serialization or a UI. */
    snapshot() {
        return Object.fromEntries(this.#values);
    }
    /** Applies many values at once, skipping and reporting invalid ones. Used for
     * loading a settings file the player may have edited by hand. */
    apply(values) {
        for (const [key, value] of Object.entries(values)) {
            const definition = this.#schema[key];
            if (!definition) {
                // An option removed in a later build: ignore rather than fail.
                this.#onInvalid?.(key, value, "unknown setting");
                continue;
            }
            try {
                const coerced = coerce(key, definition, value, "lenient");
                const previous = this.#values.get(key);
                if (coerced === previous)
                    continue;
                this.#values.set(key, coerced);
                this.changed.emit({ key: key, value: coerced, previous });
            }
            catch (error) {
                this.#onInvalid?.(key, value, error instanceof Error ? error.message : String(error));
            }
        }
        this.save();
    }
    save() {
        this.#store?.set(this.#storageKey, JSON.stringify(this.snapshot()));
    }
    /** Reloads from the store, discarding unsaved in-memory changes. */
    load() {
        const raw = this.#store?.get(this.#storageKey);
        if (raw === undefined)
            return;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (error) {
            this.#onInvalid?.(this.#storageKey, raw, `stored settings are not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            this.#onInvalid?.(this.#storageKey, parsed, "stored settings are not an object");
            return;
        }
        this.apply(parsed);
    }
}
function validateDefinition(key, definition) {
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
        if (typeof definition.default !== "boolean")
            throw new Error(`Setting "${key}" declares a boolean but its default is not one.`);
        return;
    }
    if (typeof definition.default !== "string")
        throw new Error(`Setting "${key}" declares a string but its default is not one.`);
    if (definition.options && !definition.options.includes(definition.default)) {
        throw new Error(`Setting "${key}" has default "${definition.default}", which is not one of its options.`);
    }
}
function coerce(key, definition, value, mode) {
    if (definition.kind === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(`Setting "${key}" expects a finite number but received ${describe(value)}.`);
        }
        let result = value;
        if (definition.step !== undefined)
            result = Math.round(result / definition.step) * definition.step;
        if (definition.min !== undefined)
            result = Math.max(definition.min, result);
        if (definition.max !== undefined)
            result = Math.min(definition.max, result);
        // Undo float noise introduced by the step quantization.
        return Number.parseFloat(result.toPrecision(12));
    }
    if (definition.kind === "boolean") {
        if (typeof value !== "boolean")
            throw new Error(`Setting "${key}" expects a boolean but received ${describe(value)}.`);
        return value;
    }
    if (typeof value !== "string")
        throw new Error(`Setting "${key}" expects a string but received ${describe(value)}.`);
    if (definition.options && !definition.options.includes(value)) {
        const message = `Setting "${key}" expects one of ${definition.options.join(", ")} but received "${value}".`;
        if (mode === "strict")
            throw new Error(message);
        throw new Error(message);
    }
    return value;
}
function describe(value) {
    return value === null ? "null" : Array.isArray(value) ? "an array" : `${typeof value} ${JSON.stringify(value) ?? ""}`.trim();
}
//# sourceMappingURL=settings.js.map