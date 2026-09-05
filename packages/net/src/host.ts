/** Listen-server mode: an authoritative server and local predicted client
 * joined through the same transport/protocol as remote players. */
import { NetworkClient, type ClientOptions } from "./client.js";
import { NetworkServer, type ServerOptions } from "./server.js";
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
    this.server.addConnection(connectionId);
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

  close(): void {
    if (this.#closed) return;
    this.server.removeConnection(this.connectionId);
    this.#clientEndpoint.close();
    this.#serverEndpoint.close();
    this.#closed = true;
  }
}
