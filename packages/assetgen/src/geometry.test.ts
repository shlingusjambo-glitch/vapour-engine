import { describe, expect, it } from "vitest";
import {
  MeshBuilder, box, capsule, centerMesh, circleProfile, computeNormals, cone, cylinder,
  emptyMesh, extrudeProfile, fitMesh, flipMesh, gridMesh, isClosed, loftProfiles, meshBounds,
  meshStats, mergeMeshes, mirrorMesh, plane, polygonProfile, profile, profileArea,
  rectangleProfile, repeatMesh, revolveProfile, rotateMesh, roundedRectangleProfile, scaleMesh,
  repairTJunctions, signedArea, signedVolume, sphere, subtract, surfaceArea, sweepProfile,
  torus, translateMesh, triangulateProfile, validateMesh, weldVertices,
} from "./index.js";

describe("MeshBuilder and validation", () => {
  it("builds a triangle", () => {
    const builder = new MeshBuilder();
    const a = builder.vertex([0, 0, 0]);
    const b = builder.vertex([1, 0, 0]);
    const c = builder.vertex([0, 1, 0]);
    const mesh = builder.triangle(a, b, c).build();
    expect(meshStats(mesh)).toMatchObject({ vertices: 3, triangles: 1, hasNormals: false });
  });

  it("rejects a triangle referencing a vertex that does not exist", () => {
    const builder = new MeshBuilder();
    builder.vertex([0, 0, 0]);
    expect(() => builder.triangle(0, 1, 2)).toThrow(/references vertex 1, but the builder has 1 vertices/);
  });

  it("back-fills attributes added partway through", () => {
    const builder = new MeshBuilder();
    builder.vertex([0, 0, 0]);
    builder.vertex([1, 0, 0], { uv: [1, 0] });
    builder.vertex([0, 1, 0], { uv: [0, 1] });
    const mesh = builder.triangle(0, 1, 2).build();
    expect(mesh.uvs).toHaveLength(6);
    expect([...mesh.uvs!.slice(0, 2)]).toEqual([0, 0]);
  });

  it("tracks material slots only when more than one is used", () => {
    const single = new MeshBuilder();
    single.vertex([0, 0, 0]); single.vertex([1, 0, 0]); single.vertex([0, 1, 0]);
    expect(single.triangle(0, 1, 2).build().materialSlots).toBeUndefined();

    const multi = new MeshBuilder();
    multi.vertex([0, 0, 0]); multi.vertex([1, 0, 0]); multi.vertex([0, 1, 0]);
    multi.setMaterialSlot(2).triangle(0, 1, 2);
    expect([...multi.build().materialSlots!]).toEqual([2]);
    expect(() => multi.setMaterialSlot(-1)).toThrow(/whole number in \[0, 65535\]/);
  });

  it("catches inconsistent meshes with an actionable message", () => {
    expect(() => validateMesh({ positions: new Float32Array([0, 0]), indices: new Uint32Array() })).toThrow(/not a multiple of three/);
    expect(() => validateMesh({ positions: new Float32Array(9), indices: new Uint32Array([0, 1]) })).toThrow(/indices, which is not a multiple of three/);
    expect(() => validateMesh({ positions: new Float32Array(9), indices: new Uint32Array([0, 1, 7]) })).toThrow(/index 7 at position 2, but only 3 vertices/);
    expect(() => validateMesh({ positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), normals: new Float32Array(6) })).toThrow(/3 vertices but 2 normals/);
    expect(() => validateMesh({ positions: new Float32Array([0, 0, Number.NaN]), indices: new Uint32Array() })).toThrow(/non-finite position/);
  });

  it("appends and merges meshes, offsetting indices", () => {
    const merged = mergeMeshes([box(), translateMesh(box(), [5, 0, 0])]);
    expect(meshStats(merged).triangles).toBe(meshStats(box()).triangles * 2);
    expect(meshBounds(merged).max[0]).toBeCloseTo(5.5);
    expect(meshStats(mergeMeshes([])).triangles).toBe(0);
    expect(meshStats(emptyMesh()).vertices).toBe(0);
  });
});

