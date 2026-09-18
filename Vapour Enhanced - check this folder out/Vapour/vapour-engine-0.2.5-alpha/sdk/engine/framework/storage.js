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
/** Always available, never persisted. The fallback when the browser refuses
 * storage, and the right choice in tests and on a server. */
export class MemoryStore {
    #entries = new Map();
    get(key) {
        return this.#entries.get(key);
    }
    set(key, value) {
        this.#entries.set(key, value);
    }
    delete(key) {
        this.#entries.delete(key);
    }
    has(key) {
        return this.#entries.has(key);
    }
    keys() {
        return [...this.#entries.keys()].sort();
    }
    clear() {
        this.#entries.clear();
    }
}
export class StorageQuotaError extends Error {
    constructor(key, cause) {
        super(`Storing "${key}" exceeded the browser's storage quota. Free space by deleting old saves, or store large data in IndexedDB via SaveDatabase.`, { cause });
        this.name = "StorageQuotaError";
    }
}
/** Wraps a `Storage` object, translating quota failures into a named error. */
export class WebStorageStore {
    #storage;
    constructor(storage) {
        this.#storage = storage;
    }
    /**
     * Returns a `localStorage`-backed store, or `undefined` with a reason when
     * the browser will not provide one. Probing with a real write is the only
     * reliable test: the object exists in a private window but throws on use.
     */
    static tryCreate(scope = globalThis) {
        const storage = scope.localStorage;
        if (!storage)
            return { unavailable: "This environment has no localStorage." };
        try {
            const probe = "__vapour_probe__";
            storage.setItem(probe, "1");
            storage.removeItem(probe);
            return { store: new WebStorageStore(storage) };
        }
        catch (error) {
            return { unavailable: `localStorage is present but unusable: ${error instanceof Error ? error.message : String(error)}` };
        }
    }
    get(key) {
        return this.#storage.getItem(key) ?? undefined;
    }
    set(key, value) {
        try {
            this.#storage.setItem(key, value);
        }
        catch (error) {
            if (isQuotaError(error))
                throw new StorageQuotaError(key, error);
            throw error;
        }
    }
    delete(key) {
        this.#storage.removeItem(key);
    }
    has(key) {
        return this.#storage.getItem(key) !== null;
    }
    keys() {
        const keys = [];
        for (let index = 0; index < this.#storage.length; index += 1) {
            const key = this.#storage.key(index);
            if (key !== null)
                keys.push(key);
        }
        return keys.sort();
    }
    clear() {
        for (const key of this.keys())
            this.#storage.removeItem(key);
    }
}
/**
 * Prefixes every key, so two games on one origin — or a game and the editor —
 * cannot overwrite each other's settings and saves.
 */
export class NamespacedStore {
    #inner;
    #prefix;
    constructor(inner, namespace) {
        const trimmed = namespace.trim();
        if (!trimmed)
            throw new Error("A storage namespace must not be empty.");
        if (trimmed.includes(":"))
            throw new Error(`A storage namespace must not contain ":" (got "${trimmed}").`);
        this.#inner = inner;
        this.#prefix = `${trimmed}:`;
    }
    get(key) {
        return this.#inner.get(this.#prefix + key);
    }
    set(key, value) {
        this.#inner.set(this.#prefix + key, value);
    }
    delete(key) {
        this.#inner.delete(this.#prefix + key);
    }
    has(key) {
        return this.#inner.has(this.#prefix + key);
    }
    keys() {
        return this.#inner.keys().filter((key) => key.startsWith(this.#prefix)).map((key) => key.slice(this.#prefix.length));
    }
    /** Clears only this namespace, leaving neighbouring namespaces alone. */
    clear() {
        for (const key of this.keys())
            this.#inner.delete(this.#prefix + key);
    }
}
/**
 * The best available persistent store, falling back to memory.
 *
 * Returns the reason persistence is unavailable rather than failing, because a
 * game whose settings will not persist should still run — and should be able to
 * tell the player why.
 */
export function createPersistentStore(namespace, scope) {
    const result = WebStorageStore.tryCreate(scope);
    if ("store" in result) {
        return { store: new NamespacedStore(result.store, namespace), persistent: true };
    }
    return { store: new NamespacedStore(new MemoryStore(), namespace), persistent: false, reason: result.unavailable };
}
function isQuotaError(error) {
    if (typeof DOMException !== "undefined" && error instanceof DOMException) {
        return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED";
    }
    return error instanceof Error && /quota/i.test(error.message);
}
//# sourceMappingURL=storage.js.map