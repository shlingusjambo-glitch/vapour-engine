/** Stable-ID definition database for voxel blocks.
 *
 * The generic payload lets games add mining, crafting, audio, or mod metadata
 * without forking registry behavior. Vapour owns identity validation, conflict
 * policy, deterministic enumeration, fallback lookup, and serialization. */
export class VoxelBlockRegistry {
    #definitions = new Map();
    #fallbackId;
    #maximumId;
    constructor(options = {}) {
        this.#maximumId = options.maximumId ?? 0xffff;
        validateId(this.#maximumId, 0xffff, "maximum block ID");
        this.#fallbackId = options.fallbackId;
        if (this.#fallbackId !== undefined)
            validateId(this.#fallbackId, this.#maximumId, "fallback block ID");
    }
    get size() { return this.#definitions.size; }
    define(definition, options = {}) {
        validateDefinition(definition, this.#maximumId);
        if (this.#definitions.has(definition.id) && options.replace !== true) {
            throw new Error(`Voxel block ID ${String(definition.id)} is already defined.`);
        }
        const stored = Object.freeze({ ...definition });
        this.#definitions.set(definition.id, stored);
        return stored;
    }
    has(id) { return this.#definitions.has(id); }
    get(id) { return this.#definitions.get(id); }
    require(id) {
        const definition = this.#definitions.get(id);
        if (definition !== undefined)
            return definition;
        throw new Error(`Voxel block ID ${String(id)} is not defined.`);
    }
    getOrFallback(id) {
        const definition = this.#definitions.get(id);
        if (definition !== undefined)
            return definition;
        if (this.#fallbackId === undefined)
            throw new Error(`Voxel block ID ${String(id)} is not defined and no fallback is configured.`);
        const fallback = this.#definitions.get(this.#fallbackId);
        if (fallback === undefined)
            throw new Error(`Voxel block fallback ID ${String(this.#fallbackId)} is not defined.`);
        return fallback;
    }
    definitions() {
        return [...this.#definitions.values()].sort((a, b) => a.id - b.id);
    }
    clear() { this.#definitions.clear(); }
    /** Source-control-friendly stable ordering. Payloads must be JSON data; this
     * intentionally rejects functions, cyclic objects, and non-finite numbers. */
    serialize() {
        assertJsonData(this.definitions(), "blocks", new Set());
        const json = JSON.stringify({ version: 1, blocks: this.definitions() });
        if (json === undefined)
            throw new Error("Voxel block definitions are not serializable.");
        return `${json}\n`;
    }
    load(serialized, options = {}) {
        let document;
        try {
            document = JSON.parse(serialized);
        }
        catch (error) {
            throw new Error(`Invalid voxel block database JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (typeof document !== "object" || document === null || document.version !== 1) {
            throw new Error("Unsupported voxel block database version.");
        }
        const blocks = document.blocks;
        if (!Array.isArray(blocks))
            throw new Error("Voxel block database needs a blocks array.");
        for (const block of blocks)
            this.define(block, options);
    }
}
function validateDefinition(definition, maximumId) {
    if (typeof definition !== "object" || definition === null)
        throw new Error("Voxel block definitions must be objects.");
    validateId(definition.id, maximumId, "block ID");
    if (typeof definition.name !== "string" || definition.name.trim() === "")
        throw new Error(`Voxel block ${String(definition.id)} needs a name.`);
}
function validateId(id, maximum, label) {
    if (!Number.isInteger(id) || id < 0 || id > maximum)
        throw new Error(`${label} must be an integer from 0 through ${String(maximum)}.`);
}
function assertJsonData(value, path, ancestors) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error(`Voxel block database '${path}' must be finite.`);
        return;
    }
    if (typeof value !== "object")
        throw new Error(`Voxel block database '${path}' is not JSON data.`);
    if (ancestors.has(value))
        throw new Error(`Voxel block database '${path}' contains a cycle.`);
    ancestors.add(value);
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1)
            assertJsonData(value[index], `${path}[${String(index)}]`, ancestors);
    }
    else {
        for (const [key, child] of Object.entries(value))
            assertJsonData(child, `${path}.${key}`, ancestors);
    }
    ancestors.delete(value);
}
//# sourceMappingURL=voxel-block-registry.js.map