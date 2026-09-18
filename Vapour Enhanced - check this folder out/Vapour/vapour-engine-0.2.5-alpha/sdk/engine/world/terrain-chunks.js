import { selectTerrainLod, terrainSeams } from "./large-world.js";
const WHITE = [1, 1, 1, 1];
/** A terrain surface described as an ordered stack of layers.
 *
 * The layer list is the contract shared by painting, meshing, and the material
 * upload: layer *index* is what a splat weight addresses, and the atlas cell is
 * derived from it, so a game cannot paint one layer and draw another. */
export class TerrainMaterial {
    layers;
    uvScale;
    #baseColorTexture;
    #normalTexture;
    #atlasInset;
    constructor(options) {
        if (options.layers.length === 0)
            throw new Error("A terrain material needs at least one layer.");
        for (const [index, layer] of options.layers.entries()) {
            if (layer.name.trim() === "")
                throw new Error(`Terrain layer ${String(index)} needs a name.`);
            if (layer.tint !== undefined && (layer.tint.length !== 4 || !layer.tint.every(Number.isFinite))) {
                throw new Error(`Terrain layer '${layer.name}' needs four finite tint channels.`);
            }
            const cell = layer.textureLayer ?? index;
            if (!Number.isInteger(cell) || cell < 0)
                throw new Error(`Terrain layer '${layer.name}' needs a non-negative integer textureLayer.`);
        }
        const uvScale = options.uvScale ?? [1, 1];
        if (uvScale.length !== 2 || !uvScale.every((value) => Number.isFinite(value) && value > 0)) {
            throw new Error("A terrain material UV scale needs two positive finite numbers.");
        }
        this.layers = options.layers.map((layer) => Object.freeze({ ...layer }));
        this.uvScale = [uvScale[0], uvScale[1]];
        this.#baseColorTexture = options.baseColorTexture;
        this.#normalTexture = options.normalTexture;
        this.#atlasInset = options.atlasInset ?? 0;
        if (!(this.#atlasInset >= 0) || this.#atlasInset >= 0.5)
            throw new Error("A terrain atlas inset must be in [0, 0.5).");
    }
    get layerCount() {
        return this.layers.length;
    }
    /** Index of a layer by name, for tools that paint by label. */
    indexOf(name) {
        const index = this.layers.findIndex((layer) => layer.name === name);
        if (index < 0)
            throw new Error(`Terrain material has no layer named '${name}'.`);
        return index;
    }
    tint(layer) {
        return this.#layer(layer).tint ?? WHITE;
    }
    /** Atlas cell a layer draws from, as written into `MeshUpload.textureLayers`. */
    textureLayer(layer) {
        return this.#layer(layer).textureLayer ?? layer;
    }
    atlas() {
        let columns = 1;
        for (let layer = 0; layer < this.layers.length; layer += 1)
            columns = Math.max(columns, this.textureLayer(layer) + 1);
        return { columns, rows: 1, inset: this.#atlasInset, origin: "bottom-left" };
    }
    /** The material the renderer draws every chunk with. One material for the
     * whole terrain keeps chunks in a single batch. */
    upload() {
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
    #layer(index) {
        const layer = this.layers[index];
        if (layer === undefined)
            throw new Error(`Terrain layer ${String(index)} is outside 0..${String(this.layers.length - 1)}.`);
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
    rows;
    columns;
    layerCount;
    weights;
    constructor(rows, columns, layerCount, weights) {
        if (!Number.isInteger(rows) || rows < 2 || !Number.isInteger(columns) || columns < 2) {
            throw new Error("A terrain splat map needs at least a 2x2 vertex grid.");
        }
        if (!Number.isInteger(layerCount) || layerCount < 1)
            throw new Error("A terrain splat map needs at least one layer.");
        const expected = rows * columns * layerCount;
        if (weights !== undefined && weights.length !== expected) {
            throw new Error(`A terrain splat map needs ${String(expected)} weights, received ${String(weights.length)}.`);
        }
        this.rows = rows;
        this.columns = columns;
        this.layerCount = layerCount;
        this.weights = weights?.slice() ?? new Float32Array(expected);
        if (weights === undefined)
            for (let vertex = 0; vertex < rows * columns; vertex += 1)
                this.weights[vertex * layerCount] = 1;
        else
            for (let vertex = 0; vertex < rows * columns; vertex += 1)
                this.#normalize(vertex);
    }
    get vertexCount() {
        return this.rows * this.columns;
    }
    vertexIndex(column, row) {
        if (!Number.isInteger(column) || column < 0 || column >= this.columns || !Number.isInteger(row) || row < 0 || row >= this.rows) {
            throw new RangeError(`Splat vertex (${String(column)}, ${String(row)}) is outside a ${String(this.columns)}x${String(this.rows)} grid.`);
        }
        return row * this.columns + column;
    }
    weightsAt(vertex) {
        const base = this.#base(vertex);
        return Array.from(this.weights.subarray(base, base + this.layerCount));
    }
    /** Replaces a vertex's weights, normalising them. */
    setWeights(vertex, weights) {
        if (weights.length !== this.layerCount)
            throw new Error(`A splat vertex needs ${String(this.layerCount)} weights, received ${String(weights.length)}.`);
        const base = this.#base(vertex);
        for (let layer = 0; layer < this.layerCount; layer += 1) {
            const value = weights[layer];
            if (!Number.isFinite(value) || value < 0)
                throw new Error("Splat weights must be finite and non-negative.");
            this.weights[base + layer] = value;
        }
        this.#normalize(vertex);
    }
    /** Pushes a vertex toward one layer by `amount` in [0, 1], renormalising the
     * rest. This is the operation a paint brush applies per vertex. */
    paint(vertex, layer, amount) {
        if (!Number.isInteger(layer) || layer < 0 || layer >= this.layerCount)
            throw new RangeError(`Splat layer ${String(layer)} is outside 0..${String(this.layerCount - 1)}.`);
        if (!Number.isFinite(amount))
            throw new Error("A splat paint amount must be finite.");
        const strength = Math.min(1, Math.max(0, amount));
        if (strength === 0)
            return;
        const base = this.#base(vertex);
        for (let index = 0; index < this.layerCount; index += 1) {
            const target = index === layer ? 1 : 0;
            this.weights[base + index] = this.weights[base + index] + (target - this.weights[base + index]) * strength;
        }
        this.#normalize(vertex);
    }
    /** Sets every vertex to a single layer. */
    fill(layer) {
        for (let vertex = 0; vertex < this.vertexCount; vertex += 1)
            this.paint(vertex, layer, 1);
    }
    dominant(vertex) {
        const base = this.#base(vertex);
        let best = 0;
        for (let layer = 1; layer < this.layerCount; layer += 1) {
            if (this.weights[base + layer] > this.weights[base + best])
                best = layer;
        }
        return best;
    }
    #base(vertex) {
        if (!Number.isInteger(vertex) || vertex < 0 || vertex >= this.vertexCount) {
            throw new RangeError(`Splat vertex ${String(vertex)} is outside 0..${String(this.vertexCount - 1)}.`);
        }
        return vertex * this.layerCount;
    }
    #normalize(vertex) {
        const base = vertex * this.layerCount;
        let total = 0;
        for (let layer = 0; layer < this.layerCount; layer += 1)
            total += this.weights[base + layer];
        if (total <= 0) {
            for (let layer = 0; layer < this.layerCount; layer += 1)
                this.weights[base + layer] = layer === 0 ? 1 : 0;
            return;
        }
        for (let layer = 0; layer < this.layerCount; layer += 1)
            this.weights[base + layer] = this.weights[base + layer] / total;
    }
}
export const NO_TERRAIN_SEAMS = { north: 0, south: 0, east: 0, west: 0 };
/** One tile of the terrain grid. Vertices are in the same centred terrain-local
 * space `TerrainHeightfield.mesh()` uses, so a chunked terrain and a whole-mesh
 * terrain can be swapped without moving the entity. */
export class TerrainChunk {
    x;
    z;
    startColumn;
    startRow;
    endColumn;
    endRow;
    bounds;
    #grid;
    constructor(grid, x, z) {
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
    get cellsX() {
        return this.endColumn - this.startColumn;
    }
    get cellsZ() {
        return this.endRow - this.startRow;
    }
    /** This chunk's slice of the terrain splat map, `layerCount` weights per
     * vertex in row-major chunk-local order. */
    splatWeights() {
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
    mesh(options = {}) {
        return buildChunkMesh(this.#grid, this, options);
    }
}
/** A grid of terrain chunks sharing one heightfield, material, and splat map. */
export class TerrainChunkGrid {
    heightfield;
    chunkCells;
    material;
    splat;
    chunksX;
    chunksZ;
    #chunks;
    constructor(options) {
        const field = options.heightfield;
        this.heightfield = field;
        this.chunkCells = options.chunkCells ?? 32;
        if (!Number.isInteger(this.chunkCells) || this.chunkCells < 1)
            throw new Error("Terrain chunkCells must be a positive integer.");
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
        const chunks = [];
        for (let z = 0; z < this.chunksZ; z += 1)
            for (let x = 0; x < this.chunksX; x += 1)
                chunks.push(new TerrainChunk(this, x, z));
        this.#chunks = chunks;
    }
    get chunkCount() {
        return this.#chunks.length;
    }
    chunk(x, z) {
        if (!Number.isInteger(x) || x < 0 || x >= this.chunksX || !Number.isInteger(z) || z < 0 || z >= this.chunksZ) {
            throw new RangeError(`Terrain chunk (${String(x)}, ${String(z)}) is outside a ${String(this.chunksX)}x${String(this.chunksZ)} grid.`);
        }
        return this.#chunks[z * this.chunksX + x];
    }
    chunks() {
        return this.#chunks;
    }
    /** Sample stride for an LOD level, given this grid's chunk size. */
    stepFor(level) {
        const step = this.chunkCells / (level.resolution - 1);
        if (!Number.isInteger(step) || step < 1) {
            throw new Error(`Terrain LOD resolution ${String(level.resolution)} does not divide ${String(this.chunkCells)} cells into whole steps.`);
        }
        return step;
    }
    /** Meshes one chunk at the level its ring selects, collapsing exactly the
     * edges `terrainSeams` reports as bordering a coarser neighbour. */
    chunkMesh(chunk, levels, viewerChunk, options = {}) {
        const ring = ringOf(chunk.x, chunk.z, viewerChunk);
        const step = this.stepFor(selectTerrainLod(levels, ring));
        const coarser = terrainSeams(levels, { x: chunk.x, z: chunk.z, ring }, viewerChunk);
        const strideAt = (x, z) => this.stepFor(selectTerrainLod(levels, ringOf(x, z, viewerChunk)));
        const seams = {
            north: coarser.north ? strideAt(chunk.x, chunk.z - 1) : 0,
            south: coarser.south ? strideAt(chunk.x, chunk.z + 1) : 0,
            east: coarser.east ? strideAt(chunk.x + 1, chunk.z) : 0,
            west: coarser.west ? strideAt(chunk.x - 1, chunk.z) : 0,
        };
        return chunk.mesh({ ...options, step, seams });
    }
}
function ringOf(x, z, viewer) {
    return Math.max(Math.abs(x - viewer.x), Math.abs(z - viewer.z));
}
function computeBounds(grid, startColumn, startRow, endColumn, endRow) {
    const field = grid.heightfield;
    const stepX = field.scale[0] / (field.columns - 1);
    const stepZ = field.scale[2] / (field.rows - 1);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let row = startRow; row <= endRow; row += 1) {
        for (let column = startColumn; column <= endColumn; column += 1) {
            const y = field.heights[row * field.columns + column] * field.scale[1];
            if (y < minY)
                minY = y;
            if (y > maxY)
                maxY = y;
        }
    }
    const min = [startColumn * stepX - field.scale[0] / 2, minY, startRow * stepZ - field.scale[2] / 2];
    const max = [endColumn * stepX - field.scale[0] / 2, maxY, endRow * stepZ - field.scale[2] / 2];
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    return { min, max, center, radius: Math.hypot(max[0] - center[0], max[1] - center[1], max[2] - center[2]) };
}
/** Sample coordinates from `start` through `end`, always including both ends. */
function samples(start, end, step) {
    const out = [];
    for (let value = start; value < end; value += step)
        out.push(value);
    out.push(end);
    return out;
}
function buildChunkMesh(grid, chunk, options) {
    const field = grid.heightfield;
    const step = options.step ?? 1;
    if (!Number.isInteger(step) || step < 1)
        throw new Error("A terrain chunk mesh step must be a positive integer.");
    const seams = options.seams ?? NO_TERRAIN_SEAMS;
    const skirtDepth = options.skirtDepth ?? 0;
    if (!(skirtDepth >= 0) || !Number.isFinite(skirtDepth))
        throw new Error("A terrain skirt depth must be a finite, non-negative number.");
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
    const rawHeight = (column, row) => field.heights[row * field.columns + column] * field.scale[1];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
            const column = columns[columnIndex];
            const row = rows[rowIndex];
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
                const weight = grid.splat.weights[base + layer];
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
    const indices = [];
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
function seamHeight(field, chunk, seams, column, row, rawHeight) {
    if (row === chunk.startRow && seams.north > 1)
        return collapse(column, chunk.startColumn, chunk.endColumn, seams.north, (value) => rawHeight(value, row));
    if (row === chunk.endRow && seams.south > 1)
        return collapse(column, chunk.startColumn, chunk.endColumn, seams.south, (value) => rawHeight(value, row));
    if (column === chunk.startColumn && seams.west > 1)
        return collapse(row, chunk.startRow, chunk.endRow, seams.west, (value) => rawHeight(column, value));
    if (column === chunk.endColumn && seams.east > 1)
        return collapse(row, chunk.startRow, chunk.endRow, seams.east, (value) => rawHeight(column, value));
    void field;
    return rawHeight(column, row);
}
function collapse(value, start, end, stride, sample) {
    const low = Math.min(end, start + Math.floor((value - start) / stride) * stride);
    const high = Math.min(end, low + stride);
    if (high === low)
        return sample(low);
    const t = (value - low) / (high - low);
    return sample(low) * (1 - t) + sample(high) * t;
}
/** Duplicates the border ring `depth` below the surface and bridges it, which
 * hides a crack of any size without needing to know the neighbour's stride. */
function buildSkirt(positions, normals, uvs, colors, textureLayers, splatWeights, layerCount, grid, depth, indices) {
    const border = [];
    for (let column = 0; column < grid.columns; column += 1)
        border.push(column);
    for (let row = 1; row < grid.rows; row += 1)
        border.push(row * grid.columns + grid.columns - 1);
    for (let column = grid.columns - 2; column >= 0; column -= 1)
        border.push((grid.rows - 1) * grid.columns + column);
    for (let row = grid.rows - 2; row >= 1; row -= 1)
        border.push(row * grid.columns);
    const total = positions.length / 3 + border.length;
    const out = {
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
        out.positions.set([positions[source * 3], positions[source * 3 + 1] - depth, positions[source * 3 + 2]], target * 3);
        out.normals.set(normals.subarray(source * 3, source * 3 + 3), target * 3);
        out.uvs.set(uvs.subarray(source * 2, source * 2 + 2), target * 2);
        out.colors.set(colors.subarray(source * 4, source * 4 + 4), target * 4);
        out.textureLayers[target] = textureLayers[source];
        out.splatWeights.set(splatWeights.subarray(source * layerCount, source * layerCount + layerCount), target * layerCount);
    }
    for (let offset = 0; offset < border.length; offset += 1) {
        const nextOffset = (offset + 1) % border.length;
        const top = border[offset];
        const nextTop = border[nextOffset];
        indices.push(top, first + offset, nextTop, nextTop, first + offset, first + nextOffset);
    }
    return out;
}
function grow(source, length) {
    const out = new Float32Array(length);
    out.set(source);
    return out;
}
//# sourceMappingURL=terrain-chunks.js.map