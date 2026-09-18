/** Rich text: inline markup, font fallback, and measurement.
 *
 * Plain glyph layout covers a HUD label. Anything a player reads at length —
 * dialogue, item descriptions, quest logs, tutorials — needs colour, emphasis,
 * and inline icons, and needs them *inside* a wrapped paragraph rather than as
 * separately positioned labels.
 *
 * The markup is deliberately a tiny closed set. A general HTML-like parser in a
 * game is a liability: it invites content the text renderer cannot actually
 * draw, and it makes localized strings — which translators edit by hand — easy
 * to break in ways that only appear in one language.
 */
import type { FontAtlas } from "./text-2d.js";
/** An outline an SDF material renders around the fill from the same quad. */
export interface TextOutline {
    /** Width in design pixels. */
    readonly width: number;
    readonly color: readonly [number, number, number, number];
}
/** A drop shadow: the same glyph, offset and optionally softened. */
export interface TextShadow {
    /** Offset in design pixels, +X right and +Y down. */
    readonly offset: readonly [number, number];
    readonly color: readonly [number, number, number, number];
    /** Extra blur radius in design pixels. */
    readonly softness?: number;
}
export interface RichTextStyle {
    readonly color?: readonly [number, number, number, number];
    readonly bold?: boolean;
    readonly italic?: boolean;
    /** Multiplies the base font size. */
    readonly scale?: number;
    readonly outline?: TextOutline;
    readonly shadow?: TextShadow;
}
export interface RichTextRun {
    readonly text: string;
    readonly style: RichTextStyle;
    /** An inline sprite, drawn in place of `text` when present. */
    readonly icon?: string;
}
export interface RichTextParseOptions {
    /** Colours markup may name, so content cannot invent arbitrary values. */
    readonly palette?: Readonly<Record<string, readonly [number, number, number, number]>>;
    readonly baseStyle?: RichTextStyle;
    /** Named outlines `[outline=name]` may apply, for the same reason as `palette`. */
    readonly outlines?: Readonly<Record<string, TextOutline>>;
    /** Named shadows `[shadow=name]` may apply. */
    readonly shadows?: Readonly<Record<string, TextShadow>>;
    /** Report unknown tags rather than silently dropping them. */
    readonly onUnknownTag?: (tag: string) => void;
}
/**
 * Parses inline markup into styled runs.
 *
 * Supported: `[b]`, `[i]`, `[color=name]`, `[size=1.5]`, `[icon=name]`,
 * `[outline=name]`, `[shadow=name]`.
 * Everything else is left as literal text and reported, because a translator
 * who typos a tag should see their text, not lose it.
 */
export declare function parseRichText(source: string, options?: RichTextParseOptions): readonly RichTextRun[];
/** Strips markup, for measuring, searching, or reading aloud. */
export declare function stripRichText(source: string): string;
export interface FontStack {
    /** Fonts tried in order for each character. */
    readonly fonts: readonly FontAtlas[];
}
export interface ResolvedGlyphSource {
    readonly font: FontAtlas;
    readonly character: string;
    /** True when no font in the stack had the character. */
    readonly missing: boolean;
}
/**
 * Chooses which font draws each character.
 *
 * Fallback is not optional for any game shipping outside one language: a Latin
 * font has no CJK glyphs, and a UI rendering those as blank boxes is broken for
 * a large fraction of players. Resolving per character rather than per string is
 * what lets a mixed sentence work.
 */
export declare function resolveGlyphs(stack: FontStack, text: string): readonly ResolvedGlyphSource[];
/** Characters no font in the stack can draw, for reporting a coverage gap. */
export declare function missingCharacters(stack: FontStack, text: string): readonly string[];
export interface TextMetrics {
    readonly width: number;
    readonly height: number;
    readonly lineCount: number;
    /** Distance from the top of the first line to its baseline. */
    readonly ascent: number;
}
export interface MeasureOptions {
    readonly fontSize: number;
    readonly maxWidth?: number;
    readonly lineSpacing?: number;
    /** Break lines at any character rather than at word boundaries. */
    readonly breakAnywhere?: boolean;
}
/**
 * Measures text without building a mesh.
 *
 * Layout needs a label's size before it can place it, and building glyph
 * geometry just to throw it away is the kind of waste that shows up as a
 * stutter when a dialogue box opens.
 */
export declare function measureText(font: FontAtlas, text: string, options: MeasureOptions): TextMetrics;
/**
 * Breaks text into lines.
 *
 * Explicit newlines always break. Words break at spaces by default; a word
 * longer than the whole line is split rather than overflowing, because a URL or
 * a long compound word should not push a dialogue box off screen.
 */
export declare function wrapText(text: string, maxWidth: number | undefined, advanceOf: (character: string) => number, breakAnywhere?: boolean): readonly string[];
export interface TextCacheEntry<T> {
    readonly value: T;
    readonly bytes: number;
}
/**
 * Caches laid-out text by its content and options.
 *
 * A HUD relaying identical text every frame is the common case, and rebuilding
 * a glyph mesh for an unchanged string is pure waste. Keyed on everything that
 * affects the result, so a changed colour or width produces a new entry rather
 * than a stale one.
 */
export declare class TextLayoutCache<T> {
    #private;
    constructor(maxEntries?: number);
    static key(text: string, options: Readonly<Record<string, unknown>>): string;
    get(key: string): T | undefined;
    set(key: string, value: T, bytes?: number): void;
    clear(): void;
    stats(): {
        readonly entries: number;
        readonly hits: number;
        readonly misses: number;
        readonly bytes: number;
    };
}
//# sourceMappingURL=rich-text.d.ts.map