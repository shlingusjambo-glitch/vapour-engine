import { describe, expect, it } from "vitest";
import { PhysicsSandbox, SimpleWorld } from "./sandbox.js";

/** Presses an action for one update, then releases it. */
function tap(sandbox: PhysicsSandbox, action: string, dt = 1 / 60): void {
  sandbox.input.system.setKey(keyFor(action), true);
  sandbox.update(dt);
  sandbox.input.system.setKey(keyFor(action), false);
  sandbox.update(dt);
}

function keyFor(action: string): string {
  return { Grab: "KeyE", Throw: "KeyF", Spawn: "KeyQ", ToggleDoor: "KeyR" }[action] ?? action;
}

function run(sandbox: PhysicsSandbox, seconds: number, dt = 1 / 60): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) sandbox.update(dt);
}

describe("sandbox construction", () => {
  it("builds a world with props, a door, and a pendulum", () => {
    const sandbox = new PhysicsSandbox({ propCount: 5 });
    expect(sandbox.propIds).toHaveLength(5);
    // Ground, two door bodies, two pendulum bodies, plus the props.
    expect(sandbox.world.bodies).toHaveLength(10);
    expect(sandbox.stats().joints).toBe(2);
  });

  it("refuses to start with more props than its maximum", () => {
    expect(() => new PhysicsSandbox({ propCount: 10, maxProps: 5 })).toThrow(/more props than its maximum/);
  });

  it("uses generated collision geometry for its props", () => {
    // The asset path is real, not a hard-coded cube.
    expect(PhysicsSandbox.propCollisionVolume()).toBeCloseTo(1, 5);
    expect(PhysicsSandbox.propTriangleCount()).toBeGreaterThan(0);
  });
});

describe("props", () => {
  it("settles props onto the ground", () => {
    const sandbox = new PhysicsSandbox({ propCount: 4 });
    run(sandbox, 3);
    for (const id of sandbox.propIds) {
      expect(sandbox.world.body(id)!.position[1]).toBeCloseTo(0.5, 2);
    }
  });

  it("spawns on demand, in front of the viewer", () => {
    const sandbox = new PhysicsSandbox({ propCount: 0 });
    sandbox.look([0, 2, 0], [0, 0, -1]);
    tap(sandbox, "Spawn");
    expect(sandbox.propIds).toHaveLength(1);
    const spawned = sandbox.world.body(sandbox.propIds[0]!)!;
    expect(spawned.position[2]).toBeLessThan(0);
    expect(sandbox.stats().spawned).toBe(1);
  });

  it("refuses to spawn past its limit rather than growing without bound", () => {
    const sandbox = new PhysicsSandbox({ propCount: 2, maxProps: 3 });
    expect(sandbox.spawnProp([0, 5, 0])).toBeDefined();
    expect(sandbox.spawnProp([0, 5, 0])).toBeUndefined();
    expect(sandbox.propIds).toHaveLength(3);
  });
});

describe("grabbing, carrying, and throwing", () => {
  /** A sandbox with one prop directly in front of the viewer. */
  function withPropInReach(): PhysicsSandbox {
    const sandbox = new PhysicsSandbox({ propCount: 0 });
    sandbox.look([0, 1.7, 4], [0, 0, -1]);
    sandbox.spawnProp([0, 1.7, 2]);
    return sandbox;
  }

  it("grabs the prop in reach and ignores one that is not", () => {
    const sandbox = withPropInReach();
    const far = sandbox.spawnProp([0, 1.7, -50])!;
    expect(sandbox.propInReach()).toBe(sandbox.propIds[0]);
    tap(sandbox, "Grab");
    expect(sandbox.heldId).toBe(sandbox.propIds[0]);
    expect(sandbox.heldId).not.toBe(far);
  });

  it("carries a held prop as the viewer turns", () => {
    const sandbox = withPropInReach();
    tap(sandbox, "Grab");
    const held = sandbox.heldId!;
    sandbox.look([0, 1.7, 4], [1, 0, 0]);
    run(sandbox, 1.5);
    const body = sandbox.world.body(held)!;
    // It followed the new hold point instead of staying where it was.
    expect(body.position[0]).toBeGreaterThan(1);
  });

  it("releases on a second grab press", () => {
    const sandbox = withPropInReach();
    tap(sandbox, "Grab");
    expect(sandbox.heldId).toBeDefined();
    tap(sandbox, "Grab");
    expect(sandbox.heldId).toBeUndefined();
  });

  it("throws the held prop along the aim, with real momentum", () => {
    const sandbox = withPropInReach();
    tap(sandbox, "Grab");
    const held = sandbox.heldId!;
    tap(sandbox, "Throw");
    expect(sandbox.heldId).toBeUndefined();
    expect(sandbox.stats().thrown).toBe(1);
    // Moving away along the aim direction, not teleported.
    expect(sandbox.world.body(held)!.velocity[2]).toBeLessThan(-1);
    run(sandbox, 0.5);
    expect(sandbox.world.body(held)!.position[2]).toBeLessThan(0);
  });

  it("does nothing when throwing with empty hands", () => {
    const sandbox = withPropInReach();
    tap(sandbox, "Throw");
    expect(sandbox.stats().thrown).toBe(0);
  });

  it("breaks a grab when the prop cannot follow", () => {
    // The viewer walks away far faster than the spring can drag the prop.
    const sandbox = withPropInReach();
    tap(sandbox, "Grab");
    expect(sandbox.heldId).toBeDefined();
    sandbox.look([0, 1.7, 400], [0, 0, -1]);
    sandbox.update(1 / 60);
    expect(sandbox.heldId).toBeUndefined();
    expect(sandbox.stats().grabsBroken).toBe(1);
  });
});

