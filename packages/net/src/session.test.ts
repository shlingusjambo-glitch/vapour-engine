import { describe, expect, it, vi } from "vitest";
import { NetworkClient, type ClientOptions } from "./client.js";
import { NetworkHost, chooseSuccessor } from "./host.js";
import { NetworkServer, type ServerOptions } from "./server.js";
import { LoopbackNetwork } from "./transport.js";

/** A server plus clients that must `join` to be admitted. */
function harness(options: { server?: ServerOptions; client?: ClientOptions; clients?: number } = {}) {
  const network = new LoopbackNetwork();
  const server = new NetworkServer(network.endpoint(0), { sessionToken: (id) => `token-${String(id)}`, ...options.server });
  const clients = Array.from({ length: options.clients ?? 1 }, (_, index) => {
    const id = index + 1;
    return { id, client: new NetworkClient(network.endpoint(id), options.client) };
  });
  let now = 0;
  const run = (ticks: number): void => {
    for (let tick = 0; tick < ticks; tick += 1) {
      server.receive();
      server.step();
      now += 50;
      network.advance(now);
      for (const entry of clients) entry.client.receive(0);
      network.advance(now);
      server.receive();
    }
  };
  return { network, server, clients, run };
}

describe("authentication", () => {
  it("admits a peer whose credentials the hook accepts and records its identity", () => {
    const { server, clients, run } = harness({
      server: {
        authenticate: ({ credentials }) =>
          credentials.password === "hunter2" ? { ok: true, identity: { name: String(credentials.name) } } : { ok: false, reason: "bad password" },
      },
    });
    clients[0]!.client.join({ name: "ely", password: "hunter2" });
    run(2);
    expect(clients[0]!.client.connection).toBe(1);
    expect(clients[0]!.client.session).toBe("token-1");
    expect(server.connection(1)?.identity).toEqual({ name: "ely" });
  });

  it("rejects a peer the hook refuses, telling it why, and admits nothing else from it", () => {
    const onReject = vi.fn();
    const onInput = vi.fn();
    const { server, clients, run } = harness({
      server: { authenticate: () => ({ ok: false, reason: "banned" }), onInput },
      client: { onReject },
    });
    clients[0]!.client.sendInput({ dx: 1 });
    clients[0]!.client.join({ name: "mallory" });
    run(2);
    expect(onReject).toHaveBeenCalledWith("banned");
    expect(clients[0]!.client.connection).toBeUndefined();
    expect(server.connections).toHaveLength(0);
    expect(onInput).not.toHaveBeenCalled();
  });

  it("admits any joiner when no hook is configured", () => {
    const { server, clients, run } = harness();
    clients[0]!.client.join();
    run(1);
    expect(server.connections.map((connection) => connection.id)).toEqual([1]);
  });
});

describe("reconnection", () => {
  it("keeps a dropped player's entity through the grace window and rebinds it on resume", () => {
    const onJoin = vi.fn();
    const { network, server, clients, run } = harness({ server: { reconnectGraceTicks: 10, onJoin }, clients: 2 });
    for (const entry of clients) entry.client.join();
    run(1);
    const player = server.spawn("player", { hp: 73 }, 1);
    run(2);
    expect(clients[1]!.client.entity(player.id)).toBeDefined();

    const session = server.dropConnection(1);
    expect(session).toBe("token-1");
    expect(server.stats().suspended).toBe(1);
    run(3);
    // Still there for everyone else: a Wi-Fi blip is not a death.
    expect(server.entity(player.id)?.state.hp).toBe(73);
    expect(clients[1]!.client.entity(player.id)).toBeDefined();

    // Back on a new socket. Ownership follows the session, not the socket.
    const returned = new NetworkClient(network.endpoint(9));
    returned.resume(session!);
    clients.push({ id: 9, client: returned });
    run(2);
    expect(returned.connection).toBe(9);
    expect(server.entity(player.id)?.owner).toBe(9);
    expect(returned.entity(player.id)?.local).toBe(true);
    expect(server.stats().suspended).toBe(0);
    expect(onJoin).toHaveBeenLastCalledWith(expect.objectContaining({ id: 9 }), true);
  });

  it("despawns the entities of a session that never comes back", () => {
    const onSessionExpired = vi.fn();
    const { server, clients, run } = harness({ server: { reconnectGraceTicks: 3, onSessionExpired }, clients: 2 });
    for (const entry of clients) entry.client.join();
    run(1);
    const player = server.spawn("player", {}, 1);
    run(1);
    server.dropConnection(1);
    run(4);
    expect(server.entity(player.id)).toBeUndefined();
    expect(clients[1]!.client.entity(player.id)).toBeUndefined();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(server.resumeConnection("token-1", 5)).toBeUndefined();
  });

  it("drops immediately when no grace is configured", () => {
    const { server, clients, run } = harness();
    clients[0]!.client.join();
    run(1);
    const player = server.spawn("player", {}, 1);
    expect(server.dropConnection(1)).toBeUndefined();
    expect(server.entity(player.id)).toBeUndefined();
  });
});

