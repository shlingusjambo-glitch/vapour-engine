/** The authoritative server.
 *
 * The server owns the truth. Clients send *inputs*, never positions, and the
 * server decides what happened — the only arrangement in which a modified
 * client cannot teleport, shoot through walls, or grant itself health. Any
 * design where a client says "I am at X" is a design with no cheat protection
 * at all, so the API does not offer that shape.
 *
 * Everything is tick-based. A tick is the unit of authority: inputs arrive
 * stamped with the tick they were produced on, snapshots are stamped with the
 * tick they describe, and reconciliation is expressed entirely in ticks. Wall
 * time appears only in the transport.
 */
import {
  applyDelta, decodeMessage, deltaState, encodeMessage, messageSize, quantizeState,
  type NetMessage, type NetState, type NetworkId, type SnapshotMessage,
} from "./protocol.js";
import type { ConnectionId, Transport } from "./transport.js";

export interface NetworkEntity {
  readonly id: NetworkId;
  readonly prefab: string;
  /** Connection that may send inputs for this entity, or `null` for server-owned. */
  owner: ConnectionId | null;
  state: NetState;
}

export interface ServerConnection {
  readonly id: ConnectionId;
  /** Last input tick received from this client. */
  lastInputTick: number;
  /** Last snapshot tick this client acknowledged. */
  acknowledgedTick: number;
  /** Entities currently relevant to this client. */
  interest: Set<NetworkId>;
  /** What this client last knew about each entity, for delta compression. */
  baseline: Map<NetworkId, NetState>;
  bytesSent: number;
}

/** Decides which entities a connection should be told about. */
export type InterestFilter = (entity: NetworkEntity, connection: ServerConnection, server: NetworkServer) => boolean;

export interface ServerOptions {
  readonly tickRate?: number;
  /** Quantization applied to replicated numbers. */
  readonly decimals?: number;
  /**
   * Which entities each client hears about. Defaults to everything.
   *
   * Interest management is the difference between a game that supports twenty
   * players and one that supports two hundred: bandwidth is per client per
   * entity, so filtering is the only lever that changes the exponent.
   */
  readonly interest?: InterestFilter;
  /** Called with each client's input, in tick order. */
  readonly onInput?: (connection: ServerConnection, tick: number, payload: NetState) => void;
  /** Called for RPCs a client sent to the server. */
  readonly onRpc?: (connection: ServerConnection, name: string, args: readonly unknown[], id: NetworkId | null) => void;
}

export interface ServerStats {
  readonly tick: number;
  readonly connections: number;
  readonly entities: number;
  readonly bytesSent: number;
  readonly snapshotsSent: number;
}

/** Distance-based interest: a common default that scales to large worlds. */
export function radiusInterest(radius: number, positionOf: (state: NetState) => readonly number[] | undefined, viewerOf: (connection: ServerConnection) => readonly number[] | undefined): InterestFilter {
  if (!(radius > 0)) throw new Error("An interest radius must be positive.");
  const squared = radius * radius;
  return (entity, connection) => {
    const viewer = viewerOf(connection);
    const position = positionOf(entity.state);
    // Without a position for either side, relevance cannot be judged; being
    // told about it is the safe failure, since the alternative is an entity
    // that silently never appears.
    if (!viewer || !position) return true;
    const dx = (position[0] ?? 0) - (viewer[0] ?? 0);
    const dy = (position[1] ?? 0) - (viewer[1] ?? 0);
    const dz = (position[2] ?? 0) - (viewer[2] ?? 0);
    return dx * dx + dy * dy + dz * dz <= squared;
  };
}

export class NetworkServer {
  readonly #transport: Transport;
  readonly #options: Required<Omit<ServerOptions, "onInput" | "onRpc" | "interest">> & Pick<ServerOptions, "onInput" | "onRpc" | "interest">;
  readonly #connections = new Map<ConnectionId, ServerConnection>();
  readonly #entities = new Map<NetworkId, NetworkEntity>();
  #tick = 0;
  #nextEntityId = 1;
  #bytesSent = 0;
  #snapshotsSent = 0;

