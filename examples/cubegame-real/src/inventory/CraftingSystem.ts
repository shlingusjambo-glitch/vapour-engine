// Crafting recipe system — supports 2×2 inventory crafting and 3×3 crafting tables.
// This pass removes fake one-item recipes and rebuilds the list around vanilla Minecraft-style recipes.
// Patterns use null for empty slots and number[] for tag ingredients such as "any planks".

import { EXTRA_BLOCKS, EXTRA_ITEMS, EXTRA_RECIPES } from '../content/FeatureCatalog';
import { CraftingRegistry, type CraftingRecipe as VapourCraftingRecipe } from '@vapour/engine';

export type RecipeIngredient = number | number[] | null;

export interface CraftingRecipe {
  pattern: RecipeIngredient[][];  // rows of columns; null = empty, number[] = any one of the listed IDs
  output: { id: number; count: number };
  shapeless?: boolean;
}

const S = 200;       // Stick
const COAL = 201;    // Coal
const IRON = 202;    // Iron Ingot
const GOLD = 203;    // Gold Ingot
const DIAMOND = 204; // Diamond
const FLINT = 205;
const STRING = 206;
const FEATHER = 207;
const GUNPOWDER = 209;
const WOOL_ITEM = 210;
const ARROW = 211;
const PLANKS = 15;
const STONE = 3;     // CubeGame's mineable stone/cobble block
const LOG = 4;
const SAND = 6;
const GLASS = 11;
const TORCH = 21;
const CRAFTING_TABLE = 22;
const CHEST = 23;
const FURNACE = 24;
const OBSIDIAN = 28;
const REDSTONE_WIRE = 30;
const REDSTONE_TORCH = 31;
const REDSTONE_LAMP = 32;
const WHEAT = 33;
const COAL_BLOCK = 38;

const CORE_BLOCKS: Record<string, number> = {
  'Wood Log': LOG,
  'Wood Planks': PLANKS,
  'Stone': STONE,
  'Cobblestone': STONE,
  'Sand': SAND,
  'Glass': GLASS,
  'Torch': TORCH,
  'Crafting Table': CRAFTING_TABLE,
  'Chest': CHEST,
  'Furnace': FURNACE,
  'Obsidian': OBSIDIAN,
  'Redstone Wire': REDSTONE_WIRE,
  'Redstone Torch': REDSTONE_TORCH,
  'Redstone Lamp': REDSTONE_LAMP,
  'Wheat Crops': WHEAT,
  'Coal Block': COAL_BLOCK,
};

const CORE_ITEMS: Record<string, number> = {
  'Stick': S,
  'Coal': COAL,
  'Iron Ingot': IRON,
  'Gold Ingot': GOLD,
  'Diamond': DIAMOND,
  'Flint': FLINT,
  'String': STRING,
  'Feather': FEATHER,
  'Gunpowder': GUNPOWDER,
  'Wool': WOOL_ITEM,
  'Arrow': ARROW,
  'Raw Beef': 212,
  'Raw Pork': 213,
  'Raw Chicken': 214,
  'Spectral Arrow': 215,
  'Apple': 280,
  'Bread': 281,
  'Golden Apple': 285,
};

const keyFor = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const extraBlockByName = new Map<string, number>();
const extraItemByName = new Map<string, number>();
const outputNameById = new Map<number, string>();
for (const block of EXTRA_BLOCKS) {
  extraBlockByName.set(keyFor(block.name), block.id);
  outputNameById.set(block.id, block.name);
}
for (const item of EXTRA_ITEMS) {
  extraItemByName.set(keyFor(item.name), item.id);
  outputNameById.set(item.id, item.name);
}
for (const [name, id] of Object.entries(CORE_BLOCKS)) outputNameById.set(id, name);
for (const [name, id] of Object.entries(CORE_ITEMS)) outputNameById.set(id, name);

function blockId(name: string): number {
  return CORE_BLOCKS[name] ?? extraBlockByName.get(keyFor(name)) ?? 0;
}

function itemId(name: string): number {
  return CORE_ITEMS[name] ?? extraItemByName.get(keyFor(name)) ?? 0;
}

function unique(ids: number[]): number[] {
  return Array.from(new Set(ids.filter(id => Number.isFinite(id) && id > 0)));
}

