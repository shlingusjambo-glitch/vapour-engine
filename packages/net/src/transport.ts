/** The transport boundary, and an in-memory transport for tests.
 *
 * Everything above this file is transport-agnostic: the replication layer sends
 * and receives opaque messages and never knows whether they travelled over a
 * WebSocket, WebRTC, a worker channel, or nothing at all. That separation is
 * what makes the whole stack testable — a multiplayer bug that needs two
 * browsers and a server to reproduce is a bug that does not get fixed.
 *
 * {@link LoopbackTransport} also simulates latency, jitter, packet loss, and
 * reordering, because those are not edge cases: they are the normal condition
 * of every real network, and code that has only ever run on localhost is code
 * that has never been tested.
 */

export type ConnectionId = number;

export interface TransportMessage {
  readonly from: ConnectionId;
  readonly data: Uint8Array;
}

/** What the session layer needs from any transport. */
export interface Transport {
  /** Sends to one peer. On a client, `to` is ignored — there is one peer. */
  send(to: ConnectionId, data: Uint8Array, options?: { readonly reliable?: boolean }): void;
  /** Delivers everything that has arrived, oldest first, and clears the queue. */
  receive(): readonly TransportMessage[];
  /** Called each tick, so a simulating transport can advance its own clock. */
  poll(nowMs: number): void;
  disconnect(id: ConnectionId): void;
  close(): void;
}

export interface NetworkConditions {
  /** One-way latency in milliseconds. */
  readonly latencyMs?: number;
  /** Random additional latency, up to this many milliseconds. */
  readonly jitterMs?: number;
  /** Fraction of unreliable packets dropped, in `[0, 1)`. */
  readonly packetLoss?: number;
  /** Fraction of packets delivered out of order. */
  readonly reorder?: number;
}

interface QueuedPacket {
  readonly target: LoopbackEndpoint;
  readonly message: TransportMessage;
  readonly deliverAt: number;
  readonly sequence: number;
}

/**
 * A transport pair connected in memory.
 *
 * Deterministic given a seed: the same conditions produce the same drops and
 * reordering every run, so a test that catches a prediction bug catches it
 * again tomorrow.
 */
export class LoopbackNetwork {
  readonly #queue: QueuedPacket[] = [];
  readonly #endpoints = new Map<ConnectionId, LoopbackEndpoint>();
  #conditions: Required<NetworkConditions>;
  #now = 0;
  #sequence = 0;
  #random: () => number;
  #dropped = 0;
  #delivered = 0;

  constructor(conditions: NetworkConditions = {}, seed = 1) {
    this.#conditions = {
      latencyMs: conditions.latencyMs ?? 0,
      jitterMs: conditions.jitterMs ?? 0,
      packetLoss: conditions.packetLoss ?? 0,
      reorder: conditions.reorder ?? 0,
    };
    validateConditions(this.#conditions);
    let state = (seed >>> 0) || 1;
    this.#random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) % 1_000_000) / 1_000_000;
    };
  }

  setConditions(conditions: NetworkConditions): void {
    const merged = { ...this.#conditions, ...conditions };
    validateConditions(merged);
    this.#conditions = merged;
  }

  get conditions(): Required<NetworkConditions> {
    return this.#conditions;
  }

  get stats(): { readonly dropped: number; readonly delivered: number; readonly inFlight: number } {
    return { dropped: this.#dropped, delivered: this.#delivered, inFlight: this.#queue.length };
  }

  /** Creates an endpoint with the given id. */
  endpoint(id: ConnectionId): LoopbackEndpoint {
    const existing = this.#endpoints.get(id);
    if (existing) return existing;
    const endpoint = new LoopbackEndpoint(this, id);
    this.#endpoints.set(id, endpoint);
    return endpoint;
  }

  /** @internal Queues a packet, applying the simulated conditions. */
  enqueue(from: ConnectionId, to: ConnectionId, data: Uint8Array, reliable: boolean): void {
    const target = this.#endpoints.get(to);
    if (!target) return;
    // Reliable messages are never dropped or reordered; that is what makes them
    // reliable, and mixing the two is how "it works locally" bugs are born.
    if (!reliable && this.#random() < this.#conditions.packetLoss) {
      this.#dropped += 1;
      return;
    }
    let delay = this.#conditions.latencyMs + this.#random() * this.#conditions.jitterMs;
    if (!reliable && this.#random() < this.#conditions.reorder) {
      // Push this one later so a subsequent packet overtakes it.
      delay += this.#conditions.latencyMs * 0.5 + 1;
    }
    this.#queue.push({ target, message: { from, data: data.slice() }, deliverAt: this.#now + delay, sequence: this.#sequence++ });
  }

  /** @internal Advances the clock and delivers due packets. */
  advance(nowMs: number): void {
    this.#now = nowMs;
    let index = 0;
    while (index < this.#queue.length) {
      const packet = this.#queue[index]!;
      if (packet.deliverAt > this.#now) {
        index += 1;
        continue;
      }
      packet.target.deliver(packet.message);
      this.#delivered += 1;
      this.#queue.splice(index, 1);
    }
  }

  /** @internal */
  removeEndpoint(id: ConnectionId): void {
    this.#endpoints.delete(id);
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      if (this.#queue[index]!.target.id === id) this.#queue.splice(index, 1);
    }
  }
}

/** One side of a {@link LoopbackNetwork}. */
export class LoopbackEndpoint implements Transport {
  readonly id: ConnectionId;
  readonly #network: LoopbackNetwork;
  readonly #inbox: TransportMessage[] = [];
  #closed = false;

  /** @internal Created through {@link LoopbackNetwork.endpoint}. */
  constructor(network: LoopbackNetwork, id: ConnectionId) {
    this.#network = network;
    this.id = id;
  }

  send(to: ConnectionId, data: Uint8Array, options: { reliable?: boolean } = {}): void {
    if (this.#closed) throw new Error(`Endpoint ${this.id} is closed.`);
    this.#network.enqueue(this.id, to, data, options.reliable ?? true);
  }

  receive(): readonly TransportMessage[] {
    const messages = [...this.#inbox];
    this.#inbox.length = 0;
    return messages;
  }

  poll(nowMs: number): void {
    this.#network.advance(nowMs);
  }

  disconnect(id: ConnectionId): void {
    this.#network.removeEndpoint(id);
  }

  close(): void {
    this.#closed = true;
    this.#network.removeEndpoint(this.id);
  }

  /** @internal */
  deliver(message: TransportMessage): void {
    if (!this.#closed) this.#inbox.push(message);
  }
}

function validateConditions(conditions: Required<NetworkConditions>): void {
  if (!(conditions.latencyMs >= 0)) throw new Error("Simulated latency must not be negative.");
  if (!(conditions.jitterMs >= 0)) throw new Error("Simulated jitter must not be negative.");
  if (!(conditions.packetLoss >= 0 && conditions.packetLoss < 1)) throw new Error("Simulated packet loss must lie in [0, 1).");
  if (!(conditions.reorder >= 0 && conditions.reorder < 1)) throw new Error("Simulated reordering must lie in [0, 1).");
}
