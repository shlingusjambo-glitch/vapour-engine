import { describe, expect, it } from "vitest";
import { DebugDraw } from "../diagnostics/debug-draw.js";
import { drawNavigationPath, drawNavMesh } from "./nav-debug.js";
import { bakeNavMesh } from "./navmesh.js";

function floor() {
  return bakeNavMesh({ positions: new Float32Array([-2,0,-2, 2,0,-2, 2,0,2, -2,0,2]), indices: new Uint32Array([0,2,1,0,3,2]) }, { cellSize: 1, agentRadius: 0, agentMaxClimb: 0.5 });
}

describe("navigation debug drawing", () => {
  it("draws walkable and blocked spans through the shared navigation category", () => {
    const navmesh = floor();
    const debug = new DebugDraw();
    navmesh.setObstacle({ id: "crate", position: [0,0,0], radius: 0.8 });
    drawNavMesh(debug, navmesh, { adjacency: true, labels: true });
    expect(debug.count).toBeGreaterThan(navmesh.spanCount * 4);
    expect(debug.primitives().every((primitive) => primitive.category === "navigation")).toBe(true);
    expect(debug.primitives().some((primitive) => primitive.kind === "line" && primitive.color[0] === 1)).toBe(true);
  });

  it("honors category disabling and draws route endpoints", () => {
    const debug = new DebugDraw();
    debug.setCategoryEnabled("navigation", false);
    drawNavMesh(debug, floor());
    expect(debug.count).toBe(0);
    debug.setCategoryEnabled("navigation", true);
    drawNavigationPath(debug, [[0,0,0],[1,0,1]]);
    expect(debug.count).toBeGreaterThan(1);
  });

  it("validates offsets", () => {
    expect(() => drawNavMesh(new DebugDraw(), floor(), { heightOffset: Infinity })).toThrow(/finite/);
    expect(() => drawNavigationPath(new DebugDraw(), [[0,0,0]], NaN)).toThrow(/finite/);
  });
});
