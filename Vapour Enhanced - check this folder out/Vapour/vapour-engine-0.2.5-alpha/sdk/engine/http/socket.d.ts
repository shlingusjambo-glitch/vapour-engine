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
    onmessage: ((event: {
        data: unknown;
    }) => void) | null;
    onerror: (() => void) | null;
    onclose: ((event: {
        code: number;
        reason: string;
        wasClean: boolean;
    }) => void) | null;
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
export declare class ReconnectingSocket {
    #private;
    readonly opened: Signal<void>;
    readonly closed: Signal<{
        code: number;
        reason: string;
        clean: boolean;
    }>;
    readonly message: Signal<string | ArrayBuffer>;
    readonly failed: Signal<Error>;
    constructor(url: string, options?: ReconnectingSocketOptions);
    get state(): SocketState;
    get queuedMessages(): number;
    stats(): SocketStats;
    connect(): void;
    /** Closes deliberately. A deliberate close never reconnects. */
    close(code?: number, reason?: string): void;
    /** Sends, queueing while disconnected if configured to. */
    send(data: string | ArrayBufferLike | ArrayBufferView): boolean;
}
//# sourceMappingURL=socket.d.ts.map