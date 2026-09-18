import { describe, expect, it } from "vitest";
import {
  TEXTURE_NODE_KINDS,
  generateMaterial,
  renderTexture,
  sampleTextureNode,
  validateMaterialGraph,
  type MaterialDefinition,
  type MaterialGraph,
  type TextureNode,
} from "./material.js";

/** The engine's own upload validators, loaded at runtime so this package keeps
 * its "no dependency on @vapour/engine" rule while still proving the shape. */
async function engineUploads(): Promise<{
  validateTextureUpload: (id: string, texture: unknown) => void;
  validateMaterialUpload: (id: string, material: unknown, hasTexture: (id: string) => boolean) => void;
  source: string;
}> {
  const url = new URL("../../engine/src/render/host/uploads.ts", import.meta.url);
  const module = (await import(/* @vite-ignore */ url.href)) as {
    validateTextureUpload: (id: string, texture: unknown) => void;
    validateMaterialUpload: (id: string, material: unknown, hasTexture: (id: string) => boolean) => void;
  };
  const fs = (await import(/* @vite-ignore */ "node:fs")) as { readFileSync: (path: URL, encoding: string) => string };
  return { ...module, source: fs.readFileSync(url, "utf8") };
}

const ramp: TextureNode = { kind: "gradient", axis: "x", stops: [{ at: 0, color: [0, 0, 0, 1] }, { at: 1, color: [1, 1, 1, 1] }] };

const everyKind: Record<(typeof TEXTURE_NODE_KINDS)[number], TextureNode> = {
  constant: { kind: "constant", color: [0.2, 0.4, 0.6, 1] },
  checker: { kind: "checker", columns: 4, rows: 4 },
  gradient: ramp,
  noise: { kind: "noise", scale: 4, octaves: 2, seed: 9 },
  bricks: { kind: "bricks", columns: 4, rows: 8 },
  mix: { kind: "mix", a: { kind: "constant", color: [1, 0, 0, 1] }, b: { kind: "constant", color: [0, 0, 1, 1] }, factor: ramp },
  multiply: { kind: "multiply", a: ramp, b: { kind: "constant", color: [0.5, 0.5, 0.5, 1] } },
  adjust: { kind: "adjust", input: ramp, brightness: 0.8, contrast: 1.2, saturation: 0.5 },
  normalMap: { kind: "normalMap", height: { kind: "noise", scale: 3 }, strength: 4 },
  shapes: {
    kind: "shapes",
    background: [0, 0, 0, 0],
    shapes: [{ rect: [0.1, 0.1, 0.8, 0.8], radius: 0.2, color: [1, 0, 0, 1] }, { ellipse: [0.5, 0.5, 0.2, 0.1], color: [0, 1, 0, 1] }],
  },
};

