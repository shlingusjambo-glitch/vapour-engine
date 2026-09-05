import * as THREE from 'three';
import { Chunk } from './Chunk';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../core/EventBus';
// @ts-ignore
import ChunkWorker from '../workers/chunk.worker?worker&inline';
import { RedstoneSystem } from './RedstoneSystem';
import { LiquidSystem } from './LiquidSystem';
import { BiomeGenerator } from './BiomeGenerator';
import { Mesher } from './Mesher';
import { BlockRegistry } from './BlockRegistry';
import { getFeatureBlockId } from '../content/FeatureCatalog';
import { planChunkInterest, WorkerTaskPool } from '@vapour/engine';

interface ChunkWorkerMessage {
  type: string;
  payload?: any;
}

export class WorldManager {
  private scene: THREE.Scene;
  private seed: number = 12345;
  private renderDistance: number = 6;

  // Map coordinate "x,y,z" to Chunk
  public chunks: Map<string, Chunk> = new Map();

  // In-memory diff store: tracks ALL player-made voxel changes per chunk
  // including blocks set to 0 (broken blocks) — critical for correct persistence
  private chunkModifications: Map<string, { [index: number]: number }> = new Map();

  // Web Worker Pool
  private workerPool: WorkerTaskPool<ChunkWorkerMessage, ChunkWorkerMessage> | null = null;
  private useWorkers = false;
  private mainThreadQueue: any[] = [];
  private queuedMeshKeys: Set<string> = new Set();
  private mainThreadGenerator: BiomeGenerator | null = null;
  private maxChunkLoadsPerUpdate = 4;
  private maxMainThreadTasksPerUpdate = 2;
  private mainThreadTaskBudgetMs = 6;
  private maxRemeshesPerUpdate = 8;
  private maxMeshUploadsPerUpdate = 1;
  private readonly verticalChunkPadding = 2;
  private readonly minChunkY = -4;
  private readonly maxChunkY = 10; // Caves & Cliffs-style expanded vertical space: Y=-64..175, scaled for this engine's performance budget.
  private activeChunkKeys: Set<string> = new Set();
  private worldRevision = 0;
  private dirtyChunkModificationKeys: Set<string> = new Set();
  private modificationFlushTimer: number | null = null;
  private readonly modificationFlushDelayMs = 600;
  private scheduledRemeshKeys: Set<string> = new Set();
  private remeshFlushTimer: number | null = null;
  private readonly remeshFlushDelayMs = 35;
  private readonly updateChunkCandidates: Array<{ cx: number; cy: number; cz: number; distSq: number }> = [];
  private readonly transparentSortCenter = new THREE.Vector3();
  private readonly neighborChunksScratch: Array<Chunk | null> = new Array(27);
  private readonly lastSortPlayerPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  private needsTransparentSort = true;

  public currentDimension: string = 'overworld';
  public redstoneSystem: RedstoneSystem;
  public liquidSystem: LiquidSystem;

  // Track pending generation callbacks
  private pendingCallbacks: Map<string, Array<(chunk: Chunk) => void>> = new Map();

  // Mesh materials reference passed down
  private chunkMaterials: {
    opaque: THREE.ShaderMaterial;
    transparent: THREE.ShaderMaterial;
    water: THREE.ShaderMaterial;
    foliage: THREE.ShaderMaterial;
  };

  // Keep track of total queue length for debug UI
  public workerQueueLength = 0;

  private meshUploadQueue: Array<{
    chunk: any;
    opaque: any;
    transparent: any;
    water: any;
    foliage: any;
  }> = [];

  private lastCachedChunkVal: Chunk | null = null;
  private chunkCache: Array<Chunk> = [];
  private lastUpdateChunkX = Infinity;
  private lastUpdateChunkY = Infinity;
  private lastUpdateChunkZ = Infinity;
  private hasMoreChunksToLoad = true;

  constructor(
    scene: THREE.Scene,
    materials: { opaque: THREE.ShaderMaterial; transparent: THREE.ShaderMaterial; water: THREE.ShaderMaterial; foliage: THREE.ShaderMaterial }
  ) {
    this.scene = scene;
    this.chunkMaterials = materials;
    this.redstoneSystem = new RedstoneSystem(this);
    this.liquidSystem = new LiquidSystem(this);
  }

