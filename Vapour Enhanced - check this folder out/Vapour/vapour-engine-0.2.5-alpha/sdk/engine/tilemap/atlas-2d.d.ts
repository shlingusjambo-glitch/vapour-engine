/** Sprite atlas packing input -> named-region lookup.
 *
 * `sprite-2d.ts` already consumes exactly this shape per sprite — a pixel
 * `rect`, a normalized `pivot`, and nine-slice `border` — it just has no
 * concept of a *sheet* of them addressed by name. This fills that one gap
 * without touching `sprite-2d.ts` (read-only from here): a `SpriteAtlas` is
 * a `Map<string, SpriteAsset>` with validation, plus a packer for the
 * common case of a regular grid sheet (a walk cycle, a tileset image).
 */
import type { SpriteAsset } from "../render/sprite-2d.js";
/** One named region of an atlas, before it is resolved to a full
 * `SpriteAsset` (which also needs the sheet's material and texture size). */
export interface AtlasRegionInput {
    readonly name: string;
    readonly rect: readonly [number, number, number, number];
    readonly pivot?: readonly [number, number];
    readonly border?: readonly [number, number, number, number];
}
export interface AtlasInput {
    readonly material: string;
    readonly textureSize: readonly [number, number];
    readonly pixelsPerUnit?: number;
    readonly regions: readonly AtlasRegionInput[];
}
/** A packed atlas: named regions resolved to ready-to-draw `SpriteAsset`s. */
export declare class SpriteAtlas {
    #private;
    constructor(input: AtlasInput);
    /** The sprite for a named region, or `undefined` if the atlas has none by
     * that name. */
    region(name: string): SpriteAsset | undefined;
    get names(): readonly string[];
}
export interface GridAtlasInput {
    readonly material: string;
    readonly textureSize: readonly [number, number];
    readonly cellSize: readonly [number, number];
    readonly columns: number;
    readonly rows: number;
    readonly pixelsPerUnit?: number;
    readonly pivot?: readonly [number, number];
    readonly border?: readonly [number, number, number, number];
    /** Names cells left to right, top to bottom. Defaults to `"cell_<index>"`. */
    readonly names?: readonly string[];
}
/** Packs a regular grid sheet — the common case for a walk cycle or a
 * tileset image — into a {@link SpriteAtlas}. */
export declare function packGridAtlas(input: GridAtlasInput): SpriteAtlas;
//# sourceMappingURL=atlas-2d.d.ts.map