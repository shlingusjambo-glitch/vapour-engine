/** 2D generators: character sprites, nine-slice UI panels, and the atlas that
 * packs them.
 *
 * A 2D game has the same problem as a 3D one — an agent can describe a
 * character as "green shirt, brown hair, facing right" but cannot draw it — and
 * the same answer: the description is a list of shapes, and shapes are just
 * another texture node. Every generator here builds a `shapes` graph and bakes
 * it with {@link renderTexture}, so there is one rasterizer, one colour
 * convention, and one place sampling is tested.
 *
 * The atlas output is shaped for the engine's `SpriteAsset`: pixel rects with a
 * top-left origin, a pivot measured from the bottom-left, and nine-slice
 * borders in pixels. {@link spriteAsset} produces that structure directly.
 */
import { renderTexture, type Rgba, type TextureNode, type TextureShape } from "./material.js";

/** RGBA8 pixels, row-major from the top-left. The atlas packer's input unit. */
export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export type SpriteFacing = "front" | "left" | "right";

export interface CharacterSpritePalette {
  readonly skin?: Rgba;
  readonly hair?: Rgba;
  readonly shirt?: Rgba;
  readonly trousers?: Rgba;
  readonly shoes?: Rgba;
  readonly outline?: Rgba;
}

export interface CharacterSpriteSpec {
  readonly width?: number;
  readonly height?: number;
  readonly facing?: SpriteFacing;
  readonly palette?: CharacterSpritePalette;
  /** Head height as a fraction of the sprite. 0.3 is chibi; 0.15 is realistic. */
  readonly headFraction?: number;
}

const DEFAULT_PALETTE: Required<CharacterSpritePalette> = {
  skin: [0.87, 0.67, 0.53, 1],
  hair: [0.3, 0.18, 0.1, 1],
  shirt: [0.2, 0.5, 0.8, 1],
  trousers: [0.25, 0.25, 0.35, 1],
  shoes: [0.15, 0.1, 0.08, 1],
  outline: [0.1, 0.08, 0.08, 1],
};

/**
 * A blocky character: head, torso, arms, legs, and a facing cue.
 *
 * Each block is drawn as an outline rect with the fill inset one texel, which
 * is what keeps a 32 px sprite legible against any background. Facing shifts
 * the eyes and hair fringe rather than redrawing the body, so all three views
 * share a silhouette and animate consistently.
 */
export function generateCharacterSprite(spec: CharacterSpriteSpec = {}): PixelBuffer {
  const width = requireSize(spec.width ?? 32, "Sprite width");
  const height = requireSize(spec.height ?? 48, "Sprite height");
  const facing = spec.facing ?? "front";
  const palette = { ...DEFAULT_PALETTE, ...spec.palette };
  const headFraction = spec.headFraction ?? 0.28;
  if (!(headFraction > 0.05 && headFraction < 0.6)) throw new Error("A sprite's headFraction must lie in (0.05, 0.6).");

  const px = 1 / width;
  const py = 1 / height;
  const shapes: TextureShape[] = [];
  /** Outlined block: an outline rect with the fill inset by one texel. */
  const block = (x: number, y: number, w: number, h: number, color: Rgba, radius = 0): void => {
    shapes.push({ rect: [x, y, w, h], radius, color: palette.outline });
    shapes.push({ rect: [x + px, y + py, Math.max(0, w - 2 * px), Math.max(0, h - 2 * py)], radius: Math.max(0, radius - px), color });
  };

  const headH = headFraction;
  const legH = 0.3;
  const torsoH = 1 - headH - legH;
  const torsoW = 0.44;
  const torsoX = (1 - torsoW) / 2;
  const headW = Math.min(0.6, (headH * height) / width);
  const headX = (1 - headW) / 2;
  const armW = 0.12;

  // Legs, then torso and arms, then head, so overlaps read as in front.
  const lean = facing === "left" ? -0.03 : facing === "right" ? 0.03 : 0;
  for (const side of [-1, 1]) {
    const legX = 0.5 + side * 0.11 - 0.09 + lean;
    block(legX, headH + torsoH, 0.18, legH - 0.06, palette.trousers);
    block(legX - 0.02, 1 - 0.07, 0.22, 0.07, palette.shoes, 0.03);
  }
  block(torsoX, headH, torsoW, torsoH, palette.shirt, 0.04);
  for (const side of [-1, 1]) {
    // A side view hides the far arm behind the torso and swings the near one.
    if (facing !== "front" && side === (facing === "left" ? 1 : -1)) continue;
    const armX = side < 0 ? torsoX - armW + px : torsoX + torsoW - px;
    block(armX + lean, headH + 0.02, armW, torsoH * 0.8, palette.shirt);
    block(armX + lean, headH + 0.02 + torsoH * 0.8, armW, 0.05, palette.skin);
  }
  block(headX + lean, 0.02, headW, headH, palette.skin, 0.12);
  // Hair: a cap over the top of the head, with a fringe on the facing side.
  shapes.push({ rect: [headX + lean, 0.02, headW, headH * 0.4], radius: [0.12, 0.1], color: palette.hair });
  if (facing !== "front") {
    const fringeX = facing === "left" ? headX + lean : headX + lean + headW * 0.75;
    shapes.push({ rect: [fringeX, 0.02, headW * 0.25, headH * 0.6], color: palette.hair });
  }
  // Eyes: two for a front view, one for a side view, shifted toward the facing.
  const eyeY = 0.02 + headH * 0.5;
  const eyes = facing === "front" ? [0.5 - headW * 0.2, 0.5 + headW * 0.2] : [facing === "left" ? 0.5 - headW * 0.28 : 0.5 + headW * 0.28];
  for (const eyeX of eyes) shapes.push({ rect: [eyeX - px + lean, eyeY, 2 * px, 2 * py], color: palette.outline });

  const node: TextureNode = { kind: "shapes", background: [0, 0, 0, 0], shapes };
  return renderTexture(node, { width, height });
}

