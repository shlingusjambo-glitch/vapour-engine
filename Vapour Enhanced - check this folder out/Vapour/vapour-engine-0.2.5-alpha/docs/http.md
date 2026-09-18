# Web requests

Games talk to leaderboards, matchmakers, asset CDNs, analytics, and their own
backends. Doing that with bare `fetch` means every game re-implements the same
five things badly: timeouts (fetch has none), retries with backoff, progress
reporting, typed errors, and cancellation that composes.

## Status codes are values, not exceptions

```ts
const response = await client.get<Scores>("/leaderboard");
if (!response.ok) {
  showMessage(response.status === 404 ? "No scores yet" : "Leaderboard unavailable");
  return;
}
render(response.data);
```

A 404 is a normal outcome of asking for something. Making it throw forces a
`try`/`catch` around every call site to handle a case that is not exceptional.

Only requests that **never completed** throw `HttpError`: network faults,
timeouts, cancellation, and unparseable bodies. Each carries `kind`, `url`,
`method`, and `attempts`, so a handler can distinguish "the server said no" from
"we never reached the server".

## Basic use

```ts
import { HttpClient } from "@vapour/engine";

const api = new HttpClient({
  baseUrl: "https://api.example.com/v1",
  headers: { "x-app": "my-game" },
  timeoutMs: 10_000,
  retry: { attempts: 2 },
  beforeRequest: (_url, init) => {
    (init.headers as Record<string, string>).authorization = `Bearer ${session.token()}`;
  },
});

await api.post("/scores", { json: { score, level } });
const page = await api.get("/leaderboard", { query: { page: 2, filter: undefined } });
```

One client per service is the intended shape: a game has one for its own backend
with auth headers, and another for a public API without them.

`beforeRequest` is where auth belongs — it runs per request, so a token
refreshed mid-session is picked up without rebuilding the client. Query values
of `undefined` are **omitted**, which is what a caller building an optional
filter expects.

## Retries

```ts
retry: { attempts: 3, baseDelayMs: 200, maxDelayMs: 5000 }
```

By default only **429 and 5xx** are retried — a 400 will fail identically every
time, so retrying it just delays the error. Backoff is exponential and capped: a
fixed delay hammers a struggling server, and an uncapped one makes a late retry
arrive long after anyone cares.

Network faults are retried. **Cancellation never is**, because it was
deliberate.

## Timeouts and cancellation

```ts
const controller = new AbortController();
onSceneUnload(() => controller.abort());

await api.get("/big-thing", { signal: controller.signal, timeoutMs: 30_000 });
```

The caller's signal and the timeout are combined, so either cancels. `fetch` has
no timeout of its own, which is why a request to a black-holed server otherwise
hangs until the page closes.

## Downloads with progress

```ts
const bundle = await api.binary("/bundles/forest.pack", {
  onProgress: ({ fraction, loaded }) => loadingBar.set(fraction ?? loaded / expected),
});
```

`fraction` is `undefined` when the server sent no `content-length`, which is
common for compressed responses — so handle that case rather than assuming a
percentage exists.

## WebSockets

```ts
import { ReconnectingSocket } from "@vapour/engine";

const chat = new ReconnectingSocket("wss://example.com/chat", { maxRetries: Infinity });
chat.message.on((data) => appendMessage(data));
chat.connect();
chat.send(JSON.stringify({ text }));
```

**Two socket types exist on purpose.** `WebSocketTransport` in `networking.ts`
is strict and does not reconnect, because for a game session a dropped
connection is a state event the session must handle deliberately — silently
reconnecting hides desyncs. `ReconnectingSocket` is for chat, live
leaderboards, and presence feeds, where staying up *is* the correct behaviour.

`queueWhileClosed` defaults on and is right for a chat message. Turn it **off**
for position updates: a stale position delivered late is worse than one never
sent. The queue is bounded and drops oldest first, because the newest message is
the one still worth sending.

## API reference

| Export | Purpose |
| ------ | ------- |
| `HttpClient` | `get`, `post`, `put`, `patch`, `delete`, `binary`, `request`, `stats` |
| `HttpError` | `kind` (`network`/`timeout`/`cancelled`/`parse`), `url`, `method`, `attempts` |
| `ReconnectingSocket` | `connect`, `send`, `close`, `state`, `stats`, and the `opened`/`closed`/`message`/`failed` signals |
| Types | `HttpRequestOptions`, `HttpResponse`, `RetryOptions`, `HttpProgress`, `FetchLike` |

## Performance considerations

- `fetch` is **injected**, so the client works in a worker, in a test, and on a
  server without reaching for a global.
- Progress reporting reads the response as a stream and reassembles it, which
  costs one extra copy. Omit `onProgress` for small responses.
- `client.stats()` reports requests, retries, failures, and bytes received —
  feed it into [diagnostics](diagnostics.md) counters to see network cost
  alongside frame cost.

## Multiplayer considerations

Use this for the *metagame* — matchmaking, profiles, leaderboards, telemetry —
and [`@vapour/net`](multiplayer.md) for gameplay. Real-time replication over
HTTP is not viable, and running matchmaking over the game socket couples two
things with very different reliability needs.
