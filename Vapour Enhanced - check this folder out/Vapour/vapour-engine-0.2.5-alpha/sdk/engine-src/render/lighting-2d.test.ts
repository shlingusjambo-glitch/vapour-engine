import { describe, expect, it } from "vitest";
import {
  accumulateLightGrid,
  accumulateLighting2D,
  lightAttenuation,
  type Light2D,
} from "./lighting-2d.js";

describe("lighting-2d", () => {
  it("computes a point light's intensity at three distances", () => {
    const light: Light2D = { kind: "point", position: [0, 0], radius: 10, intensity: 1 };
    const near = lightAttenuation(light, [1, 0]);
    const mid = lightAttenuation(light, [5, 0]);
    const far = lightAttenuation(light, [9.9, 0]);
    console.log(
      `M115 light attenuation: near(d=1)=${near.toFixed(4)} mid(d=5)=${mid.toFixed(4)} far(d=9.9)=${far.toFixed(4)}`,
    );
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(lightAttenuation(light, [10, 0])).toBe(0); // exactly at radius: dark
    expect(lightAttenuation(light, [20, 0])).toBe(0); // well outside: dark
  });

  it("falls off linearly or quadratically as configured", () => {
    const base = { kind: "point" as const, position: [0, 0] as const, radius: 10, intensity: 1 };
    const linear = lightAttenuation({ ...base, falloff: "linear" }, [5, 0]);
    const quadratic = lightAttenuation({ ...base, falloff: "quadratic" }, [5, 0]);
    expect(linear).toBeCloseTo(0.5, 6);
    expect(quadratic).toBeCloseTo(0.25, 6);
  });

  it("a global light is uniform everywhere", () => {
    const light: Light2D = { kind: "global", color: [1, 1, 1], intensity: 0.3 };
    expect(lightAttenuation(light, [0, 0])).toBe(1);
    expect(lightAttenuation(light, [1000, -1000])).toBe(1);
  });

  it("a spot light fades out past its cone angle", () => {
    const light: Light2D = {
      kind: "spot",
      position: [0, 0],
      radius: 10,
      direction: 0,
      coneAngle: Math.PI / 8,
      intensity: 1,
    };
    expect(lightAttenuation(light, [5, 0])).toBeGreaterThan(0); // straight ahead
    expect(lightAttenuation(light, [0, 5])).toBe(0); // 90 degrees off-axis
  });

  it("sums multiple lights plus ambient", () => {
    const lights: Light2D[] = [
      { kind: "point", position: [0, 0], radius: 5, color: [1, 0, 0], intensity: 1 },
      { kind: "point", position: [0, 0], radius: 5, color: [0, 1, 0], intensity: 1 },
    ];
    const [r, g, b] = accumulateLighting2D(lights, [0, 0], [0, 0, 0.1]);
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(1, 6);
    expect(b).toBeCloseTo(0.1, 6);
  });

  it("bakes a per-cell light grid matching the point sample", () => {
    const lights: Light2D[] = [{ kind: "point", position: [1.5, 1.5], radius: 4, intensity: 1 }];
    const grid = accumulateLightGrid(lights, { width: 3, height: 3, cellSize: 1 });
    expect(grid.colors).toHaveLength(3 * 3 * 3);
    // Cell (1,1)'s centre is exactly the light's position: brightest cell.
    const centerIndex = (1 * 3 + 1) * 3;
    const cornerIndex = 0;
    expect(grid.colors[centerIndex]).toBeGreaterThan(grid.colors[cornerIndex]!);
  });
});
