import { describe, expect, it, vi } from "vitest";
import {
  LoopbackNetwork,
  NetworkClient,
  NetworkHost,
  NetworkServer,
  applyDelta,
  decodeMessage,
  deltaState,
  encodeMessage,
  messageSize,
  quantizeState,
  radiusInterest,
  valuesEqual,
  type NetState,
} from "./index.js";

const SERVER_ID = 0;

/** A server and any number of clients wired through one simulated network. */
function harness(
  options: {
    conditions?: ConstructorParameters<typeof LoopbackNetwork>[0];
    server?: ConstructorParameters<typeof NetworkServer>[1];
    client?: ConstructorParameters<typeof NetworkClient>[1];
    clients?: number;
  } = {},
) {
  const network = new LoopbackNetwork(options.conditions ?? {});
  const server = new NetworkServer(network.endpoint(SERVER_ID), options.server);
  const clients = Array.from({ length: options.clients ?? 1 }, (_, index) => {
    const id = index + 1;
    const client = new NetworkClient(network.endpoint(id), options.client);
    server.addConnection(id);
    return { id, client };
  });
  let now = 0;
  /** Runs a number of ticks, delivering packets in between. */
  const run = (ticks: number, before?: (tick: number) => void): void => {
    for (let tick = 0; tick < ticks; tick += 1) {
      before?.(tick);
      server.receive();
      server.step();
      now += 50;
      network.advance(now);
      for (const entry of clients) entry.client.receive(SERVER_ID);
      network.advance(now);
      server.receive();
    }
  };
  return { network, server, clients, run };
}

