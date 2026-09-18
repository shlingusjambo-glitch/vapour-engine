/** Terrain sculpt/paint tooling and procedural terrain generation.
 *
 * Sculpting mutates `TerrainHeightfield.heights` in place — the same buffer
 * `mesh()`, `collider()`, and `TerrainChunkGrid` already read — so an edit is
 * visible to every consumer without a second copy to keep in sync. Every
 * operation is a deterministic function of (grid position, brush, strength):
 * no timers, no randomness, so the same sequence of calls produces the same
 * terrain on every machine, which is what a headless editor test and a
 * multiplayer edit-replication path both need.
 *
 * Paint uses the same brush shape over `TerrainSplatMap.paint`, which already
 * owns weight normalisation; this module only decides *which* vertices a
 * brush touches and *how strongly*.
 *
 * Undo is a command log of before/after patches rather than a snapshot stack:
 * a patch only stores the vertices an operation actually touched, so undoing a
 * small brush stroke on a large terrain is cheap.
 */
import { GradientNoise, type FractalNoiseOptions, type ProceduralSeed } from "./procedural-noise.js";
import type { TerrainSplatMap } from "./terrain-chunks.js";
import type { TerrainHeightfield } from "./terrain.js";

export type BrushFalloff = "constant" | "linear" | "smooth";

export interface BrushOptions {
  /** Radius in grid cells (fractional allowed). */
  readonly radius: number;
  readonly falloff?: BrushFalloff;
  /** Overall multiplier in [0, 1] applied on top of the falloff curve. */
  readonly strength?: number;
}

/** Weight in [0, 1] for a sample at `distance` cells from the brush centre. */
export function brushWeight(distance: number, brush: BrushOptions): number {
  const radius = brush.radius;
  if (!(radius > 0)) throw new Error("A brush radius must be positive.");
  const strength = brush.strength ?? 1;
  if (!(strength >= 0 && strength <= 1)) throw new Error("A brush strength must be in [0, 1].");
  if (distance >= radius) return 0;
  const t = distance / radius;
  const falloff = brush.falloff ?? "smooth";
  const shape = falloff === "constant" ? 1 : falloff === "linear" ? 1 - t : (1 - t * t) ** 2; // smoothstep-like
  return shape * strength;
}

/** Grid cells within a brush's radius of a centre, each with its falloff
 * weight, clamped to the field. Shared by height and splat brushes so both
 * paint the exact same footprint. */
function* brushCells(
  field: { readonly rows: number; readonly columns: number },
  centerColumn: number,
  centerRow: number,
  brush: BrushOptions,
): Generator<{ readonly column: number; readonly row: number; readonly weight: number }> {
  const radius = Math.ceil(brush.radius);
  const startColumn = Math.max(0, Math.floor(centerColumn - radius));
  const endColumn = Math.min(field.columns - 1, Math.ceil(centerColumn + radius));
  const startRow = Math.max(0, Math.floor(centerRow - radius));
  const endRow = Math.min(field.rows - 1, Math.ceil(centerRow + radius));
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const distance = Math.hypot(column - centerColumn, row - centerRow);
      const weight = brushWeight(distance, brush);
      if (weight > 0) yield { column, row, weight };
    }
  }
}

export interface HeightEdit {
  readonly index: number;
  readonly before: number;
  readonly after: number;
}

/** One undoable operation: the exact set of heightfield samples it changed. */
export interface TerrainPatch {
  readonly kind: "height";
  readonly edits: readonly HeightEdit[];
}

export interface SplatEdit {
  readonly vertex: number;
  readonly before: readonly number[];
  readonly after: readonly number[];
}

export interface SplatPatch {
  readonly kind: "splat";
  readonly edits: readonly SplatEdit[];
}

export type EditPatch = TerrainPatch | SplatPatch;

function applyHeightEdits(field: TerrainHeightfield, edits: readonly HeightEdit[], direction: "after" | "before"): void {
  for (const edit of edits) field.heights[edit.index] = edit[direction];
}

function applySplatEdits(splat: TerrainSplatMap, edits: readonly SplatEdit[], direction: "after" | "before"): void {
  for (const edit of edits) splat.setWeights(edit.vertex, edit[direction]);
}

/** Applies (or reverses) a patch. Used by both the sculptor and undo/redo. */
export function applyPatch(target: { readonly heightfield?: TerrainHeightfield; readonly splat?: TerrainSplatMap }, patch: EditPatch, direction: "after" | "before" = "after"): void {
  if (patch.kind === "height") {
    if (target.heightfield === undefined) throw new Error("A height patch needs a heightfield.");
    applyHeightEdits(target.heightfield, patch.edits, direction);
  } else {
    if (target.splat === undefined) throw new Error("A splat patch needs a splat map.");
    applySplatEdits(target.splat, patch.edits, direction);
  }
}

/** A linear undo/redo log of edit patches. */
export class TerrainEditHistory {
  readonly #undoStack: EditPatch[] = [];
  readonly #redoStack: EditPatch[] = [];

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  /** Records a patch that has already been applied. Clears the redo log, as
   * any linear history does once a fresh edit branches from it. */
  record(patch: EditPatch): void {
    if (patch.edits.length === 0) return;
    this.#undoStack.push(patch);
    this.#redoStack.length = 0;
  }

