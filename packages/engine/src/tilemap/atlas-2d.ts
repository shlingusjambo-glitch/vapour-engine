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
export class SpriteAtlas {
  readonly #regions = new Map<string, SpriteAsset>();

  constructor(input: AtlasInput) {
    if (!input.regions.length)
      throw new Error("An atlas needs at least one region.");
    for (const region of input.regions) {
      if (!region.name.trim())
        throw new Error("An atlas region requires a non-empty name.");
      if (this.#regions.has(region.name))
        throw new Error(`Duplicate atlas region name "${region.name}".`);
      const [, , w, h] = region.rect;
      if (!(w > 0) || !(h > 0))
        throw new Error(`Atlas region "${region.name}" needs a positive rect.`);
      this.#regions.set(region.name, {
        id: region.name,
        material: input.material,
        textureSize: input.textureSize,
        rect: region.rect,
        ...(input.pixelsPerUnit === undefined ? {} : { pixelsPerUnit: input.pixelsPerUnit }),
        ...(region.pivot === undefined ? {} : { pivot: region.pivot }),
        ...(region.border === undefined ? {} : { border: region.border }),
      });
    }
  }

  /** The sprite for a named region, or `undefined` if the atlas has none by
   * that name. */
  region(name: string): SpriteAsset | undefined {
    return this.#regions.get(name);
  }

  get names(): readonly string[] {
    return [...this.#regions.keys()];
  }
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
export function packGridAtlas(input: GridAtlasInput): SpriteAtlas {
  const [cellW, cellH] = input.cellSize;
  const regions: AtlasRegionInput[] = [];
  for (let row = 0; row < input.rows; row += 1) {
    for (let column = 0; column < input.columns; column += 1) {
      const index = row * input.columns + column;
      regions.push({
        name: input.names?.[index] ?? `cell_${index}`,
        rect: [column * cellW, row * cellH, cellW, cellH],
        ...(input.pivot === undefined ? {} : { pivot: input.pivot }),
        ...(input.border === undefined ? {} : { border: input.border }),
      });
    }
  }
  return new SpriteAtlas({
    material: input.material,
    textureSize: input.textureSize,
    ...(input.pixelsPerUnit === undefined ? {} : { pixelsPerUnit: input.pixelsPerUnit }),
    regions,
  });
}