describe("primitives", () => {
  it("produces closed solids", () => {
    for (const mesh of [box(), sphere({ segments: 8, rings: 6 }), cylinder({ segments: 8 }), capsule({ segments: 8, rings: 3 }), torus({ segments: 8, tubeSegments: 6 })]) {
      expect(isClosed(weldVertices(mesh))).toBe(true);
    }
  });

  it("winds solids outward, so volume is positive", () => {
    expect(signedVolume(box())).toBeCloseTo(1, 5);
    expect(signedVolume(box({ width: 2, height: 3, depth: 4 }))).toBeCloseTo(24, 4);
    expect(signedVolume(sphere({ radius: 1, segments: 64, rings: 48 }))).toBeCloseTo((4 / 3) * Math.PI, 1);
    expect(signedVolume(cylinder({ radius: 1, height: 2, segments: 64 }))).toBeCloseTo(2 * Math.PI, 1);
  });

  it("centres primitives on the origin", () => {
    const bounds = meshBounds(box({ width: 2, height: 4, depth: 6 }));
    expect(bounds.min).toEqual([-1, -2, -3]);
    expect(bounds.max).toEqual([1, 2, 3]);
  });

  it("makes a cone by collapsing the top radius", () => {
    const shape = cone({ radius: 1, height: 2, segments: 32 });
    expect(signedVolume(shape)).toBeCloseTo((Math.PI * 2) / 3, 1);
    expect(isClosed(weldVertices(shape))).toBe(true);
  });

  it("tilts cone side normals with the slope rather than leaving them radial", () => {
    const shape = cone({ radius: 1, height: 1, segments: 8 });
    const normals = shape.normals!;
    // Some side normal must have a vertical component, or the cone shades flat.
    let maxY = 0;
    for (let index = 0; index < normals.length / 3; index += 1) maxY = Math.max(maxY, Math.abs(normals[index * 3 + 1]!));
    expect(maxY).toBeGreaterThan(0.1);
  });

  it("subdivides a plane and orients it", () => {
    expect(meshStats(plane({ segments: 4 })).triangles).toBe(32);
    expect(meshBounds(plane({ up: "y" })).max[1]).toBe(0);
    expect(meshBounds(plane({ up: "z" })).max[2]).toBe(0);
  });

  it("validates its parameters", () => {
    expect(() => box({ width: 0 })).toThrow(/Box width must be a positive/);
    expect(() => sphere({ segments: 2 })).toThrow(/at least 3/);
    expect(() => cylinder({ radius: 0, topRadius: 0 })).toThrow(/at least one non-zero radius/);
    expect(() => cylinder({ radius: -1 })).toThrow(/must not be negative/);
    expect(() => torus({ radius: 0 })).toThrow(/positive/);
  });
});

