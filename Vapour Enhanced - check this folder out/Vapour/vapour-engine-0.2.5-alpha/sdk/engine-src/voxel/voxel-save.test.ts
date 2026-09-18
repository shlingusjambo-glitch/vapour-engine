import { describe, expect, it } from "vitest";
import {
  applyVoxelSyncMessage,
  decodeChunk,
  decodeWorld,
  encodeChunk,
  encodeWorld,
  respondToChunkRequest,
  type VoxelBlockEdit,
} from "./voxel-save.js";
import { VoxelChunk, VoxelWorld } from "./voxel-world.js";

describe("encodeChunk/decodeChunk", () => {
  it("round-trips a mostly-uniform chunk byte-identically", () => {
    const size = 16, height = 64;
    const blocks = new Uint16Array(size * size * height); // all air
    // A stone floor and a few scattered dirt blocks, like real terrain.
    for (let z = 0; z < size; z += 1) for (let x = 0; x < size; x += 1) blocks[(0 * size + z) * size + x] = 1;
    blocks[(10 * size + 5) * size + 5] = 2;
    blocks[(10 * size + 5) * size + 6] = 2;
    const chunk = new VoxelChunk(3, -2, size, height, blocks);

    const encoded = encodeChunk(chunk);
    const decoded = decodeChunk(encoded);

    expect(decoded.x).toBe(3);
    expect(decoded.z).toBe(-2);
    expect(decoded.size).toBe(size);
    expect(decoded.height).toBe(height);
    expect(Array.from(decoded.blocks)).toEqual(Array.from(chunk.blocks));

    const rawBytes = chunk.blocks.byteLength;
    console.log(`voxel chunk encode: raw=${String(rawBytes)}B encoded=${String(encoded.byteLength)}B (${String(Math.round((encoded.byteLength / rawBytes) * 100))}%)`);
    expect(encoded.byteLength).toBeLessThan(rawBytes);
  });

  it("round-trips an all-air empty chunk to a tiny buffer", () => {
    const chunk = new VoxelChunk(0, 0, 16, 32, new Uint16Array(16 * 16 * 32));
    const encoded = encodeChunk(chunk);
    expect(encoded.byteLength).toBeLessThan(32); // header + one run
    expect(Array.from(decodeChunk(encoded).blocks)).toEqual(Array.from(chunk.blocks));
  });

  it("round-trips a fully random (worst-case, no runs) chunk byte-identically", () => {
    const size = 4, height = 4;
    const blocks = new Uint16Array(size * size * height);
    let seed = 7;
    for (let i = 0; i < blocks.length; i += 1) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      blocks[i] = (seed % 2) + 1; // alternates unpredictably between 1 and 2
    }
    const chunk = new VoxelChunk(0, 0, size, height, blocks);
    const decoded = decodeChunk(encodeChunk(chunk));
    expect(Array.from(decoded.blocks)).toEqual(Array.from(chunk.blocks));
  });

  it("rejects an unsupported format version", () => {
    const chunk = new VoxelChunk(0, 0, 2, 2, new Uint16Array(8));
    const encoded = encodeChunk(chunk);
    const corrupted = encoded.slice();
    corrupted[0] = 99;
    expect(() => decodeChunk(corrupted)).toThrow();
  });
});

