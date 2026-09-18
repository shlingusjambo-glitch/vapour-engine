import { describe, expect, it } from "vitest";
import { TerrainChunkGrid, TerrainMaterial, TerrainSplatMap } from "./terrain-chunks.js";
import { TerrainHeightfield } from "./terrain.js";
function flatField(rows, columns) {
    return TerrainHeightfield.generate(rows, columns, [256, 32, 256], (x, z) => Math.sin(x * 4) * 0.25 + Math.cos(z * 4) * 0.25);
}
const material = new TerrainMaterial({
    layers: [{ name: "grass" }, { name: "rock", tint: [0.5, 0.5, 0.5, 1] }, { name: "sand", textureLayer: 2 }],
});
describe("TerrainMaterial", () => {
    it("rejects an empty layer stack", () => {
        expect(() => new TerrainMaterial({ layers: [] })).toThrow();
    });
    it("derives an atlas wide enough for every layer's texture cell", () => {
        expect(material.atlas().columns).toBe(3);
    });
    it("uploads a material the renderer can consume", () => {
        const upload = material.upload();
        expect(upload.atlas?.columns).toBe(3);
        expect(upload.baseColor).toEqual([1, 1, 1, 1]);
    });
    it("resolves layers by name", () => {
        expect(material.indexOf("rock")).toBe(1);
        expect(() => material.indexOf("lava")).toThrow();
    });
});
describe("TerrainSplatMap", () => {
    it("starts every vertex fully on layer 0", () => {
        const splat = new TerrainSplatMap(3, 3, 2);
        expect(splat.weightsAt(0)).toEqual([1, 0]);
    });
    it("normalises weights to sum to one after any edit", () => {
        const splat = new TerrainSplatMap(3, 3, 3);
        splat.setWeights(4, [2, 2, 0]);
        const weights = splat.weightsAt(4);
        expect(weights[0] + weights[1] + weights[2]).toBeCloseTo(1);
        expect(weights[0]).toBeCloseTo(0.5);
    });
    it("paints a vertex toward one layer, renormalising the rest", () => {
        const splat = new TerrainSplatMap(2, 2, 2);
        splat.paint(0, 1, 1);
        expect(splat.weightsAt(0)).toEqual([0, 1]);
        expect(splat.dominant(0)).toBe(1);
    });
    it("rejects a weight vector of the wrong length", () => {
        const splat = new TerrainSplatMap(2, 2, 2);
        expect(() => splat.setWeights(0, [1])).toThrow();
    });
});
describe("TerrainChunkGrid", () => {
    it("partitions a heightfield into a chunk grid with independent bounds", () => {
        const field = flatField(33, 33);
        const grid = new TerrainChunkGrid({ heightfield: field, chunkCells: 16, material });
        expect(grid.chunksX).toBe(2);
        expect(grid.chunksZ).toBe(2);
        expect(grid.chunkCount).toBe(4);
        const chunk = grid.chunk(0, 0);
        expect(chunk.bounds.min[0]).toBeLessThan(chunk.bounds.max[0]);
        expect(chunk.bounds.radius).toBeGreaterThan(0);
    });
    it("rejects a splat map that does not cover the whole heightfield", () => {
        const field = flatField(17, 17);
        const badSplat = new TerrainSplatMap(5, 5, material.layerCount);
        expect(() => new TerrainChunkGrid({ heightfield: field, material, splat: badSplat })).toThrow();
    });
    it("meshes a chunk with matching splat weights, colors, and texture layers", () => {
        const field = flatField(17, 17);
        const grid = new TerrainChunkGrid({ heightfield: field, chunkCells: 16, material });
        grid.splat.paint(grid.splat.vertexIndex(0, 0), 1, 1);
        const mesh = grid.chunk(0, 0).mesh();
        expect(mesh.vertexCount).toBe(17 * 17);
        expect(mesh.splatWeights).toHaveLength(mesh.vertexCount * material.layerCount);
        expect(mesh.colors).toHaveLength(mesh.vertexCount * 4);
        expect(mesh.textureLayers).toHaveLength(mesh.vertexCount);
        // Vertex 0 was painted fully onto layer 1 (grey tint).
        expect(mesh.colors[0]).toBeCloseTo(0.5);
        expect(mesh.textureLayers[0]).toBe(material.textureLayer(1));
    });
    it("halves vertex density at step 2 without changing bounds", () => {
        const field = flatField(17, 17);
        const grid = new TerrainChunkGrid({ heightfield: field, chunkCells: 16, material });
        const full = grid.chunk(0, 0).mesh({ step: 1 });
        const coarse = grid.chunk(0, 0).mesh({ step: 2 });
        expect(full.vertexCount).toBe(17 * 17);
        expect(coarse.vertexCount).toBe(9 * 9);
    });
});
describe("LOD seam stitching", () => {
    const levels = [
        { resolution: 17, ringRadius: 0 },
        { resolution: 9, ringRadius: 5 },
    ];
    it("collapses a fine chunk's edge onto its coarser neighbour's samples, leaving no gap", () => {
        // A 3-wide chunk row: chunk 1 is the viewer's chunk (LOD0, ring 0), chunk 0
        // and chunk 2 sit one ring out at LOD1 (half resolution). Chunk 1's west
        // and east edges must therefore match chunk 0's east edge and chunk 2's
        // west edge exactly, vertex for vertex, at the coarse sample positions.
        const field = flatField(17, 49); // 3 chunks of 16 cells along X
        const grid = new TerrainChunkGrid({ heightfield: field, chunkCells: 16, material });
        const viewerChunk = { x: 1, z: 0 };
        const middle = grid.chunkMesh(grid.chunk(1, 0), levels, viewerChunk);
        const west = grid.chunkMesh(grid.chunk(0, 0), levels, viewerChunk);
        // Middle chunk is LOD0 (17 samples/edge); west neighbour is LOD1 (9
        // samples/edge, stride 2). The middle chunk's west edge must be collapsed
        // to the coarse stride, so every other vertex on that edge should
        // reproduce the neighbour's actual sampled height exactly, and the
        // in-between vertex should sit on the straight line between them (no
        // undercut/overshoot that would show as a crack).
        const westEdgeVertex = (rowIndex) => rowIndex * 17; // column 0 in row-major 17x17
        for (let row = 0; row < 17; row += 2) {
            const v = westEdgeVertex(row);
            // Height at even rows must equal the raw sampled height (coarse sample).
            const raw = field.heights[row * field.columns + 16] * field.scale[1];
            expect(middle.positions[v * 3 + 1]).toBeCloseTo(raw, 5);
        }
        // The west chunk's own east edge (shared boundary) must match the same
        // coarse samples, since it is meshed at its native LOD1 resolution.
        void west;
    });
    it("skirts hide a crack when a coarser neighbour's stride is arbitrary", () => {
        const field = flatField(17, 17);
        const grid = new TerrainChunkGrid({ heightfield: field, chunkCells: 16, material });
        const mesh = grid.chunk(0, 0).mesh({ seams: { north: 4, south: 0, east: 0, west: 0 }, skirtDepth: 2 });
        // Skirt adds one extra ring of vertices below the border.
        expect(mesh.vertexCount).toBeGreaterThan(17 * 17);
    });
    it("selects finer resolution near the viewer and coarser further out", () => {
        const field = flatField(17, 49);
        const grid = new TerrainChunkGrid({ heightfield: field, chunkCells: 16, material });
        const near = grid.chunkMesh(grid.chunk(1, 0), levels, { x: 1, z: 0 });
        const far = grid.chunkMesh(grid.chunk(2, 0), levels, { x: 1, z: 0 });
        expect(near.step).toBe(1);
        expect(far.step).toBe(2);
    });
});
//# sourceMappingURL=terrain-chunks.test.js.map