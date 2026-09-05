/**
 * example_mod/mod.ts
 *
 * Crystal Expansion — A fully working example mod for CubeGame.
 *
 * Demonstrates:
 *  1. Custom texture registration (block atlas + item icon)
 *  2. Custom Block registration (Crystal Block)
 *  3. Custom Item registration (Crystal Shard + Crystal Wand)
 *  4. Shaped crafting recipe
 *  5. Biome registration (Crystal Caves)
 *  6. EventBus hooks (particles + audio on wand swing)
 *  7. Custom dimension registration (Crystal Realm)
 */

// ─── ID Space ────────────────────────────────────────────────────────────────
// Blocks 100-199 are reserved for mods.  We start at 150 to leave room.
const CRYSTAL_BLOCK_ID  = 150;

// Items 300-399 are core game.  Mod items start at 500+ to avoid conflicts.
const CRYSTAL_SHARD_ITEM_ID = 500;
const CRYSTAL_WAND_ITEM_ID  = 501;

// ─── Entry Point ─────────────────────────────────────────────────────────────
export default function init(api: CubeGameAPI): void {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║   CRYSTAL EXPANSION MOD  v1.0.0       ║');
  console.log('╚═══════════════════════════════════════╝');

  // ── Step 1: Register Textures ─────────────────────────────────────────────
  // The server hosts mod assets under /api/mods/<folder-name>/assets/
  api.TextureGenerator.registerModTexture(
    CRYSTAL_BLOCK_ID,
    '/api/mods/example_mod/assets/crystal_block.png'
  );
  api.TextureGenerator.registerCustomIcon(
    CRYSTAL_SHARD_ITEM_ID,
    '/api/mods/example_mod/assets/crystal_shard.png'
  );
  api.TextureGenerator.registerCustomIcon(
    CRYSTAL_WAND_ITEM_ID,
    '/api/mods/example_mod/assets/crystal_wand.png'
  );

  // ── Step 2: Register Custom Block ─────────────────────────────────────────
  api.BlockRegistry.register({
    id:            CRYSTAL_BLOCK_ID,
    name:          'Crystal Block',
    isSolid:       true,
    isTransparent: true,   // light passes through, partially see-through
    isWater:       false,
    isFoliage:     false,
    breakTime:     2.5,
    stepSound:     'stone',
    textures:      CRYSTAL_BLOCK_ID, // maps to atlas tile index 150
    requiresTool:  'pickaxe',
    minTier:       2,          // iron pickaxe or better
    drops:         CRYSTAL_SHARD_ITEM_ID, // drops 1 Crystal Shard
    lightLevel:    6,          // faint cyan glow
    isInteractable: false,
  });

  // ── Step 3: Register Items ────────────────────────────────────────────────

  // Raw crystal shard — stackable crafting material
  api.ItemRegistry.register({
    id:             CRYSTAL_SHARD_ITEM_ID,
    name:           'Crystal Shard',
    maxStack:       64,
    toolType:       'material',
    tier:           0,
    attackDamage:   0,
    miningSpeed:    1.0,
    durability:     0,
    foodRestored:   0,
    foodSaturation: 0,
  });

  // Crystal Wand — an exotic melee weapon / utility item
  api.ItemRegistry.register({
    id:             CRYSTAL_WAND_ITEM_ID,
    name:           'Crystal Wand',
    maxStack:       1,
    toolType:       'sword',  // treated as a melee weapon
    tier:           3,        // gold-tier (fast, moderate durability)
    attackDamage:   6.5,      // 3.25 hearts
    miningSpeed:    1.5,
    durability:     512,
    foodRestored:   0,
    foodSaturation: 0,
  });

  // ── Step 4: Register Crafting Recipe ──────────────────────────────────────
  //
  // Crystal Wand recipe (3×3 shaped):
  //
  //   [ Shard ] [ Shard ] [       ]
  //   [       ] [ Shard ] [ Stick ]
  //   [       ] [       ] [ Stick ]
  //
  api.CraftingRegistry.registerShaped({
    pattern: [
      [CRYSTAL_SHARD_ITEM_ID, CRYSTAL_SHARD_ITEM_ID, null],
      [null,                   CRYSTAL_SHARD_ITEM_ID, 200 ],  // 200 = Stick
      [null,                   null,                  200 ],
    ],
    output: { id: CRYSTAL_WAND_ITEM_ID, count: 1 },
  });

  // Crystal Block from 4 Crystal Shards (2×2)
  api.CraftingRegistry.registerShaped({
    pattern: [
      [CRYSTAL_SHARD_ITEM_ID, CRYSTAL_SHARD_ITEM_ID],
      [CRYSTAL_SHARD_ITEM_ID, CRYSTAL_SHARD_ITEM_ID],
    ],
    output: { id: CRYSTAL_BLOCK_ID, count: 1 },
  });

  // Crystal Block → 4 Crystal Shards (shapeless break-down)
  api.CraftingRegistry.registerShapeless({
    ingredients: [CRYSTAL_BLOCK_ID],
    output: { id: CRYSTAL_SHARD_ITEM_ID, count: 4 },
  });

  // ── Step 5: Register a Custom Biome ──────────────────────────────────────
  api.BiomeRegistry.register({
    id:                   'example_mod:crystal_caves',
    name:                 'Crystal Caves',
    temperature:          0.5,
    humidity:             0.3,
    fogColor:             0x88ccff,   // soft cyan atmospheric fog
    skyColor:             0x1a2255,   // deep blue sky
    waterColor:           0x3399ff,
    grassColor:           0x44cc88,
    foliageColor:         0x33bb77,
    // Surface fill for the biome
    surfaceBlock:         3,          // Stone
    subsurfaceBlock:      3,
    bedrockBlock:         35,
    // Crystal Blocks generate in large geodes underground
    features: [
      {
        type:       'geode',
        block:      CRYSTAL_BLOCK_ID,
        outerBlock: 3,               // stone shell
        minY:       -40,
        maxY:       20,
        chance:     0.02,            // 2% of chunks
        minRadius:  4,
        maxRadius:  9,
      },
    ],
    structures: [],
    spawnRates:  { passive: 10, hostile: 4 },
  });

  // ── Step 6: Register a Custom Dimension ──────────────────────────────────
  api.DimensionRegistry.register({
    id:          'example_mod:crystal_realm',
    name:        'Crystal Realm',
    ambientLight: 0.4,              // moderately bright even without torches
    hasSkylight:  false,            // no natural day/night cycle
    bedWorks:     false,            // bed explodes (like the Nether)
    generator: (chunkX: number, chunkZ: number, setSurface: SetSurfaceFn) => {
      // Custom chunk generator: flat crystal plain at y=64
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
          setSurface(x, 63, z, CRYSTAL_BLOCK_ID);  // crystal floor
          setSurface(x, 62, z, 3);                  // stone sub-layer
          setSurface(x, 61, z, 35);                 // bedrock
        }
      }
    },
  });

  // ── Step 7: Register a Shader Pack (.ts mod shader) ──────────────────────
  api.ShaderPacks.register({
    id: 'example_mod:crystal_calm',
    name: 'Crystal Calm Shader',
    enabled: true,
    bloom: true,
    saturation: 0.92,
    gradeStrength: 0.62,
    exposure: 0.93,
    pixelRatioCap: 1.25,
  });

  // ── Step 8: Register a Structure Definition ──────────────────────────────
  api.StructureRegistry.register({
    id: 'example_mod:crystal_shrine',
    name: 'Crystal Shrine',
    minY: 40,
    maxY: 78,
    chance: 0.008,
    biomes: ['example_mod:crystal_caves'],
    place(ctx: any) {
      // ctx.setBlock(x, y, z, blockId) is the recommended shape for structure contexts.
      for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) ctx.setBlock?.(x, 0, z, CRYSTAL_BLOCK_ID);
      }
      ctx.setBlock?.(0, 1, 0, 21); // torch/glow on top
    },
  });

  // ── Step 9: Networking Channel ───────────────────────────────────────────
  api.NetworkRegistry.on('example_mod:wand_ping', (payload: any, sender: any) => {
    console.log('[CrystalMod] Network packet received:', payload, sender);
  });

  // ── Step 10: Hook into Gameplay Events ────────────────────────────────────

  // Trigger sparkly cyan particles whenever the Crystal Wand is swung
  api.EventBus.on('player:attack', () => {
    const player = (window as any).gamePlayerController;
    if (!player) return;

    if (player.getHeldItemId() !== CRYSTAL_WAND_ITEM_ID) return;

    const camCtrl = (window as any).gameCameraController;
    const dir = camCtrl?.getDirection?.() ?? new api.THREE.Vector3(0, 0, -1);

    const spawnPos = player.position
      .clone()
      .add(new api.THREE.Vector3(0, player.eyeHeight ?? 1.6, 0))
      .add(dir.multiplyScalar(1.5));

    // Emit cyan sparkles (particle type 11 = light blue)
    api.EventBus.emit('particles:spawn', spawnPos, 11, 18);
    api.AudioManager.playPlayerHit();
    console.log('[CrystalMod] Crystal Wand activated — sparkles!');
  });

  // When a Crystal Block is placed, broadcast a chat notification
  api.EventBus.on('world:blockChanged', (data: { x: number; y: number; z: number; blockId: number }) => {
    if (data.blockId === CRYSTAL_BLOCK_ID) {
      api.EventBus.emit('chat:send', `✨ A Crystal Block was placed at (${data.x}, ${data.y}, ${data.z})!`);
    }
  });

  console.log('╔═══════════════════════════════════════╗');
  console.log('║   CRYSTAL EXPANSION LOADED! ✓         ║');
  console.log('╚═══════════════════════════════════════╝');
}

