import { describe, expect, it } from "vitest";
import {
  box, compileAsset, compileBuilding, convexHull, cylinder, extractWalkableSurface,
  generateBuilding, generateCollision, generateLodChain, generateNavGeometry,
  generateTriplanarUvs, hullOfMesh, isClosed, meshBounds, meshCentroid, meshStats,
  rectangularWalls, signedVolume, simplifyMesh, sphere, translateMesh, weldVertices,
  mergeMeshes,
} from "./index.js";

/** An L-shaped solid: two boxes meeting at a corner, so the shape is concave. */
function lShape() {
  return mergeMeshes([box({ width: 2, height: 1, depth: 1 }), translateMesh(box({ width: 1, height: 1, depth: 2 }), [0.5, 0, 1.5])]);
}

describe("convexHull", () => {
  it("hulls a point cloud into a closed solid containing every point", () => {
    const points: [number, number, number][] = [];
    for (let index = 0; index < 200; index += 1) {
      const theta = index * 2.399963;
      const y = 1 - (2 * index) / 199;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      points.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
    }
    const hull = convexHull(points);
    expect(isClosed(weldVertices(hull))).toBe(true);
    expect(signedVolume(hull)).toBeGreaterThan(0);
    // A hull of points on a unit sphere approaches the sphere's volume.
    expect(signedVolume(hull)).toBeGreaterThan(3.5);
    expect(signedVolume(hull)).toBeLessThan((4 / 3) * Math.PI + 1e-6);
  });

  it("reproduces a box from its corners", () => {
    const corners: [number, number, number][] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push([x, y, z]);
    const hull = convexHull(corners);
    expect(signedVolume(hull)).toBeCloseTo(8, 6);
    expect(isClosed(weldVertices(hull))).toBe(true);
  });

  it("ignores points inside the hull", () => {
    const corners: [number, number, number][] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push([x, y, z]);
    const withInterior = [...corners, [0, 0, 0], [0.2, -0.1, 0.3]] as [number, number, number][];
    expect(signedVolume(convexHull(withInterior))).toBeCloseTo(8, 6);
  });

  it("hulls a mesh's vertices", () => {
    // A convex source is its own hull, so the volume must be preserved.
    const source = sphere({ radius: 1, segments: 16, rings: 12 });
    expect(signedVolume(hullOfMesh(source))).toBeCloseTo(signedVolume(source), 3);
  });

  it("fills the concavity of a non-convex mesh", () => {
    // The hull spans the notch of an L, so it encloses strictly more volume.
    const concave = lShape();
    const hull = hullOfMesh(concave);
    expect(signedVolume(hull)).toBeGreaterThan(signedVolume(concave));
    expect(isClosed(weldVertices(hull))).toBe(true);
  });

  it("reports degenerate inputs instead of returning a hull with no inside", () => {
    expect(() => convexHull([[0, 0, 0], [1, 0, 0]])).toThrow(/at least four points/);
    expect(() => convexHull([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]])).toThrow(/identical/);
    expect(() => convexHull([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])).toThrow(/collinear/);
    expect(() => convexHull([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]])).toThrow(/coplanar/);
  });
});

