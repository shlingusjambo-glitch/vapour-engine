import { EventBus } from '../core/EventBus';
import { StorageManager } from '../storage/StorageManager';
import { ItemStack } from './Inventory';
import { WorldManager } from '../world/WorldManager';
import { AudioManager } from '../audio/AudioManager';
import { getFeatureItemId, getFeatureBlockId } from '../content/FeatureCatalog';
import * as THREE from 'three';

export interface BrewingState {
  x: number;
  y: number;
  z: number;
  fuel: number;        // remaining brewing operations (0 to 20)
  brewTime: number;    // remaining time in seconds (starts at 20, ticks down to 0)
  ingredient: ItemStack | null;
  fuelSlot: ItemStack | null;
  potions: Array<ItemStack | null>; // length 3
}

export class BrewingManager {
  private worldManager: WorldManager;
  private activeStands: Map<string, BrewingState> = new Map();
  private coordinates: Set<string> = new Set();
  private worldId: string = 'world_default';
  private saveTimer = 0;

  constructor(worldManager: WorldManager) {
    this.worldManager = worldManager;

    EventBus.on('block:placeBrewingStand', ({ x, y, z }: any) => {
      this.registerStand(x, y, z);
    });
    EventBus.on('block:breakBrewingStand', ({ x, y, z }: any) => {
      this.unregisterStand(x, y, z);
    });
  }

  public async init(worldId: string): Promise<void> {
    this.worldId = worldId;
    this.activeStands.clear();
    this.coordinates.clear();

    const list = await StorageManager.getWorldData<string[]>('brewing_stands::list', []);
    if (list && Array.isArray(list)) {
      this.coordinates = new Set(list);
      for (const key of list) {
        const state = await StorageManager.getWorldData<BrewingState | null>(`brewing_stand::${key}`, null);
        if (state) {
          this.activeStands.set(key, state);
        }
      }
    }
  }

  public getStandState(x: number, y: number, z: number): BrewingState {
    const key = `${x},${y},${z}`;
    let state = this.activeStands.get(key);
    if (!state) {
      state = {
        x, y, z,
        fuel: 0,
        brewTime: 0,
        ingredient: null,
        fuelSlot: null,
        potions: [null, null, null],
      };
      this.activeStands.set(key, state);
      if (!this.coordinates.has(key)) {
        this.coordinates.add(key);
        this.saveList();
      }
    }
    return state;
  }

  public registerStand(x: number, y: number, z: number): void {
    this.getStandState(x, y, z);
  }

  public unregisterStand(x: number, y: number, z: number): void {
    const key = `${x},${y},${z}`;
    const state = this.activeStands.get(key);
    if (state) {
      // Spawn items in world
      const pos = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
      if (state.ingredient) EventBus.emit('item:spawn', pos, state.ingredient.id, state.ingredient.count);
      if (state.fuelSlot) EventBus.emit('item:spawn', pos, state.fuelSlot.id, state.fuelSlot.count);
      for (const p of state.potions) {
        if (p) EventBus.emit('item:spawn', pos, p.id, p.count, p.potionEffect);
      }
    }
    this.activeStands.delete(key);
    this.coordinates.delete(key);
    this.saveList();
    StorageManager.setWorldData(`brewing_stand::${key}`, null);
  }

  public tick(dt: number): void {
    let changed = false;

    const netherWart = getFeatureItemId('Nether Wart') || 421;
    const sugar = getFeatureItemId('Sugar') || 405;
    const redFlower = 13; // Red Flower block ID
    const apple = 280; // Apple item ID
    const goldenCarrot = getFeatureItemId('Golden Carrot') || 450;
    const blazePowder = getFeatureItemId('Blaze Powder') || 418;
    const brownMushroom = 276; // Brown Mushroom block ID
    const gunpowder = 209; // Gunpowder item ID
    const enderEye = getFeatureItemId('Ender Eye') || 422;

    for (const [key, state] of this.activeStands.entries()) {
      // 1. Handle Blaze Powder fuel insertion
      if (state.fuel < 20 && state.fuelSlot && state.fuelSlot.id === blazePowder) {
        state.fuel = Math.min(20, state.fuel + 20);
        state.fuelSlot.count--;
        if (state.fuelSlot.count <= 0) {
          state.fuelSlot = null;
        }
        changed = true;
        AudioManager.playPlace('stone');
      }

      // 2. Check if we can brew
      const ingredient = state.ingredient;
      const hasPotions = state.potions.some(p => p !== null && p.count > 0);
      const hasIngredient = ingredient !== null && ingredient.count > 0;
      const canBrew = hasPotions && hasIngredient && state.fuel > 0 && this.hasValidRecipe(ingredient.id, state.potions);

      if (canBrew) {
        if (state.brewTime === 0) {
          state.brewTime = 20.0; // 20 seconds brewing time
        }
        state.brewTime = Math.max(0, state.brewTime - dt);

        if (state.brewTime <= 0) {
          // Brewing complete!
          this.executeBrew(state);
          state.fuel--;
          state.brewTime = 0;
          AudioManager.playPlace('water');
          EventBus.emit('brewing:complete', { x: state.x, y: state.y, z: state.z });
        }
        changed = true;
      } else {
        if (state.brewTime !== 0) {
          state.brewTime = 0;
          changed = true;
        }
      }
    }

    if (changed) {
      this.saveTimer += dt;
      if (this.saveTimer >= 2.0) {
        this.saveAll();
        this.saveTimer = 0;
      }
    }
  }