describe("transforms", () => {
  it("translates, rotates, and scales", () => {
    expect(meshBounds(translateMesh(box(), [10, 0, 0])).min[0]).toBeCloseTo(9.5);
    expect(meshBounds(scaleMesh(box(), 2)).max[0]).toBeCloseTo(1);
    const rotated = rotateMesh(box({ width: 4, height: 1, depth: 1 }), [0, 90, 0]);
    expect(meshBounds(rotated).max[2]).toBeCloseTo(2, 5);
  });

  it("keeps normals perpendicular under non-uniform scale", () => {
    const scaled = scaleMesh(computeNormals(sphere({ segments: 16, rings: 12 })), [1, 4, 1]);
    for (let index = 0; index < scaled.normals!.length / 3; index += 1) {
      const length = Math.hypot(scaled.normals![index * 3]!, scaled.normals![index * 3 + 1]!, scaled.normals![index * 3 + 2]!);
      expect(length).toBeCloseTo(1, 5);
    }
  });

  it("flips winding when mirroring, so a mirrored solid is not inside out", () => {
    const mirrored = mirrorMesh(box(), "x");
    expect(signedVolume(mirrored)).toBeGreaterThan(0);
    expect(signedVolume(flipMesh(box()))).toBeLessThan(0);
  });

  it("refuses a zero scale", () => {
    expect(() => scaleMesh(box(), [0, 1, 1])).toThrow(/collapses it/);
  });

  it("centres on a chosen anchor", () => {
    expect(meshBounds(centerMesh(translateMesh(box(), [5, 5, 5]))).min[1]).toBeCloseTo(-0.5);
    expect(meshBounds(centerMesh(box(), "base")).min[1]).toBeCloseTo(0);
    expect(meshBounds(centerMesh(box(), "top")).max[1]).toBeCloseTo(0);
  });

  it("fits a mesh to a target size", () => {
    const fitted = fitMesh(box({ width: 4, height: 1, depth: 1 }), 2);
    const bounds = meshBounds(fitted);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(2);
    expect(() => fitMesh(box(), 0)).toThrow(/must be positive/);
  });

  it("repeats along a line and on a grid", () => {
    expect(repeatMesh(box(), 4, [2, 0, 0])).toHaveLength(4);
    expect(meshBounds(mergeMeshes(repeatMesh(box(), 4, [2, 0, 0]))).max[0]).toBeCloseTo(6.5);
    expect(gridMesh(box(), 3, 2, [2, 0, 2])).toHaveLength(6);
    expect(() => repeatMesh(box(), 0, [1, 0, 0])).toThrow(/at least 1/);
  });
});

describe("welding and normals", () => {
  it("merges coincident vertices across cell boundaries", () => {
    const builder = new MeshBuilder();
    // Two triangles sharing an edge, with duplicated vertices at the seam.
    builder.vertex([0, 0, 0]); builder.vertex([1, 0, 0]); builder.vertex([0, 1, 0]);
    builder.vertex([1, 0, 0]); builder.vertex([1, 1, 0]); builder.vertex([0, 1, 0]);
    const welded = weldVertices(builder.triangle(0, 1, 2).triangle(3, 4, 5).build());
    expect(meshStats(welded).vertices).toBe(4);
    expect(meshStats(welded).triangles).toBe(2);
  });

  it("drops triangles that welding collapses", () => {
    const builder = new MeshBuilder();
    builder.vertex([0, 0, 0]); builder.vertex([1e-9, 0, 0]); builder.vertex([0, 1, 0]);
    expect(meshStats(weldVertices(builder.triangle(0, 1, 2).build())).triangles).toBe(0);
  });

  it("rejects a non-positive tolerance", () => {
    expect(() => weldVertices(box(), 0)).toThrow(/must be positive/);
  });

  it("computes unit-length smooth normals that follow the surface", () => {
    const shape = computeNormals(weldVertices(sphere({ radius: 1, segments: 24, rings: 16 })), { smooth: true });
    for (let index = 0; index < shape.normals!.length / 3; index += 1) {
      const [x, y, z] = [shape.positions[index * 3]!, shape.positions[index * 3 + 1]!, shape.positions[index * 3 + 2]!];
      const [nx, ny, nz] = [shape.normals![index * 3]!, shape.normals![index * 3 + 1]!, shape.normals![index * 3 + 2]!];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
      // On a unit sphere the normal points along the position.
      expect(nx * x + ny * y + nz * z).toBeGreaterThan(0.9);
    }
  });

  it("splits vertices for flat shading", () => {
    const flat = computeNormals(box(), { smooth: false });
    expect(meshStats(flat).vertices).toBe(meshStats(box()).triangles * 3);
  });

  it("measures area and volume", () => {
    expect(surfaceArea(box())).toBeCloseTo(6, 5);
    expect(surfaceArea(plane({ width: 2, depth: 3 }))).toBeCloseTo(6, 5);
    expect(signedVolume(emptyMesh())).toBe(0);
    expect(isClosed(emptyMesh())).toBe(false);
  });
});

