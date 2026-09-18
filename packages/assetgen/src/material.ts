/** Material graphs and the procedural textures they bake.
 *
 * Geometry without materials is grey, and an agent that can describe a building
 * but not the brick on it has only half an asset. The constraint that shapes
 * this module is the runtime's: Vapour's render host accepts a **PBR material
 * descriptor plus RGBA8 texture uploads**, so that is exactly what a material
 * graph produces. {@link MaterialDefinition} is structurally the engine's
 * `MaterialUpload` and {@link GeneratedTexture} is structurally its
 * `TextureUpload`; a generated material can be handed straight to
 * `host.uploadTexture` and `host.defineMaterial` with no translation layer.
 *
 * Textures are a small node graph rather than a fixed catalogue of patterns,
 * for the same reason the geometry side is: a catalogue only makes what someone
 * anticipated. A node is a pure function of `(u, v)`, which is what makes
 * `normalMap` possible — it re-samples its input at neighbouring coordinates
 * instead of needing a rendered buffer to difference.
 *
 * Colours are written to bytes as authored. `colorSpace` tags how the GPU
 * should interpret them, so a base-colour node's `[0.8, 0.2, 0.2, 1]` is the
 * sRGB value an author means by "red", not a linear one that renders washed out.
 */
import type { AssetIssue } from "./describe.js";

export type Rgba = readonly [number, number, number, number];

/** Structurally the engine's `MaterialTextureSet`. Values are texture ids. */
export interface MaterialTextureSet {
  readonly baseColor?: string;
  readonly normal?: string;
  readonly metallicRoughness?: string;
  readonly occlusion?: string;
  readonly emission?: string;
}

/** Structurally the engine's `TextureAtlasLayout`. */
export interface TextureAtlasLayout {
  readonly columns: number;
  readonly rows: number;
  readonly inset?: number;
  readonly origin?: "bottom-left" | "top-left";
}

/**
 * Structurally identical to the engine's `MaterialUpload`.
 *
 * Duplicated rather than imported because `@vapour/assetgen` deliberately does
 * not depend on `@vapour/engine` — generation runs in build scripts, workers,
 * and tests that have no renderer. The field set is asserted against the
 * engine's own list in `material.test.ts`, so drift is caught rather than
 * discovered at upload time.
 */
export interface MaterialDefinition {
  readonly baseColor?: readonly [number, number, number, number];
  readonly emission?: readonly [number, number, number];
  readonly uvScale?: readonly [number, number];
  readonly uvOffset?: readonly [number, number];
  readonly normalScale?: number;
  readonly occlusionStrength?: number;
  readonly textures?: MaterialTextureSet;
  readonly filter?: "nearest" | "linear";
  readonly anisotropy?: 1 | 2 | 4 | 8 | 16;
  readonly addressMode?: "repeat" | "clamp" | "mirror";
  readonly atlas?: TextureAtlasLayout;
  readonly coverageMode?: "alpha" | "sdf";
  readonly alphaMode?: "opaque" | "mask" | "blend";
  readonly doubleSided?: boolean;
  readonly depthWrite?: boolean;
}

/** Structurally the engine's `TextureUpload`, plus the id it uploads under. */
export interface GeneratedTexture {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** `width * height * 4` bytes, row-major from the top-left. */
  readonly pixels: Uint8Array;
  readonly colorSpace: "srgb" | "linear";
  readonly mipmaps?: boolean;
}

export interface GeneratedMaterial {
  readonly id: string;
  readonly material: MaterialDefinition;
  readonly textures: readonly GeneratedTexture[];
}