function blockIdsMatching(test: (name: string) => boolean): number[] {
  return EXTRA_BLOCKS.filter(b => test(b.name)).map(b => b.id);
}

const ANY_PLANKS = unique([PLANKS, ...blockIdsMatching(name => /\bPlanks$/.test(name))]);
const ANY_LOGS = unique([LOG, ...blockIdsMatching(name => /\bLog$/.test(name))]);
const ANY_WOOL = unique([WOOL_ITEM, ...blockIdsMatching(name => /\bWool$/.test(name))]);
const ANY_WOOD_SLABS = unique(blockIdsMatching(name => /\bSlab$/.test(name) && !/Stone|Brick|Sandstone|Deepslate|Tuff|Mud|Granite|Diorite|Andesite|Blackstone/i.test(name)));
const ANY_STONE_SLABS = unique(blockIdsMatching(name => /\bStone Slab$|\bStone Bricks Slab$|\bBrick Slab$|\bSandstone Slab$/.test(name)));

interface WoodFamily {
  name: string;
  log: number;
  planks: number;
  slab: number;
  stairs: number;
  fence: number;
  gate: number;
  door: number;
  trapdoor: number;
}

function getWoodFamilies(): WoodFamily[] {
  const names = new Set<string>();
  for (const block of EXTRA_BLOCKS) {
    const m = block.name.match(/^(.*) Planks$/);
    if (m) names.add(m[1]);
  }
  const families: WoodFamily[] = [{
    name: 'Wood',
    log: LOG,
    planks: PLANKS,
    slab: blockId('Wood Slab'),
    stairs: blockId('Wood Stairs'),
    fence: blockId('Fence'),
    gate: blockId('Fence Gate'),
    door: blockId('Door'),
    trapdoor: blockId('Trapdoor'),
  }];
  for (const name of names) {
    families.push({
      name,
      log: blockId(`${name} Log`),
      planks: blockId(`${name} Planks`),
      slab: blockId(`${name} Slab`),
      stairs: blockId(`${name} Stairs`),
      fence: blockId(`${name} Fence`),
      gate: blockId(`${name} Fence Gate`),
      door: blockId(`${name} Door`),
      trapdoor: blockId(`${name} Trapdoor`),
    });
  }
  return families.filter(f => f.log && f.planks);
}

const mirrorPattern = (pattern: RecipeIngredient[][]): RecipeIngredient[][] =>
  pattern.map(row => [...row].reverse());

const hasBadId = (pattern: RecipeIngredient[][]): boolean => pattern.flat().some(cell => {
  if (cell === null || cell === undefined) return false;
  if (Array.isArray(cell)) return cell.length === 0 || cell.some(id => !id || id <= 0);
  return !cell || cell <= 0;
});