describe("protocol", () => {
  it("round-trips messages", () => {
    const message = {
      type: "spawn",
      id: 1,
      prefab: "player",
      owner: 2,
      state: { x: 1 },
      tick: 5,
    } as const;
    expect(decodeMessage(encodeMessage(message))).toEqual(message);
    expect(messageSize(message)).toBeGreaterThan(0);
  });

  it("returns undefined for malformed input rather than throwing", () => {
    // One bad packet must not take down a server.
    expect(decodeMessage(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(decodeMessage(new TextEncoder().encode("not json"))).toBeUndefined();
    expect(decodeMessage(new TextEncoder().encode("[1,2]"))).toBeUndefined();
  });

  it("computes deltas containing only what changed", () => {
    expect(deltaState({ x: 1, y: 2 }, { x: 1, y: 3 })).toEqual({ y: 3 });
    expect(deltaState({ x: 1 }, { x: 1 })).toBeUndefined();
    // No baseline means the whole state.
    expect(deltaState(undefined, { x: 1 })).toEqual({ x: 1 });
  });

  it("compares nested values structurally", () => {
    expect(valuesEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(valuesEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deltaState({ p: [1, 2, 3] }, { p: [1, 2, 3] })).toBeUndefined();
    expect(deltaState({ p: [1, 2, 3] }, { p: [1, 2, 4] })).toEqual({
      p: [1, 2, 4],
    });
  });

  it("applies deltas onto a baseline", () => {
    expect(applyDelta({ x: 1, y: 2 }, { y: 9 })).toEqual({ x: 1, y: 9 });
    expect(applyDelta(undefined, { x: 1 })).toEqual({ x: 1 });
  });

  it("quantizes numbers, which is what makes delta compression work", () => {
    // A position wobbling in the sixth decimal counts as changed every tick and
    // defeats delta compression entirely.
    const noisy = { p: [1.0000001, 2.0000002, 3] };
    expect(quantizeState(noisy, 3)).toEqual({ p: [1, 2, 3] });
    expect(
      deltaState(quantizeState({ p: [1, 2, 3] }), quantizeState(noisy)),
    ).toBeUndefined();
    expect(quantizeState({ nested: { v: 1.23456 } }, 2)).toEqual({
      nested: { v: 1.23 },
    });
    expect(quantizeState({ name: "a", flag: true })).toEqual({
      name: "a",
      flag: true,
    });
  });
});

describe("simulated network", () => {
  it("delivers reliable packets despite total unreliable loss", () => {
    const network = new LoopbackNetwork({ packetLoss: 0.99 });
    const a = network.endpoint(1);
    const b = network.endpoint(2);
    a.send(2, new Uint8Array([1]), { reliable: true });
    network.advance(0);
    expect(b.receive()).toHaveLength(1);
  });

  it("drops unreliable packets at the configured rate", () => {
    const network = new LoopbackNetwork({ packetLoss: 0.5 }, 12345);
    const a = network.endpoint(1);
    network.endpoint(2);
    for (let index = 0; index < 200; index += 1)
      a.send(2, new Uint8Array([index]), { reliable: false });
    network.advance(0);
    expect(network.stats.dropped).toBeGreaterThan(50);
    expect(network.stats.dropped).toBeLessThan(150);
  });

  it("holds packets until their latency elapses", () => {
    const network = new LoopbackNetwork({ latencyMs: 100 });
    const a = network.endpoint(1);
    const b = network.endpoint(2);
    a.send(2, new Uint8Array([1]));
    network.advance(50);
    expect(b.receive()).toHaveLength(0);
    network.advance(100);
    expect(b.receive()).toHaveLength(1);
  });

  it("is deterministic given a seed", () => {
    const drops = (): number => {
      const network = new LoopbackNetwork({ packetLoss: 0.3 }, 99);
      const a = network.endpoint(1);
      network.endpoint(2);
      for (let index = 0; index < 100; index += 1)
        a.send(2, new Uint8Array([index]), { reliable: false });
      network.advance(0);
      return network.stats.dropped;
    };
    expect(drops()).toBe(drops());
  });

  it("validates its conditions", () => {
    expect(() => new LoopbackNetwork({ packetLoss: 1 })).toThrow(/\[0, 1\)/);
    expect(() => new LoopbackNetwork({ latencyMs: -1 })).toThrow(
      /must not be negative/,
    );
    expect(() => new LoopbackNetwork().setConditions({ reorder: 2 })).toThrow(
      /\[0, 1\)/,
    );
  });
});

describe("connection lifecycle", () => {
  it("welcomes a client and tells it its own connection id", () => {
    const { clients, run } = harness();
    run(1);
    expect(clients[0]!.client.connection).toBe(1);
    expect(clients[0]!.client.serverTick).toBeGreaterThanOrEqual(0);
  });

  it("rejects a duplicate connection", () => {
    const { server } = harness();
    expect(() => server.addConnection(1)).toThrow(/already connected/);
  });

  it("despawns everything a departing client owned", () => {
    const { server, clients, run } = harness({ clients: 2 });
    const owned = server.spawn("player", { x: 0 }, 1);
    server.spawn("prop", { x: 5 });
    run(2);
    expect(clients[1]!.client.entities).toHaveLength(2);

    server.removeConnection(1);
    run(2);
    expect(server.entity(owned.id)).toBeUndefined();
    expect(clients[1]!.client.entities.map((entity) => entity.prefab)).toEqual([
      "prop",
    ]);
  });
});

describe("host mode", () => {
  it("runs the local player through the normal authoritative protocol", () => {
    let host!: NetworkHost;
    host = new NetworkHost({
      server: {
        onInput: (_connection, _tick, input) => host.server.setState(1, input),
      },
      client: { predict: (state, input) => ({ ...state, ...input }) },
    });
    host.server.spawn("player", { x: 0 }, host.connectionId);
    host.step(0);
    expect(host.client.connection).toBe(host.connectionId);
    expect(host.client.entity(1)?.local).toBe(true);
    host.client.sendInput({ x: 5 });
    host.step(1);
    host.step(2);
    expect(host.server.entity(1)?.state.x).toBe(5);
    expect(host.client.entity(1)?.state.x).toBe(5);
  });

  it("supports simulated host latency and deterministic cleanup", () => {
    const host = new NetworkHost({ conditions: { latencyMs: 50 }, seed: 9 });
    host.server.spawn("world", { ready: true });
    host.step(0);
    expect(host.client.connection).toBeUndefined();
    host.step(50);
    host.step(100);
    expect(host.client.connection).toBe(host.connectionId);
    host.close();
    host.close();
    expect(() => host.step(101)).toThrow(/closed network host/);
  });

  it("requires monotonic time and a valid local connection id", () => {
    expect(() => new NetworkHost({ connectionId: 0 })).toThrow(
      /positive whole number/,
    );
    const host = new NetworkHost();
    host.step(10);
    expect(() => host.step(9)).toThrow(/finite and monotonic/);
  });
});

describe("spawning and replication", () => {
  it("replicates a spawn to every client", () => {
    const { server, clients, run } = harness({ clients: 2 });
    server.spawn("crate", { x: 1, y: 2 });
    run(2);
    for (const entry of clients) {
      expect(entry.client.entities).toHaveLength(1);
      expect(entry.client.entities[0]!.state).toMatchObject({ x: 1, y: 2 });
    }
  });

  it("marks an entity local only on its owner's client", () => {
    const { server, clients, run } = harness({ clients: 2 });
    const entity = server.spawn("player", { x: 0 }, 1);
    run(2);
    expect(clients[0]!.client.entity(entity.id)!.local).toBe(true);
    expect(clients[1]!.client.entity(entity.id)!.local).toBe(false);
  });

  it("sends only changed fields after the first snapshot", () => {
    const { server, clients, run } = harness();
    const entity = server.spawn("crate", {
      x: 0,
      y: 0,
      z: 0,
      name: "crate",
      heavy: true,
    });
    run(2);
    const baseline = clients[0]!.client.stats().bytesReceived;

    // One field of six changes.
    server.setState(entity.id, { x: 5 });
    run(1);
    const delta = clients[0]!.client.stats().bytesReceived - baseline;

    server.setState(entity.id, {
      x: 6,
      y: 7,
      z: 8,
      name: "other",
      heavy: false,
    });
    run(1);
    const full = clients[0]!.client.stats().bytesReceived - baseline - delta;
    expect(delta).toBeLessThan(full);
    expect(clients[0]!.client.entity(entity.id)!.state).toMatchObject({
      x: 6,
      y: 7,
      name: "other",
    });
  });

  it("sends nothing but the snapshot header when nothing changed", () => {
    const { server, clients, run } = harness();
    server.spawn("crate", { x: 0 });
    run(3);
    const before = clients[0]!.client.stats().bytesReceived;
    run(1);
    const idle = clients[0]!.client.stats().bytesReceived - before;
    // Still sent — the tick and input acknowledgement matter — but tiny.
    expect(idle).toBeGreaterThan(0);
    expect(idle).toBeLessThan(120);
  });

  it("replicates despawn", () => {
    const { server, clients, run } = harness();
    const entity = server.spawn("crate");
    run(2);
    expect(server.despawn(entity.id)).toBe(true);
    expect(server.despawn(entity.id)).toBe(false);
    run(2);
    expect(clients[0]!.client.entities).toHaveLength(0);
  });

  it("validates spawning and state updates", () => {
    const { server } = harness();
    expect(() => server.spawn(" ")).toThrow(/non-empty prefab/);
    expect(() => server.spawn("x", {}, 99)).toThrow(/not connected/);
    expect(() => server.setState(999, { x: 1 })).toThrow(
      /No networked entity 999/,
    );
    expect(() => server.setOwner(999, null)).toThrow(/No networked entity 999/);
  });

  it("transfers ownership, which is how a player picks something up", () => {
    const { server, clients, run } = harness({ clients: 2 });
    const crate = server.spawn("crate", { x: 0 });
    run(2);
    expect(clients[0]!.client.entity(crate.id)!.local).toBe(false);

    server.setOwner(crate.id, 1);
    expect(server.entity(crate.id)!.owner).toBe(1);
    expect(() => server.setOwner(crate.id, 99)).toThrow(/not connected/);
  });
});

describe("RPCs", () => {
  it("sends from server to all clients", () => {
    const onRpc = vi.fn();
    const { server, run } = harness({ clients: 2, client: { onRpc } });
    server.sendRpc("explode", [{ x: 1 }]);
    run(1);
    expect(onRpc).toHaveBeenCalledWith("explode", [{ x: 1 }], null);
  });

  it("sends to one client only", () => {
    const network = new LoopbackNetwork();
    const server = new NetworkServer(network.endpoint(0));
    const seen: string[] = [];
    const one = new NetworkClient(network.endpoint(1), {
      onRpc: (name) => seen.push(`one:${name}`),
    });
    const two = new NetworkClient(network.endpoint(2), {
      onRpc: (name) => seen.push(`two:${name}`),
    });
    server.addConnection(1);
    server.addConnection(2);
    server.sendRpc("secret", [], { to: 1 });
    network.advance(0);
    one.receive();
    two.receive();
    expect(seen).toEqual(["one:secret"]);
    expect(() => server.sendRpc("x", [], { to: 99 })).toThrow(/not connected/);
  });

  it("sends from client to server", () => {
    const onRpc = vi.fn();
    const { clients, run } = harness({ server: { onRpc } });
    clients[0]!.client.sendRpc("chat", ["hello"]);
    run(1);
    expect(onRpc).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      "chat",
      ["hello"],
      null,
    );
  });

  it("rejects an unnamed RPC", () => {
    const { server, clients } = harness();
    expect(() => server.sendRpc(" ")).toThrow(/non-empty name/);
    expect(() => clients[0]!.client.sendRpc("")).toThrow(/non-empty name/);
  });
});

describe("input, prediction, and reconciliation", () => {
  /** A one-dimensional mover: input.dx moves x. */
  const predict = (state: NetState, input: NetState): NetState => ({
    ...state,
    x: (state.x as number) + ((input.dx as number) ?? 0),
  });

  it("applies input immediately on the owning client", () => {
    const { server, clients, run } = harness({ client: { predict } });
    const player = server.spawn("player", { x: 0 }, 1);
    run(2);
    clients[0]!.client.sendInput({ dx: 1 });
    // Predicted before the server has even seen it.
    expect(clients[0]!.client.entity(player.id)!.state.x).toBe(1);
  });

  it("acknowledges inputs and clears them from the pending buffer", () => {
    const { server, clients, run } = harness({
      client: { predict },
      server: {
        onInput: (_connection, _tick, payload) => {
          server.setState(1, {
            x:
              (server.entity(1)!.state.x as number) +
              ((payload.dx as number) ?? 0),
          });
        },
      },
    });
    server.spawn("player", { x: 0 }, 1);
    run(2);
    clients[0]!.client.sendInput({ dx: 1 });
    expect(clients[0]!.client.pendingInputs).toHaveLength(1);
    run(3);
    expect(clients[0]!.client.pendingInputs).toHaveLength(0);
  });

  it("converges on the server's value after a correction", () => {
    // The server applies half of what the client predicted, so the client is
    // wrong every tick and must be pulled back.
    const network = new LoopbackNetwork({ latencyMs: 40 });
    const server = new NetworkServer(network.endpoint(0), {
      onInput: (_connection, _tick, payload) => {
        const entity = server.entity(1)!;
        server.setState(1, {
          x: (entity.state.x as number) + ((payload.dx as number) ?? 0) * 0.5,
        });
      },
    });
    const client = new NetworkClient(network.endpoint(1), { predict });
    server.addConnection(1);
    const player = server.spawn("player", { x: 0 }, 1);

    let now = 0;
    for (let tick = 0; tick < 40; tick += 1) {
      client.sendInput({ dx: 1 });
      now += 50;
      network.advance(now);
      server.receive();
      server.step();
      now += 50;
      network.advance(now);
      client.receive();
    }
    const authoritative = server.entity(player.id)!.state.x as number;
    const predicted = client.entity(player.id)!.state.x as number;
    // Prediction tracks the server rather than drifting away from it.
    expect(Math.abs(predicted - authoritative)).toBeLessThan(3);
    expect(client.stats().mispredictions).toBeGreaterThan(0);
  });

  it("ignores stale inputs, so a client cannot rewind its own history", () => {
    const onInput = vi.fn();
    const network = new LoopbackNetwork();
    const server = new NetworkServer(network.endpoint(0), { onInput });
    const endpoint = network.endpoint(1);
    server.addConnection(1);
    endpoint.send(
      0,
      encodeMessage({ type: "input", tick: 5, payload: { dx: 1 } }),
    );
    endpoint.send(
      0,
      encodeMessage({ type: "input", tick: 3, payload: { dx: 9 } }),
    );
    network.advance(0);
    server.receive();
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledWith(expect.anything(), 5, { dx: 1 });
  });

  it("applies the server's state directly when no predictor is configured", () => {
    const { server, clients, run } = harness();
    const player = server.spawn("player", { x: 0 }, 1);
    run(2);
    server.setState(player.id, { x: 42 });
    run(2);
    expect(clients[0]!.client.entity(player.id)!.state.x).toBe(42);
  });
});

describe("interpolation", () => {
  it("renders remote entities behind the newest snapshot", () => {
    const { server, clients, run } = harness({
      client: { interpolationDelayTicks: 2 },
    });
    const crate = server.spawn("crate", { x: 0 });
    let position = 0;
    run(10, () => {
      position += 10;
      server.setState(crate.id, { x: position });
    });
    const latest = clients[0]!.client.entity(crate.id)!.state.x as number;
    const shown = clients[0]!.client.interpolated(crate.id)!.x as number;
    // Rendered in the past, and smoothly between samples.
    expect(shown).toBeLessThan(latest);
    expect(shown).toBeGreaterThan(0);
  });

  it("returns the predicted state for local entities, not an interpolated one", () => {
    const predict = (state: NetState, input: NetState): NetState => ({
      ...state,
      x: (state.x as number) + ((input.dx as number) ?? 0),
    });
    const { server, clients, run } = harness({ client: { predict } });
    const player = server.spawn("player", { x: 0 }, 1);
    run(2);
    clients[0]!.client.sendInput({ dx: 5 });
    // Interpolating what the player controls is what makes controls feel like a boat.
    expect(clients[0]!.client.interpolated(player.id)!.x).toBe(
      clients[0]!.client.entity(player.id)!.state.x,
    );
  });

  it("interpolates array fields component-wise", () => {
    const { server, clients, run } = harness({
      client: { interpolationDelayTicks: 1 },
    });
    const crate = server.spawn("crate", { p: [0, 0, 0] });
    let step = 0;
    run(8, () => {
      step += 1;
      server.setState(crate.id, { p: [step * 4, 0, 0] });
    });
    const shown = clients[0]!.client.interpolated(crate.id)!.p as number[];
    expect(shown[0]).toBeGreaterThan(0);
    expect(shown).toHaveLength(3);
  });

  it("returns undefined for an unknown entity", () => {
    const { clients } = harness();
    expect(clients[0]!.client.interpolated(999)).toBeUndefined();
  });

  it("validates its options", () => {
    const network = new LoopbackNetwork();
    expect(
      () =>
        new NetworkClient(network.endpoint(1), { interpolationDelayTicks: -1 }),
    ).toThrow(/non-negative/);
    expect(
      () => new NetworkClient(network.endpoint(2), { historyTicks: 1 }),
    ).toThrow(/at least 2/);
  });
});

describe("interest management", () => {
  it("tells a client only about entities near it", () => {
    const viewers = new Map<number, readonly number[]>([[1, [0, 0, 0]]]);
    const { server, clients, run } = harness({
      server: {
        interest: radiusInterest(
          50,
          (state) => state.p as number[] | undefined,
          (connection) => viewers.get(connection.id),
        ),
      },
    });
    const near = server.spawn("crate", { p: [10, 0, 0] });
    const far = server.spawn("crate", { p: [500, 0, 0] });
    run(2);

    const seen = clients[0]!.client.entities.map((entity) => entity.id);
    expect(seen).toContain(near.id);
    expect(seen).not.toContain(far.id);
  });

  it("spawns and despawns as entities enter and leave the radius", () => {
    const viewers = new Map<number, readonly number[]>([[1, [0, 0, 0]]]);
    const { server, clients, run } = harness({
      server: {
        interest: radiusInterest(
          50,
          (state) => state.p as number[] | undefined,
          (connection) => viewers.get(connection.id),
        ),
      },
    });
    const crate = server.spawn("crate", { p: [500, 0, 0] });
    run(2);
    expect(clients[0]!.client.entity(crate.id)).toBeUndefined();

    server.setState(crate.id, { p: [5, 0, 0] });
    run(2);
    expect(clients[0]!.client.entity(crate.id)).toBeDefined();

    server.setState(crate.id, { p: [900, 0, 0] });
    run(2);
    expect(clients[0]!.client.entity(crate.id)).toBeUndefined();
  });

  it("includes entities whose relevance cannot be judged", () => {
    // Silently never appearing is a worse failure than being over-informed.
    const { server, clients, run } = harness({
      server: {
        interest: radiusInterest(
          10,
          () => undefined,
          () => [0, 0, 0],
        ),
      },
    });
    server.spawn("crate", { x: 1 });
    run(2);
    expect(clients[0]!.client.entities).toHaveLength(1);
  });

  it("rejects a non-positive radius", () => {
    expect(() =>
      radiusInterest(
        0,
        () => [0, 0, 0],
        () => [0, 0, 0],
      ),
    ).toThrow(/must be positive/);
  });
});

describe("adverse conditions", () => {
  it("keeps clients converged through latency, jitter, loss, and reordering", () => {
    const { server, clients, run } = harness({
      conditions: {
        latencyMs: 80,
        jitterMs: 40,
        packetLoss: 0.15,
        reorder: 0.1,
      },
      clients: 2,
    });
    const crate = server.spawn("crate", { x: 0 });
    let position = 0;
    run(40, () => {
      position += 1;
      server.setState(crate.id, { x: position });
    });
    // A dropped snapshot is superseded by the next, so both clients end up on
    // the server's value rather than stuck on a stale one.
    for (const entry of clients) {
      expect(entry.client.entity(crate.id)!.state.x).toBeGreaterThan(
        position - 8,
      );
    }
  });

  it("reports server and client statistics", () => {
    const { server, clients, run } = harness();
    server.spawn("crate", { x: 1 });
    run(3);
    expect(server.stats()).toMatchObject({ connections: 1, entities: 1 });
    expect(server.stats().bytesSent).toBeGreaterThan(0);
    expect(server.stats().snapshotsSent).toBeGreaterThanOrEqual(3);
    expect(clients[0]!.client.stats().bytesReceived).toBeGreaterThan(0);
  });

  it("validates server options", () => {
    const network = new LoopbackNetwork();
    expect(
      () => new NetworkServer(network.endpoint(0), { tickRate: 0 }),
    ).toThrow(/at least 1/);
    expect(
      () => new NetworkServer(network.endpoint(0), { decimals: -1 }),
    ).toThrow(/non-negative/);
  });
});
