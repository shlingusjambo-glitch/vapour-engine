/** Persistent key-value storage with an explicit backend.
 *
 * Browser storage is unusually failure-prone: `localStorage` throws in private
 * windows, is disabled by cookie-blocking settings, and has a hard quota that a
 * save file can exceed. Code that calls it directly either ignores those cases
 * or scatters try/catch everywhere.
 *
 * So storage here is an interface with a memory implementation that always
 * works, a `localStorage` implementation that reports *why* it is unavailable
 * rather than throwing at an arbitrary call site, and a namespace wrapper so
 * two games — or a game and the editor — on the same origin cannot collide.
 */
export interface KeyValueStore {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    keys(): readonly string[];
    clear(): void;
}
/** Always available, never persisted. The fallback when the browser refuses
 * storage, and the right choice in tests and on a server. */
export declare class MemoryStore implements KeyValueStore {
    #private;
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    keys(): readonly string[];
    clear(): void;
}
/** Minimal shape of `window.localStorage`, so the store is testable. */
export interface WebStorageLike {
    readonly length: number;
    key(index: number): string | null;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
export declare class StorageQuotaError extends Error {
    constructor(key: string, cause: unknown);
}
/** Wraps a `Storage` object, translating quota failures into a named error. */
export declare class WebStorageStore implements KeyValueStore {
    #private;
    constructor(storage: WebStorageLike);
    /**
     * Returns a `localStorage`-backed store, or `undefined` with a reason when
     * the browser will not provide one. Probing with a real write is the only
     * reliable test: the object exists in a private window but throws on use.
     */
    static tryCreate(scope?: {
        localStorage?: WebStorageLike;
    }): {
        store: WebStorageStore;
    } | {
        unavailable: string;
    };
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    keys(): readonly string[];
    clear(): void;
}
/**
 * Prefixes every key, so two games on one origin — or a game and the editor —
 * cannot overwrite each other's settings and saves.
 */
export declare class NamespacedStore implements KeyValueStore {
    #private;
    constructor(inner: KeyValueStore, namespace: string);
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    keys(): readonly string[];
    /** Clears only this namespace, leaving neighbouring namespaces alone. */
    clear(): void;
}
/**
 * The best available persistent store, falling back to memory.
 *
 * Returns the reason persistence is unavailable rather than failing, because a
 * game whose settings will not persist should still run — and should be able to
 * tell the player why.
 */
export declare function createPersistentStore(namespace: string, scope?: {
    localStorage?: WebStorageLike;
}): {
    store: KeyValueStore;
    persistent: boolean;
    reason?: string;
};
//# sourceMappingURL=storage.d.ts.map