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
import { bakeNavMesh, type NavMesh, type NavMeshInput, type NavMeshSettings, type OffMeshLink } from "../ai/navmesh.js";
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
    readonly box?: { readonly center: readonly [number, number, number]; readonly halfExtents: readonly [number, number, number] };
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

const ORIGIN: readonly [number, number, number] = [0, 0, 0];

/** The collider descriptor `PhysicsBodyDescriptor3d.shape` wants for an asset. */
export function colliderFromAsset(asset: CompiledAssetLike): ColliderShape3d {
  const { collision } = asset;
  if (collision.kind === "box") {
    if (!collision.box) throw new Error("A box collision shape needs its box.");
    const box: ColliderShape3d = { type: "box", halfExtents: collision.box.halfExtents };
    const [x, y, z] = collision.box.center;
    return x === 0 && y === 0 && z === 0 ? box : { type: "compound", children: [{ position: collision.box.center, rotation: [0, 0, 0, 1], shape: box }] };
  }
  if (!collision.mesh) throw new Error(`A ${collision.kind} collision shape needs its mesh.`);
  const points = vertices(collision.mesh);
  if (collision.kind === "convex") return { type: "convexMesh", points };
  const indices: (readonly [number, number, number])[] = [];
  for (let index = 0; index + 2 < collision.mesh.indices.length; index += 3) {
    indices.push([collision.mesh.indices[index]!, collision.mesh.indices[index + 1]!, collision.mesh.indices[index + 2]!]);
  }
  return { type: "triangleMesh", vertices: points, indices };
}

/** Walkable triangles of every placed asset, translated into the world, as one bake input. */
export function navMeshInputFromAssets(placed: readonly PlacedAsset[]): NavMeshInput {
  let vertexCount = 0;
  let indexCount = 0;
  for (const { asset } of placed) {
    if (!asset.navigation) continue;
    vertexCount += asset.navigation.walkable.positions.length;
    indexCount += asset.navigation.walkable.indices.length;
  }
  const positions = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const { asset, position = ORIGIN } of placed) {
    if (!asset.navigation) continue;
    const { walkable } = asset.navigation;
    for (let index = 0; index < walkable.positions.length; index += 3) {
      positions[vertexOffset + index] = walkable.positions[index]! + position[0];
      positions[vertexOffset + index + 1] = walkable.positions[index + 1]! + position[1];
      positions[vertexOffset + index + 2] = walkable.positions[index + 2]! + position[2];
    }
    const base = vertexOffset / 3;
    for (let index = 0; index < walkable.indices.length; index += 1) indices[indexOffset + index] = walkable.indices[index]! + base;
    vertexOffset += walkable.positions.length;
    indexOffset += walkable.indices.length;
  }
  return { positions, indices };
}

/** Doorway and passage links of every placed asset, translated into the world. */
export function offMeshLinksFromAssets(placed: readonly PlacedAsset[]): OffMeshLink[] {
  const links: OffMeshLink[] = [];
  for (const { asset, position = ORIGIN } of placed) {
    for (const link of asset.navigation?.links ?? []) {
      links.push({ from: translate(link.from, position), to: translate(link.to, position), kind: link.kind });
    }
  }
  return links;
}

export interface AssetNavMeshBake {
  readonly navmesh: NavMesh;
  /** Links whose endpoints found no walkable span; a door onto nothing. */
  readonly unlinked: readonly OffMeshLink[];
}

/** Bakes a navmesh over placed assets and wires their doorways. */
export function bakeAssetNavMesh(placed: readonly PlacedAsset[], settings: NavMeshSettings = {}): AssetNavMeshBake {
  const navmesh = bakeNavMesh(navMeshInputFromAssets(placed), settings);
  const unlinked = offMeshLinksFromAssets(placed).filter((link) => !navmesh.addOffMeshLink(link));
  return { navmesh, unlinked };
}

function vertices(mesh: MeshLike): (readonly [number, number, number])[] {
  const out: (readonly [number, number, number])[] = [];
  for (let index = 0; index + 2 < mesh.positions.length; index += 3) out.push([mesh.positions[index]!, mesh.positions[index + 1]!, mesh.positions[index + 2]!]);
  return out;
}

function translate(point: readonly [number, number, number], by: readonly [number, number, number]): [number, number, number] {
  return [point[0] + by[0], point[1] + by[1], point[2] + by[2]];
}
