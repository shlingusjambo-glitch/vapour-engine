/** WebSockets with reconnection.
 *
 * `networking.ts` provides a strict, low-level `WebSocketTransport` for the
 * multiplayer layer, where a dropped connection is a game-state event the
 * session must handle deliberately. This is the other case: a chat channel, a
 * live leaderboard, a presence feed — connections a game wants to *just stay
 * up*, where silently reconnecting is the correct behaviour rather than a
 * dangerous one.
 *
 * Both exist because conflating them is a mistake in one direction or the
 * other: auto-reconnecting a game session hides desyncs, and making a chat
 * channel's caller hand-roll backoff is busywork.
 */
import { Signal } from "../framework/signal.js";

export type SocketState = "idle" | "connecting" | "open" | "closed" | "failed";

export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export interface ReconnectingSocketOptions {
  readonly protocols?: string | readonly string[];
  /** Reconnection attempts before giving up. `Infinity` never gives up. */
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /**
   * Queue sends made while disconnected and flush them on reconnect.
   *
   * Right for a chat message, wrong for a position update — a stale position
   * delivered late is worse than one never sent.
   */
  readonly queueWhileClosed?: boolean;
  readonly maxQueuedMessages?: number;
  readonly socketFactory?: (url: string, protocols?: string | readonly string[]) => SocketLike;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface SocketStats {
  readonly state: SocketState;
  readonly connections: number;
  readonly reconnects: number;
  readonly sent: number;
  readonly received: number;
  readonly queued: number;
}

/** A WebSocket that reconnects with exponential backoff. */
export class ReconnectingSocket {
  readonly opened = new Signal<void>();
  readonly closed = new Signal<{ code: number; reason: string; clean: boolean }>();
  readonly message = new Signal<string | ArrayBuffer>();
  readonly failed = new Signal<Error>();

  readonly #url: string;
  readonly #options: Required<Omit<ReconnectingSocketOptions, "protocols" | "socketFactory" | "sleep">> &
    Pick<ReconnectingSocketOptions, "protocols">;
  readonly #factory: (url: string, protocols?: string | readonly string[]) => SocketLike;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #queue: (string | ArrayBufferLike | ArrayBufferView)[] = [];
  #socket: SocketLike | undefined;
  #state: SocketState = "idle";
  #retries = 0;
  #connections = 0;
  #reconnects = 0;
  #sent = 0;
  #received = 0;
  #stopped = false;

  constructor(url: string, options: ReconnectingSocketOptions = {}) {
    if (!/^wss?:\/\//i.test(url)) throw new Error(`A socket URL must start with ws:// or wss:// (got "${url}").`);
    const factory = options.socketFactory ?? ((address, protocols) => new WebSocket(address, protocols as string[] | undefined) as unknown as SocketLike);
    this.#url = url;
    this.#factory = factory;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#options = {
      maxRetries: options.maxRetries ?? 8,
      baseDelayMs: options.baseDelayMs ?? 300,
      maxDelayMs: options.maxDelayMs ?? 10_000,
      queueWhileClosed: options.queueWhileClosed ?? true,
      maxQueuedMessages: options.maxQueuedMessages ?? 64,
      ...(options.protocols === undefined ? {} : { protocols: options.protocols }),
    };
    if (!(this.#options.baseDelayMs >= 0)) throw new Error("A socket base delay must not be negative.");
    if (!(this.#options.maxQueuedMessages >= 0)) throw new Error("A socket queue limit must not be negative.");
  }

  get state(): SocketState {
    return this.#state;
  }

  get queuedMessages(): number {
    return this.#queue.length;
  }

  stats(): SocketStats {
    return {
      state: this.#state,
      connections: this.#connections,
      reconnects: this.#reconnects,
      sent: this.#sent,
      received: this.#received,
      queued: this.#queue.length,
    };
  }

  connect(): void {
    if (this.#state === "connecting" || this.#state === "open") return;
    this.#stopped = false;
    this.#open();
  }

  /** Closes deliberately. A deliberate close never reconnects. */
  close(code = 1000, reason = "closed by the application"): void {
    this.#stopped = true;
    this.#state = "closed";
    this.#socket?.close(code, reason);
    this.#socket = undefined;
  }

  /** Sends, queueing while disconnected if configured to. */
  send(data: string | ArrayBufferLike | ArrayBufferView): boolean {
    if (this.#state === "open" && this.#socket) {
      this.#socket.send(data);
      this.#sent += 1;
      return true;
    }
    if (!this.#options.queueWhileClosed) return false;
    this.#queue.push(data);
    // Bounded: an offline client must not grow this without limit. The oldest
    // goes first, because the newest message is the one still worth sending.
    while (this.#queue.length > this.#options.maxQueuedMessages) this.#queue.shift();
    return false;
  }

  #open(): void {
    this.#state = "connecting";
    let socket: SocketLike;
    try {
      socket = this.#factory(this.#url, this.#options.protocols);
    } catch (error) {
      this.#state = "failed";
      this.failed.emit(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    socket.binaryType = "arraybuffer";
    this.#socket = socket;

    socket.onopen = () => {
      this.#state = "open";
      this.#connections += 1;
      if (this.#retries > 0) this.#reconnects += 1;
      this.#retries = 0;
      // Flush what was queued while down, oldest first.
      const pending = this.#queue.splice(0, this.#queue.length);
      for (const message of pending) {
        socket.send(message);
        this.#sent += 1;
      }
      this.opened.emit();
    };

    socket.onmessage = (event) => {
      this.#received += 1;
      const data = event.data;
      if (typeof data === "string" || data instanceof ArrayBuffer) this.message.emit(data);
    };

    socket.onerror = () => {
      // `onerror` is always followed by `onclose`, so reconnection is handled
      // there; doing it in both would double every backoff.
    };

    socket.onclose = (event) => {
      this.#socket = undefined;
      this.closed.emit({ code: event.code, reason: event.reason, clean: event.wasClean });
      if (this.#stopped) {
        this.#state = "closed";
        return;
      }
      void this.#reconnect();
    };
  }

  async #reconnect(): Promise<void> {
    if (this.#retries >= this.#options.maxRetries) {
      this.#state = "failed";
      this.failed.emit(new Error(`Reconnecting to ${this.#url} gave up after ${this.#retries} attempts.`));
      return;
    }
    this.#retries += 1;
    this.#state = "connecting";
    const delay = Math.min(this.#options.maxDelayMs, this.#options.baseDelayMs * 2 ** (this.#retries - 1));
    await this.#sleep(delay);
    if (this.#stopped) return;
    this.#open();
  }
}
