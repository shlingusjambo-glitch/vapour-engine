import { EXTRA_BLOCKS } from '../content/FeatureCatalog';
import { VoxelBlockRegistry } from '@vapour/engine';

export type BlockRenderShape =
  | 'cube'
  | 'slab'
  | 'stairs'
  | 'door'
  | 'trapdoor'
  | 'ladder'
  | 'fence'
  | 'wall'
  | 'pane'
  | 'chain'
  | 'button'
  | 'plate'
  | 'post';

export interface LocalCollisionBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface BlockConfig {
  id: number;
  name: string;
  isSolid: boolean;
  isTransparent: boolean;
  isWater: boolean;
  isFoliage: boolean;
  breakTime: number;
  stepSound: string;
  textures: number | [number, number, number, number, number, number];
  requiresTool?: 'pickaxe' | 'axe' | 'shovel';
  minTier?: number; // 0=wood,1=stone,2=iron,3=gold,4=diamond
  drops?: number | number[] | null; // item IDs dropped; null = nothing; undefined = same block
  lightLevel?: number; // 0-15 emitted light
  isInteractable?: boolean; // right-click opens UI
  renderShape?: BlockRenderShape; // optional non-full-cube model/collision shape
}

export class BlockRegistry {
  private static blocks = new VoxelBlockRegistry<BlockConfig>({ fallbackId: 3 });

