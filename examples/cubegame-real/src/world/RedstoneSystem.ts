import { WorldManager } from './WorldManager';
import { BlockRegistry } from './BlockRegistry';
import { StorageManager } from '../storage/StorageManager';
import { AudioManager } from '../audio/AudioManager';
import { EventBus } from '../core/EventBus';
import { ItemStack } from '../inventory/Inventory';
import { getFeatureBlockId } from '../content/FeatureCatalog';
import * as THREE from 'three';

interface BlockMetadata {
  facing: { x: number; y: number; z: number }; // facing vector
  delay?: number;                              // repeater delay (1-4 ticks)
  mode?: 'compare' | 'subtract';               // comparator mode
  power?: number;                              // comparator or wire active output power
  locked?: boolean;                            // repeater locked state
  toggled?: boolean;                           // button or lever toggled state
  pressTimer?: number;                         // button remaining tick timer
  items?: Array<ItemStack | null>;             // hopper inventory slots (5)
  lastTransferTime?: number;                   // hopper transfer cooldown counter
  fuse?: number;                               // TNT remaining fuse seconds
}

interface QueuedAction {
  x: number;
  y: number;
  z: number;
  type: 'repeater_on' | 'repeater_off' | 'observer_off' | 'button_off' | 'piston_extend' | 'piston_retract';
  ticksRemaining: number;
}

export class RedstoneSystem {
  private world: WorldManager;
  
  // Cache of chest contents loaded asynchronously
  private chestCache: Map<string, Array<ItemStack | null>> = new Map();
  
  // Map of coordinate keys "x,y,z" to active power levels (0 to 15) for wire shading
  private powerMap: Map<string, number> = new Map();
  
  // Persistent block metadata Map (loaded/saved to StorageManager)
  private metadataMap: Map<string, BlockMetadata> = new Map();
  
  // Ticked actions queue
  private actionsQueue: QueuedAction[] = [];
  
  // 2-game-tick counter to throttle redstone updates (1 redstone tick = 2 game ticks = 0.1s)
  private tickCounter = 0;

  // Block IDs fetched dynamically
  private repeaterOffId = 0;
  private repeaterOnId = 0;
  private comparatorOffId = 0;
  private comparatorOnId = 0;
  private pistonId = 0;
  private stickyPistonId = 0;
  private pistonHeadId = 0;
  private observerId = 0;
  private hopperId = 0;
  private daylightDetectorId = 0;
  private daylightDetectorInvertedId = 0;
  private targetBlockId = 0;
  private ironDoorId = 0;
  private ironTrapdoorId = 0;
  private tntId = 0;
  private redstoneBlockId = 0;
  private noteBlockId = 0;

  constructor(world: WorldManager) {
    this.world = world;
    
    // Load metadata asynchronously on startup
    StorageManager.getWorldData<[string, any][]>('redstone_metadata', []).then(saved => {
      if (saved && Array.isArray(saved)) {
        this.metadataMap = new Map(saved);
      }
    });

    // Resolve IDs
    this.repeaterOffId = getFeatureBlockId('Redstone Repeater (Off)');
    this.repeaterOnId = getFeatureBlockId('Redstone Repeater (On)');
    this.comparatorOffId = getFeatureBlockId('Redstone Comparator (Off)');
    this.comparatorOnId = getFeatureBlockId('Redstone Comparator (On)');
    this.pistonId = getFeatureBlockId('Piston');
    this.stickyPistonId = getFeatureBlockId('Sticky Piston');
    this.pistonHeadId = getFeatureBlockId('Piston Head');
    this.observerId = getFeatureBlockId('Observer');
    this.hopperId = getFeatureBlockId('Hopper');
    this.daylightDetectorId = getFeatureBlockId('Daylight Detector');
    this.daylightDetectorInvertedId = getFeatureBlockId('Daylight Detector (Inverted)');
    this.targetBlockId = getFeatureBlockId('Target Block');
    this.ironDoorId = getFeatureBlockId('Iron Door');
    this.ironTrapdoorId = getFeatureBlockId('Iron Trapdoor');
    this.tntId = getFeatureBlockId('TNT');
    this.redstoneBlockId = getFeatureBlockId('Redstone Block');
    this.noteBlockId = getFeatureBlockId('Note Block');
  }

  private saveMetadata(): void {
    StorageManager.setWorldData('redstone_metadata', Array.from(this.metadataMap.entries()));
  }

  /**
   * Called dynamically when a block is placed or updated to run redstone checks
   */
  public evaluateRedstone(startX: number, startY: number, startZ: number): void {
    // Determine if we need to initialize metadata
    const startBlock = this.world.getVoxel(startX, startY, startZ);
    const key = `${startX},${startY},${startZ}`;
    
    if (this.isRedstoneComponent(startBlock) && !this.metadataMap.has(key)) {
      this.initDefaultMetadata(startX, startY, startZ, startBlock);
    } else if (startBlock === 0) {
      // Clean up metadata if a block was broken
      if (this.metadataMap.has(key)) {
        const meta = this.metadataMap.get(key);
        this.metadataMap.delete(key);
        this.saveMetadata();
        
        // Handle Piston head retraction if Piston block is broken
        if (meta && (startBlock === 0)) {
          const facing = meta.facing;
          if (facing) {
            const headX = startX + facing.x;
            const headY = startY + facing.y;
            const headZ = startZ + facing.z;
            if (this.world.getVoxel(headX, headY, headZ) === this.pistonHeadId) {
              this.world.setVoxel(headX, headY, headZ, 0, true);
            }
          }
        }
      }
    }

    // Trigger Observer updates for surrounding blocks
    this.checkObserverUpdate(startX, startY, startZ);

    // Run BFS propagation loop
    const queue: Array<{ x: number; y: number; z: number; power: number }> = [];
    const visited = new Set<string>();

    const scanRadius = 8;
    const startCx = Math.floor((startX - scanRadius) / 16);
    const startCy = Math.floor((startY - scanRadius) / 16);
    const startCz = Math.floor((startZ - scanRadius) / 16);

    const chunkGrid = new Array<any>(27);
    for (let dx = 0; dx < 3; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        for (let dz = 0; dz < 3; dz++) {
          const cx = startCx + dx;
          const cy = startCy + dy;
          const cz = startCz + dz;
          const chunk = this.world.chunks.get(`${cx},${cy},${cz}`);
          chunkGrid[dx + dy * 3 + dz * 9] = (chunk && chunk.generated) ? chunk : null;
        }
      }
    }