export interface PanelSpriteSpec {
  readonly width?: number;
  readonly height?: number;
  /** Border thickness in pixels; also the nine-slice border. */
  readonly border?: number;
  /** Corner radius in pixels. */
  readonly radius?: number;
  readonly fill?: Rgba;
  readonly borderColor?: Rgba;
  /** A lighter band along the top edge inside the border, for a button look. */
  readonly highlight?: Rgba;
}

export interface PanelSprite extends PixelBuffer {
  /** Left, top, right, bottom border pixels for nine-slicing. */
  readonly border: readonly [number, number, number, number];
}

/**
 * A nine-slice panel or button: a rounded border and a flat fill.
 *
 * The centre is a solid colour by construction, which is what makes it
 * stretchable — the nine-slice repeats or scales the middle, and anything with
 * structure there would smear. Buttons are panels with a highlight band.
 */
export function generatePanelSprite(spec: PanelSpriteSpec = {}): PanelSprite {
  const width = requireSize(spec.width ?? 48, "Panel width");
  const height = requireSize(spec.height ?? 48, "Panel height");
  const border = spec.border ?? 6;
  if (!Number.isInteger(border) || border < 1 || border * 2 >= Math.min(width, height)) {
    throw new Error(`A panel border must be a whole number of pixels leaving a centre (got ${String(border)} for ${String(width)}×${String(height)}).`);
  }
  const radius = spec.radius ?? border;
  const fill = spec.fill ?? [0.22, 0.24, 0.3, 1];
  const borderColor = spec.borderColor ?? [0.75, 0.78, 0.85, 1];
  const [rx, ry] = [radius / width, radius / height];
  const [bx, by] = [border / width, border / height];
  const shapes: TextureShape[] = [
    { rect: [0, 0, 1, 1], radius: [rx, ry], color: borderColor },
    { rect: [bx, by, 1 - 2 * bx, 1 - 2 * by], radius: [Math.max(0, rx - bx), Math.max(0, ry - by)], color: fill },
  ];
  if (spec.highlight !== undefined) {
    shapes.push({ rect: [bx, by, 1 - 2 * bx, Math.min(by, 0.5 - by)], color: spec.highlight });
  }
  const baked = renderTexture({ kind: "shapes", background: [0, 0, 0, 0], shapes }, { width, height });
  return { ...baked, border: [border, border, border, border] };
}

export interface AtlasEntry extends PixelBuffer {
  readonly name: string;
  /** Normalized origin from the bottom-left. Defaults to the centre. */
  readonly pivot?: readonly [number, number];
  /** Left, top, right, bottom nine-slice borders in pixels. */
  readonly border?: readonly [number, number, number, number];
}

export interface AtlasRegion {
  readonly name: string;
  /** Pixel rect `[x, y, width, height]`, top-left origin. */
  readonly rect: readonly [number, number, number, number];
  readonly pivot: readonly [number, number];
  readonly border: readonly [number, number, number, number];
}

export interface SpriteAtlas extends PixelBuffer {
  readonly regions: Readonly<Record<string, AtlasRegion>>;
}

export interface PackAtlasOptions {
  /** Transparent pixels between sprites, so filtering never bleeds a neighbour. */
  readonly padding?: number;
  readonly maxWidth?: number;
}

/**
 * Packs sprites into one texture by shelf packing.
 *
 * Shelves are the simplest packer that is good enough: sprites sorted by height
 * fill rows left to right, and a row's height is its tallest member. It wastes
 * a little space against a tighter algorithm, and in exchange it is a few
 * lines, deterministic, and never produces an overlap. Both dimensions are
 * rounded up to a power of two, which every GPU is happiest with.
 */
