import type { MaterialUpload, TextureUpload } from "../render/host/index.js";
import type { FontAtlas, FontGlyph } from "./text-2d.js";

export interface FontImportOptions {
  readonly id: string;
  readonly material: string;
  readonly family: string;
  readonly characters: string;
  readonly designSize?: number;
  readonly weight?: string | number;
  readonly style?: "normal" | "italic";
  readonly atlasWidth?: number;
  readonly padding?: number;
  /** Generates signed-distance alpha with this pixel radius. Zero keeps normal alpha. */
  readonly sdfRadius?: number;
  readonly fallbackCharacter?: string;
}

export interface ImportedFontAtlas {
  readonly font: FontAtlas;
  readonly textureId: string;
  readonly texture: TextureUpload;
  readonly material: MaterialUpload;
}

/** Rasterizes a browser font into an engine atlas. This is an import step, not
 * per-frame rendering: upload the returned texture/material once and serialize
 * the font metrics as an asset. */
export async function importBrowserFont(options: FontImportOptions): Promise<ImportedFontAtlas> {
  if (typeof document === "undefined") throw new Error("Browser font importing requires a document and Canvas 2D. Run it in the Vapour editor or a browser build step.");
  const id = nonEmpty(options.id, "Font ID"); const materialId = nonEmpty(options.material, `Font '${id}' material`); nonEmpty(options.family, `Font '${id}' family`);
  const size = positiveInteger(options.designSize ?? 48, `Font '${id}' designSize`); const atlasWidth = positiveInteger(options.atlasWidth ?? 1024, `Font '${id}' atlasWidth`); const padding = nonNegativeInteger(options.padding ?? 3, `Font '${id}' padding`); const radius = nonNegativeInteger(options.sdfRadius ?? 8, `Font '${id}' sdfRadius`);
  if (options.characters.length === 0) throw new Error(`Font '${id}' characters must not be empty.`);
  if (document.fonts !== undefined) await document.fonts.ready;
  const scratch = document.createElement("canvas"); const measure = scratch.getContext("2d", { willReadFrequently: true }); if (measure === null) throw new Error(`Font '${id}' could not acquire a Canvas 2D context.`);
  const cssFont = `${options.style ?? "normal"} ${String(options.weight ?? 400)} ${String(size)}px ${JSON.stringify(options.family)}`; measure.font = cssFont; measure.textBaseline = "alphabetic";
  const characters = uniqueGraphemes(options.characters); const lineHeight = Math.ceil(size * 1.25); const cells: Array<{ character: string; width: number; advance: number; ascent: number; descent: number; x: number; y: number }> = [];
  let x = padding; let y = padding; let rowHeight = 0;
  for (const character of characters) {
    const metrics = measure.measureText(character); const advance = Math.max(0, metrics.width); const width = Math.max(1, Math.ceil((metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || advance))) + padding * 2; const height = Math.max(1, Math.ceil((metrics.actualBoundingBoxAscent || size) + (metrics.actualBoundingBoxDescent || size * 0.25))) + padding * 2;
    if (width > atlasWidth) throw new Error(`Font '${id}' glyph ${JSON.stringify(character)} needs ${String(width)} pixels but atlasWidth is ${String(atlasWidth)}.`);
    if (x + width > atlasWidth) { x = padding; y += rowHeight; rowHeight = 0; }
    cells.push({ character, width, advance, ascent: metrics.actualBoundingBoxAscent || size, descent: metrics.actualBoundingBoxDescent || size * 0.25, x, y }); x += width; rowHeight = Math.max(rowHeight, height);
  }
  const atlasHeight = nextPowerOfTwo(y + rowHeight + padding); const canvas = document.createElement("canvas"); canvas.width = atlasWidth; canvas.height = atlasHeight; const context = canvas.getContext("2d", { willReadFrequently: true }); if (context === null) throw new Error(`Font '${id}' could not acquire its atlas Canvas 2D context.`);
  context.clearRect(0, 0, atlasWidth, atlasHeight); context.fillStyle = "white"; context.font = cssFont; context.textBaseline = "alphabetic";
  const glyphs: FontGlyph[] = [];
  for (const cell of cells) { const baseline = cell.y + padding + cell.ascent; context.fillText(cell.character, cell.x + padding, baseline); const height = Math.ceil(cell.ascent + cell.descent) + padding * 2; glyphs.push({ character: cell.character, rect: [cell.x, cell.y, cell.width, height], advance: cell.advance, bearing: [0, cell.ascent] }); }
  const source = context.getImageData(0, 0, atlasWidth, atlasHeight).data; const pixels = radius === 0 ? Uint8Array.from(source) : generateSignedDistanceAlpha(atlasWidth, atlasHeight, source, radius);
  const font: FontAtlas = { id, material: materialId, textureSize: [atlasWidth, atlasHeight], designSize: size, lineHeight, glyphs, ...(options.fallbackCharacter === undefined ? {} : { fallbackCharacter: options.fallbackCharacter }) };
  if (font.fallbackCharacter !== undefined && !characters.includes(font.fallbackCharacter)) throw new Error(`Font '${id}' fallbackCharacter ${JSON.stringify(font.fallbackCharacter)} is not included in characters.`);
  const textureId = `${id}:texture`;
  return Object.freeze({ font: Object.freeze(font), textureId, texture: Object.freeze({ width: atlasWidth, height: atlasHeight, pixels, colorSpace: "linear" }), material: Object.freeze({ textures: { baseColor: textureId }, coverageMode: radius === 0 ? "alpha" : "sdf", alphaMode: "blend", doubleSided: true, depthWrite: false, addressMode: "clamp", filter: "linear" }) });
}

