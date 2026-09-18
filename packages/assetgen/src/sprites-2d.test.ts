import { describe, expect, it } from "vitest";
import { generateCharacterSprite, generatePanelSprite, packAtlas, spriteAsset, type PixelBuffer } from "./sprites-2d.js";

const pixel = (buffer: PixelBuffer, x: number, y: number): number[] => [...buffer.pixels.subarray((y * buffer.width + x) * 4, (y * buffer.width + x) * 4 + 4)];
const byte = (value: number): number => Math.round(value * 255);

describe("generateCharacterSprite", () => {
  it("bakes the requested size with a transparent surround and an opaque body", () => {
    const sprite = generateCharacterSprite({ width: 32, height: 48 });
    expect(sprite.pixels.length).toBe(32 * 48 * 4);
    expect(pixel(sprite, 0, 0)[3]).toBe(0);
    expect(pixel(sprite, 16, 24)[3]).toBe(255);
    expect(pixel(sprite, 16, 46)[3]).toBe(255);
    expect(new Set(sprite.pixels).size).toBeGreaterThan(8);
  });

  it("uses the palette and is deterministic", () => {
    const shirt = [0.1, 0.9, 0.2, 1] as const;
    const sprite = generateCharacterSprite({ palette: { shirt } });
    expect(pixel(sprite, 16, 20)).toEqual(shirt.map(byte));
    expect([...generateCharacterSprite({ palette: { shirt } }).pixels]).toEqual([...sprite.pixels]);
  });

  it("differs per facing and mirrors left against right", () => {
    const front = generateCharacterSprite({ facing: "front" });
    const left = generateCharacterSprite({ facing: "left" });
    const right = generateCharacterSprite({ facing: "right" });
    expect([...left.pixels]).not.toEqual([...front.pixels]);
    const opaque = (buffer: PixelBuffer): number => buffer.pixels.filter((_, index) => index % 4 === 3 && buffer.pixels[index]! > 0).length;
    // Side views hide the far arm, so they carry fewer opaque texels than the front.
    expect(opaque(left)).toBeLessThan(opaque(front));
    expect(opaque(left)).toBe(opaque(right));
  });

  it("rejects impossible proportions", () => {
    expect(() => generateCharacterSprite({ headFraction: 0.9 })).toThrow(/headFraction/);
    expect(() => generateCharacterSprite({ width: 2 })).toThrow(/Sprite width/);
  });
});

describe("generatePanelSprite", () => {
  it("has an opaque border, a flat fill in the centre, and rounded corners", () => {
    const fill = [0.2, 0.3, 0.4, 1] as const;
    const panel = generatePanelSprite({ width: 32, height: 24, border: 4, radius: 6, fill, borderColor: [1, 1, 1, 1] });
    expect(panel.border).toEqual([4, 4, 4, 4]);
    expect(pixel(panel, 16, 1)).toEqual([255, 255, 255, 255]);
    expect(pixel(panel, 1, 12)).toEqual([255, 255, 255, 255]);
    expect(pixel(panel, 16, 22)).toEqual([255, 255, 255, 255]);
    expect(pixel(panel, 30, 12)).toEqual([255, 255, 255, 255]);
    // Every pixel inside the border (past the 2 px inner corner radius) is fill.
    for (let y = 4; y < 20; y += 1) for (let x = 4; x < 28; x += 1) {
      const inCorner = (x < 6 || x >= 26) && (y < 6 || y >= 18);
      if (!inCorner) expect(pixel(panel, x, y)).toEqual(fill.map(byte));
    }
    expect(pixel(panel, 4, 12)).toEqual(fill.map(byte));
    expect(pixel(panel, 16, 4)).toEqual(fill.map(byte));
    expect(pixel(panel, 0, 0)[3]).toBe(0);
    expect(pixel(panel, 31, 23)[3]).toBe(0);
  });

  it("adds a highlight band for buttons and validates the border", () => {
    const button = generatePanelSprite({ width: 32, height: 32, border: 3, highlight: [1, 1, 1, 1], fill: [0, 0, 0, 1] });
    expect(pixel(button, 16, 4)).toEqual([255, 255, 255, 255]);
    expect(pixel(button, 16, 16)).toEqual([0, 0, 0, 255]);
    expect(() => generatePanelSprite({ width: 8, border: 4 })).toThrow(/border/);
  });
});

