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
export declare const FONT_ASSET_VERSION = 1;
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
/** Every problem with a font asset, so an import tool can list them at once. */
export declare function validateFontAsset(asset: unknown): readonly FontAssetIssue[];
/** The runtime atlas for an asset. `material` is the material the asset's atlas was uploaded as. */
export declare function fontAtlasFromAsset(asset: FontAsset, material: string): FontAtlas;
export type { TextOutline, TextShadow };
/** JSON form of an asset: pixels are dropped and the source becomes a path. */
export declare function serializeFontAsset(asset: FontAsset, pixelPath?: string): string;
export declare function parseFontAsset(json: string, pixels?: Uint8Array): FontAsset;
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
export declare function resolveFallback(chain: FontFallbackChain, text: string): FallbackResolution;
/**
 * The SDF threshold shifts an outline and shadow need, in `[0, 1]` alpha.
 *
 * With a field of radius `r` pixels mapped onto alpha 0..1 around the edge at
 * `threshold`, growing the glyph by `w` pixels means lowering the threshold by
 * `w / (2r)`. That is the whole trick: the same quad, a different cut.
 */
export declare function sdfThresholds(sdf: SdfParameters, style: Pick<RichTextStyle, "outline" | "shadow">): {
    readonly fill: number;
    readonly outline: number | undefined;
    readonly shadow: number | undefined;
};
//# sourceMappingURL=font-asset.d.ts.map