/** HTTP and WebSockets for games.
 *
 * Games talk to leaderboards, matchmakers, asset CDNs, analytics, and their own
 * backends. Doing that with bare `fetch` means every game re-implements the same
 * five things badly: timeouts (fetch has none), retries with backoff, progress
 * reporting, typed errors, and cancellation that composes.
 *
 * HTTP status codes are **values, not exceptions**: a 404 is a normal outcome of
 * asking for something, and making it throw forces a try/catch around every
 * call site. Only requests that never completed — network faults, timeouts,
 * cancellation — throw.
 */
export * from "./http.js";
export * from "./socket.js";
//# sourceMappingURL=index.d.ts.map