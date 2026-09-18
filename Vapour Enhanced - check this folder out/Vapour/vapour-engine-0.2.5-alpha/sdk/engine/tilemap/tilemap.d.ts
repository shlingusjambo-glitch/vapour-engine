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
export declare const EMPTY_TILE = 0;
export type TileId = number;
export interface TileDefinition {
    readonly id: TileId;
    readonly name?: string;
    /** Index into the atlas, left to right then top to bottom. */
    readonly atlasIndex?: number;
    /** How the tile collides. Omit for a decorative tile. */
    readonly collision?: TileCollision;
    /** Arbitrary gameplay data — damage, friction, a trigger name. */
    readonly properties?: Readonly<Record<string, string | number | boolean>>;
}
/**
 * Collision shapes a tile can have.
 *
 * `solid` and `platform` cover most 2D games; `slope` exists because a tile
 * grid without slopes forces every hill to be a staircase, and players feel
 * that immediately.
 */
export type TileCollision = {
    readonly kind: "solid";
}
/** Solid only from above, so a player can jump up through it. */
 | {
    readonly kind: "platform";
}
/** A ramp rising from `left` to `right`, each in `[0, 1]` of tile height. */
 | {
    readonly kind: "slope";
    readonly left: number;
    readonly right: number;
};
export interface TilemapLayerOptions {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    /** Layers below draw first. */
    readonly order?: number;
    /** Parallax factor; below 1 scrolls slower than the camera. */
    readonly parallax?: readonly [number, number];
    readonly visible?: boolean;
    /** Whether this layer contributes to collision. */
    readonly collides?: boolean;
}
/** One grid of tiles. */
export declare class TilemapLayer {
    #private;
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly order: number;
    readonly parallax: readonly [number, number];
    readonly collides: boolean;
    visible: boolean;
    constructor(options: TilemapLayerOptions);
    /** Increments on every mutation, so a renderer can skip unchanged layers. */
    get revision(): number;
    get tiles(): Readonly<Uint32Array>;
    inBounds(x: number, y: number): boolean;
    /**
     * The tile at a coordinate.
     *
     * Out of bounds reads as empty rather than throwing: collision and rendering
     * both sample beyond the edges constantly, and making that an error would
     * mean a bounds check at every call site.
     */
    get(x: number, y: number): TileId;
    set(x: number, y: number, tile: TileId): void;
    fill(tile: TileId, region?: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): void;
    /** Replaces the whole grid, for loading a saved or generated map. */
    load(tiles: ArrayLike<number>): void;
    /** Serializable copy of the grid. */
    snapshot(): number[];
}
export interface TilemapOptions {
    /** Size of one tile in world units. */
    readonly tileSize?: number;
    readonly tiles?: readonly TileDefinition[];
}
export interface TileHit {
    readonly x: number;
    readonly y: number;
    readonly tile: TileId;
    readonly definition: TileDefinition;
    readonly layer: string;
}
export interface TilemapStats {
    readonly layers: number;
    readonly tiles: number;
    readonly nonEmpty: number;
    readonly definitions: number;
}
/**
 * A stack of layers plus the tile definitions they refer to.
 *
 * Definitions are held once for the whole map rather than per tile, because a
 * map with a hundred thousand tiles has perhaps fifty distinct kinds.
 */
export declare class Tilemap {
    #private;
    readonly tileSize: number;
    constructor(options?: TilemapOptions);
    define(definition: TileDefinition): void;
    definition(tile: TileId): TileDefinition | undefined;
    get definitions(): readonly TileDefinition[];
    addLayer(options: TilemapLayerOptions): TilemapLayer;
    layer(name: string): TilemapLayer;
    /** Layers in draw order, back to front. */
    get layers(): readonly TilemapLayer[];
    removeLayer(name: string): boolean;
    /** World position to tile coordinate. */
    worldToTile(x: number, y: number): {
        x: number;
        y: number;
    };
    /** Bottom-left corner of a tile, in world units. */
    tileToWorld(x: number, y: number): [number, number];
    /** The topmost colliding tile at a coordinate, or `undefined`. */
    tileAt(x: number, y: number): TileHit | undefined;
    stats(): TilemapStats;
}
export interface TileAabb {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export interface TileCollisionResult {
    /** Corrected position after resolving. */
    readonly position: readonly [number, number];
    readonly grounded: boolean;
    /** Whether the mover hit something horizontally. */
    readonly blockedX: boolean;
    readonly blockedY: boolean;
    readonly hits: readonly TileHit[];
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
export declare function moveInTilemap(map: Tilemap, box: TileAabb, motion: readonly [number, number], options?: {
    readonly wasGrounded?: boolean;
}): TileCollisionResult;
export interface TileInstance {
    readonly x: number;
    readonly y: number;
    readonly atlasIndex: number;
}
/**
 * The visible tiles of a layer within a camera's view.
 *
 * Culling to the view is not an optimization here but a requirement: a
 * thousand-by-thousand map is a million tiles, and submitting all of them per
 * frame is not survivable at any tile size.
 */
export declare function visibleTiles(map: Tilemap, layer: TilemapLayer, view: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}, options?: {
    readonly margin?: number;
}): readonly TileInstance[];
//# sourceMappingURL=tilemap.d.ts.map