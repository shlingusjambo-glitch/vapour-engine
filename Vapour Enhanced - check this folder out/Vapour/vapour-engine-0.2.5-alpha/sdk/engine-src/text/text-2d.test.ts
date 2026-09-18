import { describe, expect, it } from "vitest";
import { layoutText2D, type FontAtlas } from "./text-2d.js";

const font: FontAtlas = {
  id: "font:test", material: "material:font", textureSize: [64, 32], designSize: 10, lineHeight: 12,
  glyphs: [
    { character: "A", rect: [0, 0, 8, 10], advance: 8, bearing: [0, 8] },
    { character: "B", rect: [8, 0, 7, 10], advance: 7, bearing: [0, 8] },
    { character: "?", rect: [15, 0, 6, 10], advance: 6, bearing: [0, 8] },
    { character: " ", rect: [0, 0, 0, 0], advance: 4, bearing: [0, 0] },
  ],
  kerning: { "A\0B": -1 }, fallbackCharacter: "?",
};

describe("layoutText2D", () => {
  it("lays out, kerns, wraps, aligns, and produces indexed atlas geometry", () => {
    const result = layoutText2D(font, "AB A", { fontSize: 10, maxWidth: 15, alignment: "right" });
    expect(result.lineCount).toBe(2);
    expect(result.glyphCount).toBe(3);
    expect(result.width).toBe(14);
    expect(result.mesh.indices).toHaveLength(18);
    expect(result.mesh.uvs).toHaveLength(24);
  });

  it("maps documented top-left atlas rectangles without requiring row flips", () => {
    const result = layoutText2D(font, "A", { fontSize: 10 });
    expect(Array.from(result.mesh.uvs!)).toEqual([0, 10 / 32, 8 / 64, 10 / 32, 8 / 64, 0, 0, 0]);
  });

  it("uses a declared fallback and rejects a missing one with context", () => {
    expect(layoutText2D(font, "👍🏽", { fontSize: 10 }).glyphCount).toBe(1);
    const { fallbackCharacter: _fallback, ...withoutFallback } = font;
    expect(() => layoutText2D(withoutFallback, "X", { fontSize: 10 })).toThrow(/font:test.*X/);
  });

  it("rejects duplicate or out-of-atlas glyph metadata", () => {
    expect(() => layoutText2D({ ...font, glyphs: [...font.glyphs, font.glyphs[0]!] }, "A", { fontSize: 10 })).toThrow(/duplicate glyph/);
    expect(() => layoutText2D({ ...font, glyphs: [{ character: "A", rect: [60, 0, 8, 10], advance: 8, bearing: [0, 0] }] }, "A", { fontSize: 10 })).toThrow(/out-of-bounds/);
  });
});
