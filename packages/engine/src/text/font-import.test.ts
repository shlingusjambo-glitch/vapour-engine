import { describe, expect, it } from "vitest";
import { generateSignedDistanceAlpha, importBrowserFont } from "./font-import.js";

describe("font import", () => {
  it("generates signed distance coverage with inside above and outside below midpoint", () => {
    const source = new Uint8Array(5 * 5 * 4); source[(2 * 5 + 2) * 4 + 3] = 255;
    const sdf = generateSignedDistanceAlpha(5, 5, source, 2);
    expect(sdf[(2 * 5 + 2) * 4 + 3]).toBeGreaterThan(128);
    expect(sdf[3]).toBeLessThan(128); expect(sdf[0]).toBe(255);
  });

  it("rejects malformed SDF buffers before processing", () => {
    expect(() => generateSignedDistanceAlpha(2, 2, new Uint8Array(3), 2)).toThrow(/needs 16/);
    expect(() => generateSignedDistanceAlpha(2, 2, new Uint8Array(16), 0)).toThrow(/positive integer/);
  });

  it("explains that browser font importing needs Canvas when headless", async () => {
    await expect(importBrowserFont({ id: "font", material: "mat", family: "sans", characters: "A" })).rejects.toThrow(/document.*Canvas 2D/);
  });
});
