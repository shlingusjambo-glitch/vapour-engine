import type { ProceduralSeed } from "../world/procedural-noise.js";
export interface VoxelSectionRequest {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly dimension: string;
    readonly seed: ProceduralSeed;
}
export interface VoxelColumnGenerationContext {
    readonly blocks: Uint16Array;
    readonly request: VoxelSectionRequest;
    readonly sectionSize: number;
    readonly sectionHeight: number;
    readonly startX: number;
    readonly startY: number;
    readonly startZ: number;
    readonly localX: number;
    readonly localZ: number;
    readonly worldX: number;
    readonly worldZ: number;
    index(localY: number): number;
    get(localY: number): number;
    set(localY: number, block: number): void;
}
export interface VoxelSectionGenerationContext {
    readonly blocks: Uint16Array;
    readonly request: VoxelSectionRequest;
    readonly sectionSize: number;
    readonly sectionHeight: number;
    readonly startX: number;
    readonly startY: number;
    readonly startZ: number;
    index(localX: number, localY: number, localZ: number): number;
    get(localX: number, localY: number, localZ: number): number;
    set(localX: number, localY: number, localZ: number, block: number): void;
}
export interface VoxelDimensionGenerator {
    readonly id: string;
    readonly version?: number;
    generateColumn(context: VoxelColumnGenerationContext): void;
    /** Ordered post-column passes for structures, foliage, ores, and authored
     * overlays. Each pass sees output from every previous pass. */
    readonly decorate?: readonly ((context: VoxelSectionGenerationContext) => void)[];
}
export interface VoxelGenerationPipelineOptions {
    readonly sectionSize?: number;
    readonly sectionHeight?: number;
    readonly fallbackDimension?: string;
}
export type VoxelDimensionResolver = (id: string) => VoxelDimensionGenerator | undefined;
/** Data-oriented section generator and dimension registry.
 *
 * Vapour owns allocation, coordinate traversal, validation, dimension lookup,
 * fallback behavior, and ordered structure passes. Games and plugins supply
 * terrain recipes; they never need to rebuild chunk-loop infrastructure. */
export declare class VoxelGenerationPipeline {
    #private;
    readonly sectionSize: number;
    readonly sectionHeight: number;
    constructor(options?: VoxelGenerationPipelineOptions);
    register(generator: VoxelDimensionGenerator): void;
    registerResolver(resolver: VoxelDimensionResolver): () => void;
    dimensions(): readonly string[];
    generate(request: VoxelSectionRequest): Uint16Array;
}
//# sourceMappingURL=voxel-generation.d.ts.map