describe("encodeWorld/decodeWorld", () => {
  it("round-trips every loaded chunk through a world-level index", () => {
    const source = new VoxelWorld({ chunkSize: 8, height: 16 });
    source.setBlock(1, 0, 1, 1);
    source.setBlock(9, 2, 1, 2); // chunk (1, 0)
    source.setBlock(-1, 0, -1, 1); // chunk (-1, -1)

    const save = encodeWorld(source);
    expect(save.index).toHaveLength(3);

    const target = new VoxelWorld({ chunkSize: 8, height: 16 });
    decodeWorld(target, save);
    for (const entry of save.index) {
      const expected = source.chunk(entry.x, entry.z)!;
      const actual = target.chunk(entry.x, entry.z)!;
      expect(Array.from(actual.blocks)).toEqual(Array.from(expected.blocks));
    }
  });

  it("saves only the chunks named by `only`, e.g. from takeDirtyChunks", () => {
    const world = new VoxelWorld({ chunkSize: 8, height: 16 });
    // Interior coordinates (not on a chunk edge) so no neighbouring,
    // never-created chunk is also marked dirty.
    world.setBlock(4, 0, 4, 1);
    world.setBlock(20, 0, 4, 1); // a different chunk
    const dirty = world.takeDirtyChunks();
    expect(dirty.length).toBe(2);

    world.setBlock(4, 1, 4, 2); // only this chunk dirty again
    const onlyDirty = world.takeDirtyChunks();
    const save = encodeWorld(world, { only: onlyDirty });
    expect(save.index.map((entry) => `${String(entry.x)},${String(entry.z)}`).sort()).toEqual(
      onlyDirty.map((coordinate) => `${String(coordinate.x)},${String(coordinate.z)}`).sort(),
    );
  });

  it("rejects a save whose geometry does not match the target world", () => {
    const source = new VoxelWorld({ chunkSize: 8, height: 16 });
    source.setBlock(0, 0, 0, 1);
    const save = encodeWorld(source);
    const mismatched = new VoxelWorld({ chunkSize: 16, height: 16 });
    expect(() => decodeWorld(mismatched, save)).toThrow();
  });
});

describe("voxel sync messages", () => {
  it("responds to a chunk request with an encoded snapshot a peer can apply", () => {
    const server = new VoxelWorld({ chunkSize: 8, height: 16 });
    server.setBlock(1, 1, 1, 1);
    const response = respondToChunkRequest(server, { type: "voxel-chunk-request", x: 0, z: 0 });
    expect(response).toBeDefined();

    const client = new VoxelWorld({ chunkSize: 8, height: 16 });
    applyVoxelSyncMessage(client, response!);
    expect(client.getBlock(1, 1, 1)).toBe(1);
  });

  it("returns undefined for a request naming an unloaded chunk", () => {
    const server = new VoxelWorld({ chunkSize: 8, height: 16 });
    expect(respondToChunkRequest(server, { type: "voxel-chunk-request", x: 5, z: 5 })).toBeUndefined();
  });

  it("applies an incremental block edit identically on two peers", () => {
    const edit: VoxelBlockEdit = { type: "voxel-block-edit", x: 3, y: 2, z: -1, id: 2 };
    const a = new VoxelWorld({ chunkSize: 8, height: 16 });
    const b = new VoxelWorld({ chunkSize: 8, height: 16 });
    applyVoxelSyncMessage(a, edit);
    applyVoxelSyncMessage(b, edit);
    expect(a.getBlock(3, 2, -1)).toBe(2);
    expect(b.getBlock(3, 2, -1)).toBe(2);
  });

  it("a chunk request has no effect on the world applying it", () => {
    const world = new VoxelWorld({ chunkSize: 8, height: 16 });
    world.setBlock(0, 0, 0, 1);
    const before = Array.from(world.chunk(0, 0)!.blocks);
    applyVoxelSyncMessage(world, { type: "voxel-chunk-request", x: 0, z: 0 });
    expect(Array.from(world.chunk(0, 0)!.blocks)).toEqual(before);
  });

  it("rejects a chunk response whose payload coordinate does not match the message", () => {
    const source = new VoxelWorld({ chunkSize: 8, height: 16 });
    source.setBlock(0, 0, 0, 1);
    const encoded = encodeChunk(source.chunk(0, 0)!);
    const target = new VoxelWorld({ chunkSize: 8, height: 16 });
    expect(() => applyVoxelSyncMessage(target, { type: "voxel-chunk-response", x: 9, z: 9, data: encoded })).toThrow();
  });
});