function buildVanillaRecipes(): CraftingRecipe[] {
  const recipes: CraftingRecipe[] = [];
  const add = (pattern: RecipeIngredient[][], id: number, count = 1, shapeless = false): void => {
    if (!id || id <= 0 || hasBadId(pattern)) return;
    recipes.push({ pattern, output: { id, count }, shapeless });
  };
  const addMirror = (pattern: RecipeIngredient[][], id: number, count = 1): void => {
    add(pattern, id, count);
    const mirrored = mirrorPattern(pattern);
    if (JSON.stringify(mirrored) !== JSON.stringify(pattern)) add(mirrored, id, count);
  };

  // Wood conversion. Each log creates its matching planks. Generic Wood Log -> Wood Planks stays supported.
  for (const family of getWoodFamilies()) {
    add([[family.log]], family.planks, 4, true);
  }

  // Core survival recipes.
  add([[ANY_PLANKS], [ANY_PLANKS]], S, 4);
  add([[ANY_PLANKS, ANY_PLANKS], [ANY_PLANKS, ANY_PLANKS]], CRAFTING_TABLE, 1);
  add([[ANY_PLANKS, ANY_PLANKS, ANY_PLANKS], [ANY_PLANKS, null, ANY_PLANKS], [ANY_PLANKS, ANY_PLANKS, ANY_PLANKS]], CHEST, 1);
  add([[STONE, STONE, STONE], [STONE, null, STONE], [STONE, STONE, STONE]], FURNACE, 1);
  add([[COAL], [S]], TORCH, 4);
  add([[COAL, COAL, COAL], [COAL, COAL, COAL], [COAL, COAL, COAL]], COAL_BLOCK, 1);
  add([[COAL_BLOCK]], COAL, 9, true);

  // Minecraft wood family outputs. Same-family planks create same-family slabs/stairs/doors/etc.
  for (const family of getWoodFamilies()) {
    const p = family.name === 'Wood' ? ANY_PLANKS : family.planks;
    if (family.door) add([[p, p], [p, p], [p, p]], family.door, 3);
    if (family.trapdoor) add([[p, p, p], [p, p, p]], family.trapdoor, 2);
    if (family.slab) add([[p, p, p]], family.slab, 6);
    if (family.stairs) addMirror([[p, null, null], [p, p, null], [p, p, p]], family.stairs, 4);
    // Correct Minecraft recipes: Fence = planks/stick/planks, Gate = stick/planks/stick.
    if (family.fence) add([[p, S, p], [p, S, p]], family.fence, 3);
    if (family.gate) add([[S, p, S], [S, p, S]], family.gate, 1);
  }
  add([[S, null, S], [S, S, S], [S, null, S]], blockId('Ladder'), 3);

  // Common utility/building blocks.
  add([[STONE]], blockId('Button'), 1, true);
  add([[STONE, STONE]], blockId('Pressure Plate'), 1);
  add([[S], [STONE]], blockId('Lever'), 1);
  add([[ANY_WOOL, ANY_WOOL, ANY_WOOL], [ANY_PLANKS, ANY_PLANKS, ANY_PLANKS]], blockId('Bed'), 1);
  if (ANY_WOOD_SLABS.length) add([[ANY_WOOD_SLABS, ANY_WOOD_SLABS, ANY_WOOD_SLABS], [ANY_PLANKS, null, ANY_PLANKS], [ANY_PLANKS, ANY_PLANKS, ANY_PLANKS]], blockId('Barrel'), 1);
  add([[ANY_PLANKS, ANY_PLANKS, ANY_PLANKS], [ANY_PLANKS, null, ANY_PLANKS], [ANY_PLANKS, ANY_PLANKS, ANY_PLANKS]], blockId('Composter'), 1);
  add([[IRON, IRON, IRON], [null, IRON, null], [IRON, IRON, IRON]], blockId('Anvil'), 1);
  add([[IRON], [TORCH]], blockId('Lantern'), 1);
  add([[COAL, null, COAL], [S, S, S], [LOG, LOG, LOG]], blockId('Campfire'), 1);
  add([[WHEAT, WHEAT, WHEAT], [WHEAT, WHEAT, WHEAT], [WHEAT, WHEAT, WHEAT]], blockId('Hay Bale'), 1);
  add([[GUNPOWDER, SAND, GUNPOWDER], [SAND, GUNPOWDER, SAND], [GUNPOWDER, SAND, GUNPOWDER]], blockId('TNT'), 1);
  add([[IRON, IRON], [IRON, IRON], [IRON, IRON]], blockId('Iron Door'), 3);
  add([[IRON, IRON], [IRON, IRON]], blockId('Iron Trapdoor'), 1);
  add([[IRON, null, IRON], [IRON, null, IRON], [IRON, IRON, IRON]], blockId('Cauldron'), 1);
  add([[null, IRON, null], [STONE, STONE, STONE]], blockId('Stonecutter'), 1);
  add([[STRING, STRING], [ANY_PLANKS, ANY_PLANKS]], blockId('Loom'), 1);
  add([[itemId('Paper'), itemId('Paper')], [ANY_PLANKS, ANY_PLANKS]], blockId('Cartography Table'), 1);
  add([[IRON, IRON], [ANY_PLANKS, ANY_PLANKS], [IRON, IRON]], blockId('Smithing Table'), 1);
  add([[IRON, IRON, IRON], [IRON, FURNACE, IRON], [STONE, STONE, STONE]], blockId('Blast Furnace'), 1);
  add([[null, ANY_LOGS, null], [ANY_LOGS, FURNACE, ANY_LOGS], [null, ANY_LOGS, null]], blockId('Smoker'), 1);
  add([[ANY_PLANKS, ANY_PLANKS, ANY_PLANKS], [ANY_PLANKS, REDSTONE_WIRE, ANY_PLANKS], [ANY_PLANKS, ANY_PLANKS, ANY_PLANKS]], blockId('Note Block'), 1);
  add([[ANY_PLANKS, ANY_PLANKS, ANY_PLANKS], [STONE, IRON, STONE], [STONE, REDSTONE_WIRE, STONE]], blockId('Piston'), 1);
  add([[blockId('Piston'), itemId('Slime Gel')]], blockId('Sticky Piston'), 1, true);
  add([[IRON, null, IRON], [IRON, CHEST, IRON], [null, IRON, null]], blockId('Hopper'), 1);
  add([[REDSTONE_TORCH, REDSTONE_WIRE, REDSTONE_TORCH], [STONE, STONE, STONE]], blockId('Redstone Repeater (Off)'), 1);
  add([[REDSTONE_TORCH, itemId('Quartz'), REDSTONE_TORCH], [STONE, STONE, STONE]], blockId('Redstone Comparator (Off)'), 1);
  add([[blockId('Lever'), CHEST]], blockId('Trapped Chest'), 1, true);
  add([[itemId('Book'), itemId('Book'), itemId('Book')], [null, S, null], [ANY_PLANKS, ANY_PLANKS, ANY_PLANKS]], blockId('Lectern'), 1);
  add([[itemId('Copper Ingot')], [itemId('Copper Ingot')], [itemId('Copper Ingot')]], blockId('Lightning Rod'), 1);

  // Blocks from materials and back again, using Minecraft-style 3×3 storage recipes.
  const storageBlocks: Array<[number, number, number]> = [
    [blockId('Iron Block'), IRON, 9], [blockId('Gold Block'), GOLD, 9], [blockId('Copper Block'), itemId('Copper Ingot'), 9],
    [blockId('Emerald Block'), itemId('Emerald'), 9], [blockId('Lapis Block'), itemId('Lapis Lazuli'), 9], [blockId('Redstone Block'), itemId('Redstone Dust'), 9],
    [blockId('Amethyst Block'), itemId('Amethyst Shard'), 4], [blockId('Coal Block') || COAL_BLOCK, COAL, 9],
  ];
  for (const [block, material, n] of storageBlocks) {
    if (!block || !material) continue;
    const row = [material, material, material];
    if (n === 4) add([[material, material], [material, material]], block, 1);
    else add([row, row, row], block, 1);
    add([[block]], material, n, true);
  }

  // Tools — correct Minecraft shapes.
  const toolSets: Array<[string, RecipeIngredient, number, number, number, number, number]> = [
    ['Wooden', ANY_PLANKS, 220, 230, 240, 250, 260],
    ['Stone', STONE, 221, 231, 241, 251, 261],
    ['Iron', IRON, 222, 232, 242, 252, 262],
    ['Gold', GOLD, 223, 233, 243, 253, 263],
    ['Diamond', DIAMOND, 224, 234, 244, 254, 264],
  ];
  for (const [, material, pickaxe, axe, shovel, sword, hoe] of toolSets) {
    add([[material, material, material], [null, S, null], [null, S, null]], pickaxe, 1);
    addMirror([[material, material, null], [material, S, null], [null, S, null]], axe, 1);
    add([[material], [S], [S]], shovel, 1);
    add([[material], [material], [S]], sword, 1);
    addMirror([[material, material, null], [null, S, null], [null, S, null]], hoe, 1);
  }

  // Extra tools generated by FeatureCatalog, if present.
  const extraToolMaterials: Array<[string, RecipeIngredient]> = [
    ['Copper', itemId('Copper Ingot')], ['Tin', itemId('Tin Ingot')], ['Silver', itemId('Silver Ingot')], ['Emerald', itemId('Emerald')],
    ['Ruby', itemId('Ruby')], ['Sapphire', itemId('Sapphire')], ['Ancient', itemId('Ancient Alloy Ingot')],
  ];
  for (const [name, material] of extraToolMaterials) {
    const pick = itemId(`${name} Pickaxe`), axe = itemId(`${name} Axe`), shovel = itemId(`${name} Shovel`), sword = itemId(`${name} Sword`), hoe = itemId(`${name} Hoe`);
    if (!material) continue;
    add([[material, material, material], [null, S, null], [null, S, null]], pick, 1);
    addMirror([[material, material, null], [material, S, null], [null, S, null]], axe, 1);
    add([[material], [S], [S]], shovel, 1);
    add([[material], [material], [S]], sword, 1);
    addMirror([[material, material, null], [null, S, null], [null, S, null]], hoe, 1);
  }

  // Armor — Minecraft shapes.
  const armorSets: Array<[string, RecipeIngredient]> = [
    ['Leather', itemId('Leather')], ['Iron', IRON], ['Gold', GOLD], ['Diamond', DIAMOND],
    ['Copper', itemId('Copper Ingot')], ['Ancient', itemId('Ancient Alloy Ingot')],
  ];
  for (const [name, mat] of armorSets) {
    if (!mat) continue;
    add([[mat, mat, mat], [mat, null, mat]], itemId(`${name} Helmet`), 1);
    add([[mat, null, mat], [mat, mat, mat], [mat, mat, mat]], itemId(`${name} Chestplate`), 1);
    add([[mat, mat, mat], [mat, null, mat], [mat, null, mat]], itemId(`${name} Leggings`), 1);
    add([[mat, null, mat], [mat, null, mat]], itemId(`${name} Boots`), 1);
  }

  // Combat/tools/food/misc.
  add([[null, S, STRING], [S, null, STRING], [null, S, STRING]], 270, 1); // Bow
  add([[S, S, S], [STRING, null, STRING], [S, S, S]], itemId('Crossbow'), 1);
  add([[ANY_PLANKS, ANY_PLANKS, ANY_PLANKS], [ANY_PLANKS, IRON, ANY_PLANKS], [null, ANY_PLANKS, null]], itemId('Shield'), 1);
  add([[IRON, null], [IRON, IRON]], itemId('Shears'), 1);
  add([[FLINT, IRON]], itemId('Flint and Steel'), 1, true);
  add([[IRON, IRON, IRON], [IRON, null, IRON], [IRON, IRON, IRON]], itemId('Bucket'), 1);
  add([[S, S, S], [null, STRING, null], [null, STRING, null]], itemId('Fishing Rod'), 1);
  add([[STRING, STRING], [STRING, itemId('Slime Gel')]], itemId('Lead'), 2);
  add([[S, FLINT, FEATHER]], ARROW, 4, true);
  add([[WHEAT, WHEAT, WHEAT]], 281, 1); // Bread
  add([[GOLD, GOLD, GOLD], [GOLD, 280, GOLD], [GOLD, GOLD, GOLD]], 285, 1); // Golden Apple
  add([[itemId('Carrot'), GOLD]], itemId('Golden Carrot'), 1, true);
  add([[blockId('Pumpkin'), itemId('Sugar'), itemId('Egg')]], itemId('Pumpkin Pie'), 1, true);
  add([[blockId('Sugar Cane')]], itemId('Sugar'), 1, true);
  add([[blockId('Sugar Cane'), blockId('Sugar Cane'), blockId('Sugar Cane')]], itemId('Paper'), 3);
  add([[itemId('Paper'), itemId('Paper'), itemId('Paper')], [itemId('Paper'), itemId('Leather'), itemId('Paper')], [itemId('Paper'), itemId('Paper'), itemId('Paper')]], itemId('Book'), 1);
  add([[IRON, REDSTONE_WIRE, IRON], [REDSTONE_WIRE, itemId('Lapis Lazuli') || DIAMOND, REDSTONE_WIRE], [IRON, REDSTONE_WIRE, IRON]], itemId('Compass'), 1);
  add([[GOLD, GOLD, GOLD], [GOLD, REDSTONE_WIRE, GOLD], [GOLD, GOLD, GOLD]], itemId('Clock'), 1);
  add([[blockId('Pumpkin')]], itemId('Pumpkin Seeds'), 4, true);
  add([[blockId('Melon')]], itemId('Melon Seeds'), 4, true);

  // Stone/brick families added by FeatureCatalog. These are vanilla-style 4-block, slab, stair, and wall recipes.
  for (const base of EXTRA_BLOCKS) {
    const name = base.name;
    if (/^(Polished |Cut |Chiseled )/.test(name)) continue;
    const polished = blockId(`Polished ${name}`);
    const bricks = blockId(`${name} Bricks`);
    const slab = blockId(`${name} Slab`);
    const stairs = blockId(`${name} Stairs`);
    const wall = blockId(`${name} Wall`);
    if (polished) add([[base.id, base.id], [base.id, base.id]], polished, 4);
    if (bricks) add([[base.id, base.id], [base.id, base.id]], bricks, 4);
    if (slab) add([[base.id, base.id, base.id]], slab, 6);
    if (stairs) addMirror([[base.id, null, null], [base.id, base.id, null], [base.id, base.id, base.id]], stairs, 4);
    if (wall) add([[base.id, base.id, base.id], [base.id, base.id, base.id]], wall, 6);
  }

  // Keep only safe extra recipes that are already Minecraft-shaped and not fake one-material shortcuts.
  const standardOutputNames = new Set(recipes.map(r => r.output.id));
  for (const recipe of EXTRA_RECIPES) {
    if (!recipe.output?.id || standardOutputNames.has(recipe.output.id) || hasBadId(recipe.pattern)) continue;
    if (!isSafeExtraRecipe(recipe)) continue;
    recipes.push({
      pattern: recipe.pattern.map(row => row.map(cell => cell ?? null)),
      output: { ...recipe.output },
      shapeless: !!recipe.shapeless,
    });
  }

  return recipes;
}

