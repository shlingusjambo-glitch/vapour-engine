/** Chunked terrain: a chunk grid over a heightfield, layered materials, and
 * per-chunk splat weights.
 *
 * `TerrainHeightfield` is one mesh. That is right for a test level and wrong
 * for a world: a single buffer cannot be culled, cannot be streamed, and cannot
 * drop resolution with distance. Chunking splits the *same* authoritative
 * samples into independently meshable tiles with their own bounds, so culling,
 * LOD, and streaming become possible without a second source of truth.
 *
 * Splatting is per vertex rather than through a bespoke splat shader because
 * the renderer already accepts per-vertex colour and a per-vertex texture layer
 * (`MeshUpload.colors` / `MeshUpload.textureLayers`) plus grid-atlas materials.
 * Weights therefore compile into a weight-blended tint and the dominant layer's
 * atlas cell, which the standard material draws today; the raw normalised
 * weights ride along for a dedicated splat pass when one exists.
 *
 * LOD is wired here rather than left to callers: `selectTerrainLod` and
 * `terrainSeams` decide *which* resolution and *which* edges are coarser, and
 * `chunkMesh` collapses exactly those edges onto the coarser neighbour's
 * samples, so adjacent chunks at different levels share their edge geometry
 * exactly instead of leaving a crack.
 */
import type { MaterialUpload, MeshUpload, TextureAtlasLayout } from "../render/host/index.js";
import { selectTerrainLod, terrainSeams, type TerrainLodLevel } from "./large-world.js";
import type { TerrainHeightfield } from "./terrain.js";

export interface TerrainLayer {
  readonly name: string;
  /** Linear RGBA tint blended by this layer's splat weight. Defaults to white. */
  readonly tint?: readonly [number, number, number, number];
  /** Atlas cell this layer's textures occupy. Defaults to the layer's index. */
  readonly textureLayer?: number;
}

export interface TerrainMaterialOptions {
  readonly layers: readonly TerrainLayer[];
  /** Base-colour atlas holding one cell per layer. */
  readonly baseColorTexture?: string;
  readonly normalTexture?: string;
  /** Texture repetitions across the whole terrain. Defaults to one. */
  readonly uvScale?: readonly [number, number];
  /** Guard band inside each atlas cell; keeps filtering off the neighbour. */
  readonly atlasInset?: number;
}

const WHITE: readonly [number, number, number, number] = [1, 1, 1, 1];

/** A terrain surface described as an ordered stack of layers.
 *
 * The layer list is the contract shared by painting, meshing, and the material
 * upload: layer *index* is what a splat weight addresses, and the atlas cell is
 * derived from it, so a game cannot paint one layer and draw another. */
export class TerrainMaterial {
  readonly layers: readonly TerrainLayer[];
  readonly uvScale: readonly [number, number];
  readonly #baseColorTexture: string | undefined;
  readonly #normalTexture: string | undefined;
  readonly #atlasInset: number;

