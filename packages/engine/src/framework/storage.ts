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
export class MemoryStore implements KeyValueStore {
  readonly #entries = new Map<string, string>();

  get(key: string): string | undefined {
    return this.#entries.get(key);
  }

  set(key: string, value: string): void {
    this.#entries.set(key, value);
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  keys(): readonly string[] {
    return [...this.#entries.keys()].sort();
  }

  clear(): void {
    this.#entries.clear();
  }
}

/** Minimal shape of `window.localStorage`, so the store is testable. */
export interface WebStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class StorageQuotaError extends Error {
  constructor(key: string, cause: unknown) {
    super(`Storing "${key}" exceeded the browser's storage quota. Free space by deleting old saves, or store large data in IndexedDB via SaveDatabase.`, { cause });
    this.name = "StorageQuotaError";
  }
}

/** Wraps a `Storage` object, translating quota failures into a named error. */
export class WebStorageStore implements KeyValueStore {
  readonly #storage: WebStorageLike;

  constructor(storage: WebStorageLike) {
    this.#storage = storage;
  }

  /**
   * Returns a `localStorage`-backed store, or `undefined` with a reason when
   * the browser will not provide one. Probing with a real write is the only
   * reliable test: the object exists in a private window but throws on use.
   */
  static tryCreate(scope: { localStorage?: WebStorageLike } = globalThis as { localStorage?: WebStorageLike }): { store: WebStorageStore } | { unavailable: string } {
    const storage = scope.localStorage;
    if (!storage) return { unavailable: "This environment has no localStorage." };
    try {
      const probe = "__vapour_probe__";
      storage.setItem(probe, "1");
      storage.removeItem(probe);
      return { store: new WebStorageStore(storage) };
    } catch (error) {
      return { unavailable: `localStorage is present but unusable: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  get(key: string): string | undefined {
    return this.#storage.getItem(key) ?? undefined;
  }

  set(key: string, value: string): void {
    try {
      this.#storage.setItem(key, value);
    } catch (error) {
      if (isQuotaError(error)) throw new StorageQuotaError(key, error);
      throw error;
    }
  }

  delete(key: string): void {
    this.#storage.removeItem(key);
  }

  has(key: string): boolean {
    return this.#storage.getItem(key) !== null;
  }

  keys(): readonly string[] {
    const keys: string[] = [];
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index);
      if (key !== null) keys.push(key);
    }
    return keys.sort();
  }

  clear(): void {
    for (const key of this.keys()) this.#storage.removeItem(key);
  }
}

/**
 * Prefixes every key, so two games on one origin — or a game and the editor —
 * cannot overwrite each other's settings and saves.
 */
export class NamespacedStore implements KeyValueStore {
  readonly #inner: KeyValueStore;
  readonly #prefix: string;

  constructor(inner: KeyValueStore, namespace: string) {
    const trimmed = namespace.trim();
    if (!trimmed) throw new Error("A storage namespace must not be empty.");
    if (trimmed.includes(":")) throw new Error(`A storage namespace must not contain ":" (got "${trimmed}").`);
    this.#inner = inner;
    this.#prefix = `${trimmed}:`;
  }

  get(key: string): string | undefined {
    return this.#inner.get(this.#prefix + key);
  }

  set(key: string, value: string): void {
    this.#inner.set(this.#prefix + key, value);
  }

  delete(key: string): void {
    this.#inner.delete(this.#prefix + key);
  }

  has(key: string): boolean {
    return this.#inner.has(this.#prefix + key);
  }

  keys(): readonly string[] {
    return this.#inner.keys().filter((key) => key.startsWith(this.#prefix)).map((key) => key.slice(this.#prefix.length));
  }

  /** Clears only this namespace, leaving neighbouring namespaces alone. */
  clear(): void {
    for (const key of this.keys()) this.#inner.delete(this.#prefix + key);
  }
}

/**
 * The best available persistent store, falling back to memory.
 *
 * Returns the reason persistence is unavailable rather than failing, because a
 * game whose settings will not persist should still run — and should be able to
 * tell the player why.
 */
export function createPersistentStore(namespace: string, scope?: { localStorage?: WebStorageLike }): { store: KeyValueStore; persistent: boolean; reason?: string } {
  const result = WebStorageStore.tryCreate(scope);
  if ("store" in result) {
    return { store: new NamespacedStore(result.store, namespace), persistent: true };
  }
  return { store: new NamespacedStore(new MemoryStore(), namespace), persistent: false, reason: result.unavailable };
}

function isQuotaError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED";
  }
  return error instanceof Error && /quota/i.test(error.message);
}
