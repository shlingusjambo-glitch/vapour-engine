import * as THREE from 'three';
import { BlockRegistry } from './BlockRegistry';

export class Chunk {
  public x: number;
  public y: number;
  public z: number;
  public voxels: Uint16Array;
  public generated: boolean = false;
  public dirty: boolean = false;
  public meshesLoaded: boolean = false;

  // Three.js visual objects
  public opaqueMesh: THREE.Mesh | null = null;
  public transparentMesh: THREE.Mesh | null = null;
  public waterMesh: THREE.Mesh | null = null;
  public foliageMesh: THREE.Mesh | null = null;

  private scene: THREE.Scene;
  private materials: {
    opaque: THREE.ShaderMaterial;
    transparent: THREE.ShaderMaterial;
    water: THREE.ShaderMaterial;
    foliage: THREE.ShaderMaterial;
  };

  constructor(
    x: number, y: number, z: number,
    scene: THREE.Scene,
    materials: { opaque: THREE.ShaderMaterial; transparent: THREE.ShaderMaterial; water: THREE.ShaderMaterial; foliage: THREE.ShaderMaterial }
  ) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.scene = scene;
    this.materials = materials;
    this.voxels = new Uint16Array(16 * 16 * 16);
    this.generated = false;
  }

  public getVoxel(lx: number, ly: number, lz: number): number {
    if (lx < 0 || lx > 15 || ly < 0 || ly > 15 || lz < 0 || lz > 15) return 0;
    return this.voxels[lx + (ly << 4) + (lz << 8)];
  }

  public setVoxel(lx: number, ly: number, lz: number, blockId: number): void {
    if (lx < 0 || lx > 15 || ly < 0 || ly > 15 || lz < 0 || lz > 15) return;
    this.voxels[lx + (ly << 4) + (lz << 8)] = blockId;
    this.dirty = true;
  }

  /**
   * Sets geometry attributes from Web Worker buffers
   */
  public updateGeometry(
    opaqueData: any,
    transparentData: any,
    waterData: any,
    foliageData: any
  ): void {
    // 1. Create or Update Opaque Mesh
    this.opaqueMesh = this.applyGeometryToMesh(this.opaqueMesh, opaqueData, this.materials.opaque, false);

    // 2. Create or Update Transparent Mesh (water/glass)
    this.transparentMesh = this.applyGeometryToMesh(this.transparentMesh, transparentData, this.materials.transparent, true);
    if (this.transparentMesh) this.transparentMesh.renderOrder = 6;

    // 3. Create or Update Water Mesh
    this.waterMesh = this.applyGeometryToMesh(this.waterMesh, waterData, this.materials.water, true);
    if (this.waterMesh) this.waterMesh.renderOrder = 8;

    // 4. Create or Update Foliage Mesh
    this.foliageMesh = this.applyGeometryToMesh(this.foliageMesh, foliageData, this.materials.foliage, true);
    if (this.foliageMesh) this.foliageMesh.renderOrder = 7;

    this.meshesLoaded = true;
    this.dirty = false;
  }

  private applyGeometryToMesh(
    mesh: THREE.Mesh | null,
    geoData: any,
    material: THREE.ShaderMaterial,
    isTransparent: boolean
  ): THREE.Mesh | null {
    const positions = geoData?.positions instanceof Float32Array ? geoData.positions : new Float32Array(0);
    const vertexCount = Math.floor(positions.length / 3);
    if (vertexCount <= 0) {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
      }
      return null;
    }

    const normals = geoData?.normals instanceof Float32Array && geoData.normals.length === vertexCount * 3
      ? geoData.normals
      : new Float32Array(vertexCount * 3);
    const uvs = geoData?.uvs instanceof Float32Array && geoData.uvs.length === vertexCount * 2
      ? geoData.uvs
      : new Float32Array(vertexCount * 2);
    const aos = geoData?.aos instanceof Float32Array && geoData.aos.length === vertexCount
      ? geoData.aos
      : new Float32Array(vertexCount).fill(3);
    const tiles = geoData?.tiles instanceof Float32Array && geoData.tiles.length === vertexCount
      ? geoData.tiles
      : new Float32Array(vertexCount);

    let geometry: THREE.BufferGeometry;

    if (!mesh) {
      geometry = new THREE.BufferGeometry();
      mesh = new THREE.Mesh(geometry, material);
      // Transparent meshes shouldn't cast/receive shadows to avoid depth conflicts
      if (isTransparent) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      } else {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.userData.isOpaqueChunk = true;
      }
      mesh.userData.chunkMesh = true;
      mesh.frustumCulled = true;
      // Position the chunk mesh in world space
      mesh.position.set(this.x * 16, this.y * 16, this.z * 16);
      this.scene.add(mesh);
    } else {
      geometry = mesh.geometry as THREE.BufferGeometry;
    }

    // Bind or Update Attributes. Keep every custom attribute exactly vertexCount-sized.
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (posAttr) {
      posAttr.array = positions;
      posAttr.count = vertexCount;
      posAttr.needsUpdate = true;
    } else {
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }

    const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (normalAttr) {
      normalAttr.array = normals;
      normalAttr.count = vertexCount;
      normalAttr.needsUpdate = true;
    } else {
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    }

    const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (uvAttr) {
      uvAttr.array = uvs;
      uvAttr.count = vertexCount;
      uvAttr.needsUpdate = true;
    } else {
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }

    const aoAttr = geometry.getAttribute('aAO') as THREE.BufferAttribute | undefined;
    if (aoAttr) {
      aoAttr.array = aos;
      aoAttr.count = vertexCount;
      aoAttr.needsUpdate = true;
    } else {
      geometry.setAttribute('aAO', new THREE.BufferAttribute(aos, 1));
    }

    const tileAttr = geometry.getAttribute('aTile') as THREE.BufferAttribute | undefined;
    if (tileAttr) {
      tileAttr.array = tiles;
      tileAttr.count = vertexCount;
      tileAttr.needsUpdate = true;
    } else {
      geometry.setAttribute('aTile', new THREE.BufferAttribute(tiles, 1));
    }

    const normalizedIndices = this.normalizeIndexBuffer(geoData.indices);
    const indexAttr = geometry.getIndex();
    if (indexAttr) {
      indexAttr.array = normalizedIndices;
      indexAttr.count = normalizedIndices.length;
      indexAttr.needsUpdate = true;
    } else {
      geometry.setIndex(new THREE.BufferAttribute(normalizedIndices, 1));
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    // Render configuration
    if (isTransparent) {
      mesh.renderOrder = 10;
    }

    return mesh;
  }

  private normalizeIndexBuffer(indices: ArrayLike<number>): Uint16Array | Uint32Array {
    if (indices instanceof Uint16Array || indices instanceof Uint32Array) {
      return indices;
    }

    let maxIndex = 0;
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] > maxIndex) maxIndex = indices[i];
    }

    return maxIndex <= 65535
      ? Uint16Array.from(indices)
      : Uint32Array.from(indices);
  }

  public dispose(): void {
    if (this.opaqueMesh) {
      this.scene.remove(this.opaqueMesh);
      this.opaqueMesh.geometry.dispose();
      this.opaqueMesh = null;
    }
    if (this.transparentMesh) {
      this.scene.remove(this.transparentMesh);
      this.transparentMesh.geometry.dispose();
      this.transparentMesh = null;
    }
    if (this.waterMesh) {
      this.scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMesh = null;
    }
    if (this.foliageMesh) {
      this.scene.remove(this.foliageMesh);
      this.foliageMesh.geometry.dispose();
      this.foliageMesh = null;
    }
    this.meshesLoaded = false;
    this.generated = false;
  }
}
