/** The client: prediction, reconciliation, and interpolation.
 *
 * A client faces one problem: the server's truth is always in the past, because
 * it took a network trip to arrive. Everything here is a strategy for hiding
 * that, and each applies to a different category of entity.
 *
 * - **The local player is predicted.** Applying input immediately and replaying
 *   unacknowledged inputs when the server disagrees is what makes controls feel
 *   instant. Waiting for the server would put a full round trip between
 *   pressing a key and moving.
 * - **Everyone else is interpolated**, rendered slightly in the past between
 *   two received snapshots. Extrapolating instead produces characters that
 *   overshoot and snap back on every packet.
 *
 * Doing the same thing to both is the classic mistake: a predicted remote
 * player jitters, and an interpolated local player feels like driving a boat.
 */
import {
  applyDelta, decodeMessage, encodeMessage, type NetMessage, type NetState, type NetworkId,
} from "./protocol.js";
import type { ConnectionId, Transport } from "./transport.js";

export interface ClientEntity {
  readonly id: NetworkId;
  readonly prefab: string;
  owner: ConnectionId | null;
  /** The server's most recent authoritative state. */
  state: NetState;
  /** Whether this client owns it, and therefore predicts it. */
  local: boolean;
}

interface Snapshot {
  readonly tick: number;
  readonly states: Map<NetworkId, NetState>;
}

export interface PendingInput {
  readonly tick: number;
  readonly payload: NetState;
  /** The newest server tick the client had when it sent this. */
  readonly sentAtServerTick: number;
}

export interface ClientOptions {
  /**
   * How many ticks behind the newest snapshot to render remote entities.
   *
   * Two is the usual choice: one tick absorbs normal jitter and the second
   * covers a single dropped packet, at the cost of rendering that far in the
   * past.
   */
  readonly interpolationDelayTicks?: number;
  /** Applies an input to a state, used to replay unacknowledged inputs. */
  readonly predict?: (state: NetState, input: NetState, tick: number) => NetState;
  /** Called for RPCs the server sent. */
  readonly onRpc?: (name: string, args: readonly unknown[], id: NetworkId | null) => void;
  readonly onSpawn?: (entity: ClientEntity) => void;
  readonly onDespawn?: (id: NetworkId) => void;
  /** Snapshots retained for interpolation and lag compensation. */
  readonly historyTicks?: number;
  /** The server refused this client's `join`. */
  readonly onReject?: (reason: string) => void;
  /** Called once admitted; `resumed` when a dropped session was picked back up. */
  readonly onWelcome?: (connection: ConnectionId, resumed: boolean) => void;
  /**
   * The server wants a scene loaded before it replicates anything.
   *
   * Load it, then call {@link NetworkClient.reportSceneProgress} with the same
   * generation; the server drops reports for any other one.
   */
  readonly onSceneLoad?: (scene: string, generation: number) => void;
  /** An entity changed owner; `entity.local` has already been updated. */
  readonly onOwnership?: (entity: ClientEntity) => void;
}

export interface ClientStats {
  readonly connection: ConnectionId | undefined;
  readonly serverTick: number;
  readonly entities: number;
  readonly pendingInputs: number;
  readonly snapshots: number;
  readonly bytesReceived: number;
  readonly mispredictions: number;
  /** Round trip in server ticks, measured from input send to its acknowledgement. */
  readonly rttTicks: number;
}

export class NetworkClient {
  readonly #transport: Transport;
  readonly #options: Required<Pick<ClientOptions, "interpolationDelayTicks" | "historyTicks">> & ClientOptions;
  readonly #entities = new Map<NetworkId, ClientEntity>();
  readonly #snapshots: Snapshot[] = [];
  readonly #pending: PendingInput[] = [];
  #connection: ConnectionId | undefined;
  #serverTick = -1;
  #inputTick = 0;
  #bytesReceived = 0;
  #mispredictions = 0;
  #rttTicks = 0;
  #session: string | undefined;
  #scene: string | undefined;
  #sceneGeneration = 0;

