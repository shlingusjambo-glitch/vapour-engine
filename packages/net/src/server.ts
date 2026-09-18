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
import { SnapshotHistory, type SnapshotHistoryOptions } from "./lag-compensation.js";
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
  /**
   * The server tick this client most recently said it was rendering.
   *
   * Pass it as `HitRequest.viewTick`: it is the exact tick the player aimed
   * at, which no latency estimate reproduces.
   */
  viewTick: number;
  /** Entities currently relevant to this client. */
  interest: Set<NetworkId>;
  /** What this client last knew about each entity, for delta compression. */
  baseline: Map<NetworkId, NetState>;
  bytesSent: number;
  /** Token this client presents to resume after a drop. */
  readonly session: string;
  /** Whatever the authentication hook returned, or `null` when there is none. */
  identity: NetState | null;
  /**
   * Whether the client has finished loading the scene.
   *
   * Replication is held while this is false. Sending a joining client snapshots
   * of a world it has not loaded yet produces spawns for entities it cannot
   * place, and the client has to either buffer them or throw them away.
   */
  ready: boolean;
  /** Which `setScene` generation `ready` refers to. */
  sceneGeneration: number;
  /** Scene load progress in `[0, 1]`, as the client last reported it. */
  sceneProgress: number;
}

/** What an authentication hook is told about a joining peer. */
export interface AuthRequest {
  readonly connection: ConnectionId;
  readonly credentials: NetState;
  /** A session token the peer is trying to resume, if any. */
  readonly resume: string | undefined;
}

/**
 * The verdict on a joining peer.
 *
 * There is deliberately no built-in crypto here. Whether a token is a signed
 * JWT, a row in a database, or a shared secret is a decision only the game can
 * make, and an engine that guessed would be both wrong and impossible to
 * replace.
 */
export type AuthDecision =
  | { readonly ok: true; readonly identity?: NetState }
  | { readonly ok: false; readonly reason: string };

/** Called once per `join`, before the connection exists. Must be synchronous:
 * an async hook would let unauthenticated peers queue work on the server. */
export type AuthHook = (request: AuthRequest) => AuthDecision;

/** A connection kept alive across a drop, awaiting reconnection. */
interface SuspendedSession {
  readonly connection: ServerConnection;
  readonly expiresAtTick: number;
}

/** Everything needed to stand a server back up somewhere else. */
export interface HostHandover {
  readonly tick: number;
  readonly nextEntityId: number;
  readonly scene: string | undefined;
  readonly sceneGeneration: number;
  readonly entities: readonly {
    readonly id: NetworkId;
    readonly prefab: string;
    readonly owner: ConnectionId | null;
    readonly state: NetState;
  }[];
  /** Session tokens, so surviving clients reconnect into their own entities. */
  readonly sessions: readonly { readonly connection: ConnectionId; readonly session: string; readonly identity: NetState | null }[];
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
  /**
   * Vets joining peers. When set, the server accepts nothing but `join` from an
   * unknown peer and admits it only if this returns `ok`.
   */
  readonly authenticate?: AuthHook;
  /** Issues session tokens. Defaults to `crypto.randomUUID()`; override for tests. */
  readonly sessionToken?: (connection: ConnectionId) => string;
  /**
   * Ticks a dropped client's entities survive while it reconnects.
   *
   * Zero — the default — despawns immediately, which is right for an arena and
   * wrong for anything with an inventory: a player who loses Wi-Fi for four
   * seconds should not lose their character.
   */
  readonly reconnectGraceTicks?: number;
  /** Scene clients must load before replication starts. */
  readonly scene?: string;
  /** Called as clients report scene load progress. */
  readonly onSceneProgress?: (connection: ServerConnection, progress: number, ready: boolean) => void;
  /** Called when a client is admitted, including on a resumed session. */
  readonly onJoin?: (connection: ServerConnection, resumed: boolean) => void;
  /** Called when a client's grace window expires without a reconnection. */
  readonly onSessionExpired?: (connection: ServerConnection) => void;
  /** Records every tick into `server.history` for lag-compensated hit checks. */
  readonly lagCompensation?: Omit<SnapshotHistoryOptions, "tickRate"> | boolean;
}

export interface ServerStats {
  readonly tick: number;
  readonly connections: number;
  readonly entities: number;
  readonly bytesSent: number;
  readonly snapshotsSent: number;
  /** Clients dropped but still inside their reconnection grace window. */
  readonly suspended: number;
  /** Clients admitted but still loading the scene, so not yet replicated to. */
  readonly loading: number;
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
  readonly #options: ServerOptions & { readonly tickRate: number; readonly decimals: number };
  readonly #connections = new Map<ConnectionId, ServerConnection>();
  readonly #entities = new Map<NetworkId, NetworkEntity>();
  readonly #suspended = new Map<string, SuspendedSession>();
  readonly #graceTicks: number;
  readonly #issueToken: (connection: ConnectionId) => string;
  readonly #history: SnapshotHistory | undefined;
  #tick = 0;
  #nextEntityId = 1;
  #bytesSent = 0;
  #snapshotsSent = 0;
  #scene: string | undefined;
  #sceneGeneration = 0;
  #tokenCounter = 0;

