import { describe, expect, it } from "vitest";
import { FrameBuilder, composeTranslation } from "./core/frame-builder.js";
import { WebGpuRenderHost } from "./render/host/index.js";
import { meshVoxelChunk } from "./voxel/voxel-mesher.js";
import { moveVoxelBody, raycastVoxels, type VoxelBody } from "./physics/voxel-physics.js";
import { VoxelPalette, VoxelWorld } from "./voxel/voxel-world.js";

const palette = new VoxelPalette([
  { id: 1, name: "Surface", solid: true, opaque: true, color: [0.25, 0.68, 0.28, 1] },
  { id: 2, name: "Earth", solid: true, opaque: true, color: [0.48, 0.29, 0.14, 1] },
  { id: 3, name: "Rock", solid: true, opaque: true, color: [0.52, 0.55, 0.58, 1] },
]);

describe("voxel survival port workload", () => {
  it("generates, meshes, registers, and packs a multi-chunk world", () => {
    const world = new VoxelWorld({ chunkSize: 16, height: 32 });
    for (let z = -1; z <= 1; z += 1) {
      for (let x = -1; x <= 1; x += 1) world.setChunk(x, z, terrainChunk(world, x, z));
    }
    const canvas = { clientWidth: 1280, clientHeight: 720 } as HTMLCanvasElement;
    const host = new WebGpuRenderHost(canvas);
    const frame = new FrameBuilder(2);
    const matrix = new Float32Array(16);
    let triangles = 0;
    for (const chunk of world.chunks()) {
      const id = `integration:chunk:${String(chunk.x)}:${String(chunk.z)}`;
      const mesh = meshVoxelChunk(world, palette, chunk.x, chunk.z);
      expect(mesh.faceCount).toBeGreaterThan(0);
      host.uploadMesh(id, mesh);
      composeTranslation(matrix, chunk.x * world.chunkSize, 0, chunk.z * world.chunkSize);
      frame.draw(id, matrix);
      triangles += mesh.indices.length / 3;
    }
    expect(host.meshIds()).toHaveLength(9);
    expect(frame.drawCount).toBe(9);
    expect(frame.capacity).toBeGreaterThanOrEqual(9);
    expect(frame.pack().meshTable).toHaveLength(9);
    expect(frame.pack().matrices).toHaveLength(9 * 16);
    expect(triangles).toBeGreaterThan(1_000);
  });

  it("turns one player edit into targeted remeshing and physics queries", () => {
    const world = new VoxelWorld({ chunkSize: 8, height: 24 });
    world.setChunk(0, 0, terrainChunk(world, 0, 0));
    world.setChunk(1, 0, terrainChunk(world, 1, 0));
    world.takeDirtyChunks();
    const surface = raycastVoxels(world, palette, [7.5, 22, 3.5], [0, -1, 0], 30);
    expect(surface).toBeDefined();
    world.setBlock(surface!.x, surface!.y, surface!.z, 0);
    const dirty = world.takeDirtyChunks();
    expect(dirty).toContainEqual({ x: 0, z: 0 });
    expect(dirty).toContainEqual({ x: 1, z: 0 });
    for (const coordinate of dirty) {
      if (world.chunk(coordinate.x, coordinate.z) !== undefined) {
        expect(meshVoxelChunk(world, palette, coordinate.x, coordinate.z).indices.length).toBeGreaterThan(0);
      }
    }
    const body: VoxelBody = {
      position: [7.5, 22, 3.5], velocity: [0, -40, 0], width: 0.62, height: 1.8, depth: 0.62, grounded: false,
    };
    const collision = moveVoxelBody(world, palette, body, 1);
    expect(collision.grounded).toBe(true);
    expect(body.velocity[1]).toBe(0);
  });
});

function terrainChunk(world: VoxelWorld, chunkX: number, chunkZ: number): Uint16Array {
  const size = world.chunkSize;
  const blocks = new Uint16Array(size * size * world.height);
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const worldX = chunkX * size + x;
      const worldZ = chunkZ * size + z;
      const top = Math.floor(8 + Math.sin(worldX * 0.19) * 2 + Math.cos(worldZ * 0.16) * 2);
      for (let y = 0; y <= top; y += 1) blocks[(y * size + z) * size + x] = y === top ? 1 : y >= top - 2 ? 2 : 3;
    }
  }
  return blocks;
}