// ─── Type Helpers ─────────────────────────────────────────────────────────────
// These mirror the real CubeGameAPI types. When consuming the API object
// passed to init(), TypeScript is happy because we are not importing from
// internal game modules — we just describe the shape here.

type SetSurfaceFn = (x: number, y: number, z: number, blockId: number) => void;

interface BlockRegistration {
  id: number;
  name: string;
  isSolid: boolean;
  isTransparent: boolean;
  isWater: boolean;
  isFoliage: boolean;
  breakTime: number;
  stepSound: 'grass' | 'stone' | 'wood' | 'sand' | 'water' | 'none';
  textures: number | [number, number, number, number, number, number];
  requiresTool?: 'pickaxe' | 'axe' | 'shovel';
  minTier?: number;
  drops?: number | number[] | null;
  lightLevel?: number;
  isInteractable?: boolean;
}

interface ItemRegistration {
  id: number;
  name: string;
  maxStack: number;
  toolType: string;
  tier: number;
  attackDamage: number;
  miningSpeed: number;
  durability: number;
  foodRestored: number;
  foodSaturation: number;
}

interface ShapedRecipe {
  pattern: (number | null)[][];
  output: { id: number; count: number };
}

interface ShapelessRecipe {
  ingredients: number[];
  output: { id: number; count: number };
}

