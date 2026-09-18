/** Typed, reference-counted handles to loaded resources.
 *
 * A handle is **one owned reference**, not a shared pointer that can be copied
 * freely: whoever obtains a handle is responsible for releasing it exactly
 * once, and a second reference is minted explicitly with {@link
 * ResourceHandle.retain}. Making sharing explicit is what lets the manager know
 * when a resource is genuinely unused, which is the whole point — a long-running
 * game that never learns this leaks until the tab dies.
 */
export type ResourceType = string;
/** A resource's identity: its loader type plus an id unique within that type. */
export interface ResourceKey {
    readonly type: ResourceType;
    readonly id: string;
}
/** Formats a key for logs, diagnostics, and error messages. */
export declare function formatResourceKey(key: ResourceKey): string;
/** Implemented by {@link ResourceManager}; kept separate so handles do not need
 * a concrete manager type and cannot reach into its internals. */
export interface ResourceOwner {
    releaseHandle(key: ResourceKey): void;
    retainHandle(key: ResourceKey): void;
    resolveValue(key: ResourceKey): unknown;
}
/**
 * A live reference to a loaded resource.
 *
 * Reading {@link value} after {@link release} throws rather than returning a
 * disposed object, because use-after-release is a bug that is far cheaper to
 * find at the access than three frames later inside the renderer.
 */
export declare class ResourceHandle<T> {
    #private;
    /** @internal Handles are minted by the manager, never constructed directly. */
    constructor(owner: ResourceOwner, key: ResourceKey);
    get type(): ResourceType;
    get id(): string;
    get key(): ResourceKey;
    get released(): boolean;
    get value(): T;
    /** Mints a second independent reference. Both must be released. */
    retain(): ResourceHandle<T>;
    /**
     * Drops this reference. Releasing twice throws: a double release corrupts the
     * reference count, which would let a resource still in use be disposed.
     */
    release(): void;
}
/** Releases a group of handles, tolerating ones already released. Useful in
 * teardown paths where partial construction may have occurred. */
export declare function releaseAll(handles: Iterable<ResourceHandle<unknown>>): void;
//# sourceMappingURL=handle.d.ts.map