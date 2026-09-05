import { EXTRA_ITEMS } from '../content/FeatureCatalog';

export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe' | 'bow' | 'gun' | 'food' | 'material' | 'block' | 'armor' | 'shield' | 'seed' | 'bucket' | 'utility' | 'none';
export type ToolTier = 0 | 1 | 2 | 3 | 4; // wood=0, stone=1, iron=2, gold=3, diamond=4

export interface ItemDef {
  id: number;
  name: string;
  maxStack: number;
  toolType: ToolType;
  tier: ToolTier;
  attackDamage: number;   // hearts
  miningSpeed: number;    // multiplier
  durability: number;     // uses (0 = infinite / blocks)
  foodRestored: number;   // hunger points
  foodSaturation: number; // saturation
}

const ITEMS: ItemDef[] = [
  // ── Materials ──────────────────────────────────────────────────────────
  { id: 200, name: 'Stick',        maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 201, name: 'Coal',         maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 202, name: 'Iron Ingot',   maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 203, name: 'Gold Ingot',   maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 204, name: 'Diamond',      maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 205, name: 'Flint',        maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 206, name: 'String',       maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 207, name: 'Feather',      maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 208, name: 'Bone',         maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 209, name: 'Gunpowder',    maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 210, name: 'Wool',         maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 211, name: 'Arrow',        maxStack: 64, toolType: 'material', tier: 0, attackDamage: 3, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 215, name: 'Spectral Arrow', maxStack: 64, toolType: 'material', tier: 0, attackDamage: 3, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 212, name: 'Raw Beef',     maxStack: 64, toolType: 'food',     tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 3, foodSaturation: 1.8 },
  { id: 213, name: 'Raw Pork',     maxStack: 64, toolType: 'food',     tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 3, foodSaturation: 1.8 },
  { id: 214, name: 'Raw Chicken',  maxStack: 64, toolType: 'food',     tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 2, foodSaturation: 1.2 },

  // ── Pickaxes ──────────────────────────────────────────────────────────
  { id: 220, name: 'Wooden Pickaxe',  maxStack: 1, toolType: 'pickaxe', tier: 0, attackDamage: 2, miningSpeed: 2.0,  durability: 59,   foodRestored: 0, foodSaturation: 0 },
  { id: 221, name: 'Stone Pickaxe',   maxStack: 1, toolType: 'pickaxe', tier: 1, attackDamage: 3, miningSpeed: 4.0,  durability: 131,  foodRestored: 0, foodSaturation: 0 },
  { id: 222, name: 'Iron Pickaxe',    maxStack: 1, toolType: 'pickaxe', tier: 2, attackDamage: 4, miningSpeed: 6.0,  durability: 250,  foodRestored: 0, foodSaturation: 0 },
  { id: 223, name: 'Gold Pickaxe',    maxStack: 1, toolType: 'pickaxe', tier: 3, attackDamage: 2, miningSpeed: 12.0, durability: 32,   foodRestored: 0, foodSaturation: 0 },
  { id: 224, name: 'Diamond Pickaxe', maxStack: 1, toolType: 'pickaxe', tier: 4, attackDamage: 5, miningSpeed: 8.0,  durability: 1561, foodRestored: 0, foodSaturation: 0 },

  // ── Axes ──────────────────────────────────────────────────────────────
  { id: 230, name: 'Wooden Axe',   maxStack: 1, toolType: 'axe', tier: 0, attackDamage: 3, miningSpeed: 2.0,  durability: 59,   foodRestored: 0, foodSaturation: 0 },
  { id: 231, name: 'Stone Axe',    maxStack: 1, toolType: 'axe', tier: 1, attackDamage: 4, miningSpeed: 4.0,  durability: 131,  foodRestored: 0, foodSaturation: 0 },
  { id: 232, name: 'Iron Axe',     maxStack: 1, toolType: 'axe', tier: 2, attackDamage: 5, miningSpeed: 6.0,  durability: 250,  foodRestored: 0, foodSaturation: 0 },
  { id: 233, name: 'Gold Axe',     maxStack: 1, toolType: 'axe', tier: 3, attackDamage: 3, miningSpeed: 12.0, durability: 32,   foodRestored: 0, foodSaturation: 0 },
  { id: 234, name: 'Diamond Axe',  maxStack: 1, toolType: 'axe', tier: 4, attackDamage: 6, miningSpeed: 8.0,  durability: 1561, foodRestored: 0, foodSaturation: 0 },

  // ── Shovels ───────────────────────────────────────────────────────────
  { id: 240, name: 'Wooden Shovel',  maxStack: 1, toolType: 'shovel', tier: 0, attackDamage: 1.5, miningSpeed: 2.0,  durability: 59,   foodRestored: 0, foodSaturation: 0 },
  { id: 241, name: 'Stone Shovel',   maxStack: 1, toolType: 'shovel', tier: 1, attackDamage: 2,   miningSpeed: 4.0,  durability: 131,  foodRestored: 0, foodSaturation: 0 },
  { id: 242, name: 'Iron Shovel',    maxStack: 1, toolType: 'shovel', tier: 2, attackDamage: 2.5, miningSpeed: 6.0,  durability: 250,  foodRestored: 0, foodSaturation: 0 },
  { id: 243, name: 'Gold Shovel',    maxStack: 1, toolType: 'shovel', tier: 3, attackDamage: 1.5, miningSpeed: 12.0, durability: 32,   foodRestored: 0, foodSaturation: 0 },
  { id: 244, name: 'Diamond Shovel', maxStack: 1, toolType: 'shovel', tier: 4, attackDamage: 3.5, miningSpeed: 8.0,  durability: 1561, foodRestored: 0, foodSaturation: 0 },

  // ── Swords ────────────────────────────────────────────────────────────
  { id: 250, name: 'Wooden Sword',  maxStack: 1, toolType: 'sword', tier: 0, attackDamage: 4, miningSpeed: 1.5, durability: 59,   foodRestored: 0, foodSaturation: 0 },
  { id: 251, name: 'Stone Sword',   maxStack: 1, toolType: 'sword', tier: 1, attackDamage: 5, miningSpeed: 1.5, durability: 131,  foodRestored: 0, foodSaturation: 0 },
  { id: 252, name: 'Iron Sword',    maxStack: 1, toolType: 'sword', tier: 2, attackDamage: 6, miningSpeed: 1.5, durability: 250,  foodRestored: 0, foodSaturation: 0 },
  { id: 253, name: 'Gold Sword',    maxStack: 1, toolType: 'sword', tier: 3, attackDamage: 4, miningSpeed: 1.5, durability: 32,   foodRestored: 0, foodSaturation: 0 },
  { id: 254, name: 'Diamond Sword', maxStack: 1, toolType: 'sword', tier: 4, attackDamage: 7, miningSpeed: 1.5, durability: 1561, foodRestored: 0, foodSaturation: 0 },

  // ── Hoes ──────────────────────────────────────────────────────────────
  { id: 260, name: 'Wooden Hoe',  maxStack: 1, toolType: 'hoe', tier: 0, attackDamage: 1, miningSpeed: 2.0,  durability: 59,   foodRestored: 0, foodSaturation: 0 },
  { id: 261, name: 'Stone Hoe',   maxStack: 1, toolType: 'hoe', tier: 1, attackDamage: 1, miningSpeed: 4.0,  durability: 131,  foodRestored: 0, foodSaturation: 0 },
  { id: 262, name: 'Iron Hoe',    maxStack: 1, toolType: 'hoe', tier: 2, attackDamage: 1, miningSpeed: 6.0,  durability: 250,  foodRestored: 0, foodSaturation: 0 },
  { id: 263, name: 'Gold Hoe',    maxStack: 1, toolType: 'hoe', tier: 3, attackDamage: 1, miningSpeed: 12.0, durability: 32,   foodRestored: 0, foodSaturation: 0 },
  { id: 264, name: 'Diamond Hoe', maxStack: 1, toolType: 'hoe', tier: 4, attackDamage: 1, miningSpeed: 8.0,  durability: 1561, foodRestored: 0, foodSaturation: 0 },

  // ── Ranged ────────────────────────────────────────────────────────────
  { id: 270, name: 'Bow', maxStack: 1, toolType: 'bow', tier: 0, attackDamage: 6, miningSpeed: 1, durability: 384, foodRestored: 0, foodSaturation: 0 },
  { id: 620, name: 'P250 Sidearm', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 8, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 621, name: 'MAC-10 / MP9', maxStack: 1, toolType: 'gun', tier: 2, attackDamage: 6, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 622, name: 'AK-47 / M4A1-S', maxStack: 1, toolType: 'gun', tier: 3, attackDamage: 11, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 623, name: 'AWP Phantom', maxStack: 1, toolType: 'gun', tier: 4, attackDamage: 34, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 624, name: 'XM Breacher', maxStack: 1, toolType: 'gun', tier: 3, attackDamage: 5, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 625, name: 'Premier Case Tool', maxStack: 64, toolType: 'material', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 700, name: 'TF2 Scattergun', maxStack: 1, toolType: 'gun', tier: 2, attackDamage: 60, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 701, name: 'TF2 Pistol', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 15, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 702, name: 'TF2 Bat', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 35, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 703, name: 'TF2 Rocket Launcher', maxStack: 1, toolType: 'gun', tier: 3, attackDamage: 90, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 704, name: 'TF2 Shotgun', maxStack: 1, toolType: 'gun', tier: 2, attackDamage: 60, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 705, name: 'TF2 Shovel', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 65, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 706, name: 'TF2 Flamethrower', maxStack: 1, toolType: 'gun', tier: 3, attackDamage: 9, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 707, name: 'TF2 Flare Gun', maxStack: 1, toolType: 'gun', tier: 2, attackDamage: 30, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 708, name: 'TF2 Fire Axe', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 65, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 709, name: 'TF2 Grenade Launcher', maxStack: 1, toolType: 'gun', tier: 3, attackDamage: 100, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 710, name: 'TF2 Stickybomb Launcher', maxStack: 1, toolType: 'gun', tier: 3, attackDamage: 120, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 711, name: 'TF2 Bottle', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 65, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 712, name: 'TF2 Minigun', maxStack: 1, toolType: 'gun', tier: 4, attackDamage: 9, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 713, name: 'TF2 Fists', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 65, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 714, name: 'TF2 Wrench', maxStack: 1, toolType: 'gun', tier: 2, attackDamage: 65, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 715, name: 'TF2 Medi Gun', maxStack: 1, toolType: 'gun', tier: 2, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 716, name: 'TF2 Bonesaw', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 65, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 717, name: 'TF2 Sniper Rifle', maxStack: 1, toolType: 'gun', tier: 4, attackDamage: 50, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 718, name: 'TF2 SMG', maxStack: 1, toolType: 'gun', tier: 2, attackDamage: 8, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 719, name: 'TF2 Kukri', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 65, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 720, name: 'TF2 Revolver', maxStack: 1, toolType: 'gun', tier: 3, attackDamage: 40, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 721, name: 'TF2 Sapper', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 722, name: 'TF2 Knife', maxStack: 1, toolType: 'gun', tier: 1, attackDamage: 40, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },
  { id: 723, name: 'TF2 Syringe Gun', maxStack: 1, toolType: 'gun', tier: 2, attackDamage: 10, miningSpeed: 1, durability: 0, foodRestored: 0, foodSaturation: 0 },

  // ── Food ──────────────────────────────────────────────────────────────
  { id: 280, name: 'Apple',        maxStack: 64, toolType: 'food', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 4,  foodSaturation: 2.4 },
  { id: 281, name: 'Bread',        maxStack: 64, toolType: 'food', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 5,  foodSaturation: 6.0 },
  { id: 282, name: 'Cooked Beef',  maxStack: 64, toolType: 'food', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 8,  foodSaturation: 12.8 },
  { id: 283, name: 'Cooked Pork',  maxStack: 64, toolType: 'food', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 8,  foodSaturation: 12.8 },
  { id: 284, name: 'Cooked Chicken', maxStack: 64, toolType: 'food', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 6, foodSaturation: 7.2 },
  { id: 285, name: 'Golden Apple', maxStack: 64, toolType: 'food', tier: 0, attackDamage: 0, miningSpeed: 1, durability: 0, foodRestored: 4,  foodSaturation: 9.6 },
  ...EXTRA_ITEMS,
];

