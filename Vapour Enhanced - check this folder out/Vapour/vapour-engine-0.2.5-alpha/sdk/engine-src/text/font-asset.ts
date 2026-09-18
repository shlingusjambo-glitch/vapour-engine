/** Font assets: a serializable font, fallback chains, and text effects.
 *
 * `FontAtlas` is what layout consumes; a *font asset* is what a project ships
 * and an asset database stores. The difference is ownership of the texture:
 * an atlas references a material that already exists, while an asset carries
 * the atlas pixels (or a path to them) plus the SDF parameters that decide how
 * the material must be built. Keeping them apart means the runtime layout path
 * never touches image data, and an asset can be validated without a GPU.
 *
 * Outline and shadow are text *styles* rather than separate draw passes
 * because a signed-distance atlas renders both from the same glyph quad by
 * shifting thresholds — the geometry is identical, only the material
 * parameters differ. The expanded rich-text style carries them so a `[shadow]`
 * tag in dialogue costs nothing extra to lay out.
 */
import type { FontAtlas, FontGlyph } from "./text-2d.js";
import type { RichTextStyle, TextOutline, TextShadow } from "./rich-text.js";

/** Structured validation problem, matching the engine's other validators. */
export interface FontAssetIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export const FONT_ASSET_VERSION = 1;

/** Signed-distance-field rendering parameters baked with the atlas. */
export interface SdfParameters {
  /** Distance radius in atlas pixels the field was generated with. */
  readonly radius: number;
  /** Alpha value at the glyph edge, in `[0, 1]`. Usually 0.5. */
  readonly threshold: number;
}

export interface FontAssetSource {
  /** Where the atlas pixels come from. `inline` carries them in the asset. */
  readonly kind: "inline" | "path";
  readonly path?: string;
  /** RGBA8 pixels, row-major, top-left origin. Only when `kind` is `inline`. */
  readonly pixels?: Uint8Array;
}

