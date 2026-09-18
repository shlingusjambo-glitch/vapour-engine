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
export declare class SaveDatabase<Store extends string> {
    #private;
    constructor(options: SaveDatabaseOptions<Store>);
    get persistent(): boolean;
    open(): Promise<void>;
    close(): void;
    put<T>(store: Store, key: IDBValidKey, value: T): Promise<void>;
    get<T>(store: Store, key: IDBValidKey): Promise<T | undefined>;
    delete(store: Store, key: IDBValidKey): Promise<void>;
    keys(store: Store): Promise<readonly IDBValidKey[]>;
    values<T>(store: Store): Promise<readonly T[]>;
    deletePrefix(store: Store, prefix: string): Promise<number>;
    clear(store: Store): Promise<void>;
    clearAll(): Promise<void>;
}
//# sourceMappingURL=save-database.d.ts.map