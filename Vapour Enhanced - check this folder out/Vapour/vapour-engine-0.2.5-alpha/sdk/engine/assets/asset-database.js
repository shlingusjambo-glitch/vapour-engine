/** Stable-ID asset index. File moves change only `path`; serialized references
 * continue to use the UUID in `id`. */
export class AssetDatabase extends EventTarget {
    #byId = new Map();
    #byPath = new Map();
    constructor(data = { formatVersion: 1, assets: [] }) {
        super();
        if (data.formatVersion !== 1)
            throw new Error(`Unsupported asset database version ${String(data.formatVersion)}.`);
        for (const record of data.assets)
            this.#insert(validateRecord(record));
        this.#validateDependencies();
    }
    register(input) {
        const path = normalizeAssetPath(input.path);
        const existingId = this.#byPath.get(path);
        if (existingId !== undefined)
            throw new Error(`Asset path '${path}' is already registered as '${existingId}'.`);
        const record = validateRecord({
            ...structuredClone(input),
            id: input.id ?? crypto.randomUUID(),
            path,
            importedAt: input.importedAt ?? new Date().toISOString(),
        });
        this.#insert(record);
        this.#validateDependencies();
        this.#emit("registered", record.id);
        return structuredClone(record);
    }
    get(id) {
        const record = this.#byId.get(id);
        return record === undefined ? undefined : structuredClone(record);
    }
    getByPath(path) {
        const id = this.#byPath.get(normalizeAssetPath(path));
        return id === undefined ? undefined : this.get(id);
    }
    move(id, nextPath) {
        const record = this.#require(id);
        const normalized = normalizeAssetPath(nextPath);
        const collision = this.#byPath.get(normalized);
        if (collision !== undefined && collision !== id)
            throw new Error(`Asset path '${normalized}' is already in use.`);
        this.#byPath.delete(record.path);
        record.path = normalized;
        this.#byPath.set(normalized, id);
        this.#emit("moved", id);
    }
    updateImport(id, contentHash, settings, dependencies) {
        const record = this.#require(id);
        const previous = structuredClone(record);
        record.contentHash = requireNonEmpty(contentHash, "content hash");
        record.importSettings = structuredClone(settings);
        record.dependencies = [...new Set(dependencies)].sort();
        record.importedAt = new Date().toISOString();
        try {
            this.#validateDependencies();
        }
        catch (error) {
            Object.assign(record, previous);
            throw error;
        }
        this.#emit("imported", id);
    }
    dependents(id) {
        this.#require(id);
        return [...this.#byId.values()].filter((record) => record.dependencies.includes(id)).map((record) => record.id).sort();
    }
    remove(id) {
        const record = this.#require(id);
        const dependents = this.dependents(id);
        if (dependents.length > 0)
            throw new Error(`Cannot remove '${id}'; referenced by ${dependents.join(", ")}.`);
        this.#byId.delete(id);
        this.#byPath.delete(record.path);
        this.#emit("removed", id);
    }
    serialize() {
        const assets = [...this.#byId.values()].map((record) => structuredClone(record)).sort((a, b) => a.id.localeCompare(b.id));
        return `${JSON.stringify({ formatVersion: 1, assets }, null, 2)}\n`;
    }
    #insert(record) {
        if (this.#byId.has(record.id))
            throw new Error(`Duplicate asset ID '${record.id}'.`);
        if (this.#byPath.has(record.path))
            throw new Error(`Duplicate asset path '${record.path}'.`);
        this.#byId.set(record.id, structuredClone(record));
        this.#byPath.set(record.path, record.id);
    }
    #require(id) {
        const record = this.#byId.get(id);
        if (record === undefined)
            throw new Error(`Asset '${id}' is not registered.`);
        return record;
    }
    #validateDependencies() {
        for (const record of this.#byId.values()) {
            for (const dependency of record.dependencies) {
                if (!this.#byId.has(dependency))
                    throw new Error(`Asset '${record.id}' references missing asset '${dependency}'.`);
                if (dependency === record.id)
                    throw new Error(`Asset '${record.id}' cannot depend on itself.`);
            }
        }
    }
    #emit(type, id) {
        this.dispatchEvent(new CustomEvent("change", { detail: { type, id } }));
    }
}
function validateRecord(input) {
    return {
        id: requireNonEmpty(input.id, "asset ID"),
        path: normalizeAssetPath(input.path),
        type: requireNonEmpty(input.type, "asset type"),
        contentHash: requireNonEmpty(input.contentHash, "content hash"),
        dependencies: [...new Set(input.dependencies)].sort(),
        importSettings: structuredClone(input.importSettings),
        importedAt: requireNonEmpty(input.importedAt, "import timestamp"),
    };
}
function normalizeAssetPath(value) {
    const path = value.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
    if (path === "" || path.startsWith("/") || path.split("/").includes(".."))
        throw new Error(`Invalid project-relative asset path '${value}'.`);
    return path;
}
function requireNonEmpty(value, label) { const normalized = value.trim(); if (normalized === "")
    throw new Error(`Asset ${label} cannot be empty.`); return normalized; }
//# sourceMappingURL=asset-database.js.map