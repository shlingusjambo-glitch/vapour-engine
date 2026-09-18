export interface IdentifiedVoxelBlock {
    readonly id: number;
    readonly name: string;
}
export interface VoxelBlockRegistryOptions {
    readonly fallbackId?: number;
    readonly maximumId?: number;
}
export interface VoxelBlockRegistrationOptions {
    /** Plugins and hot reload may intentionally replace a stable ID. Ordinary
     * duplicate definitions are rejected so asset conflicts cannot stay silent. */
    readonly replace?: boolean;
}
/** Stable-ID definition database for voxel blocks.
 *
 * The generic payload lets games add mining, crafting, audio, or mod metadata
 * without forking registry behavior. Vapour owns identity validation, conflict
 * policy, deterministic enumeration, fallback lookup, and serialization. */
export declare class VoxelBlockRegistry<T extends IdentifiedVoxelBlock> {
    #private;
    constructor(options?: VoxelBlockRegistryOptions);
    get size(): number;
    define(definition: T, options?: VoxelBlockRegistrationOptions): Readonly<T>;
    has(id: number): boolean;
    get(id: number): Readonly<T> | undefined;
    require(id: number): Readonly<T>;
    getOrFallback(id: number): Readonly<T>;
    definitions(): readonly Readonly<T>[];
    clear(): void;
    /** Source-control-friendly stable ordering. Payloads must be JSON data; this
     * intentionally rejects functions, cyclic objects, and non-finite numbers. */
    serialize(): string;
    load(serialized: string, options?: VoxelBlockRegistrationOptions): void;
}
//# sourceMappingURL=voxel-block-registry.d.ts.map