describe("host migration", () => {
  function hostWithTwoClients() {
    const host = new NetworkHost({ connectionId: 1, server: { sessionToken: (id) => `token-${String(id)}`, reconnectGraceTicks: 5 } });
    const two = new NetworkClient(host.network.endpoint(2));
    const three = new NetworkClient(host.network.endpoint(3));
    two.join();
    three.join();
    let now = 0;
    const step = (): void => {
      now += 50;
      host.step(now);
      two.receive(0);
      three.receive(0);
    };
    step();
    const p1 = host.server.spawn("player", { x: 1 }, 1);
    const p2 = host.server.spawn("player", { x: 2 }, 2);
    const p3 = host.server.spawn("player", { x: 3 }, 3);
    const crate = host.server.spawn("crate", { x: 9 });
    step();
    step();
    return { host, two, three, p1, p2, p3, crate, now };
  }

  it("chooses the lowest ready connection id other than the departing host", () => {
    const { host } = hostWithTwoClients();
    expect(chooseSuccessor(host.server, 1)).toBe(2);
    expect(chooseSuccessor(host.server, 2)).toBe(1);
    host.server.connection(2)!.ready = false;
    expect(chooseSuccessor(host.server, 1)).toBe(3);
  });

  it("hands the world to client 2 with every entity id, owner, and session intact", () => {
    const { host, three, p1, p2, p3, crate } = hostWithTwoClients();
    expect(three.entity(p3.id)?.local).toBe(true);
    const tickBefore = host.server.tick;

    const migration = host.migrateHost()!;
    expect(migration.successor).toBe(2);
    expect(() => host.step(999)).toThrow(/closed/);

    // Client 2 stands up a host from the handover; client 3 reconnects to it
    // with the token it already holds.
    const next = new NetworkHost({ connectionId: 2, handover: migration.handover, server: { reconnectGraceTicks: 5 } });
    expect(next.server.tick).toBe(tickBefore);
    expect(next.server.entity(p2.id)?.owner).toBe(2);
    expect(next.server.entity(p3.id)?.owner).toBe(3);
    expect(next.server.entity(crate.id)?.state).toEqual({ x: 9 });
    expect(next.server.stats().suspended).toBe(2); // old host and client 3

    const survivor = new NetworkClient(next.network.endpoint(3));
    survivor.resume(three.session!);
    let now = 1000;
    for (let tick = 0; tick < 3; tick += 1) {
      now += 50;
      next.step(now);
      survivor.receive(0);
    }
    expect(next.client.connection).toBe(2);
    expect(next.client.entity(p2.id)?.local).toBe(true);
    expect(survivor.connection).toBe(3);
    expect(survivor.entity(p3.id)?.local).toBe(true);
    expect(survivor.entity(p2.id)?.local).toBe(false);
    expect(next.server.entity(p3.id)?.owner).toBe(3);

    // The old host never comes back; its avatar goes when its grace runs out.
    for (let tick = 0; tick < 6; tick += 1) {
      now += 50;
      next.step(now);
      survivor.receive(0);
    }
    expect(next.server.entity(p1.id)).toBeUndefined();
    expect(survivor.entity(p1.id)).toBeUndefined();
    expect(next.server.stats().suspended).toBe(0);
  });

  it("stays open when there is nobody to hand to", () => {
    const host = new NetworkHost();
    host.step(0);
    expect(host.migrateHost()).toBeUndefined();
    host.step(1);
  });
});

