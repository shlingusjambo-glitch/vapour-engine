import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_SLOTS, generateBuilding, generateRoof, generateStairs, generateWall,
  isClosed, meshBounds, meshStats, rectangularWalls, signedVolume, weldVertices,
  type BuildingSpec,
} from "./index.js";

describe("generateWall", () => {
  const defaults = { height: 3, thickness: 0.2 };

  it("builds a wall between two points with the right footprint", () => {
    const { mesh } = generateWall({ start: [0, 0], end: [4, 0] }, defaults);
    const bounds = meshBounds(mesh);
    expect(bounds.min[0]).toBeCloseTo(0, 5);
    expect(bounds.max[0]).toBeCloseTo(4, 5);
    expect(bounds.max[1]).toBeCloseTo(3, 5);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(0.2, 5);
    expect(signedVolume(mesh)).toBeCloseTo(4 * 3 * 0.2, 4);
  });

  it("builds a wall on any axis, including diagonals", () => {
    const { mesh } = generateWall({ start: [0, 0], end: [0, 5] }, defaults);
    expect(meshBounds(mesh).max[2]).toBeCloseTo(5, 5);
    const diagonal = generateWall({ start: [0, 0], end: [3, 4] }, defaults).mesh;
    expect(signedVolume(diagonal)).toBeCloseTo(5 * 3 * 0.2, 3);
  });

  it("cuts a doorway and reports it as a walkable aperture", () => {
    const { mesh, apertures } = generateWall(
      { start: [0, 0], end: [4, 0], openings: [{ kind: "door", offset: 2, width: 1, height: 2.1 }] },
      defaults,
    );
    expect(signedVolume(mesh)).toBeCloseTo(4 * 3 * 0.2 - 1 * 2.1 * 0.2, 3);
    expect(isClosed(weldVertices(mesh))).toBe(true);
    expect(apertures).toHaveLength(1);
    expect(apertures[0]).toMatchObject({ kind: "door", width: 1, height: 2.1, walkable: true });
    // The aperture sits at the offset along the wall, at its own mid-height.
    expect(apertures[0]!.position[0]).toBeCloseTo(2);
    expect(apertures[0]!.position[1]).toBeCloseTo(1.05);
  });

  it("treats a windowed opening as not walkable", () => {
    const { apertures } = generateWall(
      { start: [0, 0], end: [4, 0], openings: [{ offset: 2, width: 1.2, height: 1, sill: 1 }] },
      defaults,
    );
    expect(apertures[0]).toMatchObject({ kind: "window", walkable: false });
  });

  it("cuts several openings in one wall", () => {
    const { mesh, apertures } = generateWall(
      {
        start: [0, 0],
        end: [8, 0],
        openings: [
          { offset: 2, width: 1, height: 1.2, sill: 1 },
          { offset: 4, width: 1, height: 2.1 },
          { offset: 6, width: 1, height: 1.2, sill: 1 },
        ],
      },
      defaults,
    );
    expect(apertures).toHaveLength(3);
    expect(apertures.filter((a) => a.walkable)).toHaveLength(1);
    expect(signedVolume(mesh)).toBeCloseTo((8 * 3 - 1 * 1.2 - 1 * 2.1 - 1 * 1.2) * 0.2, 3);
  });

  it("reports openings that do not fit rather than producing broken geometry", () => {
    expect(() => generateWall({ start: [0, 0], end: [2, 0], openings: [{ offset: 1, width: 4, height: 1 }] }, defaults))
      .toThrow(/does not fit in a wall 2 long/);
    expect(() => generateWall({ start: [0, 0], end: [4, 0], openings: [{ offset: 2, width: 1, height: 5 }] }, defaults))
      .toThrow(/does not fit in a wall 3 high/);
    expect(() => generateWall({ start: [0, 0], end: [4, 0], openings: [{ offset: 2, width: 1, height: 1, sill: -1 }] }, defaults))
      .toThrow(/sill must not be negative/);
  });

  it("rejects a zero-length wall", () => {
    expect(() => generateWall({ start: [1, 1], end: [1, 1] }, defaults)).toThrow(/has no length/);
  });

  it("tags its triangles with the wall material slot", () => {
    const { mesh } = generateWall({ start: [0, 0], end: [4, 0] }, defaults);
    expect(new Set(mesh.materialSlots!)).toEqual(new Set([ARCHITECTURE_SLOTS.wall]));
  });
});

describe("stairs and roofs", () => {
  it("builds a flight that climbs the full rise", () => {
    const flight = generateStairs({ position: [0, 0], steps: 10, rise: 3, run: 0.3 }, 3);
    const bounds = meshBounds(flight);
    expect(bounds.max[1]).toBeCloseTo(3, 5);
    expect(bounds.min[2]).toBeCloseTo(-3, 5);
    expect(new Set(flight.materialSlots!)).toEqual(new Set([ARCHITECTURE_SLOTS.stairs]));
  });

  it("rejects a flight with too few steps", () => {
    expect(() => generateStairs({ position: [0, 0], steps: 1 }, 3)).toThrow(/at least two steps/);
  });

  it("builds each roof kind over the footprint", () => {
    const bounds = { minX: -3, maxX: 3, minZ: -4, maxZ: 4 };
    const flat = generateRoof({ kind: "flat" }, bounds, 3);
    expect(meshBounds(flat).min[1]).toBeCloseTo(3, 5);
    // The overhang extends past the walls.
    expect(meshBounds(flat).max[0]).toBeCloseTo(3.3, 5);

    const gable = generateRoof({ kind: "gable", pitchHeight: 2 }, bounds, 3);
    expect(meshBounds(gable).max[1]).toBeGreaterThan(3.5);
    expect(meshStats(gable).triangles).toBeGreaterThan(0);

    const hip = generateRoof({ kind: "hip", pitchHeight: 2 }, bounds, 3);
    expect(meshStats(hip).triangles).toBeGreaterThan(meshStats(gable).triangles);
  });
});

