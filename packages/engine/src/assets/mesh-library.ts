/**
 * The meshes a `vapour.MeshRenderer` can reference.
 *
 * Geometry itself is generated in Rust (`crates/vapour-render/src/mesh.rs`);
 * this table is the editor's copy of the facts it needs synchronously, without
 * a round trip into WebAssembly: what to list in the Mesh dropdown, how big
 * each primitive is for hit-testing and camera framing, and how many triangles
 * it costs.
 *
 * The Rust test `catalogue_matches_the_editor_mesh_library` fails if the two
 * tables disagree, so geometry cannot change here or there without the other
 * being updated to match.
 *
 * Every built-in fits inside the unit cube centred on the origin. A Transform
 * scale of 1 therefore means one world unit for every primitive, and swapping
 * a cube for a sphere never changes an object's footprint.
 */
export interface MeshDescriptor {
  /** Stable identifier stored in scene files. */
  readonly id: string;
  readonly label: string;
  /** Distance from the origin to the surface along each axis, before the
   * entity's own scale is applied. Zero on an axis the mesh is flat in. */
  readonly halfExtents: readonly [number, number, number];
  readonly triangles: number;
  readonly summary: string;
}

const MESHES: readonly MeshDescriptor[] = [
  {
    id: "builtin:cube",
    label: "Cube",
    halfExtents: [0.5, 0.5, 0.5],
    triangles: 12,
    summary: "A one-unit box with hard edges.",
  },
  {
    id: "builtin:sphere",
    label: "Sphere",
    halfExtents: [0.5, 0.5, 0.5],
    triangles: 720,
    summary: "A one-unit UV sphere.",
  },
  {
    id: "builtin:capsule",
    label: "Capsule",
    halfExtents: [0.25, 0.5, 0.25],
    triangles: 768,
    summary: "A one-unit capsule sized like a character controller.",
  },
  {
    id: "builtin:cylinder",
    label: "Cylinder",
    halfExtents: [0.5, 0.5, 0.5],
    triangles: 96,
    summary: "A one-unit cylinder with flat caps.",
  },
  {
    id: "builtin:cone",
    label: "Cone",
    halfExtents: [0.5, 0.5, 0.5],
    triangles: 48,
    summary: "A one-unit cone with its apex at +Y.",
  },
  {
    id: "builtin:plane",
    label: "Plane",
    halfExtents: [0.5, 0, 0.5],
    triangles: 2,
    summary: "A one-unit ground plane in XZ, facing +Y.",
  },
  {
    id: "builtin:quad",
    label: "Quad",
    halfExtents: [0.5, 0.5, 0],
    triangles: 2,
    summary: "A one-unit upright quad in XY, facing +Z.",
  },
];

export const DEFAULT_MESH_ID = "builtin:cube";

export function meshLibrary(): readonly MeshDescriptor[] {
  return MESHES;
}

export function meshDescriptor(id: string): MeshDescriptor | undefined {
  return MESHES.find((mesh) => mesh.id === id);
}

export function requireMesh(id: string): MeshDescriptor {
  const mesh = meshDescriptor(id);
  if (mesh === undefined) {
    throw new Error(`Unknown mesh '${id}'. Available meshes: ${MESHES.map((value) => value.id).join(", ")}.`);
  }
  return mesh;
}

/**
 * Half-extents to use when hit-testing or bounding an instance.
 *
 * A flat mesh gets a small thickness on its degenerate axis so a plane can
 * still be clicked in the viewport; a zero-thickness box would be unselectable
 * from any angle except exactly edge-on.
 */
export function pickingHalfExtents(id: string): [number, number, number] {
  const mesh = meshDescriptor(id);
  if (mesh === undefined) return [0.5, 0.5, 0.5];
  return mesh.halfExtents.map((extent) => Math.max(extent, 0.01)) as [number, number, number];
}
