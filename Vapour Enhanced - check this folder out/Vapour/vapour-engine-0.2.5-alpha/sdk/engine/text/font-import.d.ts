import type { MaterialUpload, TextureUpload } from "../render/host/index.js";
import type { FontAtlas } from "./text-2d.js";
export interface FontImportOptions {
    readonly id: string;
    readonly material: string;
    readonly family: string;
    readonly characters: string;
    readonly designSize?: number;
    readonly weight?: string | number;
    readonly style?: "normal" | "italic";
    readonly atlasWidth?: number;
    readonly padding?: number;
    /** Generates signed-distance alpha with this pixel radius. Zero keeps normal alpha. */
    readonly sdfRadius?: number;
    readonly fallbackCharacter?: string;
}
export interface ImportedFontAtlas {
    readonly font: FontAtlas;
    readonly textureId: string;
    readonly texture: TextureUpload;
    readonly material: MaterialUpload;
}
/** Rasterizes a browser font into an engine atlas. This is an import step, not
 * per-frame rendering: upload the returned texture/material once and serialize
 * the font metrics as an asset. */
export declare function importBrowserFont(options: FontImportOptions): Promise<ImportedFontAtlas>;
/** Converts RGBA coverage to a single-channel signed-distance field stored in
 * alpha. Intended for import workers/editor builds, never the frame loop. */
export declare function generateSignedDistanceAlpha(width: number, height: number, source: ArrayLike<number>, radius: number): Uint8Array;
//# sourceMappingURL=font-import.d.ts.map