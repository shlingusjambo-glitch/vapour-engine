import * as THREE from 'three';
import { LoadingSession, RuntimeLoop, type LoadingSnapshot, type LoadingTaskDefinition, type RuntimeFrameTime } from '@vapour/engine';
import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';
import { StorageManager } from '../storage/StorageManager';
import { AudioManager } from '../audio/AudioManager';
import { VoiceChatManager } from '../audio/VoiceChatManager';
import { Renderer } from '../graphics/Renderer';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { VoxelShader } from '../graphics/VoxelShader';
import { getShaderPack } from '../graphics/ShaderPacks';
import { SkySystem } from '../graphics/SkySystem';
import { ParticleSystem } from '../graphics/ParticleSystem';
import { WorldManager } from '../world/WorldManager';
import { PlayerController } from '../player/PlayerController';
import { CameraController } from '../player/CameraController';
import { Inventory } from '../inventory/Inventory';
import { InventoryUI } from '../inventory/InventoryUI';
import { CraftingTableUI } from '../inventory/CraftingTableUI';
import { ChestUI } from '../inventory/ChestUI';
import { BedWarsShopUI } from '../inventory/BedWarsShopUI';
import { FurnaceManager } from '../inventory/FurnaceManager';
import { FurnaceUI } from '../inventory/FurnaceUI';
import { BrewingManager } from '../inventory/BrewingManager';
import { BrewingUI } from '../inventory/BrewingUI';
import { EnchantingUI } from '../inventory/EnchantingUI';
import { AnvilUI } from '../inventory/AnvilUI';
import { StonecutterUI, LoomUI, LecternUI } from '../inventory/WorkstationUI';
import { EntityManager } from '../entities/EntityManager';
import { ItemDropManager } from '../items/ItemDropManager';
import { ItemRegistry } from '../items/ItemRegistry';
import { BlockRegistry } from '../world/BlockRegistry';
import { HUD } from '../ui/HUD';
import { PauseMenu } from '../ui/PauseMenu';
import { MiniGameMenu } from '../ui/MiniGameMenu';
import { MainMenuUI } from '../ui/MainMenuUI';
import { NetworkManager } from '../network/NetworkManager';
import { ModLoader } from '../core/ModLoader';
import { getFeatureBlockId, getFeatureItemId } from '../content/FeatureCatalog';
import { CROWNFORGE_BEDWARS_SHOP_NPCS, CROWNFORGE_BEDWARS_TEAM_SPAWNS, getMinigameByCommand, isCrownForgeRoom, isCrownForgeDimension, CBGO_MAPS } from '../crownforge/CrownForgeCatalog';
import { CBGOManager } from '../cbgo/CBGOManager';
import { TF2Manager } from '../tf2/TF2Manager';
import { BaseWeapon } from '../weapons/BaseWeapon';
import { COBGameMode } from '../cob/COBGameMode';

export class Game {
  private renderer!: Renderer;
  private skySystem!: SkySystem;
  private particleSystem!: ParticleSystem;
  private worldManager!: WorldManager;
  private playerController!: PlayerController;
  private cameraController!: CameraController;
  
  private inventory!: Inventory;
  private inventoryUI!: InventoryUI;
  private craftingTableUI!: CraftingTableUI;
  private chestUI!: ChestUI;
  private bedWarsShopUI!: BedWarsShopUI;
  private furnaceManager!: FurnaceManager;
  private furnaceUI!: FurnaceUI;
  private brewingManager!: BrewingManager;
  private brewingUI!: BrewingUI;
  private enchantingUI!: EnchantingUI;
  private anvilUI!: AnvilUI;
  private stonecutterUI!: StonecutterUI;
  private loomUI!: LoomUI;
  private lecternUI!: LecternUI;
  private entityManager!: EntityManager;
  private itemDropManager!: ItemDropManager;
  private voiceChatManager!: VoiceChatManager;
  
  private hud!: HUD;
  private pauseMenu!: PauseMenu;
  private miniGameMenu!: MiniGameMenu;
  private mainMenuUI!: MainMenuUI;
  private cbgoManager!: CBGOManager;
  private tf2Manager!: TF2Manager;
  private cobMode!: COBGameMode;
  private baseWeapon!: BaseWeapon;
  private networkManager!: NetworkManager;

  private materials!: {
    opaque: THREE.ShaderMaterial;
    transparent: THREE.ShaderMaterial;
    water: THREE.ShaderMaterial;
    foliage: THREE.ShaderMaterial;
  };

  // Running stats
  private fps = 0;
  private frameCount = 0;
  private lastFpsUpdateTime = 0;
  private lastTimeSyncTime = 0;

  private isRunning = false;
  private runtimeLoop: RuntimeLoop | null = null;
  private starterMobsSpawned = false;
  private isWorldLoaded = false;
  private worldLoading: LoadingSession | null = null;
  private stopWorldLoadingUpdates: (() => void) | null = null;
  private lastPositionSaveTime = 0;
  private menuPreviewGroup: THREE.Group | null = null;
  private menuPreviewClock = 0;
  private currentWorldId: string | null = null;
  private multiplayerSeed = '12345';
  private isMultiplayerMobAuthority = true;
  private needsSpawnPlacement = false;
  private multiplayerRoomKind = '';
  private multiplayerMatchPhase = '';
  private lastMultiplayerRoomId = '';
  private lastAppliedServerSpawnKey = '';
  private bedWarsShopMobsSpawnedForRoom = '';
  private bedWarsLoadoutAppliedForRoom = '';
  private bedWarsResourceCleanedForKey = '';
  private lastBedWarsShopVerifyTime = 0;
  private bedWarsShopSignsForRoom = '';
  private bedWarsShopSignGroup: THREE.Group | null = null;
  private cbgoVoiceEnabledForRoom = '';
  private pendingServerMode: {
    dimension?: string;
    spawn?: { x: number; y: number; z: number };
    room?: string;
    role?: string;
    meta?: any;
    forceSpawn?: boolean;
  } | null = null;

  // Torch light tracking
  private activeTorchLights = new Map<string, THREE.PointLight>();
  private lastTorchUpdateTime = 0;

  // Spawner timing
  private spawnerTimer = 0;
  private adventureDirectorTimer = 0;
  private adventureEventTimer = 0;
  private backroomsHorrorTimer = 0;
  private backroomsWhisperTimer = 0;
  private backroomsScreamTimer = 0;
  private starterAdventureBuilt = false;
  private adventureMilestones = new Set<string>();

  constructor() {
    // Game is initialized in boot sequence
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Initialize Storage DB
    (window as any).cubeGameBootStage = 'storage-init';
    await StorageManager.init();

    // 2. Setup HUD and Pause Overlays
    (window as any).cubeGameBootStage = 'ui-init';
    this.hud = new HUD();
    this.pauseMenu = new PauseMenu();
    this.miniGameMenu = new MiniGameMenu();
    this.mainMenuUI = new MainMenuUI();

    // 3. Load configurations from Storage (using global store for cross-world settings)
    const fov = await StorageManager.getGlobalData<number>('setting_fov', 75);
    const renderDist = await StorageManager.getGlobalData<number>('setting_renderDist', 5);
    const shaderPackId = await StorageManager.getGlobalData<string>('setting_shaderPack', 'balanced');
    const shadows = await StorageManager.getGlobalData<boolean>('setting_shadows', true);
    const pageHost = window.location.hostname || 'localhost';
    const isLocalPage = pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '::1';
    const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const defaultServerIp = isLocalPage
      ? `${wsScheme}://${pageHost}:8080`
      : `${wsScheme}://${window.location.host}`;
    const savedServerIp = await StorageManager.getGlobalData<string>('setting_serverIp', defaultServerIp);
    const serverIp = this.resolveServerAddress(savedServerIp, defaultServerIp);

    // Seed is loaded on world select; startup only needs a stable default.
    const seed = '12345';
    this.pauseMenu.loadSettings({ fov, renderDist, seed, serverIp, shaderPack: shaderPackId, shadows });

    // 4. Initialize Graphics Renderer
    (window as any).cubeGameBootStage = 'renderer-init';
    this.renderer = new Renderer('canvas-container');
    await this.renderer.initialize();
    
    // Set custom camera Field of View
    this.renderer.camera.fov = fov;
    this.renderer.camera.updateProjectionMatrix();

    // Load only packaged/native mods during desktop startup. Server mods sync
    // during the actual multiplayer handshake; trying to fetch a stale loca.lt
    // mod manifest here was one of the ways the native build could appear to
    // sit on the Vapour splash forever before the main menu existed.
    (window as any).cubeGameBootStage = 'mod-loader-local';
    ModLoader.setServerUrl(serverIp);
    await ModLoader.loadMods({ includeServer: false });

    // 6. Generate Voxel Textures and Custom Shaders
    (window as any).cubeGameBootStage = 'texture-atlas';
    const textureAtlas = await TextureGenerator.generateAtlas();
    this.materials = VoxelShader.createMaterials(textureAtlas);
    const shaderPack = getShaderPack(shaderPackId);
    VoxelShader.applyShaderPack(this.materials, shaderPack);
    this.renderer.setVisualQuality({
      bloom: shaderPack.bloom,
      exposure: shaderPack.exposure,
      pixelRatioCap: shaderPack.pixelRatioCap,
    });
    this.renderer.setTextureAtlas(textureAtlas);

    // 7. Initialize Voxel World Manager. Real chunks are loaded only after a
    // world is selected, so the title screen can use a fake preview scene.
    this.worldManager = new WorldManager(this.renderer.scene, this.materials);

    // 8. Initialize Gameplay Inventory and UI Screens
    this.inventory = new Inventory();
    await this.inventory.loadFromStorage();
    this.inventoryUI = new InventoryUI(this.inventory);
    this.craftingTableUI = new CraftingTableUI(this.inventory);
    this.chestUI = new ChestUI(this.inventory);
    this.bedWarsShopUI = new BedWarsShopUI(this.inventory);
    this.furnaceManager = new FurnaceManager(this.worldManager);
    this.furnaceUI = new FurnaceUI(this.inventory, this.furnaceManager);
    await this.furnaceManager.init(StorageManager.currentWorldId);
    this.brewingManager = new BrewingManager(this.worldManager);
    (window as any).gameBrewingManager = this.brewingManager;
    this.brewingUI = new BrewingUI(this.inventory);
    this.enchantingUI = new EnchantingUI(this.inventory);
    this.anvilUI = new AnvilUI(this.inventory);
    this.stonecutterUI = new StonecutterUI(this.inventory);
    this.loomUI = new LoomUI(this.inventory);
    this.lecternUI = new LecternUI();
    await this.brewingManager.init(StorageManager.currentWorldId);

    // 9. Initialize Player and Looking controls
    this.playerController = new PlayerController(this.worldManager, this.inventory);
    this.cameraController = new CameraController(this.renderer);
    this.baseWeapon = new BaseWeapon(this.inventory, this.playerController, this.renderer, this.worldManager);

    // Initial HUD stats sync
    this.hud.updateHealth(this.playerController.health);
    this.hud.updateHunger(this.playerController.hunger);
    this.hud.updateGamemode(this.playerController.gameMode);

    // Sync player spawning height above terrain
    const startX = 8, startZ = 8;
    const terrainHeight = 16;
    this.playerController.position.set(startX, terrainHeight + 4, startZ);

    // Expose controllers globally
    (window as any).gamePlayerController = this.playerController;
    (window as any).gameCameraController = this.cameraController;
    (window as any).gameFurnaceManager = this.furnaceManager;
    (window as any).gameChestUI = this.chestUI;
    (window as any).gameBedWarsShopUI = this.bedWarsShopUI;

    // 10. Initialize Entities, Collectibles, and Particles
    this.entityManager = new EntityManager(this.renderer.scene, this.worldManager);
    this.voiceChatManager = new VoiceChatManager(this.entityManager);
    this.itemDropManager = new ItemDropManager(this.renderer.scene, this.worldManager, this.inventory, textureAtlas);
    this.particleSystem = new ParticleSystem(this.renderer.scene);
    this.skySystem = new SkySystem(this.renderer.scene);
    this.skySystem.setShadowsEnabled(shadows);
    this.renderer.setShadowsEnabled(shadows);
    this.skySystem.setRenderDistanceChunks(renderDist);
    this.renderer.setWorldViewDistance(renderDist);
    this.createMenuPreviewWorld();
    (window as any).gameEntityManager = this.entityManager;
    (window as any).gameVoiceChatManager = this.voiceChatManager;
    (window as any).gameSkySystem = this.skySystem;
    (window as any).gameItemDropManager = this.itemDropManager;

    // 11. Connect Network relay sync
    this.networkManager = new NetworkManager(this.entityManager, this.worldManager);
    (window as any).gameNetworkManager = this.networkManager;
    this.cbgoManager = new CBGOManager(this.renderer, this.worldManager, this.playerController, this.cameraController, this.inventory, this.entityManager);
    this.tf2Manager = new TF2Manager(this.renderer, this.worldManager, this.playerController, this.entityManager, this.inventory, this.particleSystem);
    this.cobMode = new COBGameMode(this.renderer, this.worldManager, this.playerController, this.cameraController, this.inventory, this.entityManager, this.hud);

    // 12. Bind system listeners
    this.bindEvents();
    window.addEventListener('beforeunload', () => {
      if (!this.isWorldLoaded || !this.playerController) return;
      const pos = this.playerController.position;
      void this.worldManager.flushChunkModifications();
      StorageManager.setWorldData('player_pos', { x: pos.x, y: pos.y, z: pos.z }).catch(() => {});
    });
    window.addEventListener('pagehide', () => {
      if (!this.isWorldLoaded || !this.worldManager) return;
      void this.worldManager.flushChunkModifications();
    });

    // Initialize Input Manager
    InputManager.init(this.renderer.renderer.domElement);

    // 13. Start animation loop
    (window as any).cubeGameBootStage = 'game-loop';
    this.lastFpsUpdateTime = performance.now();
    this.runtimeLoop = new RuntimeLoop({
      update: this.loop,
      error: (error) => console.error('CubeGame runtime frame failed:', error),
    }, { fixedHz: 60, maxDeltaSeconds: 0.1, maxFixedStepsPerFrame: 8 });
    await this.runtimeLoop.start();
  }