/** A pure function of `(u, v)` producing linear RGBA in `[0, 1]`. */
export type TextureNode =
  | { readonly kind: "constant"; readonly color: Rgba }
  | { readonly kind: "checker"; readonly columns?: number; readonly rows?: number; readonly a?: Rgba; readonly b?: Rgba }
  | { readonly kind: "gradient"; readonly axis?: "x" | "y" | "radial"; readonly stops: readonly { readonly at: number; readonly color: Rgba }[] }
  | {
      readonly kind: "noise";
      /** Lattice cells across the texture. Larger is finer. */
      readonly scale?: number;
      readonly octaves?: number;
      readonly seed?: number;
      readonly low?: Rgba;
      readonly high?: Rgba;
    }
  | {
      readonly kind: "bricks";
      readonly columns?: number;
      readonly rows?: number;
      /** Mortar width as a fraction of a brick. */
      readonly mortar?: number;
      /** Row-to-row horizontal shift, as a fraction of a brick. */
      readonly offset?: number;
      readonly brick?: Rgba;
      readonly mortarColor?: Rgba;
      /** Per-brick brightness variation in `[0, 1]`. */
      readonly variation?: number;
      readonly seed?: number;
    }
  | { readonly kind: "mix"; readonly a: TextureNode; readonly b: TextureNode; readonly factor: number | TextureNode }
  | { readonly kind: "multiply"; readonly a: TextureNode; readonly b: TextureNode }
  | { readonly kind: "adjust"; readonly input: TextureNode; readonly brightness?: number; readonly contrast?: number; readonly saturation?: number }
  | { readonly kind: "normalMap"; readonly height: TextureNode; readonly strength?: number }
  | { readonly kind: "shapes"; readonly background?: Rgba; readonly shapes: readonly TextureShape[] };

/** A filled shape in normalized `(u, v)` space, `v` growing downward. Later
 * shapes paint over earlier ones, which is how a sprite is a list of these. */
export type TextureShape =
  | { readonly rect: readonly [number, number, number, number]; readonly radius?: number | readonly [number, number]; readonly color: Rgba }
  | { readonly ellipse: readonly [number, number, number, number]; readonly color: Rgba };

export const TEXTURE_NODE_KINDS = [
  "constant", "checker", "gradient", "noise", "bricks", "mix", "multiply", "adjust", "normalMap", "shapes",
] as const;

/** Which slot a texture fills, which fixes its colour space. */
export type MaterialTextureSlot = "baseColor" | "normal" | "metallicRoughness" | "occlusion" | "emission";

export interface MaterialGraph {
  readonly id: string;
  /** Nodes baked into textures. Slot names match the engine's texture set. */
  readonly textures?: Readonly<Partial<Record<MaterialTextureSlot, TextureNode>>>;
  /** Square edge length of every baked texture. Defaults to 128. */
  readonly resolution?: number;
  readonly seed?: number;
  readonly baseColor?: readonly [number, number, number, number];
  readonly emission?: readonly [number, number, number];
  readonly uvScale?: readonly [number, number];
  readonly uvOffset?: readonly [number, number];
  readonly normalScale?: number;
  readonly occlusionStrength?: number;
  readonly filter?: "nearest" | "linear";
  readonly anisotropy?: 1 | 2 | 4 | 8 | 16;
  readonly addressMode?: "repeat" | "clamp" | "mirror";
  readonly atlas?: TextureAtlasLayout;
  readonly coverageMode?: "alpha" | "sdf";
  readonly alphaMode?: "opaque" | "mask" | "blend";
  readonly doubleSided?: boolean;
  readonly depthWrite?: boolean;
  readonly mipmaps?: boolean;
}

/** sRGB slots carry colour a human authored; the rest carry data. */
const SLOT_COLOR_SPACE: Readonly<Record<MaterialTextureSlot, "srgb" | "linear">> = {
  baseColor: "srgb",
  emission: "srgb",
  normal: "linear",
  metallicRoughness: "linear",
  occlusion: "linear",
};

const WHITE: Rgba = [1, 1, 1, 1];
const BLACK: Rgba = [0, 0, 0, 1];

/**
 * Samples a texture node at normalized coordinates.
 *
 * Being a plain function of `(u, v)` rather than a buffer transform is what
 * lets `normalMap` differentiate its input analytically and what makes every
 * node resolution-independent: the same graph bakes at 64 or 2048 without a
 * separate code path.
 */
