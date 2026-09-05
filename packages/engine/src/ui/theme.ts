/** Themes and styling.
 *
 * A theme is a named set of design tokens — colours, spacing, radii, type
 * sizes — that widgets resolve against, rather than each widget carrying literal
 * values. That indirection is what makes a light and dark theme, a high-contrast
 * accessibility mode, and a per-faction reskin the same mechanism instead of
 * three.
 *
 * Tokens resolve through **inheritance**: a theme may extend another and
 * override only what differs, so a high-contrast variant is a dozen tokens
 * rather than a full copy that silently drifts from the base.
 */
import type { Rgba } from "@vapour/math";

export type ThemeTokens = Readonly<Record<string, string | number | Rgba>>;

export interface ThemeDefinition {
  readonly name: string;
  /** Theme this one inherits from. */
  readonly extends?: string;
  readonly tokens: ThemeTokens;
}

/** The token names Vapour's own widgets resolve. */
export const STANDARD_TOKENS = {
  background: "color.background",
  surface: "color.surface",
  text: "color.text",
  textMuted: "color.textMuted",
  accent: "color.accent",
  danger: "color.danger",
  border: "color.border",
  focusRing: "color.focusRing",
  spacingSmall: "space.small",
  spacing: "space.medium",
  spacingLarge: "space.large",
  radius: "shape.radius",
  fontSize: "text.size",
  fontSizeSmall: "text.sizeSmall",
  fontSizeLarge: "text.sizeLarge",
} as const;

/** A readable default, and the base every other theme should extend. */
export function defaultTheme(): ThemeDefinition {
  return {
    name: "default",
    tokens: {
      [STANDARD_TOKENS.background]: [0.09, 0.10, 0.12, 1],
      [STANDARD_TOKENS.surface]: [0.14, 0.15, 0.18, 1],
      [STANDARD_TOKENS.text]: [0.94, 0.95, 0.97, 1],
      [STANDARD_TOKENS.textMuted]: [0.62, 0.65, 0.70, 1],
      [STANDARD_TOKENS.accent]: [0.30, 0.60, 1.0, 1],
      [STANDARD_TOKENS.danger]: [0.95, 0.35, 0.30, 1],
      [STANDARD_TOKENS.border]: [0.24, 0.26, 0.30, 1],
      [STANDARD_TOKENS.focusRing]: [0.45, 0.75, 1.0, 1],
      [STANDARD_TOKENS.spacingSmall]: 4,
      [STANDARD_TOKENS.spacing]: 8,
      [STANDARD_TOKENS.spacingLarge]: 16,
      [STANDARD_TOKENS.radius]: 6,
      [STANDARD_TOKENS.fontSize]: 16,
      [STANDARD_TOKENS.fontSizeSmall]: 13,
      [STANDARD_TOKENS.fontSizeLarge]: 22,
    },
  };
}

/**
 * A high-contrast variant.
 *
 * Provided rather than left to each game because "we will add accessibility
 * later" reliably means never, and because getting it right is a dozen tokens
 * when the theme system exists and a rewrite when it does not.
 */
export function highContrastTheme(): ThemeDefinition {
  return {
    name: "high-contrast",
    extends: "default",
    tokens: {
      [STANDARD_TOKENS.background]: [0, 0, 0, 1],
      [STANDARD_TOKENS.surface]: [0.05, 0.05, 0.05, 1],
      [STANDARD_TOKENS.text]: [1, 1, 1, 1],
      [STANDARD_TOKENS.textMuted]: [0.85, 0.85, 0.85, 1],
      [STANDARD_TOKENS.accent]: [1, 0.85, 0, 1],
      [STANDARD_TOKENS.border]: [1, 1, 1, 1],
      [STANDARD_TOKENS.focusRing]: [1, 0.85, 0, 1],
    },
  };
}

export interface ThemeStats {
  readonly themes: number;
  readonly active: string;
  readonly tokens: number;
}

/**
 * A registry of themes with one active at a time.
 *
 * Resolution walks the inheritance chain and caches the flattened result, so a
 * widget asking for a token every frame costs a map lookup rather than a chain
 * walk.
 */
export class ThemeRegistry {
  readonly #themes = new Map<string, ThemeDefinition>();
  readonly #resolved = new Map<string, ThemeTokens>();
  #active = "default";

  constructor(themes: readonly ThemeDefinition[] = [defaultTheme(), highContrastTheme()]) {
    for (const theme of themes) this.register(theme);
  }

  register(theme: ThemeDefinition): void {
    if (!theme.name.trim()) throw new Error("A theme requires a non-empty name.");
    this.#themes.set(theme.name, theme);
    // Any theme may inherit from this one, so every cached result is suspect.
    this.#resolved.clear();
  }

  get names(): readonly string[] {
    return [...this.#themes.keys()].sort();
  }

  get active(): string {
    return this.#active;
  }

  setActive(name: string): void {
    if (!this.#themes.has(name)) {
      throw new Error(`No theme named "${name}". Themes: ${this.names.join(", ")}.`);
    }
    this.#active = name;
  }

  /** Every token of a theme, with inherited values merged in. */
  resolve(name = this.#active): ThemeTokens {
    const cached = this.#resolved.get(name);
    if (cached) return cached;

    const chain: ThemeDefinition[] = [];
    const seen = new Set<string>();
    let current: ThemeDefinition | undefined = this.#themes.get(name);
    if (!current) throw new Error(`No theme named "${name}". Themes: ${this.names.join(", ")}.`);
    while (current) {
      if (seen.has(current.name)) {
        throw new Error(`Theme inheritance cycle: ${[...seen, current.name].join(" -> ")}.`);
      }
      seen.add(current.name);
      chain.unshift(current);
      current = current.extends === undefined ? undefined : this.#themes.get(current.extends);
    }

    const merged: Record<string, string | number | Rgba> = {};
    for (const theme of chain) Object.assign(merged, theme.tokens);
    this.#resolved.set(name, merged);
    return merged;
  }

  /**
   * One token from the active theme.
   *
   * A missing token throws rather than returning a default, because a widget
   * silently rendering with the wrong colour is far harder to notice than a
   * failure at startup.
   */
  token(name: string, theme = this.#active): string | number | Rgba {
    const tokens = this.resolve(theme);
    const value = tokens[name];
    if (value === undefined) {
      throw new Error(`Theme "${theme}" has no token "${name}". Tokens: ${Object.keys(tokens).sort().join(", ")}.`);
    }
    return value;
  }

  color(name: string, theme = this.#active): Rgba {
    const value = this.token(name, theme);
    if (!Array.isArray(value)) throw new Error(`Theme token "${name}" is not a colour.`);
    return value as Rgba;
  }

  number(name: string, theme = this.#active): number {
    const value = this.token(name, theme);
    if (typeof value !== "number") throw new Error(`Theme token "${name}" is not a number.`);
    return value;
  }

  stats(): ThemeStats {
    return { themes: this.#themes.size, active: this.#active, tokens: Object.keys(this.resolve()).length };
  }
}
