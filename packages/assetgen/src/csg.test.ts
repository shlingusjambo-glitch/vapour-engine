import { describe, expect, it } from "vitest";
import {
  box, cylinder, extrudeProfile, intersect, isClosed, meshBounds, meshStats, rectangleProfile,
  signedVolume, sphere, subtract, subtractAll, translateMesh, union, unionAll, weldVertices,
} from "./index.js";

/** Booleans must preserve the properties everything downstream depends on: the
 * result has to stay a closed, outward-wound solid, or physics and navigation
 * generated from it are wrong in ways that only show up in play. */
function expectSolid(mesh: ReturnType<typeof box>, expectedVolume?: number): void {
  expect(isClosed(weldVertices(mesh))).toBe(true);
  expect(signedVolume(mesh)).toBeGreaterThan(0);
  if (expectedVolume !== undefined) expect(signedVolume(mesh)).toBeCloseTo(expectedVolume, 3);
}

describe("subtract", () => {
  it("cuts a hole through a wall", () => {
    const wall = box({ width: 4, height: 3, depth: 0.2 });
    const window = box({ width: 1, height: 1, depth: 1 });
    const result = subtract(wall, window);
    expectSolid(result, 4 * 3 * 0.2 - 1 * 1 * 0.2);
  });

  it("cuts a notch that only partly overlaps", () => {
    const base = box({ width: 2, height: 2, depth: 2 });
    const corner = translateMesh(box({ width: 2, height: 2, depth: 2 }), [1, 1, 1]);
    // The cutter removes exactly one eighth of the base.
    expectSolid(subtract(base, corner), 8 - 1);
  });

  it("returns the original when the cutter misses entirely", () => {
    const base = box();
    const away = translateMesh(box(), [10, 0, 0]);
    expectSolid(subtract(base, away), 1);
  });

  it("bores a cylindrical hole, producing a pipe", () => {
    const outer = cylinder({ radius: 1, height: 2, segments: 32 });
    const inner = cylinder({ radius: 0.5, height: 4, segments: 32 });
    const pipe = subtract(outer, inner);
    // Volume of the annulus, within the tolerance of a 32-sided approximation.
    expect(signedVolume(pipe)).toBeCloseTo(Math.PI * (1 - 0.25) * 2, 0);
    expect(isClosed(weldVertices(pipe))).toBe(true);
  });

  it("cuts many windows in one pass", () => {
    const facade = box({ width: 10, height: 4, depth: 0.3 });
    const windows = [-3, -1, 1, 3].map((x) => translateMesh(box({ width: 1, height: 1.5, depth: 1 }), [x, 0.5, 0]));
    const result = subtractAll(facade, windows);
    expectSolid(result, 10 * 4 * 0.3 - 4 * (1 * 1.5 * 0.3));
  });

  it("leaves nothing behind when the cutter swallows the base", () => {
    const result = subtract(box(), box({ width: 4, height: 4, depth: 4 }));
    expect(meshStats(result).triangles).toBe(0);
  });
});

describe("union", () => {
  it("merges two overlapping boxes without doubling the shared volume", () => {
    const a = box({ width: 2, height: 2, depth: 2 });
    const b = translateMesh(box({ width: 2, height: 2, depth: 2 }), [1, 0, 0]);
    // Two 8-unit boxes overlapping by 4 units.
    expectSolid(union(a, b), 8 + 8 - 4);
  });

  it("merges disjoint solids into one mesh", () => {
    const result = union(box(), translateMesh(box(), [5, 0, 0]));
    expectSolid(result, 2);
    expect(meshBounds(result).max[0]).toBeCloseTo(5.5);
  });

  it("resolves two solids sharing a face into a single surface", () => {
    const a = box({ width: 2, height: 2, depth: 2 });
    const b = translateMesh(box({ width: 2, height: 2, depth: 2 }), [2, 0, 0]);
    expectSolid(union(a, b), 16);
  });

  it("unions a list", () => {
    const parts = [0, 3, 6].map((x) => translateMesh(box(), [x, 0, 0]));
    expectSolid(unionAll(parts), 3);
    expect(() => unionAll([])).toThrow(/at least one mesh/);
  });
});

describe("intersect", () => {
  it("keeps only the shared volume", () => {
    const a = box({ width: 2, height: 2, depth: 2 });
    const b = translateMesh(box({ width: 2, height: 2, depth: 2 }), [1, 0, 0]);
    expectSolid(intersect(a, b), 4);
  });

  it("produces nothing for disjoint solids", () => {
    expect(meshStats(intersect(box(), translateMesh(box(), [10, 0, 0]))).triangles).toBe(0);
  });

  it("clips a sphere to a box", () => {
    const clipped = intersect(sphere({ radius: 1, segments: 24, rings: 16 }), box({ width: 1, height: 4, depth: 4 }));
    expect(isClosed(weldVertices(clipped))).toBe(true);
    // Narrower than the sphere on X, still full width on Y.
    expect(meshBounds(clipped).max[0]).toBeCloseTo(0.5, 2);
    expect(meshBounds(clipped).max[1]).toBeGreaterThan(0.8);
  });
});

describe("operand validation", () => {
  it("refuses an open surface, explaining what to do about it", () => {
    const open = extrudeProfile(rectangleProfile(1, 1), { depth: 1, capped: false });
    expect(() => subtract(box(), open)).toThrow(/not a closed solid.*cap the open ends/s);
    expect(() => union(open, box())).toThrow(/first operand is not a closed solid/);
  });

  it("preserves material slots through a cut", () => {
    const wall = box({ width: 4, height: 3, depth: 0.2 });
    const withSlots = { ...wall, materialSlots: new Uint16Array(meshStats(wall).triangles).fill(3) };
    const result = subtract(withSlots, box({ width: 1, height: 1, depth: 1 }));
    expect(new Set(result.materialSlots ?? [])).toContain(3);
  });

  it("composes: a hollow room with a doorway", () => {
    const shell = box({ width: 6, height: 3, depth: 5 });
    const cavity = box({ width: 5.6, height: 2.6, depth: 4.6 });
    const doorway = translateMesh(box({ width: 1, height: 2.1, depth: 2 }), [0, -0.45, 2.5]);
    const room = subtractAll(shell, [cavity, doorway]);
    expectSolid(room);
    // A shell, not a solid block: most of the volume was removed.
    expect(signedVolume(room)).toBeLessThan(signedVolume(shell) * 0.3);
  });
});