  constructor(transport: Transport, options: ServerOptions = {}) {
    const tickRate = options.tickRate ?? 20;
    if (!Number.isInteger(tickRate) || tickRate < 1) throw new Error("A server tick rate must be a whole number of at least 1.");
    const decimals = options.decimals ?? 3;
    if (!Number.isInteger(decimals) || decimals < 0) throw new Error("Quantization decimals must be a non-negative whole number.");
    this.#transport = transport;
    this.#options = { tickRate, decimals, ...options };
  }

  get tick(): number {
    return this.#tick;
  }

  get connections(): readonly ServerConnection[] {
    return [...this.#connections.values()];
  }

  get entities(): readonly NetworkEntity[] {
    return [...this.#entities.values()];
  }

  entity(id: NetworkId): NetworkEntity | undefined {
    return this.#entities.get(id);
  }

  connection(id: ConnectionId): ServerConnection | undefined {
    return this.#connections.get(id);
  }

  /** Accepts a client and sends it a welcome plus the world it can see. */
  addConnection(id: ConnectionId): ServerConnection {
    if (this.#connections.has(id)) throw new Error(`Connection ${id} is already connected.`);
    const connection: ServerConnection = {
      id,
      lastInputTick: -1,
      acknowledgedTick: -1,
      interest: new Set(),
      baseline: new Map(),
      bytesSent: 0,
    };
    this.#connections.set(id, connection);
    this.#send(connection, { type: "welcome", connection: id, tick: this.#tick, tickRate: this.#options.tickRate });
    return connection;
  }

  /** Removes a client and despawns anything it owned. */
  removeConnection(id: ConnectionId): void {
    const connection = this.#connections.get(id);
    if (!connection) return;
    this.#connections.delete(id);
    for (const entity of [...this.#entities.values()]) {
      if (entity.owner === id) this.despawn(entity.id);
    }
    this.#transport.disconnect(id);
  }

  /** Creates a replicated entity. */
  spawn(prefab: string, state: NetState = {}, owner: ConnectionId | null = null): NetworkEntity {
    if (!prefab.trim()) throw new Error("A spawned entity requires a non-empty prefab name.");
    if (owner !== null && !this.#connections.has(owner)) {
      throw new Error(`Cannot spawn owned by connection ${owner}, which is not connected.`);
    }
    const entity: NetworkEntity = {
      id: this.#nextEntityId++,
      prefab,
      owner,
      state: quantizeState(state, this.#options.decimals),
    };
    this.#entities.set(entity.id, entity);
    return entity;
  }

  despawn(id: NetworkId): boolean {
    if (!this.#entities.delete(id)) return false;
    for (const connection of this.#connections.values()) {
      if (!connection.interest.delete(id)) continue;
      connection.baseline.delete(id);
      this.#send(connection, { type: "despawn", id, tick: this.#tick });
    }
    return true;
  }

  /** Updates an entity's replicated state. */
  setState(id: NetworkId, state: NetState): void {
    const entity = this.#entities.get(id);
    if (!entity) throw new Error(`No networked entity ${id}.`);
    entity.state = quantizeState({ ...entity.state, ...state }, this.#options.decimals);
  }

  /** Reassigns ownership, which is how a player picks up a physics object. */
  setOwner(id: NetworkId, owner: ConnectionId | null): void {
    const entity = this.#entities.get(id);
    if (!entity) throw new Error(`No networked entity ${id}.`);
    if (owner !== null && !this.#connections.has(owner)) {
      throw new Error(`Cannot give entity ${id} to connection ${owner}, which is not connected.`);
    }
    entity.owner = owner;
  }

  /** Sends an RPC to one client, or to all of them. */
  sendRpc(name: string, args: readonly unknown[] = [], options: { to?: ConnectionId; id?: NetworkId } = {}): void {
    if (!name.trim()) throw new Error("An RPC requires a non-empty name.");
    const message: NetMessage = {
      type: "rpc",
      name,
      id: options.id ?? null,
      args: args as never,
      tick: this.#tick,
    };
    if (options.to !== undefined) {
      const connection = this.#connections.get(options.to);
      if (!connection) throw new Error(`Cannot send an RPC to connection ${options.to}, which is not connected.`);
      this.#send(connection, message);
      return;
    }
    for (const connection of this.#connections.values()) this.#send(connection, message);
  }

  /** Reads incoming messages. Call before simulating the tick. */
  receive(): void {
    for (const packet of this.#transport.receive()) {
      const message = decodeMessage(packet.data);
      const connection = this.#connections.get(packet.from);
      // A message from an unknown peer is discarded rather than throwing: one
      // malformed or stale packet must not take down a server.
      if (!message || !connection) continue;
      if (message.type === "input") {
        // Stale inputs are dropped. Accepting an out-of-order input would let a
        // client rewind its own history.
        if (message.tick <= connection.lastInputTick) continue;
        connection.lastInputTick = message.tick;
        this.#options.onInput?.(connection, message.tick, message.payload);
      } else if (message.type === "ack") {
        if (message.tick > connection.acknowledgedTick) connection.acknowledgedTick = message.tick;
      } else if (message.type === "rpc") {
        this.#options.onRpc?.(connection, message.name, message.args, message.id);
      }
    }
  }

  /**
   * Advances one tick and sends each client a delta snapshot.
   *
   * Snapshots are built per connection, because both interest and the
   * acknowledged baseline differ per client. That is more work than one
   * broadcast, and it is the work that makes bandwidth scale with what a player
   * can actually see rather than with the size of the world.
   */
  step(): void {
    this.#tick += 1;
    for (const connection of this.#connections.values()) this.#sendSnapshot(connection);
  }

  stats(): ServerStats {
    return {
      tick: this.#tick,
      connections: this.#connections.size,
      entities: this.#entities.size,
      bytesSent: this.#bytesSent,
      snapshotsSent: this.#snapshotsSent,
    };
  }

  #sendSnapshot(connection: ServerConnection): void {
    const filter = this.#options.interest;
    const changed: { id: NetworkId; state: NetState }[] = [];
    const removed: NetworkId[] = [];
    const relevant = new Set<NetworkId>();

    for (const entity of this.#entities.values()) {
      if (filter && !filter(entity, connection, this)) continue;
      relevant.add(entity.id);
      const wasRelevant = connection.interest.has(entity.id);
      if (!wasRelevant) {
        // Newly relevant: send the whole state, not a delta against nothing.
        this.#send(connection, { type: "spawn", id: entity.id, prefab: entity.prefab, owner: entity.owner, state: entity.state, tick: this.#tick });
        connection.baseline.set(entity.id, entity.state);
        continue;
      }
      const delta = deltaState(connection.baseline.get(entity.id), entity.state);
      if (delta === undefined) continue;
      changed.push({ id: entity.id, state: delta });
      connection.baseline.set(entity.id, applyDelta(connection.baseline.get(entity.id), delta));
    }

    for (const id of connection.interest) {
      if (!relevant.has(id)) {
        removed.push(id);
        connection.baseline.delete(id);
      }
    }
    connection.interest = relevant;

    // An empty snapshot still goes out: it carries the tick and the input
    // acknowledgement a client needs to reconcile, so skipping it stalls
    // prediction on an idle server.
    const snapshot: SnapshotMessage = {
      type: "snapshot",
      tick: this.#tick,
      changed,
      removed,
      ackInput: connection.lastInputTick,
    };
    this.#send(connection, snapshot);
    this.#snapshotsSent += 1;
  }

  #send(connection: ServerConnection, message: NetMessage): void {
    const size = messageSize(message);
    connection.bytesSent += size;
    this.#bytesSent += size;
    // Snapshots are unreliable: a dropped one is superseded by the next, and
    // waiting for a retransmit would add latency to every later snapshot.
    this.#transport.send(connection.id, encodeMessage(message), { reliable: message.type !== "snapshot" });
  }
}
