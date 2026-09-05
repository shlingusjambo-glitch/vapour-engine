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
  readonly owner: ConnectionId | null;
  /** The server's most recent authoritative state. */
  state: NetState;
  /** Whether this client owns it, and therefore predicts it. */
  readonly local: boolean;
}

interface Snapshot {
  readonly tick: number;
  readonly states: Map<NetworkId, NetState>;
}

export interface PendingInput {
  readonly tick: number;
  readonly payload: NetState;
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
}

export interface ClientStats {
  readonly connection: ConnectionId | undefined;
  readonly serverTick: number;
  readonly entities: number;
  readonly pendingInputs: number;
  readonly snapshots: number;
  readonly bytesReceived: number;
  readonly mispredictions: number;
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
    this.#pending.push({ tick, payload });
    // Bound the buffer: a client that loses its connection must not grow this
    // without limit while it reconnects.
    if (this.#pending.length > this.#options.historyTicks * 4) this.#pending.shift();
    this.#transport.send(serverConnection, encodeMessage({ type: "input", tick, payload }), { reliable: false });

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
      encodeMessage({ type: "rpc", name, id: options.id ?? null, args: args as never, tick: this.#serverTick }),
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
    };
  }

  #handle(message: NetMessage, serverConnection: ConnectionId): void {
    switch (message.type) {
      case "welcome":
        this.#connection = message.connection;
        this.#serverTick = message.tick;
        break;

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
          while (this.#pending.length > 0 && this.#pending[0]!.tick <= message.ackInput) this.#pending.shift();
        }
        this.#transport.send(serverConnection, encodeMessage({ type: "ack", tick: message.tick }), { reliable: false });
        break;
      }

      default:
        break;
    }
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
