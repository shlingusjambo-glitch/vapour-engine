export type AssetId = string;
export interface AssetRecord {
    readonly id: AssetId;
    path: string;
    type: string;
    contentHash: string;
    dependencies: AssetId[];
    importSettings: Record<string, unknown>;
    importedAt: string;
}
export interface AssetDatabaseData {
    readonly formatVersion: 1;
    readonly assets: AssetRecord[];
}
/** Stable-ID asset index. File moves change only `path`; serialized references
 * continue to use the UUID in `id`. */
export declare class AssetDatabase extends EventTarget {
    #private;
    constructor(data?: AssetDatabaseData);
    register(input: Omit<AssetRecord, "id" | "importedAt"> & {
        id?: AssetId;
        importedAt?: string;
    }): AssetRecord;
    get(id: AssetId): Readonly<AssetRecord> | undefined;
    getByPath(path: string): Readonly<AssetRecord> | undefined;
    move(id: AssetId, nextPath: string): void;
    updateImport(id: AssetId, contentHash: string, settings: Record<string, unknown>, dependencies: readonly AssetId[]): void;
    dependents(id: AssetId): readonly AssetId[];
    remove(id: AssetId): void;
    serialize(): string;
}
//# sourceMappingURL=asset-database.d.ts.map