# Multiplayer

`@vapour/net` is authoritative multiplayer: replication, RPCs, prediction,
reconciliation, and interest management, over a transport you can replace.

## The four decisions that shape it

**The server owns the truth.** Clients send *inputs*, never positions. Any
design where a client asserts "I am at X" has no cheat protection at all, so the
API does not offer that shape.

**Everything is tick-based.** Inputs are stamped with the tick they were
produced on, snapshots with the tick they describe, and reconciliation is
expressed entirely in ticks. Wall time appears only in the transport.

**The local player is predicted; everyone else is interpolated.** Doing the same
to both is the classic mistake — a predicted remote player jitters on every
packet, and an interpolated local player feels like driving a boat.

**The transport is replaceable.** Nothing above `transport.ts` knows how bytes
travel, which is what makes the whole stack testable in memory. A multiplayer
bug that needs two browsers and a server to reproduce is a bug that does not get
fixed.

## Basic example

```ts
import { NetworkServer, NetworkClient, LoopbackNetwork } from "@vapour/net";

const server = new NetworkServer(transport, {
  tickRate: 20,
  onInput: (connection, tick, input) => {
    const player = playerFor(connection.id);
    server.setState(player.id, simulate(server.entity(player.id)!.state, input));
  },
});

server.addConnection(connectionId);
server.spawn("player", { p: [0, 0, 0], hp: 100 }, connectionId);

// each tick
server.receive();
server.step();
```

```ts
const client = new NetworkClient(transport, {
  predict: (state, input) => move(state, input),
  onSpawn: (entity) => scene.add(entity),
  onDespawn: (id) => scene.remove(id),
});

client.receive();
client.sendInput({ move: [1, 0], jump: false });
const shown = client.interpolated(entityId);   // predicted if local, interpolated if not
```

### Host mode

`NetworkHost` runs a normal authoritative `NetworkServer` and predicted
`NetworkClient` over the same loopback transport and wire protocol used in
tests and remote play. The host player therefore does not gain a separate
gameplay path that breaks when a project moves to a dedicated server.

```ts
const host = new NetworkHost({ server: serverOptions, client: clientOptions });
host.server.spawn("player", initialState, host.connectionId);
host.step(performance.now());
```

Time must be monotonic. Optional simulated latency, jitter, loss, and a seed
exercise host prediction under adverse conditions. `close()` is idempotent and
disconnects both embedded endpoints.

## Bandwidth

Three mechanisms, measured on 200 moving entities and 8 clients over 20 ticks:

| | Total | Per tick per client |
| --- | --- | --- |
| No interest filter | 1,510 KB | 9,661 B |
| With a 60 m radius filter | **137 KB** | **875 B** |

**Delta compression** sends only fields that changed. A player entity
replicates a dozen fields, of which typically two change per tick.

**Quantization** rounds replicated numbers, and doubles as jitter suppression: a
position wobbling in the sixth decimal place otherwise counts as "changed" every
tick and defeats delta compression entirely.

**Interest management** is the one that changes the exponent. Bandwidth is per
client per entity, so filtering is the only lever that takes a game from
supporting twenty players to supporting two hundred:

```ts
import { radiusInterest } from "@vapour/net";

new NetworkServer(transport, {
  interest: radiusInterest(60, (state) => state.p as number[], (connection) => viewerPosition(connection.id)),
});
```

Entities entering the radius get a full spawn; entities leaving get a despawn.
When relevance cannot be judged — no position on either side — the entity is
included, because silently never appearing is a worse failure than being
over-informed.

## Prediction and reconciliation

```ts
const client = new NetworkClient(transport, {
  predict: (state, input, tick) => applyMovement(state, input),
});
```

The client applies input immediately, keeps it in a pending buffer, and when a
snapshot arrives rewinds to the server's state and **replays every input the
server had not yet acknowledged**. Without the replay, a correction visibly
undoes the last few frames of the player's own movement.

`client.stats().mispredictions` counts how often the replayed result differed
from what was shown — a useful signal that client and server simulation have
drifted apart.

Stale inputs are dropped server-side: accepting an out-of-order input would let
a client rewind its own history.

## Interpolation

Remote entities render `interpolationDelayTicks` behind the newest snapshot, two
by default: one tick absorbs normal jitter, the second covers a single dropped
packet. Extrapolating instead produces characters that overshoot and snap back
on every packet.

## Reliability

Snapshots are sent **unreliably**. A dropped snapshot is superseded by the next,
and waiting for a retransmit would add latency to every later snapshot. Spawns,
despawns, and RPCs are reliable, because missing one leaves the client's world
permanently wrong.

## Testing against a real network

```ts
const network = new LoopbackNetwork({ latencyMs: 80, jitterMs: 40, packetLoss: 0.15, reorder: 0.1 }, seed);
const server = new NetworkServer(network.endpoint(0));
const client = new NetworkClient(network.endpoint(1));
```

Latency, jitter, loss, and reordering are not edge cases — they are the normal
condition of every real network, and code that has only ever run on localhost
has never been tested. The simulation is **deterministic given a seed**, so a
test that catches a prediction bug catches it again tomorrow.

## API reference

| Export | Purpose |
| ------ | ------- |
| `NetworkServer` | `addConnection`, `removeConnection`, `spawn`, `despawn`, `setState`, `setOwner`, `sendRpc`, `receive`, `step`, `stats` |
| `NetworkClient` | `receive`, `sendInput`, `sendRpc`, `entity`, `entities`, `interpolated`, `pendingInputs`, `stats` |
| `NetworkHost` | Listen-server lifecycle with an ordinary local client |
| `LoopbackNetwork` | In-memory transport with simulated conditions |
| `radiusInterest` | Distance-based interest filter |
| `deltaState`, `applyDelta`, `quantizeState`, `valuesEqual` | The replication primitives |
| `encodeMessage`, `decodeMessage`, `messageSize` | Wire encoding |

## Performance considerations

- Snapshots are built **per connection**, because interest and the acknowledged
  baseline differ per client. That is more work than one broadcast, and it is
  the work that makes bandwidth scale with what a player can see.
- The server keeps one baseline state per entity per connection. With interest
  filtering that is bounded by what each client can see, not by world size.
- Replicated values must survive JSON round-tripping exactly — the `NetValue`
  type enforces it, so a `Map` or a `Date` is a compile error rather than a
  silent corruption.

## Current limitations

The wire format is JSON over UTF-8. That is a deliberate first-version choice:
it is debuggable, it round-trips exactly, and it let the replication logic be
proven correct before a binary format goes underneath. Encoding is isolated to
`protocol.ts` so swapping it changes nothing above.

Not yet implemented: lag compensation (rewinding the server to a client's view
for hit detection), matchmaking and lobbies, host migration, and a WebSocket or
WebRTC transport. `docs/status.md` records exactly what is and is not there.
