import { describe, expect, it } from "vitest";
import { LagCompensator, SnapshotHistory } from "./lag-compensation.js";
import { NetworkClient } from "./client.js";
import { NetworkServer } from "./server.js";
import { LoopbackNetwork } from "./transport.js";

/** A target moving +1 on x per tick: at tick `t` it is at `[t, 0, 0]`. */
function recordMovingTarget(history: SnapshotHistory, ticks: number): void {
  for (let tick = 1; tick <= ticks; tick += 1) history.record(tick, [{ id: 7, state: { p: [tick, 0, 0] } }]);
}

const positionOf = (state: { readonly p?: unknown }): readonly number[] | undefined => state.p as number[] | undefined;

describe("SnapshotHistory", () => {
  it("returns the recorded state for a tick inside the window", () => {
    const history = new SnapshotHistory({ capacity: 8, tickRate: 20, maxRewindMs: 250 });
    recordMovingTarget(history, 20);
    expect(history.ticks).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
    expect(history.at(17)?.states.get(7)).toEqual({ p: [17, 0, 0] });

    const rewound = history.rewindToTick(17);
    expect(rewound.tick).toBe(17);
    expect(rewound.clamped).toBe(false);
    expect(rewound.states.get(7)).toEqual({ p: [17, 0, 0] });
  });

  it("interpolates between ticks for a fractional rewind", () => {
    const history = new SnapshotHistory({ tickRate: 20, maxRewindMs: 250 });
    recordMovingTarget(history, 20);
    // 80 ms at 20 Hz is 1.6 ticks.
    const rewound = history.rewind(80);
    expect(rewound.tick).toBeCloseTo(18.4, 6);
    expect((rewound.states.get(7)!.p as number[])[0]).toBeCloseTo(18.4, 6);
  });

  it("clamps a rewind older than maxRewindMs and says so", () => {
    const history = new SnapshotHistory({ tickRate: 20, maxRewindMs: 250 });
    recordMovingTarget(history, 20);
    const rewound = history.rewindToTick(10); // 500 ms ago; budget is 250 ms
    expect(rewound.clamped).toBe(true);
    expect(rewound.appliedMs).toBe(250);
    expect(rewound.tick).toBe(15);
    expect(rewound.states.get(7)).toEqual({ p: [15, 0, 0] });
  });

  it("clamps to the oldest retained tick when history has been evicted", () => {
    const history = new SnapshotHistory({ capacity: 4, tickRate: 20, maxRewindMs: 10_000 });
    recordMovingTarget(history, 20);
    const rewound = history.rewind(1000);
    expect(rewound.clamped).toBe(true);
    expect(rewound.tick).toBe(17);
  });

  it("never grows past its capacity", () => {
    const history = new SnapshotHistory({ capacity: 3 });
    recordMovingTarget(history, 100);
    expect(history.ticks).toEqual([98, 99, 100]);
    expect(history.oldestTick).toBe(98);
    expect(history.newestTick).toBe(100);
  });

  it("validates its options", () => {
    expect(() => new SnapshotHistory({ capacity: 1 })).toThrow(/at least 2/);
    expect(() => new SnapshotHistory({ maxRewindMs: -1 })).toThrow(/not be negative/);
    expect(() => new SnapshotHistory().rewind(-1)).toThrow(/non-negative/);
  });
});