  constructor(transport: Transport, options: ServerOptions = {}) {
    const tickRate = options.tickRate ?? 20;
    if (!Number.isInteger(tickRate) || tickRate < 1) throw new Error("A server tick rate must be a whole number of at least 1.");
    const decimals = options.decimals ?? 3;
    if (!Number.isInteger(decimals) || decimals < 0) throw new Error("Quantization decimals must be a non-negative whole number.");
    const graceTicks = options.reconnectGraceTicks ?? 0;
    if (!Number.isInteger(graceTicks) || graceTicks < 0) throw new Error("A reconnection grace window must be a non-negative whole number of ticks.");
    if (options.scene !== undefined && !options.scene.trim()) throw new Error("A server scene must be a non-empty name.");
    this.#transport = transport;
    this.#options = { tickRate, decimals, ...options };
    this.#graceTicks = graceTicks;
    this.#issueToken = options.sessionToken ?? ((connection) => this.#defaultToken(connection));
    this.#scene = options.scene;
    if (options.scene !== undefined) this.#sceneGeneration = 1;
    this.#history =
      options.lagCompensation === undefined || options.lagCompensation === false
        ? undefined
        : new SnapshotHistory({ ...(options.lagCompensation === true ? {} : options.lagCompensation), tickRate });
  }

  get tick(): number {
    return this.#tick;
  }

  /** Recorded world history, when `lagCompensation` is enabled. */
  get history(): SnapshotHistory | undefined {
    return this.#history;
  }

  /** Scene every client must load before it is replicated to. */
  get scene(): string | undefined {
    return this.#scene;
  }