export function sampleTextureNode(node: TextureNode, u: number, v: number, seed = 1): Rgba {
  switch (node.kind) {
    case "constant":
      return node.color;
    case "checker": {
      const columns = node.columns ?? 8;
      const rows = node.rows ?? 8;
      const cell = Math.floor(u * columns) + Math.floor(v * rows);
      return cell % 2 === 0 ? (node.a ?? WHITE) : (node.b ?? BLACK);
    }
    case "gradient": {
      const axis = node.axis ?? "y";
      const t = axis === "x" ? u : axis === "y" ? v : Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2);
      return sampleStops(node.stops, t);
    }
    case "noise": {
      const value = fbm(u, v, node.scale ?? 8, node.octaves ?? 3, (node.seed ?? seed) >>> 0);
      return lerpColor(node.low ?? BLACK, node.high ?? WHITE, value);
    }
    case "bricks":
      return sampleBricks(node, u, v, seed);
    case "mix": {
      const factor = typeof node.factor === "number" ? node.factor : sampleTextureNode(node.factor, u, v, seed)[0];
      return lerpColor(sampleTextureNode(node.a, u, v, seed), sampleTextureNode(node.b, u, v, seed), clamp01(factor));
    }
    case "multiply": {
      const a = sampleTextureNode(node.a, u, v, seed);
      const b = sampleTextureNode(node.b, u, v, seed);
      return [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] * b[3]];
    }
    case "adjust": {
      const color = sampleTextureNode(node.input, u, v, seed);
      const brightness = node.brightness ?? 1;
      const contrast = node.contrast ?? 1;
      const saturation = node.saturation ?? 1;
      // Luma weights are the usual Rec. 709 ones, so desaturating a colour
      // preserves its apparent brightness rather than darkening the greens.
      const luma = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
      const channel = (value: number): number => clamp01((((value - 0.5) * contrast + 0.5) * brightness - luma) * saturation + luma * brightness);
      return [channel(color[0]), channel(color[1]), channel(color[2]), color[3]];
    }
    case "normalMap": {
      const strength = node.strength ?? 1;
      // A texel-sized step at the resolution normal maps are usually baked at.
      // Sampling the height field either side is exact for procedural input,
      // where a Sobel filter over a rendered buffer would only approximate it.
      const step = 1 / 256;
      const height = (su: number, sv: number): number => {
        const color = sampleTextureNode(node.height, wrap01(su), wrap01(sv), seed);
        return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
      };
      const dx = (height(u + step, v) - height(u - step, v)) * strength;
      const dy = (height(u, v + step) - height(u, v - step)) * strength;
      // Tangent-space normal, encoded the way every normal-map shader decodes
      // it: `n * 0.5 + 0.5`, with +Z out of the surface.
      const length = Math.hypot(-dx, -dy, step * 2) || 1;
      return [(-dx / length) * 0.5 + 0.5, (-dy / length) * 0.5 + 0.5, ((step * 2) / length) * 0.5 + 0.5, 1];
    }
    case "shapes": {
      let color = node.background ?? [0, 0, 0, 0];
      for (const shape of node.shapes) if (insideShape(shape, u, v)) color = shape.color;
      return color;
    }
  }
}

function insideShape(shape: TextureShape, u: number, v: number): boolean {
  if ("ellipse" in shape) {
    const [cx, cy, rx, ry] = shape.ellipse;
    return ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
  }
  const [x, y, w, h] = shape.rect;
  if (u < x || u > x + w || v < y || v > y + h) return false;
  if (shape.radius === undefined) return true;
  // A rounded corner is the quarter of an ellipse; the radius is clamped so
  // a tall thin rect with a large radius stays a stadium, not a hole.
  const [ru, rv] = typeof shape.radius === "number" ? [shape.radius, shape.radius] : shape.radius;
  const [cru, crv] = [Math.min(ru, w / 2), Math.min(rv, h / 2)];
  const du = Math.max(0, Math.max(x + cru - u, u - (x + w - cru)));
  const dv = Math.max(0, Math.max(y + crv - v, v - (y + h - crv)));
  return cru <= 0 || crv <= 0 ? du === 0 || dv === 0 : (du / cru) ** 2 + (dv / crv) ** 2 <= 1;
}

/** Bakes a node into an RGBA8 buffer, sampling at texel centres. */
export function renderTexture(node: TextureNode, options: { width?: number; height?: number; seed?: number } = {}): {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
} {
  const width = requireSize(options.width ?? 128, "Texture width");
  const height = requireSize(options.height ?? width, "Texture height");
  const seed = options.seed ?? 1;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    // Texel centres, not corners: sampling at the corner makes a checker's
    // first column half-width and puts a gradient's endpoints off the texture.
    const v = (row + 0.5) / height;
    for (let column = 0; column < width; column += 1) {
      const color = sampleTextureNode(node, (column + 0.5) / width, v, seed);
      const offset = (row * width + column) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        pixels[offset + channel] = Math.round(clamp01(color[channel] ?? 0) * 255);
      }
    }
  }
  return { width, height, pixels };
}

/**
 * Bakes a material graph into a runtime material and its textures.
 *
 * Texture ids are derived from the material id and the slot, so two calls with
 * the same graph produce the same ids and the renderer's texture cache does the
 * right thing without the caller inventing a naming scheme.
 */
