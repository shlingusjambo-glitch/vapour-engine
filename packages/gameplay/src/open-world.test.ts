import { describe, expect, it, vi } from "vitest";
import { TrafficSpawner, VehicleOccupancySystem, WantedResponseSystem } from "./open-world.js";

describe("VehicleOccupancySystem", () => {
  it("reserves seats and emits authoritative transitions", () => {
    const system = new VehicleOccupancySystem(), listener = vi.fn();
    system.register(7, [{ id: "driver", role: "driver" }, { id: "front", role: "passenger" }]);
    system.subscribe(listener);
    expect(system.enter(10, 7, "driver")).toBe(true);
    expect(system.enter(11, 7, "driver")).toBe(false);
    expect(system.enter(11, 7)).toBe(true);
    expect(system.occupancy(10)).toEqual({ vehicleId: 7, seatId: "driver" });
    expect(system.exit(10)).toBe(true);
    expect(system.occupant(7, "driver")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("ejects occupants when a streamed vehicle is removed", () => {
    const system = new VehicleOccupancySystem();
    system.register(7, [{ id: "driver", role: "driver" }]);
    system.enter(10, 7);
    expect(system.unregister(7)).toEqual([10]);
    expect(system.occupancy(10)).toBeUndefined();
  });
});

describe("TrafficSpawner", () => {
  const points = [
    { id: "a", position: [30, 0, 0] as const, heading: 0, routeId: "coast" },
    { id: "b", position: [50, 0, 0] as const, heading: 1, routeId: "coast" },
    { id: "c", position: [300, 0, 0] as const, heading: 2, routeId: "highway" },
  ];
  it("enforces population, visibility and hysteresis budgets", () => {
    const traffic = new TrafficSpawner(points, { maximumAgents: 2, spawnRadius: 100, despawnRadius: 150, minimumPlayerDistance: 20, respawnDelaySeconds: 5 });
    const initial = traffic.update(0, [[0, 0, 0]]);
    expect(initial.spawned.map((agent) => agent.spawnPointId)).toEqual(["a", "b"]);
    traffic.setPosition(initial.spawned[0]!.id, [200, 0, 0]);
    expect(traffic.update(1, [[0, 0, 0]]).despawned).toEqual([initial.spawned[0]!.id]);
    expect(traffic.update(3, [[0, 0, 0]]).spawned).toEqual([]);
    expect(traffic.update(2, [[0, 0, 0]]).spawned[0]?.spawnPointId).toBe("a");
  });

  it("does not spawn traffic in view at the observer", () => {
    const traffic = new TrafficSpawner(points, { minimumPlayerDistance: 40, spawnRadius: 100, despawnRadius: 120 });
    expect(traffic.update(0, [[0, 0, 0]]).spawned.map((agent) => agent.spawnPointId)).toEqual(["b"]);
  });
});

describe("WantedResponseSystem", () => {
  it("gates reports on witnesses and scales dispatch by heat", () => {
    const wanted = new WantedResponseSystem({ thresholds: [10, 30], decayPerSecond: 2, unseenDecayMultiplier: 4 });
    expect(wanted.report({ severity: 100, witnessed: false }).level).toBe(0);
    expect(wanted.report({ severity: 35 }).level).toBe(2);
    expect(wanted.state).toMatchObject({ dispatchUnits: 5, searchRadius: 220 });
    expect(wanted.update(1, true).heat).toBe(33);
    expect(wanted.update(1, false).heat).toBe(25);
    expect(wanted.state.level).toBe(1);
  });
});