  constructor(options: TerrainMaterialOptions) {
    if (options.layers.length === 0) throw new Error("A terrain material needs at least one layer.");
    for (const [index, layer] of options.layers.entries()) {
      if (layer.name.trim() === "") throw new Error(`Terrain layer ${String(index)} needs a name.`);
      if (layer.tint !== undefined && (layer.tint.length !== 4 || !layer.tint.every(Number.isFinite))) {
        throw new Error(`Terrain layer '${layer.name}' needs four finite tint channels.`);
      }
      const cell = layer.textureLayer ?? index;
      if (!Number.isInteger(cell) || cell < 0) throw new Error(`Terrain layer '${layer.name}' needs a non-negative integer textureLayer.`);
    }
    const uvScale = options.uvScale ?? [1, 1];
    if (uvScale.length !== 2 || !uvScale.every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("A terrain material UV scale needs two positive finite numbers.");
    }
    this.layers = options.layers.map((layer) => Object.freeze({ ...layer }));
    this.uvScale = [uvScale[0]!, uvScale[1]!];
    this.#baseColorTexture = options.baseColorTexture;
    this.#normalTexture = options.normalTexture;
    this.#atlasInset = options.atlasInset ?? 0;
    if (!(this.#atlasInset >= 0) || this.#atlasInset >= 0.5) throw new Error("A terrain atlas inset must be in [0, 0.5).");
  }

  get layerCount(): number {
    return this.layers.length;
  }

  /** Index of a layer by name, for tools that paint by label. */
  indexOf(name: string): number {
    const index = this.layers.findIndex((layer) => layer.name === name);
    if (index < 0) throw new Error(`Terrain material has no layer named '${name}'.`);
    return index;
  }

  tint(layer: number): readonly [number, number, number, number] {
    return this.#layer(layer).tint ?? WHITE;
  }

  /** Atlas cell a layer draws from, as written into `MeshUpload.textureLayers`. */
  textureLayer(layer: number): number {
    return this.#layer(layer).textureLayer ?? layer;
  }

  atlas(): TextureAtlasLayout {
    let columns = 1;
    for (let layer = 0; layer < this.layers.length; layer += 1) columns = Math.max(columns, this.textureLayer(layer) + 1);
    return { columns, rows: 1, inset: this.#atlasInset, origin: "bottom-left" };
  }

  /** The material the renderer draws every chunk with. One material for the
   * whole terrain keeps chunks in a single batch. */
  upload(): MaterialUpload {
    const textures = {
      ...(this.#baseColorTexture === undefined ? {} : { baseColor: this.#baseColorTexture }),
      ...(this.#normalTexture === undefined ? {} : { normal: this.#normalTexture }),
    };
    return {
      baseColor: [1, 1, 1, 1],
      uvScale: this.uvScale,
      filter: "linear",
      atlas: this.atlas(),
      ...(Object.keys(textures).length === 0 ? {} : { textures }),
    };
  }

  #layer(index: number): TerrainLayer {
    const layer = this.layers[index];
    if (layer === undefined) throw new Error(`Terrain layer ${String(index)} is outside 0..${String(this.layers.length - 1)}.`);
    return layer;
  }
}

/** Per-vertex layer weights over the heightfield's sample grid.
 *
 * Weights are stored for the whole terrain and sliced per chunk rather than
 * duplicated per chunk: a brush crossing a chunk border would otherwise have to
 * write two maps and keep them agreeing, which is exactly how splat seams
 * appear. Every mutation renormalises the vertex, so the invariant "weights sum
 * to one" holds after any sequence of edits. */
export class TerrainSplatMap {
  readonly rows: number;
  readonly columns: number;
  readonly layerCount: number;
  readonly weights: Float32Array;

  constructor(rows: number, columns: number, layerCount: number, weights?: Float32Array) {
    if (!Number.isInteger(rows) || rows < 2 || !Number.isInteger(columns) || columns < 2) {
      throw new Error("A terrain splat map needs at least a 2x2 vertex grid.");
    }
    if (!Number.isInteger(layerCount) || layerCount < 1) throw new Error("A terrain splat map needs at least one layer.");
    const expected = rows * columns * layerCount;
    if (weights !== undefined && weights.length !== expected) {
      throw new Error(`A terrain splat map needs ${String(expected)} weights, received ${String(weights.length)}.`);
    }
    this.rows = rows;
    this.columns = columns;
    this.layerCount = layerCount;
    this.weights = weights?.slice() ?? new Float32Array(expected);
    if (weights === undefined) for (let vertex = 0; vertex < rows * columns; vertex += 1) this.weights[vertex * layerCount] = 1;
    else for (let vertex = 0; vertex < rows * columns; vertex += 1) this.#normalize(vertex);
  }

  get vertexCount(): number {
    return this.rows * this.columns;
  }

  vertexIndex(column: number, row: number): number {
    if (!Number.isInteger(column) || column < 0 || column >= this.columns || !Number.isInteger(row) || row < 0 || row >= this.rows) {
      throw new RangeError(`Splat vertex (${String(column)}, ${String(row)}) is outside a ${String(this.columns)}x${String(this.rows)} grid.`);
    }
    return row * this.columns + column;
  }

  weightsAt(vertex: number): readonly number[] {
    const base = this.#base(vertex);
    return Array.from(this.weights.subarray(base, base + this.layerCount));
  }

  /** Replaces a vertex's weights, normalising them. */
  setWeights(vertex: number, weights: readonly number[]): void {
    if (weights.length !== this.layerCount) throw new Error(`A splat vertex needs ${String(this.layerCount)} weights, received ${String(weights.length)}.`);
    const base = this.#base(vertex);
    for (let layer = 0; layer < this.layerCount; layer += 1) {
      const value = weights[layer]!;
      if (!Number.isFinite(value) || value < 0) throw new Error("Splat weights must be finite and non-negative.");
      this.weights[base + layer] = value;
    }
    this.#normalize(vertex);
  }

  /** Pushes a vertex toward one layer by `amount` in [0, 1], renormalising the
   * rest. This is the operation a paint brush applies per vertex. */
  paint(vertex: number, layer: number, amount: number): void {
    if (!Number.isInteger(layer) || layer < 0 || layer >= this.layerCount) throw new RangeError(`Splat layer ${String(layer)} is outside 0..${String(this.layerCount - 1)}.`);
    if (!Number.isFinite(amount)) throw new Error("A splat paint amount must be finite.");
    const strength = Math.min(1, Math.max(0, amount));
    if (strength === 0) return;
    const base = this.#base(vertex);
    for (let index = 0; index < this.layerCount; index += 1) {
      const target = index === layer ? 1 : 0;
      this.weights[base + index] = this.weights[base + index]! + (target - this.weights[base + index]!) * strength;
    }
    this.#normalize(vertex);
  }

  /** Sets every vertex to a single layer. */
  fill(layer: number): void {
    for (let vertex = 0; vertex < this.vertexCount; vertex += 1) this.paint(vertex, layer, 1);
  }

  dominant(vertex: number): number {
    const base = this.#base(vertex);
    let best = 0;
    for (let layer = 1; layer < this.layerCount; layer += 1) {
      if (this.weights[base + layer]! > this.weights[base + best]!) best = layer;
    }
    return best;
  }

  #base(vertex: number): number {
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= this.vertexCount) {
      throw new RangeError(`Splat vertex ${String(vertex)} is outside 0..${String(this.vertexCount - 1)}.`);
    }
    return vertex * this.layerCount;
  }

  #normalize(vertex: number): void {
    const base = vertex * this.layerCount;
    let total = 0;
    for (let layer = 0; layer < this.layerCount; layer += 1) total += this.weights[base + layer]!;
    if (total <= 0) {
      for (let layer = 0; layer < this.layerCount; layer += 1) this.weights[base + layer] = layer === 0 ? 1 : 0;
      return;
    }
    for (let layer = 0; layer < this.layerCount; layer += 1) this.weights[base + layer] = this.weights[base + layer]! / total;
  }
}

/** Neighbour sample strides on each edge. Zero means the neighbour is at this
 * chunk's resolution or finer, so the edge needs no collapsing. */
export interface TerrainSeamStrides {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

export const NO_TERRAIN_SEAMS: TerrainSeamStrides = { north: 0, south: 0, east: 0, west: 0 };

export interface TerrainChunkMeshOptions {
  /** Cells between sampled vertices. 1 is full resolution. */
  readonly step?: number;
  readonly seams?: TerrainSeamStrides;
  /** Depth of a downward apron around the chunk. Zero (the default) relies on
   * seam collapsing alone; a positive value also hides cracks from LOD schemes
   * this module did not choose. */
  readonly skirtDepth?: number;
}

export interface TerrainChunkBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

export interface TerrainChunkMesh extends MeshUpload {
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly colors: Float32Array;
  readonly textureLayers: Float32Array;
  /** Normalised layer weights, `layerCount` per vertex, in vertex order. */
  readonly splatWeights: Float32Array;
  readonly step: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/** One tile of the terrain grid. Vertices are in the same centred terrain-local
 * space `TerrainHeightfield.mesh()` uses, so a chunked terrain and a whole-mesh
 * terrain can be swapped without moving the entity. */
export class TerrainChunk {
  readonly x: number;
  readonly z: number;
  readonly startColumn: number;
  readonly startRow: number;
  readonly endColumn: number;
  readonly endRow: number;
  readonly bounds: TerrainChunkBounds;
  readonly #grid: TerrainChunkGrid;

