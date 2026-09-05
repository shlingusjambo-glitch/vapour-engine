/** Runs the arena headlessly under adverse network conditions and reports. */
import { LoopbackNetwork } from "@vapour/net";
import { ArenaClient, ArenaServer } from "./session.js";
import type { PlayerInputPayload } from "./arena.js";

const CLIENTS = 6;
const TICKS = 200;
const TICK_RATE = 20;

const conditions = { latencyMs: 80, jitterMs: 40, packetLoss: 0.15, reorder: 0.08 };
const network = new LoopbackNetwork(conditions, 20250903);
const server = new ArenaServer(network.endpoint(0), { tickRate: TICK_RATE });

const clients = Array.from({ length: CLIENTS }, (_, index) => {
  const id = index + 1;
  const client = new ArenaClient(network.endpoint(id));
  return { id, client, entity: server.join(id) };
});

let now = 0;
const dt = 1 / TICK_RATE;
const started = Date.now();

for (let tick = 0; tick < TICKS; tick += 1) {
  for (const [index, entry] of clients.entries()) {
    const angle = (tick / 30) + index;
    const input: PlayerInputPayload = {
      moveX: Math.cos(angle),
      moveZ: Math.sin(angle),
      aimX: Math.cos(angle * 1.7),
      aimZ: Math.sin(angle * 1.7),
      fire: tick % 12 === index % 12,
      dt,
    };
    entry.client.send(input);
  }
  now += 25;
  network.advance(now);
  server.step(dt);
  now += 25;
  network.advance(now);
  for (const entry of clients) entry.client.receive();
  network.advance(now);
}

const stats = server.stats();
const drift = clients.map((entry) => {
  const predicted = entry.client.self();
  const authoritative = server.net.entity(entry.entity)?.state as { x: number; z: number } | undefined;
  if (!predicted || !authoritative) return Number.NaN;
  return Math.hypot(predicted.x - authoritative.x, predicted.z - authoritative.z);
});
const worstDrift = Math.max(...drift.filter(Number.isFinite));
const mispredictions = clients.reduce((sum, entry) => sum + entry.client.net.stats().mispredictions, 0);
const seconds = TICKS / TICK_RATE;

const rows: readonly [string, string][] = [
  ["conditions", `${conditions.latencyMs}ms +/- ${conditions.jitterMs}ms, ${(conditions.packetLoss * 100).toFixed(0)}% loss, ${(conditions.reorder * 100).toFixed(0)}% reorder`],
  ["players", `${stats.players}`],
  ["simulated", `${seconds.toFixed(0)} s at ${TICK_RATE} Hz (${stats.tick} ticks)`],
  ["shots fired", `${stats.shotsFired}`],
  ["hits", `${stats.hits}`],
  ["deaths", `${stats.deaths}`],
  ["bandwidth", `${(stats.bytesSent / 1024).toFixed(1)} KB total, ${(stats.bytesSent / seconds / stats.players).toFixed(0)} B/s per client`],
  ["packets dropped", `${network.stats.dropped} of ${network.stats.dropped + network.stats.delivered}`],
  ["worst drift", `${worstDrift.toFixed(3)} world units`],
  ["mispredictions", `${mispredictions}`],
  ["wall clock", `${Date.now() - started} ms`],
];

console.log("\nMultiplayer arena — authoritative, predicted, under load\n");
for (const [label, value] of rows) console.log(`  ${label.padEnd(16)} ${value}`);
console.log();