describe("simplifyMesh and LOD", () => {
  it("reduces triangle count while keeping the shape's extent", () => {
    const source = sphere({ radius: 1, segments: 48, rings: 32 });
    const simplified = simplifyMesh(source, { maxTriangles: 200 });
    expect(meshStats(simplified).triangles).toBeLessThan(meshStats(source).triangles);
    const bounds = meshBounds(simplified);
    // Clustering error is bounded by the cell size, so the silhouette holds.
    expect(bounds.max[0]).toBeGreaterThan(0.8);
    expect(bounds.max[0]).toBeLessThanOrEqual(1.001);
  });

  it("keeps material slots through simplification", () => {
    const source = { ...sphere({ segments: 32, rings: 24 }) };
    const slots = new Uint16Array(meshStats(source).triangles).fill(2);
    const simplified = simplifyMesh({ ...source, materialSlots: slots }, { resolution: 8 });
    expect(new Set(simplified.materialSlots ?? [])).toContain(2);
  });

  it("builds a descending LOD chain and stops when it stops helping", () => {
    const chain = generateLodChain(sphere({ radius: 1, segments: 48, rings: 32 }), 4);
    expect(chain.levels.length).toBeGreaterThan(1);
    for (let level = 1; level < chain.triangleCounts.length; level += 1) {
      expect(chain.triangleCounts[level]!).toBeLessThan(chain.triangleCounts[level - 1]!);
    }
    // A shape too simple to reduce yields a one-level chain rather than looping.
    expect(generateLodChain(box(), 4).levels.length).toBeLessThanOrEqual(2);
  });

  it("validates its options", () => {
    expect(() => simplifyMesh(box(), { resolution: 1 })).toThrow(/at least 2/);
    expect(() => simplifyMesh(box(), { maxTriangles: 0 })).toThrow(/at least 1/);
    expect(() => generateLodChain(box(), 0)).toThrow(/at least one level/);
  });
});

describe("UV generation", () => {
  it("projects each face along its dominant axis", () => {
    const unwrapped = generateTriplanarUvs(box({ width: 2, height: 2, depth: 2 }), { scale: 1 });
    expect(unwrapped.uvs).toBeDefined();
    expect(unwrapped.uvs!.length / 2).toBe(meshStats(unwrapped).vertices);
    // Every UV lies within the box's own extent, so the texture does not smear.
    for (const value of unwrapped.uvs!) expect(Math.abs(value)).toBeLessThanOrEqual(1.001);
  });

  it("scales tiling", () => {
    const tight = generateTriplanarUvs(box({ width: 4, height: 4, depth: 4 }), { scale: 1 });
    const loose = generateTriplanarUvs(box({ width: 4, height: 4, depth: 4 }), { scale: 4 });
    const span = (mesh: typeof tight) => Math.max(...Array.from(mesh.uvs!, Math.abs));
    expect(span(tight)).toBeGreaterThan(span(loose));
    expect(() => generateTriplanarUvs(box(), { scale: 0 })).toThrow(/must be positive/);
  });
});

describe("collision generation", () => {
  it("derives a box collider from bounds", () => {
    const shape = generateCollision(translateMesh(box({ width: 2, height: 4, depth: 6 }), [1, 2, 3]), { kind: "box" });
    expect(shape.kind).toBe("box");
    expect(shape.box!.center).toEqual([1, 2, 3]);
    expect(shape.box!.halfExtents).toEqual([1, 2, 3]);
  });

  it("derives a convex hull collider by default", () => {
    const shape = generateCollision(sphere({ segments: 16, rings: 12 }));
    expect(shape.kind).toBe("convex");
    expect(isClosed(weldVertices(shape.mesh!))).toBe(true);
  });

  it("simplifies a mesh collider to its triangle budget", () => {
    const source = sphere({ radius: 1, segments: 48, rings: 32 });
    const shape = generateCollision(source, { kind: "mesh", maxTriangles: 100 });
    expect(meshStats(shape.mesh!).triangles).toBeLessThan(meshStats(source).triangles);
  });

  it("leaves a mesh collider alone when it is already within budget", () => {
    const shape = generateCollision(box(), { kind: "mesh", maxTriangles: 1000 });
    expect(shape.mesh).toEqual(box());
  });
});