  constructor(grid: TerrainChunkGrid, x: number, z: number) {
    const field = grid.heightfield;
    this.#grid = grid;
    this.x = x;
    this.z = z;
    this.startColumn = x * grid.chunkCells;
    this.startRow = z * grid.chunkCells;
    this.endColumn = Math.min(field.columns - 1, this.startColumn + grid.chunkCells);
    this.endRow = Math.min(field.rows - 1, this.startRow + grid.chunkCells);
    this.bounds = computeBounds(grid, this.startColumn, this.startRow, this.endColumn, this.endRow);
  }

  /** Cells along each axis. Edge chunks of a grid that does not divide evenly
   * are smaller rather than absent. */
  get cellsX(): number {
    return this.endColumn - this.startColumn;
  }

  get cellsZ(): number {
    return this.endRow - this.startRow;
  }

  /** This chunk's slice of the terrain splat map, `layerCount` weights per
   * vertex in row-major chunk-local order. */
  splatWeights(): Float32Array {
    const splat = this.#grid.splat;
    const columns = this.cellsX + 1;
    const rows = this.cellsZ + 1;
    const out = new Float32Array(columns * rows * splat.layerCount);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const source = splat.vertexIndex(this.startColumn + column, this.startRow + row) * splat.layerCount;
        out.set(splat.weights.subarray(source, source + splat.layerCount), (row * columns + column) * splat.layerCount);
      }
    }
    return out;
  }

