import { describe, expect, it } from "vitest";
import { bakeAssetNavMesh, colliderFromAsset, navMeshInputFromAssets, offMeshLinksFromAssets } from "./generated-assets.js";
/**
 * `@vapour/engine` cannot import `@vapour/assetgen`, so this fixture is built
 * by hand to the exact shape `compileBuilding` returns for a one-room hall
 * with a door in its north wall: `collision.kind: "mesh"` over the building
 * mesh, `navigation.walkable` = the floor slab's top face plus the doorstep
 * outside, and one `door` link crossing the wall.
 */
function boxMesh(center, half) {
    const [cx, cy, cz] = center;
    const [hx, hy, hz] = half;
    const positions = new Float32Array([
        cx - hx, cy - hy, cz - hz, cx + hx, cy - hy, cz - hz, cx + hx, cy + hy, cz - hz, cx - hx, cy + hy, cz - hz,
        cx - hx, cy - hy, cz + hz, cx + hx, cy - hy, cz + hz, cx + hx, cy + hy, cz + hz, cx - hx, cy + hy, cz + hz,
    ]);
    const indices = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
    return { positions, indices };
}
/** Two face-up triangles spanning `[x0, x1] x [z0, z1]` at height `y`. */
function quad(x0, z0, x1, z1, y = 0) {
    return { positions: new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]), indices: new Uint32Array([0, 2, 1, 0, 3, 2]) };
}
function concat(a, b) {
    const base = a.positions.length / 3;
    return {
        positions: new Float32Array([...a.positions, ...b.positions]),
        indices: new Uint32Array([...a.indices, ...Array.from(b.indices, (index) => index + base)]),
    };
}
const hall = {
    collision: { kind: "mesh", mesh: boxMesh([0, 1.35, 0], [4, 1.35, 3]) },
    navigation: {
        walkable: concat(quad(-4, -3, 4, 3), quad(-1.5, 3.2, 1.5, 7)),
        links: [{ from: [0, 0, 2.4], to: [0, 0, 3.6], kind: "door" }],
    },
};
describe("generated assets → physics and navigation (M123)", () => {
    it("turns each collision kind into the collider descriptor the physics bridge accepts", () => {
        const mesh = colliderFromAsset(hall);
        expect(mesh.type).toBe("triangleMesh");
        if (mesh.type !== "triangleMesh")
            throw new Error("unreachable");
        expect(mesh.vertices).toHaveLength(8);
        expect(mesh.indices).toHaveLength(12);
        expect(mesh.indices[0]).toEqual([0, 2, 1]);
        const convex = colliderFromAsset({ collision: { kind: "convex", mesh: boxMesh([0, 0, 0], [1, 1, 1]) } });
        expect(convex).toEqual({ type: "convexMesh", points: expect.arrayContaining([[1, 1, 1], [-1, -1, -1]]) });
        expect(convex.type === "convexMesh" && convex.points).toHaveLength(8);
        expect(colliderFromAsset({ collision: { kind: "box", box: { center: [0, 0, 0], halfExtents: [1, 2, 3] } } })).toEqual({ type: "box", halfExtents: [1, 2, 3] });
        expect(colliderFromAsset({ collision: { kind: "box", box: { center: [0, 1.35, 0], halfExtents: [4, 1.35, 3] } } })).toEqual({
            type: "compound",
            children: [{ position: [0, 1.35, 0], rotation: [0, 0, 0, 1], shape: { type: "box", halfExtents: [4, 1.35, 3] } }],
        });
        expect(() => colliderFromAsset({ collision: { kind: "mesh" } })).toThrow(/needs its mesh/);
    });
    it("bakes a navmesh from the walkable geometry and routes through the door link", () => {
        const { navmesh, unlinked } = bakeAssetNavMesh([{ asset: hall }], { cellSize: 0.25, agentRadius: 0.3 });
        expect(unlinked).toEqual([]);
        expect(navmesh.spanCount).toBeGreaterThan(0);
        expect(navmesh.stats().offMeshLinks).toBe(2); // bidirectional
        expect(navmesh.isWalkable([0, 0, 0])).toBe(true);
        expect(navmesh.isWalkable([0, 0, 5])).toBe(true);
        // The wall gap between floor and doorstep is only crossable via the link.
        const path = navmesh.findPath([-2, 0, 0], [0, 0, 6]);
        expect(path.status).toBe("complete");
        expect(path.points.length).toBeGreaterThan(1);
    });
    it("places several assets in the world by translating their geometry and links", () => {
        const placed = [{ asset: hall }, { asset: hall, position: [30, 0, 0] }];
        const input = navMeshInputFromAssets(placed);
        expect(input.indices).toHaveLength(2 * 12);
        expect(input.positions).toHaveLength(2 * 24);
        expect(Math.max(...input.positions.filter((_, index) => index % 3 === 0))).toBe(34);
        expect(offMeshLinksFromAssets(placed)[1]).toMatchObject({ from: [30, 0, 2.4], to: [30, 0, 3.6], kind: "door" });
        const { navmesh, unlinked } = bakeAssetNavMesh(placed, { cellSize: 0.25, agentRadius: 0.3 });
        expect(unlinked).toEqual([]);
        expect(navmesh.isWalkable([30, 0, 0])).toBe(true);
        expect(navmesh.findPath([28, 0, 0], [30, 0, 6]).status).toBe("complete");
        // The two halls are not connected: no geometry bridges them.
        expect(navmesh.findPath([0, 0, 0], [30, 0, 0]).status).not.toBe("complete");
    });
    it("reports a door onto nothing instead of silently dropping it", () => {
        const orphan = {
            collision: hall.collision,
            navigation: { walkable: quad(-4, -3, 4, 3), links: [{ from: [0, 0, 2.4], to: [0, 0, 40], kind: "door" }] },
        };
        const { unlinked } = bakeAssetNavMesh([{ asset: orphan }], { cellSize: 0.25 });
        expect(unlinked).toHaveLength(1);
    });
});
//# sourceMappingURL=generated-assets.test.js.map