  public async init(seed: number, renderDistance: number): Promise<void> {
    this.terminateWorkers();
    this.worldRevision++;
    this.seed = seed;
    this.renderDistance = renderDistance;
    this.useWorkers = typeof Worker !== 'undefined';
    this.mainThreadGenerator = null;

    const ua = navigator.userAgent.toLowerCase();
    const isMobileLike = /iphone|ipad|ipod|android|mobile/.test(ua) || (navigator.maxTouchPoints || 0) >= 2;

    if (isMobileLike) {
      // iOS/WKWebView hitches hardest when hundreds of chunks are queued at once.
      // Keep the world responsive first, then stream the outer ring in gradually.
      this.renderDistance = Math.min(this.renderDistance, 4);
      this.maxChunkLoadsPerUpdate = 2;
      this.maxMainThreadTasksPerUpdate = 1;
      this.mainThreadTaskBudgetMs = 4;
      this.maxRemeshesPerUpdate = 3;
      this.maxMeshUploadsPerUpdate = 1;
    } else {
      this.maxChunkLoadsPerUpdate = 4;
      this.maxMainThreadTasksPerUpdate = 2;
      this.mainThreadTaskBudgetMs = 6;
      this.maxRemeshesPerUpdate = 8;
      this.maxMeshUploadsPerUpdate = 1;
    }

    if (!this.useWorkers) {
      return;
    }

    // Initialize Worker Pool. Chunk generation and meshing are the biggest FPS
    // cost; keeping them off the main thread makes movement feel dramatically smoother.
    // Do not disable workers purely because the browser is Safari/WKWebView: the
    // native iOS build serves the Vite bundle from a stable origin, and actual
    // worker startup failures are already caught below.
    const workerCount = isMobileLike ? 2 : Math.max(2, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
    try {
      const pool = new WorkerTaskPool<ChunkWorkerMessage, ChunkWorkerMessage>({
        size: workerCount,
        createWorker: () => new ChunkWorker(),
        initialize: (worker) => worker.postMessage({ type: 'init', payload: { seed: this.seed } }),
        isReady: (message) => message.type === 'initialized',
        onReady: (worker) => {
          for (const block of BlockRegistry.getAll()) {
            worker.postMessage({ type: 'registerBlock', payload: { config: block } });
          }
        },
        transfer: (message) => message.type === 'mesh' && message.payload?.voxels18?.buffer
          ? [message.payload.voxels18.buffer]
          : undefined,
        onResponse: async (message) => {
          await this.handleWorkerResponse(message);
          this.syncWorkerQueueLength();
        },
        onError: (error, _workerIndex, interrupted) => {
          console.warn('Vapour worker task failed:', error);
          if (interrupted?.type === 'mesh') {
            const { x, y, z } = interrupted.payload;
            this.queuedMeshKeys.delete(`${x},${y},${z}`);
            const chunk = this.chunks.get(`${x},${y},${z}`);
            if (chunk?.generated) this.requestChunkMesh(chunk);
          }
          queueMicrotask(() => {
            if (this.workerPool?.stats().failed === this.workerPool?.stats().workers) {
              this.fallbackFromWorkers();
            }
            this.syncWorkerQueueLength();
          });
        },
      });
      this.workerPool = pool;
      pool.start();
      this.syncWorkerQueueLength();
    } catch (err) {
      console.warn('Worker pool creation failed, falling back to main-thread processing:', err);
      this.fallbackFromWorkers();
    }
  }

  public setRenderDistance(distance: number): void {
    this.renderDistance = Math.max(2, Math.min(10, Math.floor(distance)));
  }

  public isColumnReady(position: THREE.Vector3): boolean {
    const readiness = this.getColumnReadiness(position);
    return readiness.ready === readiness.total;
  }

  /** Reports actual generated-and-uploaded sections around a world position.
   * Loading UI consumes this instead of guessing readiness from global chunk
   * counts, which may include unrelated or not-yet-renderable chunks. */
  public getColumnReadiness(position: THREE.Vector3): { ready: number; total: number; progress: number } {
    const cx = Math.floor(position.x / 16);
    const cy = Math.floor(position.y / 16);
    const cz = Math.floor(position.z / 16);
    const range = this.getVerticalChunkRange(cy, 1);
    let ready = 0;
    const total = range.max - range.min + 1;
    for (let chunkY = range.min; chunkY <= range.max; chunkY++) {
      const chunk = this.chunks.get(`${cx},${chunkY},${cz}`);
      if (chunk?.meshesLoaded) ready++;
    }
    return { ready, total, progress: total === 0 ? 1 : ready / total };
  }

  public findGroundSpawnNear(origin: THREE.Vector3, minRadius = 2, maxRadius = 18): THREE.Vector3 | null {
    const candidates: Array<[number, number]> = [];
    candidates.push([Math.floor(origin.x), Math.floor(origin.z)]);

    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = minRadius + Math.random() * (maxRadius - minRadius);
      candidates.push([
        Math.floor(origin.x + Math.cos(angle) * radius),
        Math.floor(origin.z + Math.sin(angle) * radius)
      ]);
    }

    for (const [x, z] of candidates) {
      const columnChunks = Array.from(this.chunks.values())
        .filter(chunk => chunk.x === Math.floor(x / 16) && chunk.z === Math.floor(z / 16) && chunk.meshesLoaded);
      if (columnChunks.length === 0) continue;

      const minY = Math.min(...columnChunks.map(chunk => chunk.y)) * 16;
      const maxY = Math.max(...columnChunks.map(chunk => chunk.y)) * 16 + 15;

      for (let y = maxY - 2; y >= minY + 2; y--) {
        const ground = this.getVoxel(x, y - 1, z);
        const feet = this.getVoxel(x, y, z);
        const head = this.getVoxel(x, y + 1, z);
        const aboveHead = this.getVoxel(x, y + 2, z);

        const groundCfg = BlockRegistry.get(ground);
        const feetCfg = BlockRegistry.get(feet);
        const headCfg = BlockRegistry.get(head);

        if (
          ground !== 0 &&
          groundCfg.isSolid &&
          !groundCfg.isWater &&
          feet === 0 &&
          head === 0 &&
          aboveHead === 0 &&
          !feetCfg.isWater &&
          !headCfg.isWater
        ) {
          return new THREE.Vector3(x + 0.5, y, z + 0.5);
        }
      }
    }

    return null;
  }

