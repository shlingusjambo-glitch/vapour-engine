/** The Vapour web request API.
 *
 * Games talk to leaderboards, matchmakers, asset CDNs, analytics, and their own
 * backends. Doing that with bare `fetch` means every game re-implements the same
 * five things badly: timeouts (fetch has none), retries with backoff, progress
 * reporting, typed errors, and cancellation that actually composes.
 *
 * Two decisions shape this API:
 *
 * - **Failures are values, not exceptions, for HTTP status.** A 404 is a normal
 *   outcome of asking for something; making it throw means every call site
 *   needs a try/catch to handle a case that is not exceptional. Network faults
 *   and timeouts *do* throw, because they mean the request never completed.
 * - **`fetch` is injected.** The engine must run in a worker, in a test, and on
 *   a server; reaching for a global makes all three awkward.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
export type HttpBody = string | ArrayBuffer | ArrayBufferView | FormData | Blob | URLSearchParams | null;
export interface HttpRequestOptions {
    readonly method?: HttpMethod;
    readonly headers?: Readonly<Record<string, string>>;
    /** Appended to the URL, with values that are not strings stringified. */
    readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
    readonly body?: HttpBody;
    /** Sent as JSON, setting `content-type` unless one is already given. */
    readonly json?: unknown;
    /** Milliseconds before the request is aborted. `0` disables the timeout. */
    readonly timeoutMs?: number;
    /** Caller cancellation, combined with the timeout. */
    readonly signal?: AbortSignal;
    readonly retry?: RetryOptions;
    /** Download progress, when the response reports a length. */
    readonly onProgress?: (progress: HttpProgress) => void;
    readonly credentials?: RequestCredentials;
}
export interface RetryOptions {
    /** Retries after the first attempt. */
    readonly attempts?: number;
    /** Delay before the first retry, doubled each time. */
    readonly baseDelayMs?: number;
    readonly maxDelayMs?: number;
    /** Which responses are worth retrying. */
    readonly retryOn?: (status: number) => boolean;
}
export interface HttpProgress {
    readonly loaded: number;
    /** Total bytes, or `undefined` when the server did not say. */
    readonly total: number | undefined;
    /** Fraction complete, or `undefined` without a total. */
    readonly fraction: number | undefined;
}
export interface HttpResponse<T = unknown> {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly url: string;
    /** Parsed body. `undefined` when the response had none. */
    readonly data: T;
    /** Attempts made, including the first. */
    readonly attempts: number;
    readonly durationMs: number;
}
/** A request that never completed: network fault, timeout, or cancellation. */
export declare class HttpError extends Error {
    readonly url: string;
    readonly method: HttpMethod;
    readonly kind: "network" | "timeout" | "cancelled" | "parse";
    readonly attempts: number;
    constructor(message: string, details: {
        url: string;
        method: HttpMethod;
        kind: HttpError["kind"];
        attempts: number;
        cause?: unknown;
    });
}
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export interface HttpClientOptions {
    /** Prepended to relative paths. */
    readonly baseUrl?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly timeoutMs?: number;
    readonly retry?: RetryOptions;
    /** Injected so the client works in a worker, a test, and on a server. */
    readonly fetch?: FetchLike;
    /** Called before each request, for auth tokens and correlation ids. */
    readonly beforeRequest?: (url: string, init: RequestInit) => void | Promise<void>;
    /** Delay implementation, so retry backoff is testable without real waits. */
    readonly sleep?: (ms: number) => Promise<void>;
}
export interface HttpStats {
    readonly requests: number;
    readonly retries: number;
    readonly failures: number;
    readonly bytesReceived: number;
}
/**
 * A configured HTTP client.
 *
 * One per service is the intended shape: a game has a client for its own
 * backend with auth headers, and another for a public API without them.
 */
export declare class HttpClient {
    #private;
    constructor(options?: HttpClientOptions);
    stats(): HttpStats;
    get<T = unknown>(url: string, options?: Omit<HttpRequestOptions, "method">): Promise<HttpResponse<T>>;
    post<T = unknown>(url: string, options?: Omit<HttpRequestOptions, "method">): Promise<HttpResponse<T>>;
    put<T = unknown>(url: string, options?: Omit<HttpRequestOptions, "method">): Promise<HttpResponse<T>>;
    patch<T = unknown>(url: string, options?: Omit<HttpRequestOptions, "method">): Promise<HttpResponse<T>>;
    delete<T = unknown>(url: string, options?: Omit<HttpRequestOptions, "method">): Promise<HttpResponse<T>>;
    /** Downloads a binary body — an asset bundle, a texture, a save file. */
    binary(url: string, options?: Omit<HttpRequestOptions, "method">): Promise<HttpResponse<ArrayBuffer>>;
    /**
     * Performs a request.
     *
     * Resolves for any completed HTTP exchange, including 404 and 500 — a status
     * code is a normal outcome, and making it throw forces a try/catch around
     * every call site. Only requests that never completed throw.
     */
    request<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
}
//# sourceMappingURL=http.d.ts.map