/** A font as a project ships it. Everything except pixels is plain JSON. */
export interface FontAsset {
  readonly version: number;
  readonly id: string;
  readonly family: string;
  readonly style: "normal" | "bold" | "italic" | "bold-italic";
  readonly designSize: number;
  readonly lineHeight: number;
  /** Distance from the top of a line to the baseline, in design pixels. */
  readonly ascent: number;
  readonly textureSize: readonly [number, number];
  readonly glyphs: readonly FontGlyph[];
  readonly kerning?: Readonly<Record<string, number>>;
  readonly fallbackCharacter?: string;
  readonly sdf?: SdfParameters;
  readonly source: FontAssetSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Every problem with a font asset, so an import tool can list them at once. */
export function validateFontAsset(asset: unknown): readonly FontAssetIssue[] {
  const issues: FontAssetIssue[] = [];
  if (!isRecord(asset)) return [{ path: "", code: "not-an-object", message: "A font asset must be an object." }];
  if (asset["version"] !== FONT_ASSET_VERSION) {
    issues.push({ path: "version", code: "unsupported-version", message: `Font assets must declare version ${String(FONT_ASSET_VERSION)}.` });
  }
  for (const field of ["id", "family"] as const) {
    if (typeof asset[field] !== "string" || (asset[field] as string).trim() === "") {
      issues.push({ path: field, code: "missing-field", message: `A font asset needs a non-empty ${field}.` });
    }
  }
  if (!["normal", "bold", "italic", "bold-italic"].includes(asset["style"] as string)) {
    issues.push({ path: "style", code: "invalid-style", message: "Style must be normal, bold, italic, or bold-italic." });
  }
  for (const field of ["designSize", "lineHeight", "ascent"] as const) {
    if (!(typeof asset[field] === "number" && asset[field] > 0 && Number.isFinite(asset[field]))) {
      issues.push({ path: field, code: "not-positive", message: `${field} must be a positive number.` });
    }
  }
  const size = asset["textureSize"];
  if (!Array.isArray(size) || size.length !== 2 || !size.every((entry) => Number.isInteger(entry) && entry > 0)) {
    issues.push({ path: "textureSize", code: "invalid-size", message: "textureSize must be two positive whole numbers." });
  }
  const glyphs = asset["glyphs"];
  if (!Array.isArray(glyphs) || glyphs.length === 0) {
    issues.push({ path: "glyphs", code: "empty", message: "A font asset needs at least one glyph." });
  } else {
    const seen = new Set<string>();
    glyphs.forEach((glyph, index) => {
      const path = `glyphs[${String(index)}]`;
      if (!isRecord(glyph) || typeof glyph["character"] !== "string" || glyph["character"] === "") {
        issues.push({ path, code: "invalid-glyph", message: "Each glyph needs a character." });
        return;
      }
      if (seen.has(glyph["character"])) issues.push({ path: `${path}.character`, code: "duplicate", message: `Glyph ${JSON.stringify(glyph["character"])} is declared twice.` });
      seen.add(glyph["character"]);
      const rect = glyph["rect"];
      if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((entry) => Number.isFinite(entry) && entry >= 0)) {
        issues.push({ path: `${path}.rect`, code: "invalid-rect", message: "A glyph rect is [x, y, width, height] in atlas pixels." });
      } else if (Array.isArray(size) && size.length === 2 && (rect[0] + rect[2] > size[0] || rect[1] + rect[3] > size[1])) {
        issues.push({ path: `${path}.rect`, code: "outside-atlas", message: `Glyph ${JSON.stringify(glyph["character"])} lies outside the atlas.` });
      }
      if (!(typeof glyph["advance"] === "number" && Number.isFinite(glyph["advance"]))) {
        issues.push({ path: `${path}.advance`, code: "invalid-advance", message: "A glyph advance must be a finite number." });
      }
    });
    const fallback = asset["fallbackCharacter"];
    if (typeof fallback === "string" && !seen.has(fallback)) {
      issues.push({ path: "fallbackCharacter", code: "missing-glyph", message: `The fallback character ${JSON.stringify(fallback)} has no glyph.` });
    }
  }
  const sdf = asset["sdf"];
  if (sdf !== undefined) {
    if (!isRecord(sdf) || !(typeof sdf["radius"] === "number" && sdf["radius"] > 0) || !(typeof sdf["threshold"] === "number" && sdf["threshold"] > 0 && sdf["threshold"] < 1)) {
      issues.push({ path: "sdf", code: "invalid-sdf", message: "SDF parameters need a positive radius and a threshold in (0, 1)." });
    }
  }
  const source = asset["source"];
  if (!isRecord(source) || (source["kind"] !== "inline" && source["kind"] !== "path")) {
    issues.push({ path: "source", code: "invalid-source", message: "A font source is { kind: 'inline', pixels } or { kind: 'path', path }." });
  } else if (source["kind"] === "path" && (typeof source["path"] !== "string" || source["path"] === "")) {
    issues.push({ path: "source.path", code: "missing-field", message: "A path source needs a path." });
  } else if (source["kind"] === "inline") {
    const pixels = source["pixels"];
    const expected = Array.isArray(size) && size.length === 2 ? size[0] * size[1] * 4 : undefined;
    if (!(pixels instanceof Uint8Array)) {
      issues.push({ path: "source.pixels", code: "missing-field", message: "An inline source needs RGBA8 pixels." });
    } else if (expected !== undefined && pixels.length !== expected) {
      issues.push({ path: "source.pixels", code: "wrong-length", message: `Expected ${String(expected)} bytes of RGBA8 for the atlas size, got ${String(pixels.length)}.` });
    }
  }
  return issues;
}

