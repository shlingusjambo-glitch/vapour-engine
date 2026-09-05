/** `@vapour/net` — authoritative multiplayer for Vapour Engine.
 *
 * The shape of the stack, and why:
 *
 * - **The server owns the truth.** Clients send inputs, never positions. Any
 *   design where a client asserts its own position has no cheat protection at
 *   all, so the API does not offer that shape.
 * - **Everything is tick-based.** Inputs, snapshots, and reconciliation are all
 *   expressed in ticks; wall time appears only in the transport.
 * - **The local player is predicted, everyone else interpolated.** Doing the
 *   same to both is the classic mistake — a predicted remote player jitters, an
 *   interpolated local player feels like a boat.
 * - **The transport is replaceable.** Nothing above `transport.ts` knows how
 *   bytes travel, which is what makes the whole stack testable in memory
 *   against simulated latency, jitter, loss, and reordering.
 */
export * from "./transport.js";
export * from "./protocol.js";
export * from "./server.js";
export * from "./client.js";
export * from "./host.js";
