/** Localization: locale tables, fallback, interpolation, and plurals.
 *
 * Retrofitting localization is expensive, so the engine ships it as
 * infrastructure rather than leaving each game to invent a string table.
 *
 * Three decisions shape the design:
 *
 * - **A missing key is visible, not silent.** The default is to return the key
 *   itself and report it, because a blank label in a shipped build is far worse
 *   than an obviously wrong one during development.
 * - **Fallback is a chain, not a single language.** `pt-BR` falls back to `pt`,
 *   then to the source locale, which is how partially translated games ship.
 * - **Plurals use CLDR categories** via `Intl.PluralRules`, because "one" and
 *   "other" is wrong for most of the world's languages.
 */
import { Signal } from "./signal.js";
/** One locale's strings. Values may be a plain string or plural forms. */
export type LocaleEntry = string | Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>;
export type LocaleTable = Readonly<Record<string, LocaleEntry>>;
export type LocalizationVariables = Readonly<Record<string, string | number>>;
export interface LocalizationOptions {
    /** The locale used when a key is missing everywhere else. */
    readonly sourceLocale?: string;
    /** Called for every key that could not be resolved. */
    readonly onMissing?: (key: string, locale: string) => void;
}
/**
 * A registry of locale tables with an active locale.
 *
 * Emits `localeChanged` so UI, text meshes, and audio can re-resolve their
 * strings; nothing caches a resolved string across a locale change.
 */
export declare class Localization {
    #private;
    readonly localeChanged: Signal<string>;
    constructor(options?: LocalizationOptions);
    get locale(): string;
    get sourceLocale(): string;
    get locales(): readonly string[];
    /** Adds or merges a locale table. Merging lets a game ship a base table and
     * patch it with downloaded translations. */
    register(locale: string, table: LocaleTable): void;
    has(key: string, locale?: string): boolean;
    setLocale(locale: string): void;
    /**
     * Picks the best available locale from a browser's preference list.
     *
     * Matches exactly first, then by language, so a player who asks for `pt-PT`
     * gets `pt` rather than English when only `pt` is available.
     */
    selectLocale(preferred: readonly string[]): string;
    /**
     * Resolves a key in the active locale.
     *
     * `{name}` placeholders are replaced from `variables`; `{{` and `}}` are
     * literal braces. A placeholder with no matching variable is left in place so
     * the omission is visible in the UI rather than silently blank.
     */
    translate(key: string, variables?: LocalizationVariables): string;
    /** Alias for {@link translate}, matching the convention most string tables use. */
    t(key: string, variables?: LocalizationVariables): string;
    /** The locales tried for a key, in order. Useful for diagnostics. */
    fallbackChain(locale?: string): readonly string[];
    /** Keys present in the source locale but missing from `locale` — the
     * translation gap, reportable in CI. */
    missingKeys(locale: string): readonly string[];
}
//# sourceMappingURL=localization.d.ts.map