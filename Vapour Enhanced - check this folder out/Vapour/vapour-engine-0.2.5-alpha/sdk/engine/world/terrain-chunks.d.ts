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
import { type TerrainLodLevel } from "./large-world.js";
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
/** A terrain surface described as an ordered stack of layers.
 *
 * The layer list is the contract shared by painting, meshing, and the material
 * upload: layer *index* is what a splat weight addresses, and the atlas cell is
 * derived from it, so a game cannot paint one layer and draw another. */
export declare class TerrainMaterial {
    #private;
    readonly layers: readonly TerrainLayer[];
    readonly uvScale: readonly [number, number];
    constructor(options: TerrainMaterialOptions);
    get layerCount(): number;
    /** Index of a layer by name, for tools that paint by label. */
    indexOf(name: string): number;
    tint(layer: number): readonly [number, number, number, number];
    /** Atlas cell a layer draws from, as written into `MeshUpload.textureLayers`. */
    textureLayer(layer: number): number;
    atlas(): TextureAtlasLayout;
    /** The material the renderer draws every chunk with. One material for the
     * whole terrain keeps chunks in a single batch. */
    upload(): MaterialUpload;
}
/** Per-vertex layer weights over the heightfield's sample grid.
 *
 * Weights are stored for the whole terrain and sliced per chunk rather than
 * duplicated per chunk: a brush crossing a chunk border would otherwise have to
 * write two maps and keep them agreeing, which is exactly how splat seams
 * appear. Every mutation renormalises the vertex, so the invariant "weights sum
 * to one" holds after any sequence of edits. */
export declare class TerrainSplatMap {
    #private;
    readonly rows: number;
    readonly columns: number;
    readonly layerCount: number;
    readonly weights: Float32Array;
    constructor(rows: number, columns: number, layerCount: number, weights?: Float32Array);
    get vertexCount(): number;
    vertexIndex(column: number, row: number): number;
    weightsAt(vertex: number): readonly number[];
    /** Replaces a vertex's weights, normalising them. */
    setWeights(vertex: number, weights: readonly number[]): void;
    /** Pushes a vertex toward one layer by `amount` in [0, 1], renormalising the
     * rest. This is the operation a paint brush applies per vertex. */
    paint(vertex: number, layer: number, amount: number): void;
    /** Sets every vertex to a single layer. */
    fill(layer: number): void;
    dominant(vertex: number): number;
}
/** Neighbour sample strides on each edge. Zero means the neighbour is at this
 * chunk's resolution or finer, so the edge needs no collapsing. */
export interface TerrainSeamStrides {
    readonly north: number;
    readonly south: number;
    readonly east: number;
    readonly west: number;
}
export declare const NO_TERRAIN_SEAMS: TerrainSeamStrides;
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
export declare class TerrainChunk {
    #private;
    readonly x: number;
    readonly z: number;
    readonly startColumn: number;
    readonly startRow: number;
    readonly endColumn: number;
    readonly endRow: number;
    readonly bounds: TerrainChunkBounds;
    constructor(grid: TerrainChunkGrid, x: number, z: number);
    /** Cells along each axis. Edge chunks of a grid that does not divide evenly
     * are smaller rather than absent. */
    get cellsX(): number;
    get cellsZ(): number;
    /** This chunk's slice of the terrain splat map, `layerCount` weights per
     * vertex in row-major chunk-local order. */
    splatWeights(): Float32Array;
    mesh(options?: TerrainChunkMeshOptions): TerrainChunkMesh;
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
export declare class TerrainChunkGrid {
    #private;
    readonly heightfield: TerrainHeightfield;
    readonly chunkCells: number;
    readonly material: TerrainMaterial;
    readonly splat: TerrainSplatMap;
    readonly chunksX: number;
    readonly chunksZ: number;
    constructor(options: TerrainChunkGridOptions);
    get chunkCount(): number;
    chunk(x: number, z: number): TerrainChunk;
    chunks(): readonly TerrainChunk[];
    /** Sample stride for an LOD level, given this grid's chunk size. */
    stepFor(level: TerrainLodLevel): number;
    /** Meshes one chunk at the level its ring selects, collapsing exactly the
     * edges `terrainSeams` reports as bordering a coarser neighbour. */
    chunkMesh(chunk: TerrainChunk, levels: readonly TerrainLodLevel[], viewerChunk: {
        readonly x: number;
        readonly z: number;
    }, options?: Omit<TerrainChunkMeshOptions, "step" | "seams">): TerrainChunkMesh;
}
//# sourceMappingURL=terrain-chunks.d.ts.map