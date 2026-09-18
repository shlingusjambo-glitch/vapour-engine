import { describe, expect, it } from "vitest";
import { OpenWorld } from "./world.js";

describe("open-world showcase", () => {
  it("composes terrain, vegetation, streaming, origin shifting, and navigation", () => {
    const world = new OpenWorld({ seed: 7, samples: 65, extent: 512 });
    const before = world.stats();
    expect(before.chunks).toBe(16);
    expect(before.terrainTriangles).toBeGreaterThan(1000);
    expect(before.vegetation).toBeGreaterThan(50);
    expect(before.navSpans).toBeGreaterThan(100);

    expect(world.sendAgent()).toBe(true);
    // Walk the viewer far enough to force an origin shift and stream cells.
    for (let step = 0; step < 2400; step += 1) {
      world.step(1 / 30);
      const agent = world.crowd.agent(1)!;
      world.stream([agent.position[0], agent.position[1], agent.position[2]]);
    }
    const after = world.stats();
    expect(after.agentDistance).toBeGreaterThan(100);
    expect(after.residentCells).toBeGreaterThan(0);
    expect(after.originShifts).toBeGreaterThanOrEqual(1);
  });

  it("rebakes only the region under a sculpted hill", () => {
    const world = new OpenWorld({ seed: 7, samples: 65, extent: 512 });
    const report = world.raiseHill(48, 48, 4);
    expect(report.spansRebaked).toBeGreaterThan(0);
    expect(report.spansRebaked).toBeLessThan(report.spansTotal / 2);
    expect(world.navmesh.spanCount).toBe(report.spansTotal);
  });

  it("is deterministic from the seed", () => {
    const a = new OpenWorld({ seed: 3, samples: 33, extent: 256 }).stats();
    const b = new OpenWorld({ seed: 3, samples: 33, extent: 256 }).stats();
    expect(a).toEqual(b);
    const other = new OpenWorld({ seed: 4, samples: 33, extent: 256 });
    expect(other.vegetation[0]?.position).not.toEqual(new OpenWorld({ seed: 3, samples: 33, extent: 256 }).vegetation[0]?.position);
  });
});
