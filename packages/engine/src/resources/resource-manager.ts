/** The resource manager: loading, caching, reference counting, and unloading.
 *
 * Vapour games are long-running browser sessions that stream content in and out
 * for hours. That makes *ownership* the central problem, not loading: without a
 * clear answer to "is anything still using this?", a streaming world either
 * leaks every chunk it ever visited or disposes something mid-frame. So this
 * manager is built around explicit reference counts and an explicit dependency
 * graph rather than around a cache with a timeout.
 *
 * Responsibilities:
 *
 * - Deduplicate concurrent loads of the same resource.
 * - Track dependencies declared during a load, and release them with the parent.
 * - Reference count handles, disposing a resource when the last one is released.
 * - Optionally keep unreferenced resources cached under a byte budget (LRU).
 * - Report enough statistics for diagnostics to explain memory growth.
 */
import { ResourceHandle, formatResourceKey, type ResourceKey, type ResourceOwner, type ResourceType } from "./handle.js";

/** Progress and dependency services handed to a loader while it runs. */
export interface ResourceLoadContext {
  /** Aborted when every caller waiting on this load has cancelled. */
  readonly signal: AbortSignal;
  /**
   * Loads another resource as a dependency of the one being loaded.
   *
   * The resulting reference is owned by the parent: it is released
   * automatically when the parent is disposed, so a loader never has to write
   * teardown code for what it required.
   */
  require<T>(type: ResourceType, id: string): Promise<T>;
  /** Reports load progress in `[0, 1]` for progress UI and diagnostics. */
  report(progress: number): void;
}

/** A loaded value plus the metadata the manager needs to account for it. */
export interface LoadedResource<T> {
  readonly value: T;
  /** Approximate retained bytes, used for the cache budget and diagnostics. */
  readonly byteEstimate?: number;
  /** Called when the resource is disposed. Overrides the loader's `dispose`. */
  readonly dispose?: (value: T) => void;
}

export interface ResourceLoader<T = unknown> {
  /** The resource type this loader claims. One loader per type. */
  readonly type: ResourceType;
  /** Produces the value, or a {@link LoadedResource} carrying metadata. */
  load(id: string, context: ResourceLoadContext): Promise<T | LoadedResource<T>>;
  /** Releases native or GPU memory held by a value. */
  dispose?(value: T): void;
}

export type ResourceState = "loading" | "ready" | "failed";

export interface ResourceStats {
  /** Resources currently held by at least one handle. */
  readonly referenced: number;
  /** Loaded resources with no handles, retained by the cache. */
  readonly cached: number;
  readonly loading: number;
  readonly handles: number;
  readonly estimatedBytes: number;
  readonly cachedBytes: number;
}

export interface ResourceEntrySnapshot {
  readonly type: ResourceType;
  readonly id: string;
  readonly state: ResourceState;
  readonly refCount: number;
  readonly byteEstimate: number;
  readonly dependencies: readonly ResourceKey[];
}

export interface ResourceManagerOptions {
  /**
   * What happens when a resource's last handle is released.
   *
   * `dispose` frees immediately, which keeps memory tight and is right for
   * streaming worlds. `retain` keeps the value cached so an immediate reload is
   * free, which is right for UI and menu assets that churn.
   */
  readonly cachePolicy?: "dispose" | "retain";
  /** Byte budget for `retain` caching. Least recently released is evicted first. */
  readonly maxCachedBytes?: number;
}

export interface LoadOptions {
  /** Cancels this caller's interest. The load itself is only aborted when every
   * waiting caller has cancelled. */
  readonly signal?: AbortSignal;
  /** Receives progress in `[0, 1]` as the loader reports it. */
  readonly onProgress?: (progress: number) => void;
}

interface Entry {
  readonly key: ResourceKey;
  state: ResourceState;
  value: unknown;
  refCount: number;
  byteEstimate: number;
  dispose: ((value: unknown) => void) | undefined;
  /** Handles this resource owns on its dependencies. */
  dependencies: ResourceHandle<unknown>[];
  promise: Promise<void> | undefined;
  controller: AbortController | undefined;
  /** Callers still waiting on an in-flight load. */
  waiters: number;
  progressListeners: Set<(progress: number) => void>;
  /** Monotonic tick recorded when the last handle was released, for LRU. */
  releasedAt: number;
}

/**
 * Loads, caches, and owns resources.
 *
 * Emits `resourceloaded`, `resourceunloaded`, and `resourcefailed` events whose
 * `detail` is the {@link ResourceKey}, so diagnostics and editor tooling can
 * observe the pipeline without polling.
 */