  mesh(options: TerrainChunkMeshOptions = {}): TerrainChunkMesh {
    return buildChunkMesh(this.#grid, this, options);
  }
}

export interface TerrainChunkGridOptions {
  readonly heightfield: TerrainHeightfield;
  /** Cells along one chunk edge. Defaults to 32. */
  readonly chunkCells?: number;
  readonly material: TerrainMaterial;
  /** Existing weights to adopt. A fresh map starts entirely on layer 0. */
  readonly splat?: TerrainSplatMap;
}

/** A grid of terrain chunks sharing one heightfield, material, and splat map. */
export class TerrainChunkGrid {
  readonly heightfield: TerrainHeightfield;
  readonly chunkCells: number;
  readonly material: TerrainMaterial;
  readonly splat: TerrainSplatMap;
  readonly chunksX: number;
  readonly chunksZ: number;
  readonly #chunks: readonly TerrainChunk[];

  constructor(options: TerrainChunkGridOptions) {
    const field = options.heightfield;
    this.heightfield = field;
    this.chunkCells = options.chunkCells ?? 32;
    if (!Number.isInteger(this.chunkCells) || this.chunkCells < 1) throw new Error("Terrain chunkCells must be a positive integer.");
    this.material = options.material;
    this.splat = options.splat ?? new TerrainSplatMap(field.rows, field.columns, options.material.layerCount);
    if (this.splat.rows !== field.rows || this.splat.columns !== field.columns) {
      throw new Error("A terrain splat map must cover the heightfield's whole vertex grid.");
    }
    if (this.splat.layerCount !== this.material.layerCount) {
      throw new Error(`A terrain splat map with ${String(this.splat.layerCount)} layers cannot drive a ${String(this.material.layerCount)}-layer material.`);
    }
    this.chunksX = Math.ceil((field.columns - 1) / this.chunkCells);
    this.chunksZ = Math.ceil((field.rows - 1) / this.chunkCells);
    const chunks: TerrainChunk[] = [];
    for (let z = 0; z < this.chunksZ; z += 1) for (let x = 0; x < this.chunksX; x += 1) chunks.push(new TerrainChunk(this, x, z));
    this.#chunks = chunks;
  }

