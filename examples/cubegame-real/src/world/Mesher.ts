import { BlockRegistry } from './BlockRegistry';

export interface MeshGeometry {
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  normals: Float32Array;
  uvs: Float32Array;
  aos: Float32Array;
  tiles: Float32Array;
}

export type MeshPass = 'opaque' | 'transparent' | 'water';

export class Mesher {
  private static createIndexBuffer(indices: number[], vertexCount: number): Uint16Array | Uint32Array {
    return vertexCount <= 65536 ? new Uint16Array(indices) : new Uint32Array(indices);
  }

  /**
   * Face-aware UVs. This is intentionally not the default BoxGeometry layout:
   * side faces always map world Y to texture V so grass/log/brick sides do not
   * rotate sideways after greedy meshing, while top/bottom faces stay locked to
   * world X/Z. Width/height are the greedy-merged voxel span and are allowed to
   * exceed 1 so the shader repeats the tile instead of stretching it.
   */
  private static pushFaceUVs(uvs: number[], axis: number, faceIndex: number, w: number, h: number): void {
    const isTopOrBottom = axis === 1;

    if (isTopOrBottom) {
      // Horizontal faces use the same compass orientation everywhere.
      // Bottom gets flipped to avoid mirrored dirt/stone undersides.
      if (faceIndex === 1) {
        uvs.push(0, h, w, h, w, 0, 0, 0);
      } else {
        uvs.push(0, 0, w, 0, w, h, 0, h);
      }
      return;
    }

    if (axis === 0) {
      // X faces: greedy width is world Y and height is world Z. Swap so Y is vertical.
      uvs.push(0, 0, 0, w, h, w, h, 0);
      return;
    }

    // Z faces: greedy width is world X and height is world Y. This is the
    // canonical upright orientation for grass sides, doors, logs, bricks, etc.
    uvs.push(0, 0, w, 0, w, h, 0, h);
  }


  private static matchesModelPass(blockId: number, meshPass: MeshPass): boolean {
    const cfg = BlockRegistry.get(blockId);
    if (meshPass === 'water') return cfg.isWater;
    if (meshPass === 'opaque') return !cfg.isTransparent && !cfg.isWater && !cfg.isFoliage;
    return cfg.isTransparent && !cfg.isWater;
  }