/** Converts RGBA coverage to a single-channel signed-distance field stored in
 * alpha. Intended for import workers/editor builds, never the frame loop. */
export function generateSignedDistanceAlpha(width: number, height: number, source: ArrayLike<number>, radius: number): Uint8Array {
  positiveInteger(width, "SDF width"); positiveInteger(height, "SDF height"); positiveInteger(radius, "SDF radius"); if (source.length !== width * height * 4) throw new Error(`SDF source needs ${String(width * height * 4)} RGBA values, received ${String(source.length)}.`);
  const output = new Uint8Array(source.length); const radiusSquared = radius * radius;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const inside = (source[(y * width + x) * 4 + 3] ?? 0) >= 128; let best = radiusSquared;
    const y0 = Math.max(0, y - radius); const y1 = Math.min(height - 1, y + radius); const x0 = Math.max(0, x - radius); const x1 = Math.min(width - 1, x + radius);
    for (let sy = y0; sy <= y1; sy += 1) for (let sx = x0; sx <= x1; sx += 1) { const other = (source[(sy * width + sx) * 4 + 3] ?? 0) >= 128; if (other === inside) continue; const dx = sx - x; const dy = sy - y; best = Math.min(best, dx * dx + dy * dy); }
    const signed = (inside ? 1 : -1) * Math.sqrt(best); const alpha = Math.round(128 + signed / radius * 127); const index = (y * width + x) * 4; output[index] = 255; output[index + 1] = 255; output[index + 2] = 255; output[index + 3] = Math.max(0, Math.min(255, alpha));
  }
  return output;
}

function uniqueGraphemes(value: string): string[] { const Segmenter = Intl.Segmenter; const parts = Segmenter === undefined ? Array.from(value) : [...new Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map((part) => part.segment); return [...new Set(parts)]; }
function nextPowerOfTwo(value: number): number { return 2 ** Math.ceil(Math.log2(Math.max(1, value))); }
function nonEmpty(value: string, label: string): string { if (!value.trim()) throw new Error(`${label} must not be empty.`); return value; }
function positiveInteger(value: number, label: string): number { if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`); return value; }
function nonNegativeInteger(value: number, label: string): number { if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`); return value; }
