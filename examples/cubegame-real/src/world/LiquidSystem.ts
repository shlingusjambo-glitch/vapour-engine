import { WorldManager } from './WorldManager';
import { BlockRegistry } from './BlockRegistry';
import { EventBus } from '../core/EventBus';
import { AudioManager } from '../audio/AudioManager';
import * as THREE from 'three';

const NEIGHBORS_3D = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1]
];

const FLOW_DIRECTIONS = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 }
];

export class LiquidSystem {
  private world: WorldManager;
  private activeBlocks: Map<string, { x: number; y: number; z: number; key: string }> = new Map();
  private nextActiveBlocks: Map<string, { x: number; y: number; z: number; key: string }> = new Map();
  
  // Reusable object pool for cell coordinates to avoid GC pressure
  private cellPool: Array<{ x: number; y: number; z: number; key: string }> = [];

  // Reusable pathfinding structures
  private pathQueue = new Int32Array(363); // 121 entries * 3 = 363
  private pathVisited = new Uint8Array(121);

  // Ticking counters to throttle liquid updates
  private waterTickTimer = 0;
  private lavaTickTimer = 0;

  // Constants for flow intervals
  private readonly WATER_TICK_RATE = 5; // Ticks once every 5 game ticks (~0.25s)
  private readonly LAVA_TICK_RATE = 20; // Ticks once every 20 game ticks (~1.0s)

  constructor(world: WorldManager) {
    this.world = world;
  }

  public isWaterBlock(id: number): boolean {
    return id === 7 || (id >= 2001 && id <= 2007);
  }

  public getWaterLevel(id: number): number {
    if (id === 7) return 8;
    if (id >= 2001 && id <= 2007) return 8 - (id - 2000); // 2001 -> 7, 2007 -> 1
    return 0;
  }

  public getWaterBlockIdForLevel(level: number): number {
    if (level === 8) return 7;
    if (level >= 1 && level <= 7) return 2000 + (8 - level); // level 7 -> 2001, level 1 -> 2007
    return 0;
  }

  public isLavaBlock(id: number): boolean {
    return id === 37 || (id >= 2011 && id <= 2013);
  }

  public getLavaLevel(id: number): number {
    if (id === 37) return 4;
    if (id >= 2011 && id <= 2013) return 4 - (id - 2010); // 2011 -> 3, 2013 -> 1
    return 0;
  }

  public getLavaBlockIdForLevel(level: number): number {
    if (level === 4) return 37;
    if (level >= 1 && level <= 3) return 2010 + (4 - level); // level 3 -> 2011, level 1 -> 2013
    return 0;
  }

  public isReplaceable(id: number): boolean {
    if (id === 0) return true;
    const cfg = BlockRegistry.get(id);
    return cfg.isFoliage || (!cfg.isSolid && !cfg.isWater && id !== 29); // do not replace portals
  }

  private acquireCell(x: number, y: number, z: number, key: string): { x: number; y: number; z: number; key: string } {
    let cell = this.cellPool.pop();
    if (cell) {
      cell.x = x;
      cell.y = y;
      cell.z = z;
      cell.key = key;
      return cell;
    }
    return { x, y, z, key };
  }