  private static getShapeCuboids(shape: string): Array<[number, number, number, number, number, number]> {
    switch (shape) {
      case 'slab':
        return [[0, 0, 0, 1, 0.5, 1]];
      case 'stairs':
        return [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0.5, 1, 1, 1]];
      case 'door':
        return [[0.0625, 0, 0.0, 0.9375, 1, 0.125], [0.08, 0.45, 0.125, 0.2, 0.55, 0.1875]];
      case 'trapdoor':
        return [[0, 0, 0, 1, 0.1875, 1]];
      case 'ladder':
        return [[0.16, 0, 0.03, 0.26, 1, 0.09], [0.74, 0, 0.03, 0.84, 1, 0.09], [0.16, 0.18, 0.035, 0.84, 0.28, 0.095], [0.16, 0.48, 0.035, 0.84, 0.58, 0.095], [0.16, 0.78, 0.035, 0.84, 0.88, 0.095]];
      case 'fence':
        return [[0.35, 0, 0.35, 0.65, 1.0, 0.65], [0, 0.35, 0.43, 1, 0.52, 0.57], [0, 0.68, 0.43, 1, 0.85, 0.57], [0.43, 0.35, 0, 0.57, 0.52, 1], [0.43, 0.68, 0, 0.57, 0.85, 1]];
      case 'wall':
        return [[0.25, 0, 0.25, 0.75, 1, 0.75], [0, 0.25, 0.31, 1, 0.82, 0.69], [0.31, 0.25, 0, 0.69, 0.82, 1]];
      case 'pane':
        return [[0.4375, 0, 0, 0.5625, 1, 1], [0, 0, 0.4375, 1, 1, 0.5625]];
      case 'chain':
        return [[0.43, 0, 0.43, 0.57, 1, 0.57], [0.34, 0.08, 0.47, 0.66, 0.22, 0.53], [0.47, 0.38, 0.34, 0.53, 0.52, 0.66], [0.34, 0.72, 0.47, 0.66, 0.86, 0.53]];
      case 'button':
        return [[0.31, 0.34, 0.0, 0.69, 0.66, 0.14]];
      case 'plate':
        return [[0.08, 0, 0.08, 0.92, 0.0625, 0.92]];
      case 'post':
        return [[0.38, 0, 0.38, 0.62, 0.72, 0.62], [0.31, 0.72, 0.31, 0.69, 0.95, 0.69]];
      default:
        return [[0, 0, 0, 1, 1, 1]];
    }
  }

  private static pushCuboid(
    blockId: number,
    x: number,
    y: number,
    z: number,
    cuboid: [number, number, number, number, number, number],
    positions: number[],
    indices: number[],
    normals: number[],
    uvs: number[],
    aos: number[],
    tiles: number[],
    vertexCount: number,
  ): number {
    const [minX, minY, minZ, maxX, maxY, maxZ] = cuboid;
    const X0 = x + minX, Y0 = y + minY, Z0 = z + minZ;
    const X1 = x + maxX, Y1 = y + maxY, Z1 = z + maxZ;
    const faces: Array<{ faceIndex: number; normal: [number, number, number]; verts: number[] }> = [
      { faceIndex: 3, normal: [1, 0, 0], verts: [X1, Y0, Z0, X1, Y1, Z0, X1, Y1, Z1, X1, Y0, Z1] },
      { faceIndex: 2, normal: [-1, 0, 0], verts: [X0, Y0, Z1, X0, Y1, Z1, X0, Y1, Z0, X0, Y0, Z0] },
      { faceIndex: 1, normal: [0, 1, 0], verts: [X0, Y1, Z0, X0, Y1, Z1, X1, Y1, Z1, X1, Y1, Z0] },
      { faceIndex: 0, normal: [0, -1, 0], verts: [X0, Y0, Z1, X0, Y0, Z0, X1, Y0, Z0, X1, Y0, Z1] },
      { faceIndex: 4, normal: [0, 0, 1], verts: [X0, Y0, Z1, X1, Y0, Z1, X1, Y1, Z1, X0, Y1, Z1] },
      { faceIndex: 5, normal: [0, 0, -1], verts: [X1, Y0, Z0, X0, Y0, Z0, X0, Y1, Z0, X1, Y1, Z0] },
    ];

    for (const face of faces) {
      const texIdx = BlockRegistry.getFaceTextureIndex(blockId, face.faceIndex);
      positions.push(...face.verts);
      normals.push(...face.normal, ...face.normal, ...face.normal, ...face.normal);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      aos.push(3, 3, 3, 3);
      tiles.push(texIdx, texIdx, texIdx, texIdx);
      indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
      vertexCount += 4;
    }
    return vertexCount;
  }

  private static appendCustomBlockModels(
    voxels18: Uint16Array,
    meshPass: MeshPass,
    positions: number[],
    indices: number[],
    normals: number[],
    uvs: number[],
    aos: number[],
    tiles: number[],
    vertexCount: number,
  ): number {
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        for (let y = 0; y < 16; y++) {
          const blockId = voxels18[(x + 1) + (y + 1) * 18 + (z + 1) * 324];
          if (blockId === 0) continue;
          const shape = BlockRegistry.getRenderShape(blockId);
          if (shape === 'cube') continue;
          if (!this.matchesModelPass(blockId, meshPass)) continue;

          const cuboids = this.getShapeCuboids(shape);
          for (const cuboid of cuboids) {
            vertexCount = this.pushCuboid(blockId, x, y, z, cuboid, positions, indices, normals, uvs, aos, tiles, vertexCount);
          }
        }
      }
    }
    return vertexCount;
  }

  /**
   * High-performance greedy meshing for chunk cube faces.
   *
   * This keeps Minecraft-style repeated tile detail by storing the atlas tile in
   * aTile and local repeating UVs in uv. VoxelShader converts those to atlas UVs
   * in the fragment shader, so a 12x12 merged grass face still displays 12x12
   * grass tiles instead of one stretched texture.
   */
  public static generateMesh(voxels18: Uint16Array, pass: MeshPass | boolean): MeshGeometry {
    const meshPass: MeshPass = typeof pass === 'boolean' ? (pass ? 'transparent' : 'opaque') : pass;

    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const aos: number[] = [];
    const tiles: number[] = [];
    let vertexCount = 0;

    const getVoxel = (x: number, y: number, z: number): number => {
      if (x < -1 || x > 16 || y < -1 || y > 16 || z < -1 || z > 16) return 0;
      return voxels18[(x + 1) + (y + 1) * 18 + (z + 1) * 324];
    };

    const getOccluder = (px: number, py: number, pz: number, ox: number, oy: number, oz: number): number => {
      const bid = getVoxel(px + ox, py + oy, pz + oz);
      return bid !== 0 && BlockRegistry.get(bid).isSolid ? 1 : 0;
    };

    const computeAO = (px: number, py: number, pz: number, dir: [number, number, number]): [number, number, number, number] => {
      const [nx, ny, nz] = dir;
      const cornerAO = (cu: number, cv: number): number => {
        let s1 = 0, s2 = 0, c = 0;
        if (nx !== 0) {
          s1 = getOccluder(px, py, pz, nx, cu === 0 ? -1 : 1, 0);
          s2 = getOccluder(px, py, pz, nx, 0, cv === 0 ? -1 : 1);
          c = getOccluder(px, py, pz, nx, cu === 0 ? -1 : 1, cv === 0 ? -1 : 1);
        } else if (ny !== 0) {
          s1 = getOccluder(px, py, pz, cu === 0 ? -1 : 1, ny, 0);
          s2 = getOccluder(px, py, pz, 0, ny, cv === 0 ? -1 : 1);
          c = getOccluder(px, py, pz, cu === 0 ? -1 : 1, ny, cv === 0 ? -1 : 1);
        } else {
          s1 = getOccluder(px, py, pz, cu === 0 ? -1 : 1, 0, nz);
          s2 = getOccluder(px, py, pz, 0, cv === 0 ? -1 : 1, nz);
          c = getOccluder(px, py, pz, cu === 0 ? -1 : 1, cv === 0 ? -1 : 1, nz);
        }
        return s1 === 1 && s2 === 1 ? 0 : 3 - (s1 + s2 + c);
      };
      return [cornerAO(0, 0), cornerAO(1, 0), cornerAO(1, 1), cornerAO(0, 1)];
    };

    const faceIndexFor = (axis: number, backFace: number): number => {
      if (axis === 1) return backFace === 0 ? 1 : 0; // bottom/top
      if (axis === 0) return backFace === 0 ? 2 : 3; // left/right
      return backFace === 0 ? 5 : 4; // back/front
    };

    for (let d = 0; d < 3; d++) {
      const u = (d + 1) % 3;
      const v = (d + 2) % 3;
      const x = [0, 0, 0];
      const mask = new Int32Array(16 * 16);

      for (let backFace = 0; backFace < 2; backFace++) {
        const normDir: [number, number, number] = [
          d === 0 ? (backFace === 0 ? -1 : 1) : 0,
          d === 1 ? (backFace === 0 ? -1 : 1) : 0,
          d === 2 ? (backFace === 0 ? -1 : 1) : 0,
        ];

        for (x[d] = 0; x[d] < 16; x[d]++) {
          let maskIndex = 0;

          for (x[v] = 0; x[v] < 16; x[v]++) {
            for (x[u] = 0; x[u] < 16; x[u]++, maskIndex++) {
              mask[maskIndex] = 0;

              const blockCurrent = getVoxel(x[0], x[1], x[2]);
              if (blockCurrent === 0) continue;

              if (BlockRegistry.getRenderShape(blockCurrent) !== 'cube') continue;

              const cfgCurrent = BlockRegistry.get(blockCurrent);
              const matchesPass = meshPass === 'opaque'
                ? !cfgCurrent.isTransparent && !cfgCurrent.isFoliage
                : meshPass === 'water'
                  ? cfgCurrent.isWater
                  : cfgCurrent.isTransparent && !cfgCurrent.isWater && !cfgCurrent.isFoliage;
              if (!matchesPass) continue;

              const blockNeighbor = getVoxel(x[0] + normDir[0], x[1] + normDir[1], x[2] + normDir[2]);
              const cfgNeighbor = BlockRegistry.get(blockNeighbor);
              const faceExposed = cfgCurrent.isWater
                ? !cfgNeighbor.isWater
                : !cfgNeighbor.isSolid || cfgNeighbor.isTransparent || cfgNeighbor.isWater;

              if (faceExposed && blockCurrent !== blockNeighbor) mask[maskIndex] = blockCurrent;
            }
          }

          maskIndex = 0;
          for (let j = 0; j < 16; j++) {
            for (let i = 0; i < 16;) {
              const blockId = mask[maskIndex];
              if (blockId === 0) {
                i++;
                maskIndex++;
                continue;
              }

              let w = 1;
              while (i + w < 16 && mask[maskIndex + w] === blockId) w++;

              let h = 1;
              outer: while (j + h < 16) {
                for (let k = 0; k < w; k++) {
                  if (mask[maskIndex + k + h * 16] !== blockId) break outer;
                }
                h++;
              }

              x[u] = i;
              x[v] = j;

              const du = [0, 0, 0]; du[u] = w;
              const dv = [0, 0, 0]; dv[v] = h;

              const faceIndex = faceIndexFor(d, backFace);
              const texIdx = BlockRegistry.getFaceTextureIndex(blockId, faceIndex);

              const v0 = [x[0], x[1], x[2]];
              if (backFace === 1) v0[d] += 1;
              const v1 = [v0[0] + du[0], v0[1] + du[1], v0[2] + du[2]];
              const v2 = [v0[0] + du[0] + dv[0], v0[1] + du[1] + dv[1], v0[2] + du[2] + dv[2]];
              const v3 = [v0[0] + dv[0], v0[1] + dv[1], v0[2] + dv[2]];

              positions.push(...v0, ...v1, ...v2, ...v3);
              normals.push(...normDir, ...normDir, ...normDir, ...normDir);
              this.pushFaceUVs(uvs, d, faceIndex, w, h);
              tiles.push(texIdx, texIdx, texIdx, texIdx);

              const vertexAOs = computeAO(x[0], x[1], x[2], normDir);
              aos.push(...vertexAOs);

              const reverseWinding = backFace === 0;
              if (vertexAOs[0] + vertexAOs[2] < vertexAOs[1] + vertexAOs[3]) {
                if (reverseWinding) {
                  indices.push(vertexCount + 0, vertexCount + 2, vertexCount + 1, vertexCount + 0, vertexCount + 3, vertexCount + 2);
                } else {
                  indices.push(vertexCount + 0, vertexCount + 1, vertexCount + 2, vertexCount + 0, vertexCount + 2, vertexCount + 3);
                }
              } else if (reverseWinding) {
                indices.push(vertexCount + 1, vertexCount + 3, vertexCount + 2, vertexCount + 1, vertexCount + 0, vertexCount + 3);
              } else {
                indices.push(vertexCount + 1, vertexCount + 2, vertexCount + 3, vertexCount + 1, vertexCount + 3, vertexCount + 0);
              }

              vertexCount += 4;

              for (let yy = 0; yy < h; yy++) {
                for (let xx = 0; xx < w; xx++) mask[maskIndex + xx + yy * 16] = 0;
              }

              i += w;
              maskIndex += w;
            }
          }
        }
      }
    }

    vertexCount = this.appendCustomBlockModels(voxels18, meshPass, positions, indices, normals, uvs, aos, tiles, vertexCount);

    return {
      positions: new Float32Array(positions),
      indices: this.createIndexBuffer(indices, vertexCount),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      aos: new Float32Array(aos),
      tiles: new Float32Array(tiles),
    };
  }

  /** Cross-plane mesh for flowers, grass, crops, and other cutout foliage. */
  public static generateFoliageMesh(voxels18: Uint16Array): MeshGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const aos: number[] = [];
    const tiles: number[] = [];
    let vertexCount = 0;

    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        for (let y = 0; y < 16; y++) {
          const blockId = voxels18[(x + 1) + (y + 1) * 18 + (z + 1) * 324];
          if (blockId === 0) continue;

          const cfg = BlockRegistry.get(blockId);
          if (!cfg.isFoliage || BlockRegistry.getRenderShape(blockId) !== 'cube') continue;

          const texIdx = BlockRegistry.getFaceTextureIndex(blockId, 0);
          const px = x;
          const py = y;
          const pz = z;

          positions.push(
            px, py, pz,
            px + 1, py, pz + 1,
            px + 1, py + 1, pz + 1,
            px, py + 1, pz,
            px, py, pz + 1,
            px + 1, py, pz,
            px + 1, py + 1, pz,
            px, py + 1, pz + 1,
          );

          for (let i = 0; i < 8; i++) {
            normals.push(0, 1, 0);
            aos.push(3);
            tiles.push(texIdx);
          }

          uvs.push(
            0, 0, 1, 0, 1, 1, 0, 1,
            0, 0, 1, 0, 1, 1, 0, 1,
          );

          indices.push(
            vertexCount + 0, vertexCount + 1, vertexCount + 2,
            vertexCount + 0, vertexCount + 2, vertexCount + 3,
            vertexCount + 4, vertexCount + 5, vertexCount + 6,
            vertexCount + 4, vertexCount + 6, vertexCount + 7,
          );

          vertexCount += 8;
        }
      }
    }

    return {
      positions: new Float32Array(positions),
      indices: this.createIndexBuffer(indices, vertexCount),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      aos: new Float32Array(aos),
      tiles: new Float32Array(tiles),
    };
  }
}
