/** Browser WebSocket transport with a strict lifecycle and send backpressure.
 * Handshakes, rooms, replication, and packet formats intentionally live above
 * this layer so games can use their own backend protocol. */
export class WebSocketTransport {
    #url;
    #protocols;
    #timeoutMs;
    #maxBuffered;
    #factory;
    #now;
    #messages = new Set();
    #disconnects = new Set();
    #socket;
    #state = "idle";
    #connectPromise;
    constructor(url, options = {}) {
        this.#url = validateWebSocketUrl(url);
        this.#protocols = options.protocols;
        this.#timeoutMs = positive(options.connectTimeoutMs ?? 12_000, "WebSocket connect timeout");
        this.#maxBuffered = positive(options.maxBufferedBytes ?? 256 * 1024, "WebSocket maximum buffered bytes");
        this.#factory = options.socketFactory ?? ((address, protocols) => new WebSocket(address, protocols));
        this.#now = options.now ?? (() => performance.now());
    }
    get state() { return this.#state; }
    get bufferedBytes() { return this.#socket?.bufferedAmount ?? 0; }
    connect() {
        if (this.#state === "connected")
            return Promise.resolve();
        if (this.#connectPromise !== undefined)
            return this.#connectPromise;
        if (this.#state === "disconnecting")
            return Promise.reject(new Error(`Cannot connect to '${this.#url}' while disconnecting.`));
        this.#state = "connecting";
        this.#connectPromise = new Promise((resolve, reject) => {
            let settled = false;
            let socket;
            try {
                socket = this.#factory(this.#url, this.#protocols);
            }
            catch (error) {
                this.#state = "failed";
                this.#connectPromise = undefined;
                reject(new Error(`Could not create WebSocket for '${this.#url}': ${message(error)}`, { cause: error }));
                return;
            }
            this.#socket = socket;
            socket.binaryType = "arraybuffer";
            const timeout = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                this.#state = "failed";
                socket.close(4000, "Connection timeout");
                this.#connectPromise = undefined;
                reject(new Error(`WebSocket connection to '${this.#url}' timed out after ${String(this.#timeoutMs)}ms.`));
            }, this.#timeoutMs);
            socket.onopen = () => { if (settled)
                return; settled = true; clearTimeout(timeout); this.#state = "connected"; this.#connectPromise = undefined; resolve(); };
            socket.onerror = () => { if (settled)
                return; settled = true; clearTimeout(timeout); this.#state = "failed"; this.#connectPromise = undefined; reject(new Error(`WebSocket connection to '${this.#url}' failed. Browsers hide low-level socket details; verify the address, TLS policy, and server availability.`)); };
            socket.onmessage = (event) => {
                const data = normalizeMessage(event.data);
                const received = Object.freeze({ data, receivedAt: this.#now() });
                for (const listener of this.#messages)
                    listener(received);
            };
            socket.onclose = (event) => {
                clearTimeout(timeout);
                this.#socket = undefined;
                this.#connectPromise = undefined;
                const wasConnecting = this.#state === "connecting";
                this.#state = event.wasClean ? "disconnected" : "failed";
                if (wasConnecting && !settled) {
                    settled = true;
                    reject(new Error(`WebSocket '${this.#url}' closed before connecting (code ${String(event.code)}${event.reason === "" ? "" : `: ${event.reason}`}).`));
                }
                const detail = Object.freeze({ code: event.code, reason: event.reason, clean: event.wasClean });
                for (const listener of this.#disconnects)
                    listener(detail);
            };
        });
        return this.#connectPromise;
    }
    disconnect(code = 1000, reason = "Client disconnect") {
        if (!Number.isInteger(code) || code < 1000 || code > 4999)
            throw new Error("WebSocket close code must be an integer from 1000 through 4999.");
        if (new TextEncoder().encode(reason).byteLength > 123)
            throw new Error("WebSocket close reason cannot exceed 123 UTF-8 bytes.");
        if (this.#socket === undefined) {
            this.#state = "disconnected";
            return;
        }
        this.#state = "disconnecting";
        this.#socket.close(code, reason);
    }
    send(payload) {
        const socket = this.#socket;
        if (this.#state !== "connected" || socket === undefined || socket.readyState !== 1)
            throw new Error(`Cannot send through WebSocket '${this.#url}' while transport state is '${this.#state}'.`);
        const bytes = payloadBytes(payload);
        if (socket.bufferedAmount + bytes > this.#maxBuffered)
            throw new Error(`WebSocket '${this.#url}' backpressure limit exceeded: ${String(socket.bufferedAmount)} buffered + ${String(bytes)} new bytes exceeds ${String(this.#maxBuffered)}. Drop low-priority state or retry after the buffer drains.`);
        socket.send(payload);
    }
    onMessage(listener) { this.#messages.add(listener); return () => this.#messages.delete(listener); }
    onDisconnect(listener) { this.#disconnects.add(listener); return () => this.#disconnects.delete(listener); }
}
/** Bounded, timestamp-ordered interpolation buffer for transforms or arbitrary
 * replicated state. Late snapshots are inserted in order and duplicate times
 * replace older data, making unreliable/out-of-order transports usable. */
export class SnapshotBuffer {
    #capacity;
    #snapshots = [];
    constructor(capacity = 32) { if (!Number.isInteger(capacity) || capacity < 2)
        throw new Error("Snapshot buffer capacity must be an integer of at least 2."); this.#capacity = capacity; }
    get size() { return this.#snapshots.length; }
    get oldestTime() { return this.#snapshots[0]?.serverTime; }
    get newestTime() { return this.#snapshots.at(-1)?.serverTime; }
    clear() { this.#snapshots.length = 0; }
    push(serverTime, value) {
        if (!Number.isFinite(serverTime))
            throw new Error("Snapshot server time must be finite.");
        const index = lowerBound(this.#snapshots, serverTime);
        const snapshot = Object.freeze({ serverTime, value });
        if (this.#snapshots[index]?.serverTime === serverTime)
            this.#snapshots[index] = snapshot;
        else
            this.#snapshots.splice(index, 0, snapshot);
        while (this.#snapshots.length > this.#capacity)
            this.#snapshots.shift();
    }
    sample(serverTime) {
        if (!Number.isFinite(serverTime))
            throw new Error("Snapshot sample time must be finite.");
        if (this.#snapshots.length === 0)
            return undefined;
        const index = lowerBound(this.#snapshots, serverTime);
        if (index === 0) {
            const first = this.#snapshots[0];
            return Object.freeze({ from: first.value, to: first.value, alpha: 0, serverTime });
        }
        if (index >= this.#snapshots.length) {
            const last = this.#snapshots.at(-1);
            return Object.freeze({ from: last.value, to: last.value, alpha: 0, serverTime });
        }
        const from = this.#snapshots[index - 1], to = this.#snapshots[index];
        return Object.freeze({ from: from.value, to: to.value, alpha: (serverTime - from.serverTime) / (to.serverTime - from.serverTime), serverTime });
    }
    pruneBefore(serverTime) { while (this.#snapshots.length > 2 && this.#snapshots[1].serverTime <= serverTime)
        this.#snapshots.shift(); }
}
export class NetworkAuthorityTable {
    #entities = new Map();
    register(identity) { const id = identity.entityId.trim(); if (id === "")
        throw new Error("Network entity IDs cannot be empty."); if (this.#entities.has(id))
        throw new Error(`Duplicate network entity '${id}'.`); if (identity.authority === "owner" && !identity.ownerId)
        throw new Error(`Owner-authoritative entity '${id}' requires an ownerId.`); this.#entities.set(id, Object.freeze({ ...identity, entityId: id })); }
    remove(entityId) { return this.#entities.delete(entityId); }
    identity(entityId) { return this.#entities.get(entityId); }
    canWrite(entityId, peerId, isServer = false) { const identity = this.#entities.get(entityId); if (identity === undefined)
        throw new Error(`Unknown network entity '${entityId}'.`); return identity.authority === "shared" || (identity.authority === "server" ? isServer : identity.ownerId === peerId); }
    transfer(entityId, ownerId) { const current = this.#entities.get(entityId); if (current === undefined)
        throw new Error(`Unknown network entity '${entityId}'.`); if (current.authority !== "owner")
        throw new Error(`Network entity '${entityId}' is '${current.authority}' authoritative and cannot transfer ownership.`); if (ownerId.trim() === "")
        throw new Error("Network owner IDs cannot be empty."); this.#entities.set(entityId, Object.freeze({ ...current, ownerId })); }
}
export class NetworkRpcError extends Error {
    code;
    data;
    constructor(code, message, data) { super(message); this.name = "NetworkRpcError"; this.code = code; this.data = data; }
}
/** JSON RPC routing over any Vapour transport. High-frequency snapshots should
 * use a game's compact binary codec; RPC is intended for commands, lobbies,
 * inventory operations, and other reliable control-plane messages. */
export class RpcPeer {
    #transport;
    #timeoutMs;
    #onError;
    #handlers = new Map();
    #pending = new Map();
    #detach;
    #nextId = 1;
    #closed = false;
    constructor(transport, options = {}) {
        this.#transport = transport;
        this.#timeoutMs = positive(options.requestTimeoutMs ?? 10_000, "RPC request timeout");
        this.#onError = options.onError;
        this.#detach = transport.onMessage((message) => { if (typeof message.data === "string")
            void this.#receive(message.data).catch((error) => this.#report(error)); });
    }
    register(method, handler) { const name = rpcMethod(method); if (this.#handlers.has(name))
        throw new Error(`RPC method '${name}' is already registered.`); this.#handlers.set(name, handler); return () => this.#handlers.delete(name); }
    notify(method, params) { this.#requireOpen(); this.#send({ v: 1, type: "notify", method: rpcMethod(method), params: params ?? null }); }
    request(method, params) {
        this.#requireOpen();
        const name = rpcMethod(method);
        const id = String(this.#nextId++);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { this.#pending.delete(id); reject(new NetworkRpcError("TIMEOUT", `RPC '${name}' timed out after ${String(this.#timeoutMs)}ms.`)); }, this.#timeoutMs);
            this.#pending.set(id, { resolve: (value) => resolve(value), reject, timeout });
            try {
                this.#send({ v: 1, type: "request", id, method: name, params: params ?? null });
            }
            catch (error) {
                clearTimeout(timeout);
                this.#pending.delete(id);
                reject(error);
            }
        });
    }
    close() { if (this.#closed)
        return; this.#closed = true; this.#detach(); for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new NetworkRpcError("CLOSED", "RPC peer closed before the request completed."));
    } this.#pending.clear(); }
    async #receive(text) {
        let value;
        try {
            value = JSON.parse(text);
        }
        catch (error) {
            throw new NetworkRpcError("INVALID_JSON", `Received malformed RPC JSON: ${message(error)}`);
        }
        if (!isEnvelope(value))
            throw new NetworkRpcError("INVALID_ENVELOPE", "Received JSON that is not a Vapour RPC v1 envelope.", value);
        if (value.type === "result" || value.type === "error") {
            const pending = this.#pending.get(value.id);
            if (pending === undefined)
                throw new NetworkRpcError("UNKNOWN_RESPONSE", `Received RPC response for unknown request '${value.id}'.`);
            clearTimeout(pending.timeout);
            this.#pending.delete(value.id);
            if (value.type === "result")
                pending.resolve(value.result);
            else
                pending.reject(new NetworkRpcError(value.error.code, value.error.message, value.error.data));
            return;
        }
        const handler = this.#handlers.get(value.method);
        if (handler === undefined) {
            if (value.type === "request")
                this.#send({ v: 1, type: "error", id: value.id, error: { code: "METHOD_NOT_FOUND", message: `RPC method '${value.method}' is not registered.` } });
            return;
        }
        try {
            const result = await handler(value.params, { method: value.method, requestId: value.type === "request" ? value.id : undefined });
            if (value.type === "request")
                this.#send({ v: 1, type: "result", id: value.id, result: result ?? null });
        }
        catch (error) {
            if (value.type === "request")
                this.#send({ v: 1, type: "error", id: value.id, error: { code: error instanceof NetworkRpcError ? error.code : "HANDLER_FAILED", message: message(error), ...(error instanceof NetworkRpcError && error.data !== undefined ? { data: error.data } : {}) } });
            else
                this.#report(error);
        }
    }
    #send(envelope) { let encoded; try {
        encoded = JSON.stringify(envelope);
    }
    catch (error) {
        throw new NetworkRpcError("NOT_SERIALIZABLE", `RPC payload is not JSON serializable: ${message(error)}`);
    } this.#transport.send(encoded); }
    #requireOpen() { if (this.#closed)
        throw new NetworkRpcError("CLOSED", "RPC peer is closed."); }
    #report(error) { if (this.#onError !== undefined)
        this.#onError(error);
    else
        console.error("Vapour RPC error:", error); }
}
function validateWebSocketUrl(value) { let url; try {
    url = new URL(value);
}
catch {
    throw new Error(`Invalid WebSocket URL '${value}'. Expected ws:// or wss://.`);
} if (url.protocol !== "ws:" && url.protocol !== "wss:")
    throw new Error(`Invalid WebSocket URL '${value}'. Expected ws:// or wss://.`); return url.href; }
function positive(value, label) { if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be finite and positive.`); return value; }
function payloadBytes(payload) { return typeof payload === "string" ? new TextEncoder().encode(payload).byteLength : ArrayBuffer.isView(payload) ? payload.byteLength : payload.byteLength; }
function normalizeMessage(data) { if (typeof data === "string" || data instanceof ArrayBuffer)
    return data; if (ArrayBuffer.isView(data))
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); throw new Error(`WebSocket delivered unsupported message data '${Object.prototype.toString.call(data)}'. Configure binaryType='arraybuffer'.`); }
function message(error) { return error instanceof Error ? error.message : String(error); }
function lowerBound(items, time) { let low = 0, high = items.length; while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle].serverTime < time)
        low = middle + 1;
    else
        high = middle;
} return low; }
function rpcMethod(value) { const name = value.trim(); if (name === "" || !/^[A-Za-z][A-Za-z0-9_.:/-]*$/.test(name))
    throw new Error(`Invalid RPC method '${value}'. Use a non-empty namespaced identifier.`); return name; }
function isEnvelope(value) { if (typeof value !== "object" || value === null)
    return false; const record = value; if (record.v !== 1 || typeof record.type !== "string")
    return false; if (record.type === "request")
    return typeof record.id === "string" && typeof record.method === "string" && "params" in record; if (record.type === "notify")
    return typeof record.method === "string" && "params" in record; if (record.type === "result")
    return typeof record.id === "string" && "result" in record; if (record.type === "error") {
    const error = record.error;
    return typeof record.id === "string" && typeof error?.code === "string" && typeof error.message === "string";
} return false; }
//# sourceMappingURL=networking.js.map