  /**
   * Called when a block in the world is placed or broken.
   */
  public onBlockChanged(x: number, y: number, z: number, oldBlock: number, newBlock: number): void {
    // Add the block itself and its 6 direct neighbors to the active set
    const key = `${x},${y},${z}`;
    if (!this.activeBlocks.has(key)) {
      this.activeBlocks.set(key, this.acquireCell(x, y, z, key));
    }

    for (const [dx, dy, dz] of NEIGHBORS_3D) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const nkey = `${nx},${ny},${nz}`;
      if (!this.activeBlocks.has(nkey)) {
        this.activeBlocks.set(nkey, this.acquireCell(nx, ny, nz, nkey));
      }
    }
  }

  /**
   * Main simulation tick
   */
  public tick(dt: number): void {
    if (this.activeBlocks.size === 0) return;

    this.waterTickTimer++;
    this.lavaTickTimer++;

    const runWater = this.waterTickTimer >= this.WATER_TICK_RATE;
    const runLava = this.lavaTickTimer >= this.LAVA_TICK_RATE;

    if (!runWater && !runLava) return;

    if (runWater) this.waterTickTimer = 0;
    if (runLava) this.lavaTickTimer = 0;

    // Clear buffer map for the next tick
    this.nextActiveBlocks.clear();

    const queueActive = (x: number, y: number, z: number) => {
      const key = `${x},${y},${z}`;
      if (!this.nextActiveBlocks.has(key)) {
        this.nextActiveBlocks.set(key, this.acquireCell(x, y, z, key));
      }
    };

    for (const cell of this.activeBlocks.values()) {
      const blockId = this.world.getVoxel(cell.x, cell.y, cell.z);
      const isWater = this.isWaterBlock(blockId);
      const isLava = this.isLavaBlock(blockId);

      // If this block is not fluid but got queued
      if (!isWater && !isLava) {
        // Check if there is any fluid neighboring this block that wants to flow into it.
        // If so, we queue the fluid neighbors to check them.
        let hasFluidNeighbor = false;
        for (const [dx, dy, dz] of NEIGHBORS_3D) {
          const nx = cell.x + dx;
          const ny = cell.y + dy;
          const nz = cell.z + dz;
          const nId = this.world.getVoxel(nx, ny, nz);
          if (this.isWaterBlock(nId) || this.isLavaBlock(nId)) {
            queueActive(nx, ny, nz);
            hasFluidNeighbor = true;
          }
        }
        continue;
      }

      // Check if we should skip processing this fluid type in this tick
      if (isWater && !runWater) {
        this.nextActiveBlocks.set(cell.key, cell);
        continue;
      }
      if (isLava && !runLava) {
        this.nextActiveBlocks.set(cell.key, cell);
        continue;
      }

      // Determine target level
      let targetLevel = 0;
      const isSource = blockId === 7 || blockId === 37;

      if (isSource) {
        targetLevel = isWater ? 8 : 4;
      } else {
        // Infinite water source check (2 or more horizontal water source blocks)
        if (isWater) {
          const belowId = this.world.getVoxel(cell.x, cell.y - 1, cell.z);
          const belowCfg = BlockRegistry.get(belowId);
          if (belowCfg.isSolid) {
            let sourceCount = 0;
            for (const d of FLOW_DIRECTIONS) {
              if (this.world.getVoxel(cell.x + d.dx, cell.y, cell.z + d.dz) === 7) {
                sourceCount++;
              }
            }
            if (sourceCount >= 2) {
              targetLevel = 8;
            }
          }
        }

        if (targetLevel === 0) {
          // Check above block
          const aboveId = this.world.getVoxel(cell.x, cell.y + 1, cell.z);
          if (isWater && this.isWaterBlock(aboveId)) {
            targetLevel = 7;
          } else if (isLava && this.isLavaBlock(aboveId)) {
            targetLevel = 3;
          } else {
            // Check horizontal neighbors
            let maxHoriz = 0;
            for (const d of FLOW_DIRECTIONS) {
              const nId = this.world.getVoxel(cell.x + d.dx, cell.y, cell.z + d.dz);
              const nLevel = isWater ? this.getWaterLevel(nId) : this.getLavaLevel(nId);
              if (nLevel > maxHoriz) {
                maxHoriz = nLevel;
              }
            }
            if (maxHoriz > 1) {
              targetLevel = maxHoriz - 1;
            } else {
              targetLevel = 0; // dry up
            }
          }
        }
      }

      const currentLevel = isWater ? this.getWaterLevel(blockId) : this.getLavaLevel(blockId);

      // If level is changing
      if (targetLevel !== currentLevel) {
        let newBlockId = 0;
        if (targetLevel > 0) {
          newBlockId = isWater ? this.getWaterBlockIdForLevel(targetLevel) : this.getLavaBlockIdForLevel(targetLevel);
        }

        // Perform fluid/fluid mixing reactions when setting block
        const resolvedBlock = this.mixFluids(cell.x, cell.y, cell.z, newBlockId);
        
        // Update the voxel in the world
        this.world.setVoxel(cell.x, cell.y, cell.z, resolvedBlock, true);

        // Queue neighbors for updates since we changed state
        for (const [dx, dy, dz] of NEIGHBORS_3D) {
          queueActive(cell.x + dx, cell.y + dy, cell.z + dz);
        }
        
        // Queue ourselves again to verify and propagate
        if (resolvedBlock !== 0) {
          this.nextActiveBlocks.set(cell.key, cell);
        }
        continue;
      }

      // If we are at a stable fluid state, check if we should spread further!
      if (currentLevel > 1) {
        // 1. Flow down if possible
        const belowX = cell.x;
        const belowY = cell.y - 1;
        const belowZ = cell.z;

        if (this.canFlowInto(belowX, belowY, belowZ, isLava)) {
          const targetNeighLevel = isWater ? 7 : 3;
          const targetNeighBlock = isWater ? this.getWaterBlockIdForLevel(targetNeighLevel) : this.getLavaBlockIdForLevel(targetNeighLevel);
          this.flowSpread(belowX, belowY, belowZ, targetNeighBlock, isLava);
          queueActive(belowX, belowY, belowZ);
        } else {
          // 2. Flow horizontally using pathfinding to nearest drop-off
          this.spreadHorizontalFlow(cell.x, cell.y, cell.z, currentLevel, isLava, isWater, queueActive);
        }
      }
    }

    // Recycle any cells that are in activeBlocks but NOT in nextActiveBlocks
    for (const [key, cell] of this.activeBlocks.entries()) {
      if (!this.nextActiveBlocks.has(key)) {
        if (this.cellPool.length < 5000) {
          this.cellPool.push(cell);
        }
      }
    }

    // Swap the buffers
    const temp = this.activeBlocks;
    this.activeBlocks = this.nextActiveBlocks;
    this.nextActiveBlocks = temp;
  }

  private spreadHorizontalFlow(x: number, y: number, z: number, currentLevel: number, isLava: boolean, isWater: boolean, queueActive: (nx: number, ny: number, nz: number) => void): void {
    let validCount = 0;
    const validDirsIndices = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
      const d = FLOW_DIRECTIONS[i];
      if (this.canFlowInto(x + d.dx, y, z + d.dz, isLava)) {
        validDirsIndices[validCount++] = i;
      }
    }

    if (validCount === 0) return;

    const distances = [0, 0, 0, 0];
    let minDist = Infinity;

    for (let idx = 0; idx < validCount; idx++) {
      const dirIndex = validDirsIndices[idx];
      const d = FLOW_DIRECTIONS[dirIndex];
      const startX = x + d.dx;
      const startZ = z + d.dz;

      let dist = Infinity;
      if (this.isDropOff(startX, y, startZ, isLava)) {
        dist = 0;
      } else {
        let head = 0;
        let tail = 0;

        this.pathQueue[tail * 3] = startX;
        this.pathQueue[tail * 3 + 1] = startZ;
        this.pathQueue[tail * 3 + 2] = 0;
        tail++;

        this.pathVisited.fill(0);
        const startOx = startX - x + 5;
        const startOz = startZ - z + 5;
        this.pathVisited[startOx + startOz * 11] = 1;

        let distanceFound = Infinity;
        while (head < tail) {
          const currX = this.pathQueue[head * 3];
          const currZ = this.pathQueue[head * 3 + 1];
          const currDist = this.pathQueue[head * 3 + 2];
          head++;

          if (currDist >= 5) continue;

          for (let i = 0; i < 4; i++) {
            const fd = FLOW_DIRECTIONS[i];
            const nx = currX + fd.dx;
            const nz = currZ + fd.dz;
            const ox = nx - x + 5;
            const oz = nz - z + 5;

            if (ox < 0 || ox > 10 || oz < 0 || oz > 10) continue;
            const index = ox + oz * 11;
            if (this.pathVisited[index] !== 0) continue;

            if (this.canFlowInto(nx, y, nz, isLava)) {
              if (this.isDropOff(nx, y, nz, isLava)) {
                distanceFound = currDist + 1;
                break;
              }
              this.pathVisited[index] = 1;
              this.pathQueue[tail * 3] = nx;
              this.pathQueue[tail * 3 + 1] = nz;
              this.pathQueue[tail * 3 + 2] = currDist + 1;
              tail++;
            }
          }
          if (distanceFound !== Infinity) break;
        }
        dist = distanceFound;
      }

      distances[idx] = dist;
      if (dist < minDist) minDist = dist;
    }

    const targetNeighLevel = currentLevel - 1;
    const targetNeighBlock = isWater ? this.getWaterBlockIdForLevel(targetNeighLevel) : this.getLavaBlockIdForLevel(targetNeighLevel);

    for (let idx = 0; idx < validCount; idx++) {
      const dist = distances[idx];
      if (minDist === Infinity || dist === minDist) {
        const dirIndex = validDirsIndices[idx];
        const d = FLOW_DIRECTIONS[dirIndex];
        const nx = x + d.dx;
        const nz = z + d.dz;
        this.flowSpread(nx, y, nz, targetNeighBlock, isLava);
        queueActive(nx, y, nz);
      }
    }
  }

  private flowSpread(x: number, y: number, z: number, targetBlock: number, isLava: boolean): void {
    const currentId = this.world.getVoxel(x, y, z);
    
    // Check if we are washing away foliage, redstone, or crop
    if (this.isReplaceable(currentId) && !this.isWaterBlock(currentId) && !this.isLavaBlock(currentId)) {
      const drops = BlockRegistry.get(currentId).drops;
      if (drops !== null && drops !== undefined) {
        const dropId = Array.isArray(drops) ? drops[0] : drops;
        EventBus.emit('item:spawn', new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), dropId);
      }
    }

    // Mix and resolve
    const resolvedBlock = this.mixFluids(x, y, z, targetBlock);
    
    // If the target block represents a higher flow level than neighbor currently has, update it
    const isWater = this.isWaterBlock(resolvedBlock);
    const isL = this.isLavaBlock(resolvedBlock);
    
    if (isWater || isL) {
      const currentLevel = isWater ? this.getWaterLevel(currentId) : this.getLavaLevel(currentId);
      const incomingLevel = isWater ? this.getWaterLevel(resolvedBlock) : this.getLavaLevel(resolvedBlock);
      if (incomingLevel > currentLevel) {
        this.world.setVoxel(x, y, z, resolvedBlock, true);
      }
    } else {
      // It resolved to a solid block (mixing reaction) or air
      this.world.setVoxel(x, y, z, resolvedBlock, true);
    }
  }

  /**
   * Resolves water-lava interactions.
   * Returns the block ID that should result from mixing.
   */
  private mixFluids(x: number, y: number, z: number, targetBlock: number): number {
    const isTargetWater = this.isWaterBlock(targetBlock);
    const isTargetLava = this.isLavaBlock(targetBlock);
    
    if (!isTargetWater && !isTargetLava) return targetBlock;

    const currentBlock = this.world.getVoxel(x, y, z);

    if (isTargetWater) {
      if (this.isLavaBlock(currentBlock)) {
        AudioManager.playSizzle();
        if (currentBlock === 37) {
          return 28; // Water meeting Lava Source -> Obsidian
        } else {
          return 19; // Water meeting Flowing Lava -> Mossy Cobblestone
        }
      }
    } else if (isTargetLava) {
      if (this.isWaterBlock(currentBlock)) {
        AudioManager.playSizzle();
        if (currentBlock === 7) {
          return 28; // Lava meeting Water Source -> Obsidian
        } else {
          return 3; // Lava meeting Flowing Water -> Stone
        }
      }
    }

    return targetBlock;
  }

  private isDropOff(x: number, y: number, z: number, isLava: boolean): boolean {
    return this.canFlowInto(x, y - 1, z, isLava);
  }

  private canFlowInto(x: number, y: number, z: number, isLava: boolean): boolean {
    if (y < 0) return false;
    const blockId = this.world.getVoxel(x, y, z);
    
    if (blockId === 0) return true;

    if (isLava) {
      if (this.isLavaBlock(blockId)) {
        return true;
      }
      if (this.isWaterBlock(blockId)) return true;
    } else {
      if (this.isWaterBlock(blockId)) {
        return true;
      }
      if (this.isLavaBlock(blockId)) return true;
    }

    const cfg = BlockRegistry.get(blockId);
    if (cfg.isFoliage) return true;
    if (!cfg.isSolid && !cfg.isWater && blockId !== 29) return true;

    return false;
  }
}
