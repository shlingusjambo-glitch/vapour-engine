export declare const AIR_BLOCK = 0;
export declare const MAX_BLOCK_ID = 65535;
export interface VoxelWorldOptions {
    /** Horizontal chunk edge length. Defaults to 16 blocks. */
    readonly chunkSize?: number;
    /** Vertical blocks stored by every chunk. Defaults to 128. */
    readonly height?: number;
}
export interface VoxelChunkCoordinate {
    readonly x: number;
    readonly z: number;
}
export interface VoxelBlockDefinition {
    readonly id: number;
    readonly name: string;
    /** Participates in body collision and block-selection raycasts. */
    readonly solid: boolean;
    /** Hides an adjacent face. False for leaves, glass, and liquids. */
    readonly opaque: boolean;
    /** Linear RGBA vertex colour used by the standard voxel mesher. */
    readonly color: readonly [number, number, number, number];
    /** Block light level this block emits, 0 (none) through 15 (a torch/lava
     * equivalent). Defaults to 0. See `VoxelLightField`. */
    readonly emission?: number;
}
/** Stable block metadata. The world stores only compact numeric IDs; gameplay,
 * physics, and rendering resolve their meaning through this shared palette. */
export declare class VoxelPalette {
    #private;
    constructor(definitions?: readonly VoxelBlockDefinition[]);
    define(definition: VoxelBlockDefinition): void;
    get(id: number): VoxelBlockDefinition | undefined;
    require(id: number): VoxelBlockDefinition;
    isSolid(id: number): boolean;
    isOpaque(id: number): boolean;
    definitions(): readonly VoxelBlockDefinition[];
}
/** Dense storage for one vertical voxel column. Data order is Y-major inside
 * Z rows and X columns: neighbouring X samples are adjacent in memory. */
export declare class VoxelChunk {
    #private;
    readonly x: number;
    readonly z: number;
    readonly size: number;
    readonly height: number;
    readonly blocks: Uint16Array;
    constructor(x: number, z: number, size: number, height: number, blocks?: Uint16Array);
    get revision(): number;
    block(localX: number, y: number, localZ: number): number;
    setBlock(localX: number, y: number, localZ: number, id: number): boolean;
    /** Replaces all blocks in one operation, suitable for worker-generated data. */
    replace(blocks: Uint16Array): void;
    index(localX: number, y: number, localZ: number): number;
}
/** Chunked, unbounded X/Z voxel storage. Missing chunks and out-of-height Y
 * samples are air, which lets mesh and physics queries cross chunk boundaries
 * without special cases. */
export declare class VoxelWorld {
    #private;
    readonly chunkSize: number;
    readonly height: number;
    constructor(options?: VoxelWorldOptions);
    get chunkCount(): number;
    chunk(chunkX: number, chunkZ: number): VoxelChunk | undefined;
    ensureChunk(chunkX: number, chunkZ: number): VoxelChunk;
    /** Installs worker-generated chunk storage and owns a defensive copy. */
    setChunk(chunkX: number, chunkZ: number, blocks: Uint16Array): VoxelChunk;
    deleteChunk(chunkX: number, chunkZ: number): boolean;
    getBlock(x: number, y: number, z: number): number;
    setBlock(x: number, y: number, z: number, id: number): boolean;
    chunks(): IterableIterator<VoxelChunk>;
    /** Returns dirty coordinates in stable order and clears the queue. Missing
     * coordinates are included after edge edits/removals so callers can release
     * an old mesh or remesh a now-exposed neighbour. */
    takeDirtyChunks(): readonly VoxelChunkCoordinate[];
    markDirty(chunkX: number, chunkZ: number): void;
}
export declare function floorDiv(value: number, divisor: number): number;
export declare function floorMod(value: number, divisor: number): number;
export declare function chunkKey(x: number, z: number): string;
//# sourceMappingURL=voxel-world.d.ts.map