import { describe, expect, it } from "vitest";
import { NetworkClient } from "./client.js";
import { NetworkServer } from "./server.js";
import { LoopbackNetwork } from "./transport.js";

/**
 * Hundreds of entities, a handful of clients, no interest filter: the worst
 * case for per-connection snapshot building. Bounds are deliberately loose —
 * this must not flake on a loaded CI box — and the real numbers are printed so
 * a regression is visible long before it trips an assertion.
 */
const CLIENTS = 4;
const ENTITIES = 400;
const CHANGING = 40; // ~10% per tick
const TICKS = 200;
const BYTES_PER_TICK_PER_CLIENT_BUDGET = 8 * 1024;
const SERVER_MS_PER_TICK_AVERAGE_BOUND = 20;
// A single tick can spike far above the average from GC or OS scheduling
// noise with no algorithmic regression behind it; the average is the signal
// that actually tracks server cost, so the worst-tick bound stays generous.
const SERVER_MS_PER_TICK_WORST_BOUND = 300;

describe("scale", () => {
  it(`replicates ${String(ENTITIES)} entities to ${String(CLIENTS)} clients within budget`, () => {
    const network = new LoopbackNetwork();
    const server = new NetworkServer(network.endpoint(0), { tickRate: 20 });
    const clients = Array.from({ length: CLIENTS }, (_, index) => {
      const id = index + 1;
      const client = new NetworkClient(network.endpoint(id));
      server.addConnection(id);
      return { id, client };
    });
    for (let index = 0; index < ENTITIES; index += 1) {
      server.spawn("prop", { p: [index % 20, 0, Math.floor(index / 20)], r: [0, 0, 0, 1], hp: 100 });
    }

    // Warm-up tick delivers the initial spawns, which are not the steady state.
    let now = 0;
    const tick = (): void => {
      server.receive();
      server.step();
      now += 50;
      network.advance(now);
      for (const entry of clients) entry.client.receive(0);
      network.advance(now);
      server.receive();
    };
    tick();
    const bytesAfterSpawn = server.stats().bytesSent;

    let worstMs = 0;
    let totalMs = 0;
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let step = 0; step < TICKS; step += 1) {
      for (let change = 0; change < CHANGING; change += 1) {
        const id = 1 + Math.floor(random() * ENTITIES);
        const state = server.entity(id)!.state.p as number[];
        server.setState(id, { p: [state[0]! + random() - 0.5, state[1]!, state[2]! + random() - 0.5] });
      }
      const started = performance.now();
      server.receive();
      server.step();
      const elapsed = performance.now() - started;
      worstMs = Math.max(worstMs, elapsed);
      totalMs += elapsed;
      now += 50;
      network.advance(now);
      for (const entry of clients) entry.client.receive(0);
      network.advance(now);
      server.receive();
    }

    const steadyBytes = server.stats().bytesSent - bytesAfterSpawn;
    const bytesPerTickPerClient = steadyBytes / TICKS / CLIENTS;
    const averageMs = totalMs / TICKS;
    console.log(
      `[net-scale] ${String(ENTITIES)} entities, ${String(CHANGING)} changing/tick, ${String(CLIENTS)} clients, ${String(TICKS)} ticks: ` +
        `${bytesPerTickPerClient.toFixed(0)} B/tick/client (${(bytesPerTickPerClient * 20 / 1024).toFixed(1)} KB/s at 20 Hz), ` +
        `spawn burst ${(bytesAfterSpawn / CLIENTS / 1024).toFixed(1)} KB/client, ` +
        `server ${averageMs.toFixed(2)} ms/tick avg, ${worstMs.toFixed(2)} ms worst`,
    );

    for (const entry of clients) expect(entry.client.entities).toHaveLength(ENTITIES);
    expect(bytesPerTickPerClient).toBeLessThan(BYTES_PER_TICK_PER_CLIENT_BUDGET);
    expect(averageMs).toBeLessThan(SERVER_MS_PER_TICK_AVERAGE_BOUND);
    expect(worstMs).toBeLessThan(SERVER_MS_PER_TICK_WORST_BOUND);
    // Every client ends on the server's truth for every entity.
    for (const entity of server.entities) {
      for (const entry of clients) expect(entry.client.entity(entity.id)?.state.p).toEqual(entity.state.p);
    }
  });
});
