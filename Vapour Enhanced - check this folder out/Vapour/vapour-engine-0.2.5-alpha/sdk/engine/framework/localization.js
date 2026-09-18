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
/** Matches `{name}` placeholders. Escaped as `{{` and `}}`. */
const PLACEHOLDER = /\{\{|\}\}|\{([^{}]+)\}/g;
/**
 * A registry of locale tables with an active locale.
 *
 * Emits `localeChanged` so UI, text meshes, and audio can re-resolve their
 * strings; nothing caches a resolved string across a locale change.
 */
export class Localization {
    localeChanged = new Signal();
    #tables = new Map();
    #sourceLocale;
    #onMissing;
    #locale;
    #pluralRules = new Map();
    constructor(options = {}) {
        this.#sourceLocale = normalizeLocale(options.sourceLocale ?? "en");
        this.#locale = this.#sourceLocale;
        this.#onMissing = options.onMissing;
    }
    get locale() {
        return this.#locale;
    }
    get sourceLocale() {
        return this.#sourceLocale;
    }
    get locales() {
        return [...this.#tables.keys()].sort();
    }
    /** Adds or merges a locale table. Merging lets a game ship a base table and
     * patch it with downloaded translations. */
    register(locale, table) {
        const name = normalizeLocale(locale);
        const existing = this.#tables.get(name);
        this.#tables.set(name, existing ? { ...existing, ...table } : { ...table });
    }
    has(key, locale = this.#locale) {
        return this.#resolveEntry(key, normalizeLocale(locale)) !== undefined;
    }
    setLocale(locale) {
        const name = normalizeLocale(locale);
        if (name === this.#locale)
            return;
        this.#locale = name;
        this.localeChanged.emit(name);
    }
    /**
     * Picks the best available locale from a browser's preference list.
     *
     * Matches exactly first, then by language, so a player who asks for `pt-PT`
     * gets `pt` rather than English when only `pt` is available.
     */
    selectLocale(preferred) {
        const available = new Set(this.#tables.keys());
        for (const candidate of preferred.map(normalizeLocale)) {
            if (available.has(candidate))
                return candidate;
            const language = candidate.split("-")[0];
            const match = [...available].find((locale) => locale === language || locale.startsWith(`${language}-`));
            if (match)
                return match;
        }
        return this.#sourceLocale;
    }
    /**
     * Resolves a key in the active locale.
     *
     * `{name}` placeholders are replaced from `variables`; `{{` and `}}` are
     * literal braces. A placeholder with no matching variable is left in place so
     * the omission is visible in the UI rather than silently blank.
     */
    translate(key, variables = {}) {
        const entry = this.#resolveEntry(key, this.#locale);
        if (entry === undefined) {
            this.#onMissing?.(key, this.#locale);
            return key;
        }
        const template = typeof entry === "string" ? entry : this.#selectPlural(entry, variables);
        return interpolate(template, variables);
    }
    /** Alias for {@link translate}, matching the convention most string tables use. */
    t(key, variables = {}) {
        return this.translate(key, variables);
    }
    /** The locales tried for a key, in order. Useful for diagnostics. */
    fallbackChain(locale = this.#locale) {
        const name = normalizeLocale(locale);
        const chain = [name];
        const language = name.split("-")[0];
        if (language !== name)
            chain.push(language);
        if (!chain.includes(this.#sourceLocale))
            chain.push(this.#sourceLocale);
        return chain;
    }
    /** Keys present in the source locale but missing from `locale` — the
     * translation gap, reportable in CI. */
    missingKeys(locale) {
        const source = this.#tables.get(this.#sourceLocale) ?? {};
        const target = this.#tables.get(normalizeLocale(locale)) ?? {};
        return Object.keys(source).filter((key) => !(key in target)).sort();
    }
    #resolveEntry(key, locale) {
        for (const candidate of this.fallbackChain(locale)) {
            const entry = this.#tables.get(candidate)?.[key];
            if (entry !== undefined)
                return entry;
        }
        return undefined;
    }
    #selectPlural(entry, variables) {
        const count = variables["count"];
        if (typeof count !== "number") {
            return entry.other ?? Object.values(entry)[0] ?? "";
        }
        let rules = this.#pluralRules.get(this.#locale);
        if (!rules) {
            rules = new Intl.PluralRules(this.#locale);
            this.#pluralRules.set(this.#locale, rules);
        }
        const category = rules.select(count);
        // `other` always exists in a well-formed table and is the CLDR fallback.
        return entry[category] ?? entry.other ?? Object.values(entry)[0] ?? "";
    }
}
function interpolate(template, variables) {
    return template.replace(PLACEHOLDER, (match, name) => {
        if (match === "{{")
            return "{";
        if (match === "}}")
            return "}";
        const value = variables[name.trim()];
        return value === undefined ? match : String(value);
    });
}
function normalizeLocale(locale) {
    const trimmed = locale.trim();
    if (!trimmed)
        throw new Error("A locale must not be empty.");
    const [language, ...rest] = trimmed.replace(/_/g, "-").split("-");
    return [language.toLowerCase(), ...rest.map((part) => part.toUpperCase())].join("-");
}
//# sourceMappingURL=localization.js.map