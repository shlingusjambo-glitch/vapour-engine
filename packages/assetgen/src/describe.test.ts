import { describe, expect, it } from "vitest";
import {
  ASSET_DESCRIPTION_VERSION,
  AssetDescriptionError,
  buildAsset,
  parseAssetDescription,
  validateAssetDescription,
  type AssetDescription,
} from "./describe.js";
import { generateProp } from "./props.js";
import { meshStats } from "./mesh.js";

const crate: AssetDescription = {
  version: ASSET_DESCRIPTION_VERSION,
  id: "crate",
  root: { kind: "prop", spec: { kind: "crate", size: 1 } },
};

describe("asset description validation", () => {
  it("accepts a minimal document", () => {
    expect(validateAssetDescription(crate)).toEqual([]);
  });

  it("reports every problem at once rather than the first", () => {
    const issues = validateAssetDescription({
      id: "",
      root: { kind: "nope" },
      materials: "not-an-array",
    });
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain("missing-version");
    expect(codes).toContain("invalid-id");
    expect(codes).toContain("unknown-node");
    expect(codes).toContain("not-an-array");
    expect(issues.length).toBeGreaterThanOrEqual(4);
  });

  it("locates issues by path into the document", () => {
    const issues = validateAssetDescription({
      version: 1,
      id: "street",
      root: { kind: "group", children: [{ kind: "prop", spec: { kind: "crate" } }, { kind: "prop", spec: { kind: "spaceship" } }] },
    });
    expect(issues).toEqual([
      { path: "root.children[1].spec.kind", code: "unknown-kind", message: expect.stringContaining("Prop kinds are") },
    ]);
  });

  it("rejects a document written against a newer language version", () => {
    const issues = validateAssetDescription({ ...crate, version: ASSET_DESCRIPTION_VERSION + 1 });
    expect(issues[0]?.code).toBe("unsupported-version");
  });

  it("rejects a ref to a component that was never declared", () => {
    const issues = validateAssetDescription({ version: 1, id: "x", root: { kind: "ref", component: "tree" } });
    expect(issues[0]).toMatchObject({ path: "root.component", code: "unknown-component" });
  });

  it("throws with every issue attached", () => {
    expect(() => parseAssetDescription({ id: 4 })).toThrow(AssetDescriptionError);
    try {
      parseAssetDescription({ id: 4 });
    } catch (error) {
      expect((error as AssetDescriptionError).issues.length).toBeGreaterThan(1);
    }
  });
});

describe("building assets from a description", () => {
  it("produces the same geometry as calling the generator directly", () => {
    const built = buildAsset(crate);
    const direct = generateProp({ kind: "crate", size: 1 });
    expect(meshStats(built.compiled.mesh).triangles).toBe(meshStats(direct.mesh).triangles);
    expect(built.compiled.lods.levels.length).toBeGreaterThanOrEqual(1);
    expect(built.compiled.collision.kind).toBeTruthy();
  });

  it("is deterministic: the same document always compiles to the same mesh", () => {
    const a = buildAsset(crate).compiled.mesh.positions;
    const b = buildAsset(crate).compiled.mesh.positions;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("instantiates a component through ref and repeats a group", () => {
    const street: AssetDescription = {
      version: 1,
      id: "street",
      components: { crate: { kind: "prop", spec: { kind: "crate", size: 1 } } },
      root: { kind: "group", children: [{ kind: "ref", component: "crate" }], repeat: { count: 4, step: [2, 0, 0] } },
    };
    const one = buildAsset(crate);
    const four = buildAsset(street);
    expect(meshStats(four.compiled.mesh).triangles).toBe(meshStats(one.compiled.mesh).triangles * 4);
  });

  it("keeps navigation data when the root is a building", () => {
    const built = buildAsset({
      version: 1,
      id: "hut",
      root: {
        kind: "building",
        spec: {
          floors: [
            {
              level: 0,
              height: 3,
              walls: [{ start: [0, 0], end: [6, 0] }, { start: [6, 0], end: [6, 6] }, { start: [6, 6], end: [0, 6] }, { start: [0, 6], end: [0, 0] }],
              rooms: [{ name: "Hall", footprint: [[0.2, 0.2], [5.8, 0.2], [5.8, 5.8], [0.2, 5.8]] }],
            },
          ],
        },
      },
    });
    expect(built.building).toBeDefined();
    expect(built.compiled.navigation?.surfaces.length ?? 0).toBeGreaterThan(0);
  });

  it("bakes declared material graphs alongside the geometry", () => {
    const built = buildAsset({
      ...crate,
      materials: [{ id: "wood", resolution: 8, textures: { baseColor: { kind: "checker", colorA: [0.6, 0.4, 0.2, 1], colorB: [0.4, 0.25, 0.1, 1], scale: 4 } } }],
    });
    expect(built.materials).toHaveLength(1);
    expect(built.materials[0]?.textures[0]?.pixels.length).toBe(8 * 8 * 4);
  });
});