/** The runtime atlas for an asset. `material` is the material the asset's atlas was uploaded as. */
export function fontAtlasFromAsset(asset: FontAsset, material: string): FontAtlas {
  const issues = validateFontAsset(asset);
  if (issues.length > 0) throw new Error(`Font asset ${JSON.stringify(asset.id)} is invalid: ${issues[0]!.path}: ${issues[0]!.message}`);
  return Object.freeze({
    id: asset.id,
    material,
    textureSize: asset.textureSize,
    designSize: asset.designSize,
    lineHeight: asset.lineHeight,
    glyphs: asset.glyphs,
    ...(asset.kerning === undefined ? {} : { kerning: asset.kerning }),
    ...(asset.fallbackCharacter === undefined ? {} : { fallbackCharacter: asset.fallbackCharacter }),
  });
}

export type { TextOutline, TextShadow };

/** JSON form of an asset: pixels are dropped and the source becomes a path. */
export function serializeFontAsset(asset: FontAsset, pixelPath?: string): string {
  const source: FontAssetSource = asset.source.kind === "inline"
    ? { kind: "path", path: pixelPath ?? `${asset.id}.rgba` }
    : asset.source;
  return JSON.stringify({ ...asset, source });
}

export function parseFontAsset(json: string, pixels?: Uint8Array): FontAsset {
  const parsed: unknown = JSON.parse(json);
  const withPixels = pixels === undefined || !isRecord(parsed) ? parsed : { ...parsed, source: { kind: "inline", pixels } };
  const issues = validateFontAsset(withPixels);
  if (issues.length > 0) throw new Error(`Font asset JSON is invalid: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  return withPixels as FontAsset;
}

/**
 * A fallback chain of atlases with an explicit name.
 *
 * The order is the policy: a project's primary font first, then a script
 * font per language it ships, then a symbol font, then an emoji font.
 */
export interface FontFallbackChain {
  readonly name: string;
  readonly fonts: readonly FontAtlas[];
}

export interface FallbackResolution {
  /** Which atlas in the chain draws each code point of `text`, `-1` if none. */
  readonly indices: readonly number[];
  /** Distinct characters no font in the chain could draw. */
  readonly missing: readonly string[];
  /** Per-font count of characters it was chosen for. */
  readonly usage: readonly number[];
}

/**
 * Resolves each character of `text` to the first atlas in the chain that has
 * it, and reports what nothing had — so a localization pass can see exactly
 * which glyphs a new language needs before a player does.
 */
export function resolveFallback(chain: FontFallbackChain, text: string): FallbackResolution {
  if (chain.fonts.length === 0) throw new Error(`Font chain ${JSON.stringify(chain.name)} has no fonts.`);
  const coverage = chain.fonts.map((font) => new Set(font.glyphs.map((glyph) => glyph.character)));
  const usage = chain.fonts.map(() => 0);
  const indices: number[] = [];
  const missing = new Set<string>();
  for (const character of text) {
    if (character === "\n") { indices.push(0); continue; }
    const index = coverage.findIndex((set) => set.has(character));
    indices.push(index);
    if (index < 0) missing.add(character);
    else usage[index] = usage[index]! + 1;
  }
  return { indices, missing: [...missing], usage };
}

/**
 * The SDF threshold shifts an outline and shadow need, in `[0, 1]` alpha.
 *
 * With a field of radius `r` pixels mapped onto alpha 0..1 around the edge at
 * `threshold`, growing the glyph by `w` pixels means lowering the threshold by
 * `w / (2r)`. That is the whole trick: the same quad, a different cut.
 */
export function sdfThresholds(sdf: SdfParameters, style: Pick<RichTextStyle, "outline" | "shadow">): { readonly fill: number; readonly outline: number | undefined; readonly shadow: number | undefined } {
  const perPixel = 1 / (2 * sdf.radius);
  const clamp = (value: number): number => Math.max(0.001, Math.min(0.999, value));
  return {
    fill: sdf.threshold,
    outline: style.outline === undefined ? undefined : clamp(sdf.threshold - style.outline.width * perPixel),
    shadow: style.shadow === undefined ? undefined : clamp(sdf.threshold - (style.shadow.softness ?? 0) * perPixel),
  };
}
