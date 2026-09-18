import type { MeshUpload } from "../render/host/index.js";
export interface FontGlyph {
    /** Unicode grapheme represented by this glyph. */
    readonly character: string;
    /** Atlas rectangle in pixels, with a top-left origin. */
    readonly rect: readonly [number, number, number, number];
    /** Pen advance in font-design pixels. */
    readonly advance: number;
    /** Offset from the pen to the glyph's top-left corner. */
    readonly bearing: readonly [number, number];
}
export interface FontAtlas {
    readonly id: string;
    readonly material: string;
    readonly textureSize: readonly [number, number];
    readonly designSize: number;
    readonly lineHeight: number;
    readonly glyphs: readonly FontGlyph[];
    /** Optional pair adjustments keyed as `left\0right`, in design pixels. */
    readonly kerning?: Readonly<Record<string, number>>;
    readonly fallbackCharacter?: string;
}
export type TextAlignment = "left" | "center" | "right";
export interface TextLayoutOptions {
    readonly fontSize: number;
    readonly maxWidth?: number;
    readonly lineSpacing?: number;
    readonly alignment?: TextAlignment;
    readonly color?: readonly [number, number, number, number];
}
export interface TextLayoutResult {
    readonly mesh: MeshUpload;
    readonly material: string;
    readonly width: number;
    readonly height: number;
    readonly lineCount: number;
    readonly glyphCount: number;
}
/** Unicode-aware, renderer-independent atlas text layout. The result is an XY
 * mesh accepted by the same upload path as sprites and procedural geometry. */
export declare function layoutText2D(font: FontAtlas, text: string, options: TextLayoutOptions): TextLayoutResult;
//# sourceMappingURL=text-2d.d.ts.map