/** Tilemaps: storage, collision, and rendering data.
 *
 * A tilemap is a grid of small integers, and almost every design decision
 * follows from taking that literally. Storing tiles as objects, or as a
 * two-dimensional array of arrays, costs an order of magnitude more memory and
 * turns every lookup into two pointer chases — on a map large enough to be
 * interesting, that is the difference between instant and noticeable.
 *
 * So layers are flat `Uint32Array`s, and everything else is built on indexing
 * arithmetic. The parts that actually need care are the ones games get wrong:
 * collision that matches what the player sees, and a renderer feed that does
 * not rebuild the world every frame.
 */
/** Tile id 0 is always empty, so a zeroed buffer is an empty map. */
export const EMPTY_TILE = 0;
/** One grid of tiles. */
export class TilemapLayer {
    name;
    width;
    height;
    order;
    parallax;
    collides;
    visible;
    #tiles;
    #revision = 0;
    constructor(options) {
        if (!options.name.trim())
            throw new Error("A tilemap layer requires a non-empty name.");
        if (!Number.isInteger(options.width) || options.width < 1)
            throw new Error(`Layer "${options.name}" needs a width of at least 1.`);
        if (!Number.isInteger(options.height) || options.height < 1)
            throw new Error(`Layer "${options.name}" needs a height of at least 1.`);
        this.name = options.name;
        this.width = options.width;
        this.height = options.height;
        this.order = options.order ?? 0;
        this.parallax = options.parallax ?? [1, 1];
        this.visible = options.visible ?? true;
        this.collides = options.collides ?? true;
        this.#tiles = new Uint32Array(options.width * options.height);
    }
    /** Increments on every mutation, so a renderer can skip unchanged layers. */
    get revision() {
        return this.#revision;
    }
    get tiles() {
        return this.#tiles;
    }
    inBounds(x, y) {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }
    /**
     * The tile at a coordinate.
     *
     * Out of bounds reads as empty rather than throwing: collision and rendering
     * both sample beyond the edges constantly, and making that an error would
     * mean a bounds check at every call site.
     */
    get(x, y) {
        if (!this.inBounds(x, y))
            return EMPTY_TILE;
        return this.#tiles[y * this.width + x];
    }
    set(x, y, tile) {
        if (!this.inBounds(x, y))
            throw new Error(`Tile (${x}, ${y}) is outside layer "${this.name}" (${this.width}x${this.height}).`);
        if (!Number.isInteger(tile) || tile < 0)
            throw new Error(`A tile id must be a non-negative whole number (got ${tile}).`);
        const index = y * this.width + x;
        if (this.#tiles[index] === tile)
            return;
        this.#tiles[index] = tile;
        this.#revision += 1;
    }
    fill(tile, region) {
        if (!Number.isInteger(tile) || tile < 0)
            throw new Error(`A tile id must be a non-negative whole number (got ${tile}).`);
        if (!region) {
            this.#tiles.fill(tile);
            this.#revision += 1;
            return;
        }
        for (let y = region.y; y < region.y + region.height; y += 1) {
            for (let x = region.x; x < region.x + region.width; x += 1) {
                if (this.inBounds(x, y))
                    this.#tiles[y * this.width + x] = tile;
            }
        }
        this.#revision += 1;
    }
    /** Replaces the whole grid, for loading a saved or generated map. */
    load(tiles) {
        if (tiles.length !== this.#tiles.length) {
            throw new Error(`Layer "${this.name}" holds ${this.#tiles.length} tiles but was given ${tiles.length}.`);
        }
        this.#tiles.set(tiles);
        this.#revision += 1;
    }
    /** Serializable copy of the grid. */
    snapshot() {
        return [...this.#tiles];
    }
}
/**
 * A stack of layers plus the tile definitions they refer to.
 *
 * Definitions are held once for the whole map rather than per tile, because a
 * map with a hundred thousand tiles has perhaps fifty distinct kinds.
 */
export class Tilemap {
    tileSize;
    #layers = [];
    #definitions = new Map();
    constructor(options = {}) {
        this.tileSize = options.tileSize ?? 1;
        if (!(this.tileSize > 0))
            throw new Error("A tile size must be positive.");
        for (const definition of options.tiles ?? [])
            this.define(definition);
    }
    define(definition) {
        if (definition.id === EMPTY_TILE)
            throw new Error("Tile id 0 is reserved for empty space.");
        if (!Number.isInteger(definition.id) || definition.id < 0)
            throw new Error("A tile id must be a non-negative whole number.");
        if (definition.collision?.kind === "slope") {
            for (const value of [definition.collision.left, definition.collision.right]) {
                if (!(value >= 0 && value <= 1))
                    throw new Error(`Slope tile ${definition.id} needs heights in [0, 1].`);
            }
        }
        this.#definitions.set(definition.id, definition);
    }
    definition(tile) {
        return this.#definitions.get(tile);
    }
    get definitions() {
        return [...this.#definitions.values()].sort((a, b) => a.id - b.id);
    }
    addLayer(options) {
        if (this.#layers.some((layer) => layer.name === options.name)) {
            throw new Error(`A tilemap layer named "${options.name}" already exists.`);
        }
        const layer = new TilemapLayer(options);
        this.#layers.push(layer);
        this.#layers.sort((a, b) => a.order - b.order);
        return layer;
    }
    layer(name) {
        const found = this.#layers.find((entry) => entry.name === name);
        if (!found)
            throw new Error(`No tilemap layer named "${name}". Layers: ${this.#layers.map((entry) => entry.name).join(", ")}.`);
        return found;
    }
    /** Layers in draw order, back to front. */
    get layers() {
        return this.#layers;
    }
    removeLayer(name) {
        const index = this.#layers.findIndex((layer) => layer.name === name);
        if (index < 0)
            return false;
        this.#layers.splice(index, 1);
        return true;
    }
    /** World position to tile coordinate. */
    worldToTile(x, y) {
        return { x: Math.floor(x / this.tileSize), y: Math.floor(y / this.tileSize) };
    }
    /** Bottom-left corner of a tile, in world units. */
    tileToWorld(x, y) {
        return [x * this.tileSize, y * this.tileSize];
    }
    /** The topmost colliding tile at a coordinate, or `undefined`. */
    tileAt(x, y) {
        // Front to back: the topmost layer wins, matching what the player sees.
        for (let index = this.#layers.length - 1; index >= 0; index -= 1) {
            const layer = this.#layers[index];
            if (!layer.collides)
                continue;
            const tile = layer.get(x, y);
            if (tile === EMPTY_TILE)
                continue;
            const definition = this.#definitions.get(tile);
            if (!definition?.collision)
                continue;
            return { x, y, tile, definition, layer: layer.name };
        }
        return undefined;
    }
    stats() {
        let tiles = 0;
        let nonEmpty = 0;
        for (const layer of this.#layers) {
            tiles += layer.width * layer.height;
            for (const tile of layer.tiles) {
                if (tile !== EMPTY_TILE)
                    nonEmpty += 1;
            }
        }
        return { layers: this.#layers.length, tiles, nonEmpty, definitions: this.#definitions.size };
    }
}
/**
 * Moves an axis-aligned box through a tilemap, resolving collisions.
 *
 * Axes are resolved **separately, horizontal first**. Resolving both at once
 * from a single overlap is the classic source of a character catching on the
 * seams between floor tiles: the solver cannot tell whether to push out
 * sideways or upward and picks wrong on alternate frames.
 *
 * One-way platforms are only solid when the mover is descending and started
 * above them, which is what lets a player jump up through a platform and land
 * on it.
 */
export function moveInTilemap(map, box, motion, options = {}) {
    if (!(box.width > 0) || !(box.height > 0))
        throw new Error("A colliding box needs a positive size.");
    if (!Number.isFinite(motion[0]) || !Number.isFinite(motion[1]))
        throw new Error("Tilemap motion must be finite.");
    const hits = [];
    let [x, y] = [box.x, box.y];
    let blockedX = false;
    let blockedY = false;
    // Both axes sweep the tile columns or rows between the start and the
    // destination rather than testing only where the mover would end up. Testing
    // the destination alone lets a fast body tunnel straight through thin
    // geometry — a falling character passing through the floor is the canonical
    // symptom, and it only appears at high speed or low frame rate.
    // Horizontal first.
    if (motion[0] !== 0) {
        const target = x + motion[0];
        const forward = motion[0] > 0;
        const fromEdge = forward ? x + box.width : x;
        const toEdge = forward ? target + box.width : target;
        const firstColumn = map.worldToTile(fromEdge + (forward ? -1e-6 : 1e-6), 0).x;
        const lastColumn = map.worldToTile(toEdge + (forward ? -1e-6 : 1e-6), 0).x;
        const step = forward ? 1 : -1;
        for (let column = firstColumn; forward ? column <= lastColumn : column >= lastColumn; column += step) {
            let blocking;
            for (const tileY of tileRange(map, y, box.height)) {
                const hit = map.tileAt(column, tileY);
                if (hit?.definition.collision?.kind !== "solid")
                    continue;
                blocking = hit;
                break;
            }
            if (!blocking)
                continue;
            const [tileWorldX] = map.tileToWorld(column, 0);
            x = forward ? tileWorldX - box.width : tileWorldX + map.tileSize;
            blockedX = true;
            hits.push(blocking);
            break;
        }
        if (!blockedX)
            x = target;
    }
    // Then vertical, from the corrected horizontal position.
    let grounded = false;
    if (motion[1] !== 0) {
        const target = y + motion[1];
        const upward = motion[1] > 0;
        const fromEdge = upward ? y + box.height : y;
        const toEdge = upward ? target + box.height : target;
        const firstRow = map.worldToTile(0, fromEdge + (upward ? -1e-6 : 1e-6)).y;
        const lastRow = map.worldToTile(0, toEdge + (upward ? -1e-6 : 1e-6)).y;
        const step = upward ? 1 : -1;
        for (let row = firstRow; upward ? row <= lastRow : row >= lastRow; row += step) {
            let blocking;
            for (const tileX of tileRange(map, x, box.width)) {
                const hit = map.tileAt(tileX, row);
                if (!hit)
                    continue;
                const collision = hit.definition.collision;
                if (collision.kind === "platform") {
                    // Solid only from above, and only if the mover started clear of it.
                    if (upward)
                        continue;
                    const [, tileTop] = map.tileToWorld(tileX, row);
                    if (box.y < tileTop + map.tileSize - 1e-6)
                        continue;
                }
                else if (collision.kind === "slope") {
                    continue;
                }
                blocking = hit;
                break;
            }
            if (!blocking)
                continue;
            const [, tileWorldY] = map.tileToWorld(0, row);
            y = upward ? tileWorldY - box.height : tileWorldY + map.tileSize;
            blockedY = true;
            grounded = !upward;
            hits.push(blocking);
            break;
        }
        if (!blockedY)
            y = target;
    }
    // Slopes are resolved by sampling the surface height under the mover, which
    // keeps a character walking smoothly up a ramp instead of stepping.
    const slopeY = slopeHeightAt(map, x + box.width / 2, y);
    if (slopeY !== undefined && y < slopeY) {
        y = slopeY;
        grounded = true;
        blockedY = true;
    }
    return {
        position: [x, y],
        grounded: grounded || (options.wasGrounded === true && motion[1] === 0 && isOnGround(map, x, y, box.width)),
        blockedX,
        blockedY,
        hits,
    };
}
/** Tile indices a span covers on one axis. */
function tileRange(map, start, size) {
    const first = Math.floor(start / map.tileSize);
    const last = Math.floor((start + size - 1e-6) / map.tileSize);
    const range = [];
    for (let index = first; index <= last; index += 1)
        range.push(index);
    return range;
}
/** Surface height of a slope beneath a point, if any. */
function slopeHeightAt(map, worldX, worldY) {
    const tile = map.worldToTile(worldX, worldY);
    for (const candidateY of [tile.y, tile.y - 1]) {
        const hit = map.tileAt(tile.x, candidateY);
        if (hit?.definition.collision?.kind !== "slope")
            continue;
        const [tileX, tileYWorld] = map.tileToWorld(tile.x, candidateY);
        const t = Math.min(1, Math.max(0, (worldX - tileX) / map.tileSize));
        const collision = hit.definition.collision;
        const height = collision.left + (collision.right - collision.left) * t;
        return tileYWorld + height * map.tileSize;
    }
    return undefined;
}
function isOnGround(map, x, y, width) {
    const probeY = map.worldToTile(0, y - 1e-4).y;
    for (const tileX of tileRange(map, x, width)) {
        const hit = map.tileAt(tileX, probeY);
        if (hit && hit.definition.collision?.kind !== "slope")
            return true;
    }
    return false;
}
/**
 * The visible tiles of a layer within a camera's view.
 *
 * Culling to the view is not an optimization here but a requirement: a
 * thousand-by-thousand map is a million tiles, and submitting all of them per
 * frame is not survivable at any tile size.
 */
export function visibleTiles(map, layer, view, options = {}) {
    if (!layer.visible)
        return [];
    const margin = options.margin ?? 1;
    // Parallax shifts which part of the layer the camera sees.
    const originX = view.x * layer.parallax[0];
    const originY = view.y * layer.parallax[1];
    const first = map.worldToTile(originX, originY);
    const last = map.worldToTile(originX + view.width, originY + view.height);
    const instances = [];
    for (let y = first.y - margin; y <= last.y + margin; y += 1) {
        for (let x = first.x - margin; x <= last.x + margin; x += 1) {
            const tile = layer.get(x, y);
            if (tile === EMPTY_TILE)
                continue;
            instances.push({ x, y, atlasIndex: map.definition(tile)?.atlasIndex ?? tile - 1 });
        }
    }
    return instances;
}
//# sourceMappingURL=tilemap.js.map