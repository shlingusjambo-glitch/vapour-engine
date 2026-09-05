# Crystal Expansion — Example Mod

A self-contained, fully working example mod for **CubeGame** that demonstrates
all core modding APIs: blocks, items, crafting recipes, biomes, dimensions, textures,
and events.

---

## What This Mod Adds

| Content | Name | Description |
|---|---|---|
| **Block** | Crystal Block | Glowing translucent stone, generates in geodes |
| **Item** | Crystal Shard | Raw material dropped by Crystal Block |
| **Item** | Crystal Wand | Diamond-tier sword that spawns sparkle particles |
| **Recipe** | Crystal Block | 4 shards in 2×2 grid |
| **Recipe** | Crystal Wand | Shaped 3×3 recipe using 3 shards + 2 sticks |
| **Recipe** | Shard Break-down | Shapeless: 1 Crystal Block → 4 Crystal Shards |
| **Biome** | Crystal Caves | Underground biome with Crystal Block geodes |
| **Dimension** | Crystal Realm | A flat crystal-floor dimension |

---

## Folder Structure

```text
mods/
└── example_mod/
    ├── mod.ts            ← Entry point (compiled to ES module by server)
    ├── README.md         ← This file
    └── assets/
        ├── crystal_block.png   ← 16×16 block texture (atlas tile 150)
        ├── crystal_shard.png   ← 32×32 item icon for Crystal Shard
        └── crystal_wand.png    ← 32×32 item icon for Crystal Wand
```

> **Note:** The `assets/` folder and PNG files must be created manually.
> They are served by the Express server under `/api/mods/example_mod/assets/`.

---

## Installation

1. Copy the entire `example_mod/` directory into your `mods/` folder (it may
   already be there if you cloned the repository).
2. Add your PNG assets to `mods/example_mod/assets/`.
3. Start the CubeGame server — it automatically discovers and loads any mod
   whose folder contains a `mod.ts` file.
4. Check the server console for:
   ```
   ╔═══════════════════════════════════════╗
   ║   CRYSTAL EXPANSION MOD  v1.0.0       ║
   ╚═══════════════════════════════════════╝
   ```

---

## Crafting Recipes

### Crystal Block
```
[Shard][Shard]
[Shard][Shard]
→ Crystal Block ×1
```

### Crystal Wand
```
[Shard][Shard][    ]
[    ][Shard][Stick]
[    ][    ][Stick]
→ Crystal Wand ×1
```

### Crystal Block Break-down (shapeless)
```
[Crystal Block] → Crystal Shard ×4
```

---

## Gameplay Mechanics

- **Crystal Block** emits a light level of **6** (like a faint torch).
- Requires at least an **iron pickaxe** (tier 2) to harvest — wooden or stone
  picks will not yield a drop.
- **Crystal Wand** swings emit **cyan sparkles** in the direction you are
  facing, making it easy to spot enemies you just hit.
- Placing a Crystal Block broadcasts a chat message to all players on the
  server.

---

## Extending This Mod

```typescript
// Add a smelting recipe: Crystal Shard → Crystal Ingot
api.SmeltingRegistry.register({
  input:    CRYSTAL_SHARD_ITEM_ID,
  output:   MY_CRYSTAL_INGOT_ID,
  xp:       1.2,
  cookTime: 200,
});

// Listen for inventory changes
api.EventBus.on('player:inventoryChanged', (slot: number, itemId: number) => {
  console.log(`Slot ${slot} is now item ${itemId}`);
});

// Trigger custom network packet
api.Network.sendCustomPacket('example_mod:ping', { timestamp: Date.now() });
api.Network.onCustomPacket('example_mod:pong', (data) => {
  console.log('Received pong:', data);
});
```

---

## ID Allocations Used By This Mod

| Type | ID | Name |
|---|---|---|
| Block | 150 | Crystal Block |
| Item | 500 | Crystal Shard |
| Item | 501 | Crystal Wand |
| Biome | `example_mod:crystal_caves` | Crystal Caves |
| Dimension | `example_mod:crystal_realm` | Crystal Realm |

If you are writing your own mod, choose different IDs.
The recommended ranges for community mods are:
- **Blocks:** 200–999
- **Items:** 1000–9999
- **Biomes/Dimensions:** use namespaced string IDs (`yourname:identifier`)

---

## License

MIT — do whatever you want with this example.
