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

export const VOXEL_CHUNK_FORMAT_VERSION = 1;

const HEADER_BYTES = 1 + 4 + 4 + 2 + 2 + 4; // version, x, z, size, height, runCount

/** Run-length encodes one chunk's blocks into a compact, versioned buffer. */
export function encodeChunk(chunk: VoxelChunk): Uint8Array {
  const runs: { readonly id: number; readonly count: number }[] = [];
  let currentId = chunk.blocks[0] ?? 0;
  let count = 0;
  for (const id of chunk.blocks) {
    if (id === currentId) {
      count += 1;
    } else {
      runs.push({ id: currentId, count });
      currentId = id;
      count = 1;
    }
  }
  if (count > 0) runs.push({ id: currentId, count });

  const buffer = new ArrayBuffer(HEADER_BYTES + runs.length * 6);
  const view = new DataView(buffer);
  let offset = 0;
  view.setUint8(offset, VOXEL_CHUNK_FORMAT_VERSION); offset += 1;
  view.setInt32(offset, chunk.x, true); offset += 4;
  view.setInt32(offset, chunk.z, true); offset += 4;
  view.setUint16(offset, chunk.size, true); offset += 2;
  view.setUint16(offset, chunk.height, true); offset += 2;
  view.setUint32(offset, runs.length, true); offset += 4;
  for (const run of runs) {
    view.setUint16(offset, run.id, true); offset += 2;
    view.setUint32(offset, run.count, true); offset += 4;
  }
  return new Uint8Array(buffer);
}

/** Decodes a buffer from `encodeChunk` back into a `VoxelChunk`, byte for
 * byte the same blocks as the original. */
export function decodeChunk(bytes: Uint8Array): VoxelChunk {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const version = view.getUint8(offset); offset += 1;
  if (version !== VOXEL_CHUNK_FORMAT_VERSION) throw new Error(`Unsupported voxel chunk format version ${String(version)}.`);
  const x = view.getInt32(offset, true); offset += 4;
  const z = view.getInt32(offset, true); offset += 4;
  const size = view.getUint16(offset, true); offset += 2;
  const height = view.getUint16(offset, true); offset += 2;
  const runCount = view.getUint32(offset, true); offset += 4;

  const blocks = new Uint16Array(size * size * height);
  let cursor = 0;
  for (let run = 0; run < runCount; run += 1) {
    const id = view.getUint16(offset, true); offset += 2;
    const count = view.getUint32(offset, true); offset += 4;
    blocks.fill(id, cursor, cursor + count);
    cursor += count;
  }
  if (cursor !== blocks.length) throw new Error(`Voxel chunk (${String(x)}, ${String(z)}) decoded ${String(cursor)} blocks, expected ${String(blocks.length)}.`);
  return new VoxelChunk(x, z, size, height, blocks);
}

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
  readonly only?: readonly { readonly x: number; readonly z: number }[];
}

/** Serializes a world's loaded chunks into one buffer plus an index, so a
 * save is one write instead of one file per chunk. Chunk order is the
 * iteration order of `only` when given, else the world's own chunk order —
 * both stable and deterministic for a fixed world. */
export function encodeWorld(world: VoxelWorld, options: EncodeWorldOptions = {}): WorldSave {
  const chunks = options.only !== undefined
    ? options.only.map((coordinate) => {
        const chunk = world.chunk(coordinate.x, coordinate.z);
        if (chunk === undefined) throw new Error(`Cannot save missing chunk (${String(coordinate.x)}, ${String(coordinate.z)}).`);
        return chunk;
      })
    : [...world.chunks()];

  const encoded = chunks.map(encodeChunk);
  const totalBytes = encoded.reduce((sum, bytes) => sum + bytes.length, 0);
  const data = new Uint8Array(totalBytes);
  const index: WorldSaveIndexEntry[] = [];
  let byteOffset = 0;
  for (const [i, bytes] of encoded.entries()) {
    data.set(bytes, byteOffset);
    index.push({ x: chunks[i]!.x, z: chunks[i]!.z, byteOffset, byteLength: bytes.length });
    byteOffset += bytes.length;
  }
  return { version: VOXEL_CHUNK_FORMAT_VERSION, chunkSize: world.chunkSize, height: world.height, index, data };
}

/** Installs every chunk from a `WorldSave` into a world via `setChunk`. */
export function decodeWorld(world: VoxelWorld, save: WorldSave): void {
  if (save.version !== VOXEL_CHUNK_FORMAT_VERSION) throw new Error(`Unsupported voxel world save version ${String(save.version)}.`);
  if (save.chunkSize !== world.chunkSize || save.height !== world.height) {
    throw new Error(`Voxel world save geometry ${String(save.chunkSize)}x${String(save.height)} does not match world ${String(world.chunkSize)}x${String(world.height)}.`);
  }
  for (const entry of save.index) {
    const bytes = save.data.subarray(entry.byteOffset, entry.byteOffset + entry.byteLength);
    const chunk = decodeChunk(bytes);
    world.setChunk(entry.x, entry.z, chunk.blocks);
  }
}

// --- Multiplayer chunk sync: message shapes and a pure reducer -----------

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
export function respondToChunkRequest(world: VoxelWorld, request: VoxelChunkRequest): VoxelChunkResponse | undefined {
  const chunk = world.chunk(request.x, request.z);
  if (chunk === undefined) return undefined;
  return { type: "voxel-chunk-response", x: request.x, z: request.z, data: encodeChunk(chunk) };
}

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
export function applyVoxelSyncMessage(world: VoxelWorld, message: VoxelSyncMessage): void {
  switch (message.type) {
    case "voxel-chunk-response": {
      const chunk = decodeChunk(message.data);
      if (chunk.x !== message.x || chunk.z !== message.z) {
        throw new Error(`Voxel chunk response coordinate (${String(message.x)}, ${String(message.z)}) does not match its payload (${String(chunk.x)}, ${String(chunk.z)}).`);
      }
      world.setChunk(message.x, message.z, chunk.blocks);
      return;
    }
    case "voxel-block-edit":
      world.setBlock(message.x, message.y, message.z, message.id);
      return;
    case "voxel-chunk-request":
      return;
  }
}
