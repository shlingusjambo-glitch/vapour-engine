/** Large-world coordinates: floating origin and world partitioning.
 *
 * A 32-bit float has about seven significant decimal digits. Near the origin
 * that is nanometre precision; ten kilometres out it is roughly a millimetre,
 * and a hundred kilometres out roughly a centimetre. Vertices, matrices, and
 * physics all run in `f32` on the GPU and across the WASM boundary, so a world
 * larger than a few kilometres develops visible jitter: geometry shimmers,
 * physics contacts chatter, and a camera rotating in place appears to vibrate.
 *
 * The fix is not more precision — it is keeping the numbers small. A floating
 * origin stores world position in `f64` and periodically **rebases** everything
 * so the camera sits near zero, which is what makes an open world of any size
 * behave as well as a small one.
 *
 * This cannot be retrofitted cheaply: every system that caches a world position
 * has to learn about rebasing. So the shift is published as an event with the
 * delta, and systems subscribe.
 */
import { Signal } from "../framework/signal.js";

/** A position in double precision, which the engine's `f32` path cannot hold. */
export type WorldPosition = readonly [number, number, number];

export interface FloatingOriginOptions {
  /**
   * Distance from the current origin at which a rebase happens.
   *
   * Large enough that rebasing is rare, small enough that `f32` precision
   * stays comfortable. A kilometre keeps rendered coordinates under ~1 mm of
   * error while rebasing perhaps once a minute of travel.
   */
  readonly threshold?: number;
  /**
   * Round the shift to a multiple of this.
   *
   * Snapping keeps procedural content, shadow cascades, and texture sampling
   * stable across a rebase: an unsnapped shift changes the fractional part of
   * every coordinate and makes noise-based terrain visibly crawl.
   */
  readonly snap?: number;
}

export interface OriginShift {
  /** Movement applied to every rendered position, in world units. */
  readonly delta: WorldPosition;
  /** The new origin, in absolute world space. */
  readonly origin: WorldPosition;
  readonly shiftCount: number;
}

/**
 * Keeps rendered coordinates near zero for an arbitrarily large world.
 *
 * Absolute positions are held in `f64` here; everything downstream sees a local
 * position that never grows large.
 */
export class FloatingOrigin {
  /** Emitted after each rebase, so systems can move cached positions. */
  readonly shifted = new Signal<OriginShift>();

  readonly #threshold: number;
  readonly #snap: number;
  #origin: [number, number, number] = [0, 0, 0];
  #shiftCount = 0;

