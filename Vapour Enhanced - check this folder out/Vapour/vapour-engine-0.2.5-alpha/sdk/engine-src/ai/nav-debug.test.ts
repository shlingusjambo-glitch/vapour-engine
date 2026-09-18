import { describe, expect, it } from "vitest";
import { DEBUG_COLORS, DebugDraw } from "../diagnostics/debug-draw.js";
import { Nav2D } from "../tilemap/nav-2d.js";
import { Tilemap } from "../tilemap/tilemap.js";
import { drawNav2D, drawNavigationPath, drawNavMesh } from "./nav-debug.js";
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

  it("draws a 2D nav grid, colouring blocked cells differently", () => {
    const tilemap = new Tilemap({ tiles: [{ id: 1, collision: { kind: "solid" } }] });
    const layer = tilemap.addLayer({ name: "walls", width: 4, height: 4 });
    layer.set(2, 2, 1);
    const nav = new Nav2D(tilemap);
    nav.setBlocked(1, 1);
    const debug = new DebugDraw();
    drawNav2D(debug, nav, { bounds: { x0: 0, y0: 0, x1: 3, y1: 3 }, path: [[0, 0], [3, 3]] });
    expect(debug.count).toBeGreaterThan(0);
    expect(debug.primitives().every((primitive) => primitive.category === "navigation")).toBe(true);
    const colors = new Set(debug.primitives().map((primitive) => primitive.color?.join(",")));
    expect(colors.has(DEBUG_COLORS.green.join(","))).toBe(true); // open cells
    expect(colors.has(DEBUG_COLORS.red.join(","))).toBe(true); // the solid tile
    expect(colors.has(DEBUG_COLORS.orange.join(","))).toBe(true); // the dynamic obstacle
  });
});
