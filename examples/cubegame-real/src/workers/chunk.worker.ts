import { BiomeGenerator } from '../world/BiomeGenerator';
import { Mesher } from '../world/Mesher';
import { BlockRegistry } from '../world/BlockRegistry';

// Keep an active generator cache
let generator: BiomeGenerator | null = null;
let currentSeed: number | string = '';

self.addEventListener('message', (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    const { seed } = payload;
    generator = new BiomeGenerator(seed);
    currentSeed = seed;
    self.postMessage({ type: 'initialized' });
  }

  else if (type === 'registerBlock') {
    const { config } = payload;
    BlockRegistry.register(config);
  }

  else if (type === 'generate') {
    const { x, y, z, dimension, revision } = payload;
    if (!generator) {
      generator = new BiomeGenerator(currentSeed || 0);
    }

    const voxels = generator.generateChunkData(x, y, z, dimension);
    
    // Transfer the raw Uint16Array back to main thread
    self.postMessage({
      type: 'generated',
      payload: { x, y, z, voxels, revision }
    }, [voxels.buffer]);
  }

  else if (type === 'mesh') {
    const { x, y, z, voxels18, revision } = payload;
    
    // 1. Generate Opaque Mesh
    const opaqueMesh = Mesher.generateMesh(voxels18, false);

    // 2. Generate Transparent Meshes (glass/leaves separate from water)
    const transparentMesh = Mesher.generateMesh(voxels18, 'transparent');
    const waterMesh = Mesher.generateMesh(voxels18, 'water');

    // 3. Generate Foliage Mesh (Flowers, Grass) directly from the padded voxels18 array
    const foliageMesh = Mesher.generateFoliageMesh(voxels18);

    // Transfer buffers back
    const transfers = [
      opaqueMesh.positions.buffer, opaqueMesh.indices.buffer, opaqueMesh.normals.buffer, opaqueMesh.uvs.buffer, opaqueMesh.aos.buffer, opaqueMesh.tiles.buffer,
      transparentMesh.positions.buffer, transparentMesh.indices.buffer, transparentMesh.normals.buffer, transparentMesh.uvs.buffer, transparentMesh.aos.buffer, transparentMesh.tiles.buffer,
      waterMesh.positions.buffer, waterMesh.indices.buffer, waterMesh.normals.buffer, waterMesh.uvs.buffer, waterMesh.aos.buffer, waterMesh.tiles.buffer,
      foliageMesh.positions.buffer, foliageMesh.indices.buffer, foliageMesh.normals.buffer, foliageMesh.uvs.buffer, foliageMesh.aos.buffer, foliageMesh.tiles.buffer
    ];

    self.postMessage({
      type: 'meshed',
      payload: {
        x, y, z,
        opaque: opaqueMesh,
        transparent: transparentMesh,
        water: waterMesh,
        foliage: foliageMesh,
        revision
      }
    }, transfers);
  }
});
