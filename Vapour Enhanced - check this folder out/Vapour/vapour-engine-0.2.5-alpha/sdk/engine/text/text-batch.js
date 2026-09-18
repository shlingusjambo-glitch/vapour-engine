/** Text batching, cached layout, and world/screen placement.
 *
 * `layoutText2D` builds one mesh per string. A HUD has dozens of strings and a
 * dialogue scene has more, and each as its own draw call is what makes text
 * the surprising line at the top of a frame profile. Every label sharing an
 * atlas can be one draw: the glyph quads are already in the same texture and
 * the same material, so all that is needed is to offset each label's vertices
 * to its position and concatenate.
 *
 * Caching sits in front of layout for the same reason: an unchanged label
 * costs a map lookup, not a mesh build. The cache reports hits and misses into
 * the engine's counter registry so the diagnostics overlay can show whether
 * text is actually being reused.
 *
 * Screen and world placement differ only in the transform applied to the
 * batched mesh — a screen batch is in pixels, a world batch is in
 * metres on a plane — so they share one batch type and differ in one matrix.
 */
import { compose, multiplyMat4, transformPoint } from "@vapour/math";
import { TextLayoutCache } from "./rich-text.js";
import { layoutText2D } from "./text-2d.js";
export const TEXT_COUNTERS = {
    cacheHits: "text.cacheHits",
    cacheMisses: "text.cacheMisses",
    cacheEntries: "text.cacheEntries",
    batches: "text.batches",
    batchedGlyphs: "text.batchedGlyphs",
};
/**
 * Lays out text through a cache, keyed on everything that changes the result.
 *
 * `bytes` is the glyph vertex data size, so the cache's byte total in the
 * overlay is an honest number rather than a count of entries.
 */
export class CachedTextLayout {
    #cache;
    #diagnostics;
    constructor(options = {}) {
        this.#cache = new TextLayoutCache(options.maxEntries ?? 256);
        this.#diagnostics = options.diagnostics;
    }
    layout(font, text, options) {
        const key = TextLayoutCache.key(text, { font: font.id, ...options });
        const cached = this.#cache.get(key);
        if (cached !== undefined) {
            this.#diagnostics?.add(TEXT_COUNTERS.cacheHits, 1);
            return cached;
        }
        const result = layoutText2D(font, text, options);
        this.#cache.set(key, result, result.mesh.positions.byteLength + (result.mesh.uvs?.byteLength ?? 0) + (result.mesh.colors?.byteLength ?? 0));
        this.#diagnostics?.add(TEXT_COUNTERS.cacheMisses, 1);
        this.#diagnostics?.set(TEXT_COUNTERS.cacheEntries, this.#cache.stats().entries);
        return result;
    }
    stats() {
        return this.#cache.stats();
    }
    clear() {
        this.#cache.clear();
        this.#diagnostics?.set(TEXT_COUNTERS.cacheEntries, 0);
    }
}
/**
 * Merges labels that share a material into one mesh per material.
 *
 * Labels are grouped by material rather than by font id because two fonts
 * packed into one atlas can and should share a draw. Draw order within a batch
 * is input order, which is what a caller laying out a HUD top-to-bottom wants.
 */
export function batchText(items, diagnostics) {
    const groups = new Map();
    for (const item of items) {
        const group = groups.get(item.layout.material);
        if (group)
            group.push(item);
        else
            groups.set(item.layout.material, [item]);
    }
    const batches = [];
    let glyphTotal = 0;
    for (const [material, group] of groups) {
        let vertexCount = 0;
        let indexCount = 0;
        for (const item of group) {
            vertexCount += item.layout.mesh.positions.length / 3;
            indexCount += item.layout.mesh.indices.length;
        }
        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);
        const uvs = new Float32Array(vertexCount * 2);
        const colors = new Float32Array(vertexCount * 4);
        const indices = new Uint32Array(indexCount);
        let vertexOffset = 0;
        let indexOffset = 0;
        let glyphCount = 0;
        for (const item of group) {
            const mesh = item.layout.mesh;
            const count = mesh.positions.length / 3;
            const scale = item.scale ?? 1;
            for (let vertex = 0; vertex < count; vertex += 1) {
                const source = vertex * 3;
                const target = (vertexOffset + vertex) * 3;
                positions[target] = mesh.positions[source] * scale + item.position[0];
                positions[target + 1] = mesh.positions[source + 1] * scale + item.position[1];
                positions[target + 2] = mesh.positions[source + 2] * scale;
            }
            if (mesh.normals)
                normals.set(mesh.normals, vertexOffset * 3);
            else
                for (let vertex = 0; vertex < count; vertex += 1)
                    normals[(vertexOffset + vertex) * 3 + 2] = 1;
            if (mesh.uvs)
                uvs.set(mesh.uvs, vertexOffset * 2);
            if (mesh.colors)
                colors.set(mesh.colors, vertexOffset * 4);
            else
                colors.fill(1, vertexOffset * 4, (vertexOffset + count) * 4);
            for (let index = 0; index < mesh.indices.length; index += 1)
                indices[indexOffset + index] = mesh.indices[index] + vertexOffset;
            vertexOffset += count;
            indexOffset += mesh.indices.length;
            glyphCount += item.layout.glyphCount;
        }
        glyphTotal += glyphCount;
        batches.push({ material, mesh: { positions, normals, uvs, colors, indices }, labelCount: group.length, glyphCount });
    }
    diagnostics?.set(TEXT_COUNTERS.batches, batches.length);
    diagnostics?.set(TEXT_COUNTERS.batchedGlyphs, glyphTotal);
    return batches;
}
/**
 * The transform placing a screen-space text batch.
 *
 * Batches are authored in layout pixels (baseline at 0, +Y up), the same
 * space as every other 2D mesh, so this matrix only has to translate by the
 * label's screen offset; scale stays 1 pixel per unit.
 */
export function screenTextTransform(x, y) {
    return compose([x, y, 0], [0, 0, 0, 1], [1, 1, 1]);
}
/**
 * The transform placing a world-space text batch on a plane.
 *
 * Text layout is in design pixels with the baseline at y = 0 and +Y up (lines
 * descend to negative Y); a world label needs metres, so the scale is
 * `1 / pixelsPerUnit`. The batch itself stays in pixels — the same cached
 * layout serves a HUD and a sign.
 */
export function worldTextTransform(position, rotation, pixelsPerUnit) {
    if (!(pixelsPerUnit > 0))
        throw new Error("World text pixelsPerUnit must be positive.");
    const unit = 1 / pixelsPerUnit;
    return compose(position, rotation, [unit, unit, unit]);
}
/** A batched text mesh's corners in world space, for culling or debug draw. */
export function textBatchBounds(batch, transform) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const positions = batch.mesh.positions;
    for (let index = 0; index < positions.length; index += 3) {
        const point = transformPoint(transform, [positions[index], positions[index + 1], positions[index + 2]]);
        for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], point[axis]);
            max[axis] = Math.max(max[axis], point[axis]);
        }
    }
    return { min, max };
}
/** Attaches a text batch to a parent transform (a name tag over a head, a dial on a dash). */
export function attachedTextTransform(parentWorld, local) {
    return multiplyMat4(parentWorld, local);
}
//# sourceMappingURL=text-batch.js.map