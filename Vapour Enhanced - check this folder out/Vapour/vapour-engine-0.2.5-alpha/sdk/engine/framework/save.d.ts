/** Save slots with versioning and migrations.
 *
 * The problem a save system actually has to solve is not writing JSON — it is
 * that a shipped game's save files outlive the code that wrote them. A player
 * who updates mid-playthrough must not lose their progress because a field was
 * renamed.
 *
 * So a save profile declares a **current version** and a chain of migrations,
 * and loading an older save runs it forward through them. A save from a
 * *newer* version than the running build is refused rather than misread,
 * because silently dropping fields the build does not understand is how a
 * downgrade corrupts a playthrough.
 */
import type { KeyValueStore } from "./storage.js";
export interface SaveEnvelope<T> {
    readonly formatVersion: 1;
    readonly version: number;
    readonly savedAt: string;
    readonly data: T;
}
export interface SaveSlotInfo {
    readonly slot: string;
    readonly version: number;
    readonly savedAt: string;
    readonly bytes: number;
}
/** Transforms save data from `from` to `from + 1`. */
export type SaveMigration = (data: unknown) => unknown;
export interface SaveProfileOptions<T> {
    readonly store: KeyValueStore;
    /** The version this build writes. */
    readonly version: number;
    /**
     * Migrations keyed by the version they upgrade *from*. Loading a version-2
     * save into a version-4 build runs `migrations[2]` then `migrations[3]`.
     */
    readonly migrations?: Readonly<Record<number, SaveMigration>>;
    /** Validates migrated data before it reaches the game. */
    readonly validate?: (data: unknown) => T;
    /** Prefix for slot keys within the store. */
    readonly keyPrefix?: string;
}
export declare class SaveVersionError extends Error {
    readonly slot: string;
    readonly savedVersion: number;
    readonly currentVersion: number;
    constructor(slot: string, savedVersion: number, currentVersion: number);
}
export declare class SaveCorruptError extends Error {
    constructor(slot: string, reason: string, options?: {
        cause?: unknown;
    });
}
/** Named save slots over a key-value store. */
export declare class SaveProfile<T> {
    #private;
    constructor(options: SaveProfileOptions<T>);
    get version(): number;
    save(slot: string, data: T): void;
    /**
     * Loads a slot, migrating it forward if needed.
     *
     * Returns `undefined` for an empty slot; throws {@link SaveCorruptError} for
     * unreadable data and {@link SaveVersionError} for a save from a newer build,
     * so a game can tell the player which of the three happened.
     */
    load(slot: string): T | undefined;
    has(slot: string): boolean;
    delete(slot: string): void;
    /** Slot metadata without deserializing the payload, for a load menu.
     * Unreadable slots are listed with version `0` so the UI can show them as
     * corrupt rather than hiding a save the player believes exists. */
    list(): readonly SaveSlotInfo[];
}
//# sourceMappingURL=save.d.ts.map