describe("sampleTextureNode", () => {
  it.each(TEXTURE_NODE_KINDS)("samples a %s node deterministically within [0, 1]", (kind) => {
    const node = everyKind[kind];
    const samples = [0.1, 0.37, 0.5, 0.83].map((u) => sampleTextureNode(node, u, 1 - u, 3));
    expect([0.1, 0.37, 0.5, 0.83].map((u) => sampleTextureNode(node, u, 1 - u, 3))).toEqual(samples);
    for (const sample of samples) {
      expect(sample).toHaveLength(4);
      for (const channel of sample) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps a constant constant and a checker alternating", () => {
    expect(sampleTextureNode(everyKind.constant, 0.9, 0.1)).toEqual([0.2, 0.4, 0.6, 1]);
    const a = sampleTextureNode(everyKind.checker, 0.1, 0.1);
    const b = sampleTextureNode(everyKind.checker, 0.3, 0.1);
    expect(a).not.toEqual(b);
    expect(sampleTextureNode(everyKind.checker, 0.6, 0.1)).toEqual(a);
  });

  it("interpolates gradient stops and mixes by a node factor", () => {
    expect(sampleTextureNode(ramp, 0.25, 0)[0]).toBeCloseTo(0.25);
    // factor = ramp's red channel, so mix goes red -> blue across u.
    expect(sampleTextureNode(everyKind.mix, 0, 0)[0]).toBeCloseTo(1);
    expect(sampleTextureNode(everyKind.mix, 1, 0)[2]).toBeCloseTo(1);
  });

  it("gives noise a different field per seed and the same field per seed", () => {
    const node: TextureNode = { kind: "noise", scale: 6 };
    const a = sampleTextureNode(node, 0.3, 0.7, 1);
    expect(sampleTextureNode(node, 0.3, 0.7, 1)).toEqual(a);
    expect(sampleTextureNode(node, 0.3, 0.7, 2)).not.toEqual(a);
  });

  it("paints shapes in order, with rounded corners and ellipses", () => {
    const node = everyKind.shapes;
    expect(sampleTextureNode(node, 0.02, 0.02)).toEqual([0, 0, 0, 0]);
    expect(sampleTextureNode(node, 0.11, 0.11)).toEqual([0, 0, 0, 0]); // rounded away
    expect(sampleTextureNode(node, 0.5, 0.11)).toEqual([1, 0, 0, 1]);
    expect(sampleTextureNode(node, 0.5, 0.5)).toEqual([0, 1, 0, 1]); // ellipse on top
    expect(sampleTextureNode(node, 0.5, 0.62)).toEqual([1, 0, 0, 1]); // outside ry = 0.1
    expect(sampleTextureNode({ kind: "shapes", shapes: [{ rect: [0, 0, 1, 1], color: [1, 1, 1, 1] }] }, 0.001, 0.999)).toEqual([1, 1, 1, 1]);
  });

  it("derives a flat normal from a flat height and a tilted one from a slope", () => {
    const flat = sampleTextureNode({ kind: "normalMap", height: { kind: "constant", color: [0.5, 0.5, 0.5, 1] } }, 0.4, 0.4);
    expect(flat[0]).toBeCloseTo(0.5);
    expect(flat[1]).toBeCloseTo(0.5);
    expect(flat[2]).toBeCloseTo(1);
    const sloped = sampleTextureNode({ kind: "normalMap", height: ramp, strength: 8 }, 0.4, 0.4);
    // Height rises with u, so the normal leans toward -X and off the +Z pole.
    expect(sloped[0]).toBeLessThan(0.5);
    expect(sloped[1]).toBeCloseTo(0.5);
    expect(sloped[2]).toBeLessThan(1);
    expect(sloped[2]).toBeGreaterThan(0.5);
  });
});

describe("renderTexture", () => {
  it("bakes width * height * 4 bytes and a non-uniform checker", () => {
    const baked = renderTexture(everyKind.checker, { width: 16, height: 8 });
    expect(baked.width).toBe(16);
    expect(baked.height).toBe(8);
    expect(baked.pixels.length).toBe(16 * 8 * 4);
    expect(new Set(baked.pixels).size).toBeGreaterThan(1);
    // Texel-centre sampling: the top-left cell is white and its neighbour black.
    expect(baked.pixels[0]).toBe(255);
    expect(baked.pixels[4 * 4]).toBe(0);
  });

  it("defaults to a square and rejects an impossible size", () => {
    expect(renderTexture(everyKind.constant, { width: 4 }).pixels.length).toBe(4 * 4 * 4);
    expect(() => renderTexture(everyKind.constant, { width: 0 })).toThrow(/whole number/);
  });
});

describe("validateMaterialGraph", () => {
  it("returns no issues for a complete graph", () => {
    const graph: MaterialGraph = { id: "brick", textures: { baseColor: everyKind.bricks, normal: everyKind.normalMap }, resolution: 8 };
    expect(validateMaterialGraph(graph)).toEqual([]);
  });

  it("reports every issue with its path", () => {
    const issues = validateMaterialGraph(
      {
        id: "builtin:nope",
        resolution: 0,
        anisotropy: 3,
        atlas: { columns: 2, rows: 2, inset: 0.5 },
        baseColor: [1, 2],
        textures: {
          glow: { kind: "constant", color: [1, 1, 1, 1] },
          baseColor: { kind: "mix", a: { kind: "constant", color: [1, 1, 1, 1] } },
          normal: { kind: "gradient", stops: [{ at: 0, color: [0, 0, 0, 1] }] },
          occlusion: { kind: "sparkle" },
          emission: { kind: "shapes", shapes: [{ rect: [0, 0, 1], color: [1, 1, 1, 1] }, { ellipse: [0, 0, 1, 1], color: "red" }] },
        },
      },
      "materials[0]",
    );
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ["materials[0].id", "reserved-id"],
      ["materials[0].resolution", "out-of-range"],
      ["materials[0].anisotropy", "out-of-range"],
      ["materials[0].atlas.inset", "out-of-range"],
      ["materials[0].baseColor", "invalid-vector"],
      ["materials[0].textures.glow", "unknown-slot"],
      ["materials[0].textures.baseColor.b", "missing-field"],
      ["materials[0].textures.baseColor.factor", "missing-field"],
      ["materials[0].textures.normal.stops", "invalid-stops"],
      ["materials[0].textures.occlusion.kind", "unknown-node"],
      ["materials[0].textures.emission.shapes[0]", "invalid-shape"],
      ["materials[0].textures.emission.shapes[1].color", "invalid-color"],
    ]);
  });

  it("flags anisotropy against nearest filtering and a non-object graph", () => {
    expect(validateMaterialGraph({ id: "m", anisotropy: 4, filter: "nearest" })[0]?.code).toBe("conflict");
    expect(validateMaterialGraph(null)).toEqual([{ path: "material", code: "not-an-object", message: expect.any(String) }]);
  });
});

