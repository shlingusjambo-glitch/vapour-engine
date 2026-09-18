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
/** A WebSocket that reconnects with exponential backoff. */
export class ReconnectingSocket {
    opened = new Signal();
    closed = new Signal();
    message = new Signal();
    failed = new Signal();
    #url;
    #options;
    #factory;
    #sleep;
    #queue = [];
    #socket;
    #state = "idle";
    #retries = 0;
    #connections = 0;
    #reconnects = 0;
    #sent = 0;
    #received = 0;
    #stopped = false;
    constructor(url, options = {}) {
        if (!/^wss?:\/\//i.test(url))
            throw new Error(`A socket URL must start with ws:// or wss:// (got "${url}").`);
        const factory = options.socketFactory ?? ((address, protocols) => new WebSocket(address, protocols));
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
        if (!(this.#options.baseDelayMs >= 0))
            throw new Error("A socket base delay must not be negative.");
        if (!(this.#options.maxQueuedMessages >= 0))
            throw new Error("A socket queue limit must not be negative.");
    }
    get state() {
        return this.#state;
    }
    get queuedMessages() {
        return this.#queue.length;
    }
    stats() {
        return {
            state: this.#state,
            connections: this.#connections,
            reconnects: this.#reconnects,
            sent: this.#sent,
            received: this.#received,
            queued: this.#queue.length,
        };
    }
    connect() {
        if (this.#state === "connecting" || this.#state === "open")
            return;
        this.#stopped = false;
        this.#open();
    }
    /** Closes deliberately. A deliberate close never reconnects. */
    close(code = 1000, reason = "closed by the application") {
        this.#stopped = true;
        this.#state = "closed";
        this.#socket?.close(code, reason);
        this.#socket = undefined;
    }
    /** Sends, queueing while disconnected if configured to. */
    send(data) {
        if (this.#state === "open" && this.#socket) {
            this.#socket.send(data);
            this.#sent += 1;
            return true;
        }
        if (!this.#options.queueWhileClosed)
            return false;
        this.#queue.push(data);
        // Bounded: an offline client must not grow this without limit. The oldest
        // goes first, because the newest message is the one still worth sending.
        while (this.#queue.length > this.#options.maxQueuedMessages)
            this.#queue.shift();
        return false;
    }
    #open() {
        this.#state = "connecting";
        let socket;
        try {
            socket = this.#factory(this.#url, this.#options.protocols);
        }
        catch (error) {
            this.#state = "failed";
            this.failed.emit(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        socket.binaryType = "arraybuffer";
        this.#socket = socket;
        socket.onopen = () => {
            this.#state = "open";
            this.#connections += 1;
            if (this.#retries > 0)
                this.#reconnects += 1;
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
            if (typeof data === "string" || data instanceof ArrayBuffer)
                this.message.emit(data);
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
    async #reconnect() {
        if (this.#retries >= this.#options.maxRetries) {
            this.#state = "failed";
            this.failed.emit(new Error(`Reconnecting to ${this.#url} gave up after ${this.#retries} attempts.`));
            return;
        }
        this.#retries += 1;
        this.#state = "connecting";
        const delay = Math.min(this.#options.maxDelayMs, this.#options.baseDelayMs * 2 ** (this.#retries - 1));
        await this.#sleep(delay);
        if (this.#stopped)
            return;
        this.#open();
    }
}
//# sourceMappingURL=socket.js.map