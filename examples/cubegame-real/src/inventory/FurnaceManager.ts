import { EventBus } from '../core/EventBus';
import { StorageManager } from '../storage/StorageManager';
import { ItemStack } from './Inventory';
import { WorldManager } from '../world/WorldManager';
import { AudioManager } from '../audio/AudioManager';
import * as THREE from 'three';
import { EXTRA_FUEL_BURN_TIMES, EXTRA_SMELTING_RECIPES, getFeatureBlockId } from '../content/FeatureCatalog';
import { BlockRegistry } from '../world/BlockRegistry';

export interface FurnaceState {
  x: number;
  y: number;
  z: number;
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  burnTime: number;      // remaining burn time in seconds
  maxBurnTime: number;   // max burn time of current fuel in seconds
  cookTime: number;      // cooking progress in seconds (out of 10)
  xpReward: number;      // accumulated XP
}

export interface SmeltingRecipe {
  input: number;
  output: number;
  xp: number;
}

const SMELTING_RECIPES: SmeltingRecipe[] = [
  { input: 9,   output: 202, xp: 0.7 },  // Iron Ore -> Iron Ingot
  { input: 17,  output: 203, xp: 1.0 },  // Gold Ore -> Gold Ingot
  { input: 6,   output: 11,  xp: 0.1 },  // Sand -> Glass
  { input: 212, output: 282, xp: 0.35 }, // Raw Beef -> Cooked Beef
  { input: 213, output: 283, xp: 0.35 }, // Raw Pork -> Cooked Pork
  { input: 214, output: 284, xp: 0.35 }, // Raw Chicken -> Cooked Chicken
  { input: 4,   output: 201, xp: 0.15 }, // Wood Log -> Coal (Charcoal)
  ...EXTRA_SMELTING_RECIPES,
];

const FUEL_BURN_TIMES: Record<number, number> = {
  201: 80,  // Coal
  38: 640,  // Coal Block
  15: 15,   // Planks
  4: 15,    // Wood Log
  200: 5,   // Stick
  ...EXTRA_FUEL_BURN_TIMES,
};

export class FurnaceManager {
  private worldManager: WorldManager;
  private activeFurnaces: Map<string, FurnaceState> = new Map();
  private coordinates: Set<string> = new Set();
  private worldId: string = 'world_default';
  private saveTimer = 0;

  constructor(worldManager: WorldManager) {
    this.worldManager = worldManager;

    EventBus.on('block:placeFurnace', ({ x, y, z }: any) => {
      this.registerFurnace(x, y, z);
    });
    EventBus.on('block:breakFurnace', ({ x, y, z }: any) => {
      this.unregisterFurnace(x, y, z);
    });
  }

  public async init(worldId: string): Promise<void> {
    this.worldId = worldId;
    this.activeFurnaces.clear();
    this.coordinates.clear();

    const list = await StorageManager.getWorldData<string[]>('furnaces::list', []);
    if (list && Array.isArray(list)) {
      this.coordinates = new Set(list);
      // Pre-load all furnace states
      for (const key of list) {
        const state = await StorageManager.getWorldData<FurnaceState | null>(`furnace::${key}`, null);
        if (state) {
          this.activeFurnaces.set(key, state);
        }
      }
    }
  }

  public getFuelBurnTime(id: number): number {
    return FUEL_BURN_TIMES[id] ?? 0;
  }

  public getSmeltingRecipe(inputId: number): SmeltingRecipe | null {
    return SMELTING_RECIPES.find(r => r.input === inputId) ?? null;
  }

  public getFurnaceState(x: number, y: number, z: number): FurnaceState {
    const key = `${x},${y},${z}`;
    let state = this.activeFurnaces.get(key);
    if (!state) {
      state = {
        x, y, z,
        input: null,
        fuel: null,
        output: null,
        burnTime: 0,
        maxBurnTime: 0,
        cookTime: 0,
        xpReward: 0
      };
      this.activeFurnaces.set(key, state);
      this.coordinates.add(key);
      this.saveFurnaceList();
      this.saveFurnace(key, state);
    }
    return state;
  }

  public async registerFurnace(x: number, y: number, z: number): Promise<void> {
    const key = `${x},${y},${z}`;
    if (!this.coordinates.has(key)) {
      this.coordinates.add(key);
      await this.saveFurnaceList();
    }
    const state = this.getFurnaceState(x, y, z);
    this.activeFurnaces.set(key, state);
    await this.saveFurnace(key, state);
  }

  public async unregisterFurnace(x: number, y: number, z: number): Promise<void> {
    const key = `${x},${y},${z}`;
    const state = this.activeFurnaces.get(key);
    if (state) {
      // Drop all items
      const pos = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
      if (state.input && state.input.count > 0) {
        EventBus.emit('item:spawn', pos, state.input.id, state.input.count);
      }
      if (state.fuel && state.fuel.count > 0) {
        EventBus.emit('item:spawn', pos, state.fuel.id, state.fuel.count);
      }
      if (state.output && state.output.count > 0) {
        EventBus.emit('item:spawn', pos, state.output.id, state.output.count);
      }

      this.activeFurnaces.delete(key);
      this.coordinates.delete(key);
      await this.saveFurnaceList();
      await StorageManager.deleteWorldData(`furnace::${key}`);
    }
  }

