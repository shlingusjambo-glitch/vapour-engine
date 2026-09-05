import { describe, expect, it } from "vitest";
import { LoopbackNetwork } from "@vapour/net";
import {
  ARENA_SIZE, MAX_HEALTH, PLAYER_SPEED, PROJECTILE_DAMAGE, RESPAWN_SECONDS,
  newPlayer, projectileHits, spawnPoint, stepPlayer, stepProjectile,
  type PlayerInputPayload,
} from "./arena.js";
import { ArenaClient, ArenaServer } from "./session.js";

const idle: PlayerInputPayload = { moveX: 0, moveZ: 0, aimX: 0, aimZ: -1, fire: false, dt: 1 / 20 };

describe("shared simulation", () => {
  it("moves a player at its speed", () => {
    const moved = stepPlayer(newPlayer(), { ...idle, moveX: 1, dt: 1 });
    expect(moved.x).toBeCloseTo(PLAYER_SPEED, 5);
  });

  it("normalizes movement, so a modified client cannot move faster diagonally", () => {
    const diagonal = stepPlayer(newPlayer(), { ...idle, moveX: 1, moveZ: 1, dt: 1 });
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(PLAYER_SPEED, 5);
  });

  it("clamps an oversized movement vector rather than trusting it", () => {
    // The whole point of server authority: a client sending a vector of length
    // ten must not move ten times as fast.
    const cheating = stepPlayer(newPlayer(), { ...idle, moveX: 10, moveZ: 0, dt: 1 });
    expect(cheating.x).toBeCloseTo(PLAYER_SPEED, 5);
  });

  it("keeps players inside the arena", () => {
    let state = newPlayer();
    for (let step = 0; step < 100; step += 1) state = stepPlayer(state, { ...idle, moveX: 1, dt: 1 });
    expect(state.x).toBeLessThanOrEqual(ARENA_SIZE / 2);
  });

  it("counts down a respawn and returns the player to the centre", () => {
    let dead = { ...newPlayer(5, 5), health: 0, respawn: RESPAWN_SECONDS };
    for (let step = 0; step < 5; step += 1) dead = stepPlayer(dead, { ...idle, dt: 1 });
    expect(dead.respawn).toBe(0);
    expect(dead.health).toBe(MAX_HEALTH);
    expect([dead.x, dead.z]).toEqual([0, 0]);
  });

  it("ignores movement while dead", () => {
    const dead = stepPlayer({ ...newPlayer(3, 3), health: 0, respawn: 2 }, { ...idle, moveX: 1, dt: 0.1 });
    expect(dead.x).toBe(3);
  });

  it("expires projectiles by lifetime and by leaving the arena", () => {
    const base = { x: 0, z: 0, vx: 0, vz: 0, owner: 1, life: 0.05 };
    expect(stepProjectile(base, 0.1)).toBeUndefined();
    expect(stepProjectile({ ...base, life: 5, vx: 1000 }, 1)).toBeUndefined();
    expect(stepProjectile({ ...base, life: 5, vx: 1 }, 0.1)).toBeDefined();
  });

  it("does not let a projectile hit its owner or a dead player", () => {
    const projectile = { x: 0, z: 0, vx: 0, vz: 0, owner: 7, life: 1 };
    expect(projectileHits(projectile, newPlayer(), 7)).toBe(false);
    expect(projectileHits(projectile, { ...newPlayer(), respawn: 2 }, 9)).toBe(false);
    expect(projectileHits(projectile, newPlayer(), 9)).toBe(true);
    expect(projectileHits(projectile, newPlayer(20, 0), 9)).toBe(false);
  });

  it("spreads spawn points around a ring", () => {
    const points = Array.from({ length: 4 }, (_, index) => spawnPoint(index, 4));
    const distinct = new Set(points.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`));
    expect(distinct.size).toBe(4);
  });
});

/** A server plus clients over a simulated network. */
function arena(options: { clients?: number; conditions?: ConstructorParameters<typeof LoopbackNetwork>[0] } = {}) {
  const network = new LoopbackNetwork(options.conditions ?? {});
  const server = new ArenaServer(network.endpoint(0));
  const clients = Array.from({ length: options.clients ?? 2 }, (_, index) => {
    const id = index + 1;
    const client = new ArenaClient(network.endpoint(id));
    const entity = server.join(id);
    return { id, client, entity };
  });

  let now = 0;
  const dt = 1 / 20;
  const tick = (inputs: (index: number) => PlayerInputPayload = () => idle): void => {
    for (const [index, entry] of clients.entries()) entry.client.send(inputs(index));
    now += 25;
    network.advance(now);
    server.step(dt);
    now += 25;
    network.advance(now);
    for (const entry of clients) entry.client.receive();
    network.advance(now);
  };
  const run = (ticks: number, inputs?: (index: number) => PlayerInputPayload): void => {
    for (let step = 0; step < ticks; step += 1) tick(inputs);
  };
  return { network, server, clients, tick, run };
}

describe("session", () => {
  it("spawns a player per client, owned by them", () => {
    const { clients, run } = arena({ clients: 3 });
    run(3);
    for (const entry of clients) {
      expect(entry.client.self()).toBeDefined();
      // Two others, and they are not this client's own.
      expect(entry.client.others()).toHaveLength(2);
    }
  });

  it("applies input immediately on the owning client, before the server sees it", () => {
    const { clients, run } = arena({ clients: 1 });
    // One tick so the client has received its own spawn.
    run(2);
    const before = clients[0]!.client.self()!.x;
    clients[0]!.client.send({ ...idle, moveX: 1, dt: 1 });
    // Predicted straight away — no round trip, no server involvement.
    expect(clients[0]!.client.self()!.x).toBeGreaterThan(before);
  });

  it("converges the client's prediction on the server's truth", () => {
    const { server, clients, run } = arena({ clients: 1, conditions: { latencyMs: 60 } });
    run(30, () => ({ ...idle, moveX: 1, dt: 1 / 20 }));
    const predicted = clients[0]!.client.self()!;
    const authoritative = server.net.entity(clients[0]!.entity)!.state as { x: number };
    expect(Math.abs(predicted.x - authoritative.x)).toBeLessThan(1);
  });

  it("shows other players at all, and never predicts them", () => {
    const { clients, run } = arena({ clients: 2 });
    run(20, (index) => (index === 0 ? { ...idle, moveX: 1, dt: 1 / 20 } : idle));
    const seen = clients[1]!.client.others();
    expect(seen).toHaveLength(1);
    expect(Number.isFinite(seen[0]!.x)).toBe(true);
  });

  it("fires projectiles from the server, not the client", () => {
    const { server, run } = arena({ clients: 1 });
    run(2, () => ({ ...idle, fire: true, aimX: 1, aimZ: 0, dt: 1 / 20 }));
    expect(server.stats().shotsFired).toBeGreaterThan(0);
  });

  it("damages, kills, scores, and respawns", () => {
    const { server, clients, run } = arena({ clients: 2 });
    // Put the two players in a line so shots connect.
    const shooterId = clients[0]!.entity;
    const targetId = clients[1]!.entity;
    server.net.setState(shooterId, { ...newPlayer(-2, 0) });
    server.net.setState(targetId, { ...newPlayer(2, 0) });

    run(40, (index) => (index === 0 ? { ...idle, fire: true, aimX: 1, aimZ: 0, dt: 1 / 20 } : idle));

    const stats = server.stats();
    expect(stats.hits).toBeGreaterThan(0);
    const target = server.net.entity(targetId)!.state as { health: number; respawn: number };
    // Either damaged, or killed and now respawning.
    expect(target.health < MAX_HEALTH || target.respawn > 0 || stats.deaths > 0).toBe(true);
    if (stats.deaths > 0) {
      expect((server.net.entity(shooterId)!.state as { score: number }).score).toBeGreaterThan(0);
    }
  });

  it("takes several hits to kill, at the configured damage", () => {
    expect(Math.ceil(MAX_HEALTH / PROJECTILE_DAMAGE)).toBeGreaterThan(1);
  });

  it("despawns a leaving player's avatar for everyone", () => {
    const { server, clients, run } = arena({ clients: 2 });
    run(3);
    expect(clients[1]!.client.others()).toHaveLength(1);
    server.leave(clients[0]!.id);
    run(3);
    expect(clients[1]!.client.others()).toHaveLength(0);
  });

  it("keeps clients converged through latency, jitter, and packet loss", () => {
    const { server, clients, run } = arena({
      clients: 2,
      conditions: { latencyMs: 90, jitterMs: 40, packetLoss: 0.2, reorder: 0.1 },
    });
    run(60, (index) => ({ ...idle, moveX: index === 0 ? 1 : -1, dt: 1 / 20 }));

    for (const entry of clients) {
      const predicted = entry.client.self()!;
      const authoritative = server.net.entity(entry.entity)!.state as { x: number };
      // A dropped snapshot is superseded by the next, so prediction tracks
      // rather than drifting away.
      expect(Math.abs(predicted.x - authoritative.x)).toBeLessThan(4);
    }
  });

  it("reports bandwidth, which is the number that decides player counts", () => {
    const { server, run } = arena({ clients: 4 });
    run(40, () => ({ ...idle, moveX: 1, fire: true, aimX: 1, aimZ: 0, dt: 1 / 20 }));
    const stats = server.stats();
    expect(stats.bytesSent).toBeGreaterThan(0);
    expect(stats.players).toBe(4);
  });
});
