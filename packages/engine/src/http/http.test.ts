import { describe, expect, it, vi } from "vitest";
import { HttpClient, HttpError, ReconnectingSocket, type FetchLike, type SocketLike } from "./index.js";

/** Builds a Response with a JSON body. */
function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A fetch stub that records calls and replies from a queue. */
function stubFetch(replies: (Response | Error)[] | ((url: string, init: RequestInit) => Response | Error)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = Array.isArray(replies) ? [...replies] : undefined;
  const handler: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const reply = queue ? (queue.shift() ?? new Response("", { status: 200 })) : (replies as (u: string, i: RequestInit) => Response | Error)(url, init);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { fetch: handler, calls };
}

const noSleep = async (): Promise<void> => undefined;

describe("HttpClient requests", () => {
  it("parses a JSON response", async () => {
    const { fetch } = stubFetch([json({ score: 42 })]);
    const client = new HttpClient({ fetch });
    const response = await client.get<{ score: number }>("https://example.test/scores");
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.data.score).toBe(42);
    expect(response.attempts).toBe(1);
  });

  it("returns a failing status as a value, not an exception", async () => {
    // A 404 is a normal outcome of asking for something; making it throw forces
    // a try/catch around every call site.
    const { fetch } = stubFetch([json({ error: "missing" }, 404)]);
    const client = new HttpClient({ fetch });
    const response = await client.get("https://example.test/nope");
    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
    expect(response.data).toEqual({ error: "missing" });
  });

  it("sends every verb", async () => {
    const { fetch, calls } = stubFetch(() => new Response("", { status: 200 }));
    const client = new HttpClient({ fetch });
    await client.get("https://x.test/a");
    await client.post("https://x.test/a");
    await client.put("https://x.test/a");
    await client.patch("https://x.test/a");
    await client.delete("https://x.test/a");
    expect(calls.map((call) => call.init.method)).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  });

  it("sends JSON bodies with a content type", async () => {
    const { fetch, calls } = stubFetch([new Response("", { status: 201 })]);
    const client = new HttpClient({ fetch });
    await client.post("https://x.test/a", { json: { name: "Ana" } });
    expect(calls[0]!.init.body).toBe(JSON.stringify({ name: "Ana" }));
    expect((calls[0]!.init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("refuses both a body and json", async () => {
    const client = new HttpClient({ fetch: stubFetch([]).fetch });
    await expect(client.post("https://x.test/a", { body: "raw", json: {} })).rejects.toThrow(/cannot have both/);
  });

  it("does not set a content type for FormData, which supplies its own boundary", async () => {
    const { fetch, calls } = stubFetch([new Response("", { status: 200 })]);
    const client = new HttpClient({ fetch, headers: { "content-type": "text/plain" } });
    const form = new FormData();
    form.set("file", "contents");
    await client.post("https://x.test/upload", { body: form });
    expect((calls[0]!.init.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });

  it("joins a base URL and leaves absolute URLs alone", async () => {
    const { fetch, calls } = stubFetch(() => new Response("", { status: 200 }));
    const client = new HttpClient({ fetch, baseUrl: "https://api.test/v1/" });
    await client.get("/scores");
    await client.get("https://other.test/thing");
    expect(calls[0]!.url).toBe("https://api.test/v1/scores");
    expect(calls[1]!.url).toBe("https://other.test/thing");
  });

  it("appends query parameters and omits undefined ones", async () => {
    const { fetch, calls } = stubFetch(() => new Response("", { status: 200 }));
    const client = new HttpClient({ fetch });
    await client.get("https://x.test/a?existing=1", { query: { page: 2, live: true, filter: undefined } });
    expect(calls[0]!.url).toBe("https://x.test/a?existing=1&page=2&live=true");
  });

  it("merges client and per-request headers, request winning", async () => {
    const { fetch, calls } = stubFetch(() => new Response("", { status: 200 }));
    const client = new HttpClient({ fetch, headers: { authorization: "Bearer base", "x-app": "vapour" } });
    await client.get("https://x.test/a", { headers: { Authorization: "Bearer override" } });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer override");
    expect(headers["x-app"]).toBe("vapour");
  });

  it("runs a beforeRequest hook, which is where auth belongs", async () => {
    const { fetch, calls } = stubFetch(() => new Response("", { status: 200 }));
    const client = new HttpClient({
      fetch,
      beforeRequest: (_url, init) => {
        (init.headers as Record<string, string>)["x-token"] = "fresh";
      },
    });
    await client.get("https://x.test/a");
    expect((calls[0]!.init.headers as Record<string, string>)["x-token"]).toBe("fresh");
  });
});

describe("HttpClient bodies", () => {
  it("reads text, binary, and empty bodies", async () => {
    const client = new HttpClient({
      fetch: stubFetch([
        new Response("plain", { status: 200, headers: { "content-type": "text/plain" } }),
        new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/octet-stream" } }),
        new Response(null, { status: 204 }),
      ]).fetch,
    });
    expect((await client.get<string>("https://x.test/text")).data).toBe("plain");
    expect((await client.binary("https://x.test/bin")).data.byteLength).toBe(3);
    expect((await client.get("https://x.test/none")).data).toBeUndefined();
  });

  it("treats an empty JSON body as no data rather than a parse failure", async () => {
    const client = new HttpClient({ fetch: stubFetch([new Response("", { status: 200, headers: { "content-type": "application/json" } })]).fetch });
    expect((await client.get("https://x.test/a")).data).toBeUndefined();
  });

  it("reports malformed JSON with the URL and a parse kind", async () => {
    const malformed = (): Response => new Response("{oops", { status: 200, headers: { "content-type": "application/json" } });
    const client = new HttpClient({ fetch: stubFetch([malformed(), malformed()]).fetch });
    await expect(client.get("https://x.test/a")).rejects.toMatchObject({ kind: "parse" });
    await expect(client.get("https://x.test/a")).rejects.toThrow(/not valid JSON/);
  });

  it("reports download progress", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    const client = new HttpClient({
      fetch: stubFetch([new Response(body, { status: 200, headers: { "content-type": "text/plain", "content-length": "10" } })]).fetch,
    });
    const seen: number[] = [];
    await client.get("https://x.test/big", { onProgress: (progress) => seen.push(progress.fraction ?? -1) });
    expect(seen).toEqual([0.4, 1]);
  });

  it("reports progress without a total when the server does not say", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    });
    const client = new HttpClient({ fetch: stubFetch([new Response(body, { status: 200, headers: { "content-type": "text/plain" } })]).fetch });
    const seen: (number | undefined)[] = [];
    await client.get("https://x.test/big", { onProgress: (progress) => seen.push(progress.total) });
    expect(seen).toEqual([undefined]);
  });
});

describe("HttpClient retries", () => {
  it("retries a 500 and succeeds", async () => {
    const { fetch, calls } = stubFetch([json({}, 500), json({}, 503), json({ ok: true })]);
    const client = new HttpClient({ fetch, sleep: noSleep });
    const response = await client.get<{ ok: boolean }>("https://x.test/a", { retry: { attempts: 3 } });
    expect(response.status).toBe(200);
    expect(response.attempts).toBe(3);
    expect(calls).toHaveLength(3);
    expect(client.stats().retries).toBe(2);
  });

  it("does not retry a 400, which would fail identically every time", async () => {
    const { fetch, calls } = stubFetch([json({}, 400), json({ ok: true })]);
    const client = new HttpClient({ fetch, sleep: noSleep });
    const response = await client.get("https://x.test/a", { retry: { attempts: 3 } });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("retries 429 as well as 5xx", async () => {
    const { fetch, calls } = stubFetch([json({}, 429), json({ ok: true })]);
    const client = new HttpClient({ fetch, sleep: noSleep });
    await client.get("https://x.test/a", { retry: { attempts: 2 } });
    expect(calls).toHaveLength(2);
  });

  it("backs off exponentially, capped", async () => {
    const delays: number[] = [];
    const { fetch } = stubFetch([json({}, 500), json({}, 500), json({}, 500), json({ ok: true })]);
    const client = new HttpClient({ fetch, sleep: async (ms) => { delays.push(ms); } });
    await client.get("https://x.test/a", { retry: { attempts: 3, baseDelayMs: 100, maxDelayMs: 250 } });
    // A fixed delay hammers a struggling server; an uncapped one arrives late.
    expect(delays).toEqual([100, 200, 250]);
  });

  it("retries a network fault and eventually reports it", async () => {
    const { fetch, calls } = stubFetch([new Error("connection reset"), new Error("connection reset")]);
    const client = new HttpClient({ fetch, sleep: noSleep });
    await expect(client.get("https://x.test/a", { retry: { attempts: 1 } })).rejects.toMatchObject({ kind: "network" });
    expect(calls).toHaveLength(2);
    expect(client.stats().failures).toBe(1);
  });

  it("gives up after exhausting its attempts", async () => {
    const { fetch, calls } = stubFetch([json({}, 500), json({}, 500), json({}, 500)]);
    const client = new HttpClient({ fetch, sleep: noSleep });
    const response = await client.get("https://x.test/a", { retry: { attempts: 2 } });
    expect(response.status).toBe(500);
    expect(calls).toHaveLength(3);
  });

  it("validates retry options", async () => {
    const client = new HttpClient({ fetch: stubFetch([]).fetch });
    await expect(client.get("https://x.test/a", { retry: { attempts: -1 } })).rejects.toThrow(/non-negative whole number/);
    await expect(client.get("https://x.test/a", { retry: { baseDelayMs: -1 } })).rejects.toThrow(/must not be negative/);
  });
});

describe("HttpClient cancellation and timeouts", () => {
  it("times out a request that never completes", async () => {
    const client = new HttpClient({
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
      sleep: noSleep,
    });
    await expect(client.get("https://x.test/slow", { timeoutMs: 5 })).rejects.toMatchObject({ kind: "timeout" });
    await expect(client.get("https://x.test/slow", { timeoutMs: 5 })).rejects.toThrow(/timed out after 5ms/);
  });

  it("is cancelled by a caller signal, and never retries a cancellation", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const client = new HttpClient({
      fetch: (_url, init) => {
        attempts += 1;
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
      sleep: noSleep,
    });
    const pending = client.get("https://x.test/slow", { signal: controller.signal, retry: { attempts: 3 }, timeoutMs: 0 });
    controller.abort(new Error("user left"));
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    // Despite a budget of three retries, cancellation is deliberate and is
    // never retried. Zero dispatches here, because the cancel beat the fetch.
    expect(attempts).toBeLessThanOrEqual(1);
  });

  it("rejects immediately when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new HttpClient({ fetch: stubFetch([]).fetch });
    await expect(client.get("https://x.test/a", { signal: controller.signal })).rejects.toThrow(/cancelled before it started/);
  });

  it("validates its construction and timeouts", async () => {
    expect(() => new HttpClient({ fetch: stubFetch([]).fetch, timeoutMs: -1 })).toThrow(/must not be negative/);
    const client = new HttpClient({ fetch: stubFetch([]).fetch });
    await expect(client.get("https://x.test/a", { timeoutMs: -1 })).rejects.toThrow(/must not be negative/);
  });

  it("reports statistics", async () => {
    const { fetch } = stubFetch([json({ a: 1 }), json({ b: 2 })]);
    const client = new HttpClient({ fetch });
    await client.get("https://x.test/a");
    await client.get("https://x.test/b");
    expect(client.stats()).toMatchObject({ requests: 2, failures: 0 });
    expect(client.stats().bytesReceived).toBeGreaterThan(0);
  });

  it("carries request details on the error", async () => {
    const client = new HttpClient({ fetch: stubFetch([new Error("dns")]).fetch, sleep: noSleep });
    const error = await client.post("https://x.test/a").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ method: "POST", url: "https://x.test/a", kind: "network", attempts: 1 });
  });
});