  /**
   * Main ticking update: loads and unloads chunks around player position
   */
  public update(playerPosition: THREE.Vector3): void {
    const playerChunkX = Math.floor(playerPosition.x / 16);
    const playerChunkY = Math.floor(playerPosition.y / 16);
    const playerChunkZ = Math.floor(playerPosition.z / 16);
    const isCompactArena = this.currentDimension === 'baseline_sandbox' || this.currentDimension.startsWith('cbgo_') || this.currentDimension.startsWith('tf2_') || this.currentDimension.startsWith('cob_') || this.currentDimension === 'void_duels';
    const effectiveRenderDistance = isCompactArena ? Math.min(this.renderDistance, 4) : this.renderDistance;
    const verticalRange = this.getVerticalChunkRange(playerChunkY, isCompactArena ? 1 : this.verticalChunkPadding);

    const chunkBoundaryCrossed = playerChunkX !== this.lastUpdateChunkX ||
                                 playerChunkY !== this.lastUpdateChunkY ||
                                 playerChunkZ !== this.lastUpdateChunkZ;

    const shouldRebuild = chunkBoundaryCrossed || this.hasMoreChunksToLoad;

    if (shouldRebuild) {
      this.lastUpdateChunkX = playerChunkX;
      this.lastUpdateChunkY = playerChunkY;
      this.lastUpdateChunkZ = playerChunkZ;

      const activeKeys = this.activeChunkKeys;
      const chunkCandidates = this.updateChunkCandidates;
      activeKeys.clear();
      chunkCandidates.length = 0;

      // Vapour's reusable interest planner handles stable nearest-first 3D
      // scheduling. CubeGame keeps its existing worker/persistence pipeline;
      // other games can use the same planner or the full ChunkStreamManager.
      const verticalCenter = Math.floor((verticalRange.min + verticalRange.max) / 2);
      const chunkPlan = planChunkInterest([{
        coordinate: { x: playerChunkX, y: verticalCenter, z: playerChunkZ },
        radius: effectiveRenderDistance,
        verticalRadius: verticalCenter - verticalRange.min,
      }], 'cylinder', (coordinate) => {
        const dx = coordinate.x - playerChunkX;
        const dz = coordinate.z - playerChunkZ;
        return dx * dx + dz * dz + Math.abs(coordinate.y - playerChunkY) * 0.18;
      });
      for (const planned of chunkPlan) {
        const { x: cx, y: cy, z: cz } = planned.coordinate;
        const key = `${cx},${cy},${cz}`;
        activeKeys.add(key);
        if (!this.chunks.has(key)) chunkCandidates.push({ cx, cy, cz, distSq: planned.priority });
      }
      const chunksToLoad = Math.min(chunkCandidates.length, this.maxChunkLoadsPerUpdate);
      for (let i = 0; i < chunksToLoad; i++) {
        const candidate = chunkCandidates[i];
        this.loadChunk(candidate.cx, candidate.cy, candidate.cz);
      }
      this.hasMoreChunksToLoad = chunkCandidates.length > chunksToLoad;

      // Unload chunks outside radius
      for (const [key, chunk] of this.chunks.entries()) {
        if (!activeKeys.has(key)) {
          this.unloadChunk(key, chunk);
        }
      }
    }

    this.flushRemeshQueue(this.maxRemeshesPerUpdate);
    this.processMainThreadQueue();

    // Process adaptive number of mesh uploads per frame to balance load speed and frame rate stability.
    const uploadStart = performance.now();
    const uploadBudgetMs = 2.0;
    let uploadsCount = 0;
    while (this.meshUploadQueue.length > 0) {
      if (uploadsCount >= this.maxMeshUploadsPerUpdate && (performance.now() - uploadStart) > uploadBudgetMs) {
        break;
      }
      const upload = this.meshUploadQueue.shift();
      if (!upload) break;
      const key = `${upload.chunk.x},${upload.chunk.y},${upload.chunk.z}`;
      if (this.chunks.get(key) === upload.chunk) {
        upload.chunk.updateGeometry(upload.opaque, upload.transparent, upload.water, upload.foliage);
        this.needsTransparentSort = true;
      }
      uploadsCount++;
    }

    // Recompute render order for transparent layers (back-to-front by chunk distance)
    const playerMoved = playerPosition.distanceTo(this.lastSortPlayerPosition) > 0.5;
    if (playerMoved || this.needsTransparentSort) {
      this.lastSortPlayerPosition.copy(playerPosition);
      this.needsTransparentSort = false;
      for (const chunk of this.chunks.values()) {
        this.transparentSortCenter.set(chunk.x * 16 + 8, chunk.y * 16 + 8, chunk.z * 16 + 8);
        const dist = Math.max(0, playerPosition.distanceTo(this.transparentSortCenter));
        const depthIndex = Math.max(0, Math.round(100 - dist));

        if (chunk.transparentMesh) {
          chunk.transparentMesh.renderOrder = 200 + depthIndex;
        }
        if (chunk.waterMesh) {
          chunk.waterMesh.renderOrder = 300 + depthIndex;
        }
        if (chunk.foliageMesh) {
          chunk.foliageMesh.renderOrder = 250 + depthIndex;
        }
      }
    }
  }

  private getVerticalChunkRange(playerChunkY: number, padding = this.verticalChunkPadding): { min: number; max: number } {
    const center = Math.max(this.minChunkY, Math.min(this.maxChunkY, playerChunkY));
    let min = Math.max(this.minChunkY, center - padding);
    let max = Math.min(this.maxChunkY, center + padding);

    const wantedSections = padding * 2 + 1;
    while (max - min + 1 < wantedSections && min > this.minChunkY) min--;
    while (max - min + 1 < wantedSections && max < this.maxChunkY) max++;

    return { min, max };
  }