export function packAtlas(entries: readonly AtlasEntry[], options: PackAtlasOptions = {}): SpriteAtlas {
  if (entries.length === 0) throw new Error("An atlas needs at least one sprite.");
  const padding = options.padding ?? 1;
  if (!Number.isInteger(padding) || padding < 0) throw new Error("Atlas padding must be a non-negative whole number of pixels.");
  const maxWidth = options.maxWidth ?? 2048;
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.name.trim() === "" || names.has(entry.name)) throw new Error(`Atlas sprite names must be unique and non-empty (got ${JSON.stringify(entry.name)}).`);
    names.add(entry.name);
    if (entry.pixels.length !== entry.width * entry.height * 4) throw new Error(`Atlas sprite "${entry.name}" has ${String(entry.pixels.length)} bytes for ${String(entry.width)}×${String(entry.height)}.`);
  }
  const widest = Math.max(...entries.map((entry) => entry.width)) + padding * 2;
  if (widest > maxWidth) throw new Error(`Atlas sprite is wider than maxWidth ${String(maxWidth)}.`);
  const area = entries.reduce((sum, entry) => sum + (entry.width + padding * 2) * (entry.height + padding * 2), 0);
  const width = Math.min(maxWidth, Math.max(nextPowerOfTwo(widest), nextPowerOfTwo(Math.ceil(Math.sqrt(area)))));

  // Tallest first so every shelf is as full as it can be; ties by name so the
  // layout does not depend on input order.
  const sorted = [...entries].sort((a, b) => b.height - a.height || a.name.localeCompare(b.name));
  const placed: { entry: AtlasEntry; x: number; y: number }[] = [];
  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;
  for (const entry of sorted) {
    const w = entry.width + padding * 2;
    const h = entry.height + padding * 2;
    if (shelfX + w > width) {
      shelfY += shelfHeight;
      shelfX = 0;
      shelfHeight = 0;
    }
    placed.push({ entry, x: shelfX + padding, y: shelfY + padding });
    shelfX += w;
    shelfHeight = Math.max(shelfHeight, h);
  }
  const height = nextPowerOfTwo(shelfY + shelfHeight);
  if (height > 8192) throw new Error(`The atlas would be ${String(height)} px tall; raise maxWidth or split the set.`);

  const pixels = new Uint8Array(width * height * 4);
  const regions: Record<string, AtlasRegion> = {};
  for (const { entry, x, y } of placed) {
    for (let row = 0; row < entry.height; row += 1) {
      pixels.set(entry.pixels.subarray(row * entry.width * 4, (row + 1) * entry.width * 4), ((y + row) * width + x) * 4);
    }
    regions[entry.name] = { name: entry.name, rect: [x, y, entry.width, entry.height], pivot: entry.pivot ?? [0.5, 0.5], border: entry.border ?? [0, 0, 0, 0] };
  }
  return { width, height, pixels, regions };
}

/** One sprite in a {@link SpriteAtlasSpec}: a name, a pivot, and a generator. */
export type SpriteAtlasEntrySpec = {
  readonly name: string;
  readonly pivot?: readonly [number, number];
} & ({ readonly character: CharacterSpriteSpec } | { readonly panel: PanelSpriteSpec });

/** The JSON form of an atlas: what to draw and how to pack it. */
export interface SpriteAtlasSpec {
  readonly sprites: readonly SpriteAtlasEntrySpec[];
  readonly padding?: number;
  readonly maxWidth?: number;
}

/** Generates every sprite in a spec and packs them, so a 2D kit is one document. */
export function generateSpriteAtlas(spec: SpriteAtlasSpec): SpriteAtlas {
  const entries = spec.sprites.map((sprite): AtlasEntry => {
    const pivot = sprite.pivot === undefined ? {} : { pivot: sprite.pivot };
    if ("panel" in sprite) {
      const panel = generatePanelSprite(sprite.panel);
      return { name: sprite.name, ...panel, ...pivot };
    }
    return { name: sprite.name, ...generateCharacterSprite(sprite.character), ...pivot };
  });
  return packAtlas(entries, { ...(spec.padding === undefined ? {} : { padding: spec.padding }), ...(spec.maxWidth === undefined ? {} : { maxWidth: spec.maxWidth }) });
}

/** Structurally the engine's `SpriteAsset`, so a region can be drawn directly. */
export interface SpriteRegionAsset {
  readonly id: string;
  readonly material: string;
  readonly textureSize: readonly [number, number];
  readonly rect: readonly [number, number, number, number];
  readonly pivot: readonly [number, number];
  readonly border: readonly [number, number, number, number];
  readonly pixelsPerUnit?: number;
}

/** Looks a region up by name and shapes it as an engine sprite asset. */
export function spriteAsset(atlas: SpriteAtlas, name: string, material: string, pixelsPerUnit?: number): SpriteRegionAsset {
  const region = atlas.regions[name];
  if (region === undefined) throw new Error(`No sprite named ${JSON.stringify(name)} in the atlas. Sprites: ${Object.keys(atlas.regions).join(", ")}.`);
  return {
    id: name,
    material,
    textureSize: [atlas.width, atlas.height],
    rect: region.rect,
    pivot: region.pivot,
    border: region.border,
    ...(pixelsPerUnit === undefined ? {} : { pixelsPerUnit }),
  };
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function requireSize(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 4 || value > 4096) throw new Error(`${label} must be a whole number in [4, 4096] (got ${String(value)}).`);
  return value;
}
