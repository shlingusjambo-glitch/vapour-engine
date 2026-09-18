export const AIR_BLOCK = 0;
export const MAX_BLOCK_ID = 0xffff;
/** Stable block metadata. The world stores only compact numeric IDs; gameplay,
 * physics, and rendering resolve their meaning through this shared palette. */
export class VoxelPalette {
    #blocks = new Map();
    constructor(definitions = []) {
        this.#blocks.set(AIR_BLOCK, {
            id: AIR_BLOCK,
            name: "Air",
            solid: false,
            opaque: false,
            color: [0, 0, 0, 0],
        });
        for (const definition of definitions)
            this.define(definition);
    }
    define(definition) {
        validateBlockId(definition.id);
        if (definition.id === AIR_BLOCK)
            throw new Error("Block 0 is reserved for air.");
        if (definition.name.trim() === "")
            throw new Error(`Block ${String(definition.id)} needs a name.`);
        if (this.#blocks.has(definition.id))
            throw new Error(`Block ${String(definition.id)} is already defined.`);
        if (definition.color.length !== 4 || definition.color.some((value) => !Number.isFinite(value))) {
            throw new Error(`Block '${definition.name}' needs four finite colour channels.`);
        }
        if (definition.emission !== undefined && (!Number.isInteger(definition.emission) || definition.emission < 0 || definition.emission > 15)) {
            throw new Error(`Block '${definition.name}' emission must be an integer from 0 through 15.`);
        }
        const color = [
            definition.color[0],
            definition.color[1],
            definition.color[2],
            definition.color[3],
        ];
        this.#blocks.set(definition.id, Object.freeze({ ...definition, color }));
    }
    get(id) {
        return this.#blocks.get(id);
    }
    require(id) {
        const definition = this.#blocks.get(id);
        if (definition === undefined)
            throw new Error(`Voxel palette does not define block ${String(id)}.`);
        return definition;
    }
    isSolid(id) {
        return this.#blocks.get(id)?.solid ?? false;
    }
    isOpaque(id) {
        return this.#blocks.get(id)?.opaque ?? false;
    }
    definitions() {
        return [...this.#blocks.values()];
    }
}
/** Dense storage for one vertical voxel column. Data order is Y-major inside
 * Z rows and X columns: neighbouring X samples are adjacent in memory. */
export class VoxelChunk {
    x;
    z;
    size;
    height;
    blocks;
    #revision = 0;
    constructor(x, z, size, height, blocks) {
        requireInteger("chunk x", x);
        requireInteger("chunk z", z);
        requirePositiveInteger("chunk size", size);
        requirePositiveInteger("chunk height", height);
        const expected = size * size * height;
        if (blocks !== undefined && blocks.length !== expected) {
            throw new Error(`Chunk (${String(x)}, ${String(z)}) needs ${String(expected)} blocks, received ${String(blocks.length)}.`);
        }
        this.x = x;
        this.z = z;
        this.size = size;
        this.height = height;
        this.blocks = blocks?.slice() ?? new Uint16Array(expected);
    }
    get revision() {
        return this.#revision;
    }
    block(localX, y, localZ) {
        return this.blocks[this.index(localX, y, localZ)];
    }
    setBlock(localX, y, localZ, id) {
        validateBlockId(id);
        const index = this.index(localX, y, localZ);
        if (this.blocks[index] === id)
            return false;
        this.blocks[index] = id;
        this.#revision += 1;
        return true;
    }
    /** Replaces all blocks in one operation, suitable for worker-generated data. */
    replace(blocks) {
        if (blocks.length !== this.blocks.length) {
            throw new Error(`Replacement chunk needs ${String(this.blocks.length)} blocks, received ${String(blocks.length)}.`);
        }
        this.blocks.set(blocks);
        this.#revision += 1;
    }
    index(localX, y, localZ) {
        requireInteger("local x", localX);
        requireInteger("voxel y", y);
        requireInteger("local z", localZ);
        if (localX < 0 || localX >= this.size || localZ < 0 || localZ >= this.size || y < 0 || y >= this.height) {
            throw new RangeError(`Voxel (${String(localX)}, ${String(y)}, ${String(localZ)}) is outside a ${String(this.size)}×${String(this.height)}×${String(this.size)} chunk.`);
        }
        return (y * this.size + localZ) * this.size + localX;
    }
}
/** Chunked, unbounded X/Z voxel storage. Missing chunks and out-of-height Y
 * samples are air, which lets mesh and physics queries cross chunk boundaries
 * without special cases. */
export class VoxelWorld {
    chunkSize;
    height;
    #chunks = new Map();
    #dirty = new Set();
    constructor(options = {}) {
        this.chunkSize = options.chunkSize ?? 16;
        this.height = options.height ?? 128;
        requirePositiveInteger("chunkSize", this.chunkSize);
        requirePositiveInteger("height", this.height);
    }
    get chunkCount() {
        return this.#chunks.size;
    }
    chunk(chunkX, chunkZ) {
        requireInteger("chunk x", chunkX);
        requireInteger("chunk z", chunkZ);
        return this.#chunks.get(chunkKey(chunkX, chunkZ));
    }
    ensureChunk(chunkX, chunkZ) {
        requireInteger("chunk x", chunkX);
        requireInteger("chunk z", chunkZ);
        const key = chunkKey(chunkX, chunkZ);
        let chunk = this.#chunks.get(key);
        if (chunk === undefined) {
            chunk = new VoxelChunk(chunkX, chunkZ, this.chunkSize, this.height);
            this.#chunks.set(key, chunk);
            this.#dirty.add(key);
        }
        return chunk;
    }
    /** Installs worker-generated chunk storage and owns a defensive copy. */
    setChunk(chunkX, chunkZ, blocks) {
        const chunk = new VoxelChunk(chunkX, chunkZ, this.chunkSize, this.height, blocks);
        this.#chunks.set(chunkKey(chunkX, chunkZ), chunk);
        this.#markChunkAndNeighbours(chunkX, chunkZ);
        return chunk;
    }
    deleteChunk(chunkX, chunkZ) {
        const removed = this.#chunks.delete(chunkKey(chunkX, chunkZ));
        if (removed)
            this.#markChunkAndNeighbours(chunkX, chunkZ);
        return removed;
    }
    getBlock(x, y, z) {
        requireInteger("voxel x", x);
        requireInteger("voxel y", y);
        requireInteger("voxel z", z);
        if (y < 0 || y >= this.height)
            return AIR_BLOCK;
        const chunkX = floorDiv(x, this.chunkSize);
        const chunkZ = floorDiv(z, this.chunkSize);
        const chunk = this.#chunks.get(chunkKey(chunkX, chunkZ));
        if (chunk === undefined)
            return AIR_BLOCK;
        return chunk.block(floorMod(x, this.chunkSize), y, floorMod(z, this.chunkSize));
    }
    setBlock(x, y, z, id) {
        requireInteger("voxel x", x);
        requireInteger("voxel y", y);
        requireInteger("voxel z", z);
        validateBlockId(id);
        if (y < 0 || y >= this.height)
            throw new RangeError(`Voxel y ${String(y)} is outside world height ${String(this.height)}.`);
        const chunkX = floorDiv(x, this.chunkSize);
        const chunkZ = floorDiv(z, this.chunkSize);
        const localX = floorMod(x, this.chunkSize);
        const localZ = floorMod(z, this.chunkSize);
        const chunk = this.ensureChunk(chunkX, chunkZ);
        if (!chunk.setBlock(localX, y, localZ, id))
            return false;
        this.#dirty.add(chunkKey(chunkX, chunkZ));
        if (localX === 0)
            this.#dirty.add(chunkKey(chunkX - 1, chunkZ));
        if (localX === this.chunkSize - 1)
            this.#dirty.add(chunkKey(chunkX + 1, chunkZ));
        if (localZ === 0)
            this.#dirty.add(chunkKey(chunkX, chunkZ - 1));
        if (localZ === this.chunkSize - 1)
            this.#dirty.add(chunkKey(chunkX, chunkZ + 1));
        return true;
    }
    chunks() {
        return this.#chunks.values();
    }
    /** Returns dirty coordinates in stable order and clears the queue. Missing
     * coordinates are included after edge edits/removals so callers can release
     * an old mesh or remesh a now-exposed neighbour. */
    takeDirtyChunks() {
        const dirty = [...this.#dirty].map(parseChunkKey);
        this.#dirty.clear();
        dirty.sort((a, b) => a.z - b.z || a.x - b.x);
        return dirty;
    }
    markDirty(chunkX, chunkZ) {
        requireInteger("chunk x", chunkX);
        requireInteger("chunk z", chunkZ);
        this.#dirty.add(chunkKey(chunkX, chunkZ));
    }
    #markChunkAndNeighbours(chunkX, chunkZ) {
        this.#dirty.add(chunkKey(chunkX, chunkZ));
        this.#dirty.add(chunkKey(chunkX - 1, chunkZ));
        this.#dirty.add(chunkKey(chunkX + 1, chunkZ));
        this.#dirty.add(chunkKey(chunkX, chunkZ - 1));
        this.#dirty.add(chunkKey(chunkX, chunkZ + 1));
    }
}
export function floorDiv(value, divisor) {
    return Math.floor(value / divisor);
}
export function floorMod(value, divisor) {
    return value - floorDiv(value, divisor) * divisor;
}
export function chunkKey(x, z) {
    return `${String(x)},${String(z)}`;
}
function parseChunkKey(key) {
    const separator = key.indexOf(",");
    return { x: Number(key.slice(0, separator)), z: Number(key.slice(separator + 1)) };
}
function validateBlockId(id) {
    if (!Number.isInteger(id) || id < AIR_BLOCK || id > MAX_BLOCK_ID) {
        throw new Error(`Block IDs must be integers from 0 through ${String(MAX_BLOCK_ID)}; received ${String(id)}.`);
    }
}
function requireInteger(label, value) {
    if (!Number.isInteger(value))
        throw new Error(`${label} must be an integer; received ${String(value)}.`);
}
function requirePositiveInteger(label, value) {
    if (!Number.isInteger(value) || value < 1)
        throw new Error(`${label} must be a positive integer; received ${String(value)}.`);
}
//# sourceMappingURL=voxel-world.js.map