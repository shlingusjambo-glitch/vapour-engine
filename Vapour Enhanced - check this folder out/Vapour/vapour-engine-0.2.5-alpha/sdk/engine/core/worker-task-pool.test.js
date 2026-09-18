import { describe, expect, it, vi } from "vitest";
import { WorkerTaskPool } from "./worker-task-pool.js";
class FakeWorker {
    onmessage = null;
    onerror = null;
    posted = [];
    terminated = false;
    postMessage(message, transfer) {
        this.posted.push(transfer === undefined ? { message } : { message, transfer });
    }
    terminate() { this.terminated = true; }
    respond(message) { this.onmessage?.({ data: message }); }
}
describe("WorkerTaskPool", () => {
    it("waits for initialization, runs one job per worker, and applies FIFO backpressure", async () => {
        const workers = [new FakeWorker(), new FakeWorker()];
        const responses = [];
        const pool = new WorkerTaskPool({
            size: 2,
            createWorker: (index) => workers[index],
            initialize: (worker) => worker.postMessage("init"),
            isReady: (message) => message === "ready",
            onReady: (worker) => worker.postMessage("registry"),
            onResponse: async (message) => { responses.push(message); },
        });
        pool.submit("a");
        pool.submit("b");
        pool.submit("c");
        expect(pool.stats()).toMatchObject({ initializing: 2, active: 0, queued: 3 });
        workers[0].respond("ready");
        workers[1].respond("ready");
        expect(workers[0].posted.map((entry) => entry.message)).toEqual(["init", "registry", "a"]);
        expect(workers[1].posted.map((entry) => entry.message)).toEqual(["init", "registry", "b"]);
        workers[0].respond("a-done");
        await Promise.resolve();
        expect(workers[0].posted.at(-1)?.message).toBe("c");
        expect(responses).toEqual(["a-done"]);
        pool.destroy();
        expect(workers.every((worker) => worker.terminated)).toBe(true);
    });
    it("uses transfer lists and keeps healthy workers scheduling after one fails", () => {
        const workers = [new FakeWorker(), new FakeWorker()];
        const errors = vi.fn();
        const buffer = new ArrayBuffer(4);
        const pool = new WorkerTaskPool({
            size: 2,
            createWorker: (index) => workers[index],
            onResponse: () => { },
            onError: errors,
            transfer: (request) => request === "binary" ? [buffer] : undefined,
        });
        pool.submit("binary");
        pool.submit("next");
        expect(workers[0].posted[0]).toEqual({ message: "binary", transfer: [buffer] });
        workers[0].onerror?.({ message: "boom" });
        expect(errors).toHaveBeenCalledOnce();
        expect(errors.mock.calls[0]?.[2]).toBe("binary");
        workers[1].respond("done");
        expect(pool.stats().failed).toBe(1);
    });
    it("rejects incomplete initialization contracts", () => {
        expect(() => new WorkerTaskPool({
            size: 1,
            createWorker: () => new FakeWorker(),
            initialize: () => { },
            onResponse: () => { },
        })).toThrow(/readiness detection/);
    });
    it("cancels queued work without terminating an active task", () => {
        const worker = new FakeWorker();
        const pool = new WorkerTaskPool({
            size: 1,
            createWorker: () => worker,
            onResponse: () => { },
        });
        pool.submit("active");
        pool.submit("stale-a");
        pool.submit("stale-b");
        expect(pool.clearQueued()).toBe(2);
        expect(pool.stats()).toMatchObject({ active: 1, queued: 0 });
    });
});
//# sourceMappingURL=worker-task-pool.test.js.map