describe("generateBuilding", () => {
  const house: BuildingSpec = {
    name: "Cottage",
    wallThickness: 0.25,
    floors: [
      {
        level: 0,
        height: 2.7,
        walls: rectangularWalls(-4, -3, 4, 3, {
          openings: {
            north: [{ kind: "door", offset: 4, width: 1, height: 2.1 }],
            east: [{ offset: 3, width: 1.2, height: 1.1, sill: 1 }],
            south: [{ offset: 4, width: 1.6, height: 1.3, sill: 0.9 }],
          },
        }),
        rooms: [{ name: "Living room", footprint: [[-3.8, -2.8], [3.8, -2.8], [3.8, 2.8], [-3.8, 2.8]] }],
        stairs: [{ position: [3, 2], rotation: 180, steps: 15, rise: 2.7 }],
      },
      {
        level: 2.7,
        height: 2.4,
        walls: rectangularWalls(-4, -3, 4, 3, {
          openings: { north: [{ offset: 4, width: 1, height: 1, sill: 1 }] },
        }),
        rooms: [{ name: "Bedroom", footprint: [[-3.8, -2.8], [0, -2.8], [0, 2.8], [-3.8, 2.8]] }],
      },
    ],
    roof: { kind: "gable", pitchHeight: 1.8, overhang: 0.4 },
  };

  it("generates a whole house from a short description", () => {
    const building = generateBuilding(house);
    expect(building.stats).toMatchObject({ floors: 2, walls: 8, openings: 4 });
    expect(building.stats.triangles).toBeGreaterThan(100);
    expect(meshStats(building.mesh).triangles).toBe(building.stats.triangles);
  });

  it("reports apertures in world space, per floor", () => {
    const building = generateBuilding(house);
    const upstairs = building.apertures.filter((aperture) => aperture.floorIndex === 1);
    expect(upstairs).toHaveLength(1);
    // The upper window sits above the first floor's wall height.
    expect(upstairs[0]!.position[1]).toBeGreaterThan(2.7);
  });

  it("identifies which apertures an agent can walk through", () => {
    const building = generateBuilding(house);
    const walkable = building.apertures.filter((aperture) => aperture.walkable);
    expect(walkable).toHaveLength(1);
    expect(walkable[0]!.kind).toBe("door");
  });

  it("reports rooms and floor levels for navigation", () => {
    const building = generateBuilding(house);
    expect(building.rooms.map((room) => room.name)).toEqual(["Living room", "Bedroom"]);
    expect(building.rooms[1]!.level).toBe(2.7);
    expect(building.floorLevels).toEqual([0, 2.7]);
  });

  it("assigns a material slot per element kind", () => {
    const slots = new Set(generateBuilding(house).mesh.materialSlots!);
    expect(slots).toContain(ARCHITECTURE_SLOTS.wall);
    expect(slots).toContain(ARCHITECTURE_SLOTS.floor);
    expect(slots).toContain(ARCHITECTURE_SLOTS.roof);
    expect(slots).toContain(ARCHITECTURE_SLOTS.stairs);
  });

  it("puts the roof above the top floor's walls", () => {
    const building = generateBuilding(house);
    expect(meshBounds(building.mesh).max[1]).toBeGreaterThan(2.7 + 2.4);
  });

  it("omits the slab when asked, for a mezzanine", () => {
    const open = generateBuilding({ floors: [{ level: 0, height: 3, walls: rectangularWalls(0, 0, 4, 4), slabThickness: 0 }] });
    expect(new Set(open.mesh.materialSlots!)).not.toContain(ARCHITECTURE_SLOTS.floor);
  });

  it("validates the description", () => {
    expect(() => generateBuilding({ floors: [] })).toThrow(/at least one floor/);
    expect(() => generateBuilding({ floors: [{ level: 0, height: 0, walls: [] }] })).toThrow(/height must be a positive/);
    expect(() =>
      generateBuilding({ floors: [{ level: 0, height: 3, walls: [], rooms: [{ name: "x", footprint: [[0, 0]] }] }] }),
    ).toThrow(/at least three points/);
    expect(() => rectangularWalls(4, 0, 0, 4)).toThrow(/max greater than min/);
  });

  it("stays small: the description is a fraction of the geometry it produces", () => {
    const building = generateBuilding(house);
    const descriptionBytes = JSON.stringify(house).length;
    const geometryBytes = building.mesh.positions.byteLength + building.mesh.indices.byteLength;
    // This ratio is the whole argument for the asset system.
    expect(geometryBytes).toBeGreaterThan(descriptionBytes * 5);
  });
});