interface BiomeFeature {
  type: string;
  block: number;
  outerBlock?: number;
  minY: number;
  maxY: number;
  chance: number;
  minRadius?: number;
  maxRadius?: number;
}

interface BiomeRegistration {
  id: string;
  name: string;
  temperature: number;
  humidity: number;
  fogColor: number;
  skyColor: number;
  waterColor: number;
  grassColor: number;
  foliageColor: number;
  surfaceBlock: number;
  subsurfaceBlock: number;
  bedrockBlock: number;
  features: BiomeFeature[];
  structures: string[];
  spawnRates: { passive: number; hostile: number };
}

interface DimensionRegistration {
  id: string;
  name: string;
  ambientLight: number;
  hasSkylight: boolean;
  bedWorks: boolean;
  generator: (chunkX: number, chunkZ: number, setSurface: SetSurfaceFn) => void;
}

interface CubeGameAPI {
  BlockRegistry:   { register: (cfg: BlockRegistration) => void };
  ItemRegistry:    { register: (def: ItemRegistration) => void };
  CraftingRegistry: {
    registerShaped:    (recipe: ShapedRecipe) => void;
    registerShapeless: (recipe: ShapelessRecipe) => void;
  };
  BiomeRegistry:    { register: (biome: BiomeRegistration) => void };
  DimensionRegistry:{ register: (dim: DimensionRegistration) => void };
  StructureRegistry:{ register: (structure: any) => void; getAll: () => any[] };
  NetworkRegistry:{ on: (channel: string, cb: (payload: any, sender?: any) => void) => void; emit: (channel: string, payload: any) => void };
  ShaderPacks: { register: (pack: any) => void; getAll: () => any[] };
  TextureGenerator: {
    registerModTexture:  (index: number, src: string) => void;
    registerCustomIcon:  (itemId: number, src: string) => void;
  };
  EventBus: {
    on:   (event: string, cb: (...args: any[]) => void) => void;
    emit: (event: string, ...args: any[]) => void;
  };
  AudioManager: {
    playStep:       (type: string) => void;
    playBreak:      (type: string) => void;
    playPlace:      (type: string) => void;
    playPlayerHit:  () => void;
    playItemPickup: () => void;
  };
  THREE: typeof import('three');
}