describe("generateMaterial", () => {
  const graph: MaterialGraph = {
    id: "wall",
    resolution: 8,
    baseColor: [1, 1, 1, 1],
    filter: "linear",
    anisotropy: 4,
    addressMode: "repeat",
    textures: { baseColor: everyKind.bricks, normal: everyKind.normalMap, metallicRoughness: everyKind.constant },
    mipmaps: true,
  };

  it("bakes one texture per slot with the slot's colour space and stable ids", () => {
    const material = generateMaterial(graph);
    expect(material.id).toBe("wall");
    expect(material.textures.map((texture) => [texture.id, texture.colorSpace, texture.pixels.length])).toEqual([
      ["wall:baseColor", "srgb", 8 * 8 * 4],
      ["wall:normal", "linear", 8 * 8 * 4],
      ["wall:metallicRoughness", "linear", 8 * 8 * 4],
    ]);
    expect(material.material.textures).toEqual({ baseColor: "wall:baseColor", normal: "wall:normal", metallicRoughness: "wall:metallicRoughness" });
    expect(material.textures[0]?.mipmaps).toBe(true);
    expect(generateMaterial(graph)).toEqual(material);
  });

  it("omits every field the graph did not set", () => {
    expect(generateMaterial({ id: "plain" })).toEqual({ id: "plain", material: {}, textures: [] });
  });

  it("throws on an invalid graph with the issue paths in the message", () => {
    expect(() => generateMaterial({ id: "", resolution: 0 })).toThrow(/material\.id.*material\.resolution/);
  });

  it("produces exactly what the engine's upload validators accept", async () => {
    const engine = await engineUploads();
    const material = generateMaterial(graph);
    const uploaded = new Set<string>();
    for (const texture of material.textures) {
      const { id, ...upload } = texture;
      expect(() => engine.validateTextureUpload(id, upload)).not.toThrow();
      uploaded.add(id);
    }
    expect(() => engine.validateMaterialUpload(material.id, material.material, (id) => uploaded.has(id))).not.toThrow();
  });

  it("declares the same MaterialUpload fields as the engine", async () => {
    const { source } = await engineUploads();
    const fields = (name: string): string[] => {
      const body = source.split(`export interface ${name} {`)[1]?.split("\n}")[0] ?? "";
      return [...body.matchAll(/^\s+readonly (\w+)\??:/gm)].map((match) => match[1]!).sort();
    };
    // A fully-populated definition, so its keys are the type's fields.
    const full: Required<MaterialDefinition> = {
      baseColor: [1, 1, 1, 1], emission: [0, 0, 0], uvScale: [1, 1], uvOffset: [0, 0], normalScale: 1,
      occlusionStrength: 1, textures: {}, filter: "linear", anisotropy: 1, addressMode: "repeat",
      atlas: { columns: 1, rows: 1 }, coverageMode: "alpha", alphaMode: "opaque", doubleSided: false, depthWrite: true,
    };
    expect(Object.keys(full).sort()).toEqual(fields("MaterialUpload"));
    const { textures: _textures, ...scalars } = full;
    expect(Object.keys(generateMaterial({ ...graph, ...scalars }).material).sort()).toEqual(fields("MaterialUpload"));
    expect(fields("TextureUpload")).toEqual(["colorSpace", "height", "mipmaps", "pixels", "width"]);
  });
});
