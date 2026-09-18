import { describe, expect, it } from "vitest";
import { Tilemap } from "./tilemap.js";
import { Nav2D } from "./nav-2d.js";

const SOLID = 1;
const PLATFORM = 2;

/** An open 10x10 room, walled with solid tiles on every border. */
function room(): Tilemap {
  const tilemap = new Tilemap({
    tiles: [
      { id: SOLID, collision: { kind: "solid" } },
      { id: PLATFORM, collision: { kind: "platform" } },
    ],
  });
  const layer = tilemap.addLayer({ name: "walls", width: 10, height: 10 });
  for (let x = 0; x < 10; x += 1) {
    layer.set(x, 0, SOLID);
    layer.set(x, 9, SOLID);
  }
  for (let y = 0; y < 10; y += 1) {
    layer.set(0, y, SOLID);
    layer.set(9, y, SOLID);
  }
  return tilemap;
}

describe("Nav2D", () => {
  it("derives walkability from tilemap collision, treating platforms as walkable", () => {
    const tilemap = room();
    const nav = new Nav2D(tilemap);
    expect(nav.isTileOpen(5, 5)).toBe(true);
    expect(nav.isTileOpen(0, 5)).toBe(false); // wall
    tilemap.layer("walls").set(5, 5, PLATFORM);
    expect(nav.isTileOpen(5, 5)).toBe(true); // platform, not solid
  });

  it("inflates obstacles by agent radius", () => {
    const tilemap = room();
    const nav = new Nav2D(tilemap, { agentRadius: 1 });
    // (1,1) is open ground but its footprint touches the wall at (0,1).
    expect(nav.isWalkable(1, 1)).toBe(false);
    expect(nav.isWalkable(2, 2)).toBe(true);
  });

  it("routes around a blocked cell and shortens the corridor with string-pulling", () => {
    const tilemap = room();
    const layer = tilemap.layer("walls");
    // A wall across the room with a single gap, forcing a detour.
    for (let x = 1; x < 9; x += 1) if (x !== 5) layer.set(x, 4, SOLID);
    const nav = new Nav2D(tilemap);

    const result = nav.findPath([1, 1], [8, 8]);
    expect(result.status).toBe("complete");
    console.log(
      `M116 2D path: ${result.cells.length} raw cells -> ${result.points.length} smoothed points, ` +
        `${result.visited} nodes expanded`,
    );
    expect(result.points.length).toBeLessThan(result.cells.length);
    expect(result.visited).toBeGreaterThan(0);
    // The corridor must actually pass through the gap.
    expect(result.cells.some(([x, y]) => x === 5 && y === 4)).toBe(true);
  });

  it("reroutes when a dynamic obstacle appears mid-path", () => {
    const tilemap = room();
    const nav = new Nav2D(tilemap);
    const original = nav.findPath([1, 1], [8, 1]);
    expect(original.status).toBe("complete");
    expect(original.cells.some(([x, y]) => x === 4 && y === 1)).toBe(true);

    // Block the straight route; the agent must detour around it.
    for (let y = 1; y <= 3; y += 1) nav.setBlocked(4, y);
    const rerouted = nav.findPath([1, 1], [8, 1]);
    expect(rerouted.status).toBe("complete");
    expect(rerouted.cells.some(([x, y]) => x === 4 && y === 1)).toBe(false);

    nav.setBlocked(4, 1, false);
    nav.setBlocked(4, 2, false);
    nav.setBlocked(4, 3, false);
    const restored = nav.findPath([1, 1], [8, 1]);
    expect(restored.cells.some(([x, y]) => x === 4 && y === 1)).toBe(true);
  });

  it("reports unreachable rather than throwing when start or goal is blocked", () => {
    const tilemap = room();
    const nav = new Nav2D(tilemap);
    expect(nav.findPath([0, 0], [1, 1]).status).toBe("unreachable");
  });
});
