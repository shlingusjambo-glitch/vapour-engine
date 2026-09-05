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

/** Matches `{name}` placeholders. Escaped as `{{` and `}}`. */
const PLACEHOLDER = /\{\{|\}\}|\{([^{}]+)\}/g;

/**
 * A registry of locale tables with an active locale.
 *
 * Emits `localeChanged` so UI, text meshes, and audio can re-resolve their
 * strings; nothing caches a resolved string across a locale change.
 */
export class Localization {
  readonly localeChanged = new Signal<string>();
  readonly #tables = new Map<string, LocaleTable>();
  readonly #sourceLocale: string;
  readonly #onMissing: ((key: string, locale: string) => void) | undefined;
  #locale: string;
  #pluralRules = new Map<string, Intl.PluralRules>();

  constructor(options: LocalizationOptions = {}) {
    this.#sourceLocale = normalizeLocale(options.sourceLocale ?? "en");
    this.#locale = this.#sourceLocale;
    this.#onMissing = options.onMissing;
  }

  get locale(): string {
    return this.#locale;
  }

  get sourceLocale(): string {
    return this.#sourceLocale;
  }

  get locales(): readonly string[] {
    return [...this.#tables.keys()].sort();
  }

  /** Adds or merges a locale table. Merging lets a game ship a base table and
   * patch it with downloaded translations. */
  register(locale: string, table: LocaleTable): void {
    const name = normalizeLocale(locale);
    const existing = this.#tables.get(name);
    this.#tables.set(name, existing ? { ...existing, ...table } : { ...table });
  }

  has(key: string, locale = this.#locale): boolean {
    return this.#resolveEntry(key, normalizeLocale(locale)) !== undefined;
  }

  setLocale(locale: string): void {
    const name = normalizeLocale(locale);
    if (name === this.#locale) return;
    this.#locale = name;
    this.localeChanged.emit(name);
  }

  /**
   * Picks the best available locale from a browser's preference list.
   *
   * Matches exactly first, then by language, so a player who asks for `pt-PT`
   * gets `pt` rather than English when only `pt` is available.
   */
  selectLocale(preferred: readonly string[]): string {
    const available = new Set(this.#tables.keys());
    for (const candidate of preferred.map(normalizeLocale)) {
      if (available.has(candidate)) return candidate;
      const language = candidate.split("-")[0]!;
      const match = [...available].find((locale) => locale === language || locale.startsWith(`${language}-`));
      if (match) return match;
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
  translate(key: string, variables: LocalizationVariables = {}): string {
    const entry = this.#resolveEntry(key, this.#locale);
    if (entry === undefined) {
      this.#onMissing?.(key, this.#locale);
      return key;
    }
    const template = typeof entry === "string" ? entry : this.#selectPlural(entry, variables);
    return interpolate(template, variables);
  }

  /** Alias for {@link translate}, matching the convention most string tables use. */
  t(key: string, variables: LocalizationVariables = {}): string {
    return this.translate(key, variables);
  }

  /** The locales tried for a key, in order. Useful for diagnostics. */
  fallbackChain(locale = this.#locale): readonly string[] {
    const name = normalizeLocale(locale);
    const chain = [name];
    const language = name.split("-")[0]!;
    if (language !== name) chain.push(language);
    if (!chain.includes(this.#sourceLocale)) chain.push(this.#sourceLocale);
    return chain;
  }

  /** Keys present in the source locale but missing from `locale` — the
   * translation gap, reportable in CI. */
  missingKeys(locale: string): readonly string[] {
    const source = this.#tables.get(this.#sourceLocale) ?? {};
    const target = this.#tables.get(normalizeLocale(locale)) ?? {};
    return Object.keys(source).filter((key) => !(key in target)).sort();
  }

  #resolveEntry(key: string, locale: string): LocaleEntry | undefined {
    for (const candidate of this.fallbackChain(locale)) {
      const entry = this.#tables.get(candidate)?.[key];
      if (entry !== undefined) return entry;
    }
    return undefined;
  }

  #selectPlural(entry: Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>, variables: LocalizationVariables): string {
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

function interpolate(template: string, variables: LocalizationVariables): string {
  return template.replace(PLACEHOLDER, (match, name: string | undefined) => {
    if (match === "{{") return "{";
    if (match === "}}") return "}";
    const value = variables[name!.trim()];
    return value === undefined ? match : String(value);
  });
}

function normalizeLocale(locale: string): string {
  const trimmed = locale.trim();
  if (!trimmed) throw new Error("A locale must not be empty.");
  const [language, ...rest] = trimmed.replace(/_/g, "-").split("-");
  return [language!.toLowerCase(), ...rest.map((part) => part.toUpperCase())].join("-");
}