describe("the door", () => {
  it("drives its hinge motor open and closed", () => {
    const sandbox = new PhysicsSandbox({ propCount: 0 });
    expect(sandbox.door.state).toBe("closed");
    tap(sandbox, "ToggleDoor");
    expect(sandbox.door.state).toBe("opening");
    // The motor command reached the world.
    expect(sandbox.world.motor(sandbox.door.jointId)?.velocity).toBeGreaterThan(0);

    run(sandbox, 1);
    expect(sandbox.door.state).toBe("open");
    // Holding position rather than releasing, so a leaning crate cannot shut it.
    expect(sandbox.world.motor(sandbox.door.jointId)).toMatchObject({ velocity: 0 });
  });

  it("closes itself after its auto-close delay", () => {
    const sandbox = new PhysicsSandbox({ propCount: 0 });
    tap(sandbox, "ToggleDoor");
    run(sandbox, 1);
    expect(sandbox.door.state).toBe("open");
    run(sandbox, 6);
    expect(sandbox.door.state).toBe("closed");
  });
});

describe("joints", () => {
  it("keeps the pendulum and door joints alive", () => {
    const sandbox = new PhysicsSandbox({ propCount: 0 });
    run(sandbox, 2);
    expect(sandbox.stats().joints).toBe(2);
  });

  it("drops joints when a connected body is removed", () => {
    const sandbox = new PhysicsSandbox({ propCount: 0 });
    sandbox.world.remove(sandbox.fixtures.pendulumBob);
    expect(sandbox.stats().joints).toBe(1);
  });
});

describe("diagnostics", () => {
  it("reports its own cost and contents", () => {
    const sandbox = new PhysicsSandbox({ propCount: 6 });
    run(sandbox, 0.5);
    const names = sandbox.diagnostics.names;
    expect(names).toContain("sandbox.step");
    expect(names).toContain("physics.bodies");
    expect(sandbox.diagnostics.counter("sandbox.props").sample().max).toBe(6);
    expect(sandbox.diagnostics.counter("sandbox.step").sample().samples).toBeGreaterThan(0);
  });
});

describe("SimpleWorld", () => {
  it("applies impulses in proportion to mass", () => {
    const world = new SimpleWorld(0);
    const light = world.add("prop", [0, 5, 0], { mass: 1 });
    const heavy = world.add("prop", [0, 5, 0], { mass: 10 });
    world.applyCommands([
      { type: "applyImpulse", id: light.id, impulse: [10, 0, 0] },
      { type: "applyImpulse", id: heavy.id, impulse: [10, 0, 0] },
    ]);
    // A thrown crate travels further than a thrown anvil for the same effort.
    expect(light.velocity[0]).toBeCloseTo(10, 5);
    expect(heavy.velocity[0]).toBeCloseTo(1, 5);
  });

  it("ignores commands aimed at static bodies", () => {
    const world = new SimpleWorld();
    const ground = world.add("ground", [0, 0, 0], { isStatic: true });
    world.applyCommands([{ type: "setLinearVelocity", id: ground.id, velocity: [5, 5, 5] }]);
    world.step(1);
    expect(ground.position).toEqual([0, 0, 0]);
  });

  it("ignores commands for bodies that no longer exist", () => {
    const world = new SimpleWorld();
    expect(() => world.applyCommands([{ type: "applyImpulse", id: 999, impulse: [1, 0, 0] }])).not.toThrow();
  });
});