export function generateMaterial(graph: MaterialGraph): GeneratedMaterial {
  const issues = validateMaterialGraph(graph);
  if (issues.length > 0) {
    throw new Error(`Material graph "${String(graph.id)}" is invalid: ${issues.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`);
  }
  const resolution = graph.resolution ?? 128;
  const seed = graph.seed ?? 1;
  const textures: GeneratedTexture[] = [];
  const bindings: Record<string, string> = {};

  for (const slot of Object.keys(SLOT_COLOR_SPACE) as MaterialTextureSlot[]) {
    const node = graph.textures?.[slot];
    if (node === undefined) continue;
    const id = `${graph.id}:${slot}`;
    const baked = renderTexture(node, { width: resolution, seed });
    textures.push({
      id,
      width: baked.width,
      height: baked.height,
      pixels: baked.pixels,
      colorSpace: SLOT_COLOR_SPACE[slot],
      ...(graph.mipmaps === undefined ? {} : { mipmaps: graph.mipmaps }),
    });
    bindings[slot] = id;
  }

  const material: MaterialDefinition = {
    ...(graph.baseColor === undefined ? {} : { baseColor: graph.baseColor }),
    ...(graph.emission === undefined ? {} : { emission: graph.emission }),
    ...(graph.uvScale === undefined ? {} : { uvScale: graph.uvScale }),
    ...(graph.uvOffset === undefined ? {} : { uvOffset: graph.uvOffset }),
    ...(graph.normalScale === undefined ? {} : { normalScale: graph.normalScale }),
    ...(graph.occlusionStrength === undefined ? {} : { occlusionStrength: graph.occlusionStrength }),
    ...(textures.length === 0 ? {} : { textures: bindings as MaterialTextureSet }),
    ...(graph.filter === undefined ? {} : { filter: graph.filter }),
    ...(graph.anisotropy === undefined ? {} : { anisotropy: graph.anisotropy }),
    ...(graph.addressMode === undefined ? {} : { addressMode: graph.addressMode }),
    ...(graph.atlas === undefined ? {} : { atlas: graph.atlas }),
    ...(graph.coverageMode === undefined ? {} : { coverageMode: graph.coverageMode }),
    ...(graph.alphaMode === undefined ? {} : { alphaMode: graph.alphaMode }),
    ...(graph.doubleSided === undefined ? {} : { doubleSided: graph.doubleSided }),
    ...(graph.depthWrite === undefined ? {} : { depthWrite: graph.depthWrite }),
  };
  return { id: graph.id, material, textures };
}

/**
 * Validates a material graph, returning every problem rather than the first.
 *
 * The checks mirror the renderer's own `validateMaterialUpload` — anisotropy
 * values, atlas insets, finite numbers — so a graph that passes here is
 * accepted at upload, which is the only guarantee worth making.
 */