  public updateFurnaceState(x: number, y: number, z: number, state: FurnaceState): void {
    const key = `${x},${y},${z}`;
    this.activeFurnaces.set(key, state);
    this.saveFurnace(key, state);
  }

  public tick(dt: number): void {
    let listChanged = false;
    const playerPos = (window as any).gamePlayerController?.position as THREE.Vector3 | undefined;

    for (const [key, state] of this.activeFurnaces.entries()) {
      let stateChanged = false;

      // 1. Process fuel burning down
      if (state.burnTime > 0) {
        state.burnTime -= dt;
        if (state.burnTime < 0) {
          state.burnTime = 0;
        }
        stateChanged = true;

        // Play crackle sound occasionally if player is near
        if (playerPos && playerPos.distanceTo(new THREE.Vector3(state.x, state.y, state.z)) <= 16) {
          if (Math.random() < 0.008) {
            AudioManager.playFurnaceCrackle();
          }
        }
      }

      // 2. Process smelting progress
      const recipe = state.input ? this.getSmeltingRecipe(state.input.id) : null;
      const canOutput = recipe && (
        !state.output || (state.output.id === recipe.output && state.output.count < 64)
      );

      if (recipe && canOutput) {
        // We have a valid recipe and output space
        if (state.burnTime <= 0) {
          // Furnace is not burning. Try to consume a fuel item to light it up.
          if (state.fuel && state.fuel.count > 0) {
            const fuelTime = this.getFuelBurnTime(state.fuel.id);
            if (fuelTime > 0) {
              state.burnTime = fuelTime;
              state.maxBurnTime = fuelTime;
              state.fuel.count--;
              if (state.fuel.count <= 0) {
                state.fuel = null;
              }
              stateChanged = true;
            }
          }
        }

        if (state.burnTime > 0) {
          // Smelting ticks up - Blast Furnace and Smoker are 2x faster (takes 5s instead of 10s)
          const block = this.worldManager.getVoxel(state.x, state.y, state.z);
          const name = BlockRegistry.get(block).name || "";
          const speed = (name.includes("Blast") || name.includes("Smoker")) ? 2.0 : 1.0;
          state.cookTime += dt * speed;

          if (state.cookTime >= 10.0) { // 10 seconds per item base
            state.cookTime = 0;
            // Deduct input
            state.input!.count--;
            if (state.input!.count <= 0) {
              state.input = null;
            }
            // Add output
            if (!state.output) {
              state.output = { id: recipe.output, count: 1 };
            } else {
              state.output.count++;
            }
            // Add XP
            state.xpReward += recipe.xp;
            stateChanged = true;
          }
        } else {
          // Out of fuel, cool down slowly
          if (state.cookTime > 0) {
            state.cookTime = Math.max(0, state.cookTime - dt * 2.0);
            stateChanged = true;
          }
        }
      } else {
        // No valid recipe or output blocked, cool down
        if (state.cookTime > 0) {
          state.cookTime = Math.max(0, state.cookTime - dt * 2.0);
          stateChanged = true;
        }
      }

      // 3. Lit/unlit block state swaps
      const currentBlock = this.worldManager.getVoxel(state.x, state.y, state.z);
      const blockName = BlockRegistry.get(currentBlock).name || "";
      if (state.burnTime > 0) {
        if (currentBlock === 24) { // Normal Furnace -> Lit
          this.worldManager.setVoxel(state.x, state.y, state.z, 25, true);
        } else if (blockName === 'Blast Furnace') {
          const litId = getFeatureBlockId('Blast Furnace (Lit)');
          if (litId) this.worldManager.setVoxel(state.x, state.y, state.z, litId, true);
        } else if (blockName === 'Smoker') {
          const litId = getFeatureBlockId('Smoker (Lit)');
          if (litId) this.worldManager.setVoxel(state.x, state.y, state.z, litId, true);
        }
      } else {
        if (currentBlock === 25) { // Lit -> Normal Furnace
          this.worldManager.setVoxel(state.x, state.y, state.z, 24, true);
        } else if (blockName === 'Blast Furnace (Lit)') {
          const unlitId = getFeatureBlockId('Blast Furnace');
          if (unlitId) this.worldManager.setVoxel(state.x, state.y, state.z, unlitId, true);
        } else if (blockName === 'Smoker (Lit)') {
          const unlitId = getFeatureBlockId('Smoker');
          if (unlitId) this.worldManager.setVoxel(state.x, state.y, state.z, unlitId, true);
        }
      }

      if (stateChanged) {
        EventBus.emit('furnace:updated', { x: state.x, y: state.y, z: state.z, state });
      }
    }

    // Periodically save all furnace states to IndexedDB
    this.saveTimer += dt;
    if (this.saveTimer >= 5.0) { // every 5 seconds
      this.saveTimer = 0;
      for (const [key, state] of this.activeFurnaces.entries()) {
        this.saveFurnace(key, state);
      }
    }
  }

  private saveFurnace(key: string, state: FurnaceState): void {
    StorageManager.setWorldData(`furnace::${key}`, state);
  }

  private saveFurnaceList(): Promise<void> {
    return StorageManager.setWorldData('furnaces::list', Array.from(this.coordinates));
  }
}