describe("packAtlas", () => {
  const solid = (name: string, width: number, height: number, value: number): { name: string; width: number; height: number; pixels: Uint8Array } => ({
    name,
    width,
    height,
    pixels: new Uint8Array(width * height * 4).fill(value),
  });

  it("packs without overlaps, into power-of-two dimensions, with regions by name", () => {
    const entries = [solid("a", 20, 30, 10), solid("b", 40, 10, 20), solid("c", 8, 8, 30), solid("d", 33, 33, 40), solid("e", 5, 60, 50)];
    const atlas = packAtlas(entries, { padding: 1 });
    expect(Math.log2(atlas.width) % 1).toBe(0);
    expect(Math.log2(atlas.height) % 1).toBe(0);
    expect(atlas.pixels.length).toBe(atlas.width * atlas.height * 4);
    expect(Object.keys(atlas.regions).sort()).toEqual(["a", "b", "c", "d", "e"]);
    const rects = Object.values(atlas.regions).map((region) => region.rect);
    for (const [i, a] of rects.entries()) {
      expect(a[0] + a[2]).toBeLessThanOrEqual(atlas.width);
      expect(a[1] + a[3]).toBeLessThanOrEqual(atlas.height);
      for (const [j, b] of rects.entries()) {
        if (i === j) continue;
        const overlap = a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
        expect(overlap).toBe(false);
      }
    }
    // Pixels land where the region says, and the padding stays transparent.
    for (const entry of entries) {
      const [x, y, w, h] = atlas.regions[entry.name]!.rect;
      expect([w, h]).toEqual([entry.width, entry.height]);
      expect(pixel(atlas, x, y)).toEqual([entry.pixels[0], entry.pixels[0], entry.pixels[0], entry.pixels[0]]);
      expect(pixel(atlas, x + w - 1, y + h - 1)[0]).toBe(entry.pixels[0]);
      expect(pixel(atlas, x - 1, y)[3]).toBe(0);
    }
  });

  it("is independent of input order and carries pivot and border through", () => {
    const a = packAtlas([solid("x", 4, 4, 1), { ...solid("y", 6, 6, 2), pivot: [0, 0], border: [1, 1, 1, 1] }]);
    const b = packAtlas([{ ...solid("y", 6, 6, 2), pivot: [0, 0], border: [1, 1, 1, 1] }, solid("x", 4, 4, 1)]);
    expect(b.regions).toEqual(a.regions);
    expect([...b.pixels]).toEqual([...a.pixels]);
    expect(a.regions["y"]).toEqual({ name: "y", rect: [1, 1, 6, 6], pivot: [0, 0], border: [1, 1, 1, 1] });
    expect(a.regions["x"]!.pivot).toEqual([0.5, 0.5]);
  });

  it("shapes a region as an engine sprite asset and rejects unknown names", () => {
    const panel = generatePanelSprite({ width: 16, height: 16, border: 2 });
    const atlas = packAtlas([{ name: "panel", ...panel }, { name: "hero", ...generateCharacterSprite({ width: 16, height: 24 }), pivot: [0.5, 0] }]);
    const asset = spriteAsset(atlas, "panel", "material:ui", 16);
    expect(asset).toEqual({
      id: "panel",
      material: "material:ui",
      textureSize: [atlas.width, atlas.height],
      rect: atlas.regions["panel"]!.rect,
      pivot: [0.5, 0.5],
      border: [2, 2, 2, 2],
      pixelsPerUnit: 16,
    });
    expect(spriteAsset(atlas, "hero", "material:ui").pivot).toEqual([0.5, 0]);
    expect(() => spriteAsset(atlas, "villain", "material:ui")).toThrow(/No sprite named "villain"/);
  });

  it("rejects duplicate names and mismatched buffers", () => {
    expect(() => packAtlas([solid("a", 2, 2, 0), solid("a", 2, 2, 0)])).toThrow(/unique/);
    expect(() => packAtlas([{ name: "a", width: 2, height: 2, pixels: new Uint8Array(3) }])).toThrow(/bytes/);
    expect(() => packAtlas([])).toThrow(/at least one/);
  });
});
