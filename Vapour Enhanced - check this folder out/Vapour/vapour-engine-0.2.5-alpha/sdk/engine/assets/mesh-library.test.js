import { describe, expect, it } from "vitest";
import { ComponentSchemaRegistry, builtinComponentSchemas, createComponentData } from "../core/component-schema.js";
import { DEFAULT_MESH_ID, meshDescriptor, meshLibrary, pickingHalfExtents, requireMesh } from "./mesh-library.js";
describe("mesh library", () => {
    it("gives every mesh a unique namespaced identifier", () => {
        const ids = meshLibrary().map((mesh) => mesh.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every((id) => id.startsWith("builtin:"))).toBe(true);
    });
    it("keeps every mesh inside the unit cube", () => {
        // The renderer's `every_builtin_fits_inside_the_unit_cube` asserts the same
        // invariant on the generated geometry; this is the editor's half.
        for (const mesh of meshLibrary()) {
            for (const extent of mesh.halfExtents) {
                expect(extent, mesh.id).toBeGreaterThanOrEqual(0);
                expect(extent, mesh.id).toBeLessThanOrEqual(0.5);
            }
            expect(Math.max(...mesh.halfExtents), mesh.id).toBe(0.5);
        }
    });
    it("reports a positive triangle budget for each mesh", () => {
        for (const mesh of meshLibrary()) {
            expect(mesh.triangles, mesh.id).toBeGreaterThanOrEqual(2);
            expect(Number.isInteger(mesh.triangles), mesh.id).toBe(true);
        }
    });
    it("looks meshes up by identifier and fails loudly on a typo", () => {
        expect(requireMesh(DEFAULT_MESH_ID).label).toBe("Cube");
        expect(meshDescriptor("builtin:teapot")).toBeUndefined();
        expect(() => requireMesh("builtin:teapot")).toThrow(/Unknown mesh/);
        // The error must list the alternatives so the fix is obvious.
        expect(() => requireMesh("builtin:teapot")).toThrow(/builtin:sphere/);
    });
    it("gives flat meshes a clickable thickness", () => {
        // A plane has zero half-extent in Y; a zero-thickness box would be
        // impossible to hit from anywhere but exactly edge-on.
        expect(requireMesh("builtin:plane").halfExtents[1]).toBe(0);
        expect(pickingHalfExtents("builtin:plane")[1]).toBeGreaterThan(0);
        expect(pickingHalfExtents("builtin:quad")[2]).toBeGreaterThan(0);
    });
    it("falls back to a unit box for an unknown mesh rather than throwing mid-frame", () => {
        // Picking runs every pointer move; a scene referencing a mesh from an
        // unloaded plugin must not break selection for everything else.
        expect(pickingHalfExtents("plugin:unknown")).toEqual([0.5, 0.5, 0.5]);
    });
    it("offers every mesh through the MeshRenderer inspector", () => {
        const schema = new ComponentSchemaRegistry(builtinComponentSchemas()).require("vapour.MeshRenderer");
        const field = schema.fields.find((candidate) => candidate.key === "mesh");
        expect(field?.kind).toBe("enum");
        const options = field?.kind === "enum" ? field.options.map((option) => option.value) : [];
        expect(options).toEqual(meshLibrary().map((mesh) => mesh.id));
        expect(createComponentData(schema).mesh).toBe(DEFAULT_MESH_ID);
    });
});
//# sourceMappingURL=mesh-library.test.js.map