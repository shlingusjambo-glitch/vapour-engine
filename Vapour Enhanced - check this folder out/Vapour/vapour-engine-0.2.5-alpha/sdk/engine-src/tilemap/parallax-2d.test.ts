import { describe, expect, it } from "vitest";
import { parallaxOffset, type ParallaxLayer2D } from "./parallax-2d.js";

describe("parallax-2d", () => {
  it("scrolls slower than the camera below factor 1", () => {
    const background: ParallaxLayer2D = { factor: [0.5, 0.5] };
    expect(parallaxOffset(background, [100, 40])).toEqual([50, 20]);
  });

  it("stays fixed to the screen at factor 0", () => {
    const ui: ParallaxLayer2D = { factor: [0, 0], offset: [10, 20] };
    expect(parallaxOffset(ui, [500, -500])).toEqual([10, 20]);
  });

  it("moves at camera speed at factor 1 (no parallax)", () => {
    const foreground: ParallaxLayer2D = { factor: [1, 1] };
    expect(parallaxOffset(foreground, [12, -7])).toEqual([12, -7]);
  });

  it("wraps a repeating backdrop into its tile size", () => {
    const sky: ParallaxLayer2D = { factor: [0.2, 0], wrap: [64, 0] };
    const [x] = parallaxOffset(sky, [1000, 0]);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(64);
    expect(x).toBeCloseTo(((1000 * 0.2) % 64 + 64) % 64, 6);
  });

  it("wraps negative offsets into the positive range", () => {
    const sky: ParallaxLayer2D = { factor: [1, 0], wrap: [64, 0] };
    const [x] = parallaxOffset(sky, [-10, 0]);
    expect(x).toBe(54);
  });
});
