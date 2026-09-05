export interface SaveDatabaseOptions<Store extends string> {
  readonly name: string;
  readonly version: number;
  readonly stores: readonly Store[];
  readonly openTimeoutMilliseconds?: number;
  readonly indexedDb?: IDBFactory;
  readonly diagnostic?: (message: string, error?: unknown) => void;
}

/** Versioned browser save database with a session-memory safety net.
 *
 * Every write reaches memory first. If IndexedDB is unavailable, blocked, or
 * fails mid-session, gameplay continues and subsequent reads still see writes
 * made during this session. Persistent failures are reported once through the
 * diagnostic callback instead of being silently swallowed. */
export class SaveDatabase<Store extends string> {
  readonly #options: SaveDatabaseOptions<Store>;
  readonly #memory = new Map<Store, Map<IDBValidKey, unknown>>();
  readonly #diagnostics = new Set<string>();
  #database: IDBDatabase | undefined;
  #opening: Promise<void> | undefined;

  constructor(options: SaveDatabaseOptions<Store>) {
    if (options.name.trim() === "") throw new Error("Save database names cannot be empty.");
    if (!Number.isInteger(options.version) || options.version < 1) throw new Error("Save database versions must be positive integers.");
    if (options.stores.length === 0 || new Set(options.stores).size !== options.stores.length) {
      throw new Error("Save databases need unique store names.");
    }
    this.#options = options;
    for (const store of options.stores) this.#memory.set(store, new Map());
  }

  get persistent(): boolean { return this.#database !== undefined; }

  open(): Promise<void> {
    if (this.#opening !== undefined) return this.#opening;
    this.#opening = this.#open();
    return this.#opening;
  }

  close(): void {
    this.#database?.close();
    this.#database = undefined;
    this.#opening = undefined;
  }

  async put<T>(store: Store, key: IDBValidKey, value: T): Promise<void> {
    this.#store(store).set(key, value);
    await this.open();
    if (this.#database === undefined) return;
    try { await request<void>(this.#database, store, "readwrite", (objectStore) => objectStore.put(value, key)); }
    catch (error) { this.#degrade(`write:${store}`, `Save write to '${store}' failed; using session memory.`, error); }
  }

  async get<T>(store: Store, key: IDBValidKey): Promise<T | undefined> {
    await this.open();
    if (this.#database !== undefined) {
      try {
        const value = await request<T | undefined>(this.#database, store, "readonly", (objectStore) => objectStore.get(key));
        if (value !== undefined) { this.#store(store).set(key, value); return value; }
      } catch (error) {
        this.#degrade(`read:${store}`, `Save read from '${store}' failed; using session memory.`, error);
      }
    }
    return this.#store(store).get(key) as T | undefined;
  }

  async delete(store: Store, key: IDBValidKey): Promise<void> {
    this.#store(store).delete(key);
    await this.open();
    if (this.#database === undefined) return;
    try { await request<void>(this.#database, store, "readwrite", (objectStore) => objectStore.delete(key)); }
    catch (error) { this.#degrade(`delete:${store}`, `Save delete from '${store}' failed.`, error); }
  }

  async keys(store: Store): Promise<readonly IDBValidKey[]> {
    await this.open();
    if (this.#database !== undefined) {
      try { return await request<IDBValidKey[]>(this.#database, store, "readonly", (objectStore) => objectStore.getAllKeys()); }
      catch (error) { this.#degrade(`keys:${store}`, `Save key listing for '${store}' failed; using session memory.`, error); }
    }
    return [...this.#store(store).keys()];
  }

  async values<T>(store: Store): Promise<readonly T[]> {
    await this.open();
    if (this.#database !== undefined) {
      try {
        const values = await request<T[]>(this.#database, store, "readonly", (objectStore) => objectStore.getAll());
        return values;
      } catch (error) { this.#degrade(`values:${store}`, `Save listing for '${store}' failed; using session memory.`, error); }
    }
    return [...this.#store(store).values()] as T[];
  }

  async deletePrefix(store: Store, prefix: string): Promise<number> {
    const keys = await this.keys(store);
    const matches = keys.filter((key) => typeof key === "string" && key.startsWith(prefix));
    await Promise.all(matches.map((key) => this.delete(store, key)));
    return matches.length;
  }

  async clear(store: Store): Promise<void> {
    this.#store(store).clear();
    await this.open();
    if (this.#database === undefined) return;
    try { await request<void>(this.#database, store, "readwrite", (objectStore) => objectStore.clear()); }
    catch (error) { this.#degrade(`clear:${store}`, `Clearing save store '${store}' failed.`, error); }
  }

  async clearAll(): Promise<void> { await Promise.all(this.#options.stores.map((store) => this.clear(store))); }

  async #open(): Promise<void> {
    const factory = this.#options.indexedDb ?? globalThis.indexedDB;
    if (factory === undefined) { this.#warn("unavailable", "IndexedDB is unavailable; saves will remain in session memory."); return; }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (database?: IDBDatabase): void => {
        if (settled) { database?.close(); return; }
        settled = true;
        clearTimeout(timeout);
        this.#database = database;
        if (database !== undefined) database.onversionchange = () => this.close();
        resolve();
      };
      const timeout = setTimeout(() => {
        this.#warn("open-timeout", "IndexedDB open timed out; saves will use session memory.");
        finish();
      }, this.#options.openTimeoutMilliseconds ?? 2_000);
      try {
        const opening = factory.open(this.#options.name, this.#options.version);
        opening.onupgradeneeded = () => {
          const database = opening.result;
          for (const store of this.#options.stores) {
            if (!database.objectStoreNames.contains(store)) database.createObjectStore(store);
          }
        };
        opening.onsuccess = () => finish(opening.result);
        opening.onerror = () => { this.#warn("open-error", "IndexedDB could not open; saves will use session memory.", opening.error); finish(); };
        opening.onblocked = () => { this.#warn("open-blocked", "IndexedDB upgrade is blocked by another page; saves will use session memory."); finish(); };
      } catch (error) { this.#warn("open-throw", "IndexedDB initialization failed; saves will use session memory.", error); finish(); }
    });
  }

  #store(store: Store): Map<IDBValidKey, unknown> {
    const memory = this.#memory.get(store);
    if (memory === undefined) throw new Error(`Save store '${store}' is not declared.`);
    return memory;
  }

  #degrade(key: string, message: string, error: unknown): void {
    this.#warn(key, message, error);
    this.#database?.close();
    this.#database = undefined;
  }

  #warn(key: string, message: string, error?: unknown): void {
    if (this.#diagnostics.has(key)) return;
    this.#diagnostics.add(key);
    this.#options.diagnostic?.(message, error);
  }
}

function request<T>(
  database: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      const transaction = database.transaction(store, mode);
      const pending = operation(transaction.objectStore(store));
      pending.onsuccess = () => resolve(pending.result as T);
      pending.onerror = () => reject(pending.error ?? transaction.error ?? new Error(`IndexedDB operation on '${store}' failed.`));
      transaction.onabort = () => reject(transaction.error ?? new Error(`IndexedDB transaction on '${store}' aborted.`));
    } catch (error) { reject(error); }
  });
}
