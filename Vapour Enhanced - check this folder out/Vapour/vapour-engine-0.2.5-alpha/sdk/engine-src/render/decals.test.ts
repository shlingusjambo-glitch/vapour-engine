import { describe, expect, it } from "vitest";
import { DECAL_STRIDE, decalLocalUv, packDecals } from "./decals.js";

// Column-major translate(2, 0, 0) * scale(4, 2, 1).
const box = [4, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1];

describe("decals", () => {
  it("projects a known world point to the expected decal-local uv", () => {
    // Matches the Rust reference test in decal.rs exactly.
    expect(decalLocalUv(box, [3, 0.5, 0])).toEqual({ u: 0.75, v: 0.25, depth: 0 });
    expect(decalLocalUv(box, [2, 0, 0.25])).toEqual({ u: 0.5, v: 0.5, depth: 0.25 });
    expect(decalLocalUv(box, [0, 1, -0.5])).toEqual({ u: 0, v: 0, depth: -0.5 });
    expect(decalLocalUv(box, [4.01, 0, 0])).toBeUndefined();
    expect(decalLocalUv(box, [2, 0, 0.51])).toBeUndefined();
    expect(decalLocalUv(new Array<number>(16).fill(0), [0, 0, 0])).toBeUndefined();
  });

  it("packs records in the renderer's layout with validated defaults", () => {
    const packed = packDecals([
      { matrix: box },
      {
        matrix: box,
        region: [0.5, 0, 1, 0.5],
        tint: [1, 0.5, 0.25, 0.8],
        opacity: 0.6,
        angleCutoff: 0.5,
        angleSoftness: 0.1,
        zFade: 0.5,
      },
    ]);
    expect(packed.length).toBe(2 * DECAL_STRIDE);
    expect([...packed.subarray(0, 16)]).toEqual(box);
    expect([...packed.subarray(16, 28)].map((v) => Math.round(v * 100) / 100)).toEqual([
      0, 0, 1, 1, 1, 1, 1, 1, 1, 0.35, 0.2, 0.25,
    ]);
    expect([...packed.subarray(28 + 16, 56)].map((v) => Math.round(v * 100) / 100)).toEqual([
      0.5, 0, 1, 0.5, 1, 0.5, 0.25, 0.8, 0.6, 0.5, 0.1, 0.5,
    ]);
    expect(() => packDecals([{ matrix: box, region: [0, 0, 1.5, 1] }])).toThrow(/region/);
    expect(() => packDecals([{ matrix: box, opacity: 2 }])).toThrow(/opacity/);
    expect(() =>
      packDecals([{ matrix: new Array<number>(16).fill(0) }]),
    ).toThrow(/singular/);
    expect(() => packDecals([{ matrix: box.slice(1) }])).toThrow(/16-value/);
  });
});
