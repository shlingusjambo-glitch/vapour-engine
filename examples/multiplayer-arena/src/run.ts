/** Runs the arena headlessly under adverse network conditions and reports.
 *
 * Besides the six-player fight, three things happen mid-match that every real
 * session has to survive: every client loads the scene before it sees the
 * world, one player loses their connection and comes back on a new socket, and
 * a seventh player joins late into a world already in motion.
 */
import { LoopbackNetwork } from "@vapour/net";
import { ArenaClient, ArenaServer } from "./session.js";
import type { PlayerInputPayload } from "./arena.js";

const CLIENTS = 6;
const TICKS = 200;
const TICK_RATE = 20;
const DROP_AT = 80;
const RESUME_AT = 110;
const LATE_JOIN_AT = 150;
const GRACE_TICKS = 60;

const conditions = { latencyMs: 80, jitterMs: 40, packetLoss: 0.15, reorder: 0.08 };
const network = new LoopbackNetwork(conditions, 20250903);
const server = new ArenaServer(network.endpoint(0), { tickRate: TICK_RATE, scene: "arena", reconnectGraceTicks: GRACE_TICKS });

interface Peer {
  id: number;
  client: ArenaClient;
  /** Ticks left on a pretend scene load; ready is reported when it hits zero. */
  loading: number;
  spawns: number;
}

/** A client that joins by message and loads the scene over `loadTicks` ticks. */
function connect(id: number, loadTicks: number, session?: string): Peer {
  const peer: Peer = { id, client: undefined as never, loading: -1, spawns: 0 };
  peer.client = new ArenaClient(network.endpoint(id), {
    onSceneLoad: () => { peer.loading = loadTicks; },
    onSpawn: () => { peer.spawns += 1; },
  });
  if (session === undefined) peer.client.join({ name: `player-${id}` });
  else peer.client.resume(session);
  return peer;
}

const peers: Peer[] = Array.from({ length: CLIENTS }, (_, index) => connect(index + 1, index + 1));

let now = 0;
const dt = 1 / TICK_RATE;
const started = Date.now();
let dropped: { session: string; entity: number; health: number; score: number } | undefined;
let returned: Peer | undefined;
let late: Peer | undefined;

for (let tick = 0; tick < TICKS; tick += 1) {
  if (tick === DROP_AT) {
    const victim = peers[2]!;
    const entity = server.playerEntity(victim.id)!;
    const state = server.net.entity(entity)!.state as { health: number; score: number };
    dropped = { session: server.drop(victim.id)!, entity, health: state.health, score: state.score };
    peers.splice(2, 1);
  }
  if (tick === RESUME_AT) {
    // Same player, new socket: connection id 7, but the session token is what
    // identifies them, and their avatar has been waiting.
    returned = connect(7, 2, dropped!.session);
    peers.push(returned);
  }
  if (tick === LATE_JOIN_AT) {
    late = connect(8, 3);
    peers.push(late);
  }

  for (const [index, peer] of peers.entries()) {
    if (peer.loading > 0) peer.loading -= 1;
    if (peer.loading === 0) {
      peer.client.ready();
      peer.loading = -1;
    }
    if (!peer.client.self()) continue;
    const angle = (tick / 30) + index;
    const input: PlayerInputPayload = {
      moveX: Math.cos(angle),
      moveZ: Math.sin(angle),
      aimX: Math.cos(angle * 1.7),
      aimZ: Math.sin(angle * 1.7),
      fire: tick % 12 === index % 12,
      dt,
    };
    peer.client.send(input);
  }
  now += 25;
  network.advance(now);
  server.step(dt);
  now += 25;
  network.advance(now);
  for (const peer of peers) peer.client.receive();
  network.advance(now);
}

const stats = server.stats();
const drift = peers.map((peer) => {
  const predicted = peer.client.self();
  const entity = server.playerEntity(peer.id);
  const authoritative = entity === undefined ? undefined : (server.net.entity(entity)?.state as { x: number; z: number } | undefined);
  if (!predicted || !authoritative) return Number.NaN;
  return Math.hypot(predicted.x - authoritative.x, predicted.z - authoritative.z);
});
const worstDrift = Math.max(...drift.filter(Number.isFinite));
const mispredictions = peers.reduce((sum, peer) => sum + peer.client.net.stats().mispredictions, 0);
const seconds = TICKS / TICK_RATE;
const resumedEntity = server.playerEntity(returned!.id);
const resumedState = resumedEntity === undefined ? undefined : (server.net.entity(resumedEntity)?.state as { health: number } | undefined);

const rows: readonly [string, string][] = [
  ["conditions", `${conditions.latencyMs}ms +/- ${conditions.jitterMs}ms, ${(conditions.packetLoss * 100).toFixed(0)}% loss, ${(conditions.reorder * 100).toFixed(0)}% reorder`],
  ["players", `${stats.players} (6 joined, 1 late)`],
  ["scene", `"arena" loaded by every client before replication; late joiner saw ${late!.spawns} spawns on ready`],
  ["reconnect", `player 3 dropped at tick ${DROP_AT}, back as connection 7 at tick ${RESUME_AT}: ` +
    `${resumedEntity === dropped!.entity ? `same avatar (entity #${dropped!.entity})` : "NEW avatar"}, health ${dropped!.health} -> ${resumedState?.health ?? "?"}`],
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