export class ItemRegistry {
  private static map: Map<number, ItemDef> = new Map();

  static {
    for (const item of ITEMS) {
      this.map.set(item.id, item);
    }
  }

  public static get(id: number): ItemDef | null {
    return this.map.get(id) || null;
  }

  public static getName(id: number): string {
    return this.map.get(id)?.name || `Item #${id}`;
  }

  public static getMaxStack(id: number): number {
    return this.map.get(id)?.maxStack ?? 64;
  }

  public static isTool(id: number): boolean {
    const item = this.map.get(id);
    if (!item) return false;
    return item.durability > 0 || ['pickaxe', 'axe', 'shovel', 'sword', 'hoe', 'bow', 'gun', 'shield'].includes(item.toolType);
  }

  public static isFood(id: number): boolean {
    return this.map.get(id)?.toolType === 'food';
  }

  public static getToolType(id: number): ToolType {
    return this.map.get(id)?.toolType ?? 'none';
  }

  public static getTier(id: number): ToolTier {
    return this.map.get(id)?.tier ?? 0;
  }

  public static getMiningSpeed(id: number): number {
    return this.map.get(id)?.miningSpeed ?? 1;
  }

  public static getAttackDamage(id: number): number {
    return this.map.get(id)?.attackDamage ?? 1;
  }

