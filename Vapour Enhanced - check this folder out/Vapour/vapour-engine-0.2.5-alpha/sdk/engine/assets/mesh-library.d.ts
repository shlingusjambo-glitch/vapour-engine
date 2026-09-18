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
export declare const DEFAULT_MESH_ID = "builtin:cube";
export declare function meshLibrary(): readonly MeshDescriptor[];
export declare function meshDescriptor(id: string): MeshDescriptor | undefined;
export declare function requireMesh(id: string): MeshDescriptor;
/**
 * Half-extents to use when hit-testing or bounding an instance.
 *
 * A flat mesh gets a small thickness on its degenerate axis so a plane can
 * still be clicked in the viewport; a zero-thickness box would be unselectable
 * from any angle except exactly edge-on.
 */
export declare function pickingHalfExtents(id: string): [number, number, number];
//# sourceMappingURL=mesh-library.d.ts.map