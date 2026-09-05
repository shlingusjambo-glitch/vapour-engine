/** Colour representation and colour-space conversion.
 *
 * Vapour stores authored colours as sRGB in scene JSON because that is what
 * artists, pickers, and hex codes speak, and converts to linear space before
 * lighting maths. Mixing the two silently is the most common source of washed
 * out or over-dark rendering, so the conversion is explicit here rather than
 * hidden inside the renderer.
 */
import { lerp, saturate } from "./scalar.js";

/** Non-premultiplied RGBA with components in `[0, 1]`. */
export type Rgba = [number, number, number, number];
export type RgbaLike = readonly number[];

export const COLOR_WHITE: Rgba = [1, 1, 1, 1];
export const COLOR_BLACK: Rgba = [0, 0, 0, 1];
export const COLOR_TRANSPARENT: Rgba = [0, 0, 0, 0];

export function rgba(r = 0, g = 0, b = 0, a = 1): Rgba {
  return [saturate(r), saturate(g), saturate(b), saturate(a)];
}

export function toRgba(value: RgbaLike, label = "A colour"): Rgba {
  if (value.length < 3) throw new Error(`${label} requires at least three components.`);
  const out: Rgba = [value[0]!, value[1]!, value[2]!, value[3] ?? 1];
  if (out.some((component) => !Number.isFinite(component))) throw new Error(`${label} requires finite components.`);
  return out;
}

/** Parses `#rgb`, `#rgba`, `#rrggbb`, or `#rrggbbaa` into sRGB components. */
export function rgbaFromHex(hex: string): Rgba {
  const text = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(text) || ![3, 4, 6, 8].includes(text.length)) {
    throw new Error(`"${hex}" is not a hex colour. Expected #rgb, #rgba, #rrggbb, or #rrggbbaa.`);
  }
  const short = text.length <= 4;
  const size = short ? 1 : 2;
  const channel = (index: number): number => {
    const slice = text.slice(index * size, index * size + size);
    return Number.parseInt(short ? slice + slice : slice, 16) / 255;
  };
  const alpha = text.length === 4 || text.length === 8 ? channel(3) : 1;
  return [channel(0), channel(1), channel(2), alpha];
}

export function rgbaToHex(value: RgbaLike, includeAlpha = false): string {
  const byte = (component: number): string =>
    Math.round(saturate(component) * 255)
      .toString(16)
      .padStart(2, "0");
  const base = `#${byte(value[0]!)}${byte(value[1]!)}${byte(value[2]!)}`;
  return includeAlpha ? `${base}${byte(value[3] ?? 1)}` : base;
}

/** sRGB transfer function applied to one channel. */
export function linearToSrgbChannel(value: number): number {
  const v = saturate(value);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

export function srgbToLinearChannel(value: number): number {
  const v = saturate(value);
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Converts an authored sRGB colour to the linear space lighting works in.
 * Alpha is a coverage value, not a colour, so it is left untouched. */
export function srgbToLinear(value: RgbaLike): Rgba {
  return [srgbToLinearChannel(value[0]!), srgbToLinearChannel(value[1]!), srgbToLinearChannel(value[2]!), value[3] ?? 1];
}

export function linearToSrgb(value: RgbaLike): Rgba {
  return [linearToSrgbChannel(value[0]!), linearToSrgbChannel(value[1]!), linearToSrgbChannel(value[2]!), value[3] ?? 1];
}

/** Interpolates in whichever space the inputs are already in. */
export function lerpColor(a: RgbaLike, b: RgbaLike, t: number): Rgba {
  return [
    lerp(a[0]!, b[0]!, t),
    lerp(a[1]!, b[1]!, t),
    lerp(a[2]!, b[2]!, t),
    lerp(a[3] ?? 1, b[3] ?? 1, t),
  ];
}

/** Multiplies RGB by alpha, the form the renderer's blend state expects. */
export function premultiply(value: RgbaLike): Rgba {
  const alpha = value[3] ?? 1;
  return [value[0]! * alpha, value[1]! * alpha, value[2]! * alpha, alpha];
}

/** Rec. 709 relative luminance of a **linear** colour. */
export function luminance(value: RgbaLike): number {
  return 0.2126 * value[0]! + 0.7152 * value[1]! + 0.0722 * value[2]!;
}

/** Hue in degrees, saturation and value in `[0, 1]`, to sRGB. */
export function rgbaFromHsv(hueDegrees: number, saturation: number, value: number, alpha = 1): Rgba {
  const h = ((hueDegrees % 360) + 360) % 360 / 60;
  const s = saturate(saturation);
  const v = saturate(value);
  const chroma = v * s;
  const secondary = chroma * (1 - Math.abs((h % 2) - 1));
  const sector = Math.floor(h) % 6;
  const rgb: readonly [number, number, number][] = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ];
  const [r, g, b] = rgb[sector]!;
  const match = v - chroma;
  return [r + match, g + match, b + match, saturate(alpha)];
}
