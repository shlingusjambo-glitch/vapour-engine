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
export type TileCollision =
  | { readonly kind: "solid" }
  /** Solid only from above, so a player can jump up through it. */
  | { readonly kind: "platform" }
  /** A ramp rising from `left` to `right`, each in `[0, 1]` of tile height. */
  | { readonly kind: "slope"; readonly left: number; readonly right: number };

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
export class TilemapLayer {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly order: number;
  readonly parallax: readonly [number, number];
  readonly collides: boolean;
  visible: boolean;

  readonly #tiles: Uint32Array;
  #revision = 0;

  constructor(options: TilemapLayerOptions) {
    if (!options.name.trim()) throw new Error("A tilemap layer requires a non-empty name.");
    if (!Number.isInteger(options.width) || options.width < 1) throw new Error(`Layer "${options.name}" needs a width of at least 1.`);
    if (!Number.isInteger(options.height) || options.height < 1) throw new Error(`Layer "${options.name}" needs a height of at least 1.`);
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
  get revision(): number {
    return this.#revision;
  }

  get tiles(): Readonly<Uint32Array> {
    return this.#tiles;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /**
   * The tile at a coordinate.
   *
   * Out of bounds reads as empty rather than throwing: collision and rendering
   * both sample beyond the edges constantly, and making that an error would
   * mean a bounds check at every call site.
   */
  get(x: number, y: number): TileId {
    if (!this.inBounds(x, y)) return EMPTY_TILE;
    return this.#tiles[y * this.width + x]!;
  }

  set(x: number, y: number, tile: TileId): void {
    if (!this.inBounds(x, y)) throw new Error(`Tile (${x}, ${y}) is outside layer "${this.name}" (${this.width}x${this.height}).`);
    if (!Number.isInteger(tile) || tile < 0) throw new Error(`A tile id must be a non-negative whole number (got ${tile}).`);
    const index = y * this.width + x;
    if (this.#tiles[index] === tile) return;
    this.#tiles[index] = tile;
    this.#revision += 1;
  }

  fill(tile: TileId, region?: { x: number; y: number; width: number; height: number }): void {
    if (!Number.isInteger(tile) || tile < 0) throw new Error(`A tile id must be a non-negative whole number (got ${tile}).`);
    if (!region) {
      this.#tiles.fill(tile);
      this.#revision += 1;
      return;
    }
    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        if (this.inBounds(x, y)) this.#tiles[y * this.width + x] = tile;
      }
    }
    this.#revision += 1;
  }

  /** Replaces the whole grid, for loading a saved or generated map. */
  load(tiles: ArrayLike<number>): void {
    if (tiles.length !== this.#tiles.length) {
      throw new Error(`Layer "${this.name}" holds ${this.#tiles.length} tiles but was given ${tiles.length}.`);
    }
    this.#tiles.set(tiles);
    this.#revision += 1;
  }

  /** Serializable copy of the grid. */
  snapshot(): number[] {
    return [...this.#tiles];
  }
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
export class Tilemap {
  readonly tileSize: number;
  readonly #layers: TilemapLayer[] = [];
  readonly #definitions = new Map<TileId, TileDefinition>();

  constructor(options: TilemapOptions = {}) {
    this.tileSize = options.tileSize ?? 1;
    if (!(this.tileSize > 0)) throw new Error("A tile size must be positive.");
    for (const definition of options.tiles ?? []) this.define(definition);
  }

  define(definition: TileDefinition): void {
    if (definition.id === EMPTY_TILE) throw new Error("Tile id 0 is reserved for empty space.");
    if (!Number.isInteger(definition.id) || definition.id < 0) throw new Error("A tile id must be a non-negative whole number.");
    if (definition.collision?.kind === "slope") {
      for (const value of [definition.collision.left, definition.collision.right]) {
        if (!(value >= 0 && value <= 1)) throw new Error(`Slope tile ${definition.id} needs heights in [0, 1].`);
      }
    }
    this.#definitions.set(definition.id, definition);
  }

  definition(tile: TileId): TileDefinition | undefined {
    return this.#definitions.get(tile);
  }

  get definitions(): readonly TileDefinition[] {
    return [...this.#definitions.values()].sort((a, b) => a.id - b.id);
  }

  addLayer(options: TilemapLayerOptions): TilemapLayer {
    if (this.#layers.some((layer) => layer.name === options.name)) {
      throw new Error(`A tilemap layer named "${options.name}" already exists.`);
    }
    const layer = new TilemapLayer(options);
    this.#layers.push(layer);
    this.#layers.sort((a, b) => a.order - b.order);
    return layer;
  }

  layer(name: string): TilemapLayer {
    const found = this.#layers.find((entry) => entry.name === name);
    if (!found) throw new Error(`No tilemap layer named "${name}". Layers: ${this.#layers.map((entry) => entry.name).join(", ")}.`);
    return found;
  }

  /** Layers in draw order, back to front. */
  get layers(): readonly TilemapLayer[] {
    return this.#layers;
  }

  removeLayer(name: string): boolean {
    const index = this.#layers.findIndex((layer) => layer.name === name);
    if (index < 0) return false;
    this.#layers.splice(index, 1);
    return true;
  }

  /** World position to tile coordinate. */
  worldToTile(x: number, y: number): { x: number; y: number } {
    return { x: Math.floor(x / this.tileSize), y: Math.floor(y / this.tileSize) };
  }

  /** Bottom-left corner of a tile, in world units. */
  tileToWorld(x: number, y: number): [number, number] {
    return [x * this.tileSize, y * this.tileSize];
  }

  /** The topmost colliding tile at a coordinate, or `undefined`. */
  tileAt(x: number, y: number): TileHit | undefined {
    // Front to back: the topmost layer wins, matching what the player sees.
    for (let index = this.#layers.length - 1; index >= 0; index -= 1) {
      const layer = this.#layers[index]!;
      if (!layer.collides) continue;
      const tile = layer.get(x, y);
      if (tile === EMPTY_TILE) continue;
      const definition = this.#definitions.get(tile);
      if (!definition?.collision) continue;
      return { x, y, tile, definition, layer: layer.name };
    }
    return undefined;
  }

  stats(): TilemapStats {
    let tiles = 0;
    let nonEmpty = 0;
    for (const layer of this.#layers) {
      tiles += layer.width * layer.height;
      for (const tile of layer.tiles) {
        if (tile !== EMPTY_TILE) nonEmpty += 1;
      }
    }
    return { layers: this.#layers.length, tiles, nonEmpty, definitions: this.#definitions.size };
  }
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
export function moveInTilemap(
  map: Tilemap,
  box: TileAabb,
  motion: readonly [number, number],
  options: { readonly wasGrounded?: boolean } = {},
): TileCollisionResult {
  if (!(box.width > 0) || !(box.height > 0)) throw new Error("A colliding box needs a positive size.");
  if (!Number.isFinite(motion[0]) || !Number.isFinite(motion[1])) throw new Error("Tilemap motion must be finite.");

  const hits: TileHit[] = [];
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
      let blocking: TileHit | undefined;
      for (const tileY of tileRange(map, y, box.height)) {
        const hit = map.tileAt(column, tileY);
        if (hit?.definition.collision?.kind !== "solid") continue;
        blocking = hit;
        break;
      }
      if (!blocking) continue;
      const [tileWorldX] = map.tileToWorld(column, 0);
      x = forward ? tileWorldX - box.width : tileWorldX + map.tileSize;
      blockedX = true;
      hits.push(blocking);
      break;
    }
    if (!blockedX) x = target;
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
      let blocking: TileHit | undefined;
      for (const tileX of tileRange(map, x, box.width)) {
        const hit = map.tileAt(tileX, row);
        if (!hit) continue;
        const collision = hit.definition.collision!;
        if (collision.kind === "platform") {
          // Solid only from above, and only if the mover started clear of it.
          if (upward) continue;
          const [, tileTop] = map.tileToWorld(tileX, row);
          if (box.y < tileTop + map.tileSize - 1e-6) continue;
        } else if (collision.kind === "slope") {
          continue;
        }
        blocking = hit;
        break;
      }
      if (!blocking) continue;
      const [, tileWorldY] = map.tileToWorld(0, row);
      y = upward ? tileWorldY - box.height : tileWorldY + map.tileSize;
      blockedY = true;
      grounded = !upward;
      hits.push(blocking);
      break;
    }
    if (!blockedY) y = target;
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
function tileRange(map: Tilemap, start: number, size: number): number[] {
  const first = Math.floor(start / map.tileSize);
  const last = Math.floor((start + size - 1e-6) / map.tileSize);
  const range: number[] = [];
  for (let index = first; index <= last; index += 1) range.push(index);
  return range;
}

/** Surface height of a slope beneath a point, if any. */
function slopeHeightAt(map: Tilemap, worldX: number, worldY: number): number | undefined {
  const tile = map.worldToTile(worldX, worldY);
  for (const candidateY of [tile.y, tile.y - 1]) {
    const hit = map.tileAt(tile.x, candidateY);
    if (hit?.definition.collision?.kind !== "slope") continue;
    const [tileX, tileYWorld] = map.tileToWorld(tile.x, candidateY);
    const t = Math.min(1, Math.max(0, (worldX - tileX) / map.tileSize));
    const collision = hit.definition.collision;
    const height = collision.left + (collision.right - collision.left) * t;
    return tileYWorld + height * map.tileSize;
  }
  return undefined;
}

function isOnGround(map: Tilemap, x: number, y: number, width: number): boolean {
  const probeY = map.worldToTile(0, y - 1e-4).y;
  for (const tileX of tileRange(map, x, width)) {
    const hit = map.tileAt(tileX, probeY);
    if (hit && hit.definition.collision?.kind !== "slope") return true;
  }
  return false;
}

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
export function visibleTiles(
  map: Tilemap,
  layer: TilemapLayer,
  view: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  options: { readonly margin?: number } = {},
): readonly TileInstance[] {
  if (!layer.visible) return [];
  const margin = options.margin ?? 1;
  // Parallax shifts which part of the layer the camera sees.
  const originX = view.x * layer.parallax[0];
  const originY = view.y * layer.parallax[1];
  const first = map.worldToTile(originX, originY);
  const last = map.worldToTile(originX + view.width, originY + view.height);

  const instances: TileInstance[] = [];
  for (let y = first.y - margin; y <= last.y + margin; y += 1) {
    for (let x = first.x - margin; x <= last.x + margin; x += 1) {
      const tile = layer.get(x, y);
      if (tile === EMPTY_TILE) continue;
      instances.push({ x, y, atlasIndex: map.definition(tile)?.atlasIndex ?? tile - 1 });
    }
  }
  return instances;
}
