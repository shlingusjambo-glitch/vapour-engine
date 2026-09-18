export type NetworkTransportState = "idle" | "connecting" | "connected" | "disconnecting" | "disconnected" | "failed";
export type NetworkPayload = string | ArrayBuffer | ArrayBufferView;
export interface NetworkMessage {
    readonly data: string | ArrayBuffer;
    readonly receivedAt: number;
}
export interface NetworkDisconnect {
    readonly code: number;
    readonly reason: string;
    readonly clean: boolean;
}
export interface NetworkTransport {
    readonly state: NetworkTransportState;
    readonly bufferedBytes: number;
    connect(): Promise<void>;
    disconnect(code?: number, reason?: string): void;
    send(payload: NetworkPayload): void;
    onMessage(listener: (message: NetworkMessage) => void): () => void;
    onDisconnect(listener: (event: NetworkDisconnect) => void): () => void;
}
interface WebSocketLike {
    binaryType: BinaryType;
    readonly readyState: number;
    readonly bufferedAmount: number;
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
export interface WebSocketTransportOptions {
    readonly protocols?: string | readonly string[];
    readonly connectTimeoutMs?: number;
    readonly maxBufferedBytes?: number;
    readonly socketFactory?: (url: string, protocols?: string | readonly string[]) => WebSocketLike;
    readonly now?: () => number;
}
/** Browser WebSocket transport with a strict lifecycle and send backpressure.
 * Handshakes, rooms, replication, and packet formats intentionally live above
 * this layer so games can use their own backend protocol. */
export declare class WebSocketTransport implements NetworkTransport {
    #private;
    constructor(url: string, options?: WebSocketTransportOptions);
    get state(): NetworkTransportState;
    get bufferedBytes(): number;
    connect(): Promise<void>;
    disconnect(code?: number, reason?: string): void;
    send(payload: NetworkPayload): void;
    onMessage(listener: (message: NetworkMessage) => void): () => void;
    onDisconnect(listener: (event: NetworkDisconnect) => void): () => void;
}
export interface Snapshot<T> {
    readonly serverTime: number;
    readonly value: T;
}
export interface SnapshotSample<T> {
    readonly from: T;
    readonly to: T;
    readonly alpha: number;
    readonly serverTime: number;
}
/** Bounded, timestamp-ordered interpolation buffer for transforms or arbitrary
 * replicated state. Late snapshots are inserted in order and duplicate times
 * replace older data, making unreliable/out-of-order transports usable. */
export declare class SnapshotBuffer<T> {
    #private;
    constructor(capacity?: number);
    get size(): number;
    get oldestTime(): number | undefined;
    get newestTime(): number | undefined;
    clear(): void;
    push(serverTime: number, value: T): void;
    sample(serverTime: number): SnapshotSample<T> | undefined;
    pruneBefore(serverTime: number): void;
}
export type NetworkAuthority = "server" | "owner" | "shared";
export interface NetworkIdentity {
    readonly entityId: string;
    readonly ownerId: string | undefined;
    readonly authority: NetworkAuthority;
}
export declare class NetworkAuthorityTable {
    #private;
    register(identity: NetworkIdentity): void;
    remove(entityId: string): boolean;
    identity(entityId: string): NetworkIdentity | undefined;
    canWrite(entityId: string, peerId: string, isServer?: boolean): boolean;
    transfer(entityId: string, ownerId: string): void;
}
export declare class NetworkRpcError extends Error {
    readonly code: string;
    readonly data: unknown;
    constructor(code: string, message: string, data?: unknown);
}
export interface RpcContext {
    readonly method: string;
    readonly requestId: string | undefined;
}
export interface RpcPeerOptions {
    readonly requestTimeoutMs?: number;
    readonly onError?: (error: unknown) => void;
}
type RpcHandler = (params: unknown, context: RpcContext) => unknown | Promise<unknown>;
/** JSON RPC routing over any Vapour transport. High-frequency snapshots should
 * use a game's compact binary codec; RPC is intended for commands, lobbies,
 * inventory operations, and other reliable control-plane messages. */
export declare class RpcPeer {
    #private;
    constructor(transport: NetworkTransport, options?: RpcPeerOptions);
    register(method: string, handler: RpcHandler): () => void;
    notify(method: string, params?: unknown): void;
    request<TResult = unknown>(method: string, params?: unknown): Promise<TResult>;
    close(): void;
}
export {};
//# sourceMappingURL=networking.d.ts.map