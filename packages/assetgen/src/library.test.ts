import { describe, expect, it } from "vitest";
import {
  ASSET_LIBRARY_VERSION,
  buildFromLibrary,
  mergeLibraries,
  parseAssetLibrary,
  serializeAssetLibrary,
  validateAssetLibrary,
  type AssetLibrary,
} from "./library.js";
import { AssetDescriptionError, buildAsset, validateAssetDescription } from "./describe.js";
import { meshBounds } from "./transform.js";

const furniture: AssetLibrary = {
  version: ASSET_LIBRARY_VERSION,
  id: "furniture",
  description: "Street furniture",
  author: "assetgen",
  tags: ["street", "props"],
  components: {
    lamp: { kind: "prop", spec: { kind: "lamppost", size: 1 } },
    bench: { kind: "prop", spec: { kind: "bench", size: 1 } },
    pair: { kind: "group", children: [{ kind: "ref", component: "bench" }, { kind: "ref", component: "lamp", placement: { position: [2, 0, 0] } }] },
  },
  materials: [{ id: "iron", baseColor: [0.2, 0.2, 0.22, 1] }],
};

const greenery: AssetLibrary = {
  version: ASSET_LIBRARY_VERSION,
  id: "greenery",
  tags: ["street", "nature"],
  components: {
    oak: { kind: "tree", spec: { kind: "broadleaf", height: 5, seed: 3 } },
    bench: { kind: "prop", spec: { kind: "bench", size: 1.5 } },
  },
  materials: [{ id: "iron", baseColor: [0.5, 0.5, 0.5, 1] }, { id: "bark", baseColor: [0.3, 0.2, 0.1, 1] }],
};

describe("validateAssetLibrary", () => {
  it("accepts a complete library", () => {
    expect(validateAssetLibrary(furniture)).toEqual([]);
  });

  it("reports every issue with a path, including refs between components", () => {
    const issues = validateAssetLibrary(
      { id: "", tags: ["ok", 3], author: 4, components: { a: { kind: "ref", component: "b" }, c: { kind: "prop", spec: { kind: "moon" } } }, materials: [{ id: "" }] },
      "libraries[0]",
    );
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ["libraries[0].version", "missing-version"],
      ["libraries[0].id", "invalid-id"],
      ["libraries[0].author", "invalid-type"],
      ["libraries[0].tags", "invalid-type"],
      ["libraries[0].components.a.component", "unknown-component"],
      ["libraries[0].components.c.spec.kind", "unknown-kind"],
      ["libraries[0].materials[0].id", "invalid-id"],
    ]);
    expect(validateAssetLibrary({ version: 1, id: "x" })[0]).toMatchObject({ path: "components", code: "missing-field" });
    expect(validateAssetLibrary("nope")[0]?.code).toBe("not-an-object");
  });
});

describe("serialize and parse", () => {
  it("round-trips byte-identically", () => {
    const text = serializeAssetLibrary(furniture);
    const parsed = parseAssetLibrary(text);
    expect(parsed).toEqual(furniture);
    expect(serializeAssetLibrary(parsed)).toBe(text);
    expect(parseAssetLibrary(JSON.parse(text))).toEqual(furniture);
  });

  it("rejects bad JSON and invalid libraries with structured issues", () => {
    expect(() => parseAssetLibrary("{")).toThrow(AssetDescriptionError);
    try {
      parseAssetLibrary({ version: 99, id: "x", components: {} });
      expect.unreachable();
    } catch (error) {
      expect((error as AssetDescriptionError).issues[0]).toMatchObject({ path: "version", code: "unsupported-version" });
    }
    expect(() => serializeAssetLibrary({ ...furniture, id: "" })).toThrow(AssetDescriptionError);
  });
});

describe("mergeLibraries", () => {
  it("errors on every collision, naming each path", () => {
    try {
      mergeLibraries(furniture, greenery);
      expect.unreachable();
    } catch (error) {
      expect((error as AssetDescriptionError).issues).toEqual([
        { path: "components.bench", code: "component-collision", message: expect.stringContaining("bench") },
        { path: "materials.iron", code: "material-collision", message: expect.stringContaining("iron") },
      ]);
    }
  });

  it("prefers left or right as asked and unions the metadata", () => {
    const left = mergeLibraries(furniture, greenery, "prefer-left");
    expect(left.components["bench"]).toBe(furniture.components["bench"]);
    expect(left.materials?.find((graph) => graph.id === "iron")?.baseColor).toEqual([0.2, 0.2, 0.22, 1]);
    const right = mergeLibraries(furniture, greenery, "prefer-right", "street-kit");
    expect(right.id).toBe("street-kit");
    expect(right.components["bench"]).toBe(greenery.components["bench"]);
    expect(right.materials?.map((graph) => graph.id)).toEqual(["iron", "bark"]);
    expect(right.materials?.[0]?.baseColor).toEqual([0.5, 0.5, 0.5, 1]);
    expect(right.tags).toEqual(["street", "props", "nature"]);
    expect(Object.keys(right.components)).toEqual(["lamp", "bench", "pair", "oak"]);
    expect(validateAssetLibrary(right)).toEqual([]);
  });

  it("resolves a ref into a merged library", () => {
    const merged = mergeLibraries(furniture, greenery, "prefer-right");
    const built = buildFromLibrary(merged, "pair", { compile: { lodLevels: 1 } });
    expect(built.id).toBe("furniture+greenery/pair");
    const bounds = meshBounds(built.compiled.mesh);
    // The right-hand bench is 1.5 m scale: 2.4 m wide, and the lamp is 2 m over.
    expect(bounds.min[0]).toBeCloseTo(-1.2, 1);
    expect(bounds.max[1]).toBeCloseTo(4, 1);
    expect(built.materials.map((material) => material.id)).toEqual(["iron", "bark"]);
  });

  it("rejects an unknown root component", () => {
    expect(() => buildFromLibrary(furniture, "fountain")).toThrow(/No component named "fountain"/);
  });
});

describe("libraries inside a description", () => {
  it("makes library components and materials available to the document", () => {
    const built = buildAsset({
      version: 1,
      id: "avenue",
      libraries: [furniture],
      components: { row: { kind: "group", children: [{ kind: "ref", component: "lamp" }], repeat: { count: 3, step: [5, 0, 0] } } },
      root: { kind: "ref", component: "row" },
    });
    expect(meshBounds(built.compiled.mesh).max[0]).toBeCloseTo(10.8, 1);
    expect(built.materials.map((material) => material.id)).toEqual(["iron"]);
  });

  it("reports collisions between libraries and with the document", () => {
    const issues = validateAssetDescription({
      version: 1,
      id: "x",
      libraries: [furniture, greenery, { version: 1, id: "" }],
      components: { lamp: { kind: "prop", spec: { kind: "crate" } } },
      root: { kind: "ref", component: "oak" },
    });
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ["libraries[1].components.bench", "component-collision"],
      ["libraries[2].id", "invalid-id"],
      ["libraries[2].components", "missing-field"],
      ["components.lamp", "component-collision"],
    ]);
  });
});