  private bindEvents(): void {
    // Settings adjustments listeners
    EventBus.on('settings:fov', (fov: number) => {
      this.renderer.camera.fov = fov;
      this.renderer.camera.updateProjectionMatrix();
    });

    EventBus.on('settings:renderDistance', (dist: number) => {
      this.worldManager.setRenderDistance(dist);
      this.skySystem.setRenderDistanceChunks(dist);
      this.renderer.setWorldViewDistance(dist);
    });

    EventBus.on('settings:shaderPack', (packId: string) => {
      const pack = getShaderPack(packId);
      VoxelShader.applyShaderPack(this.materials, pack);
      this.renderer.setVisualQuality({
        bloom: pack.bloom,
        exposure: pack.exposure,
        pixelRatioCap: pack.pixelRatioCap,
      });
      StorageManager.setGlobalData('setting_shaderPack', pack.id);
    });

    EventBus.on('settings:shadows', (enabled: boolean) => {
      this.renderer.setShadowsEnabled(enabled);
      this.skySystem.setShadowsEnabled(enabled);
      StorageManager.setGlobalData('setting_shadows', enabled);
    });

    // Particle explosions trigger
    EventBus.on('particles:spawn', (pos: THREE.Vector3, blockId: number, count: number) => {
      this.particleSystem.spawnBlockParticles(pos, blockId, count);
    });

    // Sync hand block color updates on hotbar select
    EventBus.on('inventory:updated', () => {
      const activeIdx = this.inventory.getActiveSlotIndex();
      const stack = this.inventory.getSlot(activeIdx);
      this.renderer.updateHandMeshBlock(stack ? stack.id : 0);
    });
    EventBus.on('hotbar:changed', (idx: number) => {
      const stack = this.inventory.getSlot(idx);
      this.renderer.updateHandMeshBlock(stack ? stack.id : 0);
    });

    // Listen to damage state
    EventBus.on('player:hurt', (damage: number) => {
      this.playerController.takeDamage(damage, 'combat');
    });

    EventBus.on('mob:attack', ({ damage }: any) => {
      this.playerController.takeDamage(damage, 'mob');
    });

    EventBus.on('player:healthChanged', (hp: number) => {
      this.hud.updateHealth(hp);
    });

    EventBus.on('player:hungerChanged', (hunger: number) => {
      this.hud.updateHunger(hunger);
    });

    // Command handlers
    EventBus.on('command:gamemode', (mode: string) => {
      this.hud.updateGamemode(mode);
    });

    EventBus.on('command:spawn', (mobType: string) => {
      const dir = this.cameraController.getDirection();
      const spawnPos = this.playerController.position.clone()
        .addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 3.0)
        .add(new THREE.Vector3(0, 1.5, 0));
      this.entityManager.spawnMob(spawnPos, mobType as any);
    });

    EventBus.on('command:give', ({ id, count, name }: { id: number; count: number; name?: string }) => {
      const item = ItemRegistry.get(id);
      const itemName = name || (item ? item.name : BlockRegistry.has(id) ? BlockRegistry.get(id).name : `Item #${id}`);
      const leftovers = this.inventory.addItem(id, count);
      const received = count - leftovers;
      if (received > 0) {
        this.hud.addChatMessage(`[System] Gave ${received} x ${itemName}.`);
      }
      if (leftovers > 0) {
        this.hud.addChatMessage(`[System] Inventory full: ${leftovers} could not fit.`);
      }
    });

    EventBus.on('command:time', (val: number) => {
      const normalizedTime = val > 1.0 ? val / 24000 : val;
      this.skySystem.setTime(normalizedTime);
    });

    EventBus.on('command:backrooms', () => this.teleportToBackrooms());
    EventBus.on('bedwars:openShopButton', (payload?: any) => this.openBedWarsShopFromButton(payload));
    EventBus.on('game:joinBaselineSandbox', () => {
      void this.loadBaselineSandbox();
    });
    EventBus.on('game:joinTf2Map', (payload?: any) => {
      const dimension = String(payload?.dimension || 'tf2_ctf');
      void this.loadTf2Map(dimension);
    });
    EventBus.on('game:joinCOB', (payload?: any) => {
      const username = String(payload?.username || this.networkManager?.wantedUsername || 'Steve');
      void this.loadCOBMode(username);
    });
    EventBus.on('game:loadCOBMap', (payload?: any) => {
      const mapId = String(payload?.mapId || 'cob_crossfire_blocks');
      void this.loadCOBMap(mapId);
    });
    EventBus.on('game:leaveCOB', () => {
      void this.leaveCOBMode();
    });

    // Handle item drop (Q key). Drop in front of the player with a real
    // pickup cooldown so it does not instantly magnet back into inventory.
    EventBus.on('inventory:drop', () => {
      const stack = this.inventory.dropActiveItem();
      if (stack) {
        const lookDir = this.cameraController.getDirection().normalize();
        const horizontal = new THREE.Vector3(lookDir.x, 0, lookDir.z);
        if (horizontal.lengthSq() < 0.001) horizontal.set(0, 0, -1);
        horizontal.normalize();

        const dropPos = this.playerController.position.clone()
          .add(new THREE.Vector3(0, this.playerController.eyeHeight * 0.78, 0))
          .addScaledVector(horizontal, 1.85);
        const velocity = horizontal.multiplyScalar(5.2).add(new THREE.Vector3(0, 2.15, 0));

        this.itemDropManager.spawn(dropPos, stack.id, stack.count, { velocity, pickupDelay: 2.2 });
        EventBus.emit('inventory:updated');
      }
    });

    // Listen to mining progress to render crack overlays on blocks
    EventBus.on('mining:progress', (stage: number) => {
      const target = this.playerController.targetBlock;
      if (target && stage > 0) {
        this.renderer.updateCrackMesh(target.x, target.y, target.z, stage);
        EventBus.emit('network:blockBreakProgress', { x: target.x, y: target.y, z: target.z, stage });
      } else {
        this.renderer.updateCrackMesh(0, 0, 0, 0);
        EventBus.emit('network:blockBreakProgress', { stage: 0 });
      }
    });

