import { SaveDatabase } from '@vapour/engine';

export interface SavedChunkData {
  key: string;
  modifications: { [index: number]: number };
}

export interface WorldMeta {
  id: string;
  name: string;
  seed: string;
  createdAt: number;
  lastPlayed: number;
  preset?: string;
  playtime?: number;
}

export class StorageManager {
  private static database = new SaveDatabase<'world' | 'chunks' | 'inventory' | 'worlds'>({
    name: 'VoxelSandboxDB_v1',
    version: 3,
    stores: ['world', 'chunks', 'inventory', 'worlds'],
    openTimeoutMilliseconds: 1800,
    diagnostic: (message, error) => console.warn(message, error ?? ''),
  });
  public static currentWorldId: string = 'world_default';
  public static shouldDisableInventoryPersistence: boolean = false;

  public static setCurrentWorld(worldId: string): void {
    this.currentWorldId = worldId;
  }

  public static getCurrentWorld(): string {
    return this.currentWorldId;
  }

  public static init(): Promise<void> {
    return this.database.open();
  }

  // ── World management ─────────────────────────────────────────────────────

  public static listWorlds(): Promise<WorldMeta[]> {
    return this.getAll<WorldMeta>('worlds');
  }

  public static async getWorld(worldId: string): Promise<WorldMeta | null> {
    return this.get<WorldMeta>('worlds', worldId).then(v => v || null);
  }