export class ResourceManager extends EventTarget implements ResourceOwner {
  readonly #loaders = new Map<ResourceType, ResourceLoader<unknown>>();
  readonly #entries = new Map<string, Entry>();
  readonly #cachePolicy: "dispose" | "retain";
  readonly #maxCachedBytes: number;
  #clock = 0;
  #disposed = false;

  constructor(options: ResourceManagerOptions = {}) {
    super();
    this.#cachePolicy = options.cachePolicy ?? "dispose";
    const budget = options.maxCachedBytes ?? Number.POSITIVE_INFINITY;
    if (!(budget > 0)) throw new Error("Resource cache budget must be a positive number of bytes.");
    this.#maxCachedBytes = budget;
  }

  /** Registers the loader for a resource type. Types are exclusive so that a
   * resource id always resolves through exactly one pipeline. */
  register<T>(loader: ResourceLoader<T>): void {
    this.#assertLive();
    const type = loader.type.trim();
    if (!type) throw new Error("A resource loader requires a non-empty type.");
    if (this.#loaders.has(type)) {
      throw new Error(`A loader for resource type "${type}" is already registered.`);
    }
    this.#loaders.set(type, loader as unknown as ResourceLoader<unknown>);
  }

  isRegistered(type: ResourceType): boolean {
    return this.#loaders.has(type);
  }

  get registeredTypes(): readonly ResourceType[] {
    return [...this.#loaders.keys()].sort();
  }

  /**
   * Loads a resource and returns an owned handle.
   *
   * Concurrent calls for the same resource share one load. The returned handle
   * must be released; releasing the last one disposes the resource unless the
   * cache policy retains it.
   */
  async load<T>(type: ResourceType, id: string, options: LoadOptions = {}): Promise<ResourceHandle<T>> {
    this.#assertLive();
    const handle = await this.#load<T>({ type, id }, options, []);
    return handle;
  }

  /**
   * Loads several resources concurrently, resolving once all are ready.
   *
   * Preloading is a load like any other — it returns real handles that the
   * caller owns — so a loading screen keeps content alive simply by holding
   * them, and drops it by releasing them.
   */
  async preload(requests: readonly ResourceKey[], options: LoadOptions = {}): Promise<ResourceHandle<unknown>[]> {
    this.#assertLive();
    const settled = await Promise.allSettled(requests.map((request) => this.load(request.type, request.id, options)));
    const handles: ResourceHandle<unknown>[] = [];
    const failures: string[] = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") handles.push(result.value);
      else failures.push(`${formatResourceKey(requests[index]!)}: ${messageOf(result.reason)}`);
    }
    if (failures.length > 0) {
      // Release what did load so a failed preload does not leak the rest.
      for (const handle of handles) handle.release();
      throw new Error(`Preload failed for ${failures.length} resource(s):\n  ${failures.join("\n  ")}`);
    }
    return handles;
  }

  /** Returns a new handle if the resource is already loaded, otherwise
   * `undefined`. Never starts a load, so it is safe to call every frame. */
  get<T>(type: ResourceType, id: string): ResourceHandle<T> | undefined {
    const entry = this.#entries.get(formatResourceKey({ type, id }));
    if (!entry || entry.state !== "ready") return undefined;
    entry.refCount += 1;
    return new ResourceHandle<T>(this, entry.key);
  }

  /** Reads a loaded value without taking a reference. For diagnostics and
   * debug rendering; anything holding onto the value should use a handle. */
  peek<T>(type: ResourceType, id: string): T | undefined {
    const entry = this.#entries.get(formatResourceKey({ type, id }));
    return entry?.state === "ready" ? (entry.value as T) : undefined;
  }

  isLoaded(type: ResourceType, id: string): boolean {
    return this.#entries.get(formatResourceKey({ type, id }))?.state === "ready";
  }

  isLoading(type: ResourceType, id: string): boolean {
    return this.#entries.get(formatResourceKey({ type, id }))?.state === "loading";
  }

