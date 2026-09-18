const MESHES = [
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
export function meshLibrary() {
    return MESHES;
}
export function meshDescriptor(id) {
    return MESHES.find((mesh) => mesh.id === id);
}
export function requireMesh(id) {
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
export function pickingHalfExtents(id) {
    const mesh = meshDescriptor(id);
    if (mesh === undefined)
        return [0.5, 0.5, 0.5];
    return mesh.halfExtents.map((extent) => Math.max(extent, 0.01));
}
//# sourceMappingURL=mesh-library.js.map