  public static async createWorld(name: string, seed: string, preset?: string): Promise<WorldMeta> {
    const id = `world_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const meta: WorldMeta = {
      id,
      name,
      seed,
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      preset,
      playtime: 0
    };
    await this.put('worlds', id, meta);
    return meta;
  }

  public static async updateWorldMeta(worldId: string, patch: Partial<WorldMeta>): Promise<void> {
    const meta = await this.get<WorldMeta>('worlds', worldId);
    if (meta) {
      Object.assign(meta, patch, { id: worldId });
      await this.put('worlds', worldId, meta);
    }
  }

  public static async deleteWorld(worldId: string): Promise<void> {
    await this.deleteKey('worlds', worldId);
    const prefix = `${worldId}::`;
    await Promise.all([
      this.database.deletePrefix('chunks', prefix),
      this.database.deletePrefix('world', prefix),
      this.database.deletePrefix('inventory', prefix),
    ]);
  }

  // ── World-scoped data (seed, player pos, etc.) ───────────────────────────

  public static setWorldData(key: string, value: any): Promise<void> {
    return this.put('world', `${this.currentWorldId}::${key}`, value);
  }

  public static getWorldData<T>(key: string, defaultValue: T): Promise<T> {
    return this.get<T>('world', `${this.currentWorldId}::${key}`).then(val =>
      (val !== undefined && val !== null) ? val : defaultValue
    );
  }

  public static deleteWorldData(key: string): Promise<void> {
    return this.deleteKey('world', `${this.currentWorldId}::${key}`);
  }

  // ── Global settings (not world-scoped) ───────────────────────────────────

  public static setGlobalData(key: string, value: any): Promise<void> {
    return this.put('world', `__global__::${key}`, value);
  }

  public static getGlobalData<T>(key: string, defaultValue: T): Promise<T> {
    return this.get<T>('world', `__global__::${key}`).then(val =>
      (val !== undefined && val !== null) ? val : defaultValue
    );
  }

  // ── Chunk modifications ───────────────────────────────────────────────────
  //
  // Modifications are stored as a FULL DIFF: every voxel index that was
  // changed from the worldgen baseline is stored, INCLUDING blocks set to 0
  // (i.e. blocks the player has broken).  This is what was missing before —
  // the old code only saved non-zero values, so broken blocks respawned.

  public static saveChunkModifications(
    chunkKey: string,
    modifications: { [index: number]: number }
  ): Promise<void> {
    if (this.currentWorldId === 'multiplayer_world') return Promise.resolve();
    if (!modifications || typeof modifications !== 'object') {
      console.warn('saveChunkModifications: Invalid modifications object ignored.', chunkKey);
      return Promise.resolve();
    }
    const cleanMods: { [index: number]: number } = {};
    for (const [idxStr, blockId] of Object.entries(modifications)) {
      const idx = parseInt(idxStr);
      const bid = Number(blockId);
      if (Number.isInteger(idx) && idx >= 0 && idx < 4096 && Number.isInteger(bid) && bid >= 0 && bid <= 65535) {
        cleanMods[idx] = bid;
      }
    }
    return this.put('chunks', `${this.currentWorldId}::${chunkKey}`, cleanMods);
  }

  public static loadChunkModifications(
    chunkKey: string
  ): Promise<{ [index: number]: number } | null> {
    if (this.currentWorldId === 'multiplayer_world') return Promise.resolve(null);
    return this.get<{ [index: number]: number } | null>(
      'chunks',
      `${this.currentWorldId}::${chunkKey}`
    ).then(val => {
      if (!val || typeof val !== 'object') return null;
      const cleanMods: { [index: number]: number } = {};
      for (const [idxStr, blockId] of Object.entries(val)) {
        const idx = parseInt(idxStr);
        const bid = Number(blockId);
        if (Number.isInteger(idx) && idx >= 0 && idx < 4096 && Number.isInteger(bid) && bid >= 0 && bid <= 65535) {
          cleanMods[idx] = bid;
        }
      }
      return Object.keys(cleanMods).length > 0 ? cleanMods : null;
    });
  }

  // ── Inventory ─────────────────────────────────────────────────────────────

  public static saveInventory(inventoryData: any): Promise<void> {
    if (this.shouldDisableInventoryPersistence) return Promise.resolve();
    return this.put('inventory', `${this.currentWorldId}::player_inv`, inventoryData);
  }

  public static loadInventory<T>(): Promise<T | null> {
    if (this.shouldDisableInventoryPersistence) return Promise.resolve(null);
    return this.get<T | null>('inventory', `${this.currentWorldId}::player_inv`).then(
      val => val || null
    );
  }

  // ── Chest storage ─────────────────────────────────────────────────────────

  public static saveChestContents(pos: string, contents: any): Promise<void> {
    return this.put('world', `${this.currentWorldId}::chest::${pos}`, contents);
  }

  public static loadChestContents(pos: string): Promise<any | null> {
    return this.get<any>('world', `${this.currentWorldId}::chest::${pos}`).then(
      val => val || null
    );
  }

  // ── Clear helpers ─────────────────────────────────────────────────────────

  public static async clearCurrentWorld(): Promise<void> {
    const prefix = `${this.currentWorldId}::`;
    await Promise.all([
      this.database.deletePrefix('chunks', prefix),
      this.database.deletePrefix('world', prefix),
      this.database.deletePrefix('inventory', prefix),
    ]);
  }

  public static clearAll(): Promise<void> {
    return this.database.clearAll();
  }

  // ── Low-level helpers ─────────────────────────────────────────────────────

  private static put(storeName: string, key: string, value: any): Promise<void> {
    return this.database.put(storeName as 'world' | 'chunks' | 'inventory' | 'worlds', key, value);
  }

  private static get<T>(storeName: string, key: string): Promise<T | null> {
    return this.database.get<T>(storeName as 'world' | 'chunks' | 'inventory' | 'worlds', key)
      .then((value) => value === undefined ? null : value);
  }

  private static deleteKey(storeName: string, key: string): Promise<void> {
    return this.database.delete(storeName as 'world' | 'chunks' | 'inventory' | 'worlds', key);
  }

  private static getAll<T>(storeName: string): Promise<T[]> {
    return this.database.values<T>(storeName as 'world' | 'chunks' | 'inventory' | 'worlds')
      .then((values) => [...values]);
  }
}
