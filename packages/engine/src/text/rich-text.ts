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

const TAG = /\[(\/?)([a-z]+)(?:=([^\]]*))?\]/gi;

/**
 * Parses inline markup into styled runs.
 *
 * Supported: `[b]`, `[i]`, `[color=name]`, `[size=1.5]`, `[icon=name]`,
 * `[outline=name]`, `[shadow=name]`.
 * Everything else is left as literal text and reported, because a translator
 * who typos a tag should see their text, not lose it.
 */
export function parseRichText(source: string, options: RichTextParseOptions = {}): readonly RichTextRun[] {
  const palette = options.palette ?? {};
  const base = options.baseStyle ?? {};
  const stack: RichTextStyle[] = [base];
  const runs: RichTextRun[] = [];
  let index = 0;

  const current = (): RichTextStyle => stack[stack.length - 1]!;
  const push = (text: string): void => {
    if (text.length > 0) runs.push({ text, style: current() });
  };

  TAG.lastIndex = 0;
  for (let match = TAG.exec(source); match !== null; match = TAG.exec(source)) {
    const whole = match[0];
    const closing = match[1];
    const tag = (match[2] ?? "").toLowerCase();
    const value = match[3];
    const known = tag === "b" || tag === "i" || tag === "color" || tag === "size" || tag === "icon" || tag === "outline" || tag === "shadow";
    if (!known) {
      options.onUnknownTag?.(tag);
      continue;
    }
    push(source.slice(index, match.index));
    index = match.index + whole.length;

    if (closing) {
      // An unbalanced close is ignored rather than unwinding past the base
      // style, which would leave the rest of the string unstyled.
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (tag === "icon") {
      if (value) runs.push({ text: "", style: current(), icon: value });
      continue;
    }
    const next: Record<string, unknown> = { ...current() };
    if (tag === "b") next.bold = true;
    if (tag === "i") next.italic = true;
    if (tag === "color" && value) {
      const color = palette[value];
      // An unknown colour keeps the current one; content must not be able to
      // make text invisible against its background.
      if (color) next.color = color;
      else options.onUnknownTag?.("color=" + value);
    }
    if (tag === "size" && value) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed > 0) next.scale = (current().scale ?? 1) * parsed;
    }
    if (tag === "outline" && value) {
      const outline = options.outlines?.[value];
      if (outline) next.outline = outline;
      else options.onUnknownTag?.("outline=" + value);
    }
    if (tag === "shadow" && value) {
      const shadow = options.shadows?.[value];
      if (shadow) next.shadow = shadow;
      else options.onUnknownTag?.("shadow=" + value);
    }
    stack.push(next as RichTextStyle);
  }
  push(source.slice(index));
  return runs;
}

/** Strips markup, for measuring, searching, or reading aloud. */
export function stripRichText(source: string): string {
  return parseRichText(source).map((run) => run.text).join("");
}

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
export function resolveGlyphs(stack: FontStack, text: string): readonly ResolvedGlyphSource[] {
  if (stack.fonts.length === 0) throw new Error("A font stack needs at least one font.");
  const coverage = stack.fonts.map((font) => new Set(font.glyphs.map((glyph) => glyph.character)));
  const resolved: ResolvedGlyphSource[] = [];
  // Iterating the string yields code points, so a non-BMP character is one
  // entry rather than two broken halves.
  for (const character of text) {
    let chosen = -1;
    for (const [index, set] of coverage.entries()) {
      if (set.has(character)) {
        chosen = index;
        break;
      }
    }
    resolved.push(
      chosen >= 0
        ? { font: stack.fonts[chosen]!, character, missing: false }
        : { font: stack.fonts[0]!, character: stack.fonts[0]!.fallbackCharacter ?? "?", missing: true },
    );
  }
  return resolved;
}