function isSafeExtraRecipe(recipe: CraftingRecipe): boolean {
  const outputName = outputNameById.get(recipe.output.id) ?? '';
  const ingredientCount = recipe.pattern.flat().filter(v => v !== null && v !== 0).length;

  // Drop fake/generated recipes such as "one stick -> Breeze Rod", "book -> Books block", or food/stew spam.
  if (ingredientCount <= 1 && !/Planks$|Ingot$|Block$|Seeds$|Sugar$|Paper$|Dye$/.test(outputName)) return false;
  if (/\bPotion$|Music Disc|Tome of|Smithing Template|Pottery Sherd|Banner Pattern|Breeze Rod|Wind Charge|Echo Shard|Resin|Rune Lantern|Stew$/.test(outputName)) return false;

  // Keep structural / vanilla-like recipes that this game actually has blocks/items for.
  return /Planks$|Slab$|Stairs$|Fence$|Fence Gate$|Door$|Trapdoor$|Wall$|Pane$|Bars$|Block$|Helmet$|Chestplate$|Leggings$|Boots$|Pickaxe$|Axe$|Shovel$|Sword$|Hoe$|Torch$|Lantern$|Campfire|Hay Bale|TNT|Button|Pressure Plate|Lever|Bookshelf|Barrel|Composter|Anvil|Enchanting Table|Brewing Stand|Smithing Table|Crossbow|Shield|Shears|Flint and Steel|Bucket|Fishing Rod|Spyglass|Lead|Fire Charge|Sugar$|Paper$|Map$|Book$|Compass|Clock|Arrow$|Pie$|Cookie$|Golden Carrot|Seeds$|Repeater|Comparator|Piston|Observer|Hopper|Daylight Detector|Target Block|Note Block|Trapped Chest|Lectern|Lightning Rod|Slime Block|Honey Block|Cauldron|Stonecutter|Loom|Cartography Table|Blast Furnace|Smoker|Banner$/.test(outputName);
}

