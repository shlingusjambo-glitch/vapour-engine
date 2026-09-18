import type { MeshUpload } from "../render/host/index.js";
import { MAX_LIGHT_LEVEL, type VoxelLightField } from "./voxel-lighting.js";
import { AIR_BLOCK, type VoxelPalette, type VoxelWorld } from "./voxel-world.js";

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

interface Face {
  readonly name: VoxelFaceName;
  readonly normal: readonly [number, number, number];
  readonly corners: readonly (readonly [number, number, number])[];
}

const FACES: readonly Face[] = [
  { name: "east", normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { name: "west", normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { name: "top", normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { name: "bottom", normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { name: "south", normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { name: "north", normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

const UVS: readonly (readonly [number, number])[] = [[0, 0], [0, 1], [1, 1], [1, 0]];
const DEFAULT_FACE_LIGHT: Readonly<Record<VoxelFaceName, number>> = {
  top: 1,
  bottom: 0.52,
  east: 0.82,
  west: 0.72,
  south: 0.88,
  north: 0.66,
};

/** Builds the visible surface of one chunk. Vertices remain chunk-local; draw
 * the result translated by `(chunkX * chunkSize, 0, chunkZ * chunkSize)`.
 * Neighbours are queried through the world, so faces at loaded chunk seams are
 * culled and edits naturally expose the adjacent chunk when both are remeshed. */
export function meshVoxelChunk(
  world: VoxelWorld,
  palette: VoxelPalette,
  chunkX: number,
  chunkZ: number,
  options: VoxelMesherOptions = {},
): VoxelMesh {
  const chunk = world.chunk(chunkX, chunkZ);
  if (chunk === undefined) return emptyMesh();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const lightOut: number[] = [];
  const indices: number[] = [];
  const light = options.faceLight ?? DEFAULT_FACE_LIGHT;
  const lightField = options.light;
  let faceCount = 0;
  let blockCount = 0;
  const worldX = chunkX * chunk.size;
  const worldZ = chunkZ * chunk.size;

  for (let y = 0; y < chunk.height; y += 1) {
    for (let z = 0; z < chunk.size; z += 1) {
      for (let x = 0; x < chunk.size; x += 1) {
        const id = chunk.block(x, y, z);
        if (id === AIR_BLOCK) continue;
        const definition = palette.require(id);
        blockCount += 1;
        for (const face of FACES) {
          const neighbourX = worldX + x + face.normal[0];
          const neighbourY = y + face.normal[1];
          const neighbourZ = worldZ + z + face.normal[2];
          const neighbour = world.getBlock(neighbourX, neighbourY, neighbourZ);
          // Two equal non-opaque blocks share no internal surface. Opaque
          // neighbours hide every layer; a different transparent neighbour
          // preserves the boundary for later order-independent transparency.
          if (palette.isOpaque(neighbour) || (neighbour === id && !definition.opaque)) continue;
          const baseVertex = positions.length / 3;
          const brightness = light[face.name];
          const sample = lightField?.get(neighbourX, neighbourY, neighbourZ);
          const level = sample === undefined ? 1 : Math.max(sample.block, sample.sky) / MAX_LIGHT_LEVEL;
          for (let corner = 0; corner < 4; corner += 1) {
            const point = face.corners[corner]!;
            positions.push(x + point[0], y + point[1], z + point[2]);
            normals.push(face.normal[0], face.normal[1], face.normal[2]);
            uvs.push(UVS[corner]![0], UVS[corner]![1]);
            colors.push(
              definition.color[0] * brightness * level,
              definition.color[1] * brightness * level,
              definition.color[2] * brightness * level,
              definition.color[3],
            );
            lightOut.push(level);
          }
          indices.push(baseVertex, baseVertex + 1, baseVertex + 2, baseVertex, baseVertex + 2, baseVertex + 3);
          faceCount += 1;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    light: new Float32Array(lightOut),
    indices: new Uint32Array(indices),
    blockCount,
    faceCount,
  };
}

function emptyMesh(): VoxelMesh {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    colors: new Float32Array(0),
    light: new Float32Array(0),
    indices: new Uint32Array(0),
    blockCount: 0,
    faceCount: 0,
  };
}
