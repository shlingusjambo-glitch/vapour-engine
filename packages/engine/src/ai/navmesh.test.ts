import { describe, expect, it } from "vitest";
import {
  DEFAULT_AREA,
  NavMesh,
  bakeNavMesh,
  deserializeNavMesh,
  navMeshLineOfSight,
  serializeNavMesh,
  smoothPath,
  type NavMeshInput,
} from "./navmesh.js";

/** A flat square of ground in the XZ plane, centred on the origin.
 *
 * Wound so its normal points up: with +Y up, a face is upward-facing when its
 * winding runs +X then -Z. Getting this backwards makes every quad read as a
 * vertical wall and bake to nothing, which is exactly what it did first time. */
function ground(size: number, y = 0): NavMeshInput {
  const half = size / 2;
  return {
    positions: new Float32Array([
      -half,
      y,
      -half,
      half,
      y,
      -half,
      half,
      y,
      half,
      -half,
      y,
      half,
    ]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
  };
}

/** Two ground quads separated by a gap along X, to test connectivity. */
function splitGround(size: number, gap: number): NavMeshInput {
  const half = size / 2;
  const inner = gap / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [x0, x1] of [
    [-half, -inner],
    [inner, half],
  ] as const) {
    const base = positions.length / 3;
    positions.push(x0, 0, -half, x1, 0, -half, x1, 0, half, x0, 0, half);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/** Ground with a step up in the middle. */
function steppedGround(size: number, stepHeight: number): NavMeshInput {
  const half = size / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [x0, x1, y] of [
    [-half, 0, 0],
    [0, half, stepHeight],
  ] as const) {
    const base = positions.length / 3;
    positions.push(x0, y, -half, x1, y, -half, x1, y, half, x0, y, half);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

describe("bakeNavMesh", () => {
  it("covers a flat floor with connected spans", () => {
    const navmesh = bakeNavMesh(ground(10), { cellSize: 0.5, agentRadius: 0 });
    expect(navmesh.spanCount).toBeGreaterThan(300);
    expect(navmesh.isEmpty).toBe(false);
    const stats = navmesh.stats();
    expect(stats.links).toBeGreaterThan(navmesh.spanCount * 3);
    expect(stats.cellSize).toBe(0.5);
  });

  it("bakes nothing from an empty input", () => {
    const navmesh = bakeNavMesh({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    });
    expect(navmesh.isEmpty).toBe(true);
    expect(navmesh.findPath([0, 0, 0], [1, 0, 1]).status).toBe("unreachable");
  });

  it("rejects ground steeper than the slope limit", () => {
    // A near-vertical wall: standable on neither side.
    const wall: NavMeshInput = {
      positions: new Float32Array([0, 0, 0, 0.01, 0, 4, 0, 4, 4]),
      indices: new Uint32Array([0, 1, 2]),
    };
    expect(
      bakeNavMesh(wall, { maxSlopeDegrees: 45, agentRadius: 0 }).isEmpty,
    ).toBe(true);
  });

  it("keeps overlapping floors as separate spans in one column", () => {
    const lower = ground(6, 0);
    const upper = ground(6, 4);
    const combined: NavMeshInput = {
      positions: new Float32Array([...lower.positions, ...upper.positions]),
      indices: new Uint32Array([
        ...lower.indices,
        ...[...upper.indices].map((index) => index + 4),
      ]),
    };
    const navmesh = bakeNavMesh(combined, { cellSize: 0.5, agentRadius: 0 });
    // Both storeys are walkable, and a path never steps between them.
    const heights = new Set(navmesh.spans().map((span) => Math.round(span.y)));
    expect(heights).toEqual(new Set([0, 4]));
    const path = navmesh.findPath([-2, 0, 0], [2, 4, 0]);
    expect(path.status).toBe("unreachable");
  });

  it("connects across a step an agent can climb, and not one it cannot", () => {
    const climbable = bakeNavMesh(steppedGround(8, 0.3), {
      cellSize: 0.4,
      agentRadius: 0,
      agentMaxClimb: 0.4,
    });
    expect(climbable.findPath([-3, 0, 0], [3, 0.3, 0]).status).toBe("complete");
    const tooHigh = bakeNavMesh(steppedGround(8, 1.5), {
      cellSize: 0.4,
      agentRadius: 0,
      agentMaxClimb: 0.4,
    });
    expect(tooHigh.findPath([-3, 0, 0], [3, 1.5, 0]).status).toBe(
      "unreachable",
    );
  });

  it("erodes by the agent radius, so paths keep clear of edges", () => {
    const wide = bakeNavMesh(ground(10), { cellSize: 0.5, agentRadius: 0 });
    const eroded = bakeNavMesh(ground(10), { cellSize: 0.5, agentRadius: 1 });
    expect(eroded.spanCount).toBeLessThan(wide.spanCount);
    // The walkable region has pulled in from the boundary.
    const extent = (navmesh: NavMesh) =>
      Math.max(
        ...navmesh
          .spans()
          .map((span) => Math.abs(navmesh.spanPosition(span)[0])),
      );
    expect(extent(eroded)).toBeLessThan(extent(wide));
  });

  it("erodes a narrow corridor away entirely, which is the point of eroding", () => {
    // A 1 m wide strip cannot hold an agent of 1 m radius.
    const strip: NavMeshInput = {
      positions: new Float32Array([
        -5, 0, -0.5, 5, 0, -0.5, 5, 0, 0.5, -5, 0, 0.5,
      ]),
      indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    };
    expect(bakeNavMesh(strip, { cellSize: 0.25, agentRadius: 0 }).isEmpty).toBe(
      false,
    );
    expect(
      bakeNavMesh(strip, { cellSize: 0.25, agentRadius: 1.5 }).isEmpty,
    ).toBe(true);
  });

  it("validates its settings and input", () => {
    expect(() => bakeNavMesh(ground(4), { cellSize: 0 })).toThrow(
      /cell size must be positive/,
    );
    expect(() => bakeNavMesh(ground(4), { agentHeight: 0 })).toThrow(
      /agent height must be positive/,
    );
    expect(() => bakeNavMesh(ground(4), { agentMaxClimb: 0 })).toThrow(
      /max climb must be positive/,
    );
    expect(() => bakeNavMesh(ground(4), { maxSlopeDegrees: 90 })).toThrow(
      /\[0, 90\)/,
    );
    expect(() =>
      bakeNavMesh({
        positions: new Float32Array(9),
        indices: new Uint32Array([0, 1]),
      }),
    ).toThrow(/multiple of three/);
    expect(() =>
      bakeNavMesh({ ...ground(4), areas: new Uint8Array(5) }),
    ).toThrow(/2 triangles but 5 area ids/);
  });
});

describe("NavMesh queries", () => {
  const navmesh = bakeNavMesh(ground(20), { cellSize: 0.5, agentRadius: 0 });

  it("finds the nearest span to a position", () => {
    const span = navmesh.nearestSpan([3, 0, -2]);
    expect(span).toBeDefined();
    const position = navmesh.spanPosition(span!);
    expect(Math.hypot(position[0] - 3, position[2] + 2)).toBeLessThan(0.5);
  });

  it("returns nothing far outside the mesh", () => {
    expect(navmesh.nearestSpan([500, 0, 500], 4)).toBeUndefined();
    expect(navmesh.isWalkable([0, 0, 0])).toBe(true);
    expect(navmesh.isWalkable([500, 0, 500])).toBe(false);
  });

  it("paths across open ground", () => {
    const path = navmesh.findPath([-8, 0, -8], [8, 0, 8]);
    expect(path.status).toBe("complete");
    expect(path.points.length).toBeGreaterThan(10);
    // The route starts and ends near what was asked for.
    expect(
      Math.hypot(path.points[0]![0] + 8, path.points[0]![2] + 8),
    ).toBeLessThan(1);
    expect(
      Math.hypot(path.points.at(-1)![0] - 8, path.points.at(-1)![2] - 8),
    ).toBeLessThan(1);
  });

  it("routes around a gap rather than through it", () => {
    const split = bakeNavMesh(splitGround(12, 3), {
      cellSize: 0.5,
      agentRadius: 0,
    });
    expect(split.findPath([-4, 0, 0], [4, 0, 0]).status).toBe("unreachable");
  });

  it("reports a budget-exceeded search instead of hanging", () => {
    expect(
      navmesh.findPath([-9, 0, -9], [9, 0, 9], { maxVisited: 5 }).status,
    ).toBe("budget-exceeded");
  });

  it("charges more to cross a costly area", () => {
    // The whole surface is mud, so the cost cannot be routed around — a partial
    // area would simply be avoided, which is itself correct but tests nothing.
    const areaInput: NavMeshInput = {
      ...ground(10),
      areas: new Uint8Array([1, 1]),
    };
    const from: [number, number, number] = [-4, 0, -4];
    const to: [number, number, number] = [4, 0, 4];
    const cheap = bakeNavMesh(areaInput, { cellSize: 0.5, agentRadius: 0 }, [
      { id: 1, name: "mud", cost: 1 },
    ]);
    const costly = bakeNavMesh(areaInput, { cellSize: 0.5, agentRadius: 0 }, [
      { id: 1, name: "mud", cost: 4 },
    ]);
    expect(costly.findPath(from, to).cost).toBeCloseTo(
      cheap.findPath(from, to).cost * 4,
      5,
    );
  });

  it("routes around a costly area when a cheap way exists", () => {
    // Only the far triangle is mud, so the path stays on the cheap one.
    const areaInput: NavMeshInput = {
      ...ground(10),
      areas: new Uint8Array([0, 1]),
    };
    const from: [number, number, number] = [-4, 0, -4];
    const to: [number, number, number] = [4, 0, 4];
    const plain = bakeNavMesh(areaInput, { cellSize: 0.5, agentRadius: 0 }, [
      DEFAULT_AREA,
      { id: 1, name: "mud", cost: 1 },
    ]);
    const avoiding = bakeNavMesh(areaInput, { cellSize: 0.5, agentRadius: 0 }, [
      DEFAULT_AREA,
      { id: 1, name: "mud", cost: 20 },
    ]);
    expect(avoiding.findPath(from, to).status).toBe("complete");
    expect(avoiding.findPath(from, to).cost).toBeCloseTo(
      plain.findPath(from, to).cost,
      5,
    );
  });
});

describe("off-mesh links", () => {
  it("connects two otherwise separate regions", () => {
    const split = bakeNavMesh(splitGround(12, 3), {
      cellSize: 0.5,
      agentRadius: 0,
    });
    expect(split.findPath([-4, 0, 0], [4, 0, 0]).status).toBe("unreachable");

    expect(
      split.addOffMeshLink({
        from: [-1.6, 0, 0],
        to: [1.6, 0, 0],
        kind: "door",
      }),
    ).toBe(true);
    const path = split.findPath([-4, 0, 0], [4, 0, 0]);
    expect(path.status).toBe("complete");
    expect(split.stats().offMeshLinks).toBe(2);
    expect(split.offMeshLinks()[0]!.kind).toBe("door");
  });

  it("can be one-way", () => {
    const split = bakeNavMesh(splitGround(12, 3), {
      cellSize: 0.5,
      agentRadius: 0,
    });
    split.addOffMeshLink({
      from: [-1.6, 0, 0],
      to: [1.6, 0, 0],
      bidirectional: false,
    });
    expect(split.findPath([-4, 0, 0], [4, 0, 0]).status).toBe("complete");
    // A drop an agent cannot climb back up.
    expect(split.findPath([4, 0, 0], [-4, 0, 0]).status).toBe("unreachable");
  });

  it("reports a link it cannot attach", () => {
    const navmesh = bakeNavMesh(ground(6), { cellSize: 0.5, agentRadius: 0 });
    expect(navmesh.addOffMeshLink({ from: [500, 0, 500], to: [0, 0, 0] })).toBe(
      false,
    );
  });
});

describe("smoothPath", () => {
  it("removes waypoints that can be skipped", () => {
    const navmesh = bakeNavMesh(ground(20), { cellSize: 0.5, agentRadius: 0 });
    const path = navmesh.findPath([-8, 0, -8], [8, 0, 8]);
    const smoothed = smoothPath(path.points, (from, to) =>
      navMeshLineOfSight(navmesh, from, to),
    );
    expect(smoothed.length).toBeLessThan(path.points.length);
    expect(smoothed[0]).toEqual(path.points[0]);
    expect(smoothed.at(-1)).toEqual(path.points.at(-1));
  });

  it("leaves short paths alone", () => {
    expect(
      smoothPath(
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        () => true,
      ),
    ).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(smoothPath([], () => true)).toEqual([]);
  });

  it("keeps every waypoint when nothing can be skipped", () => {
    const points: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ];
    expect(smoothPath(points, () => false)).toEqual(points);
  });

  it("reports line of sight across the mesh and off it", () => {
    const navmesh = bakeNavMesh(ground(20), { cellSize: 0.5, agentRadius: 0 });
    expect(navMeshLineOfSight(navmesh, [-5, 0, 0], [5, 0, 0])).toBe(true);
    expect(navMeshLineOfSight(navmesh, [-5, 0, 0], [500, 0, 0])).toBe(false);
  });
});

describe("NavMesh assets", () => {
  it("round-trips baked spans, areas, links, and path behavior deterministically", () => {
    const original = bakeNavMesh(
      splitGround(12, 3),
      { cellSize: 0.5, agentRadius: 0 },
      [DEFAULT_AREA, { id: 2, name: "blocked", cost: Infinity }],
    );
    original.addOffMeshLink({
      from: [-1.6, 0, 0],
      to: [1.6, 0, 0],
      bidirectional: false,
      kind: "jump",
    });
    const json = serializeNavMesh(original);
    const restored = deserializeNavMesh(json);
    expect(restored.stats()).toMatchObject({
      spans: original.spanCount,
      offMeshLinks: 1,
      bakeMs: 0,
    });
    expect(restored.findPath([-4, 0, 0], [4, 0, 0]).status).toBe("complete");
    expect(restored.findPath([4, 0, 0], [-4, 0, 0]).status).toBe("unreachable");
    expect(serializeNavMesh(restored)).toBe(json);
    expect(json).toContain('"cost": null');
  });

  it("rejects corrupt versions, span links, and malformed JSON with context", () => {
    expect(() => deserializeNavMesh("not json")).toThrow(/not valid JSON/);
    expect(() => deserializeNavMesh({ version: 99 })).toThrow(
      /Unsupported NavMesh asset version/,
    );
    const data = bakeNavMesh(ground(4), {
      cellSize: 0.5,
      agentRadius: 0,
    }).serialize();
    const spans = data.spans.map((span, index) =>
      index === 0 ? { ...span, links: [999_999] } : span,
    );
    expect(() => deserializeNavMesh({ ...data, spans })).toThrow(
      /links to missing span/,
    );
  });
});

describe("dynamic navigation obstacles", () => {
  it("carves walkable spans, reroutes paths, and restores them on removal", () => {
    const navmesh = bakeNavMesh(ground(12), { cellSize: 0.5, agentRadius: 0 });
    const direct = navmesh.findPath([-4, 0, 0], [4, 0, 0]);
    const carved = navmesh.setObstacle({
      id: "crate",
      position: [0, 0, 0],
      radius: 1,
    });
    expect(carved).toBeGreaterThan(0);
    expect(navmesh.stats().dynamicObstacles).toBe(1);
    expect(navmesh.isWalkable([0, 0, 0], 0.4)).toBe(false);
    const detour = navmesh.findPath([-4, 0, 0], [4, 0, 0]);
    expect(detour.status).toBe("complete");
    expect(detour.cost).toBeGreaterThan(direct.cost);
    expect(navmesh.removeObstacle("crate")).toBe(true);
    expect(navmesh.findPath([-4, 0, 0], [4, 0, 0]).cost).toBeCloseTo(
      direct.cost,
      6,
    );
  });

  it("updates ids atomically and reference-counts overlapping obstacles", () => {
    const navmesh = bakeNavMesh(ground(8), { cellSize: 0.5, agentRadius: 0 });
    navmesh.setObstacle({ id: "a", position: [0, 0, 0], radius: 1 });
    navmesh.setObstacle({ id: "b", position: [0, 0, 0], radius: 1 });
    navmesh.removeObstacle("a");
    expect(navmesh.isWalkable([0, 0, 0], 0.4)).toBe(false);
    navmesh.setObstacle({ id: "b", position: [3, 0, 3], radius: 0.25 });
    expect(navmesh.isWalkable([0, 0, 0], 0.4)).toBe(true);
  });

  it("rejects malformed obstacle data with its id", () => {
    const navmesh = bakeNavMesh(ground(4), { cellSize: 0.5, agentRadius: 0 });
    expect(() =>
      navmesh.setObstacle({ id: "bad", position: [0, 0, 0], radius: 0 }),
    ).toThrow(/"bad" radius/);
    expect(() =>
      navmesh.setObstacle({ id: "", position: [0, 0, 0], radius: 1 }),
    ).toThrow(/non-empty id/);
  });
});
