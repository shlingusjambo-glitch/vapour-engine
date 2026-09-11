import { describe, expect, it } from "vitest";
import { DISTRICT, visibleCells } from "./world.js";

describe("Port Solace district", () => {
  it("streams adjacent authored cells without loading the whole district", () => {
    expect(DISTRICT).toHaveLength(3);
    expect(visibleCells([0, 0, 0], 40).map(cell => cell.id)).toEqual(["breakwater"]);
    expect(visibleCells([0, 0, -50], 40).map(cell => cell.id)).toEqual(["warehouse-row"]);
  });
  it("contains dense authored detail and several environment classes", () => {
    const placements = DISTRICT.flatMap(cell => cell.placements);
    expect(placements.length).toBeGreaterThan(35);
    expect(new Set(placements.map(item => item.asset)).size).toBeGreaterThanOrEqual(8);
  });
});
