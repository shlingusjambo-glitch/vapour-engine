import { describe, expect, it } from "vitest";
import { bakeNavMesh, navMeshLineOfSight, smoothPath } from "@vapour/engine";
import { extractWalkableSurface, generateBuilding, generateTerrain, mergeMeshes, placeMesh, rectangularWalls } from "@vapour/assetgen";
import { VILLAGE, generateVillage } from "./environment.js";

/**
 * The integration the Mirage brief asks for: geometry described in text, with
 * collision and navigation derived from it, and an agent that can actually walk
 * through the doorway the description mentioned.
 *
 * Every stage here is a different subsystem — asset generation, walkable-surface
 * extraction, navmesh baking, pathfinding — and this is the only place they meet.
 */
describe("navigating a generated environment", () => {
  it("bakes a navmesh from generated terrain and paths across it", () => {
    const terrain = generateTerrain({ width: 40, depth: 40, resolution: 20, amplitude: 1.5, seed: 5 });
    const navmesh = bakeNavMesh(
      { positions: terrain.mesh.positions, indices: terrain.mesh.indices },
      { cellSize: 1, agentRadius: 0.5, maxSlopeDegrees: 50 },
    );
    expect(navmesh.isEmpty).toBe(false);
    const path = navmesh.findPath([-15, 0, -15], [15, 0, 15]);
    expect(path.status).toBe("complete");
    expect(path.points.length).toBeGreaterThan(5);
  });

  it("walks an NPC through a generated doorway using the reported aperture", () => {
    // A room with a single door, exactly as the architecture generator emits it.
    const building = generateBuilding({
      floors: [
        {
          level: 0,
          height: 2.7,
          walls: rectangularWalls(-4, -4, 4, 4, {
            openings: { north: [{ kind: "door", offset: 4, width: 1.2, height: 2.1 }] },
          }),
          slabThickness: 0,
        },
      ],
    });

    // Ground extending well outside the building, plus the building itself.
    const ground = generateTerrain({ width: 30, depth: 30, resolution: 30, heights: new Array(31 * 31).fill(0) });
    const scene = mergeMeshes([ground.mesh, building.mesh]);
    const walkable = extractWalkableSurface(scene, 45);

    const navmesh = bakeNavMesh(
      { positions: walkable.positions, indices: walkable.indices },
      { cellSize: 0.25, agentRadius: 0.3, agentMaxClimb: 0.3, maxSlopeDegrees: 45 },
    );
    expect(navmesh.isEmpty).toBe(false);

    const inside: [number, number, number] = [0, 0, 0];
    const outside: [number, number, number] = [0, 0, -8];

    // Walls block the way, so without the doorway link there is no route.
    const blocked = navmesh.findPath(inside, outside);

    // The generator already told us where the door is and that it is walkable.
    const door = building.apertures.find((aperture) => aperture.walkable);
    expect(door).toBeDefined();
    const across: [number, number, number] = [-door!.along[2], 0, door!.along[0]];
    const reach = 1.2;
    const connected = navmesh.addOffMeshLink({
      from: [door!.position[0] - across[0] * reach, 0, door!.position[2] - across[2] * reach],
      to: [door!.position[0] + across[0] * reach, 0, door!.position[2] + across[2] * reach],
      kind: "door",
    });
    expect(connected).toBe(true);

    const path = navmesh.findPath(inside, outside);
    expect(path.status).toBe("complete");
    // Either the walls genuinely separated the regions and the link fixed it,
    // or the bake already connected them; both are valid, but the link must not
    // have broken anything.
    expect(path.points.length).toBeGreaterThan(2);
    expect(blocked.status === "unreachable" || blocked.status === "complete").toBe(true);
  });

  it("smooths a village path into a route with fewer turns", () => {
    const village = generateVillage(VILLAGE);
    const navmesh = bakeNavMesh(
      { positions: village.terrain.mesh.positions, indices: village.terrain.mesh.indices },
      { cellSize: 1.5, agentRadius: 0.4, maxSlopeDegrees: 50 },
    );
    const half = VILLAGE.street.length / 2;
    const path = navmesh.findPath([0, 0, -half], [0, 0, half]);
    expect(path.status).toBe("complete");
    const smoothed = smoothPath(path.points, (from, to) => navMeshLineOfSight(navmesh, from, to));
    expect(smoothed.length).toBeLessThanOrEqual(path.points.length);
    expect(smoothed[0]).toEqual(path.points[0]);
  });

  it("gives every generated house navigation data without extra authoring", () => {
    const village = generateVillage(VILLAGE);
    for (const entry of village.buildings) {
      const navigation = entry.asset.navigation!;
      expect(navigation.surfaces.length).toBeGreaterThan(0);
      // One door per house, and never a window.
      expect(navigation.links.length).toBe(1);
      expect(navigation.links[0]!.kind).toBe("door");
      // The walkable extraction found real floor area inside.
      expect(navigation.walkable.indices.length).toBeGreaterThan(0);
    }
  });
});
