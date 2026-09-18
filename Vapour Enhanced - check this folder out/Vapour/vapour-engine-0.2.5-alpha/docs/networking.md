# Networking

Vapour networking is modular. Games may use their own server, packet format,
authentication, and database while reusing transport lifecycle, backpressure,
RPC, snapshot buffering, ownership, interpolation, and eventually prediction.
All public APIs are available identically from VS and TypeScript.

## WebSocket transport

`WebSocketTransport` implements the renderer-independent `NetworkTransport`
contract. It validates `ws://`/`wss://` addresses, exposes explicit connection
states, converts binary messages to `ArrayBuffer`, timestamps arrivals, enforces
a configurable connection timeout, and rejects sends that exceed the configured
browser buffer budget.

```ts
const transport = new WebSocketTransport("wss://game.example/rooms/main", {
  connectTimeoutMs: 8_000,
  maxBufferedBytes: 256 * 1024,
});
transport.onDisconnect(event => console.info(event.code, event.reason));
await transport.connect();
```

Backpressure errors are deliberate. A game should discard replaceable,
low-priority snapshots before it discards reliable inventory/chat/world events.
The transport never silently drops a packet or invents an offline connection.

## RPC

`RpcPeer` runs JSON control-plane requests and notifications over any
`NetworkTransport`. Methods use namespaced identifiers, request promises have
timeouts, missing handlers return `METHOD_NOT_FOUND`, and handler failures
become `NetworkRpcError` values on the caller.

```ts
const rpc = new RpcPeer(transport);
rpc.register("inventory.move", async params => inventory.move(params));
const room = await rpc.request<RoomInfo>("lobby.join", { code: "ABCD" });
rpc.notify("chat.message", { text: "hello" });
```

RPC is for rooms, commands, transactions, and other control messages. Use a
game-specific binary codec for high-rate transforms or large world snapshots.

## Snapshots and interpolation

`SnapshotBuffer<T>` accepts timestamped state in any arrival order, replaces
duplicate timestamps, caps memory, and returns the two values plus interpolation
alpha for a requested server time. Sampling before/after buffered history holds
the nearest value instead of extrapolating without a game policy.

Render remote entities behind estimated server time by an interpolation delay,
then interpolate the returned values. `pruneBefore` removes consumed history
while retaining enough samples for interpolation.

## Authority and ownership

`NetworkAuthorityTable` tracks stable entity IDs with `server`, `owner`, or
`shared` write policy. It validates owner-authoritative registrations, answers
whether a peer may write an entity, and supports explicit ownership transfer.
It is a client/runtime rule helper—not a substitute for server-side validation.

## Architecture boundary

WebSocket integration is TypeScript because the browser owns that API. Binary
snapshot processing, rollback simulation, compression, and large replication
tables are candidates for Rust/WASM once their data contracts stabilize. This
keeps browser callbacks thin and prevents per-entity JS/WASM calls.

Not yet implemented: reconnection policy, WebTransport and WebRTC transports,
clock synchronization, transform replication components, delta compression,
client prediction/reconciliation, rollback, lag compensation, interest-driven
replication, rooms/lobbies service implementations, voice, and the optional
authoritative server package.
