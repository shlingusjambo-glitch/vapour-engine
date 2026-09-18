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
import { type NavMesh, type NavMeshInput, type NavMeshSettings, type OffMeshLink } from "../ai/navmesh.js";
import type { ColliderShape3d } from "../physics/physics-3d.js";
/** `MeshData` in `@vapour/assetgen`; the two fields every consumer here needs. */
export interface MeshLike {
    readonly positions: Float32Array;
    readonly indices: Uint32Array;
}
/** `CompiledAsset` in `@vapour/assetgen`, restricted to what the runtime consumes. */
export interface CompiledAssetLike {
    readonly collision: {
        readonly kind: "box" | "convex" | "mesh";
        readonly box?: {
            readonly center: readonly [number, number, number];
            readonly halfExtents: readonly [number, number, number];
        };
        readonly mesh?: MeshLike;
    };
    readonly navigation?: {
        readonly walkable: MeshLike;
        readonly links: readonly {
            readonly from: readonly [number, number, number];
            readonly to: readonly [number, number, number];
            readonly kind: string;
        }[];
    };
}
/** An asset placed in the world. Translation only; generated buildings are authored in world orientation. */
export interface PlacedAsset {
    readonly asset: CompiledAssetLike;
    readonly position?: readonly [number, number, number];
}
/** The collider descriptor `PhysicsBodyDescriptor3d.shape` wants for an asset. */
export declare function colliderFromAsset(asset: CompiledAssetLike): ColliderShape3d;
/** Walkable triangles of every placed asset, translated into the world, as one bake input. */
export declare function navMeshInputFromAssets(placed: readonly PlacedAsset[]): NavMeshInput;
/** Doorway and passage links of every placed asset, translated into the world. */
export declare function offMeshLinksFromAssets(placed: readonly PlacedAsset[]): OffMeshLink[];
export interface AssetNavMeshBake {
    readonly navmesh: NavMesh;
    /** Links whose endpoints found no walkable span; a door onto nothing. */
    readonly unlinked: readonly OffMeshLink[];
}
/** Bakes a navmesh over placed assets and wires their doorways. */
export declare function bakeAssetNavMesh(placed: readonly PlacedAsset[], settings?: NavMeshSettings): AssetNavMeshBake;
//# sourceMappingURL=generated-assets.d.ts.map