export function validateMaterialGraph(graph: unknown, basePath = "material"): readonly AssetIssue[] {
  const issues: AssetIssue[] = [];
  if (!isRecord(graph)) {
    return [{ path: basePath, code: "not-an-object", message: "A material graph must be an object." }];
  }
  if (typeof graph["id"] !== "string" || graph["id"].trim() === "") {
    issues.push({ path: `${basePath}.id`, code: "invalid-id", message: "A material graph needs a non-empty id." });
  } else if (graph["id"].startsWith("builtin:")) {
    issues.push({ path: `${basePath}.id`, code: "reserved-id", message: "Material ids starting with 'builtin:' are reserved by the renderer." });
  }
  const resolution = graph["resolution"];
  if (resolution !== undefined && (!Number.isInteger(resolution) || (resolution as number) < 1 || (resolution as number) > 4096)) {
    issues.push({ path: `${basePath}.resolution`, code: "out-of-range", message: "Texture resolution must be a whole number in [1, 4096]." });
  }
  const anisotropy = graph["anisotropy"];
  if (anisotropy !== undefined && !([1, 2, 4, 8, 16] as unknown[]).includes(anisotropy)) {
    issues.push({ path: `${basePath}.anisotropy`, code: "out-of-range", message: "Anisotropy must be 1, 2, 4, 8 or 16." });
  }
  if (anisotropy !== undefined && (anisotropy as number) > 1 && graph["filter"] === "nearest") {
    issues.push({ path: `${basePath}.anisotropy`, code: "conflict", message: "Anisotropic filtering requires linear filtering." });
  }
  const atlas = graph["atlas"];
  if (atlas !== undefined) {
    if (!isRecord(atlas) || !Number.isInteger(atlas["columns"]) || !Number.isInteger(atlas["rows"]) || (atlas["columns"] as number) < 1 || (atlas["rows"] as number) < 1) {
      issues.push({ path: `${basePath}.atlas`, code: "invalid-atlas", message: "An atlas needs positive whole columns and rows." });
    } else {
      const inset = (atlas["inset"] as number | undefined) ?? 0;
      if (!(inset >= 0 && inset < 0.5)) {
        issues.push({ path: `${basePath}.atlas.inset`, code: "out-of-range", message: "An atlas inset must lie in [0, 0.5)." });
      }
    }
  }
  for (const field of ["baseColor", "emission", "uvScale", "uvOffset"] as const) {
    const value = graph[field];
    if (value === undefined) continue;
    const expected = field === "baseColor" ? 4 : field === "emission" ? 3 : 2;
    if (!Array.isArray(value) || value.length !== expected || value.some((entry) => !Number.isFinite(entry))) {
      issues.push({ path: `${basePath}.${field}`, code: "invalid-vector", message: `${field} must be ${expected} finite numbers.` });
    }
  }
  const textures = graph["textures"];
  if (textures !== undefined) {
    if (!isRecord(textures)) {
      issues.push({ path: `${basePath}.textures`, code: "not-an-object", message: "Material textures must be an object keyed by slot." });
    } else {
      for (const [slot, node] of Object.entries(textures)) {
        if (!(slot in SLOT_COLOR_SPACE)) {
          issues.push({
            path: `${basePath}.textures.${slot}`,
            code: "unknown-slot",
            message: `Unknown texture slot "${slot}". Slots are ${Object.keys(SLOT_COLOR_SPACE).join(", ")}.`,
          });
          continue;
        }
        validateTextureNode(node, `${basePath}.textures.${slot}`, issues);
      }
    }
  }
  return issues;
}

function validateTextureNode(node: unknown, path: string, issues: AssetIssue[]): void {
  if (!isRecord(node)) {
    issues.push({ path, code: "not-an-object", message: "A texture node must be an object." });
    return;
  }
  const kind = node["kind"];
  if (typeof kind !== "string" || !(TEXTURE_NODE_KINDS as readonly string[]).includes(kind)) {
    issues.push({ path: `${path}.kind`, code: "unknown-node", message: `Unknown texture node kind ${JSON.stringify(kind)}. Kinds are ${TEXTURE_NODE_KINDS.join(", ")}.` });
    return;
  }
  const color = (field: string): void => {
    const value = node[field];
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length !== 4 || value.some((entry) => !Number.isFinite(entry))) {
      issues.push({ path: `${path}.${field}`, code: "invalid-color", message: `${field} must be four finite numbers in [0, 1].` });
    }
  };
  const child = (field: string, required: boolean): void => {
    const value = node[field];
    if (value === undefined) {
      if (required) issues.push({ path: `${path}.${field}`, code: "missing-field", message: `A ${kind} node needs "${field}".` });
      return;
    }
    validateTextureNode(value, `${path}.${field}`, issues);
  };

  switch (kind) {
    case "constant":
      if (node["color"] === undefined) issues.push({ path: `${path}.color`, code: "missing-field", message: "A constant node needs a colour." });
      color("color");
      break;
    case "checker":
      color("a");
      color("b");
      break;
    case "gradient": {
      const stops = node["stops"];
      if (!Array.isArray(stops) || stops.length < 2) {
        issues.push({ path: `${path}.stops`, code: "invalid-stops", message: "A gradient needs at least two stops." });
        break;
      }
      for (const [index, stop] of stops.entries()) {
        if (!isRecord(stop) || !Number.isFinite(stop["at"]) || !Array.isArray(stop["color"]) || stop["color"].length !== 4) {
          issues.push({ path: `${path}.stops[${String(index)}]`, code: "invalid-stops", message: "A gradient stop needs a finite `at` and a four-component colour." });
        }
      }
      break;
    }
    case "noise":
    case "bricks":
      color("low");
      color("high");
      color("brick");
      color("mortarColor");
      break;
    case "mix":
      child("a", true);
      child("b", true);
      if (node["factor"] === undefined) issues.push({ path: `${path}.factor`, code: "missing-field", message: "A mix node needs a factor." });
      else if (typeof node["factor"] !== "number") validateTextureNode(node["factor"], `${path}.factor`, issues);
      else if (!Number.isFinite(node["factor"])) issues.push({ path: `${path}.factor`, code: "not-finite", message: "A mix factor must be finite." });
      break;
    case "multiply":
      child("a", true);
      child("b", true);
      break;
    case "adjust":
      child("input", true);
      break;
    case "normalMap":
      child("height", true);
      break;
    case "shapes": {
      color("background");
      const shapes = node["shapes"];
      if (!Array.isArray(shapes)) {
        issues.push({ path: `${path}.shapes`, code: "missing-field", message: "A shapes node needs an array of shapes." });
        break;
      }
      shapes.forEach((shape, index) => {
        const shapePath = `${path}.shapes[${String(index)}]`;
        const geometry = isRecord(shape) ? (shape["rect"] ?? shape["ellipse"]) : undefined;
        if (!isRecord(shape) || !Array.isArray(geometry) || geometry.length !== 4 || geometry.some((entry) => !Number.isFinite(entry))) {
          issues.push({ path: shapePath, code: "invalid-shape", message: "A shape needs a `rect` [x, y, w, h] or an `ellipse` [cx, cy, rx, ry] of finite numbers." });
          return;
        }
        if (!Array.isArray(shape["color"]) || shape["color"].length !== 4 || shape["color"].some((entry) => !Number.isFinite(entry))) {
          issues.push({ path: `${shapePath}.color`, code: "invalid-color", message: "A shape colour is four finite numbers in [0, 1]." });
        }
      });
      break;
    }
  }
}

