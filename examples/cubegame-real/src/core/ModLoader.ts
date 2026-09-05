import { EventBus } from './EventBus';
import { BlockRegistry } from '../world/BlockRegistry';
import { ItemRegistry } from '../items/ItemRegistry';
import { CraftingSystem } from '../inventory/CraftingSystem';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { AudioManager } from '../audio/AudioManager';
import { InputManager } from './InputManager';
import { registerShaderPack, getAllShaderPacks, getShaderPack } from '../graphics/ShaderPacks';
import { BiomeRegistry, DimensionRegistry, StructureRegistry, NetworkRegistry } from '../engine/EngineRegistries';
import { ModManifest, ModManifestEntry, PlatformRuntime } from './PlatformRuntime';
import * as THREE from 'three';

type ModSource = 'server' | 'native' | 'packaged';

export class ModLoader {
  private static serverUrl: string = 'http://localhost:8080';
  private static apiReady = false;
  private static loadedMods = new Map<string, string>();
  private static loadedManifest: ModManifest = { version: 1, generatedAt: 0, mods: [] };

  public static setServerUrl(url: string): void {
    let clean = url.trim();
    if (clean.startsWith('ws://')) {
      clean = clean.replace('ws://', 'http://');
    } else if (clean.startsWith('wss://')) {
      clean = clean.replace('wss://', 'https://');
    } else if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'http://' + clean;
    }
    this.serverUrl = clean;
  }

  public static getLoadedManifest(): ModManifest {
    return {
      ...this.loadedManifest,
      mods: this.loadedManifest.mods.map(mod => ({ ...mod, files: [...mod.files] })),
    };
  }

  public static async syncWithServer(serverUrl: string, requiredManifest?: ModManifest): Promise<void> {
    this.setServerUrl(serverUrl);
    await this.loadMods({ manifest: requiredManifest, force: false });
  }

  public static async loadMods(options: { manifest?: ModManifest; force?: boolean; includeServer?: boolean } = {}): Promise<void> {
    this.setupGlobalApi();

    const manifests: Array<{ manifest: ModManifest; baseUrl: string; source: ModSource }> = [];
    const includeServer = options.includeServer !== false;
    const serverManifest = options.manifest || (includeServer ? await this.fetchServerManifest(this.serverUrl) : null);
    if (serverManifest) {
      manifests.push({ manifest: serverManifest, baseUrl: this.serverUrl, source: 'server' });
    }

    const nativeManifest = await this.fetchNativeManifest();
    if (nativeManifest) {
      manifests.push({ manifest: nativeManifest, baseUrl: 'native://mods', source: 'native' });
    }

    if (!serverManifest) {
      const packagedManifest = await this.fetchPackagedManifest();
      if (packagedManifest) {
        manifests.push({ manifest: packagedManifest, baseUrl: window.location.origin, source: 'packaged' });
      }
    }

    if (manifests.length === 0) {
      console.log('[ModLoader] No mod manifests found. Running vanilla content.');
      return;
    }

    for (const item of manifests) {
      console.log(`[ModLoader] Loading ${item.source} mod manifest:`, item.manifest.mods);
      for (const mod of item.manifest.mods) {
        await this.loadModFromManifest(mod, item.baseUrl, item.source, !!options.force);
      }
    }

    const merged = new Map<string, ModManifestEntry>();
    for (const item of manifests) {
      for (const mod of item.manifest.mods) {
        merged.set(mod.name, mod);
      }
    }

    this.loadedManifest = {
      version: 1,
      generatedAt: Date.now(),
      mods: Array.from(merged.values()),
    };
  }

  private static setupGlobalApi(): void {
    if (this.apiReady) return;
    this.apiReady = true;

    (window as any).CubeGameAPI = {
      BlockRegistry,
      ItemRegistry,
      CraftingRegistry: {
        register: CraftingSystem.register.bind(CraftingSystem),
        registerShaped: CraftingSystem.registerShaped.bind(CraftingSystem),
        registerShapeless: CraftingSystem.registerShapeless.bind(CraftingSystem),
        getRecipes: CraftingSystem.getRecipes.bind(CraftingSystem),
      },
      BiomeRegistry,
      DimensionRegistry,
      StructureRegistry,
      NetworkRegistry,
      TextureGenerator,
      EventBus,
      AudioManager,
      InputManager,
      ShaderPacks: {
        register: registerShaderPack,
        getAll: getAllShaderPacks,
        get: getShaderPack,
      },
      THREE
    };
  }

  private static async fetchServerManifest(baseUrl: string): Promise<ModManifest | null> {
    try {
      const response = await this.fetchWithTimeout(`${baseUrl}/api/mods/manifest`, 3000);
      if (!response.ok) {
        console.warn(`[ModLoader] Server returned status ${response.status} for mod manifest. Trying legacy list.`);
        return await this.fetchLegacyServerMods(baseUrl);
      }

      return this.normalizeManifest(await response.json());
    } catch (err) {
      console.warn(`[ModLoader] Could not load mods from server ${baseUrl}:`, err);
      return null;
    }
  }

  private static async fetchLegacyServerMods(baseUrl: string): Promise<ModManifest | null> {
    try {
      const response = await this.fetchWithTimeout(`${baseUrl}/api/mods`, 3000);
      if (!response.ok) return null;
      return this.normalizeManifest(await response.json());
    } catch {
      return null;
    }
  }

  private static async fetchNativeManifest(): Promise<ModManifest | null> {
    const bridge = PlatformRuntime.getNativeBridge();
    if (!bridge?.listMods) return null;

    try {
      const result = await bridge.listMods();
      return this.normalizeManifest(result);
    } catch (err) {
      console.warn('[ModLoader] Native bridge mod listing failed:', err);
      return null;
    }
  }

  private static async fetchPackagedManifest(): Promise<ModManifest | null> {
    try {
      const manifestUrl = new URL('./mods/manifest.json', window.location.href).href;
      const response = await this.fetchWithTimeout(manifestUrl, 1200);
      if (!response.ok) return null;
      return this.normalizeManifest(await response.json());
    } catch {
      return null;
    }
  }

  private static normalizeManifest(payload: any): ModManifest | null {
    const mods = Array.isArray(payload) ? payload : payload?.mods;
    if (!Array.isArray(mods)) return null;

    const normalized: ModManifestEntry[] = mods
      .filter((mod: any) => typeof mod?.name === 'string' && Array.isArray(mod.files))
      .map((mod: any) => {
        const files = mod.files
          .map((file: any) => String(file || ''))
          .filter((file: string) => /\.m?js$/i.test(file));
        return {
          name: String(mod.name),
          files,
          entry: typeof mod.entry === 'string' ? mod.entry : this.pickEntryFile(files),
          hasAssets: !!mod.hasAssets,
          hash: typeof mod.hash === 'string' ? mod.hash : files.join('|'),
          source: typeof mod.source === 'string' ? mod.source : undefined,
          fileHashes: Array.isArray(mod.fileHashes) ? mod.fileHashes : undefined,
        };
      })
      .filter((mod: ModManifestEntry) => !!mod.entry);

    return {
      version: Number(payload?.version || 1),
      generatedAt: Number(payload?.generatedAt || Date.now()),
      mods: normalized,
    };
  }

  private static async loadModFromManifest(
    mod: ModManifestEntry,
    baseUrl: string,
    source: ModSource,
    force: boolean
  ): Promise<void> {
    const entryFile = mod.entry || this.pickEntryFile(mod.files);
    if (!entryFile) {
      console.warn(`[ModLoader] Mod ${mod.name} has no JS entry file. Skipping script loading.`);
      return;
    }

    const loadKey = `${source}:${mod.name}`;
    const hash = mod.hash || entryFile;
    if (!force && this.loadedMods.get(loadKey) === hash) {
      return;
    }

    try {
      const moduleUrl = source === 'native'
        ? await this.createNativeModModuleUrl(mod.name, entryFile)
        : this.createHttpModModuleUrl(baseUrl, mod.name, entryFile, source);

      const module = await import(/* @vite-ignore */ moduleUrl);
      if (module.default && typeof module.default === 'function') {
        console.log(`[ModLoader] Initializing mod (default export): ${mod.name}`);
        await module.default((window as any).CubeGameAPI);
      } else if (module.init && typeof module.init === 'function') {
        console.log(`[ModLoader] Initializing mod (init export): ${mod.name}`);
        await module.init((window as any).CubeGameAPI);
      }

      this.loadedMods.set(loadKey, hash);
      console.log(`[ModLoader] Loaded ${source} mod: ${mod.name}`);
    } catch (err) {
      console.error(`[ModLoader] Failed to load ${source} mod ${mod.name}:`, err);
    }
  }

  private static createHttpModModuleUrl(baseUrl: string, modName: string, entryFile: string, source: ModSource): string {
    if (source === 'packaged') {
      return new URL(`./mods/${encodeURIComponent(modName)}/${encodeURIComponent(entryFile)}`, window.location.href).href;
    }
    return `${baseUrl}/api/mods/${encodeURIComponent(modName)}/code/${encodeURIComponent(entryFile)}`;
  }

  private static async createNativeModModuleUrl(modName: string, entryFile: string): Promise<string> {
    const bridge = PlatformRuntime.getNativeBridge();
    if (!bridge?.readModCode) {
      throw new Error('Native mod bridge does not expose readModCode');
    }

    const result = await bridge.readModCode(modName, entryFile);
    const code = typeof result === 'string' ? result : result.code;
    const blob = new Blob([code], { type: 'text/javascript' });
    return URL.createObjectURL(blob);
  }

  private static pickEntryFile(files: string[]): string | undefined {
    return files.includes('index.js')
      ? 'index.js'
      : (files.includes('mod.js') ? 'mod.js' : files.find((file: string) => file.endsWith('.js')));
  }

  private static async fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: {
          'Bypass-Tunnel-Reminder': '1',
          'X-CubeGame-Client': 'mod-loader',
        },
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
}
