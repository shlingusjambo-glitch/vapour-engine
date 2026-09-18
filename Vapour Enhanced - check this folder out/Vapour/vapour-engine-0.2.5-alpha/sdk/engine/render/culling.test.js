import { describe, expect, it } from "vitest";
import { cameraFrustum, cameraSliceFrustum, cullInstances, cullRenderWorld, instanceBounds, } from "./culling.js";
import { LodRegistry, projectedScreenHeight, selectLodLevel, meshRadius, validateLodChain, } from "./lod.js";
/** Identity basis with a translation, matching the renderer's column-major layout. */
function at(x, y, z, scale = 1) {
    return [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, x, y, z, 1];
}
const camera = {
    entityId: "cam",
    worldMatrix: at(0, 0, 0),
    fieldOfView: 60,
    projection: "perspective",
    near: 0.1,
    far: 100,
};
function instance(id, position, mesh = "builtin:cube", scale = 1) {
    return {
        entityId: id,
        mesh,
        material: "m",
        modelMatrix: at(position[0], position[1], position[2], scale),
        baseColor: [1, 1, 1, 1],
        materialParams: [0, 1, 0, 0.01],
    };
}
describe("culling", () => {
    it("derives world bounds from the mesh library's picking extents", () => {
        const bounds = instanceBounds(instance("a", [10, 0, 0]));
        expect(bounds.min[0]).toBeLessThan(10);
        expect(bounds.max[0]).toBeGreaterThan(10);
        // A margin grows the box symmetrically.
        const padded = instanceBounds(instance("a", [10, 0, 0]), 1);
        expect(padded.min[0]).toBeCloseTo(bounds.min[0] - 1);
    });
    it("scales bounds with the instance's transform", () => {
        const small = instanceBounds(instance("a", [0, 0, 0], "builtin:cube", 1));
        const large = instanceBounds(instance("a", [0, 0, 0], "builtin:cube", 4));
        expect(large.max[0]).toBeCloseTo(small.max[0] * 4);
    });
    it("keeps what is in front of the camera and drops what is behind", () => {
        const frustum = cameraFrustum(camera, 16 / 9);
        const result = cullInstances([instance("front", [0, 0, -10]), instance("behind", [0, 0, 10])], frustum);
        expect(result.instances.map((value) => value.entityId)).toEqual(["front"]);
        expect(result.stats).toEqual({
            total: 2,
            visible: 1,
            culledByFrustum: 1,
            culledByDistance: 0,
        });
    });
    it("drops what is beyond the far plane and far off to the side", () => {
        const frustum = cameraFrustum(camera, 16 / 9);
        const result = cullInstances([instance("far", [0, 0, -500]), instance("side", [500, 0, -10])], frustum);
        expect(result.instances).toEqual([]);
        expect(result.stats.culledByFrustum).toBe(2);
    });
    it("applies a max distance before the frustum test", () => {
        const frustum = cameraFrustum(camera, 16 / 9);
        const result = cullInstances([instance("near", [0, 0, -5]), instance("mid", [0, 0, -50])], frustum, { camera, maxDistance: 20 });
        expect(result.instances.map((value) => value.entityId)).toEqual(["near"]);
        expect(result.stats).toMatchObject({
            culledByDistance: 1,
            culledByFrustum: 0,
        });
    });
    it("ignores max distance without a camera, since there is nothing to measure from", () => {
        const frustum = cameraFrustum(camera, 16 / 9);
        const result = cullInstances([instance("mid", [0, 0, -50])], frustum, {
            maxDistance: 1,
        });
        expect(result.stats.culledByDistance).toBe(0);
    });
    it("culls a whole render world against its own camera", () => {
        const world = {
            version: 1,
            camera,
            instances: [instance("a", [0, 0, -10]), instance("b", [0, 0, 40])],
        };
        const { world: culled, stats } = cullRenderWorld(world, 16 / 9);
        expect(culled.instances.map((value) => value.entityId)).toEqual(["a"]);
        expect(culled.camera).toBe(camera);
        expect(stats.visible).toBe(1);
    });
    it("passes a camera-less world through untouched rather than drawing nothing", () => {
        const world = {
            version: 1,
            instances: [instance("a", [0, 0, 900])],
        };
        const { world: result, stats } = cullRenderWorld(world, 1);
        expect(result).toBe(world);
        expect(stats).toEqual({
            total: 1,
            visible: 1,
            culledByFrustum: 0,
            culledByDistance: 0,
        });
    });
    it("builds a depth slice for shadow cascades", () => {
        const near = cameraSliceFrustum(camera, 1, 0.1, 10);
        const far = cameraSliceFrustum(camera, 1, 10, 100);
        const target = [instance("mid", [0, 0, -5])];
        expect(cullInstances(target, near).stats.visible).toBe(1);
        expect(cullInstances(target, far).stats.visible).toBe(0);
        expect(() => cameraSliceFrustum(camera, 1, 10, 5)).toThrow(/0 < near < far/);
    });
    it("validates its arguments", () => {
        const frustum = cameraFrustum(camera, 1);
        expect(() => cullInstances([], frustum, { boundsMargin: -1 })).toThrow(/must not be negative/);
        expect(() => cullInstances([], frustum, { maxDistance: 0 })).toThrow(/must be positive/);
        expect(() => cullRenderWorld({ version: 1, instances: [] }, 0)).toThrow(/positive aspect ratio/);
    });
});
describe("LOD", () => {
    const chain = {
        levels: [
            { mesh: "tree.high", minScreenHeight: 0.3 },
            { mesh: "tree.mid", minScreenHeight: 0.1 },
            { mesh: "tree.low", minScreenHeight: 0.02 },
        ],
        cullScreenHeight: 0.005,
    };
    it("validates level ordering and thresholds", () => {
        expect(() => validateLodChain({ levels: [] }, "x")).toThrow(/at least one level/);
        expect(() => validateLodChain({ levels: [{ mesh: " ", minScreenHeight: 1 }] }, "x")).toThrow(/requires a mesh id/);
        expect(() => validateLodChain({ levels: [{ mesh: "a", minScreenHeight: -1 }] }, "x")).toThrow(/non-negative minScreenHeight/);
        expect(() => validateLodChain({
            levels: [
                { mesh: "a", minScreenHeight: 0.1 },
                { mesh: "b", minScreenHeight: 0.5 },
            ],
        }, "x")).toThrow(/must descend/);
        expect(() => validateLodChain({
            levels: [{ mesh: "a", minScreenHeight: 0.1 }],
            cullScreenHeight: 0.5,
        }, "x")).toThrow(/must not exceed/);
    });
    it("shrinks with distance under perspective but not under orthographic", () => {
        const near = projectedScreenHeight(camera, 1, 5);
        const far = projectedScreenHeight(camera, 1, 50);
        expect(far).toBeLessThan(near);
        expect(far).toBeCloseTo(near / 10, 5);
        const ortho = {
            ...camera,
            projection: "orthographic",
            orthographicSize: 10,
        };
        expect(projectedScreenHeight(ortho, 1, 5)).toBe(projectedScreenHeight(ortho, 1, 500));
    });
    it("treats an object at the camera as maximally large so it cannot pop out", () => {
        expect(projectedScreenHeight(camera, 1, 0)).toBe(1);
        expect(projectedScreenHeight(camera, 0, 10)).toBe(0);
    });
    it("selects the level whose threshold the screen height clears", () => {
        expect(selectLodLevel(chain, 0.5)).toBe(0);
        expect(selectLodLevel(chain, 0.2)).toBe(1);
        expect(selectLodLevel(chain, 0.05)).toBe(2);
        // Below every threshold but above the cull height: coarsest level.
        expect(selectLodLevel(chain, 0.01)).toBe(2);
        expect(selectLodLevel(chain, 0.001)).toBeUndefined();
    });
    it("biases thresholds so quality settings shift every level at once", () => {
        expect(selectLodLevel(chain, 0.2, { bias: 2 })).toBe(0);
        expect(selectLodLevel(chain, 0.5, { bias: 0.25 })).toBe(1);
        expect(() => selectLodLevel(chain, 0.5, { bias: 0 })).toThrow(/bias must be positive/);
    });
    it("always draws when there is no cull height", () => {
        expect(selectLodLevel({ levels: chain.levels }, 0.0000001)).toBe(2);
    });
    it("rewrites instance meshes and counts what was drawn at each level", () => {
        const registry = new LodRegistry();
        registry.define("builtin:cube", chain);
        const result = registry.apply([
            instance("near", [0, 0, -1]),
            instance("mid", [0, 0, -12]),
            instance("far", [0, 0, -60]),
            instance("gone", [0, 0, -5000]),
        ], camera);
        expect(result.instances.map((value) => value.mesh)).toEqual([
            "tree.high",
            "tree.mid",
            "tree.low",
        ]);
        expect(result.stats).toMatchObject({ total: 4, drawn: 3, culled: 1 });
        expect(result.stats.perLevel).toEqual([1, 1, 1]);
    });
    it("passes meshes with no chain through untouched, counted at full detail", () => {
        const registry = new LodRegistry();
        const original = instance("a", [0, 0, -500]);
        const result = registry.apply([original], camera);
        expect(result.instances[0]).toBe(original);
        expect(result.stats.perLevel).toEqual([1]);
    });
    it("does not allocate when the selected mesh is already the instance's mesh", () => {
        const registry = new LodRegistry();
        registry.define("builtin:cube", {
            levels: [{ mesh: "builtin:cube", minScreenHeight: 0 }],
        });
        const original = instance("a", [0, 0, -5]);
        expect(registry.apply([original], camera).instances[0]).toBe(original);
    });
    it("grows an instance's radius with its scale, so a big object keeps detail longer", () => {
        const registry = new LodRegistry();
        registry.define("builtin:cube", chain);
        const small = registry.apply([instance("s", [0, 0, -40], "builtin:cube", 1)], camera);
        const large = registry.apply([instance("l", [0, 0, -40], "builtin:cube", 20)], camera);
        expect(large.instances[0].mesh).not.toBe(small.instances[0].mesh);
    });
    it("registers, reports, and validates chains", () => {
        const registry = new LodRegistry();
        registry.define("builtin:cube", chain);
        expect(registry.has("builtin:cube")).toBe(true);
        expect(registry.get("builtin:cube")).toEqual(chain);
        expect(registry.meshIds).toEqual(["builtin:cube"]);
        expect(() => registry.define(" ", chain)).toThrow(/non-empty mesh id/);
        expect(meshRadius("builtin:cube")).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=culling.test.js.map