  /** Disposes every cached resource that no handle references. Returns how many
   * were unloaded. Under the `retain` policy this is how a level transition
   * reclaims memory. */
  unloadUnused(): number {
    let unloaded = 0;
    // Repeat: disposing a parent releases its dependencies, which may in turn
    // become unreferenced.
    for (;;) {
      const candidates = [...this.#entries.values()].filter((entry) => entry.refCount === 0 && entry.state === "ready");
      if (candidates.length === 0) break;
      for (const entry of candidates) {
        this.#dispose(entry);
        unloaded += 1;
      }
    }
    return unloaded;
  }

  stats(): ResourceStats {
    let referenced = 0;
    let cached = 0;
    let loading = 0;
    let handles = 0;
    let estimatedBytes = 0;
    let cachedBytes = 0;
    for (const entry of this.#entries.values()) {
      if (entry.state === "loading") {
        loading += 1;
        continue;
      }
      estimatedBytes += entry.byteEstimate;
      handles += entry.refCount;
      if (entry.refCount > 0) referenced += 1;
      else {
        cached += 1;
        cachedBytes += entry.byteEstimate;
      }
    }
    return { referenced, cached, loading, handles, estimatedBytes, cachedBytes };
  }

  /** Every tracked resource, for the diagnostics overlay and editor inspector. */
  inspect(): readonly ResourceEntrySnapshot[] {
    return [...this.#entries.values()]
      .map((entry) => ({
        type: entry.key.type,
        id: entry.key.id,
        state: entry.state,
        refCount: entry.refCount,
        byteEstimate: entry.byteEstimate,
        dependencies: entry.dependencies.map((handle) => handle.key),
      }))
      .sort((a, b) => formatResourceKey(a).localeCompare(formatResourceKey(b)));
  }

  /** Disposes everything, ignoring reference counts. Call on teardown only;
   * outstanding handles will throw when used afterwards. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of [...this.#entries.values()]) {
      if (entry.controller) entry.controller.abort(new Error("The resource manager was disposed."));
      if (entry.state === "ready") this.#runDispose(entry);
    }
    this.#entries.clear();
    this.#loaders.clear();
  }

  // --- ResourceOwner ---------------------------------------------------------

  /** @internal */
  resolveValue(key: ResourceKey): unknown {
    const entry = this.#entries.get(formatResourceKey(key));
    if (!entry || entry.state !== "ready") {
      throw new Error(`Resource ${formatResourceKey(key)} is no longer loaded.`);
    }
    return entry.value;
  }

  /** @internal */
  retainHandle(key: ResourceKey): void {
    const entry = this.#requireEntry(key);
    entry.refCount += 1;
  }

  /** @internal */
  releaseHandle(key: ResourceKey): void {
    const entry = this.#entries.get(formatResourceKey(key));
    // Disposing the manager clears entries while handles may still exist; a
    // release afterwards is a no-op rather than an error.
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount > 0) return;
    if (entry.refCount < 0) {
      throw new Error(`Resource ${formatResourceKey(key)} has a negative reference count, which means a handle was released twice.`);
    }
    entry.releasedAt = ++this.#clock;
    if (this.#cachePolicy === "dispose") {
      this.#dispose(entry);
      return;
    }
    this.#enforceCacheBudget();
  }

  // --- internals -------------------------------------------------------------

  async #load<T>(key: ResourceKey, options: LoadOptions, chain: readonly string[]): Promise<ResourceHandle<T>> {
    const id = key.id.trim();
    if (!id) throw new Error(`A ${key.type} resource requires a non-empty id.`);
    const resolved: ResourceKey = { type: key.type, id };
    const label = formatResourceKey(resolved);

    if (chain.includes(label)) {
      throw new Error(`Resource dependency cycle: ${[...chain, label].join(" -> ")}.`);
    }
    const loader = this.#loaders.get(resolved.type);
    if (!loader) {
      const known = this.registeredTypes;
      throw new Error(
        `No loader is registered for resource type "${resolved.type}". ` +
          (known.length > 0 ? `Registered types: ${known.join(", ")}.` : "Register one with ResourceManager.register()."),
      );
    }

    let entry = this.#entries.get(label);
    if (entry?.state === "ready") {
      entry.refCount += 1;
      return new ResourceHandle<T>(this, entry.key);
    }

    if (!entry) {
      entry = {
        key: resolved,
        state: "loading",
        value: undefined,
        refCount: 0,
        byteEstimate: 0,
        dispose: undefined,
        dependencies: [],
        promise: undefined,
        controller: new AbortController(),
        waiters: 0,
        progressListeners: new Set(),
        releasedAt: 0,
      };
      this.#entries.set(label, entry);
    }

    const active = entry;
    // Register interest *before* starting the load: a loader may report
    // progress synchronously, and a listener added afterwards would miss it.
    if (options.onProgress) active.progressListeners.add(options.onProgress);
    active.waiters += 1;
    active.promise ??= this.#run(active, loader, chain);

    try {
      await this.#await(active, options.signal);
    } finally {
      active.waiters -= 1;
      if (options.onProgress) active.progressListeners.delete(options.onProgress);
      // The load itself is only abandoned once nobody is waiting for it.
      if (active.waiters === 0 && active.state === "loading" && options.signal?.aborted) {
        active.controller?.abort(options.signal.reason);
      }
    }

    if (active.state !== "ready") {
      throw new Error(`Resource ${label} failed to load.`);
    }
    active.refCount += 1;
    return new ResourceHandle<T>(this, active.key);
  }