describe("profiles", () => {
  it("normalizes winding so callers need not care", () => {
    const clockwise = profile([[0, 0], [0, 1], [1, 1], [1, 0]]);
    expect(signedArea(clockwise.outline)).toBeGreaterThan(0);
  });

  it("builds standard profiles", () => {
    expect(profileArea(rectangleProfile(2, 3))).toBeCloseTo(6);
    expect(profileArea(circleProfile(1, 128))).toBeCloseTo(Math.PI, 2);
    expect(profileArea(polygonProfile(6, 1))).toBeCloseTo((3 * Math.sqrt(3)) / 2, 5);
    expect(profileArea(roundedRectangleProfile(2, 2, 0.5, 8))).toBeLessThan(4);
    expect(profileArea(roundedRectangleProfile(2, 2, 0.5, 8))).toBeGreaterThan(3.5);
  });

  it("subtracts hole area", () => {
    const withHole = profile(rectangleProfile(4, 4).outline, [rectangleProfile(2, 2).outline]);
    expect(profileArea(withHole)).toBeCloseTo(12);
  });

  it("validates profile inputs", () => {
    expect(() => profile([[0, 0], [1, 1]])).toThrow(/at least three points/);
    expect(() => profile([[0, 0], [1, 0], [Number.NaN, 1]])).toThrow(/must be finite/);
    expect(() => rectangleProfile(0, 1)).toThrow(/must be positive/);
    expect(() => circleProfile(1, 2)).toThrow(/at least three segments/);
    expect(() => roundedRectangleProfile(2, 2, 5)).toThrow(/must lie in \(0, 1\]/);
  });

  it("triangulates a convex and a concave profile", () => {
    expect(triangulateProfile(rectangleProfile(1, 1)).triangles).toHaveLength(6);
    // An L shape: concave, so a fan triangulation would be wrong.
    const ell = profile([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]);
    const { triangles } = triangulateProfile(ell);
    expect(triangles).toHaveLength(12);
  });

  it("triangulates a profile with a hole", () => {
    const withHole = profile(rectangleProfile(4, 4).outline, [rectangleProfile(1, 1).outline]);
    expect(() => triangulateProfile(withHole)).not.toThrow();
  });
});

describe("extrusion, revolution, sweep, and loft", () => {
  it("extrudes a rectangle into a box of the right volume", () => {
    const wall = extrudeProfile(rectangleProfile(4, 3), { depth: 0.2 });
    expect(signedVolume(wall)).toBeCloseTo(4 * 3 * 0.2, 5);
    expect(isClosed(weldVertices(wall))).toBe(true);
  });

  it("extrudes centred and one-sided", () => {
    expect(meshBounds(extrudeProfile(rectangleProfile(1, 1), { depth: 2 })).min[2]).toBeCloseTo(0);
    expect(meshBounds(extrudeProfile(rectangleProfile(1, 1), { depth: 2, centered: true })).min[2]).toBeCloseTo(-1);
  });

  it("extrudes a profile with a hole, producing a wall with a window", () => {
    const withHole = profile(rectangleProfile(4, 3).outline, [rectangleProfile(1, 1).outline]);
    const wall = extrudeProfile(withHole, { depth: 0.2 });
    // The hole removes volume, and the cavity walls keep the solid closed.
    expect(signedVolume(wall)).toBeCloseTo((4 * 3 - 1) * 0.2, 4);
    expect(isClosed(weldVertices(wall))).toBe(true);
  });

  it("leaves an uncapped extrusion open", () => {
    expect(isClosed(weldVertices(extrudeProfile(rectangleProfile(1, 1), { depth: 1, capped: false })))).toBe(false);
  });

  it("rejects a non-positive depth", () => {
    expect(() => extrudeProfile(rectangleProfile(1, 1), { depth: 0 })).toThrow(/must be positive and finite/);
  });

  it("revolves a profile into a solid of revolution", () => {
    // A rectangle revolved about Y is a cylinder.
    const shape = revolveProfile([[0, -1], [1, -1], [1, 1], [0, 1]], { segments: 64 });
    expect(signedVolume(shape)).toBeCloseTo(2 * Math.PI, 1);
  });

  it("rejects a negative radius in a revolve profile", () => {
    expect(() => revolveProfile([[-1, 0], [1, 1]])).toThrow(/is a radius and must not be negative/);
    expect(() => revolveProfile([[0, 0]])).toThrow(/at least two points/);
    expect(() => revolveProfile([[0, 0], [1, 1]], { degrees: 0 })).toThrow(/\(0, 360\]/);
  });

  it("sweeps a profile along a path without twisting", () => {
    const pipe = sweepProfile(circleProfile(0.1, 8), { path: [[0, 0, 0], [0, 0, -2], [1, 0, -3], [3, 0, -3]] });
    expect(meshStats(pipe).triangles).toBeGreaterThan(0);
    expect(isClosed(weldVertices(pipe))).toBe(true);
    // The sweep follows the path, so it reaches the last point.
    expect(meshBounds(pipe).max[0]).toBeCloseTo(3, 0);
  });

  it("closes a looped sweep", () => {
    const ring = sweepProfile(circleProfile(0.1, 8), {
      path: [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]],
      closed: true,
    });
    // A closed sweep wraps its last section onto its first, so the tube is a
    // torus: every edge already has exactly two faces, with no welding needed.
    expect(isClosed(ring)).toBe(true);
    expect(meshStats(ring).vertices).toBe(4 * 8);
  });

  it("rejects a path that is too short", () => {
    expect(() => sweepProfile(circleProfile(1, 4), { path: [[0, 0, 0]] })).toThrow(/at least two points/);
  });

  it("lofts between matching sections", () => {
    const lofted = loftProfiles([
      { profile: circleProfile(1, 12), position: [0, 0, 0] },
      { profile: circleProfile(0.3, 12), position: [0, 0, 2] },
    ]);
    expect(meshStats(lofted).triangles).toBe(24);
    expect(() =>
      loftProfiles([
        { profile: circleProfile(1, 12), position: [0, 0, 0] },
        { profile: circleProfile(1, 8), position: [0, 0, 1] },
      ]),
    ).toThrow(/has 8 points but section 0 has 12/);
    expect(() => loftProfiles([{ profile: circleProfile(1, 4), position: [0, 0, 0] }])).toThrow(/at least two sections/);
  });
});

