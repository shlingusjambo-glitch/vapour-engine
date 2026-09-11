import { describe, expect, it } from "vitest";
import { RaycastVehicle3d, type RaycastVehicle3dOptions, type VehicleWorld3d } from "./vehicle-3d.js";
import type { BodyPose } from "./interaction.js";
import type { RaycastHit3d } from "./physics-3d.js";
import { loadNativePhysics3d } from "./native-test-world.js";

/**
 * Flat ground at y = 0 and one free rigid body: enough to exercise the
 * suspension and tyre maths deterministically without the solver.
 */
class FlatGroundWorld implements VehicleWorld3d {
  position: [number, number, number];
  rotation: [number, number, number, number] = [0, 0, 0, 1];
  velocity: [number, number, number] = [0, 0, 0];
  angular: [number, number, number] = [0, 0, 0];
  #force: [number, number, number] = [0, 0, 0];
  #torque: [number, number, number] = [0, 0, 0];
  readonly #inertia: [number, number, number];
  constructor(readonly mass: number, halfExtents: readonly [number, number, number], position: readonly [number, number, number]) {
    this.position = [...position];
    const [x, y, z] = halfExtents.map((h) => h * 2);
    this.#inertia = [(mass / 12) * (y! * y! + z! * z!), (mass / 12) * (x! * x! + z! * z!), (mass / 12) * (x! * x! + y! * y!)];
  }
  raycast(origin: readonly [number, number, number], direction: readonly [number, number, number], maxDistance: number): RaycastHit3d | undefined {
    if (direction[1] >= 0 || origin[1] <= 0) return undefined;
    const distance = -origin[1] / direction[1];
    if (distance > maxDistance) return undefined;
    return { bodyId: 99, distance, point: [origin[0] + direction[0] * distance, 0, origin[2] + direction[2] * distance], normal: [0, 1, 0] };
  }
  addForceAtPoint(_id: number, force: readonly [number, number, number], point: readonly [number, number, number]): void {
    const r = [point[0] - this.position[0], point[1] - this.position[1], point[2] - this.position[2]];
    for (let i = 0; i < 3; i++) this.#force[i]! += force[i]!;
    this.#torque[0] += r[1]! * force[2] - r[2]! * force[1];
    this.#torque[1] += r[2]! * force[0] - r[0]! * force[2];
    this.#torque[2] += r[0]! * force[1] - r[1]! * force[0];
  }
  step(dt: number): void {
    // ponytail: inertia treated as diagonal in world space; fine for a car that stays roughly upright.
    for (let i = 0; i < 3; i++) {
      this.velocity[i]! += (this.#force[i]! / this.mass + (i === 1 ? -9.81 : 0)) * dt;
      this.angular[i]! += (this.#torque[i]! / this.#inertia[i]!) * dt;
      this.position[i]! += this.velocity[i]! * dt;
    }
    const [x, y, z, w] = this.rotation, [ax, ay, az] = this.angular;
    const q: [number, number, number, number] = [
      x + 0.5 * dt * (ax * w + ay * z - az * y), y + 0.5 * dt * (ay * w + az * x - ax * z),
      z + 0.5 * dt * (az * w + ax * y - ay * x), w + 0.5 * dt * (-ax * x - ay * y - az * z),
    ];
    const n = Math.hypot(...q);
    this.rotation = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
    this.#force = [0, 0, 0];
    this.#torque = [0, 0, 0];
  }
  get pose(): BodyPose {
    return { position: [...this.position], rotation: [...this.rotation], linearVelocity: [...this.velocity], angularVelocity: [...this.angular] };
  }
}

const HALF: readonly [number, number, number] = [0.9, 0.4, 2];
const START: readonly [number, number, number] = [0, 0.95, 0];
function options(chassis: number, extra: Partial<RaycastVehicle3dOptions> = {}): RaycastVehicle3dOptions {
  const suspension = { restLength: 0.3, stiffness: 30_000, damping: 3_000, maxTravel: 0.25 };
  return {
    chassis,
    wheels: [
      { position: [-0.8, -0.2, -1.4], radius: 0.35, steering: true, suspension },
      { position: [0.8, -0.2, -1.4], radius: 0.35, steering: true, suspension },
      { position: [-0.8, -0.2, 1.4], radius: 0.35, driven: true, suspension },
      { position: [0.8, -0.2, 1.4], radius: 0.35, driven: true, suspension },
    ],
    maxEngineTorque: 600,
    maxBrakeTorque: 1500,
    ...extra,
  };
}
const DT = 1 / 60;

describe("RaycastVehicle3d on a flat test world", () => {
  function drive(vehicle: RaycastVehicle3d, world: FlatGroundWorld, steps: number, input: { throttle: number; steer: number; brake?: number }) {
    let state = vehicle.state;
    for (let step = 0; step < steps; step++) {
      state = vehicle.update(DT, input, world.pose);
      world.step(DT);
    }
    return state;
  }

  it("settles on its suspension within a second and stays level", () => {
    const world = new FlatGroundWorld(1200, HALF, START), vehicle = new RaycastVehicle3d(world, options(1));
    const rest = drive(vehicle, world, 60, { throttle: 0, steer: 0 });
    expect(rest.grounded).toBe(true);
    // Static load per wheel is m g / 4 = 2943 N, so k = 30 kN/m compresses ~0.1 m.
    for (const wheel of rest.wheels) expect(wheel.compression).toBeGreaterThan(0.05);
    for (const wheel of rest.wheels) expect(wheel.compression).toBeLessThan(0.15);
    const before = world.position[1];
    drive(vehicle, world, 60, { throttle: 0, steer: 0 });
    expect(Math.abs(world.position[1] - before)).toBeLessThan(0.005);
    expect(Math.abs(world.velocity[1])).toBeLessThan(0.02);
    expect(Math.hypot(world.velocity[0], world.velocity[2])).toBeLessThan(1e-3);
  });

  it("accelerates under throttle, turns toward the steered side, and brakes to rest", () => {
    const world = new FlatGroundWorld(1200, HALF, START), vehicle = new RaycastVehicle3d(world, options(1));
    drive(vehicle, world, 60, { throttle: 0, steer: 0 });
    const straight = drive(vehicle, world, 120, { throttle: 1, steer: 0 });
    // Rear torque 2 x 600 N.m / 0.35 m = 3.4 kN on 1200 kg is ~2.9 m/s^2.
    expect(straight.speed).toBeGreaterThan(3);
    expect(straight.speed).toBeLessThan(7);
    expect(Math.abs(world.position[0])).toBeLessThan(0.01);
    expect(world.position[2]).toBeLessThan(-3);
    for (const wheel of straight.wheels) expect(Math.abs(wheel.slipRatio)).toBeLessThan(0.2);

    // Facing -Z, positive steer turns left, which is -X.
    const turned = drive(vehicle, world, 120, { throttle: 0.5, steer: 1 });
    expect(world.position[0]).toBeLessThan(-0.5);
    expect(turned.wheels[0]!.steeringAngle).toBeGreaterThan(turned.wheels[1]!.steeringAngle);
    expect(turned.wheels[2]!.steeringAngle).toBe(0);
    expect(Number.isFinite(world.rotation[1])).toBe(true);

    const stopped = drive(vehicle, world, 180, { throttle: 0, steer: 0, brake: 1 });
    expect(Math.abs(stopped.speed)).toBeLessThan(0.05);
    for (const wheel of stopped.wheels) expect(Math.abs(wheel.angularVelocity)).toBeLessThan(0.5);
  });

  it("mirrors the turn for negative steer and drives parallel wheels without Ackermann", () => {
    const world = new FlatGroundWorld(1200, HALF, START), vehicle = new RaycastVehicle3d(world, options(1, { ackermann: false }));
    drive(vehicle, world, 60, { throttle: 0, steer: 0 });
    const state = drive(vehicle, world, 180, { throttle: 1, steer: -1 });
    expect(world.position[0]).toBeGreaterThan(0.5);
    expect(state.wheels[0]!.steeringAngle).toBe(state.wheels[1]!.steeringAngle);
    expect(state.wheels[0]!.steeringAngle).toBeCloseTo(-0.6, 5);
  });

  it("is deterministic across runs", () => {
    const run = () => {
      const world = new FlatGroundWorld(1200, HALF, START), vehicle = new RaycastVehicle3d(world, options(1));
      drive(vehicle, world, 200, { throttle: 0.8, steer: 0.4 });
      return [...world.position, ...world.rotation];
    };
    expect(run()).toEqual(run());
  });

  it("validates its options", () => {
    const world = new FlatGroundWorld(1, HALF, START);
    expect(() => new RaycastVehicle3d(world, options(0))).toThrow("positive body id");
    expect(() => new RaycastVehicle3d(world, { chassis: 1, wheels: [] })).toThrow("at least one wheel");
    expect(() => new RaycastVehicle3d(world, options(1, { maxSteeringAngle: 2 }))).toThrow("below pi/2");
    expect(() => new RaycastVehicle3d(world, { chassis: 1, wheels: [{ position: [0, 0, 0], radius: 0 }] })).toThrow("Wheel radius");
  });
});

describe("RaycastVehicle3d on the native Rapier world", async () => {
  const world = await loadNativePhysics3d();
  it.skipIf(world === undefined)("drives a dynamic chassis over a static ground box", () => {
    const native = world!;
    native.insert({ id: 1, bodyType: "static", position: [0, -0.5, 0], rotation: [0, 0, 0, 1], shape: { type: "box", halfExtents: [200, 0.5, 200] } });
    native.insert({ id: 2, bodyType: "dynamic", position: [...START], rotation: [0, 0, 0, 1], shape: { type: "box", halfExtents: [...HALF] }, massProperties: { mass: 1200, centerOfMass: [0, -0.2, 0] }, angularDamping: 0.5 });
    const vehicle = new RaycastVehicle3d(native, options(2));
    let pose: BodyPose = { position: [...START], rotation: [0, 0, 0, 1], linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
    const run = (steps: number, input: { throttle: number; steer: number; brake?: number }) => {
      let state = vehicle.state;
      for (let step = 0; step < steps; step++) {
        state = vehicle.update(DT, input, pose);
        pose = native.step(DT).bodies.find((body) => body.id === 2)!;
      }
      return state;
    };
    run(90, { throttle: 0, steer: 0 });
    // The chassis collider remains above the road even if the suspension has
    // settled against its bump stops under this deliberately coarse fixture.
    expect(pose.position[1]).toBeGreaterThan(0.35);
    const straight = run(120, { throttle: 1, steer: 0 });
    expect(straight.speed).toBeGreaterThan(3);
    run(120, { throttle: 0.5, steer: 1 });
    expect(Math.abs(pose.position[0])).toBeGreaterThan(0.5);
    const stopped = run(240, { throttle: 0, steer: 0, brake: 1 });
    expect(Math.abs(stopped.speed)).toBeLessThan(0.1);
    native.destroy();
  });
});