  /** Waits for a load, honouring one caller's cancellation without cancelling
   * the shared load for everyone else. */
  async #await(entry: Entry, signal: AbortSignal | undefined): Promise<void> {
    if (!signal) {
      await entry.promise;
      return;
    }
    if (signal.aborted) throw abortError(signal.reason);
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => reject(abortError(signal.reason));
      signal.addEventListener("abort", onAbort, { once: true });
      void entry.promise
        ?.then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  async #run(entry: Entry, loader: ResourceLoader<unknown>, chain: readonly string[]): Promise<void> {
    const label = formatResourceKey(entry.key);
    const nextChain = [...chain, label];
    const context: ResourceLoadContext = {
      signal: entry.controller!.signal,
      require: async <T,>(type: ResourceType, id: string): Promise<T> => {
        const handle = await this.#load<T>({ type, id }, {}, nextChain);
        entry.dependencies.push(handle as ResourceHandle<unknown>);
        return handle.value;
      },
      report: (progress: number): void => {
        const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
        for (const listener of entry.progressListeners) listener(clamped);
      },
    };

    try {
      const result = await loader.load(entry.key.id, context);
      if (entry.controller!.signal.aborted) throw abortError(entry.controller!.signal.reason);
      const loaded = normalizeLoaded(result);
      entry.value = loaded.value;
      entry.byteEstimate = loaded.byteEstimate ?? 0;
      entry.dispose = (loaded.dispose ?? loader.dispose) as ((value: unknown) => void) | undefined;
      entry.state = "ready";
      entry.controller = undefined;
      this.dispatchEvent(new CustomEvent("resourceloaded", { detail: entry.key }));
    } catch (error) {
      entry.state = "failed";
      // Remove the entry so the failure is not cached: a transient network
      // error must not permanently poison the resource.
      this.#entries.delete(label);
      for (const handle of entry.dependencies) {
        if (!handle.released) handle.release();
      }
      entry.dependencies = [];
      this.dispatchEvent(new CustomEvent("resourcefailed", { detail: { key: entry.key, error } }));
      throw new Error(`Resource ${label} failed to load: ${messageOf(error)}`, { cause: error });
    }
  }

  #dispose(entry: Entry): void {
    this.#entries.delete(formatResourceKey(entry.key));
    this.#runDispose(entry);
    this.dispatchEvent(new CustomEvent("resourceunloaded", { detail: entry.key }));
  }

  #runDispose(entry: Entry): void {
    const dependencies = entry.dependencies;
    entry.dependencies = [];
    try {
      entry.dispose?.(entry.value);
    } finally {
      entry.value = undefined;
      entry.state = "failed";
      // Releasing after disposal, so a dependency is never freed while the
      // parent's own teardown might still be reading it.
      for (const handle of dependencies) {
        if (!handle.released) handle.release();
      }
    }
  }

  /** Evicts least-recently-released cached resources until the budget holds. */
  #enforceCacheBudget(): void {
    if (this.#maxCachedBytes === Number.POSITIVE_INFINITY) return;
    for (;;) {
      const cached = [...this.#entries.values()].filter((entry) => entry.refCount === 0 && entry.state === "ready");
      const total = cached.reduce((sum, entry) => sum + entry.byteEstimate, 0);
      if (total <= this.#maxCachedBytes || cached.length === 0) return;
      cached.sort((a, b) => a.releasedAt - b.releasedAt);
      this.#dispose(cached[0]!);
    }
  }

  #requireEntry(key: ResourceKey): Entry {
    const entry = this.#entries.get(formatResourceKey(key));
    if (!entry) throw new Error(`Resource ${formatResourceKey(key)} is no longer tracked.`);
    return entry;
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("This resource manager has been disposed.");
  }
}

function normalizeLoaded<T>(result: T | LoadedResource<T>): LoadedResource<T> {
  if (result !== null && typeof result === "object" && "value" in (result as object)) {
    return result as LoadedResource<T>;
  }
  return { value: result as T };
}

function abortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("The resource load was cancelled.");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
