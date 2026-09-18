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
export declare const STANDARD_TOKENS: {
    readonly background: "color.background";
    readonly surface: "color.surface";
    readonly text: "color.text";
    readonly textMuted: "color.textMuted";
    readonly accent: "color.accent";
    readonly danger: "color.danger";
    readonly border: "color.border";
    readonly focusRing: "color.focusRing";
    readonly spacingSmall: "space.small";
    readonly spacing: "space.medium";
    readonly spacingLarge: "space.large";
    readonly radius: "shape.radius";
    readonly fontSize: "text.size";
    readonly fontSizeSmall: "text.sizeSmall";
    readonly fontSizeLarge: "text.sizeLarge";
};
/** A readable default, and the base every other theme should extend. */
export declare function defaultTheme(): ThemeDefinition;
/**
 * A high-contrast variant.
 *
 * Provided rather than left to each game because "we will add accessibility
 * later" reliably means never, and because getting it right is a dozen tokens
 * when the theme system exists and a rewrite when it does not.
 */
export declare function highContrastTheme(): ThemeDefinition;
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
export declare class ThemeRegistry {
    #private;
    constructor(themes?: readonly ThemeDefinition[]);
    register(theme: ThemeDefinition): void;
    get names(): readonly string[];
    get active(): string;
    setActive(name: string): void;
    /** Every token of a theme, with inherited values merged in. */
    resolve(name?: string): ThemeTokens;
    /**
     * One token from the active theme.
     *
     * A missing token throws rather than returning a default, because a widget
     * silently rendering with the wrong colour is far harder to notice than a
     * failure at startup.
     */
    token(name: string, theme?: string): string | number | Rgba;
    color(name: string, theme?: string): Rgba;
    number(name: string, theme?: string): number;
    stats(): ThemeStats;
}
//# sourceMappingURL=theme.d.ts.map