  /**
   * Runs game-tick actions (stable 20Hz rate)
   */
  public tick(dt: number): void {
    // 1. Tick Redstone and Automation
    this.redstoneSystem.tick(dt);

    // 2. Tick Fluid Simulation
    this.liquidSystem.tick(dt);

    // 3. Random crop and farmland ticking
    const farmlandId = getFeatureBlockId('Farmland');
    const hydratedFarmlandId = getFeatureBlockId('Hydrated Farmland');

    for (const chunk of this.chunks.values()) {
      if (!chunk.generated) continue;

      for (let i = 0; i < 4; i++) {
        const lx = Math.floor(Math.random() * 16);
        const ly = Math.floor(Math.random() * 16);
        const lz = Math.floor(Math.random() * 16);
        const index = lx + (ly << 4) + (lz << 8);
        const blockId = chunk.voxels[index];
        if (blockId === 0) continue;

        const blockName = BlockRegistry.get(blockId).name || "";
        let cropType = "";
        let stage = -1;

        if (blockName.includes("Wheat Crops")) {
          cropType = "Wheat";
          const match = blockName.match(/Stage\s*([0-7])/i);
          stage = match ? parseInt(match[1]) : 0;
        } else if (blockName.includes("Carrot Crops")) {
          cropType = "Carrot";
          const match = blockName.match(/Stage\s*([0-7])/i);
          stage = match ? parseInt(match[1]) : 0;
        } else if (blockName.includes("Potato Crops")) {
          cropType = "Potato";
          const match = blockName.match(/Stage\s*([0-7])/i);
          stage = match ? parseInt(match[1]) : 0;
        } else if (blockName.includes("Beetroot Crops")) {
          cropType = "Beetroot";
          const match = blockName.match(/Stage\s*([0-7])/i);
          stage = match ? parseInt(match[1]) : 0;
        } else if (blockName.includes("Berry Bush")) {
          cropType = "Berry";
          const match = blockName.match(/Stage\s*([0-7])/i);
          stage = match ? parseInt(match[1]) : 0;
        }

        const gx = chunk.x * 16 + lx;
        const gy = chunk.y * 16 + ly;
        const gz = chunk.z * 16 + lz;

        if (cropType !== "") {
          // Verify soil below
          const underBlock = this.getVoxel(gx, gy - 1, gz);
          const validSoil = underBlock === farmlandId || underBlock === hydratedFarmlandId || underBlock === 1 || underBlock === 2;
          
          if (!validSoil) {
            this.setVoxel(gx, gy, gz, 0, true);
            // Spawn seed drop
            const seedId = cropType === "Wheat" ? 433 : cropType === "Carrot" ? 434 : cropType === "Potato" ? 435 : cropType === "Beetroot" ? 436 : 440;
            EventBus.emit('item:spawn', new THREE.Vector3(gx + 0.5, gy + 0.5, gz + 0.5), seedId);
          } else if (stage < 7) {
            // Roll for growth
            let growthChance = 0.05;
            if (underBlock === hydratedFarmlandId) {
              growthChance = 0.22;
            } else if (underBlock === farmlandId) {
              growthChance = 0.08;
            }
            
            if (Math.random() < growthChance) {
              const nextStageName = cropType === "Berry" 
                ? `Berry Bush Stage ${stage + 1}`
                : `${cropType} Crops Stage ${stage + 1}`;
              const nextStageId = getFeatureBlockId(nextStageName);
              if (nextStageId !== 0) {
                this.setVoxel(gx, gy, gz, nextStageId, true);
              }
            }
          }
        } else if (blockId === farmlandId) {
          // Dry farmland check hydration
          const hasWater = this.hasNearbyWater(gx, gy, gz, 4);
          if (hasWater) {
            this.setVoxel(gx, gy, gz, hydratedFarmlandId, true);
          } else if (Math.random() < 0.04) {
            // Check if there is a crop on top
            const cropAbove = this.getVoxel(gx, gy + 1, gz);
            const aboveName = BlockRegistry.get(cropAbove).name || "";
            const hasCrop = aboveName.includes("Crop") || aboveName.includes("Bush");
            if (!hasCrop) {
              this.setVoxel(gx, gy, gz, 2, true); // dry back to dirt
            }
          }
        } else if (blockId === hydratedFarmlandId) {
          // Wet farmland check drying
          const hasWater = this.hasNearbyWater(gx, gy, gz, 4);
          if (!hasWater && Math.random() < 0.1) {
            this.setVoxel(gx, gy, gz, farmlandId, true); // dry out
          }
        }

        // ── Block Gravity ──
        const isGravityBlock = blockId === 6 || blockId === 16 || blockName.endsWith(" Concrete Powder");
        if (isGravityBlock) {
          let fallY = gy - 1;
          while (fallY >= 0) {
            const belowId = this.getVoxel(gx, fallY, gz);
            if (belowId === 0 || belowId === 7 || belowId === 37) {
              fallY--;
            } else {
              break;
            }
          }
          const targetY = fallY + 1;
          if (targetY < gy) {
            this.setVoxel(gx, gy, gz, 0, true);
            this.setVoxel(gx, targetY, gz, blockId, true);
          }
        }

        // ── Copper Block Oxidation ──
        const copperBlockId = getFeatureBlockId('Copper Block');
        const weatheredCopperId = getFeatureBlockId('Weathered Copper');
        const oxidizedCopperId = getFeatureBlockId('Oxidized Copper');
        if (blockId === copperBlockId || blockId === weatheredCopperId) {
          const key = `${gx},${gy},${gz}`;
          const isWaxed = this.waxedBlocks && this.waxedBlocks.has(key);
          if (!isWaxed && Math.random() < 0.06) {
            const nextBlock = blockId === copperBlockId ? weatheredCopperId : oxidizedCopperId;
            this.setVoxel(gx, gy, gz, nextBlock, true);
          }
        }

        // ── Dripping Particles ──
        const aboveId = this.getVoxel(gx, gy + 1, gz);
        const belowId = this.getVoxel(gx, gy - 1, gz);
        if (BlockRegistry.get(blockId).isSolid && belowId === 0) {
          if (aboveId === 7 || aboveId === 37) {
            if (Math.random() < 0.25) {
              EventBus.emit('particles:spawn', new THREE.Vector3(gx + 0.5, gy - 0.05, gz + 0.5), aboveId, 1);
            }
          }
        }
      }
    }
  }

  public setDimension(dimension: string): void {
    if (this.currentDimension === dimension) return;
    this.currentDimension = dimension;

    // Clear all active chunks from scene
    this.clear();
    console.log(`World manager dimension set to: ${dimension}`);
  }

  private loadChunk(cx: number, cy: number, cz: number): void {
    const key = `${cx},${cy},${cz}`;
    const chunk = new Chunk(cx, cy, cz, this.scene, this.chunkMaterials);
    this.chunks.set(key, chunk);
    this.lastCachedChunkVal = null;

    // Queue chunk generation
    this.postToWorker({
      type: 'generate',
      payload: { x: cx, y: cy, z: cz, dimension: this.currentDimension, revision: this.worldRevision }
    });
  }

  /**
   * Request solid and transparent meshes for a chunk
   */
  public requestChunkMesh(chunk: Chunk): void {
    if (!chunk.generated) {
      return;
    }

    const meshKey = `${chunk.x},${chunk.y},${chunk.z}`;
    this.scheduledRemeshKeys.add(meshKey);

    if (typeof window === 'undefined') {
      this.flushRemeshQueue();
      return;
    }

    if (this.remeshFlushTimer !== null) return;
    this.remeshFlushTimer = window.setTimeout(() => {
      this.remeshFlushTimer = null;
      this.flushRemeshQueue(12);
    }, this.remeshFlushDelayMs);
  }

  private flushRemeshQueue(limit = Infinity): void {
    if (this.remeshFlushTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.remeshFlushTimer);
      this.remeshFlushTimer = null;
    }

