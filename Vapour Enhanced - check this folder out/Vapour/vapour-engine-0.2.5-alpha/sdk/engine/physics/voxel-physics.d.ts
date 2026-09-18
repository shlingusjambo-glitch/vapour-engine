import type { VoxelPalette, VoxelWorld } from "../voxel/voxel-world.js";
export type VoxelVec3 = [number, number, number];
export interface VoxelRayHit {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly blockId: number;
    readonly distance: number;
    /** Outward normal of the entered block face. Zero when starting in a hit. */
    readonly normal: readonly [number, number, number];
}
/** Amanatides–Woo grid traversal. Runtime cost is proportional to crossed
 * cells, not the number of blocks in the world. */
export declare function raycastVoxels(world: VoxelWorld, palette: VoxelPalette, origin: readonly [number, number, number], direction: readonly [number, number, number], maxDistance: number): VoxelRayHit | undefined;
export interface VoxelBody {
    /** Feet-centre position: X/Z are the body's centre and Y is its bottom. */
    readonly position: VoxelVec3;
    readonly velocity: VoxelVec3;
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    grounded: boolean;
}
export interface VoxelMoveResult {
    readonly collidedX: boolean;
    readonly collidedY: boolean;
    readonly collidedZ: boolean;
    readonly grounded: boolean;
}
/** Sweeps a body independently on X, Y, then Z. Each axis visits voxel planes
 * crossed by the leading face, so fast movement cannot tunnel through a wall.
 * The mutable body is updated in place and does not allocate in steady state. */
export declare function moveVoxelBody(world: VoxelWorld, palette: VoxelPalette, body: VoxelBody, deltaSeconds: number): VoxelMoveResult;
//# sourceMappingURL=voxel-physics.d.ts.map