    const getCachedVoxel = (x: number, y: number, z: number): number => {
      const cx = Math.floor(x / 16);
      const cy = Math.floor(y / 16);
      const cz = Math.floor(z / 16);

      const dx = cx - startCx;
      const dy = cy - startCy;
      const dz = cz - startCz;

      if (dx < 0 || dx > 2 || dy < 0 || dy > 2 || dz < 0 || dz > 2) {
        return this.world.getVoxel(x, y, z);
      }

      const chunk = chunkGrid[dx + dy * 3 + dz * 9];
      if (!chunk) return 0;

      const lx = ((x % 16) + 16) % 16;
      const ly = ((y % 16) + 16) % 16;
      const lz = ((z % 16) + 16) % 16;

      return chunk.voxels[lx + (ly << 4) + (lz << 8)];
    };

    for (let dy = -scanRadius; dy <= scanRadius; dy++) {
      for (let dz = -scanRadius; dz <= scanRadius; dz++) {
        for (let dx = -scanRadius; dx <= scanRadius; dx++) {
          const px = startX + dx;
          const py = startY + dy;
          const pz = startZ + dz;
          
          const bid = getCachedVoxel(px, py, pz);
          const pKey = `${px},${py},${pz}`;
          
          let sourcePower = 0;
          if (bid === 31) { // Redstone Torch
            sourcePower = 15;
          } else if (bid === this.redstoneBlockId) {
            sourcePower = 15;
          } else if (bid === getFeatureBlockId('Lever')) {
            const meta = this.metadataMap.get(pKey);
            if (meta && meta.toggled) sourcePower = 15;
          } else if (bid === getFeatureBlockId('Button')) {
            const meta = this.metadataMap.get(pKey);
            if (meta && meta.toggled) sourcePower = 15;
          } else if (bid === getFeatureBlockId('Pressure Plate')) {
            const meta = this.metadataMap.get(pKey);
            if (meta && meta.toggled) sourcePower = 15;
          } else if (bid === this.repeaterOnId) {
            sourcePower = 15;
          } else if (bid === this.comparatorOnId) {
            const meta = this.metadataMap.get(pKey);
            sourcePower = meta?.power || 15;
          } else if (bid === this.daylightDetectorId) {
            sourcePower = this.getDaylightPower(false);
          } else if (bid === this.daylightDetectorInvertedId) {
            sourcePower = this.getDaylightPower(true);
          } else if (bid === this.targetBlockId) {
            const meta = this.metadataMap.get(pKey);
            sourcePower = meta?.power || 0;
          }

          if (sourcePower > 0) {
            queue.push({ x: px, y: py, z: pz, power: sourcePower });
            visited.add(pKey);
          }
        }
      }
    }

    const newPowers = new Map<string, number>();

    // BFS power propagation
    while (queue.length > 0) {
      const current = queue.shift()!;
      const key = `${current.x},${current.y},${current.z}`;
      newPowers.set(key, current.power);

      if (current.power <= 1) continue;

      const neighbors = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
      ];

      for (const [dx, dy, dz] of neighbors) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const nz = current.z + dz;
        const nkey = `${nx},${ny},${nz}`;
        const nBlockId = getCachedVoxel(nx, ny, nz);