describe("LagCompensator", () => {
  it("validates a shot against where the target was 80 ms ago, and fails it against the present", () => {
    const compensator = new LagCompensator({ positionOf, tickRate: 20, maxRewindMs: 250, radius: 0.5 });
    recordMovingTarget(compensator.history, 20);

    // The shooter aimed at x = 18.4, which is where the target was 1.6 ticks ago.
    const shot = { origin: [18.4, 0, 10] as const, direction: [0, 0, -1] as const };
    const rewound = compensator.validateHit({ ...shot, latencyMs: 80 });
    expect(rewound.hit).toBe(7);
    expect(rewound.clamped).toBe(false);
    expect(rewound.position).toEqual([18.4, 0, 0]);

    // Judged against the present (x = 20) the same shot misses by 1.6 units.
    const present = compensator.validateHit({ ...shot, latencyMs: 0 });
    expect(present.hit).toBeUndefined();
  });

  it("fails a shot at a position the target left before the clamp window", () => {
    const compensator = new LagCompensator({ positionOf, tickRate: 20, maxRewindMs: 250 });
    recordMovingTarget(compensator.history, 20);

    // The target was at x = 10 half a second ago. A client claiming 500 ms of
    // latency gets 250 ms of rewind — to x = 15 — and misses.
    const shot = { origin: [10, 0, 10] as const, direction: [0, 0, -1] as const };
    const clamped = compensator.validateHit({ ...shot, latencyMs: 500 });
    expect(clamped.hit).toBeUndefined();
    expect(clamped.clamped).toBe(true);
    expect(clamped.tick).toBe(15);

    // With a budget that covers it, the same shot lands: the clamp is what failed it.
    const generous = new LagCompensator({ positionOf, tickRate: 20, maxRewindMs: 1000 });
    recordMovingTarget(generous.history, 20);
    expect(generous.validateHit({ ...shot, latencyMs: 500 }).hit).toBe(7);
  });

  it("rewinds to a client's view tick, ignores listed entities, and picks the nearest", () => {
    const compensator = new LagCompensator({ positionOf, tickRate: 20 });
    compensator.record(1, [
      { id: 1, state: { p: [0, 0, 5] } },
      { id: 2, state: { p: [0, 0, 2] } },
      { id: 3, state: { p: [9, 9, 9] } },
    ]);
    const shot = { origin: [0, 0, 10] as const, direction: [0, 0, -1] as const, viewTick: 1 };
    expect(compensator.validateHit(shot).hit).toBe(1);
    expect(compensator.validateHit({ ...shot, ignore: [1] }).hit).toBe(2);
    expect(compensator.validateHit({ ...shot, maxDistance: 3 }).hit).toBeUndefined();
    expect(() => compensator.validateHit({ origin: [0, 0, 0], direction: [1, 0, 0] })).toThrow(/viewTick or a latencyMs/);
  });

  it("judges a real client's shot at the tick it reported, sharing the server's history", () => {
    const network = new LoopbackNetwork({ latencyMs: 40 });
    let shot: { hit: number | undefined; tick: number } | undefined;
    const server = new NetworkServer(network.endpoint(0), {
      tickRate: 20,
      lagCompensation: { maxRewindMs: 250 },
      onRpc: (connection, name, args) => {
        if (name !== "fire") return;
        const [x] = args as [number];
        shot = compensator.validateHit({
          viewTick: connection.viewTick,
          origin: [x, 0, 10],
          direction: [0, 0, -1],
          ignore: [player.id],
        });
      },
    });
    const compensator = new LagCompensator({ positionOf, history: server.history!, radius: 0.5 });
    const client = new NetworkClient(network.endpoint(1), { interpolationDelayTicks: 2 });
    server.addConnection(1);
    const player = server.spawn("player", { p: [0, 0, 10] }, 1);
    const target = server.spawn("target", { p: [0, 0, 0] });

    let now = 0;
    const step = (): void => {
      client.sendInput({});
      server.receive();
      server.setState(target.id, { p: [server.tick + 1, 0, 0] });
      server.step();
      now += 50;
      network.advance(now);
      client.receive();
      network.advance(now);
    };
    for (let tick = 0; tick < 12; tick += 1) step();

    // The client renders two ticks behind the newest snapshot it has, which
    // itself is one tick old by the time it arrives.
    const viewed = client.viewTick;
    const seen = (client.interpolated(target.id)!.p as number[])[0]!;
    client.sendRpc("fire", [seen]);
    step();
    step();

    expect(shot?.hit).toBe(target.id);
    expect(shot?.tick).toBe(viewed);
    expect(server.connection(1)!.viewTick).toBe(viewed);
    // 40 ms each way at 20 Hz is a round trip of about two ticks.
    expect(client.stats().rttTicks).toBeGreaterThanOrEqual(1);
    expect(client.stats().rttTicks).toBeLessThanOrEqual(3);
  });
});
