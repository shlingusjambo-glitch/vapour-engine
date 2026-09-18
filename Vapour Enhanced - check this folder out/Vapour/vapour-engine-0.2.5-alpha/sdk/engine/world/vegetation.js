/** Vegetation scatter: deterministic placement, instance batching, and
 * distance LOD to a billboard impostor.
 *
 * Placement runs once per prototype per chunk from a `SeededRandom` substream
 * keyed by chunk and prototype, so a client and a server (or two runs of the
 * same seed) scatter identical trees without replicating a single transform —
 * only the seed and the rules need to travel.
 *
 * Output is `RenderInstanceSnapshot`-shaped so it drops straight into the
 * renderer's existing instancing and LOD path (`LodRegistry.apply`,
 * `render-world.ts`) instead of inventing a second draw path for
 * procedurally-placed geometry. The mesh/impostor ids referenced here are
 * caller-registered mesh-library entries (e.g. `@vapour/assetgen`'s `nature.ts`
 * generators uploaded under an id, plus a flat quad registered as the impostor)
 * — this module places and batches instances; asset registration is the
 * integration point, documented in `docs/rendering-scale.md`.
 */
import { compose } from "@vapour/math";
import { LodRegistry } from "../render/lod.js";
import { SeededRandom } from "./procedural-noise.js";
/** Surface slope at a heightfield sample, in degrees from horizontal, from
 * the same central-difference normal the mesher uses. */
function slopeDegreesAt(field, localX, localZ) {
    const epsilon = Math.max(field.scale[0], field.scale[2]) / Math.max(field.columns, field.rows);
    const up = field.sampleHeight(localX, localZ);
    if (up === undefined)
        return 90;
    const east = field.sampleHeight(localX + epsilon, localZ) ?? up;
    const north = field.sampleHeight(localX, localZ + epsilon) ?? up;
    const slopeX = (east - up) / epsilon;
    const slopeZ = (north - up) / epsilon;
    const gradient = Math.hypot(slopeX, slopeZ);
    return (Math.atan(gradient) * 180) / Math.PI;
}
/**
 * Deterministically scatters vegetation instances over a heightfield's local
 * space (the same centred space `TerrainHeightfield.mesh()` uses).
 *
 * Each rule gets its own named substream (`fork(prototype.id)`), so adding or
 * removing one prototype does not reshuffle every other prototype's placement.
 */
export function scatterVegetation(field, options) {
    const root = new SeededRandom(options.seed);
    const instances = [];
    const area = field.scale[0] * field.scale[2];
    for (const rule of options.rules) {
        if (!(rule.density > 0))
            throw new Error(`Vegetation rule '${rule.prototype.id}' needs a positive density.`);
        const random = root.fork(rule.prototype.id);
        const attempts = Math.max(0, Math.round(area * rule.density));
        const minScale = rule.prototype.minScale ?? 1;
        const maxScale = rule.prototype.maxScale ?? minScale;
        if (!(maxScale >= minScale))
            throw new Error(`Vegetation prototype '${rule.prototype.id}' needs maxScale >= minScale.`);
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const localX = random.range(-field.scale[0] / 2, field.scale[0] / 2);
            const localZ = random.range(-field.scale[2] / 2, field.scale[2] / 2);
            const height = field.sampleHeight(localX, localZ);
            if (height === undefined)
                continue;
            if (rule.minHeight !== undefined && height < rule.minHeight)
                continue;
            if (rule.maxHeight !== undefined && height > rule.maxHeight)
                continue;
            if (rule.maxSlopeDegrees !== undefined && slopeDegreesAt(field, localX, localZ) > rule.maxSlopeDegrees)
                continue;
            instances.push({
                prototypeId: rule.prototype.id,
                position: [localX, height, localZ],
                rotationY: random.range(0, Math.PI * 2),
                scale: random.range(minScale, maxScale),
            });
        }
    }
    return instances;
}
/** Builds one `modelMatrix` from a scatter placement: translate, then a
 * Y-axis rotation (billboard-agnostic — an impostor quad still needs a
 * consistent yaw for shadow/wind consistency), then a uniform scale. */
function placementMatrix(instance) {
    const half = instance.rotationY / 2;
    return compose(instance.position, [0, Math.sin(half), 0, Math.cos(half)], [instance.scale, instance.scale, instance.scale]);
}
/**
 * Converts scattered placements into renderer-ready instances, one per
 * prototype's *full-detail* mesh. Pair with `vegetationLodRegistry` and
 * `LodRegistry.apply` to switch distant instances to their impostor.
 */
export function vegetationInstances(instances, prototypes) {
    const byId = new Map(prototypes.map((prototype) => [prototype.id, prototype]));
    return instances.map((instance, index) => {
        const prototype = byId.get(instance.prototypeId);
        if (prototype === undefined)
            throw new Error(`Vegetation instance references unknown prototype '${instance.prototypeId}'.`);
        return {
            entityId: `vegetation:${prototype.id}:${String(index)}`,
            mesh: prototype.meshId,
            material: prototype.material,
            modelMatrix: placementMatrix(instance),
            baseColor: prototype.baseColor ?? [1, 1, 1, 1],
            materialParams: [0, 1, 0, 0.5],
        };
    });
}
/** Builds an `LodRegistry` switching each prototype with an impostor to it
 * below `impostorScreenHeight`, and culling below `cullScreenHeight` when
 * given. Prototypes without an impostor are left undefined, which
 * `LodRegistry.apply` already draws untouched at full detail. */
export function vegetationLodRegistry(prototypes) {
    const registry = new LodRegistry();
    for (const prototype of prototypes) {
        if (prototype.impostorMeshId === undefined)
            continue;
        const chain = {
            levels: [
                { mesh: prototype.meshId, minScreenHeight: prototype.impostorScreenHeight ?? 0.05 },
                { mesh: prototype.impostorMeshId, minScreenHeight: 0 },
            ],
            ...(prototype.cullScreenHeight === undefined ? {} : { cullScreenHeight: prototype.cullScreenHeight }),
        };
        registry.define(prototype.meshId, chain);
    }
    return registry;
}
//# sourceMappingURL=vegetation.js.map