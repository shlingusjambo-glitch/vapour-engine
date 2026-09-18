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

export class SaveVersionError extends Error {
  constructor(
    readonly slot: string,
    readonly savedVersion: number,
    readonly currentVersion: number,
  ) {
    super(`Save "${slot}" was written by version ${savedVersion}, but this build reads version ${currentVersion}. Update the game to load it.`);
    this.name = "SaveVersionError";
  }
}

export class SaveCorruptError extends Error {
  constructor(slot: string, reason: string, options?: { cause?: unknown }) {
    super(`Save "${slot}" could not be read: ${reason}`, options);
    this.name = "SaveCorruptError";
  }
}

/** Named save slots over a key-value store. */
export class SaveProfile<T> {
  readonly #store: KeyValueStore;
  readonly #version: number;
  readonly #migrations: Readonly<Record<number, SaveMigration>>;
  readonly #validate: ((data: unknown) => T) | undefined;
  readonly #prefix: string;

  constructor(options: SaveProfileOptions<T>) {
    if (!Number.isInteger(options.version) || options.version < 1) {
      throw new Error("A save profile version must be a whole number of at least 1.");
    }
    this.#store = options.store;
    this.#version = options.version;
    this.#migrations = options.migrations ?? {};
    this.#validate = options.validate;
    this.#prefix = options.keyPrefix ?? "save.";
    for (const key of Object.keys(this.#migrations)) {
      const from = Number(key);
      if (!Number.isInteger(from) || from < 1 || from >= options.version) {
        throw new Error(`Migration key "${key}" must be a whole number between 1 and ${options.version - 1}.`);
      }
    }
  }

  get version(): number {
    return this.#version;
  }

  save(slot: string, data: T): void {
    const envelope: SaveEnvelope<T> = {
      formatVersion: 1,
      version: this.#version,
      savedAt: new Date().toISOString(),
      data,
    };
    this.#store.set(this.#key(slot), JSON.stringify(envelope));
  }

  /**
   * Loads a slot, migrating it forward if needed.
   *
   * Returns `undefined` for an empty slot; throws {@link SaveCorruptError} for
   * unreadable data and {@link SaveVersionError} for a save from a newer build,
   * so a game can tell the player which of the three happened.
   */
  load(slot: string): T | undefined {
    const raw = this.#store.get(this.#key(slot));
    if (raw === undefined) return undefined;

    let envelope: SaveEnvelope<unknown>;
    try {
      envelope = JSON.parse(raw) as SaveEnvelope<unknown>;
    } catch (error) {
      throw new SaveCorruptError(slot, "it is not valid JSON", { cause: error });
    }
    if (envelope === null || typeof envelope !== "object" || typeof envelope.version !== "number") {
      throw new SaveCorruptError(slot, "it is missing its version envelope");
    }
    if (envelope.version > this.#version) throw new SaveVersionError(slot, envelope.version, this.#version);

    let data = envelope.data;
    for (let version = envelope.version; version < this.#version; version += 1) {
      const migrate = this.#migrations[version];
      if (!migrate) {
        throw new SaveCorruptError(slot, `no migration is registered from version ${version} to ${version + 1}`);
      }
      try {
        data = migrate(data);
      } catch (error) {
        throw new SaveCorruptError(slot, `migration from version ${version} failed: ${messageOf(error)}`, { cause: error });
      }
    }

    if (!this.#validate) return data as T;
    try {
      return this.#validate(data);
    } catch (error) {
      throw new SaveCorruptError(slot, `it did not pass validation: ${messageOf(error)}`, { cause: error });
    }
  }

  has(slot: string): boolean {
    return this.#store.has(this.#key(slot));
  }

  delete(slot: string): void {
    this.#store.delete(this.#key(slot));
  }

  /** Slot metadata without deserializing the payload, for a load menu.
   * Unreadable slots are listed with version `0` so the UI can show them as
   * corrupt rather than hiding a save the player believes exists. */
  list(): readonly SaveSlotInfo[] {
    return this.#store
      .keys()
      .filter((key) => key.startsWith(this.#prefix))
      .map((key) => {
        const slot = key.slice(this.#prefix.length);
        const raw = this.#store.get(key) ?? "";
        try {
          const envelope = JSON.parse(raw) as SaveEnvelope<unknown>;
          return { slot, version: Number(envelope.version) || 0, savedAt: String(envelope.savedAt ?? ""), bytes: raw.length };
        } catch {
          return { slot, version: 0, savedAt: "", bytes: raw.length };
        }
      })
      .sort((a, b) => a.slot.localeCompare(b.slot));
  }

  #key(slot: string): string {
    const trimmed = slot.trim();
    if (!trimmed) throw new Error("A save slot name must not be empty.");
    return this.#prefix + trimmed;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