describe("T-junction repair", () => {
  it("splits an edge at a vertex lying on it", () => {
    const builder = new MeshBuilder();
    // A big triangle, and two small ones whose shared corner sits in the middle
    // of the big triangle's edge — a textbook T-junction.
    const a = builder.vertex([0, 0, 0]);
    const b = builder.vertex([2, 0, 0]);
    const c = builder.vertex([0, 2, 0]);
    builder.triangle(a, b, c);
    const mid = builder.vertex([1, 0, 0]);
    const below = builder.vertex([0, -2, 0]);
    const belowRight = builder.vertex([2, -2, 0]);
    builder.triangle(a, below, mid);
    builder.triangle(mid, below, belowRight);
    builder.triangle(mid, belowRight, b);
    const mesh = builder.build();

    const repaired = repairTJunctions(mesh);
    // The big triangle became two, so the mid vertex is now a real corner.
    expect(meshStats(repaired).triangles).toBe(meshStats(mesh).triangles + 1);
  });

  it("leaves a clean mesh untouched", () => {
    const clean = weldVertices(box());
    expect(meshStats(repairTJunctions(clean)).triangles).toBe(meshStats(clean).triangles);
  });

  it("makes boolean output closed, so results can be cut again", () => {
    const once = subtract(box({ width: 4, height: 3, depth: 0.4 }), box({ width: 1, height: 1, depth: 2 }));
    expect(isClosed(weldVertices(once))).toBe(true);
    // Chaining is the real test: an unrepaired result is rejected as an operand.
    const twice = subtract(once, translateMesh(box({ width: 0.5, height: 0.5, depth: 2 }), [1.5, 0, 0]));
    expect(isClosed(weldVertices(twice))).toBe(true);
    expect(signedVolume(twice)).toBeCloseTo(4 * 3 * 0.4 - 1 * 1 * 0.4 - 0.5 * 0.5 * 0.4, 3);
  });

  it("validates its tolerance", () => {
    expect(() => repairTJunctions(box(), 0)).toThrow(/must be positive/);
  });
});
