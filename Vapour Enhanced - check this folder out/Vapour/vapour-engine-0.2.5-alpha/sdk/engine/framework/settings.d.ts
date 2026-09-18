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
export declare class Settings<S extends SettingsSchema> {
    #private;
    readonly changed: Signal<SettingChange<S>>;
    constructor(schema: S, options?: SettingsOptions);
    get keys(): readonly (keyof S & string)[];
    definition<K extends keyof S & string>(key: K): S[K];
    get<K extends keyof S & string>(key: K): SettingsValues<S>[K];
    /** Sets a value, coercing it into the schema's range. Rejects a value of the
     * wrong type outright, since that is a programming error rather than a
     * player moving a slider too far. */
    set<K extends keyof S & string>(key: K, value: SettingsValues<S>[K]): void;
    /** Restores one setting, or all of them, to schema defaults. */
    reset<K extends keyof S & string>(key?: K): void;
    /** A plain object of every current value, for serialization or a UI. */
    snapshot(): SettingsValues<S>;
    /** Applies many values at once, skipping and reporting invalid ones. Used for
     * loading a settings file the player may have edited by hand. */
    apply(values: Readonly<Record<string, unknown>>): void;
    save(): void;
    /** Reloads from the store, discarding unsaved in-memory changes. */
    load(): void;
}
export {};
//# sourceMappingURL=settings.d.ts.map