  constructor(options: FloatingOriginOptions = {}) {
    this.#threshold = options.threshold ?? 1_000;
    this.#snap = options.snap ?? 1;
    if (!(this.#threshold > 0)) throw new Error("A floating-origin threshold must be positive.");
    if (!(this.#snap > 0)) throw new Error("A floating-origin snap must be positive.");
  }

  /** The current origin in absolute world space. */
  get origin(): WorldPosition {
    return this.#origin;
  }

  get shiftCount(): number {
    return this.#shiftCount;
  }

  /** Converts an absolute world position into engine-local coordinates. */
  toLocal(world: WorldPosition): [number, number, number] {
    return [world[0] - this.#origin[0], world[1] - this.#origin[1], world[2] - this.#origin[2]];
  }

  /** Converts engine-local coordinates back to absolute world space. */
  toWorld(local: WorldPosition): [number, number, number] {
    return [local[0] + this.#origin[0], local[1] + this.#origin[1], local[2] + this.#origin[2]];
  }

  /**
   * Rebases if the viewer has strayed too far, returning the shift if so.
   *
   * Called with the viewer's **local** position, because that is what a camera
   * actually has after a previous rebase.
   */
  update(viewerLocal: WorldPosition): OriginShift | undefined {
    const distance = Math.hypot(viewerLocal[0], viewerLocal[1], viewerLocal[2]);
    if (distance < this.#threshold) return undefined;

    // Snap so the fractional part of every coordinate is preserved.
    const delta: [number, number, number] = [
      -Math.round(viewerLocal[0] / this.#snap) * this.#snap,
      -Math.round(viewerLocal[1] / this.#snap) * this.#snap,
      -Math.round(viewerLocal[2] / this.#snap) * this.#snap,
    ];
    if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return undefined;

    this.#origin = [this.#origin[0] - delta[0], this.#origin[1] - delta[1], this.#origin[2] - delta[2]];
    this.#shiftCount += 1;
    const shift: OriginShift = { delta, origin: [...this.#origin] as WorldPosition, shiftCount: this.#shiftCount };
    this.shifted.emit(shift);
    return shift;
  }

  /** Applies a shift to a position, for systems handling the event. */
  static apply(position: readonly number[], shift: OriginShift): [number, number, number] {
    return [(position[0] ?? 0) + shift.delta[0], (position[1] ?? 0) + shift.delta[1], (position[2] ?? 0) + shift.delta[2]];
  }

  /** Applies a shift in place across a packed position buffer. */
  static applyToBuffer(positions: Float32Array, shift: OriginShift, stride = 3): void {
    if (!Number.isInteger(stride) || stride < 3) throw new Error("A position buffer stride must be a whole number of at least 3.");
    for (let index = 0; index + 2 < positions.length; index += stride) {
      positions[index] = positions[index]! + shift.delta[0];
      positions[index + 1] = positions[index + 1]! + shift.delta[1];
      positions[index + 2] = positions[index + 2]! + shift.delta[2];
    }
  }

  /** Resets to absolute zero, for a level change. */
  reset(origin: WorldPosition = [0, 0, 0]): void {
    this.#origin = [origin[0], origin[1], origin[2]];
  }

  /**
   * Worst-case `f32` precision at a distance, in world units.
   *
   * Exposed so a game can assert its threshold is actually tight enough rather
   * than discovering the jitter in play.
   */
  static precisionAt(distance: number): number {
    if (!(distance >= 0)) throw new Error("A distance must not be negative.");
    if (distance === 0) return 0;
    // f32 has a 24-bit significand, so the gap between representable values is
    // 2^(exponent - 23).
    const exponent = Math.floor(Math.log2(distance));
    return 2 ** (exponent - 23);
  }
}

export interface PartitionCell {
  readonly x: number;
  readonly z: number;
  /** Distance in cells from the viewer's cell. */
  readonly ring: number;
}

export interface WorldPartitionOptions {
  /** Edge length of one cell, in world units. */
  readonly cellSize?: number;
  /** Cells loaded around the viewer, as a radius in cells. */
  readonly loadRadius?: number;
  /**
   * Extra radius before a cell is unloaded.
   *
   * Without hysteresis a viewer standing on a boundary loads and unloads the
   * same cell every frame — the single most common streaming bug.
   */
  readonly unloadPadding?: number;
}

export interface PartitionUpdate {
  readonly toLoad: readonly PartitionCell[];
  readonly toUnload: readonly PartitionCell[];
  readonly resident: number;
}

/**
 * A grid of world cells with hysteresis.
 *
 * Complements `ChunkStreamManager`, which owns the *loading*; this owns the
 * decision of what should be resident. Separating them means the policy can be
 * tested without any asynchronous loading at all.
 */
export class WorldPartition {
  readonly #cellSize: number;
  readonly #loadRadius: number;
  readonly #unloadRadius: number;
  readonly #resident = new Map<string, PartitionCell>();

  constructor(options: WorldPartitionOptions = {}) {
    this.#cellSize = options.cellSize ?? 256;
    this.#loadRadius = options.loadRadius ?? 2;
    const padding = options.unloadPadding ?? 1;
    if (!(this.#cellSize > 0)) throw new Error("A world partition cell size must be positive.");
    if (!Number.isInteger(this.#loadRadius) || this.#loadRadius < 0) throw new Error("A load radius must be a non-negative whole number of cells.");
    if (!Number.isInteger(padding) || padding < 0) throw new Error("An unload padding must be a non-negative whole number of cells.");
    this.#unloadRadius = this.#loadRadius + padding;
  }

  get cellSize(): number {
    return this.#cellSize;
  }

  get residentCells(): readonly PartitionCell[] {
    return [...this.#resident.values()];
  }

  /** The cell containing a position. */
  cellOf(position: WorldPosition): { x: number; z: number } {
    return { x: Math.floor(position[0] / this.#cellSize), z: Math.floor(position[2] / this.#cellSize) };
  }

  /** World-space centre of a cell, for placing and culling its contents. */
  centerOf(cell: { x: number; z: number }): [number, number, number] {
    return [(cell.x + 0.5) * this.#cellSize, 0, (cell.z + 0.5) * this.#cellSize];
  }

  /** Updates residency for a viewer, returning what changed. */
  update(viewer: WorldPosition): PartitionUpdate {
    const center = this.cellOf(viewer);
    const wanted = new Map<string, PartitionCell>();
    for (let dz = -this.#loadRadius; dz <= this.#loadRadius; dz += 1) {
      for (let dx = -this.#loadRadius; dx <= this.#loadRadius; dx += 1) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        if (ring > this.#loadRadius) continue;
        const cell: PartitionCell = { x: center.x + dx, z: center.z + dz, ring };
        wanted.set(cellKey(cell), cell);
      }
    }

    const toLoad: PartitionCell[] = [];
    for (const [key, cell] of wanted) {
      if (!this.#resident.has(key)) toLoad.push(cell);
    }
    // Nearest first: the cell the player is about to enter matters more than
    // one at the edge of the radius.
    toLoad.sort((a, b) => a.ring - b.ring || a.x - b.x || a.z - b.z);

    const toUnload: PartitionCell[] = [];
    for (const [key, cell] of this.#resident) {
      const ring = Math.max(Math.abs(cell.x - center.x), Math.abs(cell.z - center.z));
      // Hysteresis: only unload past the larger radius, so a viewer on a
      // boundary does not thrash.
      if (ring > this.#unloadRadius) toUnload.push(cell);
      else if (!wanted.has(key)) wanted.set(key, { ...cell, ring });
    }

    for (const cell of toUnload) this.#resident.delete(cellKey(cell));
    for (const cell of toLoad) this.#resident.set(cellKey(cell), cell);

    return { toLoad, toUnload, resident: this.#resident.size };
  }

  /** Shifts every resident cell after a floating-origin rebase. */
  applyOriginShift(shift: OriginShift): void {
    const cellsX = Math.round(shift.delta[0] / this.#cellSize);
    const cellsZ = Math.round(shift.delta[2] / this.#cellSize);
    if (cellsX === 0 && cellsZ === 0) return;
    const moved = new Map<string, PartitionCell>();
    for (const cell of this.#resident.values()) {
      const shifted: PartitionCell = { x: cell.x + cellsX, z: cell.z + cellsZ, ring: cell.ring };
      moved.set(cellKey(shifted), shifted);
    }
    this.#resident.clear();
    for (const [key, cell] of moved) this.#resident.set(key, cell);
  }

  clear(): void {
    this.#resident.clear();
  }
}

function cellKey(cell: { x: number; z: number }): string {
  return `${cell.x}_${cell.z}`;
}

export interface TerrainLodLevel {
  /** Vertices along one edge of a chunk at this level. */
  readonly resolution: number;
  /** Chunks within this many cells of the viewer use this level. */
  readonly ringRadius: number;
}

/**
 * Chooses a terrain chunk's mesh resolution by distance.
 *
 * Terrain LOD is by *ring*, not by screen size, because neighbouring chunks
 * must agree: two adjacent chunks at different resolutions leave a crack along
 * their shared edge, and a screen-size rule makes which pairs differ
 * unpredictable. Rings make adjacency predictable, so seams can be stitched.
 */
export function selectTerrainLod(levels: readonly TerrainLodLevel[], ring: number): TerrainLodLevel {
  if (levels.length === 0) throw new Error("A terrain LOD chain needs at least one level.");
  let previous = 0;
  for (const [index, level] of levels.entries()) {
    if (!Number.isInteger(level.resolution) || level.resolution < 2) {
      throw new Error(`Terrain LOD level ${index} needs a resolution of at least 2.`);
    }
    if (index > 0 && level.resolution > previous) {
      throw new Error("Terrain LOD levels must descend in resolution from nearest to furthest.");
    }
    previous = level.resolution;
  }
  for (const level of levels) {
    if (ring <= level.ringRadius) return level;
  }
  return levels[levels.length - 1]!;
}

/**
 * Which edges of a chunk border a coarser neighbour.
 *
 * Those edges need their vertices collapsed to the neighbour's spacing, or the
 * height mismatch shows as a visible crack. Returning the set lets a mesher
 * stitch exactly the edges that need it and no others.
 */
export function terrainSeams(
  levels: readonly TerrainLodLevel[],
  cell: PartitionCell,
  viewerCell: { x: number; z: number },
): { readonly north: boolean; readonly south: boolean; readonly east: boolean; readonly west: boolean } {
  const ringOf = (x: number, z: number): number => Math.max(Math.abs(x - viewerCell.x), Math.abs(z - viewerCell.z));
  const own = selectTerrainLod(levels, cell.ring).resolution;
  const coarser = (x: number, z: number): boolean => selectTerrainLod(levels, ringOf(x, z)).resolution < own;
  return {
    north: coarser(cell.x, cell.z - 1),
    south: coarser(cell.x, cell.z + 1),
    east: coarser(cell.x + 1, cell.z),
    west: coarser(cell.x - 1, cell.z),
  };
}
