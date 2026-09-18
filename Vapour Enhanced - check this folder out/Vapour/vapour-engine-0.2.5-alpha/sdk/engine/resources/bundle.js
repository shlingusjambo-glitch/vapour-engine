import { formatResourceKey } from "./handle.js";
/** Validates authored bundle data, rejecting duplicates and empty ids so a
 * malformed bundle fails at load time with a clear message rather than half
 * loading. */
export function validateBundle(data) {
    if (data.formatVersion !== 1)
        throw new Error(`Unsupported resource bundle version ${String(data.formatVersion)}.`);
    const name = data.name.trim();
    if (!name)
        throw new Error("A resource bundle requires a non-empty name.");
    const seen = new Set();
    const resources = data.resources.map((resource) => {
        const type = resource.type.trim();
        const id = resource.id.trim();
        if (!type || !id)
            throw new Error(`Bundle "${name}" contains a resource with an empty type or id.`);
        const label = formatResourceKey({ type, id });
        if (seen.has(label))
            throw new Error(`Bundle "${name}" lists ${label} more than once.`);
        seen.add(label);
        return { type, id };
    });
    return { formatVersion: 1, name, resources };
}
/**
 * A loaded-or-not group of resources.
 *
 * Loading is idempotent: calling {@link load} while already loading returns the
 * same promise, and calling it when loaded resolves immediately. That means a
 * streaming system can call it whenever a region becomes relevant without
 * tracking whether it already did.
 */
export class ResourceBundle {
    #data;
    #manager;
    #handles = [];
    #state = "unloaded";
    #pending;
    constructor(manager, data) {
        this.#manager = manager;
        this.#data = validateBundle(data);
    }
    get name() {
        return this.#data.name;
    }
    get state() {
        return this.#state;
    }
    get resources() {
        return this.#data.resources;
    }
    /** Handles for everything the bundle loaded. Retain one to keep a single
     * resource alive past the bundle's own lifetime. */
    get handles() {
        return this.#handles;
    }
    async load(options = {}) {
        if (this.#state === "loaded")
            return;
        if (this.#pending)
            return this.#pending;
        this.#state = "loading";
        this.#pending = (async () => {
            try {
                this.#handles = await this.#manager.preload(this.#data.resources, options);
                this.#state = "loaded";
            }
            catch (error) {
                this.#state = "failed";
                throw new Error(`Resource bundle "${this.#data.name}" failed to load: ${messageOf(error)}`, { cause: error });
            }
            finally {
                this.#pending = undefined;
            }
        })();
        return this.#pending;
    }
    /** Releases every handle the bundle holds. Safe to call when unloaded. */
    release() {
        for (const handle of this.#handles) {
            if (!handle.released)
                handle.release();
        }
        this.#handles = [];
        this.#state = "unloaded";
    }
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=bundle.js.map