  public static init(): void {
    // ── Core natural blocks ──────────────────────────────────────────────
    this.register({ id: 0,  name: 'Air',          isSolid: false, isTransparent: true,  isWater: false, isFoliage: false, breakTime: 0,    stepSound: 'none',  textures: 0 });
    this.register({ id: 1,  name: 'Grass',         isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 0.6,  stepSound: 'grass', textures: [0, 2, 1, 1, 1, 1], requiresTool: 'shovel', drops: 2 });
    this.register({ id: 2,  name: 'Dirt',          isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 0.5,  stepSound: 'sand',  textures: 2, requiresTool: 'shovel' });
    this.register({ id: 3,  name: 'Stone',         isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 1.5,  stepSound: 'stone', textures: 3, requiresTool: 'pickaxe', drops: 3 });
    this.register({ id: 4,  name: 'Wood Log',      isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 1.0,  stepSound: 'wood',  textures: [5, 5, 4, 4, 4, 4], requiresTool: 'axe' });
    this.register({ id: 5,  name: 'Leaves',        isSolid: true,  isTransparent: true,  isWater: false, isFoliage: false, breakTime: 0.25, stepSound: 'grass', textures: 6 });
    this.register({ id: 6,  name: 'Sand',          isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 0.4,  stepSound: 'sand',  textures: 7, requiresTool: 'shovel' });
    this.register({ id: 7,  name: 'Water',         isSolid: false, isTransparent: true,  isWater: true,  isFoliage: false, breakTime: 99.0, stepSound: 'water', textures: 8, drops: null });
    this.register({ id: 8,  name: 'Coal Ore',      isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 2.0,  stepSound: 'stone', textures: 9,  requiresTool: 'pickaxe', minTier: 0, drops: 201 });
    this.register({ id: 9,  name: 'Iron Ore',      isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 2.5,  stepSound: 'stone', textures: 10, requiresTool: 'pickaxe', minTier: 1 });
    this.register({ id: 10, name: 'Brick',         isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 1.8,  stepSound: 'stone', textures: 11, requiresTool: 'pickaxe' });
    this.register({ id: 11, name: 'Glass',         isSolid: true,  isTransparent: true,  isWater: false, isFoliage: false, breakTime: 0.3,  stepSound: 'stone', textures: 12, drops: null });
    this.register({ id: 12, name: 'Tall Grass',    isSolid: false, isTransparent: true,  isWater: false, isFoliage: true,  breakTime: 0.05, stepSound: 'grass', textures: 13 });
    this.register({ id: 13, name: 'Red Flower',    isSolid: false, isTransparent: true,  isWater: false, isFoliage: true,  breakTime: 0.05, stepSound: 'grass', textures: 14 });
    this.register({ id: 14, name: 'Yellow Flower', isSolid: false, isTransparent: true,  isWater: false, isFoliage: true,  breakTime: 0.05, stepSound: 'grass', textures: 15 });
    this.register({ id: 15, name: 'Wood Planks',   isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 0.8,  stepSound: 'wood',  textures: 22, requiresTool: 'axe' });
    this.register({ id: 16, name: 'Gravel',        isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 0.6,  stepSound: 'sand',  textures: 41, requiresTool: 'shovel', drops: 205 });
    this.register({ id: 17, name: 'Gold Ore',      isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 3.0,  stepSound: 'stone', textures: 42, requiresTool: 'pickaxe', minTier: 2 });
    this.register({ id: 18, name: 'Diamond Ore',   isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 3.5,  stepSound: 'stone', textures: 43, requiresTool: 'pickaxe', minTier: 2, drops: 204 });
    this.register({ id: 19, name: 'Mossy Cobblestone', isSolid: true, isTransparent: false, isWater: false, isFoliage: false, breakTime: 1.5, stepSound: 'stone', textures: 44, requiresTool: 'pickaxe' });
    this.register({ id: 20, name: 'Bookshelf',     isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 1.5,  stepSound: 'wood',  textures: [45, 45, 22, 22, 22, 22], requiresTool: 'axe' });

    // ── Player-crafted / functional blocks ───────────────────────────────
    this.register({ id: 21, name: 'Torch',         isSolid: false, isTransparent: true,  isWater: false, isFoliage: true,  breakTime: 0.05, stepSound: 'wood',  textures: 46, lightLevel: 14 });
    this.register({ id: 22, name: 'Crafting Table',isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 1.5,  stepSound: 'wood',  textures: [47, 22, 48, 48, 48, 48], requiresTool: 'axe', isInteractable: true });
    this.register({ id: 23, name: 'Chest',         isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 2.5,  stepSound: 'wood',  textures: [49, 22, 49, 49, 49, 49], requiresTool: 'axe', isInteractable: true });
    this.register({ id: 24, name: 'Furnace',       isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 3.5,  stepSound: 'stone', textures: [3, 3, 50, 3, 3, 3], requiresTool: 'pickaxe', isInteractable: true });
    this.register({ id: 25, name: 'Furnace (Lit)', isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 3.5,  stepSound: 'stone', textures: [3, 3, 51, 3, 3, 3], requiresTool: 'pickaxe', lightLevel: 13, drops: 24 });

    // ── Nether / End / Special ───────────────────────────────────────────
    this.register({ id: 26, name: 'Netherrack',    isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 0.4,  stepSound: 'stone', textures: 23, requiresTool: 'pickaxe' });
    this.register({ id: 27, name: 'Soul Sand',     isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 0.5,  stepSound: 'sand',  textures: 24, requiresTool: 'shovel' });
    this.register({ id: 28, name: 'Obsidian',      isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 10.0, stepSound: 'stone', textures: 25, requiresTool: 'pickaxe', minTier: 2 });
    this.register({ id: 29, name: 'Portal',        isSolid: false, isTransparent: true,  isWater: false, isFoliage: false, breakTime: 99.0, stepSound: 'none',  textures: 26, drops: null });
    this.register({ id: 30, name: 'Redstone Wire', isSolid: false, isTransparent: true,  isWater: false, isFoliage: true,  breakTime: 0.05, stepSound: 'sand',  textures: 27 });
    this.register({ id: 31, name: 'Redstone Torch',isSolid: false, isTransparent: true,  isWater: false, isFoliage: true,  breakTime: 0.05, stepSound: 'wood',  textures: 28, lightLevel: 7 });
    this.register({ id: 32, name: 'Redstone Lamp', isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 0.8,  stepSound: 'stone', textures: 29 });
    this.register({ id: 33, name: 'Wheat Crops',   isSolid: false, isTransparent: true,  isWater: false, isFoliage: true,  breakTime: 0.05, stepSound: 'grass', textures: 30 });
    this.register({ id: 34, name: 'End Stone',     isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 2.0,  stepSound: 'stone', textures: 38, requiresTool: 'pickaxe' });
    this.register({ id: 35, name: 'Bedrock',       isSolid: true,  isTransparent: false, isWater: false, isFoliage: false, breakTime: 99.0, stepSound: 'stone', textures: 39, drops: null });
    this.register({ id: 36, name: 'Redstone Lamp (On)', isSolid: true, isTransparent: false, isWater: false, isFoliage: false, breakTime: 0.8, stepSound: 'stone', textures: 40, lightLevel: 15, drops: 32 });
    this.register({ id: 37, name: 'Lava', isSolid: false, isTransparent: true, isWater: true, isFoliage: false, breakTime: 99.0, stepSound: 'water', textures: 52, lightLevel: 15, drops: null });
    this.register({ id: 38, name: 'Coal Block', isSolid: true, isTransparent: false, isWater: false, isFoliage: false, breakTime: 2.0, stepSound: 'stone', textures: 53, requiresTool: 'pickaxe' });

    // ── Large original survival-sandbox expansion pack ───────────────────
    for (const block of EXTRA_BLOCKS) {
      this.register(block);
    }

    // ── Flowing fluid stages ─────────────────────────────────────────────
    for (let level = 7; level >= 1; level--) {
      this.register({
        id: 2000 + (8 - level), // 2001 (lvl 7) to 2007 (lvl 1)
        name: `Flowing Water Stage ${level}`,
        isSolid: false,
        isTransparent: true,
        isWater: true,
        isFoliage: false,
        breakTime: 99.0,
        stepSound: 'water',
        textures: 8,
        drops: null
      });
    }

    for (let level = 3; level >= 1; level--) {
      this.register({
        id: 2010 + (4 - level), // 2011 (lvl 3) to 2013 (lvl 1)
        name: `Flowing Lava Stage ${level}`,
        isSolid: false,
        isTransparent: true,
        isWater: true,
        isFoliage: false,
        breakTime: 99.0,
        stepSound: 'water',
        textures: 52,
        lightLevel: 15,
        drops: null
      });
    }
  }

