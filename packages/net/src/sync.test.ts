import { describe, expect, it } from "vitest";
import { NetworkClient } from "./client.js";
import {
  RESTING_BODY, applyRigidBodyAuthority, packRigidBody, unpackRigidBody, type RigidBodyState,
} from "./physics-sync.js";
import { NetworkServer } from "./server.js";
import {
  IDENTITY_TRANSFORM, packTransform, shouldSendTransform, smoothTransform, unpackTransform, type Transform,
} from "./transform-sync.js";
import { LoopbackNetwork } from "./transport.js";

const halfTurnY = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;

function expectClose(actual: readonly number[], expected: readonly number[], tolerance: number): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) expect(Math.abs(actual[index]! - value)).toBeLessThanOrEqual(tolerance);
}

describe("transform sync", () => {
  const transform: Transform = { position: [1.23456, -2.34567, 3.45678], rotation: halfTurnY, scale: [2, 2, 2] };

  it("round-trips within quantization error and replicates only what was asked for", () => {
    const packed = packTransform(transform, { decimals: 2 });
    expect(Object.keys(packed).sort()).toEqual(["p", "r"]);
    const unpacked = unpackTransform(packed, IDENTITY_TRANSFORM);
    expectClose(unpacked.position, transform.position, 0.005);
    expectClose(unpacked.rotation, transform.rotation, 0.01);
    // Scale was not replicated, so the fallback's scale stands.
    expect(unpacked.scale).toEqual([1, 1, 1]);

    const withScale = unpackTransform(packTransform(transform, { scale: true, decimals: 3 }));
    expect(withScale.scale).toEqual([2, 2, 2]);
    expect(Object.keys(packTransform(transform, { position: false, rotation: false }))).toEqual([]);
  });

  it("ignores malformed replicated fields rather than producing NaN", () => {
    const unpacked = unpackTransform({ p: [1, 2], r: "no", s: [1, Number.NaN, 1] }, transform);
    expect(unpacked).toEqual(transform);
  });

  it("sends on the divisor's ticks", () => {
    expect([0, 1, 2, 3, 4].map((tick) => shouldSendTransform(tick, { sendRateDivisor: 2 }))).toEqual([true, false, true, false, true]);
    expect(shouldSendTransform(7)).toBe(true);
  });

  it("smooths a small error and snaps a large one", () => {
    const shown: Transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    const near: Transform = { position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [3, 3, 3] };
    const smoothed = smoothTransform(shown, near, { snapThreshold: 2, smoothing: 0.5 });
    expect(smoothed.snapped).toBe(false);
    expect(smoothed.transform.position).toEqual([0.5, 0, 0]);
    expect(smoothed.transform.scale).toEqual([3, 3, 3]);

    const far: Transform = { ...near, position: [10, 0, 0] };
    const snapped = smoothTransform(shown, far, { snapThreshold: 2 });
    expect(snapped.snapped).toBe(true);
    expect(snapped.transform).toBe(far);

    // A large rotation error snaps even when the position is close.
    const spun: Transform = { ...near, rotation: [0, 1, 0, 0] };
    expect(smoothTransform(shown, spun, { snapAngle: Math.PI / 2 }).snapped).toBe(true);
    expect(smoothTransform(shown, near, { snapAngle: Math.PI / 2 }).snapped).toBe(false);
  });

  it("validates its descriptor", () => {
    expect(() => packTransform(transform, { decimals: -1 })).toThrow(/non-negative/);
    expect(() => shouldSendTransform(0, { sendRateDivisor: 0 })).toThrow(/at least 1/);
    expect(() => smoothTransform(transform, transform, { smoothing: 0 })).toThrow(/\(0, 1\]/);
  });
});