function ingredientOptions(ingredient: RecipeIngredient): number[] {
  if (ingredient === null || ingredient === undefined || ingredient === 0) return [];
  return Array.isArray(ingredient) ? ingredient.filter(Boolean) : [ingredient];
}

function ingredientLabel(ingredient: RecipeIngredient): string {
  const opts = ingredientOptions(ingredient);
  if (opts.length === 0) return 'Empty';
  if (arraySameSet(opts, ANY_PLANKS)) return 'Any Planks';
  if (arraySameSet(opts, ANY_LOGS)) return 'Any Log';
  if (arraySameSet(opts, ANY_WOOL)) return 'Any Wool';
  if (arraySameSet(opts, ANY_WOOD_SLABS)) return 'Any Wood Slab';
  if (arraySameSet(opts, ANY_STONE_SLABS)) return 'Any Stone Slab';
  if (opts.length > 1) return `Any of ${opts.length}`;
  return outputNameById.get(opts[0]) ?? `Item #${opts[0]}`;
}

function arraySameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(v => s.has(v));
}

function recipeSignature(recipe: CraftingRecipe): string {
  const shape = recipe.pattern.map(row => row.map(cell => ingredientOptions(cell).join('|') || '_').join(',')).join('/');
  return `${recipe.shapeless ? 's' : 'p'}:${shape}->${recipe.output.id}x${recipe.output.count}`;
}