  public static register(config: BlockConfig): void {
    this.blocks.define(config, { replace: this.blocks.has(config.id) });
  }

  public static get(id: number): BlockConfig {
    return this.blocks.getOrFallback(id) as BlockConfig;
  }

  public static has(id: number): boolean {
    return this.blocks.has(id);
  }

  public static isPlaceableBlock(id: number): boolean {
    const config = this.blocks.get(id);
    return !!config && id !== 0 && !config.isWater && (config.isSolid || config.isTransparent || config.isFoliage);
  }

  /**
   * Names in FeatureCatalog can now become real non-cube models without every
   * generated block having to explicitly specify a model type. The explicit
   * renderShape field still wins when a block wants a special override.
   */
  public static getRenderShape(id: number): BlockRenderShape {
    const config = this.get(id);
    if (config.renderShape) return config.renderShape;

    const name = config.name.toLowerCase();
    if (name.includes('stairs')) return 'stairs';
    if (name.includes('slab')) return 'slab';
    if (name.includes('trapdoor')) return 'trapdoor';
    if (name.includes('door')) return 'door';
    if (name.includes('ladder')) return 'ladder';
    if (name.includes('fence') || name.includes('gate')) return 'fence';
    if (name.includes('wall')) return 'wall';
    if (name.includes('pane') || name.includes('bars')) return 'pane';
    if (name.includes('chain')) return 'chain';
    if (name.includes('button') || name.includes('lever')) return 'button';
    if (name.includes('pressure plate')) return 'plate';
    if (name.includes('torch') || name.includes('lantern') || name.includes('candle') || name.includes('rod')) return 'post';
    return 'cube';
  }

  public static isFullCube(id: number): boolean {
    const config = this.get(id);
    return id !== 0 && config.isSolid && !config.isTransparent && !config.isWater && this.getRenderShape(id) === 'cube';
  }

  public static getCollisionBoxes(id: number): LocalCollisionBox[] {
    const config = this.get(id);
    if (id === 0 || !config.isSolid || config.isWater || config.isFoliage) return [];

    const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): LocalCollisionBox => ({
      minX, minY, minZ, maxX, maxY, maxZ,
    });

    switch (this.getRenderShape(id)) {
      case 'slab': return [box(0, 0, 0, 1, 0.5, 1)];
      case 'stairs': return [box(0, 0, 0, 1, 0.5, 1), box(0, 0.5, 0.5, 1, 1, 1)];
      case 'door': return [box(0.0625, 0, 0.0, 0.9375, 1, 0.1875)];
      case 'trapdoor': return [box(0, 0, 0, 1, 0.1875, 1)];
      case 'fence': return [box(0.35, 0, 0.35, 0.65, 1, 0.65), box(0, 0.35, 0.4375, 1, 0.55, 0.5625), box(0.4375, 0.35, 0, 0.5625, 0.55, 1), box(0, 0.7, 0.4375, 1, 0.9, 0.5625), box(0.4375, 0.7, 0, 0.5625, 0.9, 1)];
      case 'wall': return [box(0.25, 0, 0.25, 0.75, 1, 0.75), box(0, 0.25, 0.3125, 1, 0.8125, 0.6875), box(0.3125, 0.25, 0, 0.6875, 0.8125, 1)];
      case 'pane': return [box(0.4375, 0, 0, 0.5625, 1, 1), box(0, 0, 0.4375, 1, 1, 0.5625)];
      case 'chain':
      case 'button':
      case 'plate':
      case 'post':
      case 'ladder':
        return [];
      default: return [box(0, 0, 0, 1, 1, 1)];
    }
  }

  public static getAll(): BlockConfig[] {
    return this.blocks.definitions() as BlockConfig[];
  }

  public static getFaceTextureIndex(id: number, faceIndex: number): number {
    const config = this.get(id);
    
    // Dynamic texture index lookup for crop growth stages (textures 30-37)
    if (config.name && (
      config.name.includes('Crops') || 
      config.name.includes('Bush') || 
      config.name.includes('Wheat') || 
      config.name.includes('Carrot') || 
      config.name.includes('Potato') || 
      config.name.includes('Beetroot')
    )) {
      const match = config.name.match(/Stage\s*([0-7])/i);
      if (match) {
        return 30 + parseInt(match[1]);
      }
      if (
        config.name === 'Wheat Crops' ||
        config.name === 'Carrot Crops' ||
        config.name === 'Potato Crops' ||
        config.name === 'Beetroot Crops' ||
        config.name === 'Berry Bush'
      ) {
        return 30; // Stage 0
      }
    }

    if (Array.isArray(config.textures)) {
      return config.textures[faceIndex];
    }
    return config.textures;
  }
}

BlockRegistry.init();