    let processed = 0;
    for (const key of Array.from(this.scheduledRemeshKeys)) {
      if (processed >= limit) break;
      this.scheduledRemeshKeys.delete(key);
      const chunk = this.chunks.get(key);
      if (chunk?.generated) {
        this.requestChunkMeshNow(chunk);
        processed++;
      }
    }
  }

  private requestChunkMeshNow(chunk: Chunk): void {
    if (!chunk.generated) {
      return;
    }

    // To generate the mesh, we need a 1-block padding on all 6 sides.
    // If adjacent chunks are not generated yet, we wait.
    if (!this.areNeighborsGenerated(chunk.x, chunk.y, chunk.z)) {
      return; // Mesh request will re-trigger once neighbors generate
    }

    const voxels18 = this.buildPaddedVoxelArray(chunk);
    const meshKey = `${chunk.x},${chunk.y},${chunk.z}`;
    if (this.useWorkers) {
      if (this.queuedMeshKeys.has(meshKey)) return;
      this.queuedMeshKeys.add(meshKey);
    }

    this.postToWorker({
      type: 'mesh',
      payload: {
        x: chunk.x,
        y: chunk.y,
        z: chunk.z,
        voxels18,
        revision: this.worldRevision
      }
    });
  }

  private areNeighborsGenerated(cx: number, cy: number, cz: number): boolean {
    // Check 6 face neighbors
    const neighbors = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];

    for (const [dx, dy, dz] of neighbors) {
      const ny = cy + dy;
      if (ny < this.minChunkY || ny > this.maxChunkY) continue; // vertical bounds

      const key = `${cx + dx},${ny},${cz + dz}`;
      if (!this.activeChunkKeys.has(key)) continue;
      const neighbor = this.chunks.get(key);
      if (!neighbor?.generated) return false;
    }
    return true;
  }

  private buildPaddedVoxelArray(chunk: Chunk): Uint16Array {
    const arr = new Uint16Array(18 * 18 * 18);
    const neighborChunks = this.neighborChunksScratch;

    for (let dy = -1; dy <= 1; dy++) {
      const ny = chunk.y + dy;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nKey = `${chunk.x + dx},${ny},${chunk.z + dz}`;
          const nChunk = this.chunks.get(nKey);
          const idx = (dx + 1) + (dz + 1) * 3 + (dy + 1) * 9;
          neighborChunks[idx] = nChunk && nChunk.generated ? nChunk : null;
        }
      }
    }

    for (let y = -1; y <= 16; y++) {
      let ndy = 1;
      let ly = y;
      if (y < 0) {
        ndy = 0;
        ly = 15;
      } else if (y > 15) {
        ndy = 2;
        ly = 0;
      }
      const yOffset = ndy * 9;

      for (let z = -1; z <= 16; z++) {
        let ndz = 1;
        let lz = z;
        if (z < 0) {
          ndz = 0;
          lz = 15;
        } else if (z > 15) {
          ndz = 2;
          lz = 0;
        }
        const zOffset = ndz * 3;

        for (let x = -1; x <= 16; x++) {
          let ndx = 1;
          let lx = x;
          if (x < 0) {
            ndx = 0;
            lx = 15;
          } else if (x > 15) {
            ndx = 2;
            lx = 0;
          }

          const nChunkIdx = ndx + zOffset + yOffset;
          const nChunk = neighborChunks[nChunkIdx];
          const blockId = nChunk ? nChunk.voxels[lx + (ly << 4) + (lz << 8)] : 0;

          const index = (x + 1) + (y + 1) * 18 + (z + 1) * 324;
          arr[index] = blockId;
        }
      }
    }
    return arr;
  }

  // GLOBAL VOXEL ACCESSORS
  public getVoxel(x: number, y: number, z: number): number {
    const cx = Math.floor(x / 16);
    const cy = Math.floor(y / 16);
    const cz = Math.floor(z / 16);

    let chunk = this.lastCachedChunkVal;
    if (!chunk || chunk.x !== cx || chunk.y !== cy || chunk.z !== cz) {
      chunk = null;
      for (let i = 0; i < this.chunkCache.length; i++) {
        const c = this.chunkCache[i];
        if (c.x === cx && c.y === cy && c.z === cz) {
          chunk = c;
          if (i > 0) {
            this.chunkCache.splice(i, 1);
            this.chunkCache.unshift(chunk);
          }
          break;
        }
      }

      if (!chunk) {
        const chunkKey = `${cx},${cy},${cz}`;
        chunk = this.chunks.get(chunkKey) || null;
        if (chunk) {
          this.chunkCache.unshift(chunk);
          if (this.chunkCache.length > 4) {
            this.chunkCache.pop();
          }
        }
      }
      this.lastCachedChunkVal = chunk;
    }

    if (!chunk || !chunk.generated) return 0; // Air for unloaded or pending chunks

    const lx = ((x % 16) + 16) % 16;
    const ly = ((y % 16) + 16) % 16;
    const lz = ((z % 16) + 16) % 16;

    return chunk.getVoxel(lx, ly, lz);
  }

  public setVoxel(x: number, y: number, z: number, blockId: number, syncStorage = true, emitChangeEvent = syncStorage): void {
    blockId = this.checkConcreteHardening(x, y, z, blockId);
    const oldBlock = this.getVoxel(x, y, z);
    if (blockId === 7) {
      const neighbors = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
      ];
      for (const [dx, dy, dz] of neighbors) {
        if (this.getVoxel(x + dx, y + dy, z + dz) === 37) {
          blockId = 19;
          break;
        }
      }
    } else if (blockId === 37) {
      const neighbors = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
      ];
      for (const [dx, dy, dz] of neighbors) {
        if (this.getVoxel(x + dx, y + dy, z + dz) === 7) {
          blockId = 28;
          break;
        }
      }
    }

    if (blockId === 7) {
      const neighbors = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
      ];
      for (const [dx, dy, dz] of neighbors) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const targetId = this.getVoxel(nx, ny, nz);
        const name = BlockRegistry.get(targetId).name || "";
        if (name.endsWith(" Concrete Powder")) {
          const solidName = name.replace(" Concrete Powder", " Concrete");
          const solidId = getFeatureBlockId(solidName);
          if (solidId !== 0) {
            this.setVoxel(nx, ny, nz, solidId, true, emitChangeEvent);
          }
        }
      }
    }

    if (oldBlock === blockId) {
      return;
    }

    const cx = Math.floor(x / 16);
    const cy = Math.floor(y / 16);
    const cz = Math.floor(z / 16);

    const chunkKey = `${cx},${cy},${cz}`;
    const chunk = this.chunks.get(chunkKey);
    if (!chunk?.generated) return;

    const lx = ((x % 16) + 16) % 16;
    const ly = ((y % 16) + 16) % 16;
    const lz = ((z % 16) + 16) % 16;
    const localIndex = lx + (ly << 4) + (lz << 8);

    chunk.setVoxel(lx, ly, lz, blockId);

    // ── CRITICAL FIX ────────────────────────────────────────────────────
    // Save the DIFF of changes, not a snapshot of non-zero voxels.
    // This ensures broken blocks (set to 0) are persisted across reloads.
    if (syncStorage) {
      // Update in-memory diff for this chunk
      if (!this.chunkModifications.has(chunkKey)) {
        this.chunkModifications.set(chunkKey, {});
      }
      this.chunkModifications.get(chunkKey)![localIndex] = blockId;
      this.markChunkModificationDirty(chunkKey);
    }

    // Remesh this chunk
    this.requestChunkMesh(chunk);

    // If voxel is on a boundary, trigger neighbors to remesh
    if (lx === 0) this.remeshNeighbor(cx - 1, cy, cz);
    if (lx === 15) this.remeshNeighbor(cx + 1, cy, cz);
    if (ly === 0) this.remeshNeighbor(cx, cy - 1, cz);
    if (ly === 15) this.remeshNeighbor(cx, cy + 1, cz);
    if (lz === 0) this.remeshNeighbor(cx, cy, cz - 1);
    if (lz === 15) this.remeshNeighbor(cx, cy, cz + 1);

    // Evaluate local redstone circuit updates
    this.redstoneSystem.evaluateRedstone(x, y, z);

    // Evaluate local fluid flow updates
    this.liquidSystem.onBlockChanged(x, y, z, oldBlock, blockId);

    if (syncStorage && emitChangeEvent) {
      EventBus.emit('world:blockChanged', { x, y, z, blockId });
    }

    // Check furnace/smoker/blast furnace registration
    const isFurnaceType = (id: number) => {
      const name = BlockRegistry.get(id).name || "";
      return id === 24 || id === 25 || name.includes("Furnace") || name.includes("Smoker");
    };
    if (isFurnaceType(oldBlock) && !isFurnaceType(blockId)) {
      EventBus.emit('block:breakFurnace', { x, y, z });
    } else if (isFurnaceType(blockId) && !isFurnaceType(oldBlock)) {
      EventBus.emit('block:placeFurnace', { x, y, z });
    }
  }

  private remeshNeighbor(cx: number, cy: number, cz: number): void {
    const key = `${cx},${cy},${cz}`;
    const neighbor = this.chunks.get(key);
    if (neighbor) {
      this.requestChunkMesh(neighbor);
    }
  }

  private hasNearbyWater(x: number, y: number, z: number, radius: number): boolean {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (this.getVoxel(x + dx, y + dy, z + dz) === 7) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // WORKER PIPELINE
  private postToWorker(message: any): void {
    if (!this.useWorkers) {
      if (message.type === 'mesh') {
        // Remove duplicate mesh requests to ensure the latest neighbors data is used
        this.mainThreadQueue = this.mainThreadQueue.filter(
          msg => !(msg.type === 'mesh' && msg.payload.x === message.payload.x && msg.payload.y === message.payload.y && msg.payload.z === message.payload.z)
        );
        this.mainThreadQueue.unshift(message);
      } else {
        this.mainThreadQueue.push(message);
      }
      this.workerQueueLength = this.mainThreadQueue.length;
      return;
    }

    this.workerPool?.submit(message);
    this.syncWorkerQueueLength();
  }

  private handleMainThreadMessage(message: any): void {
    const { type, payload } = message;
    if (payload?.revision !== undefined && payload.revision !== this.worldRevision) {
      return;
    }

    if (type === 'generate') {
      const { x, y, z, dimension, revision } = payload;
      if (!this.chunks.has(`${x},${y},${z}`)) return;

      if (!this.mainThreadGenerator) {
        this.mainThreadGenerator = new BiomeGenerator(this.seed);
      }
      const voxels = this.mainThreadGenerator.generateChunkData(x, y, z, dimension);
      this.handleWorkerMessageMock('generated', { x, y, z, voxels, revision });
    }

    else if (type === 'mesh') {
      const { x, y, z, voxels18, revision } = payload;
      const key = `${x},${y},${z}`;
      if (!this.chunks.has(key)) {
        this.queuedMeshKeys.delete(key);
        return;
      }

      const opaqueMesh = Mesher.generateMesh(voxels18, false);
      const transparentMesh = Mesher.generateMesh(voxels18, 'transparent');
      const waterMesh = Mesher.generateMesh(voxels18, 'water');

      const foliageMesh = Mesher.generateFoliageMesh(voxels18);

      this.handleWorkerMessageMock('meshed', {
        x, y, z,
        opaque: opaqueMesh,
        transparent: transparentMesh,
        water: waterMesh,
        foliage: foliageMesh,
        revision
      });
    }
  }

  private processMainThreadQueue(): void {
    if (this.useWorkers || this.mainThreadQueue.length === 0) return;

    const start = performance.now();
    let processed = 0;

    while (
      this.mainThreadQueue.length > 0 &&
      processed < this.maxMainThreadTasksPerUpdate &&
      (processed === 0 || performance.now() - start < this.mainThreadTaskBudgetMs)
    ) {
      const message = this.mainThreadQueue.shift();
      this.handleMainThreadMessage(message);
      processed++;
    }

    this.workerQueueLength = this.mainThreadQueue.length;
  }

  private async handleWorkerMessageMock(type: string, payload: any): Promise<void> {
    if (payload?.revision !== undefined && payload.revision !== this.worldRevision) {
      return;
    }

    if (type === 'generated') {
      const { x, y, z, voxels } = payload;
      const key = `${x},${y},${z}`;
      const chunk = this.chunks.get(key);

      if (chunk) {
        chunk.voxels = voxels;
        chunk.generated = false;

        // Load saved diff from IndexedDB
        const savedMods = await StorageManager.loadChunkModifications(key);

        if (payload?.revision !== undefined && payload.revision !== this.worldRevision) return;
        if (this.chunks.get(key) === chunk && savedMods) {
          // Restore the in-memory modifications map
          this.chunkModifications.set(key, savedMods);

          // Apply ALL diff entries, including 0s (broken blocks)
          for (const [idxStr, blockId] of Object.entries(savedMods)) {
            chunk.voxels[parseInt(idxStr)] = blockId;
          }
        }

        if (this.chunks.get(key) !== chunk) return;
        chunk.generated = true;
        this.requestChunkMesh(chunk);

        if (this.currentDimension === 'overworld' && y === 0) {
          if (this.checkVillageChunk(x, z)) {
            setTimeout(() => {
              const spawnPos = this.findGroundSpawnNear(new THREE.Vector3(x * 16 + 8, 16, z * 16 + 8), 0, 4);
              if (spawnPos) {
                const em = (window as any).gameEntityManager;
                if (em) {
                  em.spawnMob(spawnPos, 'villager');
                  em.spawnMob(spawnPos.clone().add(new THREE.Vector3(1, 0, 1)), 'villager');
                }
              }
            }, 150);
          }
        }

        this.remeshNeighbor(x - 1, y, z);
        this.remeshNeighbor(x + 1, y, z);
        this.remeshNeighbor(x, y - 1, z);
        this.remeshNeighbor(x, y + 1, z);
        this.remeshNeighbor(x, y, z - 1);
        this.remeshNeighbor(x, y, z + 1);
      }
    }

    else if (type === 'meshed') {
      const { x, y, z, opaque, transparent, water, foliage } = payload;
      const key = `${x},${y},${z}`;
      const chunk = this.chunks.get(key);
      this.queuedMeshKeys.delete(key);

      if (chunk) {
        this.enqueueMeshUpload(chunk, opaque, transparent, water, foliage);
      }
    }
  }

  private async handleWorkerResponse(message: ChunkWorkerMessage): Promise<void> {
    const { type, payload } = message;

    const isStaleMessage = payload?.revision !== undefined && payload.revision !== this.worldRevision;

    if (!isStaleMessage && type === 'generated') {
      const { x, y, z, voxels } = payload;
      const key = `${x},${y},${z}`;
      const chunk = this.chunks.get(key);

      if (chunk) {
        chunk.voxels = voxels;
        chunk.generated = false;

        // Apply any saved block edits from IndexedDB
        const savedMods = await StorageManager.loadChunkModifications(key);

        if (payload?.revision !== undefined && payload.revision !== this.worldRevision) {
          return;
        }
        if (this.chunks.get(key) === chunk && savedMods) {
          // Restore in-memory diff map
          this.chunkModifications.set(key, savedMods);

          // Apply ALL diff entries including 0s (broken blocks)
          for (const [idxStr, blockId] of Object.entries(savedMods)) {
            chunk.voxels[parseInt(idxStr)] = blockId;
          }
        }

        if (this.chunks.get(key) === chunk) {
          chunk.generated = true;
          this.requestChunkMesh(chunk);

          if (this.currentDimension === 'overworld' && y === 0) {
            if (this.checkVillageChunk(x, z)) {
              setTimeout(() => {
                const spawnPos = this.findGroundSpawnNear(new THREE.Vector3(x * 16 + 8, 16, z * 16 + 8), 0, 4);
                if (spawnPos) {
                  const em = (window as any).gameEntityManager;
                  if (em) {
                    em.spawnMob(spawnPos, 'villager');
                    em.spawnMob(spawnPos.clone().add(new THREE.Vector3(1, 0, 1)), 'villager');
                  }
                }
              }, 150);
            }
          }

          // Also check if generating this chunk satisfies neighbors that were waiting to mesh
          this.remeshNeighbor(x - 1, y, z);
          this.remeshNeighbor(x + 1, y, z);
          this.remeshNeighbor(x, y - 1, z);
          this.remeshNeighbor(x, y + 1, z);
          this.remeshNeighbor(x, y, z - 1);
          this.remeshNeighbor(x, y, z + 1);
        }
      }
    }

    else if (!isStaleMessage && type === 'meshed') {
      const { x, y, z, opaque, transparent, water, foliage } = payload;
      const key = `${x},${y},${z}`;
      const chunk = this.chunks.get(key);
      this.queuedMeshKeys.delete(key);

      if (chunk) {
        this.enqueueMeshUpload(chunk, opaque, transparent, water, foliage);
      }
    }

  }

  private enqueueMeshUpload(chunk: Chunk, opaque: Float32Array, transparent: Float32Array, water: Float32Array, foliage: Float32Array): void {
    // Deduplicate: remove any existing queue entry for this chunk to save GPU memory/cycles
    for (let i = 0; i < this.meshUploadQueue.length; i++) {
      if (this.meshUploadQueue[i].chunk === chunk) {
        this.meshUploadQueue.splice(i, 1);
        break;
      }
    }
    this.meshUploadQueue.push({ chunk, opaque, transparent, water, foliage });
  }

  private checkVillageChunk(chunkX: number, chunkZ: number): boolean {
    if (!this.mainThreadGenerator) {
      this.mainThreadGenerator = new BiomeGenerator(this.seed);
    }
    return this.mainThreadGenerator.checkVillageChunk(chunkX, chunkZ);
  }

  public growTreeInWorld(x: number, y: number, z: number, saplingId: number): void {
    const saplingCfg = BlockRegistry.get(saplingId);
    const name = saplingCfg.name || "";
    
    let logId = 4; // Wood Log
    let leavesId = 5; // Leaves
    
    if (name.includes("Birch")) {
      logId = getFeatureBlockId("Birch Log") || 4;
      leavesId = getFeatureBlockId("Birch Leaves") || 5;
    } else if (name.includes("Pine")) {
      logId = getFeatureBlockId("Pine Log") || 4;
      leavesId = getFeatureBlockId("Pine Leaves") || 5;
    } else if (name.includes("Jungle")) {
      logId = getFeatureBlockId("Jungle Log") || 4;
      leavesId = getFeatureBlockId("Jungle Leaves") || 5;
    } else if (name.includes("Acacia")) {
      logId = getFeatureBlockId("Acacia Log") || 4;
      leavesId = getFeatureBlockId("Acacia Leaves") || 5;
    } else if (name.includes("Cherry")) {
      logId = getFeatureBlockId("Cherry Log") || 4;
      leavesId = getFeatureBlockId("Cherry Leaves") || 5;
    } else if (name.includes("Mangrove")) {
      logId = getFeatureBlockId("Mangrove Log") || 4;
      leavesId = getFeatureBlockId("Mangrove Leaves") || 5;
    } else if (name.includes("Palm")) {
      logId = getFeatureBlockId("Palm Log") || 4;
      leavesId = getFeatureBlockId("Palm Leaves") || 5;
    }

    // Clear sapling first
    this.setVoxel(x, y, z, 0, true);

    const h = 5 + Math.floor(Math.random() * 3);
    // Place trunk
    for (let i = 0; i < h; i++) {
      this.setVoxel(x, y + i, z, logId, true);
    }

    // Place leaves
    const leavesCenter = y + h - 1;
    const r = 2;
    for (let lx = -r; lx <= r; lx++) {
      for (let lz = -r; lz <= r; lz++) {
        for (let ly = -r; ly <= r; ly++) {
          const ax = x + lx;
          const ay = leavesCenter + ly;
          const az = z + lz;

          if (Math.abs(lx) + Math.abs(ly) + Math.abs(lz) <= 3) {
            const current = this.getVoxel(ax, ay, az);
            if (current === 0) {
              this.setVoxel(ax, ay, az, leavesId, true);
            }
          }
        }
      }
    }
  }

  public waxedBlocks: Set<string> = new Set();

  private checkConcreteHardening(x: number, y: number, z: number, id: number): number {
    const config = BlockRegistry.get(id);
    const name = config.name || "";
    if (name.endsWith(" Concrete Powder")) {
      const neighbors = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
      ];
      for (const [dx, dy, dz] of neighbors) {
        if (this.getVoxel(x + dx, y + dy, z + dz) === 7) { // Water
          const solidName = name.replace(" Concrete Powder", " Concrete");
          const solidId = getFeatureBlockId(solidName);
          if (solidId !== 0) return solidId;
        }
      }
    }
    return id;
  }

  public checkBlockGravity(gx: number, gy: number, gz: number): void {
    const blockId = this.getVoxel(gx, gy, gz);
    const name = BlockRegistry.get(blockId).name || "";
    const isGravityBlock = blockId === 6 || blockId === 16 || name.endsWith(" Concrete Powder");
    if (isGravityBlock) {
      let fallY = gy - 1;
      while (fallY >= 0) {
        const belowId = this.getVoxel(gx, fallY, gz);
        if (belowId === 0 || belowId === 7 || belowId === 37) {
          fallY--;
        } else {
          break;
        }
      }
      const targetY = fallY + 1;
      if (targetY < gy) {
        this.setVoxel(gx, gy, gz, 0, true);
        this.setVoxel(gx, targetY, gz, blockId, true);
      }
    }
  }

  public clear(): void {
    void this.flushChunkModifications();
    this.worldRevision++;
    for (const chunk of this.chunks.values()) {
      chunk.dispose();
    }
    this.chunks.clear();
    this.lastCachedChunkVal = null;
    this.chunkCache = [];
    this.lastUpdateChunkX = Infinity;
    this.lastUpdateChunkY = Infinity;
    this.lastUpdateChunkZ = Infinity;
    this.hasMoreChunksToLoad = true;
    this.chunkModifications.clear();
    this.dirtyChunkModificationKeys.clear();
    this.mainThreadQueue = [];
    this.queuedMeshKeys.clear();
    this.scheduledRemeshKeys.clear();
    if (this.remeshFlushTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.remeshFlushTimer);
      this.remeshFlushTimer = null;
    }
    this.meshUploadQueue = [];
    this.workerPool?.clearQueued();
    this.workerQueueLength = 0;
  }

  public async flushChunkModifications(): Promise<void> {
    this.clearModificationFlushTimer();
    const keys = Array.from(this.dirtyChunkModificationKeys);
    this.dirtyChunkModificationKeys.clear();

    await Promise.all(keys.map(key => this.flushChunkModification(key)));
  }

  private markChunkModificationDirty(chunkKey: string): void {
    this.dirtyChunkModificationKeys.add(chunkKey);
    if (this.modificationFlushTimer !== null || typeof window === 'undefined') return;

    this.modificationFlushTimer = window.setTimeout(() => {
      this.modificationFlushTimer = null;
      void this.flushChunkModifications();
    }, this.modificationFlushDelayMs);
  }

  private async flushChunkModification(chunkKey: string): Promise<void> {
    const modifications = this.chunkModifications.get(chunkKey);
    this.dirtyChunkModificationKeys.delete(chunkKey);
    if (!modifications) return;

    await StorageManager.saveChunkModifications(chunkKey, { ...modifications });
  }

  private clearModificationFlushTimer(): void {
    if (this.modificationFlushTimer === null || typeof window === 'undefined') return;
    window.clearTimeout(this.modificationFlushTimer);
    this.modificationFlushTimer = null;
  }

  private unloadChunk(key: string, chunk: Chunk): void {
    void this.flushChunkModification(key);
    this.chunkModifications.delete(key);
    chunk.dispose();
    this.chunks.delete(key);
    this.lastCachedChunkVal = null;
  }

  private terminateWorkers(): void {
    this.workerPool?.destroy();
    this.workerPool = null;
    this.mainThreadQueue = [];
    this.mainThreadGenerator = null;
    this.queuedMeshKeys.clear();
    this.scheduledRemeshKeys.clear();
    if (this.remeshFlushTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.remeshFlushTimer);
      this.remeshFlushTimer = null;
    }
    this.meshUploadQueue = [];
    this.workerQueueLength = 0;
  }

  private syncWorkerQueueLength(): void {
    if (!this.useWorkers || this.workerPool === null) return;
    const stats = this.workerPool.stats();
    this.workerQueueLength = stats.initializing + stats.active + stats.queued;
  }

  private fallbackFromWorkers(): void {
    this.useWorkers = false;
    this.workerPool?.destroy();
    this.workerPool = null;
    for (const chunk of this.chunks.values()) {
      if (!chunk.generated) {
        this.postToWorker({
          type: 'generate',
          payload: {
            x: chunk.x,
            y: chunk.y,
            z: chunk.z,
            dimension: this.currentDimension,
            revision: this.worldRevision,
          },
        });
      } else if (!chunk.meshesLoaded) {
        this.requestChunkMesh(chunk);
      }
    }
    this.workerQueueLength = this.mainThreadQueue.length;
  }
}