  public static getFoodRestored(id: number): number {
    return this.map.get(id)?.foodRestored ?? 0;
  }

  public static getAll(): ItemDef[] {
    return Array.from(this.map.values());
  }

  public static isRegisteredItem(id: number): boolean {
    return this.map.has(id);
  }

  /**
   * Some modded item IDs intentionally live in the same numeric space as
   * blocks. Only items registered as toolType:'block' should be treated as
   * placeable/rendered cube items; normal materials, food, tools, armor, etc.
   * must stay as inventory/hand/drop items even if a block with the same ID
   * exists. This fixes the “dropped items look/place like blocks” bug.
   */
  public static shouldRenderAsBlock(id: number): boolean {
    const item = this.map.get(id);
    return !item || item.toolType === 'block';
  }

  public static isPlaceableItem(id: number): boolean {
    const item = this.map.get(id);
    return !item || item.toolType === 'block';
  }

  public static register(def: ItemDef): void {
    this.map.set(def.id, def);
  }

  /** Legacy ID compatibility mapping (old IDs → new IDs) */
  public static legacyCompat(id: number): number {
    const map: Record<number, number> = {
      100: 200, // old Stick -> new Stick
      101: 220, // old Wooden Pickaxe -> new Wooden Pickaxe
      102: 221, // old Stone Pickaxe -> new Stone Pickaxe
      103: 280, // old Apple -> new Apple
    };
    return map[id] ?? id;
  }
}