  get chunkCount(): number {
    return this.#chunks.length;
  }

  chunk(x: number, z: number): TerrainChunk {
    if (!Number.isInteger(x) || x < 0 || x >= this.chunksX || !Number.isInteger(z) || z < 0 || z >= this.chunksZ) {
      throw new RangeError(`Terrain chunk (${String(x)}, ${String(z)}) is outside a ${String(this.chunksX)}x${String(this.chunksZ)} grid.`);
    }
    return this.#chunks[z * this.chunksX + x]!;
  }

  chunks(): readonly TerrainChunk[] {
    return this.#chunks;
  }

  /** Sample stride for an LOD level, given this grid's chunk size. */
  stepFor(level: TerrainLodLevel): number {
    const step = this.chunkCells / (level.resolution - 1);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Terrain LOD resolution ${String(level.resolution)} does not divide ${String(this.chunkCells)} cells into whole steps.`);
    }
    return step;
  }

  /** Meshes one chunk at the level its ring selects, collapsing exactly the
   * edges `terrainSeams` reports as bordering a coarser neighbour. */
  chunkMesh(
    chunk: TerrainChunk,
    levels: readonly TerrainLodLevel[],
    viewerChunk: { readonly x: number; readonly z: number },
    options: Omit<TerrainChunkMeshOptions, "step" | "seams"> = {},
  ): TerrainChunkMesh {
    const ring = ringOf(chunk.x, chunk.z, viewerChunk);
    const step = this.stepFor(selectTerrainLod(levels, ring));
    const coarser = terrainSeams(levels, { x: chunk.x, z: chunk.z, ring }, viewerChunk);
    const strideAt = (x: number, z: number): number => this.stepFor(selectTerrainLod(levels, ringOf(x, z, viewerChunk)));
    const seams: TerrainSeamStrides = {
      north: coarser.north ? strideAt(chunk.x, chunk.z - 1) : 0,
      south: coarser.south ? strideAt(chunk.x, chunk.z + 1) : 0,
      east: coarser.east ? strideAt(chunk.x + 1, chunk.z) : 0,
      west: coarser.west ? strideAt(chunk.x - 1, chunk.z) : 0,
    };
    return chunk.mesh({ ...options, step, seams });
  }
}

function ringOf(x: number, z: number, viewer: { readonly x: number; readonly z: number }): number {
  return Math.max(Math.abs(x - viewer.x), Math.abs(z - viewer.z));
}

function computeBounds(grid: TerrainChunkGrid, startColumn: number, startRow: number, endColumn: number, endRow: number): TerrainChunkBounds {
  const field = grid.heightfield;
  const stepX = field.scale[0] / (field.columns - 1);
  const stepZ = field.scale[2] / (field.rows - 1);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const y = field.heights[row * field.columns + column]! * field.scale[1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const min: readonly [number, number, number] = [startColumn * stepX - field.scale[0] / 2, minY, startRow * stepZ - field.scale[2] / 2];
  const max: readonly [number, number, number] = [endColumn * stepX - field.scale[0] / 2, maxY, endRow * stepZ - field.scale[2] / 2];
  const center: readonly [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return { min, max, center, radius: Math.hypot(max[0] - center[0], max[1] - center[1], max[2] - center[2]) };
}

/** Sample coordinates from `start` through `end`, always including both ends. */
function samples(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let value = start; value < end; value += step) out.push(value);
  out.push(end);
  return out;
}

function buildChunkMesh(grid: TerrainChunkGrid, chunk: TerrainChunk, options: TerrainChunkMeshOptions): TerrainChunkMesh {
  const field = grid.heightfield;
  const step = options.step ?? 1;
  if (!Number.isInteger(step) || step < 1) throw new Error("A terrain chunk mesh step must be a positive integer.");
  const seams = options.seams ?? NO_TERRAIN_SEAMS;
  const skirtDepth = options.skirtDepth ?? 0;
  if (!(skirtDepth >= 0) || !Number.isFinite(skirtDepth)) throw new Error("A terrain skirt depth must be a finite, non-negative number.");

  const columns = samples(chunk.startColumn, chunk.endColumn, Math.min(step, chunk.cellsX));
  const rows = samples(chunk.startRow, chunk.endRow, Math.min(step, chunk.cellsZ));
  const stepX = field.scale[0] / (field.columns - 1);
  const stepZ = field.scale[2] / (field.rows - 1);
  const layerCount = grid.splat.layerCount;
  const vertexCount = columns.length * rows.length;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 4);
  const textureLayers = new Float32Array(vertexCount);
  const splatWeights = new Float32Array(vertexCount * layerCount);

  const rawHeight = (column: number, row: number): number => field.heights[row * field.columns + column]! * field.scale[1];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const column = columns[columnIndex]!;
      const row = rows[rowIndex]!;
      const vertex = rowIndex * columns.length + columnIndex;
      positions[vertex * 3] = column * stepX - field.scale[0] / 2;
      positions[vertex * 3 + 1] = seamHeight(field, chunk, seams, column, row, rawHeight);
      positions[vertex * 3 + 2] = row * stepZ - field.scale[2] / 2;

      const left = Math.max(0, column - 1);
      const right = Math.min(field.columns - 1, column + 1);
      const back = Math.max(0, row - 1);
      const front = Math.min(field.rows - 1, row + 1);
      const nx = -(rawHeight(right, row) - rawHeight(left, row)) / ((right - left) * stepX);
      const nz = -(rawHeight(column, front) - rawHeight(column, back)) / ((front - back) * stepZ);
      const length = Math.hypot(nx, 1, nz);
      normals[vertex * 3] = nx / length;
      normals[vertex * 3 + 1] = 1 / length;
      normals[vertex * 3 + 2] = nz / length;

      uvs[vertex * 2] = (column / (field.columns - 1)) * field.uvScale[0];
      uvs[vertex * 2 + 1] = (row / (field.rows - 1)) * field.uvScale[1];

      const splatVertex = grid.splat.vertexIndex(column, row);
      const base = splatVertex * layerCount;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let layer = 0; layer < layerCount; layer += 1) {
        const weight = grid.splat.weights[base + layer]!;
        splatWeights[vertex * layerCount + layer] = weight;
        const tint = grid.material.tint(layer);
        r += tint[0] * weight;
        g += tint[1] * weight;
        b += tint[2] * weight;
        a += tint[3] * weight;
      }
      colors.set([r, g, b, a], vertex * 4);
      textureLayers[vertex] = grid.material.textureLayer(grid.splat.dominant(splatVertex));
    }
  }

  const indices: number[] = [];
  for (let rowIndex = 0; rowIndex + 1 < rows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex + 1 < columns.length; columnIndex += 1) {
      const a = rowIndex * columns.length + columnIndex;
      const b = a + 1;
      const c = a + columns.length;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const grid2d = { columns: columns.length, rows: rows.length };
  const skirt = skirtDepth > 0
    ? buildSkirt(positions, normals, uvs, colors, textureLayers, splatWeights, layerCount, grid2d, skirtDepth, indices)
    : { positions, normals, uvs, colors, textureLayers, splatWeights };

  return {
    positions: skirt.positions,
    normals: skirt.normals,
    uvs: skirt.uvs,
    colors: skirt.colors,
    textureLayers: skirt.textureLayers,
    splatWeights: skirt.splatWeights,
    indices: Uint32Array.from(indices),
    step,
    vertexCount: skirt.positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

/** Height for a vertex, collapsed onto the coarser neighbour's samples when it
 * sits on a stitched edge. A collapsed edge vertex lies exactly on the segment
 * the neighbour draws, so the two chunks share their boundary geometry. */
function seamHeight(
  field: TerrainHeightfield,
  chunk: TerrainChunk,
  seams: TerrainSeamStrides,
  column: number,
  row: number,
  rawHeight: (column: number, row: number) => number,
): number {
  if (row === chunk.startRow && seams.north > 1) return collapse(column, chunk.startColumn, chunk.endColumn, seams.north, (value) => rawHeight(value, row));
  if (row === chunk.endRow && seams.south > 1) return collapse(column, chunk.startColumn, chunk.endColumn, seams.south, (value) => rawHeight(value, row));
  if (column === chunk.startColumn && seams.west > 1) return collapse(row, chunk.startRow, chunk.endRow, seams.west, (value) => rawHeight(column, value));
  if (column === chunk.endColumn && seams.east > 1) return collapse(row, chunk.startRow, chunk.endRow, seams.east, (value) => rawHeight(column, value));
  void field;
  return rawHeight(column, row);
}

function collapse(value: number, start: number, end: number, stride: number, sample: (value: number) => number): number {
  const low = Math.min(end, start + Math.floor((value - start) / stride) * stride);
  const high = Math.min(end, low + stride);
  if (high === low) return sample(low);
  const t = (value - low) / (high - low);
  return sample(low) * (1 - t) + sample(high) * t;
}

interface SkirtBuffers {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly colors: Float32Array;
  readonly textureLayers: Float32Array;
  readonly splatWeights: Float32Array;
}

/** Duplicates the border ring `depth` below the surface and bridges it, which
 * hides a crack of any size without needing to know the neighbour's stride. */
function buildSkirt(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  colors: Float32Array,
  textureLayers: Float32Array,
  splatWeights: Float32Array,
  layerCount: number,
  grid: { readonly columns: number; readonly rows: number },
  depth: number,
  indices: number[],
): SkirtBuffers {
  const border: number[] = [];
  for (let column = 0; column < grid.columns; column += 1) border.push(column);
  for (let row = 1; row < grid.rows; row += 1) border.push(row * grid.columns + grid.columns - 1);
  for (let column = grid.columns - 2; column >= 0; column -= 1) border.push((grid.rows - 1) * grid.columns + column);
  for (let row = grid.rows - 2; row >= 1; row -= 1) border.push(row * grid.columns);

  const total = positions.length / 3 + border.length;
  const out: SkirtBuffers = {
    positions: grow(positions, total * 3),
    normals: grow(normals, total * 3),
    uvs: grow(uvs, total * 2),
    colors: grow(colors, total * 4),
    textureLayers: grow(textureLayers, total),
    splatWeights: grow(splatWeights, total * layerCount),
  };
  const first = positions.length / 3;
  for (const [offset, source] of border.entries()) {
    const target = first + offset;
    out.positions.set([positions[source * 3]!, positions[source * 3 + 1]! - depth, positions[source * 3 + 2]!], target * 3);
    out.normals.set(normals.subarray(source * 3, source * 3 + 3), target * 3);
    out.uvs.set(uvs.subarray(source * 2, source * 2 + 2), target * 2);
    out.colors.set(colors.subarray(source * 4, source * 4 + 4), target * 4);
    out.textureLayers[target] = textureLayers[source]!;
    out.splatWeights.set(splatWeights.subarray(source * layerCount, source * layerCount + layerCount), target * layerCount);
  }
  for (let offset = 0; offset < border.length; offset += 1) {
    const nextOffset = (offset + 1) % border.length;
    const top = border[offset]!;
    const nextTop = border[nextOffset]!;
    indices.push(top, first + offset, nextTop, nextTop, first + offset, first + nextOffset);
  }
  return out;
}

function grow(source: Float32Array, length: number): Float32Array {
  const out = new Float32Array(length);
  out.set(source);
  return out;
}