describe("walkable surfaces and navigation", () => {
  it("keeps flat ground and rejects walls", () => {
    const walkable = extractWalkableSurface(box({ width: 4, height: 4, depth: 4 }));
    // Only the top face survives a 45-degree slope limit.
    expect(meshStats(walkable).triangles).toBe(2);
    expect(meshBounds(walkable).min[1]).toBeCloseTo(2);
    expect(() => extractWalkableSurface(box(), 90)).toThrow(/\[0, 90\)/);
  });

  it("keeps a ramp within the slope limit and drops one beyond it", () => {
    const gentle = extractWalkableSurface(cylinder({ radius: 1, topRadius: 0.9, height: 0.2, segments: 16 }), 45);
    expect(meshStats(gentle).triangles).toBeGreaterThan(0);
    const steep = extractWalkableSurface(cylinder({ radius: 1, topRadius: 0, height: 4, segments: 16, capped: false }), 20);
    expect(meshStats(steep).triangles).toBe(0);
  });

  it("derives room surfaces and doorway links from a generated building", () => {
    const building = generateBuilding({
      floors: [
        {
          level: 0,
          height: 2.7,
          walls: rectangularWalls(-4, -3, 4, 3, {
            openings: {
              north: [{ kind: "door", offset: 4, width: 1, height: 2.1 }],
              east: [{ offset: 3, width: 1.2, height: 1.1, sill: 1 }],
            },
          }),
          rooms: [{ name: "Hall", footprint: [[-3.8, -2.8], [3.8, -2.8], [3.8, 2.8], [-3.8, 2.8]] }],
        },
      ],
    });
    const nav = generateNavGeometry(building);

    expect(nav.surfaces).toHaveLength(1);
    expect(nav.surfaces[0]).toMatchObject({ name: "Hall", level: 0 });
    expect(nav.surfaces[0]!.bounds).toEqual([-3.8, -2.8, 3.8, 2.8]);

    // The door becomes a link; the window does not, because routing an NPC
    // through a first-floor window is a bug, not a shortcut.
    expect(nav.links).toHaveLength(1);
    expect(nav.links[0]).toMatchObject({ kind: "door", width: 1 });
    expect(meshStats(nav.walkable).triangles).toBeGreaterThan(0);
  });

  it("places a doorway link on both sides of its wall", () => {
    const building = generateBuilding({
      floors: [
        {
          level: 0,
          height: 2.7,
          walls: [{ start: [0, 0], end: [4, 0], openings: [{ kind: "door", offset: 2, width: 1, height: 2.1 }] }],
        },
      ],
    });
    const [link] = generateNavGeometry(building).links;
    expect(link).toBeDefined();
    // The wall runs along X, so the link crosses it along Z.
    expect(link!.from[0]).toBeCloseTo(2);
    expect(link!.to[0]).toBeCloseTo(2);
    expect(Math.sign(link!.from[2])).not.toBe(Math.sign(link!.to[2]));
  });
});

describe("compileAsset", () => {
  it("produces UVs, LODs, and collision from a bare mesh", () => {
    const compiled = compileAsset(sphere({ radius: 1, segments: 32, rings: 24 }));
    expect(compiled.mesh.uvs).toBeDefined();
    expect(compiled.lods.levels.length).toBeGreaterThan(1);
    expect(compiled.collision.kind).toBe("mesh");
    expect(compiled.stats.triangles).toBe(meshStats(compiled.mesh).triangles);
  });

  it("keeps authored UVs when asked", () => {
    const source = box();
    const compiled = compileAsset(source, { keepUvs: true });
    expect(compiled.mesh.uvs).toEqual(source.uvs);
  });

  it("compiles a building all the way to navigation", () => {
    const building = generateBuilding({
      floors: [
        {
          level: 0,
          height: 2.7,
          walls: rectangularWalls(-3, -3, 3, 3, { openings: { north: [{ kind: "door", offset: 3, width: 1, height: 2.1 }] } }),
          rooms: [{ name: "Room", footprint: [[-2.8, -2.8], [2.8, -2.8], [2.8, 2.8], [-2.8, 2.8]] }],
        },
      ],
      roof: { kind: "flat" },
    });
    const compiled = compileBuilding(building);
    expect(compiled.navigation).toBeDefined();
    expect(compiled.navigation!.links).toHaveLength(1);
    expect(compiled.navigation!.surfaces).toHaveLength(1);
    expect(compiled.collision.kind).toBe("mesh");
    expect(compiled.lods.levels.length).toBeGreaterThan(1);
  });

  it("reports a centroid and rejects an empty mesh", () => {
    expect(meshCentroid(translateMesh(box(), [5, 0, 0]))[0]).toBeCloseTo(5, 5);
    expect(() => meshCentroid({ positions: new Float32Array(), indices: new Uint32Array() })).toThrow(/no centroid/);
  });
});