  private hasValidRecipe(ingId: number, potions: Array<ItemStack | null>): boolean {
    const netherWart = getFeatureItemId('Nether Wart') || 421;
    const sugar = getFeatureItemId('Sugar') || 405;
    const redFlower = 13;
    const apple = 280;
    const goldenCarrot = getFeatureItemId('Golden Carrot') || 450;
    const blazePowder = getFeatureItemId('Blaze Powder') || 418;
    const brownMushroom = 276;
    const gunpowder = 209;
    const enderEye = getFeatureItemId('Ender Eye') || 422;

    for (const p of potions) {
      if (!p) continue;
      const effect = p.potionEffect || 'water';

      // Gunpowder transforms Potion -> Splash Potion
      if (ingId === gunpowder) {
        if (p.id === 415) return true; // Potion
        continue;
      }

      // Ender Eye transforms Splash -> Lingering Potion
      if (ingId === enderEye) {
        if (p.id === 416) return true; // Splash Potion
        continue;
      }

      // Standard ingredient recipes
      if (ingId === netherWart && effect === 'water') return true;
      if (ingId === sugar && effect === 'awkward') return true;
      if (ingId === redFlower && effect === 'awkward') return true;
      if (ingId === apple && effect === 'awkward') return true;
      if (ingId === goldenCarrot && effect === 'awkward') return true;
      if (ingId === blazePowder && effect === 'awkward') return true;
      if (ingId === brownMushroom && effect === 'awkward') return true;
    }
    return false;
  }

  private executeBrew(state: BrewingState): void {
    const netherWart = getFeatureItemId('Nether Wart') || 421;
    const sugar = getFeatureItemId('Sugar') || 405;
    const redFlower = 13;
    const apple = 280;
    const goldenCarrot = getFeatureItemId('Golden Carrot') || 450;
    const blazePowder = getFeatureItemId('Blaze Powder') || 418;
    const brownMushroom = 276;
    const gunpowder = 209;
    const enderEye = getFeatureItemId('Ender Eye') || 422;

    if (!state.ingredient) return;
    const ingId = state.ingredient.id;

    for (let i = 0; i < 3; i++) {
      const p = state.potions[i];
      if (!p) continue;
      const effect = p.potionEffect || 'water';

      if (ingId === gunpowder && p.id === 415) {
        p.id = 416; // Transform to Splash Potion
      } else if (ingId === enderEye && p.id === 416) {
        p.id = 417; // Transform to Lingering Potion
      } else if (ingId === netherWart && effect === 'water') {
        p.potionEffect = 'awkward';
      } else if (ingId === sugar && effect === 'awkward') {
        p.potionEffect = 'speed';
      } else if (ingId === redFlower && effect === 'awkward') {
        p.potionEffect = 'jump_boost';
      } else if (ingId === apple && effect === 'awkward') {
        p.potionEffect = 'healing';
      } else if (ingId === goldenCarrot && effect === 'awkward') {
        p.potionEffect = 'night_vision';
      } else if (ingId === blazePowder && effect === 'awkward') {
        p.potionEffect = 'strength';
      } else if (ingId === brownMushroom && effect === 'awkward') {
        p.potionEffect = 'poison';
      }
    }

    state.ingredient.count--;
    if (state.ingredient.count <= 0) {
      state.ingredient = null;
    }
  }

  private saveList(): void {
    StorageManager.setWorldData('brewing_stands::list', Array.from(this.coordinates));
  }

  public saveAll(): void {
    for (const [key, state] of this.activeStands.entries()) {
      StorageManager.setWorldData(`brewing_stand::${key}`, state);
    }
  }
}
