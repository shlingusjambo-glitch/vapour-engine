/** Level of detail.
 *
 * An open world cannot draw its distant geometry at full density, and the
 * decision of *which* version to draw is a rendering concern rather than a
 * gameplay one — so it belongs in the engine, not in every game.
 *
 * Selection is by **projected screen height**, not raw distance. Distance
 * thresholds are the obvious approach and the wrong one: they have to be
 * retuned for every field of view and every resolution, and an object that
 * looks fine on a phone is a smear on a monitor. Screen height is the quantity
 * that actually determines whether detail is visible, so thresholds authored
 * once hold everywhere. A distance-based helper is provided for the cases where
 * a fixed range genuinely is what is wanted.
 */
import { pickingHalfExtents } from "../assets/mesh-library.js";
export function validateLodChain(chain, meshId) {
    if (chain.levels.length === 0)
        throw new Error(`LOD chain for "${meshId}" requires at least one level.`);
    let previous = Infinity;
    for (const [index, level] of chain.levels.entries()) {
        if (!level.mesh.trim())
            throw new Error(`LOD level ${index} for "${meshId}" requires a mesh id.`);
        if (!(level.minScreenHeight >= 0) ||
            !Number.isFinite(level.minScreenHeight)) {
            throw new Error(`LOD level ${index} for "${meshId}" requires a finite, non-negative minScreenHeight.`);
        }
        if (level.minScreenHeight > previous) {
            throw new Error(`LOD levels for "${meshId}" must be ordered from most to least detailed, so minScreenHeight must descend.`);
        }
        previous = level.minScreenHeight;
    }
    if (chain.cullScreenHeight !== undefined &&
        chain.cullScreenHeight > previous) {
        throw new Error(`LOD cullScreenHeight for "${meshId}" must not exceed the least detailed level's minScreenHeight.`);
    }
    return chain;
}
/**
 * Fraction of the viewport's height an object's bounding sphere covers.
 *
 * For a perspective camera this is `radius / (distance * tan(fov/2))`; for an
 * orthographic camera it is independent of distance, which is exactly the
 * behaviour an orthographic view should have.
 */
export function projectedScreenHeight(camera, worldRadius, distance) {
    if (worldRadius <= 0)
        return 0;
    if (camera.projection === "orthographic") {
        const size = camera.orthographicSize ?? 10;
        return size <= 0 ? 0 : (worldRadius * 2) / size;
    }
    // Behind or at the camera: treat as maximally large so nothing pops out at
    // the moment the player walks into it.
    if (distance <= 1e-4)
        return 1;
    const halfFov = ((camera.fieldOfView || 60) * Math.PI) / 360;
    const halfHeightAtDistance = Math.tan(halfFov) * distance;
    return halfHeightAtDistance <= 0 ? 1 : worldRadius / halfHeightAtDistance;
}
/** Index of the level to draw, or `undefined` when the object is too small. */
export function selectLodLevel(chain, screenHeight, options = {}) {
    const bias = options.bias ?? 1;
    if (!(bias > 0))
        throw new Error("An LOD bias must be positive.");
    const effective = screenHeight * bias;
    if (chain.cullScreenHeight !== undefined &&
        effective < chain.cullScreenHeight)
        return undefined;
    for (const [index, level] of chain.levels.entries()) {
        if (effective >= level.minScreenHeight)
            return index;
    }
    // Below every threshold but above the cull height: draw the coarsest level.
    return chain.levels.length - 1;
}
/** Bounding radius of a mesh, from the same extents culling and picking use. */
export function meshRadius(meshId) {
    const half = pickingHalfExtents(meshId);
    return Math.hypot(half[0], half[1], half[2]);
}
/** Largest scale factor in a model matrix's basis, so a scaled instance's
 * bounding radius grows with it. */
function maxScale(matrix) {
    const columns = [0, 1, 2].map((column) => Math.hypot(matrix[column * 4] ?? 0, matrix[column * 4 + 1] ?? 0, matrix[column * 4 + 2] ?? 0));
    return Math.max(columns[0], columns[1], columns[2]);
}
/**
 * A registry mapping a base mesh id to its LOD chain.
 *
 * Meshes with no chain are drawn as authored, so LOD is opt-in per asset and
 * adding it to one asset cannot change how any other renders.
 */
export class LodRegistry {
    #chains = new Map();
    define(meshId, chain) {
        const id = meshId.trim();
        if (!id)
            throw new Error("An LOD chain requires a non-empty mesh id.");
        this.#chains.set(id, validateLodChain(chain, id));
    }
    has(meshId) {
        return this.#chains.has(meshId);
    }
    get(meshId) {
        return this.#chains.get(meshId);
    }
    get meshIds() {
        return [...this.#chains.keys()].sort();
    }
    /**
     * Rewrites each instance to the mesh its LOD chain selects, dropping the ones
     * that are too small to be worth drawing.
     *
     * Instances whose mesh has no chain pass through untouched and are counted at
     * level 0, so `perLevel[0]` reads as "drawn at full detail" either way.
     */
    apply(instances, camera, options = {}) {
        const perLevel = [];
        const out = [];
        let culled = 0;
        for (const instance of instances) {
            const chain = this.#chains.get(instance.mesh);
            if (chain === undefined) {
                out.push(instance);
                perLevel[0] = (perLevel[0] ?? 0) + 1;
                continue;
            }
            const m = instance.modelMatrix;
            const c = camera.worldMatrix;
            const distance = Math.hypot((m[12] ?? 0) - (c[12] ?? 0), (m[13] ?? 0) - (c[13] ?? 0), (m[14] ?? 0) - (c[14] ?? 0));
            const radius = meshRadius(instance.mesh) * maxScale(m);
            const level = selectLodLevel(chain, projectedScreenHeight(camera, radius, distance), options);
            if (level === undefined) {
                culled += 1;
                continue;
            }
            const selected = chain.levels[level];
            perLevel[level] = (perLevel[level] ?? 0) + 1;
            // Keep the original instance object when the mesh is unchanged, so the
            // common "already at full detail" case allocates nothing.
            out.push(selected.mesh === instance.mesh
                ? instance
                : { ...instance, mesh: selected.mesh });
        }
        for (let index = 0; index < perLevel.length; index += 1)
            perLevel[index] ??= 0;
        return {
            instances: out,
            stats: { total: instances.length, drawn: out.length, culled, perLevel },
        };
    }
}
//# sourceMappingURL=lod.js.map