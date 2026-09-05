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
export class HttpError extends Error {
  readonly url: string;
  readonly method: HttpMethod;
  readonly kind: "network" | "timeout" | "cancelled" | "parse";
  readonly attempts: number;

  constructor(message: string, details: { url: string; method: HttpMethod; kind: HttpError["kind"]; attempts: number; cause?: unknown }) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "HttpError";
    this.url = details.url;
    this.method = details.method;
    this.kind = details.kind;
    this.attempts = details.attempts;
  }
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

const DEFAULT_RETRY: Required<RetryOptions> = {
  attempts: 0,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
  // 5xx and 429 are worth retrying; a 400 will fail identically every time.
  retryOn: (status) => status === 429 || (status >= 500 && status < 600),
};

/**
 * A configured HTTP client.
 *
 * One per service is the intended shape: a game has a client for its own
 * backend with auth headers, and another for a public API without them.
 */
export class HttpClient {
  readonly #options: HttpClientOptions;
  readonly #fetch: FetchLike;
  readonly #sleep: (ms: number) => Promise<void>;
  #requests = 0;
  #retries = 0;
  #failures = 0;
  #bytesReceived = 0;

  constructor(options: HttpClientOptions = {}) {
    const injected = options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!injected) {
      throw new Error("No fetch implementation is available. Pass one as `fetch` when constructing the client.");
    }
    if (options.timeoutMs !== undefined && !(options.timeoutMs >= 0)) throw new Error("An HTTP timeout must not be negative.");
    this.#options = options;
    this.#fetch = injected;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  stats(): HttpStats {
    return { requests: this.#requests, retries: this.#retries, failures: this.#failures, bytesReceived: this.#bytesReceived };
  }