// --- sampling helpers --------------------------------------------------------

function sampleBricks(
  node: Extract<TextureNode, { kind: "bricks" }>,
  u: number,
  v: number,
  seed: number,
): Rgba {
  const columns = node.columns ?? 6;
  const rows = node.rows ?? 12;
  const mortar = clamp01(node.mortar ?? 0.06);
  const offset = node.offset ?? 0.5;
  const brick = node.brick ?? [0.55, 0.25, 0.2, 1];
  const mortarColor = node.mortarColor ?? [0.75, 0.73, 0.7, 1];
  const variation = clamp01(node.variation ?? 0.15);

  const row = Math.floor(v * rows);
  // Alternate rows are shifted, which is what makes a wall read as brickwork
  // rather than as a grid of tiles.
  const shifted = u + (row % 2 === 0 ? 0 : offset / columns);
  const column = Math.floor(shifted * columns);
  const inColumn = shifted * columns - column;
  const inRow = v * rows - row;
  if (inColumn < mortar || inColumn > 1 - mortar || inRow < mortar || inRow > 1 - mortar) return mortarColor;
  const tint = 1 - variation * hash2(column, row, (node.seed ?? seed) >>> 0);
  return [brick[0] * tint, brick[1] * tint, brick[2] * tint, brick[3]];
}

function sampleStops(stops: readonly { readonly at: number; readonly color: Rgba }[], t: number): Rgba {
  const ordered = [...stops].sort((left, right) => left.at - right.at);
  const first = ordered[0]!;
  if (t <= first.at) return first.color;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (t <= current.at) {
      const span = current.at - previous.at;
      return lerpColor(previous.color, current.color, span < 1e-9 ? 0 : (t - previous.at) / span);
    }
  }
  return ordered[ordered.length - 1]!.color;
}

/** Fractal value noise: smooth, seeded, and identical on every platform. */
function fbm(u: number, v: number, scale: number, octaves: number, seed: number): number {
  let value = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = Math.max(1, scale);
  for (let octave = 0; octave < Math.max(1, Math.min(8, octaves)); octave += 1) {
    value += amplitude * valueNoise(u * frequency, v * frequency, seed + octave * 7919);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / (total || 1);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const top = hash2(x0, y0, seed) * (1 - fx) + hash2(x0 + 1, y0, seed) * fx;
  const bottom = hash2(x0, y0 + 1, seed) * (1 - fx) + hash2(x0 + 1, y0 + 1, seed) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Integer hash to `[0, 1)`. Deterministic across engines, unlike `Math.random`. */
function hash2(x: number, y: number, seed: number): number {
  let hash = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35)) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2545f491) >>> 0;
  hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerpColor(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function wrap01(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function requireSize(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 4096) throw new Error(`${label} must be a whole number in [1, 4096] (got ${value}).`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