describe("scene synchronization", () => {
  it("holds replication until a client reports the scene loaded, then sends full spawns", () => {
    const loads: [string, number][] = [];
    const { server, clients, run } = harness({
      server: { scene: "arena" },
      client: { onSceneLoad: (scene, generation) => loads.push([scene, generation]) },
    });
    server.spawn("crate", { x: 1 });
    server.spawn("crate", { x: 2 });
    clients[0]!.client.join();
    run(3);
    expect(loads).toEqual([["arena", 1]]);
    expect(server.stats().loading).toBe(1);
    expect(server.stats().snapshotsSent).toBe(0);
    expect(clients[0]!.client.entities).toHaveLength(0);

    clients[0]!.client.reportSceneProgress(0.5, false);
    run(1);
    expect(server.connection(1)?.sceneProgress).toBe(0.5);
    expect(clients[0]!.client.entities).toHaveLength(0);

    clients[0]!.client.reportSceneProgress(1, true);
    run(2);
    expect(server.stats().loading).toBe(0);
    expect(clients[0]!.client.entities.map((entity) => entity.state.x)).toEqual([1, 2]);
  });

  it("gives a late joiner the whole current world once it is ready", () => {
    const { network, server, clients, run } = harness({ server: { scene: "arena" } });
    clients[0]!.client.join();
    run(1);
    clients[0]!.client.reportSceneProgress(1, true);
    const first = server.spawn("crate", { x: 1 });
    run(2);
    server.setState(first.id, { x: 5 });
    server.spawn("crate", { x: 2 });
    run(2);

    const spawned: number[] = [];
    const late = new NetworkClient(network.endpoint(2), { onSpawn: (entity) => spawned.push(entity.state.x as number) });
    clients.push({ id: 2, client: late });
    late.join();
    run(2);
    expect(spawned).toEqual([]);
    late.reportSceneProgress(1, true);
    run(2);
    // Full state, not a delta against a baseline it never had.
    expect(spawned.sort()).toEqual([2, 5]);
  });

  it("ignores a progress report for a generation the server has moved past", () => {
    const { server, clients, run } = harness({ server: { scene: "lobby" }, clients: 1 });
    clients[0]!.client.join();
    run(2);
    clients[0]!.client.reportSceneProgress(1, true);
    run(1);
    expect(server.connection(1)?.ready).toBe(true);

    server.setScene("arena");
    run(1);
    expect(clients[0]!.client.scene).toBe("arena");
    expect(clients[0]!.client.sceneGeneration).toBe(2);
    expect(server.connection(1)?.ready).toBe(false);

    // A loader that just finished the *old* scene reports for generation 1.
    clients[0]!.client.reportSceneProgress(1, true, 1);
    run(1);
    expect(server.connection(1)?.ready).toBe(false);
    expect(server.connection(1)?.sceneProgress).toBe(0);

    clients[0]!.client.reportSceneProgress(1, true);
    run(1);
    expect(server.connection(1)?.ready).toBe(true);
  });

  it("validates progress and scene names", () => {
    const { server, clients } = harness();
    expect(() => clients[0]!.client.reportSceneProgress(2, false)).toThrow(/\[0, 1\]/);
    expect(() => server.setScene(" ")).toThrow(/must not be empty/);
    expect(() => new NetworkServer(new LoopbackNetwork().endpoint(0), { scene: "" })).toThrow(/non-empty/);
  });
});
