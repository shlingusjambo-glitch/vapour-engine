/** Data-oriented section generator and dimension registry.
 *
 * Vapour owns allocation, coordinate traversal, validation, dimension lookup,
 * fallback behavior, and ordered structure passes. Games and plugins supply
 * terrain recipes; they never need to rebuild chunk-loop infrastructure. */
export class VoxelGenerationPipeline {
    sectionSize;
    sectionHeight;
    #fallback;
    #dimensions = new Map();
    #resolvers = [];
    constructor(options = {}) {
        this.sectionSize = positiveInteger("sectionSize", options.sectionSize ?? 16);
        this.sectionHeight = positiveInteger("sectionHeight", options.sectionHeight ?? this.sectionSize);
        this.#fallback = options.fallbackDimension ?? "default";
    }
    register(generator) {
        validateGenerator(generator);
        if (this.#dimensions.has(generator.id))
            throw new Error(`Voxel dimension '${generator.id}' is already registered.`);
        this.#dimensions.set(generator.id, generator);
    }
    registerResolver(resolver) {
        this.#resolvers.push(resolver);
        return () => {
            const index = this.#resolvers.indexOf(resolver);
            if (index >= 0)
                this.#resolvers.splice(index, 1);
        };
    }
    dimensions() { return [...this.#dimensions.keys()].sort(); }
    generate(request) {
        validateRequest(request);
        const generator = this.#resolve(request.dimension);
        const size = this.sectionSize;
        const height = this.sectionHeight;
        const blocks = new Uint16Array(size * height * size);
        const startX = request.x * size;
        const startY = request.y * height;
        const startZ = request.z * size;
        for (let localX = 0; localX < size; localX += 1) {
            for (let localZ = 0; localZ < size; localZ += 1) {
                const base = localZ * size + localX;
                const index = (localY) => {
                    requireLocal("local y", localY, height);
                    return localY * size * size + base;
                };
                generator.generateColumn({
                    blocks, request, sectionSize: size, sectionHeight: height,
                    startX, startY, startZ, localX, localZ,
                    worldX: startX + localX, worldZ: startZ + localZ,
                    index,
                    get: (localY) => blocks[index(localY)],
                    set: (localY, block) => { validateBlock(block); blocks[index(localY)] = block; },
                });
            }
        }
        if (generator.decorate !== undefined) {
            const index = (localX, localY, localZ) => {
                requireLocal("local x", localX, size);
                requireLocal("local y", localY, height);
                requireLocal("local z", localZ, size);
                return localY * size * size + localZ * size + localX;
            };
            const context = {
                blocks, request, sectionSize: size, sectionHeight: height, startX, startY, startZ,
                index,
                get: (x, y, z) => blocks[index(x, y, z)],
                set: (x, y, z, block) => { validateBlock(block); blocks[index(x, y, z)] = block; },
            };
            for (const decorate of generator.decorate)
                decorate(context);
        }
        return blocks;
    }
    #resolve(id) {
        const exact = this.#dimensions.get(id);
        if (exact !== undefined)
            return exact;
        for (const resolver of this.#resolvers) {
            const resolved = resolver(id);
            if (resolved !== undefined) {
                validateGenerator(resolved);
                return resolved;
            }
        }
        const fallback = this.#dimensions.get(this.#fallback);
        if (fallback !== undefined)
            return fallback;
        throw new Error(`Voxel dimension '${id}' is not registered and fallback '${this.#fallback}' is unavailable.`);
    }
}
function validateGenerator(generator) {
    if (generator.id.trim() === "")
        throw new Error("Voxel dimension IDs cannot be empty.");
    if (generator.version !== undefined && (!Number.isInteger(generator.version) || generator.version < 1)) {
        throw new Error(`Voxel dimension '${generator.id}' version must be a positive integer.`);
    }
}
function validateRequest(request) {
    if (![request.x, request.y, request.z].every(Number.isSafeInteger))
        throw new Error("Voxel section coordinates must be safe integers.");
    if (request.dimension.trim() === "")
        throw new Error("Voxel generation needs a dimension ID.");
}
function validateBlock(block) {
    if (!Number.isInteger(block) || block < 0 || block > 0xffff)
        throw new Error("Generated block IDs must be unsigned 16-bit integers.");
}
function positiveInteger(label, value) {
    if (!Number.isInteger(value) || value < 1)
        throw new Error(`${label} must be a positive integer.`);
    return value;
}
function requireLocal(label, value, limit) {
    if (!Number.isInteger(value) || value < 0 || value >= limit)
        throw new RangeError(`${label} ${String(value)} is outside 0..${String(limit - 1)}.`);
}
//# sourceMappingURL=voxel-generation.js.map