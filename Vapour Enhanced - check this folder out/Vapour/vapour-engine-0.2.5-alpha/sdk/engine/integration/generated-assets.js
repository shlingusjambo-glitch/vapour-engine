/** Generated assets → physics colliders and navmesh input, with no authoring.
 *
 * `@vapour/assetgen`'s `compileAsset`/`compileBuilding` already derive a
 * collision shape and, for buildings, walkable geometry plus doorway links.
 * What was missing is the last metre: turning those into the exact shapes
 * `PhysicsWorld3dBridge` and `bakeNavMesh` accept. That is all this does.
 *
 * - `box` collision becomes a `box` shape, wrapped in a one-child `compound`
 *   when the box is off-centre, since a body's shape has no offset of its own.
 * - `convex` becomes `convexMesh` from the hull's vertices.
 * - `mesh` becomes `triangleMesh`, one index triple per triangle.
 * - `navigation.walkable` is already `{ positions, indices }`, so it *is* a
 *   `NavMeshInput`; placing several assets in a world just concatenates them.
 * - `navigation.links` become off-mesh links, `door`/`passage`/`stairs`
 *   preserved as the link kind.
 *
 * The engine does not depend on `@vapour/assetgen`; {@link CompiledAssetLike}
 * names the fields of `CompiledAsset` this reads, structurally.
 */
import { bakeNavMesh } from "../ai/navmesh.js";
const ORIGIN = [0, 0, 0];
/** The collider descriptor `PhysicsBodyDescriptor3d.shape` wants for an asset. */
export function colliderFromAsset(asset) {
    const { collision } = asset;
    if (collision.kind === "box") {
        if (!collision.box)
            throw new Error("A box collision shape needs its box.");
        const box = { type: "box", halfExtents: collision.box.halfExtents };
        const [x, y, z] = collision.box.center;
        return x === 0 && y === 0 && z === 0 ? box : { type: "compound", children: [{ position: collision.box.center, rotation: [0, 0, 0, 1], shape: box }] };
    }
    if (!collision.mesh)
        throw new Error(`A ${collision.kind} collision shape needs its mesh.`);
    const points = vertices(collision.mesh);
    if (collision.kind === "convex")
        return { type: "convexMesh", points };
    const indices = [];
    for (let index = 0; index + 2 < collision.mesh.indices.length; index += 3) {
        indices.push([collision.mesh.indices[index], collision.mesh.indices[index + 1], collision.mesh.indices[index + 2]]);
    }
    return { type: "triangleMesh", vertices: points, indices };
}
/** Walkable triangles of every placed asset, translated into the world, as one bake input. */
export function navMeshInputFromAssets(placed) {
    let vertexCount = 0;
    let indexCount = 0;
    for (const { asset } of placed) {
        if (!asset.navigation)
            continue;
        vertexCount += asset.navigation.walkable.positions.length;
        indexCount += asset.navigation.walkable.indices.length;
    }
    const positions = new Float32Array(vertexCount);
    const indices = new Uint32Array(indexCount);
    let vertexOffset = 0;
    let indexOffset = 0;
    for (const { asset, position = ORIGIN } of placed) {
        if (!asset.navigation)
            continue;
        const { walkable } = asset.navigation;
        for (let index = 0; index < walkable.positions.length; index += 3) {
            positions[vertexOffset + index] = walkable.positions[index] + position[0];
            positions[vertexOffset + index + 1] = walkable.positions[index + 1] + position[1];
            positions[vertexOffset + index + 2] = walkable.positions[index + 2] + position[2];
        }
        const base = vertexOffset / 3;
        for (let index = 0; index < walkable.indices.length; index += 1)
            indices[indexOffset + index] = walkable.indices[index] + base;
        vertexOffset += walkable.positions.length;
        indexOffset += walkable.indices.length;
    }
    return { positions, indices };
}
/** Doorway and passage links of every placed asset, translated into the world. */
export function offMeshLinksFromAssets(placed) {
    const links = [];
    for (const { asset, position = ORIGIN } of placed) {
        for (const link of asset.navigation?.links ?? []) {
            links.push({ from: translate(link.from, position), to: translate(link.to, position), kind: link.kind });
        }
    }
    return links;
}
/** Bakes a navmesh over placed assets and wires their doorways. */
export function bakeAssetNavMesh(placed, settings = {}) {
    const navmesh = bakeNavMesh(navMeshInputFromAssets(placed), settings);
    const unlinked = offMeshLinksFromAssets(placed).filter((link) => !navmesh.addOffMeshLink(link));
    return { navmesh, unlinked };
}
function vertices(mesh) {
    const out = [];
    for (let index = 0; index + 2 < mesh.positions.length; index += 3)
        out.push([mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]]);
    return out;
}
function translate(point, by) {
    return [point[0] + by[0], point[1] + by[1], point[2] + by[2]];
}
//# sourceMappingURL=generated-assets.js.map