  get<T = unknown>(url: string, options: Omit<HttpRequestOptions, "method"> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: "GET" });
  }

  post<T = unknown>(url: string, options: Omit<HttpRequestOptions, "method"> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: "POST" });
  }

  put<T = unknown>(url: string, options: Omit<HttpRequestOptions, "method"> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: "PUT" });
  }

  patch<T = unknown>(url: string, options: Omit<HttpRequestOptions, "method"> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: "PATCH" });
  }

  delete<T = unknown>(url: string, options: Omit<HttpRequestOptions, "method"> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: "DELETE" });
  }

  /** Downloads a binary body — an asset bundle, a texture, a save file. */
  async binary(url: string, options: Omit<HttpRequestOptions, "method"> = {}): Promise<HttpResponse<ArrayBuffer>> {
    return this.request<ArrayBuffer>(url, { ...options, method: "GET", headers: { accept: "application/octet-stream", ...options.headers } });
  }

  /**
   * Performs a request.
   *
   * Resolves for any completed HTTP exchange, including 404 and 500 — a status
   * code is a normal outcome, and making it throw forces a try/catch around
   * every call site. Only requests that never completed throw.
   */
  async request<T = unknown>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const method = options.method ?? "GET";
    const target = this.#resolve(url, options.query);
    const retry: Required<RetryOptions> = { ...DEFAULT_RETRY, ...this.#options.retry, ...options.retry };
    if (!Number.isInteger(retry.attempts) || retry.attempts < 0) throw new Error("Retry attempts must be a non-negative whole number.");
    if (!(retry.baseDelayMs >= 0)) throw new Error("Retry base delay must not be negative.");

    const timeoutMs = options.timeoutMs ?? this.#options.timeoutMs ?? 30_000;
    if (!(timeoutMs >= 0)) throw new Error("An HTTP timeout must not be negative.");

    const started = Date.now();
    let attempts = 0;
    let lastError: unknown;

    for (;;) {
      attempts += 1;
      this.#requests += 1;
      const controller = new AbortController();
      const abort = (reason: unknown): void => controller.abort(reason);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onCallerAbort = (): void => abort(options.signal?.reason);
      if (options.signal) {
        if (options.signal.aborted) {
          throw new HttpError("The request was cancelled before it started.", { url: target, method, kind: "cancelled", attempts });
        }
        options.signal.addEventListener("abort", onCallerAbort, { once: true });
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }

      try {
        const init = this.#buildInit(method, options, controller.signal);
        await this.#options.beforeRequest?.(target, init);
        // The hook may have taken time, and the caller may have cancelled while
        // it ran. Issuing a request that is already doomed wastes a connection
        // and relies on the fetch implementation to reject promptly.
        if (controller.signal.aborted) throw new Error("aborted before dispatch");
        const response = await this.#fetch(target, init);

        // Retry on a retryable status, if attempts remain.
        if (!response.ok && retry.retryOn(response.status) && attempts <= retry.attempts) {
          this.#retries += 1;
          await this.#backoff(retry, attempts);
          continue;
        }

        const { data, bytes } = await this.#readBody<T>(response, target, method, attempts, options.onProgress);
        this.#bytesReceived += bytes;
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: headersToRecord(response.headers),
          url: response.url || target,
          data,
          attempts,
          durationMs: Date.now() - started,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof HttpError) throw error;
        const cancelled = options.signal?.aborted === true;
        const timedOut = controller.signal.aborted && !cancelled;
        // Cancellation is deliberate, so it is never retried.
        if (!cancelled && attempts <= retry.attempts) {
          this.#retries += 1;
          await this.#backoff(retry, attempts);
          continue;
        }
        this.#failures += 1;
        if (cancelled) {
          throw new HttpError(`${method} ${target} was cancelled.`, { url: target, method, kind: "cancelled", attempts, cause: error });
        }
        if (timedOut) {
          throw new HttpError(`${method} ${target} timed out after ${timeoutMs}ms.`, { url: target, method, kind: "timeout", attempts, cause: error });
        }
        throw new HttpError(`${method} ${target} failed: ${messageOf(error)}`, { url: target, method, kind: "network", attempts, cause: error });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onCallerAbort);
      }
    }
    void lastError;
  }

  #resolve(url: string, query: HttpRequestOptions["query"]): string {
    const base = this.#options.baseUrl;
    let target = base && !/^[a-z][a-z0-9+.-]*:/i.test(url) ? `${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}` : url;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        // Undefined values are omitted rather than serialized as "undefined",
        // which is what a caller building an optional filter expects.
        if (value === undefined) continue;
        params.set(key, String(value));
      }
      const serialized = params.toString();
      if (serialized) target += (target.includes("?") ? "&" : "?") + serialized;
    }
    return target;
  }

  #buildInit(method: HttpMethod, options: HttpRequestOptions, signal: AbortSignal): RequestInit {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.#options.headers ?? {})) headers[key.toLowerCase()] = value;
    for (const [key, value] of Object.entries(options.headers ?? {})) headers[key.toLowerCase()] = value;

    let body = options.body ?? undefined;
    if (options.json !== undefined) {
      if (body !== undefined) throw new Error("A request cannot have both `body` and `json`.");
      body = JSON.stringify(options.json);
      headers["content-type"] ??= "application/json";
    }
    // FormData sets its own multipart boundary; supplying one breaks the upload.
    if (typeof FormData !== "undefined" && body instanceof FormData) delete headers["content-type"];

    return {
      method,
      headers,
      signal,
      ...(body === undefined || method === "GET" || method === "HEAD" ? {} : { body: body as BodyInit }),
      ...(options.credentials ? { credentials: options.credentials } : {}),
    };
  }

  async #backoff(retry: Required<RetryOptions>, attempt: number): Promise<void> {
    // Exponential, capped. A fixed delay hammers a struggling server; an
    // uncapped one makes a late retry arrive long after anyone cares.
    const delay = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1));
    if (delay > 0) await this.#sleep(delay);
  }

  async #readBody<T>(
    response: Response,
    url: string,
    method: HttpMethod,
    attempts: number,
    onProgress: HttpRequestOptions["onProgress"],
  ): Promise<{ data: T; bytes: number }> {
    if (response.status === 204 || method === "HEAD") return { data: undefined as T, bytes: 0 };
    const type = response.headers.get("content-type") ?? "";

    if (onProgress && response.body) {
      const total = Number(response.headers.get("content-length")) || undefined;
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        onProgress({ loaded, total, fraction: total === undefined ? undefined : loaded / total });
      }
      const merged = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = new TextDecoder().decode(merged);
      if (type.includes("application/json")) return { data: parseJson<T>(text, url, method, attempts), bytes: loaded };
      if (type.startsWith("text/") || type === "") return { data: text as T, bytes: loaded };
      return { data: merged.buffer as T, bytes: loaded };
    }

    if (type.includes("application/json")) {
      const text = await response.text();
      return { data: parseJson<T>(text, url, method, attempts), bytes: text.length };
    }
    if (type.startsWith("text/") || type.includes("xml") || type === "") {
      const text = await response.text();
      return { data: text as T, bytes: text.length };
    }
    const buffer = await response.arrayBuffer();
    return { data: buffer as T, bytes: buffer.byteLength };
  }
}

function parseJson<T>(text: string, url: string, method: HttpMethod, attempts: number): T {
  // An empty JSON body is a common server behaviour and is not an error.
  if (text.trim() === "") return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new HttpError(`${method} ${url} returned a body that is not valid JSON.`, { url, method, kind: "parse", attempts, cause: error });
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