describe("physics sync", () => {
  const moving: RigidBodyState = {
    position: [1.005, 2.004, 3.006],
    rotation: halfTurnY,
    linearVelocity: [0.5, -9.81, 0],
    angularVelocity: [0, 1, 0],
    sleeping: false,
  };

  it("round-trips a body within quantization error", () => {
    const unpacked = unpackRigidBody(packRigidBody(moving, { decimals: 2 }));
    expectClose(unpacked.position, moving.position, 0.005);
    expectClose(unpacked.rotation, moving.rotation, 0.01);
    expectClose(unpacked.linearVelocity, moving.linearVelocity, 0.005);
    expectClose(unpacked.angularVelocity, moving.angularVelocity, 0.005);
    expect(unpacked.sleeping).toBe(false);
  });

  it("omits velocities for a sleeping body, which are zero by definition", () => {
    const asleep: RigidBodyState = { ...moving, sleeping: true };
    const packed = packRigidBody(asleep);
    expect(Object.keys(packed).sort()).toEqual(["p", "r", "z"]);
    const unpacked = unpackRigidBody(packed, moving);
    expect(unpacked.sleeping).toBe(true);
    expect(unpacked.linearVelocity).toEqual([0, 0, 0]);
    expect(unpacked.angularVelocity).toEqual([0, 0, 0]);
  });

  it("corrects a small error toward authority and takes the server's velocities", () => {
    const local: RigidBodyState = { ...moving, position: [1, 2, 3], linearVelocity: [0, 0, 0] };
    const authority: RigidBodyState = { ...moving, position: [1.2, 2, 3] };
    const correction = applyRigidBodyAuthority(local, authority, { snapThreshold: 1, correction: 0.5 });
    expect(correction.snapped).toBe(false);
    expect(correction.sleep).toBe(false);
    expect(correction.wake).toBe(false);
    expectClose(correction.state.position, [1.1, 2, 3], 1e-9);
    expect(correction.state.linearVelocity).toEqual(authority.linearVelocity);
  });

  it("snaps a large error", () => {
    const authority: RigidBodyState = { ...moving, position: [50, 2, 3] };
    const correction = applyRigidBodyAuthority(moving, authority, { snapThreshold: 1 });
    expect(correction.snapped).toBe(true);
    expect(correction.state).toBe(authority);
  });

  it("puts a body to sleep and wakes it to match the server", () => {
    const asleep: RigidBodyState = { ...moving, sleeping: true, linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
    const toSleep = applyRigidBodyAuthority(moving, asleep);
    expect(toSleep.sleep).toBe(true);
    expect(toSleep.wake).toBe(false);
    // A sleeping authority is applied whole: there is no motion to smooth toward.
    expect(toSleep.snapped).toBe(true);
    expect(toSleep.state).toBe(asleep);

    const toWake = applyRigidBodyAuthority(RESTING_BODY, { ...moving, position: [0.1, 0, 0] });
    expect(toWake.wake).toBe(true);
    expect(toWake.sleep).toBe(false);
    expect(toWake.state.sleeping).toBe(false);
  });

  it("validates its options", () => {
    expect(() => packRigidBody(moving, { decimals: 1.5 })).toThrow(/non-negative whole/);
    expect(() => applyRigidBodyAuthority(moving, moving, { correction: 2 })).toThrow(/\(0, 1\]/);
  });
});

describe("ownership transfer", () => {
  function pair() {
    const network = new LoopbackNetwork();
    const server = new NetworkServer(network.endpoint(0));
    const owners: (number | null)[] = [];
    const one = new NetworkClient(network.endpoint(1), { onOwnership: (entity) => owners.push(entity.owner) });
    const two = new NetworkClient(network.endpoint(2));
    server.addConnection(1);
    server.addConnection(2);
    let now = 0;
    const run = (ticks: number): void => {
      for (let tick = 0; tick < ticks; tick += 1) {
        server.receive();
        server.step();
        now += 50;
        network.advance(now);
        one.receive(0);
        two.receive(0);
        network.advance(now);
        server.receive();
      }
    };
    return { server, one, two, owners, run };
  }

  it("lets the owner hand a body to another client, flipping `local` on both", () => {
    const { server, one, two, owners, run } = pair();
    const crate = server.spawn("crate", packRigidBody(RESTING_BODY), 1);
    run(2);
    expect(one.entity(crate.id)?.local).toBe(true);
    expect(two.entity(crate.id)?.local).toBe(false);

    one.transferOwnership(crate.id, 2);
    run(2);
    expect(server.entity(crate.id)?.owner).toBe(2);
    expect(one.entity(crate.id)?.local).toBe(false);
    expect(two.entity(crate.id)?.local).toBe(true);
    expect(owners).toEqual([2]);

    two.transferOwnership(crate.id, null);
    run(2);
    expect(server.entity(crate.id)?.owner).toBeNull();
    expect(two.entity(crate.id)?.local).toBe(false);
  });

  it("rejects a transfer from a client that does not own the body", () => {
    const { server, one, two, owners, run } = pair();
    const crate = server.spawn("crate", packRigidBody(RESTING_BODY), 1);
    const loose = server.spawn("crate", packRigidBody(RESTING_BODY));
    run(2);

    two.transferOwnership(crate.id, 2);
    two.transferOwnership(loose.id, 2);
    two.transferOwnership(999, 2);
    run(2);
    expect(server.entity(crate.id)?.owner).toBe(1);
    expect(server.entity(loose.id)?.owner).toBeNull();
    expect(one.entity(crate.id)?.local).toBe(true);
    expect(owners).toEqual([]);

    // Nor to a connection that does not exist.
    one.transferOwnership(crate.id, 42);
    run(2);
    expect(server.entity(crate.id)?.owner).toBe(1);
  });
});