    EventBus.on('network:blockBreakProgressRemote', (data: any) => {
      const x = Number(data?.x), y = Number(data?.y), z = Number(data?.z), stage = Number(data?.stage ?? 0);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && stage > 0) {
        this.renderer.updateCrackMesh(x, y, z, Math.max(1, Math.min(6, Math.floor(stage))));
      }
    });

    // World selected event from pause menu / world selector
    EventBus.on('world:selected', async (worldId: string) => {
      await this.loadSelectedWorld(worldId);
    });

    EventBus.on('network:welcome', async (msg: any) => {
      this.multiplayerSeed = String(msg?.seed ?? this.multiplayerSeed ?? '12345');
      this.isMultiplayerMobAuthority = !msg?.mobAuthorityUuid || msg.mobAuthorityUuid === msg.uuid;
      this.captureServerMode(msg);
      if (this.currentWorldId !== 'multiplayer_world') {
        await this.loadSelectedWorld('multiplayer_world');
      }
      this.applyPendingServerMode();
      this.grantNavigatorIfNeeded(msg);
      EventBus.emit('network:worldLoaded', {
        room: msg?.room,
        dimension: msg?.meta?.dimension || msg?.dimension,
        uuid: msg?.uuid,
      });
    });

    EventBus.on('network:serverInfo', (msg: any) => {
      this.captureServerMode(msg);
      this.applyPendingServerMode();
      this.grantNavigatorIfNeeded(msg);
    });

    EventBus.on('network:serverMode', (msg: any) => {
      this.captureServerMode(msg);
      this.applyPendingServerMode();
    });

    EventBus.on('minigame:join', (selection: any) => {
      this.handleMiniGameJoin(selection);
    });

    const unloadMultiplayerWorld = async () => {
      this.isMultiplayerMobAuthority = true;
      await this.unloadCurrentWorldToMenu();
    };
    EventBus.on('network:disconnect', unloadMultiplayerWorld);
    EventBus.on('network:disconnected', (detail?: any) => {
      if (detail?.explicit === false || detail?.reconnectable) return;
      void unloadMultiplayerWorld();
    });
    EventBus.on('network:connectionLost', () => {
      this.hud.addChatMessage('[Network] Connection lost. Staying in the world instead of dumping you to the main menu.');
    });

    // Real-time torch light updates
    EventBus.on('world:blockChanged', ({ x, y, z, blockId }: any) => {
      const key = `${x},${y},${z}`;
      if (blockId === 21) {
        if (!this.activeTorchLights.has(key) && this.activeTorchLights.size < 16) {
          const light = new THREE.PointLight(0xff9944, 2.0, 12, 1.2);
          light.position.set(x + 0.5, y + 0.5, z + 0.5);
          this.renderer.scene.add(light);
          this.activeTorchLights.set(key, light);
        }
      } else {
        const light = this.activeTorchLights.get(key);
        if (light) {
          this.renderer.scene.remove(light);
          this.activeTorchLights.delete(key);
        }
      }
    });
  }

  private grantNavigatorIfNeeded(msg: any): void {
    const room = String(msg?.room || '').toLowerCase();
    const serverId = String(msg?.meta?.serverId || '').toLowerCase();
    if (!isCrownForgeRoom(room, serverId)) return;

    const navigatorId = getFeatureItemId('CrownForge Navigator');
    if (!navigatorId || !this.inventory) return;

    if (this.countInventoryItem(navigatorId) > 0) return;

    const preferredSlot = 8;
    if (!this.inventory.getSlot(preferredSlot)) {
      this.inventory.setSlot(preferredSlot, { id: navigatorId, count: 1, customName: 'CrownForge Navigator' });
    } else {
      this.inventory.addItem(navigatorId, 1);
    }
    this.hud.addChatMessage('[CrownForge] Navigator added to your hotbar. Right-click it to pick SkyWars, BedWars, Duels, Castle Siege, or Survival Games.');
  }

  private teleportToBackrooms(): void {
    if (this.isLoadingWorld) return;
    const spawn = { x: 0, y: 65, z: 0 };

    // In multiplayer, let the server perform the room move so other players see
    // the correct leave/join state. In single-player, switch dimensions locally.
    if (this.currentWorldId === 'multiplayer_world' && this.networkManager?.connected) {
      EventBus.emit('chat:send', '/backrooms');
      this.hud.addChatMessage('[Backrooms] Reality thins out...');
      return;
    }

    this.worldManager.setDimension('backrooms');
    this.playerController.position.set(spawn.x, spawn.y, spawn.z);
    this.playerController.velocity.set(0, 0, 0);
    this.playerController.grounded = false;
    this.skySystem.setTime(0.74);
    AudioManager.setBackroomsMode(true);
    StorageManager.setWorldData('player_pos', spawn);
    StorageManager.setWorldData('player_dimension', 'backrooms');
    this.hud.addChatMessage('[Backrooms] You clipped out of reality. Find an exit...');
  }

  private handleMiniGameJoin(selection: any): void {
    const mode = getMinigameByCommand(selection?.command) || null;
    const command = mode?.command || String(selection?.command || '').trim();
    if (!command.startsWith('/')) {
      this.hud.addChatMessage('[Navigator] Could not read that minigame command.');
      return;
    }

    if (!this.networkManager?.connected) {
      this.hud.addChatMessage('[Navigator] Not connected to CrownForge. Join the real server from Multiplayer first.');
      return;
    }

    // The relay treats slash commands as server-side room jumps, so every
    // minigame transition stays authoritative and multiplayer-safe.
    EventBus.emit('chat:send', command);
  }

  private captureServerMode(msg: any): void {
    const meta = { ...(msg?.meta || {}) };
    if (msg?.matchState && !meta.matchState) meta.matchState = msg.matchState;
    this.multiplayerRoomKind = String(meta.kind || msg?.kind || this.multiplayerRoomKind || '');
    this.multiplayerMatchPhase = String(meta.matchPhase || msg?.matchPhase || meta.matchState?.state || this.multiplayerMatchPhase || '');

    let dimension = String(msg?.dimension || meta.dimension || '').trim();
    const cbgoMap = String(meta.matchState?.cbgoMap || msg?.matchState?.cbgoMap || '').trim();
    const cbgoPhase = String(meta.matchState?.cbgoPhase || msg?.matchState?.cbgoPhase || '').trim();
    const cbgoMaps = new Set(CBGO_MAPS.map(map => map.id));
    if (meta.minigameId === 'csgo' && dimension === 'cbgo_menu' && cbgoPhase === 'VETO' && cbgoMaps.has(this.worldManager?.currentDimension as any)) {
      return;
    }
    if (meta.minigameId === 'csgo' && dimension === 'cbgo_menu' && cbgoMaps.has(cbgoMap as any) && !['', 'MENU', 'PREGAME', 'POSTGAME', 'VETO'].includes(cbgoPhase)) {
      dimension = cbgoMap;
      meta.dimension = cbgoMap;
    }
    const spawn = msg?.spawn || meta.spawn || meta.pregameSpawn || null;
    let role = String(msg?.role || meta.role || '').trim();

    // If matchState contains spectators list, check if my username is in it
    const myUsername = this.networkManager?.wantedUsername || '';
    if (msg?.matchState?.spectators && Array.isArray(msg.matchState.spectators)) {
      if (myUsername && msg.matchState.spectators.includes(myUsername)) {
        role = 'spectator';
      } else if (myUsername && msg.matchState.alivePlayers && msg.matchState.alivePlayers.includes(myUsername)) {
        role = 'player';
      }
    }

    if (dimension || spawn || msg?.room || role || meta.kind) {
      this.pendingServerMode = {
        dimension: dimension || this.pendingServerMode?.dimension,
        spawn: spawn || this.pendingServerMode?.spawn,
        room: msg?.room || this.pendingServerMode?.room,
        role: role || this.pendingServerMode?.role,
        meta,
        forceSpawn: Boolean(msg?.forceSpawn || msg?.reason === 'respawn' || msg?.type === 'serverJump'),
      };
    }
  }

  private applyPendingServerMode(): void {
    if (!this.pendingServerMode || !this.worldManager || !this.playerController) return;
    if (this.currentWorldId !== 'multiplayer_world' && !this.isWorldLoaded) return;

    const mode = this.pendingServerMode;
    const roomChanged = mode.room && this.lastMultiplayerRoomId !== mode.room;
    const dimensionChanged = mode.dimension && this.worldManager.currentDimension !== mode.dimension;

    if (dimensionChanged || roomChanged) {
      if (mode.room) {
        this.lastMultiplayerRoomId = mode.room;
      }
      if (dimensionChanged) {
        this.worldManager.setDimension(mode.dimension!);
      }
      this.entityManager?.clear();
      this.itemDropManager?.clear();
      const loading = this.beginWorldLoading('Joining room', [
        { id: 'spawn', label: 'Streaming server arena', weight: 1 },
      ]);
      loading.start('spawn', 'Generating server arena...');

      const isMinigame = this.multiplayerRoomKind === 'minigame_match' || this.multiplayerRoomKind === 'minigame_lobby';
      const cbgoOwnsLoadout = mode.dimension?.startsWith('cbgo_') || mode.meta?.minigameId === 'csgo';
      if (isMinigame && this.inventory && !cbgoOwnsLoadout) {
        this.inventory.clear();
      }
    }

    if (mode.spawn) {
      const spawnKey = `${mode.room || ''}|${mode.dimension || ''}|${mode.role || 'player'}|${Math.round(mode.spawn.x)},${Math.round(mode.spawn.y)},${Math.round(mode.spawn.z)}`;
      // Critical BedWars fix: apply server spawn exactly on room/dimension changes,
      // forced match starts, and explicit respawns. Repeated serverInfo/matchState
      // packets must not continuously pull the player back to spawn.
      const shouldApplySpawn = Boolean(mode.forceSpawn || dimensionChanged || roomChanged || !this.lastAppliedServerSpawnKey);
      if (shouldApplySpawn && (mode.forceSpawn || this.lastAppliedServerSpawnKey !== spawnKey)) {
        this.playerController.applyServerSpawn(mode.spawn, mode.role === 'spectator' ? 'spectator' : 'player');
        this.lastAppliedServerSpawnKey = spawnKey;
        this.needsSpawnPlacement = false;
      }
      mode.forceSpawn = false;
    }

    if (mode.role) {
      const isSpec = mode.role === 'spectator';
      if (this.playerController.isSpectator !== isSpec) {
        this.playerController.setSpectatorMode(isSpec);
      }
    }

    if (mode.dimension === 'bedwars' && this.currentWorldId === 'multiplayer_world') {
      this.applyBedWarsLoadout(mode);
      this.ensureBedWarsShopNPCs(mode);
    }

    if (mode.dimension?.startsWith('cbgo_') && this.currentWorldId === 'multiplayer_world' && this.cbgoVoiceEnabledForRoom !== (mode.room || 'cbgo')) {
      this.cbgoVoiceEnabledForRoom = mode.room || 'cbgo';
      EventBus.emit('network:voice:start');
      this.hud.addChatMessage('[CBGO] Voice chat is on by default for tactical callouts.');
    }
  }

  private resolveServerAddress(savedServerIp: string, defaultServerIp: string): string {
    const host = window.location.hostname || 'localhost';
    const isLanClient = host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';

    if (isLanClient && /\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(:|\/|$)/i.test(savedServerIp)) {
      StorageManager.setGlobalData('setting_serverIp', defaultServerIp);
      return defaultServerIp;
    }

    return savedServerIp || defaultServerIp;
  }

  private async loadBaselineSandbox(): Promise<void> {
    const loading = this.beginArenaLoading('Loading sandbox', 'Clearing previous world...');
    try {
      EventBus.emit('baseline:status', 'Clearing menu context.');
      this.hideAllMenuOverlays();
      this.setMenuPreviewVisible(false);

      this.currentWorldId = 'baseline_sandbox';
      this.pendingServerMode = null;
      this.multiplayerRoomKind = '';
      this.multiplayerMatchPhase = '';
      this.lastMultiplayerRoomId = '';
      this.lastAppliedServerSpawnKey = '';
      this.needsSpawnPlacement = false;
      this.cbgoVoiceEnabledForRoom = '';
      this.bedWarsShopMobsSpawnedForRoom = '';
      this.bedWarsLoadoutAppliedForRoom = '';
      this.bedWarsResourceCleanedForKey = '';

      this.worldManager.setDimension('baseline_sandbox');
      this.worldManager.clear();
      this.entityManager.clear();
      this.itemDropManager.clear();
      for (const light of this.activeTorchLights.values()) {
        this.renderer.scene.remove(light);
      }
      this.activeTorchLights.clear();
      loading.complete('prepare', 'Previous world released.');

      EventBus.emit('baseline:status', 'Generating solid floor and walls.');
      loading.start('terrain', 'Building structural arena...');
      await this.worldManager.init(20260613, 4);
      loading.complete('terrain', 'Structural arena generated.');

      loading.start('gameplay', 'Preparing sandbox player...');
      this.inventory.clearPlayerSlots(true);
      this.baseWeapon.enable();
      this.playerController.position.set(0, 5, 0);
      this.playerController.velocity.set(0, 0, 0);
      this.playerController.grounded = false;
      this.playerController.isDead = false;
      this.playerController.setSpectatorMode(false);
      this.playerController.health = this.playerController.maxHealth;
      this.playerController.hunger = this.playerController.maxHunger;
      EventBus.emit('player:healthChanged', this.playerController.health);
      EventBus.emit('player:hungerChanged', this.playerController.hunger);

      this.cameraController.resetView(0, 0);
      this.renderer.cameraGroup.rotation.set(0, 0, 0);
      this.renderer.camera.rotation.set(0, 0, 0);
      this.skySystem.setTime(0.42);
      AudioManager.setBackroomsMode(false);

      this.starterMobsSpawned = true;
      this.starterAdventureBuilt = true;
      this.isWorldLoaded = true;
      this.lastPositionSaveTime = performance.now();
      loading.complete('gameplay', 'Sandbox systems ready.');
      loading.start('spawn', 'Uploading spawn area...');
      EventBus.emit('baseline:joined');
      EventBus.emit('baseline:status', 'Sandbox ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.isWorldLoaded = false;
      this.failWorldLoading(error);
      this.setMenuPreviewVisible(true);
      EventBus.emit('baseline:error', `Sandbox failed to load: ${message}`);
    }
  }

  private async loadTf2Map(dimension: string): Promise<void> {
    const safeDimension = ['tf2_ctf', 'tf2_cp', 'tf2_payload', 'tf2_koth', 'tf2_test'].includes(dimension) ? dimension : 'tf2_test';
    const spawn = this.defaultTf2Spawn(safeDimension);
    const loading = this.beginArenaLoading('Loading Team Fortress 2', 'Clearing previous world...');
    try {
      EventBus.emit('tf2menu:status', 'Clearing menu context.');
      this.hideAllMenuOverlays();
      this.setMenuPreviewVisible(false);

      this.currentWorldId = safeDimension;
      this.pendingServerMode = null;
      this.multiplayerRoomKind = '';
      this.multiplayerMatchPhase = '';
      this.lastMultiplayerRoomId = '';
      this.lastAppliedServerSpawnKey = '';
      this.needsSpawnPlacement = false;
      this.cbgoVoiceEnabledForRoom = '';
      this.bedWarsShopMobsSpawnedForRoom = '';
      this.bedWarsLoadoutAppliedForRoom = '';
      this.bedWarsResourceCleanedForKey = '';

      this.worldManager.setDimension(safeDimension);
      this.worldManager.clear();
      this.entityManager.clear();
      this.itemDropManager.clear();
      for (const light of this.activeTorchLights.values()) {
        this.renderer.scene.remove(light);
      }
      this.activeTorchLights.clear();
      loading.complete('prepare', 'Previous world released.');

      EventBus.emit('tf2menu:status', 'Generating solid floor, walls, bases, lanes, and objectives.');
      loading.start('terrain', 'Building solid combat arena...');
      await this.worldManager.init(20260613, 5);
      loading.complete('terrain', 'Combat arena generated.');

      loading.start('gameplay', 'Preparing class and objective systems...');
      this.baseWeapon.disable();
      this.inventory.clearPlayerSlots(true);
      this.playerController.position.set(spawn.x, spawn.y, spawn.z);
      this.playerController.velocity.set(0, 0, 0);
      this.playerController.grounded = false;
      this.playerController.isDead = false;
      this.playerController.setSpectatorMode(false);
      this.playerController.health = this.playerController.maxHealth;
      this.playerController.hunger = this.playerController.maxHunger;
      EventBus.emit('player:healthChanged', this.playerController.health);
      EventBus.emit('player:hungerChanged', this.playerController.hunger);

      this.cameraController.resetView(safeDimension === 'tf2_ctf' ? Math.PI / 2 : 0, 0);
      this.renderer.cameraGroup.rotation.set(0, 0, 0);
      this.renderer.camera.rotation.set(0, 0, 0);
      this.skySystem.setTime(safeDimension === 'tf2_koth' ? 0.32 : 0.48);
      AudioManager.setBackroomsMode(false);

      this.starterMobsSpawned = true;
      this.starterAdventureBuilt = true;
      this.isWorldLoaded = true;
      this.lastPositionSaveTime = performance.now();
      loading.complete('gameplay', 'TF2 systems ready.');
      loading.start('spawn', 'Uploading combat spawn...');
      EventBus.emit('tf2menu:joined');
      EventBus.emit('tf2menu:status', 'TF2 map ready.');
      this.hud.addChatMessage('[TF2] Press comma for class select. Use 1/2/3 to swap weapons.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.isWorldLoaded = false;
      this.failWorldLoading(error);
      this.setMenuPreviewVisible(true);
      EventBus.emit('tf2menu:error', `TF2 map failed to load: ${message}`);
    }
  }

  private async loadCOBMode(username: string): Promise<void> {
    const loading = this.beginArenaLoading('Loading Call of Block', 'Clearing previous world...');
    try {
      if (this.cobMode?.isActive()) {
        await this.cobMode.leave();
      }

      EventBus.emit('cob:lobbyStatus', {
        state: 'Lobby_Wait',
        countdownMs: 60_000,
        activePlayers: 0,
        humanPlayers: 0,
        mapId: 'cob_lobby',
        mapName: 'COB Lobby',
      });
      this.hideAllMenuOverlays();
      this.setMenuPreviewVisible(false);

      this.currentWorldId = 'cob_lobby';
      this.pendingServerMode = null;
      this.multiplayerRoomKind = '';
      this.multiplayerMatchPhase = '';
      this.lastMultiplayerRoomId = '';
      this.lastAppliedServerSpawnKey = '';
      this.needsSpawnPlacement = false;
      this.cbgoVoiceEnabledForRoom = '';
      this.bedWarsShopMobsSpawnedForRoom = '';
      this.bedWarsLoadoutAppliedForRoom = '';
      this.bedWarsResourceCleanedForKey = '';

      this.worldManager.setDimension('cob_lobby');
      this.worldManager.clear();
      this.entityManager.clear();
      this.itemDropManager.clear();
      for (const light of this.activeTorchLights.values()) {
        this.renderer.scene.remove(light);
      }
      this.activeTorchLights.clear();
      loading.complete('prepare', 'Previous world released.');

      loading.start('terrain', 'Building lobby instance...');
      await this.worldManager.init(20260614, 4);
      loading.complete('terrain', 'Lobby instance generated.');

      loading.start('gameplay', 'Preparing lobby systems...');
      this.baseWeapon.disable();
      this.inventory.clearPlayerSlots(true);
      this.playerController.position.set(0, 75, 96);
      this.playerController.velocity.set(0, 0, 0);
      this.playerController.grounded = false;
      this.playerController.isDead = false;
      this.playerController.setSpectatorMode(false);
      this.playerController.health = this.playerController.maxHealth;
      this.playerController.hunger = this.playerController.maxHunger;
      EventBus.emit('player:healthChanged', this.playerController.health);
      EventBus.emit('player:hungerChanged', this.playerController.hunger);

      this.cameraController.resetView(Math.PI, 0);
      this.renderer.cameraGroup.rotation.set(0, Math.PI, 0);
      this.renderer.camera.rotation.set(0, 0, 0);
      this.skySystem.setTime(0.46);
      AudioManager.setBackroomsMode(false);

      this.starterMobsSpawned = true;
      this.starterAdventureBuilt = true;
      this.isWorldLoaded = true;
      this.lastPositionSaveTime = performance.now();

      await this.cobMode.enterLobby(username);
      loading.complete('gameplay', 'Call of Block lobby ready.');
      loading.start('spawn', 'Uploading lobby spawn...');
      this.hud.addChatMessage('[COB] Modded mode selected. Waiting in lobby.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.isWorldLoaded = false;
      this.failWorldLoading(error);
      this.setMenuPreviewVisible(true);
      EventBus.emit('cob:error', `Call of Block failed to load: ${message}`);
    }
  }

  private async loadCOBMap(mapId: string): Promise<void> {
    if (!this.cobMode?.isActive()) return;
    const safeMapId = mapId === 'cob_frostline_airbase' ? 'cob_frostline_airbase' : 'cob_crossfire_blocks';
    if (this.currentWorldId === safeMapId && this.worldManager.currentDimension === safeMapId) return;

    const loading = this.beginArenaLoading('Loading Call of Block', 'Clearing lobby instance...');
    try {
      this.currentWorldId = safeMapId;
      this.worldManager.setDimension(safeMapId);
      this.worldManager.clear();
      this.entityManager.clear();
      this.itemDropManager.clear();
      for (const light of this.activeTorchLights.values()) {
        this.renderer.scene.remove(light);
      }
      this.activeTorchLights.clear();
      loading.complete('prepare', 'Lobby instance released.');

      const spawn = safeMapId === 'cob_frostline_airbase'
        ? { x: -88, y: 66, z: 0, yaw: Math.PI * 0.5 }
        : { x: -42, y: 65, z: -46, yaw: Math.PI * 0.18 };
      this.playerController.position.set(spawn.x, spawn.y, spawn.z);
      this.playerController.velocity.set(0, 0, 0);
      this.playerController.grounded = false;
      this.cameraController.resetView(spawn.yaw, 0);

      const seed = safeMapId === 'cob_frostline_airbase' ? 20260615 : 20260614;
      loading.start('terrain', `Building ${safeMapId.replace(/^cob_/, '').replace(/_/g, ' ')}...`);
      await this.worldManager.init(seed, 5);
      loading.complete('terrain', 'Combat map generated.');
      loading.start('gameplay', 'Preparing match systems...');
      this.isWorldLoaded = true;
      this.needsSpawnPlacement = false;
      this.skySystem.setTime(safeMapId === 'cob_frostline_airbase' ? 0.34 : 0.48);
      AudioManager.setBackroomsMode(false);
      EventBus.emit('cob:lobbyStatus', {
        state: 'Match_Loading',
        countdownMs: 0,
        activePlayers: 64,
        humanPlayers: 1,
        mapId: safeMapId,
        mapName: safeMapId === 'cob_frostline_airbase' ? 'Frostline Airbase' : 'Crossfire Blocks',
      });
      EventBus.emit('cob:mapLoaded', { mapId: safeMapId });
      loading.complete('gameplay', 'Match systems ready.');
      loading.start('spawn', 'Uploading combat spawn...');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failWorldLoading(error);
      EventBus.emit('cob:error', `COB map failed to load: ${message}`);
    }
  }

  private async leaveCOBMode(): Promise<void> {
    if (!this.cobMode?.isActive()) {
      EventBus.emit('cob:closed');
      return;
    }

    await this.cobMode.leave();
    this.currentWorldId = null;
    this.pendingServerMode = null;
    this.multiplayerRoomKind = '';
    this.multiplayerMatchPhase = '';
    this.lastMultiplayerRoomId = '';
    this.lastAppliedServerSpawnKey = '';
    this.needsSpawnPlacement = false;
    this.cbgoVoiceEnabledForRoom = '';
    this.isWorldLoaded = false;
    this.cancelWorldLoading('Call of Block closed.');
    this.worldManager.clear();
    this.entityManager.clear();
    this.itemDropManager.clear();
    for (const light of this.activeTorchLights.values()) {
      this.renderer.scene.remove(light);
    }
    this.activeTorchLights.clear();
    this.inventory.clearPlayerSlots(true);
    this.setMenuPreviewVisible(true);
    this.hud.addChatMessage('[COB] Left Call of Block. AI and combat audio were cleaned up.');
  }

  private defaultTf2Spawn(dimension: string): { x: number; y: number; z: number } {
    if (dimension === 'tf2_test') return { x: 0, y: 5, z: 0 };
    if (dimension === 'tf2_cp') return { x: -70, y: 68, z: 0 };
    if (dimension === 'tf2_payload') return { x: -72, y: 68, z: 0 };
    if (dimension === 'tf2_koth') return { x: -42, y: 68, z: 0 };
    return { x: -62, y: 68, z: 0 };
  }

  private hideAllMenuOverlays(): void {
    const overlays = Array.from(document.querySelectorAll<HTMLElement>('.screen-overlay'));
    for (const overlay of overlays) {
      overlay.style.display = 'none';
    }
    const death = document.getElementById('death-screen') as HTMLElement | null;
    if (death) death.style.display = 'none';
    const loading = document.getElementById('loading-screen') as HTMLElement | null;
    if (loading) loading.style.display = 'none';
  }

  private async loadSelectedWorld(worldId: string): Promise<void> {
    if (this.isWorldLoaded) {
      await this.saveCurrentPlayerPosition(true);
    }

    const loading = this.beginWorldLoading('Loading world');
    loading.start('metadata', 'Reading world data...');
    this.setMenuPreviewVisible(false);
    StorageManager.setCurrentWorld(worldId);
    this.currentWorldId = worldId;

    if (worldId !== 'multiplayer_world') {
      this.pendingServerMode = null;
      this.multiplayerRoomKind = '';
      this.multiplayerMatchPhase = '';
      this.lastMultiplayerRoomId = '';
      this.lastAppliedServerSpawnKey = '';
      this.bedWarsShopMobsSpawnedForRoom = '';
      this.bedWarsLoadoutAppliedForRoom = '';
      this.bedWarsResourceCleanedForKey = '';
    }

    // 1. Fetch world details
    let seed = '12345';
    if (worldId === 'multiplayer_world') {
      seed = this.multiplayerSeed || '12345';
    } else {
      const meta = await StorageManager.getWorld(worldId);
      if (!meta) {
        this.currentWorldId = null;
        this.cancelWorldLoading('World metadata was not found.');
        this.setMenuPreviewVisible(true);
        return;
      }
      seed = meta.seed;
      await StorageManager.updateWorldMeta(worldId, { lastPlayed: Date.now() });
    }

    const savedDimension = worldId === 'multiplayer_world'
      ? (this.pendingServerMode?.dimension || 'overworld')
      : await StorageManager.getWorldData<string>('player_dimension', 'overworld');
    const targetDimension = worldId === 'multiplayer_world'
      ? (this.pendingServerMode?.dimension || 'overworld')
      : (savedDimension === 'backrooms' ? 'backrooms' : 'overworld');
    if (this.worldManager.currentDimension !== targetDimension) {
      this.worldManager.setDimension(targetDimension);
    }
    AudioManager.setBackroomsMode(targetDimension === 'backrooms');

    const seedNum = this.seedToNumber(seed);
    this.pauseMenu.loadSettings({
      ...this.pauseMenu.getSettings(),
      seed,
    });

    // 2. Fetch options
    const renderDist = await StorageManager.getGlobalData<number>('setting_renderDist', 5);
    this.skySystem.setRenderDistanceChunks(renderDist);
    this.renderer.setWorldViewDistance(renderDist);
    loading.complete('metadata', 'World data loaded.');

    // 3. Clear existing world states
    loading.start('reset', 'Clearing old chunks...');
    this.worldManager.clear();
    this.entityManager.clear();
    this.itemDropManager.clear();
    
    // Clear old lights
    for (const light of this.activeTorchLights.values()) {
      this.renderer.scene.remove(light);
    }
    this.activeTorchLights.clear();
    loading.complete('reset', 'Previous world released.');

    // 4. Re-init world manager. Multiplayer rooms must set their server
    // dimension before chunk generation starts, otherwise CrownForge can
    // accidentally generate survival terrain around spawn.
    loading.start('terrain', 'Building terrain generator...');
    if (worldId === 'multiplayer_world' && this.pendingServerMode?.dimension) {
      this.worldManager.setDimension(this.pendingServerMode.dimension);
    }
    await this.worldManager.init(seedNum, renderDist);
    loading.complete('terrain', 'Terrain generator ready.');

    // 5. Reload inventory
    loading.start('gameplay', 'Loading player inventory...');
    await this.inventory.loadFromStorage();
    await this.furnaceManager.init(worldId);
    await this.brewingManager.init(worldId);

    // 6. Reset player position
    const multiplayerSpawn = worldId === 'multiplayer_world' ? this.pendingServerMode?.spawn : null;
    const savedPos = worldId === 'multiplayer_world'
      ? null
      : await StorageManager.getWorldData<{x: number; y: number; z: number} | null>('player_pos', null);
    if (multiplayerSpawn) {
      if (this.pendingServerMode?.dimension) {
        this.worldManager.setDimension(this.pendingServerMode.dimension);
      }
      this.playerController.applyServerSpawn(multiplayerSpawn, this.pendingServerMode?.role === 'spectator' ? 'spectator' : 'player');
      this.lastAppliedServerSpawnKey = `${this.pendingServerMode?.room || ''}|${this.pendingServerMode?.dimension || ''}|${this.pendingServerMode?.role || 'player'}|${Math.round(multiplayerSpawn.x)},${Math.round(multiplayerSpawn.y)},${Math.round(multiplayerSpawn.z)}`;
      this.needsSpawnPlacement = false;
    } else if (savedPos) {
      this.playerController.position.set(savedPos.x, savedPos.y, savedPos.z);
      this.needsSpawnPlacement = false;
    } else {
      // Start high, then snap to the first safe generated surface once the
      // spawn column exists. This avoids spawning inside tall terrain.
      this.playerController.position.set(8, 72, 8);
      this.needsSpawnPlacement = true;
    }
    this.cameraController.resetView(0, 0);
    this.renderer.cameraGroup.rotation.set(0, 0, 0);
    this.renderer.camera.rotation.set(0, 0, 0);
    this.playerController.velocity.set(0, 0, 0);
    this.playerController.grounded = false;
    
    // Reset spawner flags
    this.starterMobsSpawned = false;
    this.starterAdventureBuilt = false;
    this.adventureDirectorTimer = 0;
    this.adventureEventTimer = 0;
    this.adventureMilestones.clear();
    this.isWorldLoaded = true;
    this.lastPositionSaveTime = performance.now();
    
    // Scan torches immediately
    this.updateTorchLights();
    loading.complete('gameplay', 'Gameplay state restored.');
    loading.start('spawn', 'Generating spawn area...');
  }

  private async unloadCurrentWorldToMenu(): Promise<void> {
    if (this.isWorldLoaded) {
      await this.saveCurrentPlayerPosition(true);
    }

    this.isWorldLoaded = false;
    this.cancelWorldLoading('World unloaded.');
    this.currentWorldId = null;
    this.pendingServerMode = null;
    this.multiplayerRoomKind = '';
    this.multiplayerMatchPhase = '';
    this.lastMultiplayerRoomId = '';
    this.lastAppliedServerSpawnKey = '';
    this.bedWarsShopMobsSpawnedForRoom = '';
    this.bedWarsLoadoutAppliedForRoom = '';
    this.bedWarsResourceCleanedForKey = '';
    this.setLoadingScreen(false);

    this.worldManager.clear();
    this.entityManager.clear();
    this.itemDropManager.clear();
    for (const light of this.activeTorchLights.values()) {
      this.renderer.scene.remove(light);
    }
    this.activeTorchLights.clear();
    AudioManager.setBackroomsMode(false);
    this.setMenuPreviewVisible(true);
  }

  private seedToNumber(seed: string): number {
    const direct = Number(seed);
    if (Number.isFinite(direct)) return direct;

    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return hash || 12345;
  }

  private async saveCurrentPlayerPosition(force = false): Promise<void> {
    if (!this.isWorldLoaded || !this.playerController) return;
    if (this.currentWorldId === 'baseline_sandbox') return;
    if (this.currentWorldId?.startsWith('tf2_')) return;
    if (this.currentWorldId === 'multiplayer_world') return;
    const now = performance.now();
    if (!force && now - this.lastPositionSaveTime < 2000) return;

    const pos = this.playerController.position;
    this.lastPositionSaveTime = now;
    if (force) {
      await this.worldManager.flushChunkModifications();
    }
    await StorageManager.setWorldData('player_pos', { x: pos.x, y: pos.y, z: pos.z });
    await StorageManager.setWorldData('player_dimension', this.worldManager.currentDimension || 'overworld');
  }

  private setLoadingScreen(show: boolean, title = 'Loading world', status = 'Preparing spawn area...', progress = 0): void {
    const screen = document.getElementById('loading-screen');
    const titleEl = document.getElementById('loading-title');
    const statusEl = document.getElementById('loading-status');
    const fill = document.getElementById('loading-bar-fill');
    if (!screen) return;

    screen.style.display = show ? 'flex' : 'none';
    if (titleEl) titleEl.textContent = title;
    if (statusEl) statusEl.textContent = status;
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    if (show) {
      InputManager.isUIActive = true;
      InputManager.unlockPointer();
    }
  }

  private beginWorldLoading(title: string, tasks: readonly LoadingTaskDefinition[] = [
    { id: 'metadata', label: 'Reading world data', weight: 12 },
    { id: 'reset', label: 'Releasing previous world', weight: 8 },
    { id: 'terrain', label: 'Building terrain generator', weight: 18 },
    { id: 'gameplay', label: 'Restoring gameplay state', weight: 12 },
    { id: 'spawn', label: 'Streaming spawn area', weight: 50 },
  ]): LoadingSession {
    this.cancelWorldLoading('Superseded by a new world load.', false);
    const session = new LoadingSession(tasks);
    this.worldLoading = session;
    this.stopWorldLoadingUpdates = session.subscribe((snapshot) => this.renderWorldLoading(title, snapshot));
    return session;
  }

  private beginArenaLoading(title: string, detail: string): LoadingSession {
    const session = this.beginWorldLoading(title, [
      { id: 'prepare', label: 'Preparing world', weight: 15 },
      { id: 'terrain', label: 'Generating arena', weight: 35 },
      { id: 'gameplay', label: 'Preparing gameplay', weight: 10 },
      { id: 'spawn', label: 'Streaming spawn area', weight: 40 },
    ]);
    session.start('prepare', detail);
    return session;
  }

  private renderWorldLoading(title: string, snapshot: LoadingSnapshot): void {
    if (snapshot.state === 'cancelled') return;
    const active = snapshot.activeTask;
    const status = active?.detail || active?.label || (snapshot.state === 'complete' ? 'Done' : 'Preparing...');
    this.setLoadingScreen(snapshot.state !== 'complete', title, status, snapshot.progress * 100);
  }

  private cancelWorldLoading(reason: string, hide = true): void {
    this.stopWorldLoadingUpdates?.();
    this.stopWorldLoadingUpdates = null;
    this.worldLoading?.cancel(reason);
    this.worldLoading = null;
    if (hide) this.setLoadingScreen(false);
  }

  private failWorldLoading(error: unknown): void {
    if (this.worldLoading && this.worldLoading.state !== 'failed') {
      this.worldLoading.failActive(error);
    }
    this.stopWorldLoadingUpdates?.();
    this.stopWorldLoadingUpdates = null;
    this.worldLoading = null;
    this.setLoadingScreen(false);
  }

  private completeWorldLoading(): void {
    this.stopWorldLoadingUpdates?.();
    this.stopWorldLoadingUpdates = null;
    this.worldLoading = null;
    this.setLoadingScreen(false);
  }

  private get isLoadingWorld(): boolean {
    return this.worldLoading !== null
      && this.worldLoading.state !== 'complete'
      && this.worldLoading.state !== 'failed'
      && this.worldLoading.state !== 'cancelled';
  }

  private createMenuPreviewWorld(): void {
    if (this.menuPreviewGroup) return;

    const group = new THREE.Group();
    group.name = 'menu-preview-world';

    const box = new THREE.BoxGeometry(1, 1, 1);
    const grass = new THREE.MeshLambertMaterial({ color: 0x5a7f3f });
    const stoneBricks = new THREE.MeshLambertMaterial({ color: 0x7c7c7c });
    const mossyBricks = new THREE.MeshLambertMaterial({ color: 0x5b6d54 });
    const woodLog = new THREE.MeshLambertMaterial({ color: 0x503b29 });
    const planks = new THREE.MeshLambertMaterial({ color: 0x9b7653 });
    const redWool = new THREE.MeshLambertMaterial({ color: 0xa92727 });
    const yellowWool = new THREE.MeshLambertMaterial({ color: 0xe6a817 });
    const wheat = new THREE.MeshLambertMaterial({ color: 0xcca33c });
    const waterMat = new THREE.MeshLambertMaterial({ color: 0x2e6cb5, transparent: true, opacity: 0.72 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x7a3a29 });

    const addCube = (x: number, y: number, z: number, mat: THREE.Material, scale: [number, number, number] = [1, 1, 1]) => {
      const mesh = new THREE.Mesh(box, mat);
      mesh.position.set(x, y, z);
      mesh.scale.set(...scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    };

    // 1. Draw circular island base
    for (let x = -15; x <= 15; x++) {
      for (let z = -15; z <= 15; z++) {
        const dist = Math.hypot(x, z);
        if (dist <= 14) {
          // Grass top
          addCube(x, 0, z, grass);
          // Dirt below
          addCube(x, -1, z, new THREE.MeshLambertMaterial({ color: 0x664422 }));
        } else if (dist <= 15.5) {
          // Water edge
          addCube(x, -0.4, z, waterMat, [1, 0.2, 1]);
        }
      }
    }

    // 2. Castle Keep (center 0,0)
    addCube(0, 1.5, 0, stoneBricks, [4, 3, 4]); // central keep
    addCube(0, 3.2, 0, mossyBricks, [3, 0.6, 3]); // top battlements

    // Flagpole
    addCube(0, 4.0, 0, woodLog, [0.1, 1.2, 0.1]);
    addCube(0.35, 4.4, 0, redWool, [0.6, 0.4, 0.1]);

    // Castle Walls (6x6 outline)
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        const isWall = Math.abs(x) === 3 || Math.abs(z) === 3;
        const isGate = x === 0 && z === -3; // opening for gateway
        if (isWall && !isGate) {
          addCube(x, 1, z, stoneBricks, [1, 2, 1]);
        }
      }
    }

    // Four corner towers
    const towerCoords = [[-3, -3], [3, -3], [-3, 3], [3, 3]];
    for (const [tx, tz] of towerCoords) {
      addCube(tx, 1.75, tz, stoneBricks, [1.2, 3.5, 1.2]); // tower body
      // Tower pointed roof
      addCube(tx, 3.65, tz, roofMat, [1.4, 0.5, 1.4]);
      // Tiny flag on top
      addCube(tx, 4.0, tz, woodLog, [0.05, 0.3, 0.05]);
      addCube(tx + 0.12, 4.1, tz, yellowWool, [0.22, 0.14, 0.05]);
    }

    // 3. Village Cottages
    // Cottage 1 (Birch planks + Oak logs corners)
    const cx1 = 7, cz1 = 6;
    addCube(cx1, 1, cz1, planks, [3, 2, 3]);
    // Roof
    addCube(cx1, 2.2, cz1, roofMat, [3.4, 0.6, 3.4]);
    // Door
    addCube(cx1, 0.6, cz1 - 1.51, woodLog, [0.6, 1.2, 0.1]);

    // Cottage 2
    const cx2 = -7, cz2 = -6;
    addCube(cx2, 1, cz2, mossyBricks, [3, 2, 3]);
    addCube(cx2, 2.2, cz2, roofMat, [3.4, 0.6, 3.4]);
    // Door
    addCube(cx2 + 1.51, 0.6, cz2, woodLog, [0.1, 1.2, 0.6]);

    // 4. Village Crops / Farm Patch
    const fx = 7, fz = -7;
    // Fence outline
    for (let dx = -2; dx <= 2; dx++) {
      addCube(fx + dx, 0.6, fz - 2, woodLog, [0.1, 0.4, 0.1]);
      addCube(fx + dx, 0.6, fz + 2, woodLog, [0.1, 0.4, 0.1]);
      addCube(fx - 2, 0.6, fz + dx, woodLog, [0.1, 0.4, 0.1]);
      addCube(fx + 2, 0.6, fz + dx, woodLog, [0.1, 0.4, 0.1]);
    }
    // Crops inside
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const mat = (dx + dz) % 2 === 0 ? grass : wheat;
        addCube(fx + dx, 0.6, fz + dz, mat, [0.4, 0.4, 0.4]);
      }
    }

    // 5. Paths
    const pathMat = new THREE.MeshLambertMaterial({ color: 0xcdba96 });
    // Castle to Cottage 1 path
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const px = THREE.MathUtils.lerp(0, cx1, t);
      const pz = THREE.MathUtils.lerp(-2, cz1 - 2, t);
      addCube(px, 0.06, pz, pathMat, [1.2, 0.05, 1.2]);
    }

    // 6. Lights
    // Sunset Directional Light (Warm orange)
    const sunsetLight = new THREE.DirectionalLight(0xff7722, 1.8);
    sunsetLight.position.set(-20, 10, 10);
    sunsetLight.castShadow = true;
    sunsetLight.shadow.mapSize.width = 1024;
    sunsetLight.shadow.mapSize.height = 1024;
    group.add(sunsetLight);

    // Warm torch PointLights (placed at castle gate and cottages)
    const torchColor = 0xffa500;
    const p1 = new THREE.PointLight(torchColor, 1.6, 8);
    p1.position.set(0, 1.5, -2.8); // castle gate
    group.add(p1);

    const p2 = new THREE.PointLight(torchColor, 1.4, 6);
    p2.position.set(cx1, 1.2, cz1 - 1.6); // cottage 1 door
    group.add(p2);

    const p3 = new THREE.PointLight(torchColor, 1.4, 6);
    p3.position.set(cx2 + 1.6, 1.2, cz2); // cottage 2 door
    group.add(p3);

    group.add(new THREE.HemisphereLight(0x334466, 0x111122, 0.5)); // twilight ambient fill

    this.renderer.scene.add(group);
    this.menuPreviewGroup = group;
    this.setMenuPreviewVisible(true);
  }

  private setMenuPreviewVisible(visible: boolean): void {
    if (this.menuPreviewGroup) {
      this.menuPreviewGroup.visible = visible;
    }
    if (!visible) {
      this.cameraController.resetView(0, 0);
      this.renderer.cameraGroup.rotation.set(0, 0, 0);
      this.renderer.camera.rotation.set(0, 0, 0);
    }
  }

  private updateMenuPreview(dt: number): void {
    if (!this.menuPreviewGroup) return;

    this.menuPreviewClock += dt;
    const radius = 18;
    const angle = this.menuPreviewClock * 0.08;
    this.renderer.cameraGroup.position.set(Math.cos(angle) * radius, 9, Math.sin(angle) * radius);
    this.renderer.cameraGroup.lookAt(0, 3, 0);
    this.renderer.camera.rotation.set(0, 0, 0);
  }

  private updateTorchLights() {
    if (this.pauseMenu.isMainMenuActive()) return;

    const playerPos = this.playerController.position;
    const reach = 24;
    const chunkSize = 16;
    const reachSq = reach * reach;

    const minX = Math.floor(playerPos.x - reach);
    const maxX = Math.floor(playerPos.x + reach);
    const minY = Math.floor(playerPos.y - reach);
    const maxY = Math.floor(playerPos.y + reach);
    const minZ = Math.floor(playerPos.z - reach);
    const maxZ = Math.floor(playerPos.z + reach);

    const closeTorches = new Set<string>();

    for (const chunk of this.worldManager.chunks.values()) {
      const chunkMinX = chunk.x * chunkSize;
      const chunkMinY = chunk.y * chunkSize;
      const chunkMinZ = chunk.z * chunkSize;
      const chunkMaxX = chunkMinX + chunkSize - 1;
      const chunkMaxY = chunkMinY + chunkSize - 1;
      const chunkMaxZ = chunkMinZ + chunkSize - 1;

      if (chunkMaxX < minX || chunkMinX > maxX ||
          chunkMaxY < minY || chunkMinY > maxY ||
          chunkMaxZ < minZ || chunkMinZ > maxZ) {
        continue;
      }

      const localMinX = Math.max(0, minX - chunkMinX);
      const localMaxX = Math.min(15, maxX - chunkMinX);
      const localMinY = Math.max(0, minY - chunkMinY);
      const localMaxY = Math.min(15, maxY - chunkMinY);
      const localMinZ = Math.max(0, minZ - chunkMinZ);
      const localMaxZ = Math.min(15, maxZ - chunkMinZ);

      for (let ly = localMinY; ly <= localMaxY; ly++) {
        const worldY = chunkMinY + ly;
        const dy = worldY - playerPos.y;
        const ySq = dy * dy;
        if (ySq > reachSq) continue;

        for (let z = localMinZ; z <= localMaxZ; z++) {
          const worldZ = chunkMinZ + z;
          const dz = worldZ - playerPos.z;
          const yzSq = ySq + dz * dz;
          if (yzSq > reachSq) continue;

          for (let x = localMinX; x <= localMaxX; x++) {
            const worldX = chunkMinX + x;
            const dx = worldX - playerPos.x;
            if (dx * dx + yzSq > reachSq) continue;

            const idx = x + (ly << 4) + (z << 8);
            if (chunk.voxels[idx] === 21) {
              closeTorches.add(`${worldX},${worldY},${worldZ}`);
              if (closeTorches.size >= 16) break;
            }
          }
          if (closeTorches.size >= 16) break;
        }
        if (closeTorches.size >= 16) break;
      }
      if (closeTorches.size >= 16) break;
    }

    // Remove distant lights. The snapshot avoids iterator mutation issues when
    // Three.js callbacks or debug overlays inspect the same map during removal.
    for (const [key, light] of Array.from(this.activeTorchLights.entries())) {
      if (!closeTorches.has(key)) {
        this.renderer.scene.remove(light);
        light.dispose?.();
        this.activeTorchLights.delete(key);
      }
    }

    for (const key of closeTorches) {
      if (this.activeTorchLights.size >= 16) break;
      if (this.activeTorchLights.has(key)) continue;

      const [xs, ys, zs] = key.split(',');
      const x = Number(xs), y = Number(ys), z = Number(zs);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

      const light = new THREE.PointLight(0xff9944, 2.0, 12, 1.2);
      light.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.renderer.scene.add(light);
      this.activeTorchLights.set(key, light);
    }
  }


  private emitAdventureOnce(key: string, message: string): void {
    if (this.adventureMilestones.has(key)) return;
    this.adventureMilestones.add(key);
    this.hud.addChatMessage(message);
  }

  private countInventoryItem(itemId: number): number {
    let total = 0;
    for (let i = 0; i < 37; i++) {
      const stack = this.inventory.getSlot(i);
      if (stack?.id === itemId) total += stack.count;
    }
    return total;
  }


  private openBedWarsShopFromButton(payload?: { kind?: 'itemShop' | 'teamUpgrades' }): void {
    const dimension = String(this.worldManager?.currentDimension || this.pendingServerMode?.dimension || '').toLowerCase();
    if (!dimension.includes('bedwars')) {
      this.hud?.addChatMessage?.('[BedWars] The shop button only works inside BedWars.');
      return;
    }
    const kind = payload?.kind === 'teamUpgrades' ? 'teamUpgrades' : 'itemShop';
    const team = this.getMyBedWarsTeam(this.pendingServerMode as any);
    EventBus.emit('ui:openBedWarsShop', {
      team,
      kind,
      villagerId: `button-${team}-${kind}`,
      source: 'button',
    });
  }

  private createShopSignTexture(text: string, subtitle: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#6b3f18';
    ctx.fillRect(12, 12, canvas.width - 24, canvas.height - 24);
    ctx.strokeStyle = '#120805';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
    ctx.fillStyle = '#ffe08a';
    ctx.font = 'bold 38px Courier New, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, 70);
    ctx.fillStyle = '#fff5c8';
    ctx.font = 'bold 26px Courier New, monospace';
    ctx.fillText(subtitle, canvas.width / 2, 122);
    ctx.fillStyle = '#d2aa62';
    ctx.font = '18px Courier New, monospace';
    ctx.fillText('No villager aiming needed', canvas.width / 2, 158);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private ensureBedWarsShopSigns(mode: { room?: string; dimension?: string; meta?: any }): void {
    if (mode.dimension !== 'bedwars') return;
    const room = mode.room || this.lastMultiplayerRoomId || 'bedwars';
    if (this.bedWarsShopSignsForRoom === room && this.bedWarsShopSignGroup?.parent) return;

    if (this.bedWarsShopSignGroup) {
      this.renderer.scene.remove(this.bedWarsShopSignGroup);
      this.bedWarsShopSignGroup.traverse((obj: THREE.Object3D) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose?.();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((mat: any) => {
            mat.map?.dispose?.();
            mat.dispose?.();
          });
        }
      });
    }

    const group = new THREE.Group();
    group.name = 'bedwars-shop-button-signs';
    const geometry = new THREE.PlaneGeometry(4.4, 1.65);

    for (const npc of CROWNFORGE_BEDWARS_SHOP_NPCS) {
      const isUpgrade = npc.kind === 'teamUpgrades';
      const texture = this.createShopSignTexture(isUpgrade ? 'TEAM UPGRADES' : 'ITEM SHOP', isUpgrade ? 'CLICK TOP-RIGHT BUTTON' : 'CLICK TOP-RIGHT BUTTON');
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: false, side: THREE.DoubleSide });
      const sign = new THREE.Mesh(geometry.clone(), material);
      sign.name = `bedwars-shop-sign-${npc.team}-${npc.kind}`;
      sign.position.set(npc.x, npc.y + 2.55, npc.z);
      sign.rotation.y = npc.yaw;
      group.add(sign);

      const postGeo = new THREE.BoxGeometry(0.18, 1.4, 0.18);
      const postMat = new THREE.MeshBasicMaterial({ color: 0x3a2410 });
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(npc.x, npc.y + 1.35, npc.z);
      post.name = `bedwars-shop-sign-post-${npc.team}-${npc.kind}`;
      group.add(post);
    }

    this.renderer.scene.add(group);
    this.bedWarsShopSignGroup = group;
    this.bedWarsShopSignsForRoom = room;
  }

  private getMyBedWarsTeam(mode?: { meta?: any; bedWarsTeam?: string }): 'Red' | 'Blue' | 'Green' | 'Yellow' {
    const meta = mode?.meta || this.pendingServerMode?.meta || {};
    const direct = String((mode as any)?.bedWarsTeam || meta.bedWarsTeam || meta.team || '').toLowerCase();
    if (['red', 'blue', 'green', 'yellow'].includes(direct)) return (direct[0].toUpperCase() + direct.slice(1)) as any;

    const username = String(this.networkManager?.wantedUsername || '').toLowerCase();
    const teams = meta.matchState?.teams || meta.teams || {};
    for (const [teamName, teamState] of Object.entries<any>(teams)) {
      const players = [
        ...(Array.isArray(teamState?.players) ? teamState.players : []),
        ...(Array.isArray(teamState?.alivePlayers) ? teamState.alivePlayers : []),
      ];
      if (players.some((p: any) => String(p).toLowerCase() === username)) {
        return teamName as any;
      }
    }
    return 'Red';
  }

  private teamColor(team: string): string {
    const colors: Record<string, string> = { Red: '#ff3f4f', Blue: '#4a86ff', Green: '#43d96b', Yellow: '#fff05a' };
    return colors[team] || '#ffffff';
  }

  private getBedWarsRoundKey(mode: { room?: string; meta?: any }): string {
    const room = mode.room || this.lastMultiplayerRoomId || 'bedwars';
    const meta = mode.meta || {};
    const startedAt = Number(meta.startedAt || meta.matchState?.startedAt || 0);
    const phase = String(meta.matchPhase || this.multiplayerMatchPhase || meta.matchState?.state || '').toUpperCase();
    const countdown = Number(meta.matchState?.countdown ?? -1);
    return `${room}|${startedAt || 'pregame'}|${phase || 'UNKNOWN'}|${countdown <= 0 ? 'live' : 'queue'}`;
  }

  private clearBedWarsCarryover(mode: { room?: string; meta?: any }, hardReset = false): void {
    if (!this.inventory) return;
    const key = this.getBedWarsRoundKey(mode);
    if (!hardReset && this.bedWarsResourceCleanedForKey === key) return;
    this.bedWarsResourceCleanedForKey = key;

    const ids = [
      202, // Iron Ingot
      203, // Gold Ingot
      204, // Diamond
      471, // Emerald fallback
      getFeatureItemId('Emerald'),
      getFeatureItemId('Iron Ingot'),
      getFeatureItemId('Gold Ingot'),
      getFeatureItemId('Diamond'),
    ].filter((id): id is number => Number.isFinite(id) && !!id && id > 0);

    if (hardReset) {
      this.inventory.clearPlayerSlots(true);
    } else {
      this.inventory.removeAllByIds(ids, true);
    }
  }

  private applyBedWarsLoadout(mode: { room?: string; meta?: any }): void {
    if (!this.inventory) return;
    const phase = String(mode.meta?.matchPhase || this.multiplayerMatchPhase || mode.meta?.matchState?.state || '').toUpperCase();
    const matchIsLive = phase === 'IN_MATCH' || phase === 'STARTING' || phase === 'SUDDEN_DEATH' || phase === 'LIVE';
    const roundKey = this.getBedWarsRoundKey(mode);

    // Always strip currency carryover when entering/refreshing BedWars. A full
    // reset is reserved for a new live round so a previous game's iron/gold can
    // never leak into the next match.
    this.clearBedWarsCarryover(mode, matchIsLive && this.bedWarsLoadoutAppliedForRoom !== roundKey);
    if (this.bedWarsLoadoutAppliedForRoom === roundKey) return;
    this.bedWarsLoadoutAppliedForRoom = roundKey;

    if (!matchIsLive) return;

    const team = this.getMyBedWarsTeam(mode as any);
    const tint = this.teamColor(team);
    const armorNames = ['Leather Helmet', 'Leather Chestplate', 'Leather Leggings', 'Leather Boots'];
    armorNames.forEach((name, idx) => {
      const id = getFeatureItemId(name);
      if (!id) return;
      this.inventory.setSlot(37 + idx, { id, count: 1, customName: `${team} ${name}`, tint, team });
    });
    const woodenSword = 250;
    if (!this.inventory.hasItem(woodenSword, 1, true)) this.inventory.addItem(woodenSword, 1);
  }

  private ensureBedWarsShopNPCs(mode: { room?: string; dimension?: string; meta?: any }): void {
    if (!this.entityManager || mode.dimension !== 'bedwars') return;
    const room = mode.room || this.lastMultiplayerRoomId || 'bedwars';
    let missing = 0;

    for (const npc of CROWNFORGE_BEDWARS_SHOP_NPCS) {
      const shopPos = new THREE.Vector3(npc.x, npc.y, npc.z);
      const idPrefix = npc.kind === 'itemShop' ? 'item-shop' : 'team-upgrades';
      const expectedId = `bedwars-${idPrefix}-${npc.team.toLowerCase()}`;
      let mob = this.entityManager.localMobs.find((m: any) => m.id === expectedId || ((m as any).staticShop && (m as any).shopTeam === npc.team && (m as any).shopKind === npc.kind));

      if (!mob) {
        missing++;
        const mobId = this.entityManager.spawnMob(shopPos, 'villager', { id: expectedId, skipGroundSnap: true });
        mob = this.entityManager.localMobs.find((m: any) => m.id === mobId);
      }
      if (!mob) continue;

      (mob as any).staticShop = true;
      (mob as any).shopTeam = npc.team;
      (mob as any).shopKind = npc.kind;
      (mob as any).displayName = npc.kind === 'itemShop' ? `${npc.team} Item Shop` : `${npc.team} Team Upgrades`;
      mob.position.copy(shopPos);
      mob.velocity.set(0, 0, 0);
      mob.rotation.y = npc.yaw;
      mob.aiState = 'shop';
      mob.health = mob.maxHealth;
      mob.isDead = false;
    }

    this.ensureBedWarsShopSigns(mode);

    if (missing > 0 || this.bedWarsShopMobsSpawnedForRoom !== room) {
      this.bedWarsShopMobsSpawnedForRoom = room;
      this.hud?.addChatMessage?.('[BedWars] Shops are opened with the top-right buttons now. The signs above the shop stands explain it in-game.');
    }
  }

  private spawnAdventureDrop(pos: THREE.Vector3, id: number, count: number): void {
    const velocity = new THREE.Vector3((Math.random() - 0.5) * 1.8, 2.4 + Math.random() * 0.8, (Math.random() - 0.5) * 1.8);
    this.itemDropManager.spawn(pos.clone().add(new THREE.Vector3(0, 1.0, 0)), id, count, { velocity, pickupDelay: 1.8 });
  }

  private buildStarterAdventureSite(): void {
    if (this.starterAdventureBuilt || !this.worldManager.isColumnReady(this.playerController.position)) return;

    const site = this.worldManager.findGroundSpawnNear(this.playerController.position.clone().add(new THREE.Vector3(9, 0, 7)), 6, 16);
    if (!site) return;

    const cx = Math.floor(site.x);
    const cy = Math.floor(site.y);
    const cz = Math.floor(site.z);
    const plank = 15;
    const log = 4;
    const torch = 21;
    const chest = 23;
    const glass = 11;

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        this.worldManager.setVoxel(cx + dx, cy - 1, cz + dz, plank, true);
        this.worldManager.setVoxel(cx + dx, cy, cz + dz, 0, true);
        this.worldManager.setVoxel(cx + dx, cy + 1, cz + dz, 0, true);
      }
    }

    for (const [dx, dz] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as Array<[number, number]>) {
      this.worldManager.setVoxel(cx + dx, cy, cz + dz, log, true);
      this.worldManager.setVoxel(cx + dx, cy + 1, cz + dz, torch, true);
    }
    this.worldManager.setVoxel(cx, cy, cz, chest, true);
    this.worldManager.setVoxel(cx + 1, cy, cz, glass, true);

    const dropBase = new THREE.Vector3(cx + 0.5, cy, cz + 0.5);
    this.spawnAdventureDrop(dropBase.clone().add(new THREE.Vector3(-0.7, 0, 0.2)), 280, 4); // apples
    this.spawnAdventureDrop(dropBase.clone().add(new THREE.Vector3(0.7, 0, -0.2)), 281, 3); // bread
    this.spawnAdventureDrop(dropBase.clone().add(new THREE.Vector3(0.0, 0, 0.8)), 21, 12); // torches
    this.spawnAdventureDrop(dropBase.clone().add(new THREE.Vector3(0.0, 0, -0.8)), 220, 1); // wooden pickaxe

    this.entityManager.spawnMob(dropBase.clone().add(new THREE.Vector3(4, 1, 2)), 'pig');
    this.entityManager.spawnMob(dropBase.clone().add(new THREE.Vector3(-4, 1, -2)), 'sheep');
    this.hud.addChatMessage('[Adventure] A small starter camp was found nearby. Loot it, light it, and survive the first night.');
    this.starterAdventureBuilt = true;
  }

  private runAdventureDirector(dt: number): void {
    if (this.pauseMenu.isMainMenuActive()) return;
    if (this.worldManager.currentDimension === 'backrooms') return;
    if (this.isProtectedMultiplayerRoom()) return;
    if (this.currentWorldId === 'multiplayer_world' && !this.isMultiplayerMobAuthority) return;

    this.buildStarterAdventureSite();

    this.adventureDirectorTimer += dt;
    this.adventureEventTimer += dt;

    if (this.adventureDirectorTimer >= 8.0) {
      this.adventureDirectorTimer = 0;
      const woodCount = this.countInventoryItem(4) + this.countInventoryItem(15);
      const stoneCount = this.countInventoryItem(3);
      const torchCount = this.countInventoryItem(21);
      const diamondCount = this.countInventoryItem(204);
      const time = this.skySystem.getTime();
      const isNight = time > 0.73 || time < 0.27;

      this.emitAdventureOnce('intro', '[Goals] Build shelter, craft tools, explore caves, find diamonds, and follow the old imperial roads toward ruined keeps.');
      this.emitAdventureOnce('fallenEmpire', '[Lore] The Ashen Crown broke here. Castles, crypts, roads, and abandoned village-states now hide loot, danger, and clues.');
      if (woodCount >= 8) this.emitAdventureOnce('wood', '[Goal Complete] Wood secured. Upgrade your base, craft tools, and prep torches.');
      if (stoneCount >= 12) this.emitAdventureOnce('stone', '[Goal Complete] Stone age. Caves and fortress ruins now matter: hunt coal, iron, relics, and diamonds.');
      if (torchCount >= 8) this.emitAdventureOnce('torches', '[Goal Complete] Light source ready. Push deeper underground without getting swarmed.');
      if (diamondCount >= 1) this.emitAdventureOnce('diamond', '[Goal Complete] Diamond found. You are entering boss-prep territory now.');
      if (isNight) this.emitAdventureOnce('firstNight', '[Danger] Night is hostile. Stay lit, keep moving, and listen for creepers.');
    }

    // Every so often, add a small authored event so survival has momentum.
    if (this.adventureEventTimer >= 75.0) {
      this.adventureEventTimer = 0;
      const playerPos = this.playerController.position;
      const time = this.skySystem.getTime();
      const isNight = time > 0.73 || time < 0.27;
      const site = this.worldManager.findGroundSpawnNear(playerPos, 12, 28);
      if (!site) return;

      if (isNight) {
        const hostileTypes: Array<'zombie' | 'skeleton' | 'creeper' | 'spider'> = ['zombie', 'skeleton', 'creeper', 'spider'];
        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
          const angle = (Math.PI * 2 * i) / 4 + Math.random() * 0.6;
          const mobPos = site.clone().add(new THREE.Vector3(Math.cos(angle) * 2.5, 1, Math.sin(angle) * 2.5));
          this.entityManager.spawnMob(mobPos, hostileTypes[Math.floor(Math.random() * hostileTypes.length)]);
        }
        this.hud.addChatMessage('[Event] A hostile pack heard you. Fight, flee, or use terrain.');
      } else {
        const dropRoll = Math.random();
        if (dropRoll < 0.45) {
          this.spawnAdventureDrop(site, 201, 4 + Math.floor(Math.random() * 5)); // coal
          this.spawnAdventureDrop(site.clone().add(new THREE.Vector3(0.8, 0, 0.2)), 202, 2); // iron ingots
          this.hud.addChatMessage('[Event] A surface cache glittered nearby. Grab it before nightfall.');
        } else {
          this.entityManager.spawnMob(site.clone().add(new THREE.Vector3(1, 1, 0)), 'cow');
          this.entityManager.spawnMob(site.clone().add(new THREE.Vector3(-1, 1, 0)), 'pig');
          this.entityManager.spawnMob(site.clone().add(new THREE.Vector3(0, 1, 1)), 'sheep');
          this.hud.addChatMessage('[Event] A passive herd wandered in. Food, wool, and leather are on the table.');
        }
      }
    }
  }

  private runBackroomsDirector(dt: number): void {
    if (this.pauseMenu.isMainMenuActive()) return;
    if (this.worldManager.currentDimension !== 'backrooms') return;
    if (this.currentWorldId === 'multiplayer_world' && !this.isMultiplayerMobAuthority) return;

    this.backroomsHorrorTimer += dt;
    this.backroomsWhisperTimer += dt;
    this.backroomsScreamTimer += dt;

    const player = this.playerController.position;
    const danger = THREE.MathUtils.clamp(Math.hypot(player.x, player.z) / 260, 0, 1);

    if (this.backroomsWhisperTimer > 16 + Math.random() * 14) {
      this.backroomsWhisperTimer = 0;
      const hints = [
        '[Backrooms] The hum cuts out for half a second. Something fills the silence.',
        '[Backrooms] The carpet is wetter here. Your footsteps sound delayed.',
        '[Backrooms] A room ahead contains furniture that remembers a different building.',
        '[Backrooms] The walls are less consistent this far out. The place is forgetting.',
        '[Lore] Async notes: copied spaces decay outward from stable entry points.',
        '[Lore] Do not trust a familiar room twice. The Backrooms learns by copying badly.'
      ];
      this.hud.addChatMessage(hints[Math.floor(Math.random() * hints.length)]);
    }

    if (this.backroomsScreamTimer > 22 - danger * 10 + Math.random() * 24) {
      this.backroomsScreamTimer = 0;
      AudioManager.playBackroomsScream(1.0 + danger);
      if (Math.random() < 0.5 + danger * 0.35) this.hud.addChatMessage('[Backrooms] A scream travels through the ceiling tiles. It is closer than it should be.');
    }

    if (this.backroomsHorrorTimer < Math.max(4.5, 10.0 - danger * 5.5)) return;
    this.backroomsHorrorTimer = 0;

    const backroomsMobs = this.entityManager.localMobs.filter((mob: any) => mob.mobType === 'bacteria' || mob.mobType === 'still_life' || mob.mobType === 'clark_monster');
    if (backroomsMobs.length >= 5 + Math.floor(danger * 5)) return;

    const count = Math.random() < 0.12 + danger * 0.28 ? 2 : 1;
    const mobPool: Array<'bacteria' | 'still_life' | 'clark_monster'> = danger > 0.72
      ? ['bacteria', 'still_life', 'clark_monster']
      : danger > 0.34
        ? ['bacteria', 'bacteria', 'still_life']
        : ['bacteria'];

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 16 + Math.random() * (18 + danger * 26);
      const spawnPos = new THREE.Vector3(
        player.x + Math.cos(angle) * dist,
        62,
        player.z + Math.sin(angle) * dist
      );
      const mobType = mobPool[Math.floor(Math.random() * mobPool.length)];
      const id = this.entityManager.spawnMob(spawnPos, mobType, { skipGroundSnap: true });
      const mob = this.entityManager.localMobs.find((m: any) => m.id === id);
      if (mob) {
        (mob as any).backroomsEntity = true;
        (mob as any).spawnDanger = danger;
      }
    }
  }

  private runNaturalMobSpawner(dt: number) {
    if (this.pauseMenu.isMainMenuActive()) return;
    if (this.worldManager.currentDimension === 'backrooms') return;
    if (this.isProtectedMultiplayerRoom()) return;
    if (this.currentWorldId === 'multiplayer_world' && !this.isMultiplayerMobAuthority) return;

    this.spawnerTimer += dt;
    if (this.spawnerTimer >= 5.0) {
      this.spawnerTimer = 0;
      
      const time = this.skySystem.getTime();
      const isNight = time > 0.73 || time < 0.27;

      if (this.entityManager.localMobs.length >= 20) return;

      const count = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 16 + Math.random() * 16;
        const spawnX = this.playerController.position.x + Math.cos(angle) * dist;
        const spawnZ = this.playerController.position.z + Math.sin(angle) * dist;
        const spawnPos = new THREE.Vector3(spawnX, this.playerController.position.y + 4, spawnZ);

        const hostiles: ('zombie' | 'skeleton' | 'creeper' | 'spider' | 'enderman')[] = [
          'zombie', 'skeleton', 'creeper', 'spider', 'enderman'
        ];
        const passives: ('cow' | 'pig' | 'sheep')[] = ['cow', 'pig', 'sheep'];

        if (isNight) {
          const mobType = hostiles[Math.floor(Math.random() * hostiles.length)];
          this.entityManager.spawnMob(spawnPos, mobType);
        } else {
          const mobType = passives[Math.floor(Math.random() * passives.length)];
          this.entityManager.spawnMob(spawnPos, mobType);
        }
      }
    }
  }

  private spawnStarterMobsWhenReady(): void {
    if (this.isProtectedMultiplayerRoom()) {
      this.starterMobsSpawned = true;
      return;
    }
    if (this.currentWorldId === 'multiplayer_world' && !this.isMultiplayerMobAuthority) {
      this.starterMobsSpawned = true;
      return;
    }
    if (this.starterMobsSpawned || !this.worldManager.isColumnReady(this.playerController.position)) return;

    const playerPos = this.playerController.position;
    this.entityManager.spawnMob(playerPos.clone().add(new THREE.Vector3(5, 0, 4)), 'cow');
    this.entityManager.spawnMob(playerPos.clone().add(new THREE.Vector3(-6, 0, 5)), 'cow');
    this.entityManager.spawnMob(playerPos.clone().add(new THREE.Vector3(12, 0, -10)), 'zombie');
    this.starterMobsSpawned = true;
  }

  private isProtectedMultiplayerRoom(): boolean {
    if (this.currentWorldId !== 'multiplayer_world') return false;
    const kind = this.multiplayerRoomKind.toLowerCase();
    const dimension = this.worldManager?.currentDimension || '';
    return kind === 'minigame_lobby' ||
      kind === 'minigame_match' ||
      isCrownForgeDimension(dimension);
  }

  private loop = (time: RuntimeFrameTime): void => {
    if (!this.isRunning) return;
    InputManager.update();
    const dt = time.deltaSeconds;

    const isMenu = this.pauseMenu.isMainMenuActive();
    if (!this.isWorldLoaded) {
      this.renderer.setViewModelVisible(false);
      this.updateMenuPreview(dt);
      this.particleSystem.update(dt);
      this.skySystem.update(dt, new THREE.Vector3(0, 16, 0), this.materials, 'overworld');
      this.renderer.updateSelectionBox(null);
      this.renderer.render();

      this.frameCount++;
      const now = performance.now();
      if (now - this.lastFpsUpdateTime >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsUpdateTime = now;
        this.hud.updateDebug(this.fps, this.networkManager.ping, 0, 0, 0, this.playerController.position, this.pauseMenu.getSettings().seed);
      }
      return;
    }

    const cobBlocksGameplay = this.cobMode?.isBlockingGameplay() ?? false;
    const gameplayReady = !isMenu && !this.isLoadingWorld && !cobBlocksGameplay;
    this.renderer.setViewModelVisible(gameplayReady && this.cameraController.isFirstPerson());
    let ticks = time.fixedSteps;
    while (ticks > 0) {
      if (gameplayReady) {
        this.playerController.update(time.fixedDeltaSeconds, this.cameraController.getDirection());
        this.entityManager.update(time.fixedDeltaSeconds, this.playerController.position, 'local_player');
        this.itemDropManager.update(time.fixedDeltaSeconds, this.playerController.position);
        this.furnaceManager.tick(time.fixedDeltaSeconds);
        this.brewingManager.tick(time.fixedDeltaSeconds);
        this.worldManager.tick(time.fixedDeltaSeconds);
        
        // Natural survival spawning only. Authored random adventure events are disabled.
        if (this.currentWorldId !== 'baseline_sandbox' && !this.currentWorldId?.startsWith('tf2_') && !this.currentWorldId?.startsWith('cob_')) {
          this.runNaturalMobSpawner(time.fixedDeltaSeconds);
          this.runBackroomsDirector(time.fixedDeltaSeconds);
        }
      }

      ticks--;
    }

    const baseFovSetting = this.pauseMenu.getSettings?.()?.fov ?? 75;
    const zoomHeld = gameplayReady && InputManager.isActionDown('zoom');
    const targetFov = zoomHeld
      ? Math.max(18, baseFovSetting * 0.34)
      : ((gameplayReady && this.playerController.isSprinting && this.playerController.velocity.lengthSq() > 0.1)
        ? baseFovSetting * 1.12
        : baseFovSetting);
    if (Math.abs(this.renderer.camera.fov - targetFov) > 0.1) {
      this.renderer.camera.fov += (targetFov - this.renderer.camera.fov) * 0.15;
      this.renderer.camera.updateProjectionMatrix();
    }

    this.cameraController.updateCached(dt, this.playerController, this.renderer, isMenu || cobBlocksGameplay);

    if (gameplayReady) {
      this.renderer.updateSelectionBox(this.playerController.targetBlock);
    } else {
      this.renderer.updateSelectionBox(null);
    }

    this.particleSystem.update(dt);
    this.cbgoManager.update(dt);
    this.tf2Manager.update(dt);
    this.cobMode.update(dt);
    this.voiceChatManager.update();
    AudioManager.setBackroomsMode(gameplayReady && this.worldManager.currentDimension === 'backrooms');
    this.skySystem.update(dt, this.playerController.position, this.materials, this.worldManager.currentDimension);

    const weather = (this.skySystem as any).weatherState;
    if (weather === 'rain' || weather === 'thunder') {
      this.particleSystem.spawnRain(this.playerController.position);
    }

    const syncNow = performance.now();
    if (gameplayReady && this.pendingServerMode?.dimension === 'bedwars' && syncNow - this.lastBedWarsShopVerifyTime > 1200) {
      this.lastBedWarsShopVerifyTime = syncNow;
      this.ensureBedWarsShopNPCs(this.pendingServerMode);
    }
    if (gameplayReady && syncNow - this.lastTimeSyncTime > 2000) {
      this.networkManager.sendTimeSync(this.skySystem.getTime());
      this.lastTimeSyncTime = syncNow;
    }

    // Dynamic torch scanning near player
    if (gameplayReady && syncNow - this.lastTorchUpdateTime > 1500) {
      this.updateTorchLights();
      this.lastTorchUpdateTime = syncNow;
    }

    this.worldManager.update(this.playerController.position);

    if (this.isLoadingWorld) {
      InputManager.isUIActive = true;
      const readiness = this.worldManager.getColumnReadiness(this.playerController.position);
      const ready = readiness.ready === readiness.total;
      this.worldLoading!.report(
        'spawn',
        readiness.progress,
        ready ? 'Spawn area ready.' : `Generating spawn area (${readiness.ready}/${readiness.total} sections)...`,
      );
      if (ready) {
        if (this.needsSpawnPlacement) {
          const safeSpawn = this.worldManager.findGroundSpawnNear(this.playerController.position, 0, 24);
          if (safeSpawn) {
            this.playerController.position.copy(safeSpawn.add(new THREE.Vector3(0, 0.05, 0)));
            this.playerController.velocity.set(0, 0, 0);
          }
          this.needsSpawnPlacement = false;
        }
        this.completeWorldLoading();
        if (this.pendingServerMode?.dimension === 'bedwars') {
          this.applyBedWarsLoadout(this.pendingServerMode);
          this.ensureBedWarsShopNPCs(this.pendingServerMode);
        }
        const cobStillBlocking = this.cobMode?.isBlockingGameplay() ?? false;
        InputManager.isUIActive = cobStillBlocking;
        if (cobStillBlocking) InputManager.unlockPointer();
        else InputManager.lockPointer();
      }
    }

    if (gameplayReady) {
      this.saveCurrentPlayerPosition();
    }



    this.renderer.render();

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdateTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdateTime = now;

      const settings = this.pauseMenu.getSettings();
      const chunksCount = this.worldManager.chunks.size;
      const entitiesCount = this.entityManager.localMobs.length + this.itemDropManager.drops.length + this.entityManager.remotePlayers.size;

      this.hud.updateDebug(
        this.fps,
        this.networkManager.ping,
        chunksCount,
        entitiesCount,
        this.worldManager.workerQueueLength,
        this.playerController.position,
        settings.seed
      );
    }
  };
}
