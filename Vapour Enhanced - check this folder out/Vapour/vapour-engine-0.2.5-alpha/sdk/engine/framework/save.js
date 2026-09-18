export class SaveVersionError extends Error {
    slot;
    savedVersion;
    currentVersion;
    constructor(slot, savedVersion, currentVersion) {
        super(`Save "${slot}" was written by version ${savedVersion}, but this build reads version ${currentVersion}. Update the game to load it.`);
        this.slot = slot;
        this.savedVersion = savedVersion;
        this.currentVersion = currentVersion;
        this.name = "SaveVersionError";
    }
}
export class SaveCorruptError extends Error {
    constructor(slot, reason, options) {
        super(`Save "${slot}" could not be read: ${reason}`, options);
        this.name = "SaveCorruptError";
    }
}
/** Named save slots over a key-value store. */
export class SaveProfile {
    #store;
    #version;
    #migrations;
    #validate;
    #prefix;
    constructor(options) {
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
    get version() {
        return this.#version;
    }
    save(slot, data) {
        const envelope = {
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
    load(slot) {
        const raw = this.#store.get(this.#key(slot));
        if (raw === undefined)
            return undefined;
        let envelope;
        try {
            envelope = JSON.parse(raw);
        }
        catch (error) {
            throw new SaveCorruptError(slot, "it is not valid JSON", { cause: error });
        }
        if (envelope === null || typeof envelope !== "object" || typeof envelope.version !== "number") {
            throw new SaveCorruptError(slot, "it is missing its version envelope");
        }
        if (envelope.version > this.#version)
            throw new SaveVersionError(slot, envelope.version, this.#version);
        let data = envelope.data;
        for (let version = envelope.version; version < this.#version; version += 1) {
            const migrate = this.#migrations[version];
            if (!migrate) {
                throw new SaveCorruptError(slot, `no migration is registered from version ${version} to ${version + 1}`);
            }
            try {
                data = migrate(data);
            }
            catch (error) {
                throw new SaveCorruptError(slot, `migration from version ${version} failed: ${messageOf(error)}`, { cause: error });
            }
        }
        if (!this.#validate)
            return data;
        try {
            return this.#validate(data);
        }
        catch (error) {
            throw new SaveCorruptError(slot, `it did not pass validation: ${messageOf(error)}`, { cause: error });
        }
    }
    has(slot) {
        return this.#store.has(this.#key(slot));
    }
    delete(slot) {
        this.#store.delete(this.#key(slot));
    }
    /** Slot metadata without deserializing the payload, for a load menu.
     * Unreadable slots are listed with version `0` so the UI can show them as
     * corrupt rather than hiding a save the player believes exists. */
    list() {
        return this.#store
            .keys()
            .filter((key) => key.startsWith(this.#prefix))
            .map((key) => {
            const slot = key.slice(this.#prefix.length);
            const raw = this.#store.get(key) ?? "";
            try {
                const envelope = JSON.parse(raw);
                return { slot, version: Number(envelope.version) || 0, savedAt: String(envelope.savedAt ?? ""), bytes: raw.length };
            }
            catch {
                return { slot, version: 0, savedAt: "", bytes: raw.length };
            }
        })
            .sort((a, b) => a.slot.localeCompare(b.slot));
    }
    #key(slot) {
        const trimmed = slot.trim();
        if (!trimmed)
            throw new Error("A save slot name must not be empty.");
        return this.#prefix + trimmed;
    }
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=save.js.map