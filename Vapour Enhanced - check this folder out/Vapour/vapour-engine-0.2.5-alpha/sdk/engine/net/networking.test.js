import { describe, expect, it, vi } from "vitest";
import { NetworkAuthorityTable, RpcPeer, SnapshotBuffer, WebSocketTransport } from "./networking.js";
class FakeSocket {
    binaryType = "blob";
    readyState = 0;
    bufferedAmount = 0;
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;
    sent = [];
    send(data) { this.sent.push(data); }
    close(code = 1000, reason = "") { this.readyState = 3; this.onclose?.({ code, reason, wasClean: code === 1000 }); }
    open() { this.readyState = 1; this.onopen?.(); }
}
describe("WebSocketTransport", () => {
    it("connects, timestamps messages, sends, and disconnects", async () => {
        const socket = new FakeSocket();
        const transport = new WebSocketTransport("ws://localhost:8080/game", { socketFactory: () => socket, now: () => 123, connectTimeoutMs: 100 });
        const connecting = transport.connect();
        socket.open();
        await connecting;
        const messages = vi.fn();
        const disconnected = vi.fn();
        transport.onMessage(messages);
        transport.onDisconnect(disconnected);
        socket.onmessage?.({ data: new Uint8Array([1, 2, 3]) });
        transport.send("hello");
        transport.disconnect();
        expect(messages.mock.calls[0][0]).toMatchObject({ receivedAt: 123 });
        expect(new Uint8Array(messages.mock.calls[0][0].data)).toEqual(new Uint8Array([1, 2, 3]));
        expect(socket.sent).toEqual(["hello"]);
        expect(disconnected).toHaveBeenCalledWith({ code: 1000, reason: "Client disconnect", clean: true });
    });
    it("reports state and backpressure instead of silently dropping packets", async () => {
        const socket = new FakeSocket();
        const transport = new WebSocketTransport("wss://example.test", { socketFactory: () => socket, maxBufferedBytes: 10 });
        expect(() => transport.send("early")).toThrow("state is 'idle'");
        const connecting = transport.connect();
        socket.open();
        await connecting;
        socket.bufferedAmount = 8;
        expect(() => transport.send("123")).toThrow("backpressure limit exceeded");
    });
    it("validates addresses", () => expect(() => new WebSocketTransport("https://example.test")).toThrow("Expected ws:// or wss://"));
});
describe("SnapshotBuffer", () => {
    it("orders late snapshots, replaces duplicates, and interpolates", () => {
        const buffer = new SnapshotBuffer(3);
        buffer.push(20, { x: 20 });
        buffer.push(0, { x: 0 });
        buffer.push(10, { x: 10 });
        buffer.push(10, { x: 11 });
        expect(buffer.sample(5)).toMatchObject({ from: { x: 0 }, to: { x: 11 }, alpha: 0.5 });
        buffer.push(30, { x: 30 });
        expect(buffer.oldestTime).toBe(10);
        expect(buffer.sample(100)).toMatchObject({ from: { x: 30 }, to: { x: 30 }, alpha: 0 });
    });
});
describe("NetworkAuthorityTable", () => {
    it("enforces server, owner, and shared write rules", () => {
        const table = new NetworkAuthorityTable();
        table.register({ entityId: "player", ownerId: "peer-a", authority: "owner" });
        table.register({ entityId: "clock", ownerId: undefined, authority: "server" });
        table.register({ entityId: "chat", ownerId: undefined, authority: "shared" });
        expect(table.canWrite("player", "peer-a")).toBe(true);
        expect(table.canWrite("player", "peer-b")).toBe(false);
        expect(table.canWrite("clock", "peer-a", true)).toBe(true);
        expect(table.canWrite("chat", "any")).toBe(true);
        table.transfer("player", "peer-b");
        expect(table.canWrite("player", "peer-b")).toBe(true);
    });
});
class PairedTransport {
    state = "connected";
    bufferedBytes = 0;
    peer;
    messages = new Set();
    disconnects = new Set();
    async connect() { }
    disconnect() { this.state = "disconnected"; }
    send(payload) { if (typeof payload !== "string")
        throw new Error("test expects JSON"); queueMicrotask(() => { for (const listener of this.peer.messages)
        listener({ data: payload, receivedAt: 0 }); }); }
    onMessage(listener) { this.messages.add(listener); return () => this.messages.delete(listener); }
    onDisconnect(listener) { this.disconnects.add(listener); return () => this.disconnects.delete(listener); }
}
describe("RpcPeer", () => {
    it("routes requests, results, notifications, and remote errors", async () => {
        const aTransport = new PairedTransport(), bTransport = new PairedTransport();
        aTransport.peer = bTransport;
        bTransport.peer = aTransport;
        const errors = vi.fn();
        const a = new RpcPeer(aTransport, { onError: errors }), b = new RpcPeer(bTransport);
        b.register("math.add", (params) => { const values = params; return values[0] + values[1]; });
        expect(await a.request("math.add", [2, 5])).toBe(7);
        const notice = vi.fn();
        b.register("chat.message", notice);
        a.notify("chat.message", { text: "hi" });
        await new Promise((resolve) => queueMicrotask(resolve));
        expect(notice).toHaveBeenCalledWith({ text: "hi" }, { method: "chat.message", requestId: undefined });
        await expect(a.request("missing.method")).rejects.toMatchObject({ code: "METHOD_NOT_FOUND" });
        expect(errors).not.toHaveBeenCalled();
        a.close();
        b.close();
    });
});
//# sourceMappingURL=networking.test.js.map