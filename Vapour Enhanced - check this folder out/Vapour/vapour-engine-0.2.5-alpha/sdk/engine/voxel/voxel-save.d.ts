/** Voxel world save format and multiplayer chunk sync.
 *
 * Chunk storage is a flat `Uint16Array`, and real terrain is overwhelmingly
 * one block repeated for long runs (air above, stone below) — run-length
 * encoding a chunk typically needs a few dozen `(blockId, count)` pairs
 * instead of thousands of block IDs, with no third-party dependency and no
 * lossy step: decoding reproduces the exact input array.
 *
 * `encodeWorld`/`decodeWorld` add a small index (chunk coordinate + byte
 * range) so a save file is one buffer rather than one file per chunk, and
 * `takeDirtyChunks` (already on `VoxelWorld`) lets a save loop persist only
 * what changed since the last save.
 *
 * The sync message types below are *shapes and a pure reducer*, not a
 * transport: `packages/net` (owned separately) is where a real socket would
 * carry these — see `docs/world-streaming.md` for the integration point. That
 * separation is what makes `applyVoxelSyncMessage` testable with no network at
 * all.
 */
import { VoxelChunk, type VoxelWorld } from "./voxel-world.js";
export declare const VOXEL_CHUNK_FORMAT_VERSION = 1;
/** Run-length encodes one chunk's blocks into a compact, versioned buffer. */
export declare function encodeChunk(chunk: VoxelChunk): Uint8Array;
/** Decodes a buffer from `encodeChunk` back into a `VoxelChunk`, byte for
 * byte the same blocks as the original. */
export declare function decodeChunk(bytes: Uint8Array): VoxelChunk;
export interface WorldSaveIndexEntry {
    readonly x: number;
    readonly z: number;
    readonly byteOffset: number;
    readonly byteLength: number;
}
export interface WorldSave {
    readonly version: typeof VOXEL_CHUNK_FORMAT_VERSION;
    readonly chunkSize: number;
    readonly height: number;
    readonly index: readonly WorldSaveIndexEntry[];
    readonly data: Uint8Array;
}
export interface EncodeWorldOptions {
    /** Encode only these coordinates (e.g. from `world.takeDirtyChunks()`)
     * instead of every loaded chunk — an incremental save. */
    readonly only?: readonly {
        readonly x: number;
        readonly z: number;
    }[];
}
/** Serializes a world's loaded chunks into one buffer plus an index, so a
 * save is one write instead of one file per chunk. Chunk order is the
 * iteration order of `only` when given, else the world's own chunk order —
 * both stable and deterministic for a fixed world. */
export declare function encodeWorld(world: VoxelWorld, options?: EncodeWorldOptions): WorldSave;
/** Installs every chunk from a `WorldSave` into a world via `setChunk`. */
export declare function decodeWorld(world: VoxelWorld, save: WorldSave): void;
export interface VoxelChunkRequest {
    readonly type: "voxel-chunk-request";
    readonly x: number;
    readonly z: number;
}
export interface VoxelChunkResponse {
    readonly type: "voxel-chunk-response";
    readonly x: number;
    readonly z: number;
    /** An `encodeChunk` buffer. */
    readonly data: Uint8Array;
}
export interface VoxelBlockEdit {
    readonly type: "voxel-block-edit";
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly id: number;
}
export type VoxelSyncMessage = VoxelChunkRequest | VoxelChunkResponse | VoxelBlockEdit;
/** Builds the response a server sends for a `VoxelChunkRequest`, or
 * `undefined` if that chunk is not loaded (the caller decides whether that
 * means "generate it" or "not part of this world"). */
export declare function respondToChunkRequest(world: VoxelWorld, request: VoxelChunkRequest): VoxelChunkResponse | undefined;
/**
 * Applies one sync message to a world. Pure with respect to its inputs: the
 * same world state plus the same message always produces the same result, so
 * this can run identically on a server applying an edit and a client applying
 * the broadcast of that edit.
 *
 * A `voxel-chunk-request` has no effect here — answering it is
 * `respondToChunkRequest`, called by whichever side owns authoritative chunk
 * data; a client applying its own request would have nothing to do anyway.
 */
export declare function applyVoxelSyncMessage(world: VoxelWorld, message: VoxelSyncMessage): void;
//# sourceMappingURL=voxel-save.d.ts.map