  constructor(transport: Transport, options: ClientOptions = {}) {
    const delay = options.interpolationDelayTicks ?? 2;
    if (!Number.isInteger(delay) || delay < 0) throw new Error("Interpolation delay must be a non-negative whole number of ticks.");
    const history = options.historyTicks ?? 32;
    if (!Number.isInteger(history) || history < 2) throw new Error("Snapshot history must be a whole number of at least 2.");
    this.#transport = transport;
    this.#options = { interpolationDelayTicks: delay, historyTicks: history, ...options };
  }

  get connection(): ConnectionId | undefined {
    return this.#connection;
  }

  get serverTick(): number {
    return this.#serverTick;
  }

  /**
   * The server tick this client is rendering remote entities at.
   *
   * Sent with every input so the server can rewind to exactly what the player
   * saw when judging a shot; see `LagCompensator`.
   */
  get viewTick(): number {
    return Math.max(-1, this.#serverTick - this.#options.interpolationDelayTicks);
  }

  /** Token to present to {@link resume} after a drop. */
  get session(): string | undefined {
    return this.#session;
  }

  /** Scene the server last asked this client to load, and its generation. */
  get scene(): string | undefined {
    return this.#scene;
  }

  get sceneGeneration(): number {
    return this.#sceneGeneration;
  }

  /**
   * Asks to be admitted. Credentials are opaque to the engine; the server's
   * authentication hook interprets them.
   */
  join(credentials: NetState = {}, serverConnection: ConnectionId = 0): void {
    const message: NetMessage = this.#session === undefined
      ? { type: "join", credentials }
      : { type: "join", credentials, resume: this.#session };
    this.#transport.send(serverConnection, encodeMessage(message), { reliable: true });
  }

  /** Resumes a dropped session on a new transport connection. */
  resume(session: string, credentials: NetState = {}, serverConnection: ConnectionId = 0): void {
    if (!session) throw new Error("A session token is required to resume.");
    this.#session = session;
    this.join(credentials, serverConnection);
  }

  /**
   * Reports scene load progress; `ready` releases replication for this client.
   *
   * The generation defaults to the one most recently requested, which is what
   * a loader that finished the current scene wants. A loader that finished an
   * *older* scene passes that generation and the server ignores it.
   */
  reportSceneProgress(progress: number, ready: boolean, generation = this.#sceneGeneration, serverConnection: ConnectionId = 0): void {
    if (!(progress >= 0 && progress <= 1)) throw new Error("Scene progress must lie in [0, 1].");
    this.#transport.send(
      serverConnection,
      encodeMessage({ type: "sceneProgress", generation, progress, ready }),
      { reliable: true },
    );
  }

  /**
   * Asks the server to hand an entity this client owns to another connection,
   * or back to the server with `null`. Ignored server-side unless this client
   * is the current owner.
   */
  transferOwnership(id: NetworkId, to: ConnectionId | null, serverConnection: ConnectionId = 0): void {
    this.#transport.send(
      serverConnection,
      encodeMessage({ type: "ownership", id, owner: to, tick: this.#serverTick }),
      { reliable: true },
    );
  }

  get entities(): readonly ClientEntity[] {
    return [...this.#entities.values()];
  }

  entity(id: NetworkId): ClientEntity | undefined {
    return this.#entities.get(id);
  }

  /** Inputs sent but not yet acknowledged, replayed after a correction. */
  get pendingInputs(): readonly PendingInput[] {
    return this.#pending;
  }

  /**
   * Sends an input and predicts its effect locally.
   *
   * The input is retained until the server acknowledges it, so a correction can
   * replay everything the server had not yet seen.
   */
  sendInput(payload: NetState, serverConnection: ConnectionId = 0): number {
    const tick = this.#inputTick++;
    this.#pending.push({ tick, payload, sentAtServerTick: this.#serverTick });
    // Bound the buffer: a client that loses its connection must not grow this
    // without limit while it reconnects.
    if (this.#pending.length > this.#options.historyTicks * 4) this.#pending.shift();
    this.#transport.send(
      serverConnection,
      encodeMessage({ type: "input", tick, payload, viewTick: this.viewTick }),
      { reliable: false },
    );

    if (this.#options.predict) {
      for (const entity of this.#entities.values()) {
        if (!entity.local) continue;
        entity.state = this.#options.predict(entity.state, payload, tick);
      }
    }
    return tick;
  }

  sendRpc(name: string, args: readonly unknown[] = [], options: { id?: NetworkId; to?: ConnectionId } = {}): void {
    if (!name.trim()) throw new Error("An RPC requires a non-empty name.");
    this.#transport.send(
      options.to ?? 0,
      encodeMessage({ type: "rpc", name, id: options.id ?? null, args: args as never, tick: this.#serverTick, viewTick: this.viewTick }),
      { reliable: true },
    );
  }

  /** Processes everything that has arrived. Call once per frame. */
  receive(serverConnection: ConnectionId = 0): void {
    for (const packet of this.#transport.receive()) {
      this.#bytesReceived += packet.data.byteLength;
      const message = decodeMessage(packet.data);
      if (!message) continue;
      this.#handle(message, serverConnection);
    }
  }

  /**
   * Interpolated state for an entity, rendered `interpolationDelayTicks` behind.
   *
   * Local entities return their predicted state directly — interpolating the
   * thing the player is controlling is what makes controls feel like a boat.
   */
  interpolated(id: NetworkId): NetState | undefined {
    const entity = this.#entities.get(id);
    if (!entity) return undefined;
    if (entity.local) return entity.state;

    const target = this.#serverTick - this.#options.interpolationDelayTicks;
    let before: Snapshot | undefined;
    let after: Snapshot | undefined;
    for (const snapshot of this.#snapshots) {
      if (!snapshot.states.has(id)) continue;
      if (snapshot.tick <= target) before = snapshot;
      else if (after === undefined) after = snapshot;
    }
    if (!before) return entity.state;
    if (!after) return before.states.get(id)!;

    const span = after.tick - before.tick;
    const t = span <= 0 ? 0 : Math.min(1, Math.max(0, (target - before.tick) / span));
    return lerpState(before.states.get(id)!, after.states.get(id)!, t);
  }

  stats(): ClientStats {
    return {
      connection: this.#connection,
      serverTick: this.#serverTick,
      entities: this.#entities.size,
      pendingInputs: this.#pending.length,
      snapshots: this.#snapshots.length,
      bytesReceived: this.#bytesReceived,
      mispredictions: this.#mispredictions,
      rttTicks: this.#rttTicks,
    };
  }

  #handle(message: NetMessage, serverConnection: ConnectionId): void {
    switch (message.type) {
      case "welcome":
        // A welcome is a new view of the world, resumed or not: whatever this
        // client held is about to be re-spawned in full, and anything that was
        // despawned while it was away would otherwise linger forever.
        for (const id of [...this.#entities.keys()]) {
          this.#entities.delete(id);
          this.#options.onDespawn?.(id);
        }
        this.#snapshots.length = 0;
        this.#pending.length = 0;
        this.#connection = message.connection;
        this.#serverTick = message.tick;
        if (message.session !== undefined) this.#session = message.session;
        this.#options.onWelcome?.(message.connection, message.resumed === true);
        if (message.scene !== undefined) this.#sceneRequested(message.scene, message.sceneGeneration ?? 0);
        break;

      case "reject":
        this.#options.onReject?.(message.reason);
        break;

      case "sceneLoad":
        this.#sceneRequested(message.scene, message.generation);
        break;

      case "ownership": {
        const entity = this.#entities.get(message.id);
        if (!entity) break;
        entity.owner = message.owner;
        entity.local = message.owner !== null && message.owner === this.#connection;
        this.#options.onOwnership?.(entity);
        break;
      }

      case "spawn": {
        const entity: ClientEntity = {
          id: message.id,
          prefab: message.prefab,
          owner: message.owner,
          state: message.state,
          local: message.owner !== null && message.owner === this.#connection,
        };
        this.#entities.set(entity.id, entity);
        this.#options.onSpawn?.(entity);
        break;
      }

      case "despawn":
        if (this.#entities.delete(message.id)) this.#options.onDespawn?.(message.id);
        break;

      case "rpc":
        this.#options.onRpc?.(message.name, message.args, message.id);
        break;

      case "snapshot": {
        // Out-of-order snapshots are discarded: applying an older one would
        // rewind every entity for a frame.
        if (message.tick <= this.#serverTick) break;
        this.#serverTick = message.tick;

        for (const entry of message.changed) {
          const entity = this.#entities.get(entry.id);
          if (!entity) continue;
          const authoritative = applyDelta(entity.state, entry.state);
          if (entity.local) this.#reconcile(entity, authoritative, message.ackInput);
          else entity.state = authoritative;
        }
        for (const id of message.removed) {
          if (this.#entities.delete(id)) this.#options.onDespawn?.(id);
        }

        const states = new Map<NetworkId, NetState>();
        for (const entity of this.#entities.values()) states.set(entity.id, entity.state);
        this.#snapshots.push({ tick: message.tick, states });
        while (this.#snapshots.length > this.#options.historyTicks) this.#snapshots.shift();

        if (message.ackInput !== undefined) {
          while (this.#pending.length > 0 && this.#pending[0]!.tick <= message.ackInput) {
            const acked = this.#pending.shift()!;
            // The input was sent when the client had seen `sentAtServerTick`;
            // its acknowledgement arrives on this tick. The difference is one
            // round trip, in the server's own units.
            if (acked.tick === message.ackInput && acked.sentAtServerTick >= 0) {
              this.#rttTicks = message.tick - acked.sentAtServerTick;
            }
          }
        }
        this.#transport.send(serverConnection, encodeMessage({ type: "ack", tick: message.tick }), { reliable: false });
        break;
      }

      default:
        break;
    }
  }

  #sceneRequested(scene: string, generation: number): void {
    this.#scene = scene;
    this.#sceneGeneration = generation;
    this.#options.onSceneLoad?.(scene, generation);
  }

  /**
   * Reconciles a predicted entity against the server.
   *
   * The server's state is authoritative *as of the input it had processed*, so
   * the client rewinds to it and replays every input the server had not yet
   * seen. Without the replay, a correction would visibly undo the last few
   * frames of the player's own movement.
   */
  #reconcile(entity: ClientEntity, authoritative: NetState, ackInput: number | undefined): void {
    const predict = this.#options.predict;
    if (!predict) {
      entity.state = authoritative;
      return;
    }
    let replayed = authoritative;
    for (const input of this.#pending) {
      if (ackInput !== undefined && input.tick <= ackInput) continue;
      replayed = predict(replayed, input.payload, input.tick);
    }
    if (!statesClose(entity.state, replayed)) this.#mispredictions += 1;
    entity.state = replayed;
  }
}

/** Component-wise interpolation over the numeric fields of a state. */
function lerpState(from: NetState, to: NetState, t: number): NetState {
  const out: Record<string, NetState[string]> = { ...to };
  for (const [key, value] of Object.entries(to)) {
    const previous = from[key];
    if (typeof value === "number" && typeof previous === "number") {
      out[key] = previous + (value - previous) * t;
      continue;
    }
    if (Array.isArray(value) && Array.isArray(previous) && value.length === previous.length) {
      out[key] = value.map((component, index) => {
        const start = previous[index];
        // Non-numeric array members snap rather than interpolating; there is no
        // meaningful midpoint between two strings.
        return typeof component === "number" && typeof start === "number" ? start + (component - start) * t : component;
      });
    }
  }
  return out;
}

/** Whether a prediction was close enough to count as correct. */
function statesClose(a: NetState, b: NetState, tolerance = 0.01): boolean {
  for (const [key, value] of Object.entries(b)) {
    const other = a[key];
    if (typeof value === "number" && typeof other === "number") {
      if (Math.abs(value - other) > tolerance) return false;
      continue;
    }
    if (Array.isArray(value) && Array.isArray(other)) {
      for (const [index, component] of value.entries()) {
        const start = other[index];
        if (typeof component === "number" && typeof start === "number" && Math.abs(component - start) > tolerance) return false;
      }
    }
  }
  return true;
}
