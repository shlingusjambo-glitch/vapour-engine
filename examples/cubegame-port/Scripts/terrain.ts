import { VoxelPalette, type VoxelWorld } from "@vapour/engine";

export const BLOCK = {
  grass: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
} as const;

export const palette = new VoxelPalette([
  { id: BLOCK.grass, name: "Grass", solid: true, opaque: true, color: [0.25, 0.68, 0.28, 1] },
  { id: BLOCK.dirt, name: "Dirt", solid: true, opaque: true, color: [0.48, 0.29, 0.14, 1] },
  { id: BLOCK.stone, name: "Stone", solid: true, opaque: true, color: [0.52, 0.55, 0.58, 1] },
  { id: BLOCK.sand, name: "Sand", solid: true, opaque: true, color: [0.82, 0.73, 0.44, 1] },
]);

/** Deterministic terrain used by the port while worker noise and biome APIs
 * are being extracted from the upstream game's requirements. */
export function terrainHeight(x: number, z: number): number {
  const broad = Math.sin(x * 0.075) * 3.4 + Math.cos(z * 0.068) * 3.1;
  const detail = Math.sin((x + z) * 0.19) * 1.1 + Math.cos((x - z) * 0.14) * 0.8;
  return Math.max(3, Math.min(26, Math.floor(11 + broad + detail)));
}

export function generateTerrainChunk(world: VoxelWorld, chunkX: number, chunkZ: number): Uint16Array {
  const size = world.chunkSize;
  const blocks = new Uint16Array(size * size * world.height);
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const worldX = chunkX * size + x;
      const worldZ = chunkZ * size + z;
      const top = terrainHeight(worldX, worldZ);
      for (let y = 0; y <= top; y += 1) {
        const beach = top <= 8;
        const id = y === top ? (beach ? BLOCK.sand : BLOCK.grass) : y >= top - 3 ? (beach ? BLOCK.sand : BLOCK.dirt) : BLOCK.stone;
        blocks[(y * size + z) * size + x] = id;
      }
    }
  }
  return blocks;
}