        // Signal only propagates through Redstone Wire
        if (nBlockId === 30 && !visited.has(nkey)) {
          const nextPower = current.power - 1;
          visited.add(nkey);
          queue.push({ x: nx, y: ny, z: nz, power: nextPower });
        }
      }
    }

    // Save active power mappings for wire color shading
    this.powerMap = newPowers;

    // Reactively trigger active redstone components inside the zone
    for (let dy = -scanRadius; dy <= scanRadius; dy++) {
      for (let dz = -scanRadius; dz <= scanRadius; dz++) {
        for (let dx = -scanRadius; dx <= scanRadius; dx++) {
          const px = startX + dx;
          const py = startY + dy;
          const pz = startZ + dz;
          
          const bid = getCachedVoxel(px, py, pz);
          const pKey = `${px},${py},${pz}`;
          const isPowered = this.checkIfAdjacentPowered(px, py, pz, newPowers, getCachedVoxel);

          if (bid === 32 || bid === 36) { // Lamps
            if (isPowered && bid === 32) {
              this.world.setVoxel(px, py, pz, 36, false); // Turn Lamp On
            } else if (!isPowered && bid === 36) {
              this.world.setVoxel(px, py, pz, 32, false); // Turn Lamp Off
            }
          } else if (bid === this.repeaterOffId || bid === this.repeaterOnId) {
            this.evaluateRepeater(px, py, pz, isPowered);
          } else if (bid === this.comparatorOffId || bid === this.comparatorOnId) {
            this.evaluateComparator(px, py, pz, newPowers);
          } else if (bid === this.pistonId || bid === this.stickyPistonId) {
            this.evaluatePiston(px, py, pz, isPowered);
          } else if (bid === this.noteBlockId) {
            if (isPowered) {
              const meta = this.metadataMap.get(pKey);
              const pitch = meta?.power ?? 12; // default middle pitch
              if (meta && !meta.toggled) { // trigger once per power cycle
                meta.toggled = true;
                this.playNoteBlockSound(px, py, pz, pitch);
              }
            } else {
              const meta = this.metadataMap.get(pKey);
              if (meta) meta.toggled = false;
            }
          } else if (bid === this.tntId && isPowered) {
            this.igniteTNT(px, py, pz);
          } else if (bid === this.ironDoorId || bid === getFeatureBlockId('Door')) {
            // Door toggles state based on power
            const meta = this.metadataMap.get(pKey);
            if (meta) {
              if (isPowered && !meta.toggled) {
                meta.toggled = true;
                AudioManager.playStep('wood');
              } else if (!isPowered && meta.toggled) {
                meta.toggled = false;
                AudioManager.playStep('wood');
              }
            }
          } else if (bid === this.ironTrapdoorId || bid === getFeatureBlockId('Trapdoor')) {
            const meta = this.metadataMap.get(pKey);
            if (meta) {
              if (isPowered && !meta.toggled) {
                meta.toggled = true;
                AudioManager.playStep('wood');
              } else if (!isPowered && meta.toggled) {
                meta.toggled = false;
                AudioManager.playStep('wood');
              }
            }
          }
        }
      }
    }
  }

  private initDefaultMetadata(x: number, y: number, z: number, blockId: number): void {
    const key = `${x},${y},${z}`;
    
    // Compute placement facing direction based on player looking vector
    const pc = (window as any).gamePlayerController;
    const cameraDir = new THREE.Vector3();
    (window as any).gameCameraController?.getDirection?.(cameraDir);
    
    let facing = { x: 0, y: 0, z: -1 }; // Default North
    let normal = pc?.targetBlock?.normal;

    if (blockId === this.hopperId && normal) {
      // Hoppers attach to clicked block face
      if (normal.y !== 0) {
        facing = { x: 0, y: -1, z: 0 }; // faces down
      } else {
        facing = { x: -normal.x, y: 0, z: -normal.z }; // faces into attached block
      }
    } else if (blockId === this.pistonId || blockId === this.stickyPistonId || blockId === this.observerId) {
      // Piston and observer can face up/down
      if (Math.abs(cameraDir.y) > Math.max(Math.abs(cameraDir.x), Math.abs(cameraDir.z))) {
        facing = { x: 0, y: cameraDir.y > 0 ? 1 : -1, z: 0 };
      } else if (Math.abs(cameraDir.x) > Math.abs(cameraDir.z)) {
        facing = { x: cameraDir.x > 0 ? 1 : -1, y: 0, z: 0 };
      } else {
        facing = { x: 0, y: 0, z: cameraDir.z > 0 ? 1 : -1 };
      }
    } else {
      // Repeaters, comparators, doors face away from the player horizontally
      if (Math.abs(cameraDir.x) > Math.abs(cameraDir.z)) {
        facing = { x: cameraDir.x > 0 ? 1 : -1, y: 0, z: 0 };
      } else {
        facing = { x: 0, y: 0, z: cameraDir.z > 0 ? 1 : -1 };
      }
    }

    const state: BlockMetadata = { facing };

    if (blockId === this.repeaterOffId || blockId === this.repeaterOnId) {
      state.delay = 1;
      state.locked = false;
    } else if (blockId === this.comparatorOffId || blockId === this.comparatorOnId) {
      state.mode = 'compare';
      state.power = 0;
    } else if (blockId === this.hopperId) {
      state.items = new Array(5).fill(null);
      state.lastTransferTime = 0;
    } else if (blockId === this.noteBlockId) {
      state.power = 12; // Middle G pitch
      state.toggled = false;
    } else if (blockId === getFeatureBlockId('Button') || blockId === getFeatureBlockId('Lever') || blockId === getFeatureBlockId('Pressure Plate')) {
      state.toggled = false;
    }

    this.metadataMap.set(key, state);
    this.saveMetadata();
  }

  private isRedstoneComponent(blockId: number): boolean {
    return (
      blockId === this.repeaterOffId ||
      blockId === this.repeaterOnId ||
      blockId === this.comparatorOffId ||
      blockId === this.comparatorOnId ||
      blockId === this.pistonId ||
      blockId === this.stickyPistonId ||
      blockId === this.observerId ||
      blockId === this.hopperId ||
      blockId === this.daylightDetectorId ||
      blockId === this.daylightDetectorInvertedId ||
      blockId === this.targetBlockId ||
      blockId === this.ironDoorId ||
      blockId === this.ironTrapdoorId ||
      blockId === this.noteBlockId ||
      blockId === getFeatureBlockId('Lever') ||
      blockId === getFeatureBlockId('Button') ||
      blockId === getFeatureBlockId('Pressure Plate')
    );
  }

  public onInteract(x: number, y: number, z: number): boolean {
    const blockId = this.world.getVoxel(x, y, z);
    const key = `${x},${y},${z}`;
    const meta = this.metadataMap.get(key);
    if (!meta) return false;

    if (blockId === this.repeaterOffId || blockId === this.repeaterOnId) {
      // Toggle Repeater delay (1 -> 2 -> 3 -> 4 -> 1 redstone ticks)
      meta.delay = ((meta.delay ?? 1) % 4) + 1;
      AudioManager.playPlace('wood');
      EventBus.emit('network:chat', `[System] Repeater delay set to ${meta.delay} ticks.`);
      this.saveMetadata();
      return true;
    }

    if (blockId === this.comparatorOffId || blockId === this.comparatorOnId) {
      // Toggle Comparator mode
      meta.mode = meta.mode === 'compare' ? 'subtract' : 'compare';
      AudioManager.playPlace('wood');
      EventBus.emit('network:chat', `[System] Comparator mode set to ${meta.mode.toUpperCase()}.`);
      this.saveMetadata();
      this.evaluateRedstone(x, y, z);
      return true;
    }

    if (blockId === getFeatureBlockId('Lever')) {
      // Toggle Lever state
      meta.toggled = !meta.toggled;
      AudioManager.playPlace('wood');
      EventBus.emit('network:chat', `[System] Lever toggled ${meta.toggled ? 'ON' : 'OFF'}.`);
      this.saveMetadata();
      this.evaluateRedstone(x, y, z);
      return true;
    }

    if (blockId === getFeatureBlockId('Button')) {
      // Activate Button
      if (!meta.toggled) {
        meta.toggled = true;
        AudioManager.playPlace('wood');
        this.saveMetadata();
        this.evaluateRedstone(x, y, z);
        
        // Schedule turning off button
        // Wood button: 30 game ticks (1.5s), Stone: 20 game ticks (1s)
        const delay = 20; // 1 second default
        this.actionsQueue.push({ x, y, z, type: 'button_off', ticksRemaining: delay });
      }
      return true;
    }

    if (blockId === this.noteBlockId) {
      // Pitch sweeps up on right-click (0 to 24 semitones)
      meta.power = ((meta.power ?? 12) + 1) % 25;
      this.playNoteBlockSound(x, y, z, meta.power);
      this.saveMetadata();
      return true;
    }

    if (blockId === this.hopperId) {
      // Open hopper container UI if needed, otherwise just print details
      EventBus.emit('network:chat', `[System] Hopper: ${this.countHopperItems(meta.items)} items inside.`);
      return true;
    }

    return false;
  }

  private countHopperItems(items?: Array<ItemStack | null>): number {
    if (!items) return 0;
    return items.reduce((sum, item) => sum + (item ? item.count : 0), 0);
  }

  /**
   * Evaluates if a repeater should turn on or off based on inputs
   */
  private evaluateRepeater(x: number, y: number, z: number, isPowered: boolean): void {
    const key = `${x},${y},${z}`;
    const meta = this.metadataMap.get(key);
    if (!meta) return;

    const blockId = this.world.getVoxel(x, y, z);
    const isCurrentlyOn = blockId === this.repeaterOnId;

    // Check Repeater locking from sides
    const leftDir = { x: -meta.facing.z, y: 0, z: meta.facing.x };
    const rightDir = { x: meta.facing.z, y: 0, z: -meta.facing.x };
    const side1Power = this.getPowerInputFromDirection(x, y, z, leftDir);
    const side2Power = this.getPowerInputFromDirection(x, y, z, rightDir);
    const isLocked = side1Power > 0 || side2Power > 0;

    meta.locked = isLocked;

    if (isLocked) {
      // Ignore inputs while locked
      return;
    }

    const delay = meta.delay ?? 1;
    // 1 redstone tick = 2 game ticks
    const gameTicksDelay = delay * 2;

    if (isPowered && !isCurrentlyOn) {
      // Schedule turn-on action
      if (!this.isActionQueued(x, y, z, 'repeater_on')) {
        this.actionsQueue.push({ x, y, z, type: 'repeater_on', ticksRemaining: gameTicksDelay });
      }
    } else if (!isPowered && isCurrentlyOn) {
      // Schedule turn-off action
      if (!this.isActionQueued(x, y, z, 'repeater_off')) {
        this.actionsQueue.push({ x, y, z, type: 'repeater_off', ticksRemaining: gameTicksDelay });
      }
    }
  }

  private isActionQueued(x: number, y: number, z: number, type: string): boolean {
    return this.actionsQueue.some(act => act.x === x && act.y === y && act.z === z && act.type === type);
  }

  /**
   * Evaluates if a comparator should output power
   */
  private evaluateComparator(x: number, y: number, z: number, powers: Map<string, number>): void {
    const key = `${x},${y},${z}`;
    const meta = this.metadataMap.get(key);
    if (!meta) return;

    const blockId = this.world.getVoxel(x, y, z);
    const facing = meta.facing;

    // Source signal from behind
    const backPos = { x: x - facing.x, y: y - facing.y, z: z - facing.z };
    let sourcePower = powers.get(`${backPos.x},${backPos.y},${backPos.z}`) || 0;
    
    // Check if back block is a container
    const backBlock = this.world.getVoxel(backPos.x, backPos.y, backPos.z);
    if (backBlock === 23 || backBlock === 24 || backBlock === 25 || backBlock === this.hopperId) {
      sourcePower = this.calculateContainerPower(backPos.x, backPos.y, backPos.z);
    }

    // Side signals
    const leftDir = { x: -facing.z, y: 0, z: facing.x };
    const rightDir = { x: facing.z, y: 0, z: -facing.x };
    const side1Power = this.getPowerInputFromDirection(x, y, z, leftDir);
    const side2Power = this.getPowerInputFromDirection(x, y, z, rightDir);
    const maxSidePower = Math.max(side1Power, side2Power);

    let outputPower = 0;
    if (meta.mode === 'subtract') {
      outputPower = Math.max(0, sourcePower - maxSidePower);
    } else {
      // Compare mode
      outputPower = sourcePower >= maxSidePower ? sourcePower : 0;
    }

    const isCurrentlyOn = blockId === this.comparatorOnId;
    meta.power = outputPower;

    if (outputPower > 0 && !isCurrentlyOn) {
      this.world.setVoxel(x, y, z, this.comparatorOnId, false);
      this.evaluateRedstone(x, y, z);
    } else if (outputPower === 0 && isCurrentlyOn) {
      this.world.setVoxel(x, y, z, this.comparatorOffId, false);
      this.evaluateRedstone(x, y, z);
    }
  }

  /**
   * Evaluates Piston extend/retract
   */
  private evaluatePiston(x: number, y: number, z: number, isPowered: boolean): void {
    const key = `${x},${y},${z}`;
    const meta = this.metadataMap.get(key);
    if (!meta) return;

    const blockId = this.world.getVoxel(x, y, z);
    const isSticky = blockId === this.stickyPistonId;
    const facing = meta.facing;

    const headPos = { x: x + facing.x, y: y + facing.y, z: z + facing.z };
    const headBlock = this.world.getVoxel(headPos.x, headPos.y, headPos.z);
    const isExtended = headBlock === this.pistonHeadId;

    if (isPowered && !isExtended) {
      if (!this.isActionQueued(x, y, z, 'piston_extend')) {
        this.actionsQueue.push({ x, y, z, type: 'piston_extend', ticksRemaining: 1 });
      }
    } else if (!isPowered && isExtended) {
      if (!this.isActionQueued(x, y, z, 'piston_retract')) {
        this.actionsQueue.push({ x, y, z, type: 'piston_retract', ticksRemaining: 1 });
      }
    }
  }

  private tryPistonPush(x: number, y: number, z: number, facing: { x: number; y: number; z: number }): boolean {
    const blockList: Array<{ x: number; y: number; z: number; id: number }> = [];
    
    let foundAir = false;
    // Scan up to 12 blocks
    for (let i = 1; i <= 12; i++) {
      const bx = x + facing.x * i;
      const by = y + facing.y * i;
      const bz = z + facing.z * i;

      const bid = this.world.getVoxel(bx, by, bz);
      if (bid === 0) {
        foundAir = true;
        break; // found air, can push!
      }

      // Check unmovable blocks (obsidian, bedrock, chests, furnaces, hoppers, and other containers)
      const cfg = BlockRegistry.get(bid);
      const name = cfg.name || "";
      const isUnmovable = bid === 28 || bid === 35 ||
        /Chest|Furnace|Hopper|Barrel|Shulker Box|Brewing Stand|Anvil|Enchanting Table|Smithing Table/.test(name);

      if (isUnmovable) {
        return false; // unmovable block blocking the line
      }

      blockList.push({ x: bx, y: by, z: bz, id: bid });
    }

    if (!foundAir) {
      return false; // no air found to push into (piston push limit exceeded or blocked)
    }

    // Shift blocks starting from the farthest end
    for (let i = blockList.length - 1; i >= 0; i--) {
      const b = blockList[i];
      const nextX = b.x + facing.x;
      const nextY = b.y + facing.y;
      const nextZ = b.z + facing.z;

      this.world.setVoxel(nextX, nextY, nextZ, b.id, true);
      
      // Preserve block metadata if any
      const oldMetaKey = `${b.x},${b.y},${b.z}`;
      const newMetaKey = `${nextX},${nextY},${nextZ}`;
      if (this.metadataMap.has(oldMetaKey)) {
        this.metadataMap.set(newMetaKey, this.metadataMap.get(oldMetaKey)!);
        this.metadataMap.delete(oldMetaKey);
      }
    }

    // Place Piston Head
    const headX = x + facing.x;
    const headY = y + facing.y;
    const headZ = z + facing.z;
    this.world.setVoxel(headX, headY, headZ, this.pistonHeadId, true);
    AudioManager.playPlace('stone');

    return true;
  }

  private tryPistonRetract(x: number, y: number, z: number, facing: { x: number; y: number; z: number }, isSticky: boolean): void {
    const headX = x + facing.x;
    const headY = y + facing.y;
    const headZ = z + facing.z;

    if (this.world.getVoxel(headX, headY, headZ) === this.pistonHeadId) {
      this.world.setVoxel(headX, headY, headZ, 0, true);
    }

    let targetBlock = 0;
    let targetX = 0, targetY = 0, targetZ = 0;
    let hasPulled = false;

    if (isSticky) {
      targetX = headX + facing.x;
      targetY = headY + facing.y;
      targetZ = headZ + facing.z;
      targetBlock = this.world.getVoxel(targetX, targetY, targetZ);

      const targetCfg = BlockRegistry.get(targetBlock);
      const targetName = targetCfg.name || "";
      const isTargetUnmovable = targetBlock === 28 || targetBlock === 35 ||
        /Chest|Furnace|Hopper|Barrel|Shulker Box|Brewing Stand|Anvil|Enchanting Table|Smithing Table/.test(targetName);

      if (targetBlock !== 0 && !isTargetUnmovable) {
        hasPulled = true;
      }
    }

    // Set the head position: if pulled, it becomes targetBlock. Otherwise, it becomes 0 (air).
    if (this.world.getVoxel(headX, headY, headZ) === this.pistonHeadId) {
      this.world.setVoxel(headX, headY, headZ, hasPulled ? targetBlock : 0, true);
    }

    if (hasPulled) {
      // Clear target block
      this.world.setVoxel(targetX, targetY, targetZ, 0, true);

      // Move metadata
      const oldKey = `${targetX},${targetY},${targetZ}`;
      const newKey = `${headX},${headY},${headZ}`;
      if (this.metadataMap.has(oldKey)) {
        this.metadataMap.set(newKey, this.metadataMap.get(oldKey)!);
        this.metadataMap.delete(oldKey);
      }
    }

    AudioManager.playPlace('stone');
  }

  /**
   * Observer pulse triggers
   */
  private checkObserverUpdate(x: number, y: number, z: number): void {
    // Check 6 adjacent directions to see if there is an Observer facing this block
    const neighbors = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];

    for (const [dx, dy, dz] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const block = this.world.getVoxel(nx, ny, nz);

      if (block === this.observerId) {
        const key = `${nx},${ny},${nz}`;
        const meta = this.metadataMap.get(key);
        if (meta && meta.facing && meta.facing.x === -dx && meta.facing.y === -dy && meta.facing.z === -dz) {
          // Observer is looking at the changed block (input side matches delta)
          // Turn on observer output (temporarily make its output coordinate powered)
          meta.toggled = true;
          this.world.setVoxel(nx, ny, nz, this.observerId, false); // force re-mesh
          this.evaluateRedstone(nx, ny, nz);

          // Queue turn-off after 2 game ticks (1 redstone tick)
          this.actionsQueue.push({ x: nx, y: ny, z: nz, type: 'observer_off', ticksRemaining: 2 });
        }
      }
    }
  }

  private igniteTNT(x: number, y: number, z: number): void {
    this.world.setVoxel(x, y, z, 0, true);
    
    // Spawn explosion particles
    EventBus.emit('particles:spawn', new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), this.tntId, 24);
    
    // Play fuse sound
    AudioManager.playStep('sand');

    // Trigger explosive event after 80 game ticks (4 seconds)
    const center = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
    setTimeout(() => {
      EventBus.emit('mob:explode', { pos: center, radius: 4, damage: 10 });
      AudioManager.playPlayerHit();
    }, 4000);
  }

  public registerTargetHit(x: number, y: number, z: number, proximityMultiplier: number): void {
    const key = `${x},${y},${z}`;
    const meta = this.metadataMap.get(key);
    
    const power = Math.max(1, Math.min(15, Math.floor(15 * proximityMultiplier)));
    if (meta) {
      meta.power = power;
      meta.toggled = true;
      this.saveMetadata();
      this.evaluateRedstone(x, y, z);

      // Schedule target reset
      this.actionsQueue.push({ x, y, z, type: 'button_off', ticksRemaining: 20 });
    }
  }

  /**
   * Main game tick update loop (stable 20Hz rate)
   */
  public tick(dt: number): void {
    this.tickCounter++;

    // Process queued redstone time-delay actions
    for (let i = this.actionsQueue.length - 1; i >= 0; i--) {
      const act = this.actionsQueue[i];
      act.ticksRemaining--;

      if (act.ticksRemaining <= 0) {
        this.executeQueuedAction(act);
        this.actionsQueue.splice(i, 1);
      }
    }

    // Every 8 ticks (0.4s), simulate hopper transfer automation
    if (this.tickCounter % 8 === 0) {
      this.tickHoppers();
    }

    // Every 20 ticks (1.0s), check pressure plate entities overlap
    if (this.tickCounter % 10 === 0) {
      this.tickPressurePlates();
    }
  }

  private executeQueuedAction(act: QueuedAction): void {
    const blockId = this.world.getVoxel(act.x, act.y, act.z);
    const key = `${act.x},${act.y},${act.z}`;
    const meta = this.metadataMap.get(key);

    if (act.type === 'repeater_on' && blockId === this.repeaterOffId) {
      if (meta && !meta.locked) {
        this.world.setVoxel(act.x, act.y, act.z, this.repeaterOnId, false);
        this.evaluateRedstone(act.x, act.y, act.z);
      }
    } else if (act.type === 'repeater_off' && blockId === this.repeaterOnId) {
      if (meta && !meta.locked) {
        this.world.setVoxel(act.x, act.y, act.z, this.repeaterOffId, false);
        this.evaluateRedstone(act.x, act.y, act.z);
      }
    } else if (act.type === 'observer_off' && blockId === this.observerId) {
      if (meta) {
        meta.toggled = false;
        this.evaluateRedstone(act.x, act.y, act.z);
      }
    } else if (act.type === 'button_off' && blockId === getFeatureBlockId('Button')) {
      if (meta) {
        meta.toggled = false;
        meta.power = 0;
        AudioManager.playPlace('wood');
        this.evaluateRedstone(act.x, act.y, act.z);
      }
    } else if (act.type === 'piston_extend' && (blockId === this.pistonId || blockId === this.stickyPistonId)) {
      if (meta) {
        this.tryPistonPush(act.x, act.y, act.z, meta.facing);
        this.evaluateRedstone(act.x, act.y, act.z);
      }
    } else if (act.type === 'piston_retract' && (blockId === this.pistonId || blockId === this.stickyPistonId)) {
      if (meta) {
        this.tryPistonRetract(act.x, act.y, act.z, meta.facing, blockId === this.stickyPistonId);
        this.evaluateRedstone(act.x, act.y, act.z);
      }
    }
  }

  /**
   * Automates Hopper pulling and pushing
   */
  private tickHoppers(): void {
    const list = Array.from(this.metadataMap.entries());
    for (const [posKey, meta] of list) {
      const [xs, ys, zs] = posKey.split(',');
      const x = parseInt(xs), y = parseInt(ys), z = parseInt(zs);
      const blockId = this.world.getVoxel(x, y, z);
      
      if (blockId !== this.hopperId || !meta.items) continue;

      // Check if hopper is locked by redstone power
      const isPowered = this.powerMap.has(posKey) && this.powerMap.get(posKey)! > 0;
      if (isPowered) continue;

      // 1. Pull item from above (entity drop or container)
      this.automateHopperPull(x, y, z, meta);

      // 2. Push item in facing direction
      this.automateHopperPush(x, y, z, meta);
    }
  }

  private automateHopperPull(x: number, y: number, z: number, meta: BlockMetadata): void {
    const abovePos = { x, y: y + 1, z };
    const aboveBlock = this.world.getVoxel(abovePos.x, abovePos.y, abovePos.z);
    
    // Check if there is an item drop entity directly above the hopper
    const dm = (window as any).gameItemDropManager;
    if (dm && dm.drops) {
      const center = new THREE.Vector3(x + 0.5, y + 1.2, z + 0.5);
      for (let i = dm.drops.length - 1; i >= 0; i--) {
        const drop = dm.drops[i];
        if (drop.position.distanceTo(center) <= 0.95) {
          // Pull this drop
          const leftoverCount = this.addHopperItem(meta.items!, drop.blockId, drop.count);
          if (leftoverCount === 0) {
            // Sucked up completely
            if (drop.mesh) dm.scene.remove(drop.mesh);
            dm.drops.splice(i, 1);
            AudioManager.playItemPickup();
            this.saveMetadata();
            return;
          } else {
            drop.count = leftoverCount;
          }
        }
      }
    }

    // Check container above
    if (aboveBlock === 23) { // Chest
      const posStr = `${abovePos.x},${abovePos.y},${abovePos.z}`;
      let contents = this.chestCache.get(posStr);
      if (contents) {
        this.pullFromContainerInventory(contents, meta.items!);
        StorageManager.saveChestContents(posStr, contents);
      } else {
        StorageManager.loadChestContents(posStr).then(res => {
          this.chestCache.set(posStr, res || new Array(27).fill(null));
        });
      }
    } else if (aboveBlock === 24 || aboveBlock === 25) { // Furnace
      const fm = (window as any).gameFurnaceManager;
      if (fm) {
        const state = fm.getFurnaceState(abovePos.x, abovePos.y, abovePos.z);
        // Hoppers pull from furnace output slot
        if (state && state.output && state.output.count > 0) {
          const leftover = this.addHopperItem(meta.items!, state.output.id, 1);
          if (leftover === 0) {
            state.output.count--;
            if (state.output.count <= 0) state.output = null;
            fm.updateFurnaceState(abovePos.x, abovePos.y, abovePos.z, state);
            this.saveMetadata();
          }
        }
      }
    } else if (aboveBlock === this.hopperId) { // Hopper
      const aboveMeta = this.metadataMap.get(`${abovePos.x},${abovePos.y},${abovePos.z}`);
      if (aboveMeta && aboveMeta.items) {
        this.pullFromContainerInventory(aboveMeta.items, meta.items!);
        this.saveMetadata();
      }
    }
  }

  private pullFromContainerInventory(src: Array<ItemStack | null>, dest: Array<ItemStack | null>): void {
    for (let i = 0; i < src.length; i++) {
      const item = src[i];
      if (item && item.count > 0) {
        const leftover = this.addHopperItem(dest, item.id, 1);
        if (leftover === 0) {
          item.count--;
          if (item.count <= 0) src[i] = null;
          return;
        }
      }
    }
  }

  private addHopperItem(items: Array<ItemStack | null>, id: number, count: number): number {
    // 1. Try to merge with existing stacks
    for (let i = 0; i < items.length; i++) {
      const stack = items[i];
      if (stack && stack.id === id && stack.count < 64) {
        const space = 64 - stack.count;
        const xfer = Math.min(space, count);
        stack.count += xfer;
        count -= xfer;
        if (count <= 0) return 0;
      }
    }

    // 2. Put in empty slots
    for (let i = 0; i < items.length; i++) {
      if (!items[i]) {
        items[i] = { id, count };
        return 0;
      }
    }
    return count;
  }

  private automateHopperPush(x: number, y: number, z: number, meta: BlockMetadata): void {
    if (!meta.items || !meta.facing) return;
    
    // Find first available item in hopper to push
    let pushIdx = -1;
    for (let i = 0; i < meta.items.length; i++) {
      if (meta.items[i] && meta.items[i]!.count > 0) {
        pushIdx = i;
        break;
      }
    }
    if (pushIdx === -1) return; // Hopper empty
    
    const item = meta.items[pushIdx]!;
    const destPos = { x: x + meta.facing.x, y: y + meta.facing.y, z: z + meta.facing.z };
    const destBlock = this.world.getVoxel(destPos.x, destPos.y, destPos.z);

    if (destBlock === 23) { // Chest
      const posStr = `${destPos.x},${destPos.y},${destPos.z}`;
      let contents = this.chestCache.get(posStr);
      if (contents) {
        const leftover = this.pushToContainerInventory(item.id, 1, contents);
        if (leftover === 0) {
          item.count--;
          if (item.count <= 0) meta.items[pushIdx] = null;
          StorageManager.saveChestContents(posStr, contents);
          this.saveMetadata();
        }
      } else {
        StorageManager.loadChestContents(posStr).then(res => {
          this.chestCache.set(posStr, res || new Array(27).fill(null));
        });
      }
    } else if (destBlock === 24 || destBlock === 25) { // Furnace
      const fm = (window as any).gameFurnaceManager;
      if (fm) {
        const state = fm.getFurnaceState(destPos.x, destPos.y, destPos.z);
        if (state) {
          // Push logic: ores go to input, coal/wood goes to fuel
          const isFuel = fm.getFuelBurnTime(item.id) > 0;
          if (isFuel) {
            // Push to fuel slot
            if (!state.fuel) {
              state.fuel = { id: item.id, count: 1 };
              item.count--;
              if (item.count <= 0) meta.items[pushIdx] = null;
              fm.updateFurnaceState(destPos.x, destPos.y, destPos.z, state);
              this.saveMetadata();
            } else if (state.fuel.id === item.id && state.fuel.count < 64) {
              state.fuel.count++;
              item.count--;
              if (item.count <= 0) meta.items[pushIdx] = null;
              fm.updateFurnaceState(destPos.x, destPos.y, destPos.z, state);
              this.saveMetadata();
            }
          } else {
            // Push to input slot
            if (!state.input) {
              state.input = { id: item.id, count: 1 };
              item.count--;
              if (item.count <= 0) meta.items[pushIdx] = null;
              fm.updateFurnaceState(destPos.x, destPos.y, destPos.z, state);
              this.saveMetadata();
            } else if (state.input.id === item.id && state.input.count < 64) {
              state.input.count++;
              item.count--;
              if (item.count <= 0) meta.items[pushIdx] = null;
              fm.updateFurnaceState(destPos.x, destPos.y, destPos.z, state);
              this.saveMetadata();
            }
          }
        }
      }
    } else if (destBlock === this.hopperId) { // Hopper
      const destMeta = this.metadataMap.get(`${destPos.x},${destPos.y},${destPos.z}`);
      if (destMeta && destMeta.items) {
        const leftover = this.pushToContainerInventory(item.id, 1, destMeta.items);
        if (leftover === 0) {
          item.count--;
          if (item.count <= 0) meta.items[pushIdx] = null;
          this.saveMetadata();
        }
      }
    }
  }

  private pushToContainerInventory(id: number, count: number, dest: Array<ItemStack | null>): number {
    // Merge
    for (let i = 0; i < dest.length; i++) {
      const dStack = dest[i];
      if (dStack && dStack.id === id && dStack.count < 64) {
        const space = 64 - dStack.count;
        const xfer = Math.min(space, count);
        dStack.count += xfer;
        count -= xfer;
        if (count <= 0) return 0;
      }
    }
    // Place new
    for (let i = 0; i < dest.length; i++) {
      if (!dest[i]) {
        const xfer = Math.min(64, count);
        dest[i] = { id, count: xfer };
        count -= xfer;
        if (count <= 0) return 0;
      }
    }
    return count;
  }

  /**
   * Pressure Plate collision detection
   */
  private tickPressurePlates(): void {
    const list = Array.from(this.metadataMap.entries());
    const pc = (window as any).gamePlayerController;
    const em = (window as any).gameEntityManager;
    const dm = (window as any).gameItemDropManager;

    for (const [posKey, meta] of list) {
      const [xs, ys, zs] = posKey.split(',');
      const x = parseInt(xs), y = parseInt(ys), z = parseInt(zs);
      const blockId = this.world.getVoxel(x, y, z);

      if (blockId !== getFeatureBlockId('Pressure Plate')) continue;

      // Check if any entity is standing on plate (bounding sphere intersection)
      const plateCenter = new THREE.Vector3(x + 0.5, y + 0.1, z + 0.5);
      let isOver = false;

      // 1. Check player
      if (pc && pc.position) {
        if (pc.position.distanceTo(plateCenter) <= 0.8) isOver = true;
      }

      // 2. Check mobs
      if (!isOver && em && em.localMobs) {
        for (const mob of em.localMobs) {
          if (!mob.isDead && mob.position.distanceTo(plateCenter) <= 0.8) {
            isOver = true;
            break;
          }
        }
      }

      // 3. Check item drops (only wooden pressure plates react to items, but we simplify to all)
      if (!isOver && dm && dm.drops) {
        for (const drop of dm.drops) {
          if (drop.position.distanceTo(plateCenter) <= 0.8) {
            isOver = true;
            break;
          }
        }
      }

      const wasToggled = meta.toggled;
      if (isOver && !wasToggled) {
        meta.toggled = true;
        AudioManager.playPlace('wood');
        this.evaluateRedstone(x, y, z);
      } else if (!isOver && wasToggled) {
        meta.toggled = false;
        AudioManager.playPlace('wood');
        this.evaluateRedstone(x, y, z);
      }
    }
  }

  /**
   * Helpers
   */
  private checkIfAdjacentPowered(x: number, y: number, z: number, powers: Map<string, number>, getCachedVoxel?: (x: number, y: number, z: number) => number): boolean {
    const neighbors = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];

    const getVoxel = getCachedVoxel || ((tx, ty, tz) => this.world.getVoxel(tx, ty, tz));

    for (const [dx, dy, dz] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const nkey = `${nx},${ny},${nz}`;
      const bid = getVoxel(nx, ny, nz);

      if (bid === 31 || bid === this.redstoneBlockId) return true;

      // Lever toggled
      if (bid === getFeatureBlockId('Lever')) {
        const meta = this.metadataMap.get(nkey);
        if (meta && meta.toggled) return true;
      }

      // Button active
      if (bid === getFeatureBlockId('Button')) {
        const meta = this.metadataMap.get(nkey);
        if (meta && meta.toggled) return true;
      }

      // Pressure Plate active
      if (bid === getFeatureBlockId('Pressure Plate')) {
        const meta = this.metadataMap.get(nkey);
        if (meta && meta.toggled) return true;
      }

      // Active repeater facing toward us
      if (bid === this.repeaterOnId) {
        const meta = this.metadataMap.get(nkey);
        if (meta && meta.facing && meta.facing.x === -dx && meta.facing.y === -dy && meta.facing.z === -dz) {
          return true;
        }
      }

      // Active comparator facing toward us
      if (bid === this.comparatorOnId) {
        const meta = this.metadataMap.get(nkey);
        if (meta && meta.facing && meta.facing.x === -dx && meta.facing.y === -dy && meta.facing.z === -dz) {
          return true;
        }
      }

      const power = powers.get(nkey) || 0;
      if (power > 0) return true;
    }
    return false;
  }

  private getPowerInputFromDirection(x: number, y: number, z: number, dir: { x: number; y: number; z: number }): number {
    const px = x + dir.x;
    const py = y + dir.y;
    const pz = z + dir.z;
    const pKey = `${px},${py},${pz}`;

    const bid = this.world.getVoxel(px, py, pz);
    if (bid === 31 || bid === this.redstoneBlockId) return 15;
    if (bid === 30) return this.powerMap.get(pKey) || 0;
    
    if (bid === this.repeaterOnId || bid === this.comparatorOnId) {
      const meta = this.metadataMap.get(pKey);
      if (meta && meta.facing && meta.facing.x === -dir.x && meta.facing.y === -dir.y && meta.facing.z === -dir.z) {
        return meta.power || 15;
      }
    }
    return 0;
  }

  private getDaylightPower(inverted: boolean): number {
    const sky = (window as any).gameSkySystem;
    if (!sky) return inverted ? 15 : 0;
    const time = sky.getTime(); // 0.0 to 1.0
    // daylight peaks at 0.5 (noon), night is <0.2 or >0.8
    let sunFactor = Math.max(0, Math.sin(time * Math.PI * 2.0));
    let level = Math.floor(sunFactor * 15);
    return inverted ? 15 - level : level;
  }

  private calculateContainerPower(x: number, y: number, z: number): number {
    const blockId = this.world.getVoxel(x, y, z);
    
    if (blockId === 23) { // Chest
      const pos = `${x},${y},${z}`;
      const items = this.chestCache.get(pos);
      if (!items) return 0;
      return this.getItemsFullnessPower(items, 27);
    }
    
    if (blockId === 24 || blockId === 25 || blockId === getFeatureBlockId('Blast Furnace') || blockId === getFeatureBlockId('Blast Furnace (Lit)') || blockId === getFeatureBlockId('Smoker') || blockId === getFeatureBlockId('Smoker (Lit)')) {
      const fm = (window as any).gameFurnaceManager;
      if (fm) {
        const state = fm.getFurnaceState(x, y, z);
        if (state) {
          const items = [state.input, state.fuel, state.output];
          return this.getItemsFullnessPower(items, 3);
        }
      }
    }
    
    if (blockId === getFeatureBlockId('Hopper')) {
      const pos = `${x},${y},${z}`;
      const meta = this.metadataMap.get(pos);
      if (meta && meta.items) {
        return this.getItemsFullnessPower(meta.items, 5);
      }
    }
    
    return 0;
  }

  private getItemsFullnessPower(items: Array<ItemStack | null>, slots: number): number {
    let sum = 0;
    
    for (const item of items) {
      if (item && item.count > 0) {
        sum += item.count / 64;
      }
    }
    
    if (sum === 0) return 0;
    return Math.floor(1 + (sum / slots) * 14);
  }

  private playNoteBlockSound(x: number, y: number, z: number, pitch: number): void {
    const freq = 185.0 * Math.pow(1.059463, pitch); // F#3 base semitones
    const blockUnder = this.world.getVoxel(x, y - 1, z);
    const underConfig = BlockRegistry.get(blockUnder);

    let instrument = 'harp';
    if (blockUnder === 15 || blockUnder === 4 || underConfig.stepSound === 'wood') {
      instrument = 'bass';
    } else if (blockUnder === 3 || underConfig.stepSound === 'stone') {
      instrument = 'snare';
    } else if (blockUnder === 6 || blockUnder === 16 || underConfig.stepSound === 'sand') {
      instrument = 'hat';
    } else if (blockUnder === 11) {
      instrument = 'glass';
    }

    const ctx = (AudioManager as any).ctx;
    const masterGain = (AudioManager as any).masterGain;
    if (!ctx || !masterGain) return;

    const t = ctx.currentTime;
    const gainNode = ctx.createGain();

    if (instrument === 'bass') {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq / 2.0, t);
      gainNode.gain.setValueAtTime(0.35, t);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(gainNode);
      gainNode.connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.46);
    } else if (instrument === 'snare') {
      const bufferSize = ctx.sampleRate * 0.12;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1000;
      filter.Q.value = 2.0;

      gainNode.gain.setValueAtTime(0.25, t);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(masterGain);
      noise.start(t);
      noise.stop(t + 0.13);
    } else if (instrument === 'hat') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(4500, t);
      gainNode.gain.setValueAtTime(0.12, t);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(gainNode);
      gainNode.connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.06);
    } else if (instrument === 'glass') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 2.0, t);
      gainNode.gain.setValueAtTime(0.15, t);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gainNode);
      gainNode.connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.33);
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gainNode.gain.setValueAtTime(0.3, t);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gainNode);
      gainNode.connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.52);
    }
  }
}
