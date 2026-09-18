/** Listen-server mode: an authoritative server and local predicted client
 * joined through the same transport/protocol as remote players. */
import { NetworkClient, type ClientOptions } from "./client.js";
import { NetworkServer, type HostHandover, type ServerOptions } from "./server.js";
import {
  LoopbackNetwork,
  type ConnectionId,
  type LoopbackEndpoint,
  type NetworkConditions,
} from "./transport.js";

export interface NetworkHostOptions {
  readonly server?: ServerOptions;
  readonly client?: ClientOptions;
  readonly connectionId?: ConnectionId;
  /** Useful for testing the host player under real-network conditions. */
  readonly conditions?: NetworkConditions;
  readonly seed?: number;
  /**
   * A world captured by {@link NetworkHost.migrateHost} on the previous host.
   *
   * This host continues it: same entity ids, same tick, and every other
   * player's session waiting to be resumed by token.
   */
  readonly handover?: HostHandover;
}

/** What a departing host hands to its successor. */
export interface HostMigration {
  /** The peer that should become host; see {@link chooseSuccessor}. */
  readonly successor: ConnectionId;
  readonly handover: HostHandover;
}

/**
 * Which peer takes over when the host leaves: the lowest connection id among
 * clients that are ready, excluding the departing host.
 *
 * The rule is deliberately dumb. Every peer can compute it from the same
 * facts, which is what stops two clients both deciding they are the new host
 * while the old one's last packets are still in flight.
 */
export function chooseSuccessor(server: NetworkServer, departing: ConnectionId): ConnectionId | undefined {
  let best: ConnectionId | undefined;
  for (const connection of server.connections) {
    if (connection.id === departing || !connection.ready) continue;
    if (best === undefined || connection.id < best) best = connection.id;
  }
  return best;
}

/** A host is not a less-authoritative client. It embeds a normal server and a
 * normal client, which prevents host-only gameplay paths and keeps migration to
 * a dedicated server mechanical. */
export class NetworkHost {
  readonly server: NetworkServer;
  readonly client: NetworkClient;
  readonly network: LoopbackNetwork;
  readonly connectionId: ConnectionId;
  readonly #serverEndpoint: LoopbackEndpoint;
  readonly #clientEndpoint: LoopbackEndpoint;
  #nowMs = 0;
  #closed = false;

  constructor(options: NetworkHostOptions = {}) {
    const connectionId = options.connectionId ?? 1;
    if (!Number.isInteger(connectionId) || connectionId <= 0)
      throw new Error("A host connection id must be a positive whole number.");
    this.connectionId = connectionId;
    this.network = new LoopbackNetwork(options.conditions, options.seed);
    this.#serverEndpoint = this.network.endpoint(0);
    this.#clientEndpoint = this.network.endpoint(connectionId);
    this.server = new NetworkServer(this.#serverEndpoint, options.server);
    this.client = new NetworkClient(this.#clientEndpoint, options.client);

    const handover = options.handover;
    const own = handover?.sessions.find((record) => record.connection === connectionId);
    if (handover) this.server.adopt(handover);
    if (own) {
      // The successor resumes its own session rather than joining fresh, so it
      // keeps its identity and every entity it owned. It was playing in this
      // world a moment ago, so it is ready for it without a reload.
      const connection = this.server.resumeConnection(own.session, connectionId)!;
      connection.ready = true;
      connection.sceneProgress = 1;
    } else {
      this.server.addConnection(connectionId);
    }
  }

  /** Runs one authoritative tick and delivers every packet currently due. */
  step(nowMs = this.#nowMs): void {
    if (this.#closed) throw new Error("Cannot step a closed network host.");
    if (!Number.isFinite(nowMs) || nowMs < this.#nowMs)
      throw new Error("NetworkHost.step time must be finite and monotonic.");
    this.#nowMs = nowMs;
    this.network.advance(nowMs);
    this.server.receive();
    this.server.step();
    this.network.advance(nowMs);
    this.client.receive(0);
    this.network.advance(nowMs);
    this.server.receive();
  }

  /**
   * Hands the world to a successor and closes this host.
   *
   * Returns `undefined` — and stays open — when no other client is ready to
   * take over: a host with nobody to hand to is simply the last one out.
   * Surviving clients reconnect to the successor with their session tokens;
   * ownership follows the session, so every player keeps their entity.
   */
  migrateHost(): HostMigration | undefined {
    if (this.#closed) throw new Error("Cannot migrate a closed network host.");
    const successor = chooseSuccessor(this.server, this.connectionId);
    if (successor === undefined) return undefined;
    const handover = this.server.capture();
    this.close();
    return { successor, handover };
  }

  close(): void {
    if (this.#closed) return;
    this.server.removeConnection(this.connectionId);
    this.#clientEndpoint.close();
    this.#serverEndpoint.close();
    this.#closed = true;
  }
}