  undo(target: { readonly heightfield?: TerrainHeightfield; readonly splat?: TerrainSplatMap }): EditPatch | undefined {
    const patch = this.#undoStack.pop();
    if (patch === undefined) return undefined;
    applyPatch(target, patch, "before");
    this.#redoStack.push(patch);
    return patch;
  }

  redo(target: { readonly heightfield?: TerrainHeightfield; readonly splat?: TerrainSplatMap }): EditPatch | undefined {
    const patch = this.#redoStack.pop();
    if (patch === undefined) return undefined;
    applyPatch(target, patch, "after");
    this.#undoStack.push(patch);
    return patch;
  }

  clear(): void {
    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
  }
}

/** Sculpts a heightfield in place with brush-shaped, deterministic operations.
 * Every method returns the patch it applied, so a caller can feed it straight
 * into a `TerrainEditHistory` (or a network edit log) without recomputing it. */
export class TerrainSculptor {
  constructor(private readonly field: TerrainHeightfield) {}

  raise(centerColumn: number, centerRow: number, brush: BrushOptions, amount: number): TerrainPatch {
    return this.#stroke(centerColumn, centerRow, brush, (height, weight) => height + amount * weight);
  }

  lower(centerColumn: number, centerRow: number, brush: BrushOptions, amount: number): TerrainPatch {
    return this.#stroke(centerColumn, centerRow, brush, (height, weight) => height - amount * weight);
  }

  /** Moves samples toward `targetHeight` (in the same normalized units
   * `TerrainHeightfield` stores, i.e. before `scale[1]`). */
  flatten(centerColumn: number, centerRow: number, brush: BrushOptions, targetHeight: number): TerrainPatch {
    return this.#stroke(centerColumn, centerRow, brush, (height, weight) => height + (targetHeight - height) * weight);
  }

  /** Alias of `flatten`, named for the common "paint an exact elevation" case
   * where the whole brush is meant to reach the target rather than blend
   * toward it — same interpolation, since a single-radius brush is already at
   * full weight at its centre. */
  setHeight(centerColumn: number, centerRow: number, brush: BrushOptions, height: number): TerrainPatch {
    return this.flatten(centerColumn, centerRow, brush, height);
  }

  /** Box-blurs each touched sample toward its 3x3 neighbourhood average,
   * scaled by the brush weight. */
  smooth(centerColumn: number, centerRow: number, brush: BrushOptions): TerrainPatch {
    const field = this.field;
    const raw = (column: number, row: number): number => field.heights[row * field.columns + column]!;
    return this.#stroke(centerColumn, centerRow, brush, (height, weight, column, row) => {
      let total = 0;
      let count = 0;
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const c = column + dx;
          const r = row + dz;
          if (c < 0 || c >= field.columns || r < 0 || r >= field.rows) continue;
          total += raw(c, r);
          count += 1;
        }
      }
      const average = total / count;
      return height + (average - height) * weight;
    });
  }

  #stroke(
    centerColumn: number,
    centerRow: number,
    brush: BrushOptions,
    next: (height: number, weight: number, column: number, row: number) => number,
  ): TerrainPatch {
    const field = this.field;
    const edits: HeightEdit[] = [];
    for (const { column, row, weight } of brushCells(field, centerColumn, centerRow, brush)) {
      const index = row * field.columns + column;
      const before = field.heights[index]!;
      const after = next(before, weight, column, row);
      if (after === before) continue;
      field.heights[index] = after;
      edits.push({ index, before, after });
    }
    return { kind: "height", edits };
  }
}

/** Paints splat weights within a brush footprint, sharing the exact same
 * falloff shape sculpting uses so a "raise and paint rock" tool stays
 * consistent between its two effects. */
export class TerrainPaintbrush {
  constructor(private readonly splat: TerrainSplatMap) {}

  paint(centerColumn: number, centerRow: number, brush: BrushOptions, layer: number): SplatPatch {
    const splat = this.splat;
    const edits: SplatEdit[] = [];
    for (const { column, row, weight } of brushCells(splat, centerColumn, centerRow, brush)) {
      const vertex = splat.vertexIndex(column, row);
      const before = splat.weightsAt(vertex);
      splat.paint(vertex, layer, weight);
      const after = splat.weightsAt(vertex);
      if (after.every((value, index) => value === before[index])) continue;
      edits.push({ vertex, before, after });
    }
    return { kind: "splat", edits };
  }
}

export interface ProceduralTerrainOptions {
  readonly seed: ProceduralSeed;
  readonly rows: number;
  readonly columns: number;
  readonly scale: readonly [number, number, number];
  readonly noise?: FractalNoiseOptions;
  /** Base elevation added under the noise, in normalized [-1, 1]-ish units
   * before `scale[1]`. Defaults to 0. */
  readonly base?: number;
  readonly uvScale?: readonly [number, number];
}

/** Deterministic terrain from `GradientNoise`, in the shape
 * `TerrainHeightfield.generate` expects. Kept here rather than duplicating a
 * noise field: this is a thin, documented default for "a plausible island of
 * hills from a seed", not a second noise implementation. */
export function generateProceduralHeights(options: ProceduralTerrainOptions): (x: number, z: number) => number {
  const noise = new GradientNoise(options.seed);
  const base = options.base ?? 0;
  return (x: number, z: number): number => base + noise.fbm2D(x, z, options.noise);
}