export class CraftingSystem {
  private static recipes: CraftingRecipe[] = (() => {
    const seen = new Set<string>();
    const out: CraftingRecipe[] = [];
    for (const recipe of buildVanillaRecipes()) {
      const sig = recipeSignature(recipe);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(recipe);
    }
    return out;
  })();
  private static readonly registry = (() => {
    const registry = new CraftingRegistry<number, { id: number; count: number }>();
    for (let index = 0; index < CraftingSystem.recipes.length; index++) {
      registry.register(CraftingSystem.toEngineRecipe(CraftingSystem.recipes[index], `cubegame:${index}`));
    }
    return registry;
  })();
  private static registeredRecipeCount = 0;

  public static register(recipe: CraftingRecipe): void {
    if (!recipe?.pattern?.length || !recipe.output || hasBadId(recipe.pattern)) return;
    const stored = {
      pattern: recipe.pattern.map(row => row.map(cell => Array.isArray(cell) ? [...cell] : (cell ?? null))),
      output: { ...recipe.output },
      shapeless: !!recipe.shapeless,
    };
    this.recipes.push(stored);
    this.registry.register(this.toEngineRecipe(stored, `cubegame:registered:${this.registeredRecipeCount++}`));
  }

  public static registerShaped(recipe: CraftingRecipe): void {
    this.register({ ...recipe, shapeless: false });
  }