/** Characters no font in the stack can draw, for reporting a coverage gap. */
export function missingCharacters(stack: FontStack, text: string): readonly string[] {
  const missing = new Set<string>();
  const characters = [...text];
  for (const [index, entry] of resolveGlyphs(stack, text).entries()) {
    if (entry.missing) missing.add(characters[index] ?? entry.character);
  }
  return [...missing];
}

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
export function measureText(font: FontAtlas, text: string, options: MeasureOptions): TextMetrics {
  if (!(options.fontSize > 0)) throw new Error("A font size must be positive.");
  if (!(font.designSize > 0)) throw new Error("Font " + font.id + " has a non-positive design size.");
  const scale = options.fontSize / font.designSize;
  const lineHeight = font.lineHeight * scale * (options.lineSpacing ?? 1);
  const advances = new Map(font.glyphs.map((glyph) => [glyph.character, glyph.advance]));
  const advanceOf = (character: string): number =>
    (advances.get(character) ?? advances.get(font.fallbackCharacter ?? "?") ?? 0) * scale;

  const lines = wrapText(text, options.maxWidth, advanceOf, options.breakAnywhere ?? false);
  let widest = 0;
  for (const line of lines) {
    let width = 0;
    for (const character of line) width += advanceOf(character);
    widest = Math.max(widest, width);
  }
  return {
    width: widest,
    height: lines.length * lineHeight,
    lineCount: lines.length,
    ascent: font.lineHeight * scale * 0.8,
  };
}

/**
 * Breaks text into lines.
 *
 * Explicit newlines always break. Words break at spaces by default; a word
 * longer than the whole line is split rather than overflowing, because a URL or
 * a long compound word should not push a dialogue box off screen.
 */
export function wrapText(
  text: string,
  maxWidth: number | undefined,
  advanceOf: (character: string) => number,
  breakAnywhere = false,
): readonly string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (maxWidth === undefined || !(maxWidth > 0)) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    let width = 0;
    const units = breakAnywhere ? [...paragraph] : splitWords(paragraph);
    for (const unit of units) {
      let unitWidth = 0;
      for (const character of unit) unitWidth += advanceOf(character);
      if (width > 0 && width + unitWidth > maxWidth) {
        lines.push(line);
        line = unit.trimStart();
        width = 0;
        for (const character of line) width += advanceOf(character);
        continue;
      }
      // A single unit wider than the line: split it rather than overflowing.
      if (width === 0 && unitWidth > maxWidth && [...unit].length > 1) {
        let chunk = "";
        let chunkWidth = 0;
        for (const character of unit) {
          const characterWidth = advanceOf(character);
          if (chunkWidth + characterWidth > maxWidth && chunk.length > 0) {
            lines.push(chunk);
            chunk = "";
            chunkWidth = 0;
          }
          chunk += character;
          chunkWidth += characterWidth;
        }
        // A trailing space left over from the split must not start the next
        // line, or a wrapped paragraph gets a whitespace-only line.
        line = chunk.trimStart();
        width = 0;
        for (const character of line) width += advanceOf(character);
        continue;
      }
      line += unit;
      width += unitWidth;
    }
    lines.push(line);
  }
  return lines;
}

/** Splits into words, keeping each word's trailing space with it. */
function splitWords(paragraph: string): string[] {
  const words: string[] = [];
  let current = "";
  for (const character of paragraph) {
    current += character;
    if (character === " ") {
      words.push(current);
      current = "";
    }
  }
  if (current.length > 0) words.push(current);
  return words;
}

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
export class TextLayoutCache<T> {
  readonly #entries = new Map<string, TextCacheEntry<T>>();
  readonly #order: string[] = [];
  readonly #maxEntries: number;
  #hits = 0;
  #misses = 0;

  constructor(maxEntries = 256) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("A text cache needs room for at least one entry.");
    this.#maxEntries = maxEntries;
  }

  static key(text: string, options: Readonly<Record<string, unknown>>): string {
    // Sorted so two option objects with the same values collide correctly.
    const parts = Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => name + "=" + JSON.stringify(value));
    return text + "|" + parts.join("|");
  }

  get(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) {
      this.#misses += 1;
      return undefined;
    }
    this.#hits += 1;
    // Least-recently-used: a HUD's stable strings stay, one-off text does not.
    const position = this.#order.indexOf(key);
    if (position >= 0) this.#order.splice(position, 1);
    this.#order.push(key);
    return entry.value;
  }

  set(key: string, value: T, bytes = 0): void {
    const existing = this.#order.indexOf(key);
    if (existing >= 0) this.#order.splice(existing, 1);
    this.#entries.set(key, { value, bytes });
    this.#order.push(key);
    while (this.#order.length > this.#maxEntries) {
      const evicted = this.#order.shift();
      if (evicted !== undefined) this.#entries.delete(evicted);
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#order.length = 0;
  }

  stats(): { readonly entries: number; readonly hits: number; readonly misses: number; readonly bytes: number } {
    let bytes = 0;
    for (const entry of this.#entries.values()) bytes += entry.bytes;
    return { entries: this.#entries.size, hits: this.#hits, misses: this.#misses, bytes };
  }
}
