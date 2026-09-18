import { describe, expect, it } from "vitest";
import {
  PROP_KINDS, PROP_SLOTS, VEHICLE_KINDS, WEAPON_KINDS, generateProp, generateVehicle, generateWeapon,
  isClosed, meshBounds, signedVolume, validateMesh, weldVertices,
} from "./index.js";

describe("generateProp", () => {
  it.each(PROP_KINDS)("builds a closed %s that sits on y = 0 with a centred footprint", (kind) => {
    const prop = generateProp({ kind, size: 1 });
    expect(prop.kind).toBe(kind);
    expect(() => validateMesh(prop.mesh, kind)).not.toThrow();
    expect(isClosed(weldVertices(prop.mesh))).toBe(true);
    expect(signedVolume(prop.mesh)).toBeGreaterThan(0);
    const bounds = meshBounds(prop.mesh);
    expect(bounds.min[1]).toBeCloseTo(0, 2);
    expect(bounds.max[1]).toBeGreaterThan(0.5);
    // Centred footprint: symmetric in X and Z, except where a part overhangs
    // by design — the lamppost arm along +X, the bench back along -Z.
    if (kind !== "lamppost") expect(bounds.min[0]).toBeCloseTo(-bounds.max[0], 2);
    if (kind !== "bench") expect(bounds.min[2]).toBeCloseTo(-bounds.max[2], 2);
    expect(prop.bounds).toEqual({ min: bounds.min, max: bounds.max });
    expect(prop.stats.triangles).toBe(prop.mesh.indices.length / 3);
    expect(prop.stats.parts).toBeGreaterThan(0);
  });

  it("scales with size and assigns the collision shape that suits the shape", () => {
    expect(generateProp({ kind: "crate", size: 2 }).bounds.max[1]).toBeCloseTo(2);
    expect(generateProp({ kind: "crate" }).collision).toBe("box");
    expect(generateProp({ kind: "bench" }).collision).toBe("convex");
    expect(generateProp({ kind: "lamppost" }).collision).toBe("mesh");
    expect(new Set(generateProp({ kind: "lamppost" }).mesh.materialSlots)).toContain(PROP_SLOTS.light);
  });

  it("runs a fence to the requested length with seeded, reproducible lean", () => {
    const fence = generateProp({ kind: "fence", length: 9, seed: 4 });
    expect(fence.bounds.max[0] - fence.bounds.min[0]).toBeCloseTo(9, 0);
    expect([...generateProp({ kind: "fence", length: 9, seed: 4 }).mesh.positions]).toEqual([...fence.mesh.positions]);
    expect([...generateProp({ kind: "fence", length: 9, seed: 5 }).mesh.positions]).not.toEqual([...fence.mesh.positions]);
  });

  it("hollows the planter", () => {
    const solid = 1 * 0.6 * 1;
    expect(signedVolume(generateProp({ kind: "planter", size: 1 }).mesh)).toBeLessThan(solid * 0.6);
  });

  it("rejects bad input with a message naming the problem", () => {
    expect(() => generateProp({ kind: "crate", size: 0 })).toThrow(/Prop size/);
    expect(() => generateProp({ kind: "barrel", segments: 2 })).toThrow(/three segments/);
    expect(() => generateProp({ kind: "spaceship" as never })).toThrow(/Unknown prop kind/);
  });
});

describe("generateVehicle", () => {
  it.each(VEHICLE_KINDS)("builds a %s whose body and wheel are closed and whose front axle steers", (kind) => {
    const vehicle = generateVehicle({ kind });
    expect(vehicle.kind).toBe(kind);
    for (const [label, mesh] of [["body", vehicle.body], ["wheel", vehicle.wheel], ["mesh", vehicle.mesh]] as const) {
      expect(() => validateMesh(mesh, label)).not.toThrow();
      expect(isClosed(weldVertices(mesh))).toBe(true);
      expect(signedVolume(mesh)).toBeGreaterThan(0);
    }
    const axles = kind === "car" || kind === "van" ? 2 : 3;
    expect(vehicle.wheels).toHaveLength(axles * 2);
    expect(vehicle.stats.wheels).toBe(axles * 2);
    const front = Math.max(...vehicle.wheels.map((wheel) => wheel.position[2]));
    for (const wheel of vehicle.wheels) {
      expect(wheel.steering).toBe(wheel.position[2] === front);
      expect(wheel.driven).toBe(!wheel.steering);
      expect(wheel.position[1]).toBeCloseTo(wheel.radius);
      expect(wheel.radius).toBeGreaterThan(0);
    }
    // Wheels sit on the ground, and the merged mesh spans the stated size.
    const bounds = meshBounds(vehicle.mesh);
    expect(bounds.min[1]).toBeCloseTo(0, 2);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(vehicle.size[0], 1);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(vehicle.size[2], 1);
  });

  it("keeps the wheels out of the body so they can turn", () => {
    const vehicle = generateVehicle({ kind: "car" });
    const body = meshBounds(vehicle.body);
    expect(body.min[1]).toBeGreaterThan(vehicle.wheels[0]!.radius * 0.5);
    expect(vehicle.mesh.indices.length).toBe(vehicle.body.indices.length + vehicle.wheel.indices.length * vehicle.wheels.length);
  });

  it("honours size overrides and rejects unknown kinds", () => {
    expect(generateVehicle({ length: 6 }).size[2]).toBe(6);
    expect(() => generateVehicle({ kind: "hovercraft" as never })).toThrow(/Unknown vehicle kind/);
  });
});

describe("generateWeapon", () => {
  it.each(WEAPON_KINDS)("builds a closed %s along +Y with a grip low on the handle and a tip at the far end", (kind) => {
    const weapon = generateWeapon({ kind });
    expect(weapon.kind).toBe(kind);
    expect(() => validateMesh(weapon.mesh, kind)).not.toThrow();
    expect(isClosed(weldVertices(weapon.mesh))).toBe(true);
    const bounds = meshBounds(weapon.mesh);
    expect(bounds.max[1]).toBeCloseTo(weapon.length, 1);
    // The grip is within the lower half and inside the model; the tip is at
    // `length` along +Y for every kind but the axe, whose edge faces +X.
    expect(weapon.grip[1]).toBeLessThanOrEqual(weapon.length * 0.5 + 1e-9);
    expect(Math.abs(weapon.grip[0])).toBeLessThan(weapon.length * 0.3);
    expect(Math.abs(weapon.grip[2])).toBeLessThan(weapon.length * 0.3);
    if (kind === "axe") {
      expect(weapon.tip[0]).toBeGreaterThan(0);
      expect(weapon.tip[1]).toBeGreaterThan(weapon.length * 0.8);
    } else {
      expect(weapon.tip[1]).toBeCloseTo(weapon.length);
      expect(weapon.tip[2]).toBe(0);
    }
  });

  it("uses the requested length and stays reproducible per seed", () => {
    const a = generateWeapon({ kind: "sword", length: 1.4, seed: 2 });
    expect(a.length).toBe(1.4);
    expect(a.tip).toEqual([0, 1.4, 0]);
    expect([...generateWeapon({ kind: "sword", length: 1.4, seed: 2 }).mesh.positions]).toEqual([...a.mesh.positions]);
    expect([...generateWeapon({ kind: "sword", length: 1.4, seed: 3 }).mesh.positions]).not.toEqual([...a.mesh.positions]);
    expect(() => generateWeapon({ kind: "wand" as never })).toThrow(/Unknown weapon kind/);
  });
});