/** A controllable WebSocket stand-in. */
function fakeSocket() {
  const sockets: (SocketLike & { fire: (event: "open" | "close" | "message", payload?: unknown) => void; sent: unknown[] })[] = [];
  const factory = (): SocketLike => {
    const sent: unknown[] = [];
    const socket = {
      binaryType: "",
      readyState: 0,
      onopen: null as (() => void) | null,
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as (() => void) | null,
      onclose: null as ((event: { code: number; reason: string; wasClean: boolean }) => void) | null,
      sent,
      send: (data: unknown) => sent.push(data),
      close: () => socket.fire("close", { code: 1000, reason: "", wasClean: true }),
      fire: (event: "open" | "close" | "message", payload?: unknown) => {
        if (event === "open") socket.onopen?.();
        if (event === "message") socket.onmessage?.({ data: payload });
        if (event === "close") socket.onclose?.((payload as { code: number; reason: string; wasClean: boolean }) ?? { code: 1006, reason: "", wasClean: false });
      },
    };
    sockets.push(socket as never);
    return socket as unknown as SocketLike;
  };
  return { factory, sockets };
}

describe("ReconnectingSocket", () => {
  it("connects and forwards messages", async () => {
    const { factory, sockets } = fakeSocket();
    const socket = new ReconnectingSocket("wss://x.test/chat", { socketFactory: factory, sleep: noSleep });
    const received: unknown[] = [];
    socket.message.on((data) => received.push(data));
    socket.connect();
    sockets[0]!.fire("open");
    expect(socket.state).toBe("open");
    sockets[0]!.fire("message", "hello");
    expect(received).toEqual(["hello"]);
  });

  it("queues while disconnected and flushes on reconnect", async () => {
    const { factory, sockets } = fakeSocket();
    const socket = new ReconnectingSocket("wss://x.test/chat", { socketFactory: factory, sleep: noSleep });
    socket.connect();
    // Not open yet: the message waits.
    expect(socket.send("queued")).toBe(false);
    expect(socket.queuedMessages).toBe(1);
    sockets[0]!.fire("open");
    expect(sockets[0]!.sent).toEqual(["queued"]);
    expect(socket.queuedMessages).toBe(0);
  });

  it("drops queueing when asked, which is right for position updates", () => {
    const { factory } = fakeSocket();
    const socket = new ReconnectingSocket("wss://x.test/game", { socketFactory: factory, queueWhileClosed: false, sleep: noSleep });
    socket.connect();
    // A stale position delivered late is worse than one never sent.
    expect(socket.send("pos")).toBe(false);
    expect(socket.queuedMessages).toBe(0);
  });

  it("bounds its queue, keeping the newest", () => {
    const { factory } = fakeSocket();
    const socket = new ReconnectingSocket("wss://x.test/chat", { socketFactory: factory, maxQueuedMessages: 2, sleep: noSleep });
    socket.connect();
    socket.send("a");
    socket.send("b");
    socket.send("c");
    expect(socket.queuedMessages).toBe(2);
  });

  it("reconnects after an unclean close", async () => {
    const { factory, sockets } = fakeSocket();
    const socket = new ReconnectingSocket("wss://x.test/chat", { socketFactory: factory, sleep: noSleep });
    socket.connect();
    sockets[0]!.fire("open");
    sockets[0]!.fire("close", { code: 1006, reason: "lost", wasClean: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets.length).toBeGreaterThan(1);
    sockets[1]!.fire("open");
    expect(socket.stats().reconnects).toBe(1);
  });

  it("does not reconnect after a deliberate close", async () => {
    const { factory, sockets } = fakeSocket();
    const socket = new ReconnectingSocket("wss://x.test/chat", { socketFactory: factory, sleep: noSleep });
    socket.connect();
    sockets[0]!.fire("open");
    socket.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets).toHaveLength(1);
    expect(socket.state).toBe("closed");
  });

  it("gives up after its retry budget and reports it", async () => {
    const { factory, sockets } = fakeSocket();
    const socket = new ReconnectingSocket("wss://x.test/chat", { socketFactory: factory, maxRetries: 1, sleep: noSleep });
    const failures: Error[] = [];
    socket.failed.on((error) => failures.push(error));
    socket.connect();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      sockets[sockets.length - 1]!.fire("close", { code: 1006, reason: "", wasClean: false });
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(socket.state).toBe("failed");
    expect(failures[0]!.message).toMatch(/gave up after/);
  });

  it("emits close details and validates its URL", () => {
    const { factory, sockets } = fakeSocket();
    const socket = new ReconnectingSocket("wss://x.test/chat", { socketFactory: factory, maxRetries: 0, sleep: noSleep });
    const closes: unknown[] = [];
    socket.closed.on((event) => closes.push(event));
    socket.connect();
    sockets[0]!.fire("close", { code: 1011, reason: "server error", wasClean: false });
    expect(closes).toEqual([{ code: 1011, reason: "server error", clean: false }]);
    expect(() => new ReconnectingSocket("http://x.test")).toThrow(/must start with ws:\/\/ or wss:\/\//);
  });
});
