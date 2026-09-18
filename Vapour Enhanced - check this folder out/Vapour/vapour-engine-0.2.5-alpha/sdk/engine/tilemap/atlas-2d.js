/** A packed atlas: named regions resolved to ready-to-draw `SpriteAsset`s. */
export class SpriteAtlas {
    #regions = new Map();
    constructor(input) {
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
    region(name) {
        return this.#regions.get(name);
    }
    get names() {
        return [...this.#regions.keys()];
    }
}
/** Packs a regular grid sheet — the common case for a walk cycle or a
 * tileset image — into a {@link SpriteAtlas}. */
export function packGridAtlas(input) {
    const [cellW, cellH] = input.cellSize;
    const regions = [];
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
//# sourceMappingURL=atlas-2d.js.map