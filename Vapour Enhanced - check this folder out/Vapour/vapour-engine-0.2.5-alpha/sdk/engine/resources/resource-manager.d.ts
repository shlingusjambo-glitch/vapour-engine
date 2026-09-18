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
import { ResourceHandle, type ResourceKey, type ResourceOwner, type ResourceType } from "./handle.js";
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
/**
 * Loads, caches, and owns resources.
 *
 * Emits `resourceloaded`, `resourceunloaded`, and `resourcefailed` events whose
 * `detail` is the {@link ResourceKey}, so diagnostics and editor tooling can
 * observe the pipeline without polling.
 */
export declare class ResourceManager extends EventTarget implements ResourceOwner {
    #private;
    constructor(options?: ResourceManagerOptions);
    /** Registers the loader for a resource type. Types are exclusive so that a
     * resource id always resolves through exactly one pipeline. */
    register<T>(loader: ResourceLoader<T>): void;
    isRegistered(type: ResourceType): boolean;
    get registeredTypes(): readonly ResourceType[];
    /**
     * Loads a resource and returns an owned handle.
     *
     * Concurrent calls for the same resource share one load. The returned handle
     * must be released; releasing the last one disposes the resource unless the
     * cache policy retains it.
     */
    load<T>(type: ResourceType, id: string, options?: LoadOptions): Promise<ResourceHandle<T>>;
    /**
     * Loads several resources concurrently, resolving once all are ready.
     *
     * Preloading is a load like any other — it returns real handles that the
     * caller owns — so a loading screen keeps content alive simply by holding
     * them, and drops it by releasing them.
     */
    preload(requests: readonly ResourceKey[], options?: LoadOptions): Promise<ResourceHandle<unknown>[]>;
    /** Returns a new handle if the resource is already loaded, otherwise
     * `undefined`. Never starts a load, so it is safe to call every frame. */
    get<T>(type: ResourceType, id: string): ResourceHandle<T> | undefined;
    /** Reads a loaded value without taking a reference. For diagnostics and
     * debug rendering; anything holding onto the value should use a handle. */
    peek<T>(type: ResourceType, id: string): T | undefined;
    isLoaded(type: ResourceType, id: string): boolean;
    isLoading(type: ResourceType, id: string): boolean;
    /** Disposes every cached resource that no handle references. Returns how many
     * were unloaded. Under the `retain` policy this is how a level transition
     * reclaims memory. */
    unloadUnused(): number;
    stats(): ResourceStats;
    /** Every tracked resource, for the diagnostics overlay and editor inspector. */
    inspect(): readonly ResourceEntrySnapshot[];
    /** Disposes everything, ignoring reference counts. Call on teardown only;
     * outstanding handles will throw when used afterwards. */
    dispose(): void;
    /** @internal */
    resolveValue(key: ResourceKey): unknown;
    /** @internal */
    retainHandle(key: ResourceKey): void;
    /** @internal */
    releaseHandle(key: ResourceKey): void;
}
//# sourceMappingURL=resource-manager.d.ts.map