  get sceneGeneration(): number {
    return this.#sceneGeneration;
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
  addConnection(id: ConnectionId, identity: NetState | null = null): ServerConnection {
    if (this.#connections.has(id)) throw new Error(`Connection ${id} is already connected.`);
    const connection: ServerConnection = {
      id,
      lastInputTick: -1,
      acknowledgedTick: -1,
      viewTick: -1,
      interest: new Set(),
      baseline: new Map(),
      bytesSent: 0,
      session: this.#issueToken(id),
      identity,
      ready: this.#scene === undefined,
      sceneGeneration: this.#sceneGeneration,
      sceneProgress: this.#scene === undefined ? 1 : 0,
    };
    this.#connections.set(id, connection);
    this.#welcome(connection, false);
    this.#options.onJoin?.(connection, false);
    return connection;
  }

  /** Removes a client and despawns anything it owned. */
  removeConnection(id: ConnectionId): void {
    const connection = this.#connections.get(id);
    if (!connection) return;
    this.#connections.delete(id);
    this.#suspended.delete(connection.session);
    for (const entity of [...this.#entities.values()]) {
      if (entity.owner === id) this.despawn(entity.id);
    }
    this.#transport.disconnect(id);
  }

  /**
   * Drops a client but keeps its entities for `reconnectGraceTicks`.
   *
   * The alternative — despawn now, respawn on reconnect — loses whatever the
   * entity was carrying and teleports it back to a spawn point, which is why
   * every game that has an inventory ends up implementing this.
   *
   * With no grace configured this is exactly {@link removeConnection}, so the
   * cheap behaviour stays the default rather than the one you have to opt into.
   */
  dropConnection(id: ConnectionId): string | undefined {
    const connection = this.#connections.get(id);
    if (!connection) return undefined;
    if (this.#graceTicks <= 0) {
      this.removeConnection(id);
      return undefined;
    }
    this.#connections.delete(id);
    this.#suspended.set(connection.session, { connection, expiresAtTick: this.#tick + this.#graceTicks });
    this.#transport.disconnect(id);
    return connection.session;
  }

  /** Sessions dropped but still resumable. */
  get suspendedSessions(): readonly string[] {
    return [...this.#suspended.keys()];
  }

  /**
   * Rebinds a suspended session onto a new transport connection.
   *
   * Ownership follows the session, not the connection id: a reconnecting player
   * almost never gets the same socket back, so every entity they owned is
   * re-pointed at the new id. Interest and baseline are *not* restored — the
   * client reloads the scene and gets full spawns, because a delta against a
   * baseline the client may never have received would corrupt its world.
   */
  resumeConnection(session: string, id: ConnectionId): ServerConnection | undefined {
    const suspended = this.#suspended.get(session);
    if (!suspended) return undefined;
    if (this.#connections.has(id)) throw new Error(`Connection ${id} is already connected.`);
    this.#suspended.delete(session);
    const previous = suspended.connection.id;
    const connection: ServerConnection = {
      ...suspended.connection,
      id,
      interest: new Set(),
      baseline: new Map(),
      lastInputTick: -1,
      acknowledgedTick: -1,
      viewTick: -1,
      ready: this.#scene === undefined,
      sceneGeneration: this.#sceneGeneration,
      sceneProgress: this.#scene === undefined ? 1 : 0,
    };
    this.#connections.set(id, connection);
    for (const entity of this.#entities.values()) {
      if (entity.owner === previous) entity.owner = id;
    }
    this.#welcome(connection, true);
    this.#options.onJoin?.(connection, true);
    return connection;
  }

  /**
   * Tells every client to load a scene and holds replication until they have.
   *
   * Interest and baselines are cleared, so once a client reports ready it gets
   * a full spawn for everything it can see rather than a delta against the
   * previous scene's world.
   */
  setScene(scene: string): void {
    if (!scene.trim()) throw new Error("A scene name must not be empty.");
    this.#scene = scene;
    this.#sceneGeneration += 1;
    for (const connection of this.#connections.values()) {
      connection.ready = false;
      connection.sceneProgress = 0;
      connection.sceneGeneration = this.#sceneGeneration;
      connection.interest = new Set();
      connection.baseline = new Map();
      this.#send(connection, { type: "sceneLoad", scene, generation: this.#sceneGeneration, tick: this.#tick });
    }
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
    if (entity.owner === owner) return;
    entity.owner = owner;
    // Every client that knows the entity is told, so `local` flips on the new
    // owner's client and prediction starts there rather than a snapshot later.
    for (const connection of this.#connections.values()) {
      if (connection.interest.has(id)) this.#send(connection, { type: "ownership", id, owner, tick: this.#tick });
    }
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
      if (!message) continue;
      const connection = this.#connections.get(packet.from);
      // `join` is the one message an unknown peer may send, and only when the
      // game supplied an authentication hook to judge it. Everything else from
      // an unknown peer is discarded rather than throwing: one malformed or
      // stale packet must not take down a server.
      if (!connection) {
        if (message.type === "join") this.#handleJoin(packet.from, message.credentials, message.resume);
        continue;
      }
      if (message.type === "sceneProgress") {
        // A report for a scene the server has already moved past is stale:
        // acting on it would mark a client ready for the wrong world.
        if (message.generation !== connection.sceneGeneration) continue;
        connection.sceneProgress = Math.min(1, Math.max(0, message.progress));
        connection.ready = message.ready === true;
        this.#options.onSceneProgress?.(connection, connection.sceneProgress, connection.ready);
      } else if (message.type === "input") {
        // Stale inputs are dropped. Accepting an out-of-order input would let a
        // client rewind its own history.
        if (message.tick <= connection.lastInputTick) continue;
        connection.lastInputTick = message.tick;
        this.#noteViewTick(connection, message.viewTick);
        this.#options.onInput?.(connection, message.tick, message.payload);
      } else if (message.type === "ack") {
        if (message.tick > connection.acknowledgedTick) connection.acknowledgedTick = message.tick;
      } else if (message.type === "rpc") {
        this.#noteViewTick(connection, message.viewTick);
        this.#options.onRpc?.(connection, message.name, message.args, message.id);
      } else if (message.type === "ownership") {
        // Only the current owner may hand an entity off. Anyone else asking is
        // a client trying to take a physics object it does not hold.
        const entity = this.#entities.get(message.id);
        if (!entity || entity.owner !== connection.id) continue;
        if (message.owner !== null && !this.#connections.has(message.owner)) continue;
        this.setOwner(message.id, message.owner);
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
    this.#history?.record(this.#tick, this.#entities.values());
    this.#reapSessions();
    for (const connection of this.#connections.values()) {
      // A client still loading the scene is not sent snapshots: spawns for a
      // world it has not loaded are spawns it must buffer or discard.
      if (!connection.ready) continue;
      this.#sendSnapshot(connection);
    }
  }

  stats(): ServerStats {
    let loading = 0;
    for (const connection of this.#connections.values()) if (!connection.ready) loading += 1;
    return {
      tick: this.#tick,
      connections: this.#connections.size,
      entities: this.#entities.size,
      bytesSent: this.#bytesSent,
      snapshotsSent: this.#snapshotsSent,
      suspended: this.#suspended.size,
      loading,
    };
  }

  /**
   * Everything a successor host needs to continue this world.
   *
   * Entity ids and the next-id counter come along deliberately: reissuing ids
   * would make every client's reference to an entity mean something different
   * after the migration.
   */
  capture(): HostHandover {
    return {
      tick: this.#tick,
      nextEntityId: this.#nextEntityId,
      scene: this.#scene,
      sceneGeneration: this.#sceneGeneration,
      entities: [...this.#entities.values()].map((entity) => ({
        id: entity.id,
        prefab: entity.prefab,
        owner: entity.owner,
        state: entity.state,
      })),
      sessions: [
        ...[...this.#connections.values()].map((connection) => ({ connection: connection.id, session: connection.session, identity: connection.identity })),
        ...[...this.#suspended.values()].map(({ connection }) => ({ connection: connection.id, session: connection.session, identity: connection.identity })),
      ],
    };
  }

  /**
   * Adopts a captured world, the other half of host migration.
   *
   * Sessions arrive suspended rather than connected: the surviving clients have
   * not reached this server yet, and they resume by presenting their token.
   */
  adopt(handover: HostHandover): void {
    if (this.#entities.size > 0) throw new Error("A server can only adopt a handover before it owns any entities.");
    this.#tick = handover.tick;
    this.#nextEntityId = handover.nextEntityId;
    this.#scene = handover.scene;
    this.#sceneGeneration = handover.sceneGeneration;
    for (const entity of handover.entities) {
      this.#entities.set(entity.id, { id: entity.id, prefab: entity.prefab, owner: entity.owner, state: entity.state });
    }
    // The successor's own client is already connected and already has the
    // world loaded — it was playing in it a moment ago — so it inherits the new
    // scene generation as ready rather than being told to reload.
    for (const connection of this.#connections.values()) {
      connection.sceneGeneration = this.#sceneGeneration;
      connection.ready = true;
      connection.sceneProgress = 1;
    }
    const grace = Math.max(this.#graceTicks, 1);
    for (const record of handover.sessions) {
      if (this.#connections.has(record.connection)) continue;
      this.#suspended.set(record.session, {
        connection: {
          id: record.connection,
          lastInputTick: -1,
          acknowledgedTick: -1,
          viewTick: -1,
          interest: new Set(),
          baseline: new Map(),
          bytesSent: 0,
          session: record.session,
          identity: record.identity,
          ready: this.#scene === undefined,
          sceneGeneration: this.#sceneGeneration,
          sceneProgress: this.#scene === undefined ? 1 : 0,
        },
        expiresAtTick: this.#tick + grace,
      });
    }
  }

  #noteViewTick(connection: ServerConnection, viewTick: number | undefined): void {
    // A view tick from the future is a lie or a bug; either way the present is
    // the most it can mean.
    if (viewTick === undefined || !Number.isFinite(viewTick)) return;
    connection.viewTick = Math.min(viewTick, this.#tick);
  }

  #defaultToken(connection: ConnectionId): string {
    this.#tokenCounter += 1;
    const random = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : String(Math.random()).slice(2);
    return `${String(connection)}-${String(this.#tokenCounter)}-${random}`;
  }

  #welcome(connection: ServerConnection, resumed: boolean): void {
    this.#send(connection, {
      type: "welcome",
      connection: connection.id,
      tick: this.#tick,
      tickRate: this.#options.tickRate,
      session: connection.session,
      resumed,
      ...(this.#scene === undefined ? {} : { scene: this.#scene, sceneGeneration: this.#sceneGeneration }),
    });
  }

  /**
   * Admits, resumes, or rejects an unknown peer's `join`.
   *
   * Resumption is tried before authentication: a token proves the peer already
   * passed the hook once, and asking it to authenticate again would make every
   * reconnect cost a credential round trip.
   */
  #handleJoin(from: ConnectionId, credentials: NetState, resume: string | undefined): void {
    if (resume !== undefined && this.#suspended.has(resume)) {
      this.resumeConnection(resume, from);
      return;
    }
    const hook = this.#options.authenticate;
    if (hook === undefined) {
      this.addConnection(from);
      return;
    }
    const decision = hook({ connection: from, credentials, resume });
    if (!decision.ok) {
      this.#transport.send(from, encodeMessage({ type: "reject", reason: decision.reason }), { reliable: true });
      this.#transport.disconnect(from);
      return;
    }
    this.addConnection(from, decision.identity ?? null);
  }

  #reapSessions(): void {
    for (const [token, suspended] of this.#suspended) {
      if (this.#tick < suspended.expiresAtTick) continue;
      this.#suspended.delete(token);
      for (const entity of [...this.#entities.values()]) {
        if (entity.owner === suspended.connection.id) this.despawn(entity.id);
      }
      this.#options.onSessionExpired?.(suspended.connection);
    }
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
