/** One authoritative terrain surface for rendering, physics, grounding, and AI.
 * Coordinates are centered around the owning entity, matching Rapier's native
 * heightfield. Games no longer need a visual mesh plus box-collider proxies. */
export class TerrainHeightfield {
    rows;
    columns;
    heights;
    scale;
    uvScale;
    constructor(options) {
        integerAtLeast(options.rows, 2, "Terrain rows");
        integerAtLeast(options.columns, 2, "Terrain columns");
        vector3(options.scale, "Terrain scale");
        if (options.scale.some((value) => value <= 0))
            throw new Error("Terrain scale components must be positive.");
        const expected = options.rows * options.columns;
        if (options.heights.length !== expected)
            throw new Error(`Terrain requires ${String(expected)} row-major heights for ${String(options.rows)}x${String(options.columns)}, but received ${String(options.heights.length)}.`);
        if (!Array.from(options.heights).every(Number.isFinite))
            throw new Error("Terrain heights must be finite.");
        const uvScale = options.uvScale ?? [1, 1];
        vector2(uvScale, "Terrain UV scale");
        this.rows = options.rows;
        this.columns = options.columns;
        this.heights = Float32Array.from(options.heights);
        this.scale = [...options.scale];
        this.uvScale = [...uvScale];
    }
    /** Samples a height generator at normalized [0,1] grid coordinates. The
     * callback is deterministic and worker-safe when its inputs are. */
    static generate(rows, columns, scale, sampler, uvScale) {
        if (typeof sampler !== "function")
            throw new Error("Terrain sampler must be a function.");
        integerAtLeast(rows, 2, "Terrain rows");
        integerAtLeast(columns, 2, "Terrain columns");
        const heights = new Float32Array(rows * columns);
        for (let row = 0; row < rows; row += 1)
            for (let column = 0; column < columns; column += 1)
                heights[row * columns + column] = sampler(column / (columns - 1), row / (rows - 1), column, row);
        return new TerrainHeightfield({ rows, columns, scale, heights, ...(uvScale === undefined ? {} : { uvScale }) });
    }
    /** Bilinear local-space elevation. Returns undefined beyond the terrain. */
    sampleHeight(localX, localZ) {
        finite(localX, "Terrain sample X");
        finite(localZ, "Terrain sample Z");
        const u = localX / this.scale[0] + 0.5;
        const v = localZ / this.scale[2] + 0.5;
        if (u < 0 || u > 1 || v < 0 || v > 1)
            return undefined;
        const x = u * (this.columns - 1);
        const z = v * (this.rows - 1);
        const x0 = Math.floor(x);
        const z0 = Math.floor(z);
        const x1 = Math.min(this.columns - 1, x0 + 1);
        const z1 = Math.min(this.rows - 1, z0 + 1);
        const tx = x - x0;
        const tz = z - z0;
        const a = mix(this.height(x0, z0), this.height(x1, z0), tx);
        const b = mix(this.height(x0, z1), this.height(x1, z1), tx);
        return mix(a, b, tz) * this.scale[1];
    }
    /** Rapier-native collision descriptor using the exact same samples. */
    collider() { return { type: "heightfield", rows: this.rows, columns: this.columns, heights: Array.from(this.heights), scale: [...this.scale] }; }
    /** Indexed, smooth-normal render mesh matching `collider()` vertex-for-vertex. */
    mesh() {
        const count = this.rows * this.columns;
        const positions = new Float32Array(count * 3);
        const normals = new Float32Array(count * 3);
        const uvs = new Float32Array(count * 2);
        const indices = new Uint32Array((this.rows - 1) * (this.columns - 1) * 6);
        const stepX = this.scale[0] / (this.columns - 1);
        const stepZ = this.scale[2] / (this.rows - 1);
        for (let row = 0; row < this.rows; row += 1)
            for (let column = 0; column < this.columns; column += 1) {
                const vertex = row * this.columns + column;
                const x = column * stepX - this.scale[0] / 2;
                const z = row * stepZ - this.scale[2] / 2;
                positions.set([x, this.height(column, row) * this.scale[1], z], vertex * 3);
                const leftColumn = Math.max(0, column - 1);
                const rightColumn = Math.min(this.columns - 1, column + 1);
                const backRow = Math.max(0, row - 1);
                const frontRow = Math.min(this.rows - 1, row + 1);
                const left = this.height(leftColumn, row) * this.scale[1];
                const right = this.height(rightColumn, row) * this.scale[1];
                const back = this.height(column, backRow) * this.scale[1];
                const front = this.height(column, frontRow) * this.scale[1];
                const normal = normalize([-(right - left) / ((rightColumn - leftColumn) * stepX), 1, -(front - back) / ((frontRow - backRow) * stepZ)]);
                normals.set(normal, vertex * 3);
                uvs.set([column / (this.columns - 1) * this.uvScale[0], row / (this.rows - 1) * this.uvScale[1]], vertex * 2);
            }
        let offset = 0;
        for (let row = 0; row < this.rows - 1; row += 1)
            for (let column = 0; column < this.columns - 1; column += 1) {
                const a = row * this.columns + column;
                const b = a + 1;
                const c = a + this.columns;
                const d = c + 1;
                indices.set([a, c, b, b, c, d], offset);
                offset += 6;
            }
        return { positions, normals, uvs, indices };
    }
    height(column, row) { return this.heights[row * this.columns + column]; }
}
function normalize(value) { const length = Math.hypot(...value); return length <= Number.EPSILON ? [0, 1, 0] : [value[0] / length, value[1] / length, value[2] / length]; }
function mix(a, b, t) { return a + (b - a) * t; }
function finite(value, label) { if (!Number.isFinite(value))
    throw new Error(`${label} must be finite.`); }
function integerAtLeast(value, minimum, label) { if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${label} must be a safe integer of at least ${String(minimum)}.`); }
function vector2(value, label) { if (value.length !== 2 || !value.every(Number.isFinite))
    throw new Error(`${label} must contain two finite numbers.`); }
function vector3(value, label) { if (value.length !== 3 || !value.every(Number.isFinite))
    throw new Error(`${label} must contain three finite numbers.`); }
//# sourceMappingURL=terrain.js.map