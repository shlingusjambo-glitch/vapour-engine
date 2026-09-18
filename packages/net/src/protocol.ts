/** The wire protocol: message shapes and their encoding.
 *
 * Messages are JSON over UTF-8. That is a deliberate first-version choice, not
 * an oversight: it is debuggable, it round-trips exactly, and it lets the
 * replication logic be proven correct before a binary format is layered
 * underneath. The encoding is isolated to this file precisely so that swapping
 * it changes nothing above.
 *
 * What is *not* deferred is the shape of the traffic. Delta compression and
 * interest management are properties of what gets sent, not of how it is
 * encoded, and retrofitting those is genuinely hard — so they are here from the
 * start.
 */
import type { ConnectionId } from "./transport.js";

export type NetworkId = number;

/** A replicated value. Deliberately narrow: anything replicated must survive
 * JSON round-tripping exactly, and a `Date` or a `Map` does not. */
export type NetValue = number | string | boolean | null | readonly NetValue[] | { readonly [key: string]: NetValue };

export type NetState = Readonly<Record<string, NetValue>>;

export interface SpawnMessage {
  readonly type: "spawn";
  readonly id: NetworkId;
  readonly prefab: string;
  readonly owner: ConnectionId | null;
  readonly state: NetState;
  readonly tick: number;
}

export interface DespawnMessage {
  readonly type: "despawn";
  readonly id: NetworkId;
  readonly tick: number;
}

export interface SnapshotMessage {
  readonly type: "snapshot";
  readonly tick: number;
  /** Only entities whose state changed since the client's acknowledged tick. */
  readonly changed: readonly { readonly id: NetworkId; readonly state: NetState }[];
  /** Entities that left this client's interest set. */
  readonly removed: readonly NetworkId[];
  /** The last client input tick the server has processed, for reconciliation. */
  readonly ackInput?: number;
}

export interface RpcMessage {
  readonly type: "rpc";
  readonly name: string;
  readonly id: NetworkId | null;
  readonly args: readonly NetValue[];
  readonly tick: number;
  /** Client -> server: the server tick the client was rendering when it sent this. */
  readonly viewTick?: number;
}

export interface InputMessage {
  readonly type: "input";
  readonly tick: number;
  readonly payload: NetState;
  /**
   * The server tick the client was rendering when it produced this input.
   *
   * This is what lag compensation rewinds to. A client renders
   * `interpolationDelayTicks` behind the newest snapshot it has, so the tick it
   * aimed at is older than anything a round-trip estimate alone would give.
   */
  readonly viewTick?: number;
}

export interface WelcomeMessage {
  readonly type: "welcome";
  readonly connection: ConnectionId;
  readonly tick: number;
  readonly tickRate: number;
  /** Token this client presents to resume the session after a drop. */
  readonly session?: string;
  /** Whether this welcome resumed a session rather than creating one. */
  readonly resumed?: boolean;
  /** Scene the client must load before replication begins, if any. */
  readonly scene?: string;
  /** Which `setScene` the scene belongs to; stale readiness is ignored. */
  readonly sceneGeneration?: number;
}

export interface AckMessage {
  readonly type: "ack";
  readonly tick: number;
}

/**
 * Client -> server: the first message a peer sends.
 *
 * A server with an authentication hook accepts nothing else from an unknown
 * peer, which is what keeps an unauthenticated connection from costing anything
 * more than one decode.
 */
export interface JoinMessage {
  readonly type: "join";
  /** Opaque credentials; only the game's authentication hook interprets them. */
  readonly credentials: NetState;
  /** Session token from a previous connection, to resume rather than start. */
  readonly resume?: string;
}

/** Server -> client: the join was refused. */
export interface RejectMessage {
  readonly type: "reject";
  readonly reason: string;
}

/** Server -> client: load this scene, then report readiness. */
export interface SceneLoadMessage {
  readonly type: "sceneLoad";
  readonly scene: string;
  /** Increments per `setScene`, so a late report for an old scene is dropped. */
  readonly generation: number;
  readonly tick: number;
}

/** Client -> server: how far the scene load has got. */
export interface SceneProgressMessage {
  readonly type: "sceneProgress";
  readonly generation: number;
  /** Load progress in `[0, 1]`. */
  readonly progress: number;
  readonly ready: boolean;
}

/**
 * Ownership transfer. Server -> client it is a notification; client -> server
 * it is a request, honoured only when the sender is the current owner.
 */
export interface OwnershipMessage {
  readonly type: "ownership";
  readonly id: NetworkId;
  readonly owner: ConnectionId | null;
  readonly tick: number;
}

export type NetMessage =
  | SpawnMessage
  | DespawnMessage
  | SnapshotMessage
  | RpcMessage
  | InputMessage
  | WelcomeMessage
  | AckMessage
  | JoinMessage
  | RejectMessage
  | SceneLoadMessage
  | SceneProgressMessage
  | OwnershipMessage;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeMessage(message: NetMessage): Uint8Array {
  return encoder.encode(JSON.stringify(message));
}

/**
 * Decodes a message, returning `undefined` for anything malformed.
 *
 * A peer can send arbitrary bytes, so a decode failure is an expected
 * condition rather than an exception: throwing here would let one bad packet
 * take down a server.
 */
export function decodeMessage(data: Uint8Array): NetMessage | undefined {
  try {
    const parsed = JSON.parse(decoder.decode(data)) as NetMessage;
    if (parsed === null || typeof parsed !== "object" || typeof parsed.type !== "string") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Fields of `next` that differ from `previous`.
 *
 * This is where most of the bandwidth saving lives. A player entity replicates
 * a dozen fields, of which typically two change per tick; sending the whole
 * state every tick costs six times what it needs to.
 */
export function deltaState(previous: NetState | undefined, next: NetState): NetState | undefined {
  if (previous === undefined) return next;
  const delta: Record<string, NetValue> = {};
  let changed = false;
  for (const [key, value] of Object.entries(next)) {
    if (!valuesEqual(previous[key], value)) {
      delta[key] = value;
      changed = true;
    }
  }
  // A field removed from the state is a schema change, not a delta; replicating
  // its absence would make the client's copy diverge silently.
  return changed ? delta : undefined;
}

/** Applies a delta onto a base state. */
export function applyDelta(base: NetState | undefined, delta: NetState): NetState {
  return { ...(base ?? {}), ...delta };
}

/** Structural equality over the replicable value types. */
export function valuesEqual(a: NetValue | undefined, b: NetValue | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => valuesEqual(value, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => valuesEqual((a as Record<string, NetValue>)[key], (b as Record<string, NetValue>)[key]));
  }
  return false;
}

/** Byte size of a message once encoded, for bandwidth accounting. */
export function messageSize(message: NetMessage): number {
  return encodeMessage(message).byteLength;
}

/**
 * Rounds numeric fields to a fixed number of decimals.
 *
 * Quantization is the other half of bandwidth reduction, and it doubles as
 * jitter suppression: a position that wobbles in the sixth decimal place
 * otherwise counts as "changed" every single tick and defeats delta
 * compression entirely.
 */
export function quantizeState(state: NetState, decimals = 3): NetState {
  const factor = 10 ** decimals;
  const round = (value: NetValue): NetValue => {
    if (typeof value === "number") return Math.round(value * factor) / factor;
    if (Array.isArray(value)) return value.map(round);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, round(member)]));
    }
    return value;
  };
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, round(value)]));
}
