/** Box-projected decals.
 *
 * A decal is a unit cube placed by a world matrix; the renderer projects an
 * atlas region onto whatever opaque surface lies inside that box, along the
 * box's local -Z. `packDecals` produces the 28-float records the Rust decal
 * pass consumes (`DECAL_STRIDE` in `crates/vapour-render/src/surface/decal.rs`),
 * and `decalLocalUv` is the same projection on the CPU, for tools that need to
 * know what a decal covers without a GPU.
 */
import { invertAffine } from "./picking.js";
export const DECAL_STRIDE = 28;
export const MAX_DECALS = 4096;
/** Packs decals into the renderer's record layout. */
export function packDecals(decals, target = new Float32Array(decals.length * DECAL_STRIDE)) {
    if (decals.length > MAX_DECALS)
        throw new Error(`A frame may carry at most ${String(MAX_DECALS)} decals, received ${String(decals.length)}.`);
    if (target.length !== decals.length * DECAL_STRIDE)
        throw new Error(`A decal target needs ${String(decals.length * DECAL_STRIDE)} values.`);
    decals.forEach((decal, index) => {
        const offset = index * DECAL_STRIDE;
        if (decal.matrix.length !== 16)
            throw new Error(`Decal ${String(index)} needs a 16-value matrix.`);
        for (let element = 0; element < 16; element += 1) {
            const value = decal.matrix[element];
            if (!Number.isFinite(value))
                throw new Error(`Decal ${String(index)} matrix must be finite.`);
            target[offset + element] = value;
        }
        if (invertAffine(decal.matrix) === undefined)
            throw new Error(`Decal ${String(index)} matrix is singular; a decal box needs volume.`);
        const region = decal.region ?? [0, 0, 1, 1];
        for (const value of region)
            if (!Number.isFinite(value) || value < 0 || value > 1)
                throw new Error(`Decal ${String(index)} region must lie within [0, 1].`);
        target.set(region, offset + 16);
        const tint = decal.tint ?? [1, 1, 1, 1];
        for (const value of tint)
            if (!Number.isFinite(value) || value < 0)
                throw new Error(`Decal ${String(index)} tint must be non-negative.`);
        target.set(tint, offset + 20);
        const params = [
            decal.opacity ?? 1,
            decal.angleCutoff ?? 0.35,
            decal.angleSoftness ?? 0.2,
            decal.zFade ?? 0.25,
        ];
        for (const [name, value] of [
            ["opacity", params[0]],
            ["angleCutoff", params[1]],
            ["angleSoftness", params[2]],
            ["zFade", params[3]],
        ])
            if (!Number.isFinite(value) || value < 0 || value > 1)
                throw new Error(`Decal ${String(index)} ${name} must be in [0, 1].`);
        target.set(params, offset + 24);
    });
    return target;
}
/** Where `point` lands on a decal's projected image: `u`/`v` in [0, 1]
 * (`v` runs down, so an upright decal reads its atlas the right way up) and
 * the local depth in [-0.5, 0.5], or undefined when the point is outside the
 * box. Mirrors `decal_local_uv` in Rust and the projection in `decal.wgsl`. */
export function decalLocalUv(matrix, point) {
    const inverse = invertAffine(matrix);
    if (inverse === undefined)
        return undefined;
    const [x, y, z] = point;
    const localX = inverse[0] * x + inverse[4] * y + inverse[8] * z + inverse[12];
    const localY = inverse[1] * x + inverse[5] * y + inverse[9] * z + inverse[13];
    const localZ = inverse[2] * x + inverse[6] * y + inverse[10] * z + inverse[14];
    if (Math.abs(localX) > 0.5 || Math.abs(localY) > 0.5 || Math.abs(localZ) > 0.5)
        return undefined;
    return { u: localX + 0.5, v: 0.5 - localY, depth: localZ };
}
//# sourceMappingURL=decals.js.map