  public static registerShapeless(recipe: { ingredients: Array<number | number[]>; output: { id: number; count: number } }): void {
    this.register({
      pattern: [recipe.ingredients],
      output: { ...recipe.output },
      shapeless: true,
    });
  }

  public static checkRecipe(gridIds: (number | null)[]): { id: number; count: number } | null {
    const gridSize = gridIds.length === 4 ? 2 : 3;
    return this.registry.match(gridIds, gridSize, gridSize)?.output ?? null;
  }

  public static craft<TStack extends { id: number; count: number }>(grid: readonly (TStack | null)[]) {
    const gridSize = grid.length === 4 ? 2 : 3;
    return this.registry.craft(grid, gridSize, gridSize);
  }

  public static getRecipes(): CraftingRecipe[] {
    return this.recipes.map(recipe => ({
      pattern: recipe.pattern.map(row => row.map(cell => Array.isArray(cell) ? [...cell] : (cell ?? null))),
      output: { ...recipe.output },
      shapeless: recipe.shapeless,
    }));
  }

  public static recipeFitsGrid(recipe: CraftingRecipe, gridSize: 2 | 3): boolean {
    return this.registry.fits(this.toEngineRecipe(recipe, 'query'), gridSize, gridSize);
  }

  public static getIngredientCounts(recipe: CraftingRecipe): Map<RecipeIngredient, number> {
    const counts = new Map<RecipeIngredient, number>();
    const keys: RecipeIngredient[] = [];
    const sameKey = (a: RecipeIngredient, b: RecipeIngredient): boolean => {
      const ao = ingredientOptions(a);
      const bo = ingredientOptions(b);
      return ao.length === bo.length && ao.every(id => bo.includes(id));
    };
    for (const ing of recipe.pattern.flat()) {
      if (!ing || (Array.isArray(ing) && ing.length === 0)) continue;
      const existing = keys.find(k => sameKey(k, ing));
      if (existing) counts.set(existing, (counts.get(existing) ?? 0) + 1);
      else {
        const key = Array.isArray(ing) ? [...ing] : ing;
        keys.push(key);
        counts.set(key, 1);
      }
    }
    return counts;
  }

  public static getIngredientLabel(ingredient: RecipeIngredient): string {
    return ingredientLabel(ingredient);
  }

  public static getDisplayIngredientId(ingredient: RecipeIngredient): number | null {
    return ingredientOptions(ingredient)[0] ?? null;
  }

  public static canCraftFromCounts(recipe: CraftingRecipe, counts: Map<number, number>, gridSize: 2 | 3): boolean {
    if (!this.recipeFitsGrid(recipe, gridSize)) return false;
    return this.registry.planFromCounts(this.toEngineRecipe(recipe, 'query'), counts) !== null;
  }

  private static toEngineRecipe(recipe: CraftingRecipe, id: string): VapourCraftingRecipe<number, { id: number; count: number }> {
    return { id, pattern: recipe.pattern, output: recipe.output, ...(recipe.shapeless !== undefined ? { shapeless: recipe.shapeless } : {}) };
  }
}
