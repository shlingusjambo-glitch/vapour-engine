import type { MeshUpload } from "../render/host/index.js";
import { type VoxelLightField } from "./voxel-lighting.js";
import { type VoxelPalette, type VoxelWorld } from "./voxel-world.js";
export interface VoxelMesh extends MeshUpload {
    readonly blockCount: number;
    readonly faceCount: number;
    /** Per-vertex combined light in [0, 1] (`max(block, sky) / 15`). Present
     * whenever a `light` field was supplied; otherwise every vertex reads 1,
     * matching the unlit brightness this mesher always used. */
    readonly light: Float32Array;
}
export interface VoxelMesherOptions {
    /** Multiplied into each face's colour to give untextured worlds readable
     * directional shading. Defaults to a Minecraft-like soft cube ramp. */
    readonly faceLight?: Readonly<Record<VoxelFaceName, number>>;
    /** When given, each face is additionally lit by the block/sky light sampled
     * just outside it (the same neighbour cell used for face culling), folded
     * into both `colors` and the dedicated `light` output. */
    readonly light?: VoxelLightField;
}
export type VoxelFaceName = "east" | "west" | "top" | "bottom" | "south" | "north";
/** Builds the visible surface of one chunk. Vertices remain chunk-local; draw
 * the result translated by `(chunkX * chunkSize, 0, chunkZ * chunkSize)`.
 * Neighbours are queried through the world, so faces at loaded chunk seams are
 * culled and edits naturally expose the adjacent chunk when both are remeshed. */
export declare function meshVoxelChunk(world: VoxelWorld, palette: VoxelPalette, chunkX: number, chunkZ: number, options?: VoxelMesherOptions): VoxelMesh;
//# sourceMappingURL=voxel-mesher.d.ts.map