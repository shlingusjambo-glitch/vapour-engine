import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { Renderer } from '../graphics/Renderer';
import { WorldManager } from '../world/WorldManager';
import { PlayerController } from '../player/PlayerController';
import { CameraController } from '../player/CameraController';
import { Inventory } from '../inventory/Inventory';
import { EntityManager } from '../entities/EntityManager';
import { BlockRegistry } from '../world/BlockRegistry';
import { CBGO_MAPS, CbgoMapId, CbgoTeam } from '../crownforge/CrownForgeCatalog';

interface GunDef {
  id: number;
  name: string;
  kind: 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun';
  price: number;
  magSize: number;
  reserveMags: number;
  reloadTime: number;
  damage: number;
  cooldown: number;
  speed: number;
  gravity: number;
  spread: number;
  moveSpread: number;
  recoilPitch: number;
  recoilYaw: number;
  pellets: number;
  rarity: string;
  role: string;
}

interface Bullet {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  weaponId: number;
  gravity: number;
  positions: Float32Array;
  line: THREE.Line;
  glow: THREE.Mesh;
}

const GUNS: GunDef[] = [
  { id: 620, name: 'P250 Sidearm', kind: 'pistol', price: 300, magSize: 13, reserveMags: 4, reloadTime: 1.55, damage: 8, cooldown: 0.24, speed: 180, gravity: 0, spread: 0.010, moveSpread: 0.045, recoilPitch: 0.010, recoilYaw: 0.006, pellets: 1, rarity: 'Consumer', role: 'Pistol' },
  { id: 621, name: 'MAC-10 / MP9', kind: 'smg', price: 1250, magSize: 30, reserveMags: 4, reloadTime: 1.85, damage: 6, cooldown: 0.088, speed: 190, gravity: 0, spread: 0.026, moveSpread: 0.095, recoilPitch: 0.007, recoilYaw: 0.010, pellets: 1, rarity: 'Mil-Spec', role: 'Anti-eco SMG' },
  { id: 622, name: 'AK-47 / M4A1-S', kind: 'rifle', price: 3100, magSize: 30, reserveMags: 3, reloadTime: 2.25, damage: 11, cooldown: 0.135, speed: 220, gravity: 0, spread: 0.011, moveSpread: 0.145, recoilPitch: 0.015, recoilYaw: 0.012, pellets: 1, rarity: 'Restricted', role: 'Full-buy rifle' },
  { id: 623, name: 'AWP Phantom', kind: 'sniper', price: 4750, magSize: 5, reserveMags: 4, reloadTime: 2.95, damage: 34, cooldown: 0.92, speed: 260, gravity: 0, spread: 0.002, moveSpread: 0.24, recoilPitch: 0.035, recoilYaw: 0.010, pellets: 1, rarity: 'Covert', role: 'One-shot sniper' },
  { id: 624, name: 'XM Breacher', kind: 'shotgun', price: 2000, magSize: 7, reserveMags: 4, reloadTime: 2.45, damage: 5, cooldown: 0.58, speed: 165, gravity: 0, spread: 0.055, moveSpread: 0.12, recoilPitch: 0.026, recoilYaw: 0.014, pellets: 7, rarity: 'Classified', role: 'Close-range force buy' },
];

const GUN_BY_ID = new Map(GUNS.map(gun => [gun.id, gun]));
const MAP_IDS = new Set<string>([...CBGO_MAPS.map(map => map.id), 'cbgo_dust', 'cbgo_cache', 'cbgo_train']);

export class CBGOManager {
  private root: HTMLDivElement;
  private deathRoot: HTMLDivElement;
  private arenaHudRoot: HTMLDivElement;
  private buyRoot: HTMLDivElement;
  private moneyEl!: HTMLDivElement;
  private stateEl!: HTMLDivElement;
  private rollResultEl!: HTMLDivElement;
  private rollTrackEl!: HTMLDivElement;
  private arenaTimerEl!: HTMLDivElement;
  private arenaPhaseEl!: HTMLDivElement;
  private arenaScoreEl!: HTMLDivElement;
  private arenaMetaEl!: HTMLDivElement;
  private arenaBuyEl!: HTMLDivElement;
  private arenaStakesEl!: HTMLDivElement;
  private bullets: Bullet[] = [];
  private ammo = new Map<number, { mag: number; reserve: number }>();
  private money = 800;
  private team: CbgoTeam | '' = '';
  private mapId: CbgoMapId | '' = '';
  private matchState: any = {};
  private lastFireAt = 0;
  private reloadEndsAt = 0;
  private reloadGunId = 0;
  private spreadBloom = 0;
  private spectateIndex = 0;
  private loadoutKey = '';
  private moneyRoundKey = '';
  private buyClosedKey = '';
  private forcedOpen = false;
  private pendingServerIp = '';
  private pendingUsername = 'Steve';
  private inCbgoRoom = false;
  private inspectStart = 0;
  private inspectDuration = 1.75;
  private lastObjectiveAt = 0;
  private caseQuantity = 1;

  constructor(
    private renderer: Renderer,
    private world: WorldManager,
    private player: PlayerController,
    private camera: CameraController,
    private inventory: Inventory,
    private entities: EntityManager
  ) {
    this.root = this.createLobbyOverlay();
    this.arenaHudRoot = this.createArenaHudOverlay();
    this.buyRoot = this.createBuyOverlay();
    this.deathRoot = this.createDeathOverlay();
    this.bindEvents();
  }

  public update(dt: number): void {
    const dimension = this.world.currentDimension;
    const inMenu = dimension === 'cbgo_menu';
    const inArena = MAP_IDS.has(dimension as CbgoMapId);
    const buyPhase = inArena && String(this.matchState?.cbgoPhase || '') === 'BUY';
    const roundKey = this.currentRoundKey(dimension);
    const showBuy = buyPhase && this.buyClosedKey !== roundKey;
    this.root.classList.toggle('visible', inMenu || this.forcedOpen);
    this.arenaHudRoot.classList.toggle('visible', inArena);
    this.buyRoot.classList.toggle('visible', showBuy);
    if (inMenu || this.forcedOpen || showBuy) {
      InputManager.isUIActive = true;
      InputManager.unlockPointer();
    } else if (inArena && !this.deathRoot.classList.contains('visible')) {
      InputManager.isUIActive = false;
    }
    if (inArena) {
      this.finishReloadIfReady();
      this.spreadBloom = Math.max(0, this.spreadBloom - dt * 0.42);
      this.updateHudText();
      this.updateArenaHud();
      this.updateBuyOverlay();
      this.updateShooting(dt);
      this.updateSpectatorPov();
      this.updateInspectAnimation();
    } else {
      this.deathRoot.classList.remove('visible');
      this.buyRoot.classList.remove('visible');
    }
    this.updateBullets(dt);
  }

  private bindEvents(): void {
    this.root.querySelector<HTMLButtonElement>('[data-action="quickplay"]')?.addEventListener('click', () => {
      this.startQuickPlay();
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(button => {
      button.addEventListener('click', () => {
        const mapId = button.dataset.map || '';
        this.startQuickPlay(mapId);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-action="case"]').forEach(button => {
      button.addEventListener('click', () => this.openCase());
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="back"]')?.addEventListener('click', () => {
      this.forcedOpen = false;
      this.root.classList.remove('visible');
      EventBus.emit('cbgo:closedMenu');
    });

    // Wire up Case open quantity select buttons
    this.root.querySelectorAll<HTMLButtonElement>('.cbgo-roll-controls button:not([data-action])').forEach(button => {
      button.addEventListener('click', () => {
        this.root.querySelectorAll<HTMLButtonElement>('.cbgo-roll-controls button:not([data-action])').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        this.caseQuantity = Number(button.textContent || '1');
      });
    });

    // Wire up topbar elements
    this.root.querySelectorAll('[data-topbar]').forEach(el => {
      el.addEventListener('click', () => {
        const action = el.getAttribute('data-topbar');
        if (action === 'home') {
          this.forcedOpen = false;
          this.root.classList.remove('visible');
          EventBus.emit('cbgo:closedMenu');
        } else if (action === 'settings') {
          EventBus.emit('ui:openSettings');
        } else if (action === 'play') {
          // Already active
        } else {
          const name = el.textContent || action || 'Feature';
          this.showComingSoonDialog(name);
        }
      });
    });

    this.deathRoot.querySelector<HTMLButtonElement>('[data-action="prev"]')?.addEventListener('click', () => this.spectateIndex--);
    this.deathRoot.querySelector<HTMLButtonElement>('[data-action="next"]')?.addEventListener('click', () => this.spectateIndex++);
    this.buyRoot.querySelector<HTMLButtonElement>('[data-action="close-buy"]')?.addEventListener('click', () => {
      this.buyClosedKey = this.currentRoundKey(this.world.currentDimension);
      this.buyRoot.classList.remove('visible');
      InputManager.isUIActive = false;
    });
    this.buyRoot.querySelectorAll<HTMLButtonElement>('[data-buy-gun]').forEach(button => {
      button.addEventListener('click', () => this.buyGun(Number(button.dataset.buyGun || 0)));
    });
    this.buyRoot.querySelectorAll<HTMLButtonElement>('[data-buy-utility]').forEach(button => {
      button.addEventListener('click', () => this.buyUtility(String(button.dataset.buyUtility || '')));
    });

    EventBus.on('network:serverInfo', (msg: any) => this.applyServerMode(msg));
    EventBus.on('network:serverMode', (msg: any) => this.applyServerMode(msg));
    EventBus.on('network:cbgoQuickPlayStarted', (msg: any) => this.applyServerMode(msg));
    EventBus.on('network:cbgoEconomy', (msg: any) => this.applyEconomy(msg));
    EventBus.on('network:cbgoDeath', (msg: any) => this.handleDeathPacket(msg));
    EventBus.on('network:cbgoRoundEnd', (msg: any) => this.handleRoundEnd(msg));
    EventBus.on('network:cbgoObjective', (msg: any) => this.handleObjectivePacket(msg));
    EventBus.on('mouse:rightClick', () => this.tryUseObjectiveTool());
    EventBus.on('cbgo:shotRemote', (msg: any) => this.renderRemoteShot(msg));
    EventBus.on('cbgo:openMenu', (data?: any) => {
      this.pendingServerIp = String(data?.serverIp || this.pendingServerIp || 'ws://localhost:8080');
      this.pendingUsername = String(data?.username || this.pendingUsername || 'Steve');
      this.forcedOpen = true;
      this.root.classList.add('visible');
      this.updateHudText();
      InputManager.isUIActive = true;
      InputManager.unlockPointer();
    });
    EventBus.on('player:died', () => {
      if (MAP_IDS.has(this.world.currentDimension as CbgoMapId)) this.showDeathOverlay('Eliminated', 'Spectating teammate POV');
    });
    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      if (MAP_IDS.has(this.world.currentDimension as CbgoMapId) && event.key.toLowerCase() === 'b') {
        if (String(this.matchState?.cbgoPhase || '') !== 'BUY') return;
        const visible = this.buyRoot.classList.toggle('visible');
        this.buyClosedKey = visible ? '' : this.currentRoundKey(this.world.currentDimension);
        InputManager.isUIActive = visible;
        if (visible) InputManager.unlockPointer();
        return;
      }
      if (MAP_IDS.has(this.world.currentDimension as CbgoMapId) && event.key.toLowerCase() === 'r') {
        this.startReload();
        return;
      }
      if (InputManager.isUIActive) return;
      if (event.key.toLowerCase() !== 'f') return;
      const held = this.inventory.getSlot(this.inventory.getActiveSlotIndex());
      if (!held || !GUN_BY_ID.has(held.id)) return;
      this.inspectStart = performance.now();
      AudioManager.playCaseRoll(false);
    });
  }

  private startQuickPlay(mapId?: string): void {
    this.forcedOpen = false;
    this.root.classList.remove('visible');
    EventBus.emit('network:voice:start');
    const network = (window as any).gameNetworkManager;
    if (!network?.connected) {
      EventBus.once('network:welcome', () => {
        window.setTimeout(() => EventBus.emit('network:cbgoQuickPlay', mapId ? { mapId } : {}), 500);
      });
      EventBus.emit('network:connect', {
        ip: this.pendingServerIp || 'ws://localhost:8080',
        room: 'crownforge_csgo',
        username: this.pendingUsername || 'Steve',
      });
    } else if (!this.inCbgoRoom) {
      EventBus.once('network:serverInfo', () => {
        window.setTimeout(() => EventBus.emit('network:cbgoQuickPlay', mapId ? { mapId } : {}), 350);
      });
      EventBus.emit('chat:send', '/csgo');
    } else {
      EventBus.emit('network:cbgoQuickPlay', mapId ? { mapId } : {});
    }
    EventBus.emit('network:chat', '[CBGO] Premier queued. Picking map, side, and stakes...');
  }

  private applyServerMode(msg: any): void {
    const meta = msg?.meta || {};
    const matchState = msg?.matchState || meta.matchState || {};
    const dimension = String(msg?.dimension || meta.dimension || this.world.currentDimension || '');
    if (dimension !== 'cbgo_menu' && !MAP_IDS.has(dimension as CbgoMapId) && meta.minigameId !== 'csgo') {
      this.inCbgoRoom = false;
      return;
    }
    const incomingPhase = String(matchState.cbgoPhase || '').toUpperCase();
    const currentPhase = String(this.matchState?.cbgoPhase || '').toUpperCase();
    if (
      dimension === 'cbgo_menu'
      && MAP_IDS.has(this.world.currentDimension as CbgoMapId)
      && incomingPhase === 'VETO'
      && currentPhase
      && currentPhase !== 'VETO'
    ) {
      return;
    }
    this.inCbgoRoom = true;
    this.matchState = matchState;

    this.mapId = (matchState.cbgoMap || (MAP_IDS.has(dimension as CbgoMapId) ? dimension : '')) as CbgoMapId | '';
    const serverMoneyKey = this.currentMoneyKey(dimension);
    const username = String((window as any).gameNetworkManager?.wantedUsername || '');
    const teams = matchState.cbgoTeams || {};
    for (const [name, teamData] of Object.entries(teams)) {
      const data = teamData as any;
      const alive = Array.isArray(data.alivePlayers) && data.alivePlayers.includes(username);
      const hasMoney = data.money && Object.prototype.hasOwnProperty.call(data.money, username);
      if (alive || hasMoney) {
        this.team = name as CbgoTeam;
        const serverMoney = Number(data.money?.[username] || this.money || 800);
        if (this.moneyRoundKey !== serverMoneyKey) {
          this.money = serverMoney;
        }
      }
    }
    if (this.moneyRoundKey !== serverMoneyKey) this.moneyRoundKey = serverMoneyKey;

    if (MAP_IDS.has(dimension as CbgoMapId)) this.ensureLoadout(dimension, this.team || 'Terrorists');
    this.updateHudText();
  }

  private applyEconomy(msg: any): void {
    const myUuid = (window as any).gameNetworkManager?.myUuid || '';
    if (msg.killerUuid && msg.killerUuid === myUuid) {
      this.money = Number(msg.money || this.money);
      this.updateHudText();
    } else {
      this.applyServerMode(msg);
    }
  }

  private handleDeathPacket(msg: any): void {
    this.applyServerMode(msg);
    const myUuid = (window as any).gameNetworkManager?.myUuid || '';
    if (msg.uuid === myUuid) this.showDeathOverlay('Eliminated', msg.killerUuid ? 'Taken out by enemy fire' : 'You are now spectating');
  }

  private handleRoundEnd(msg: any): void {
    this.applyServerMode(msg);
    const winner = String(msg.winner || 'Unknown');
    const reason = String(msg.reason || 'round').replace(/^\w/, c => c.toUpperCase());
    this.showDeathOverlay(`${winner} Win`, `${reason}. Next round starts in a moment.`);
    window.setTimeout(() => this.deathRoot.classList.remove('visible'), 4200);
  }

  private handleObjectivePacket(msg: any): void {
    this.applyServerMode(msg);
    const action = String(msg.action || '').toLowerCase();
    const site = String(msg.site || '').toUpperCase() || 'A';
    const player = String(msg.username || 'A player');
    if (action === 'plant') {
      EventBus.emit('network:chat', `[CBGO] ${player} planted at ${site}. 40 seconds.`);
    } else if (action === 'defuse') {
      EventBus.emit('network:chat', `[CBGO] ${player} defused at ${site}.`);
    }
  }

  private tryUseObjectiveTool(): void {
    if (!MAP_IDS.has(this.world.currentDimension)) return;
    if (this.player.isSpectator || this.player.isDead) return;
    const held = this.inventory.getSlot(this.inventory.getActiveSlotIndex());
    if (!held || held.id !== 625) return;
    const now = performance.now();
    if (now - this.lastObjectiveAt < 900) return;
    const site = this.getNearestBombsite();
    if (!site) {
      EventBus.emit('network:chat', '[CBGO] Move onto a bombsite to use the objective tool.');
      return;
    }
    const phase = String(this.matchState?.cbgoPhase || 'LIVE');
    const action = this.team === 'Counter-Terrorists' ? 'defuse' : 'plant';
    if (action === 'plant' && phase !== 'LIVE') return;
    if (action === 'defuse' && phase !== 'BOMB') return;
    this.lastObjectiveAt = now;
    EventBus.emit('network:cbgoObjective', { action, site: site.name });
    EventBus.emit('network:chat', action === 'plant'
      ? `[CBGO] Planting at ${site.name}...`
      : `[CBGO] Defusing at ${site.name}...`);
  }

  private getNearestBombsite(): { name: 'A' | 'B'; distanceSq: number } | null {
    const map = CBGO_MAPS.find(entry => entry.id === this.mapId);
    if (!map) return null;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const a = (px - map.bombsiteA.x) ** 2 + (pz - map.bombsiteA.z) ** 2;
    const b = (px - map.bombsiteB.x) ** 2 + (pz - map.bombsiteB.z) ** 2;
    const best = a <= b ? { name: 'A' as const, distanceSq: a } : { name: 'B' as const, distanceSq: b };
    return best.distanceSq <= 11 * 11 ? best : null;
  }

  private ensureLoadout(dimension: string, team: CbgoTeam): void {
    const key = this.currentRoundKey(dimension, team);
    if (this.loadoutKey === key) return;
    this.loadoutKey = key;
    this.buyClosedKey = '';
    this.ammo.clear();
    this.reloadEndsAt = 0;
    this.reloadGunId = 0;
    this.inventory.clear();
    this.inventory.setSlot(0, { id: 620, count: 1, customName: team === 'Terrorists' ? 'T P250 Sidearm' : 'CT P250 Sidearm' });
    this.inventory.setSlot(8, { id: 625, count: 1, customName: team === 'Terrorists' ? 'C4 Package' : 'Defuse Kit' });
    this.ensureAmmo(GUNS[0]);
    EventBus.emit('hotbar:select', 0);
  }

  private currentRoundKey(dimension = this.world.currentDimension, team: CbgoTeam | '' = this.team): string {
    const round = Number(this.matchState?.cbgoRound || 1);
    const map = String(this.matchState?.cbgoMap || dimension || '');
    return `${map}:${team || 'team'}:${round}`;
  }

  private currentMoneyKey(dimension = this.world.currentDimension): string {
    const round = Number(this.matchState?.cbgoRound || 1);
    const map = String(this.matchState?.cbgoMap || dimension || '');
    return `${map}:${round}`;
  }

  private pickPrimaryForMoney(): GunDef | null {
    if (this.money >= GUNS[3].price) return GUNS[3];
    if (this.money >= GUNS[2].price) return GUNS[2];
    if (this.money >= GUNS[4].price) return GUNS[4];
    if (this.money >= GUNS[1].price) return GUNS[1];
    return null;
  }

  private buyGun(itemId: number): void {
    if (String(this.matchState?.cbgoPhase || '') !== 'BUY') return;
    const gun = GUN_BY_ID.get(itemId);
    if (!gun) return;
    const alreadyOwned = Array.from({ length: 9 }, (_, index) => this.inventory.getSlot(index)).some(stack => stack?.id === itemId);
    if (!alreadyOwned && this.money < gun.price) {
      EventBus.emit('network:chat', `[CBGO] Need $${gun.price} for ${gun.name}.`);
      AudioManager.playCaseRoll(false);
      return;
    }
    if (!alreadyOwned) this.money = Math.max(0, this.money - gun.price);
    const slot = gun.kind === 'pistol' ? 0 : 1;
    this.inventory.setSlot(slot, { id: gun.id, count: 1, customName: gun.name });
    this.ammo.set(gun.id, { mag: gun.magSize, reserve: gun.magSize * gun.reserveMags });
    EventBus.emit('hotbar:select', slot);
    EventBus.emit('network:chat', `[CBGO] Bought ${gun.name}.`);
    AudioManager.playItemPickup();
    this.updateHudText();
    this.updateArenaHud();
    this.updateBuyOverlay();
  }

  private buyUtility(kind: string): void {
    if (String(this.matchState?.cbgoPhase || '') !== 'BUY') return;
    const offers: Record<string, { label: string; cost: number; slot: number; stack: { id: number; count: number; customName: string } }> = {
      armor: { label: 'Kevlar', cost: 650, slot: 6, stack: { id: 407, count: 1, customName: 'Kevlar Vest' } },
      flash: { label: 'Flashbang', cost: 200, slot: 4, stack: { id: 209, count: 1, customName: 'Flashbang' } },
      smoke: { label: 'Smoke Grenade', cost: 300, slot: 5, stack: { id: 201, count: 1, customName: 'Smoke Grenade' } },
      kit: { label: 'Defuse Kit', cost: 400, slot: 8, stack: { id: 625, count: 1, customName: 'Defuse Kit' } },
    };
    const offer = offers[kind];
    if (!offer) return;
    if (kind === 'kit' && this.team !== 'Counter-Terrorists') return;
    if (this.money < offer.cost) {
      EventBus.emit('network:chat', `[CBGO] Need $${offer.cost} for ${offer.label}.`);
      AudioManager.playCaseRoll(false);
      return;
    }
    this.money -= offer.cost;
    this.inventory.setSlot(offer.slot, offer.stack);
    EventBus.emit('network:chat', `[CBGO] Bought ${offer.label}.`);
    AudioManager.playItemPickup();
    this.updateHudText();
    this.updateArenaHud();
    this.updateBuyOverlay();
  }

  private ensureAmmo(gun: GunDef): { mag: number; reserve: number } {
    let state = this.ammo.get(gun.id);
    if (!state) {
      state = { mag: gun.magSize, reserve: gun.magSize * gun.reserveMags };
      this.ammo.set(gun.id, state);
    }
    return state;
  }

  private startReload(): void {
    if (this.reloadEndsAt > performance.now()) return;
    const stack = this.inventory.getSlot(this.inventory.getActiveSlotIndex());
    const gun = stack ? GUN_BY_ID.get(stack.id) : undefined;
    if (!gun) return;
    const ammo = this.ensureAmmo(gun);
    if (ammo.mag >= gun.magSize || ammo.reserve <= 0) return;
    this.reloadGunId = gun.id;
    this.reloadEndsAt = performance.now() + gun.reloadTime * 1000;
    EventBus.emit('network:chat', `[CBGO] Reloading ${gun.name}...`);
    AudioManager.playGunReload(gun.kind);
  }

  private finishReloadIfReady(): void {
    if (!this.reloadGunId || !this.reloadEndsAt || performance.now() < this.reloadEndsAt) return;
    const gun = GUN_BY_ID.get(this.reloadGunId);
    if (gun) {
      const ammo = this.ensureAmmo(gun);
      const needed = Math.max(0, gun.magSize - ammo.mag);
      const moved = Math.min(needed, ammo.reserve);
      ammo.mag += moved;
      ammo.reserve -= moved;
    }
    this.reloadGunId = 0;
    this.reloadEndsAt = 0;
    AudioManager.playItemPickup();
  }

  private updateShooting(dt: number): void {
    if (InputManager.isUIActive || this.player.isSpectator || this.player.isDead) return;
    if (!InputManager.isActionDown('attack')) return;
    const stack = this.inventory.getSlot(this.inventory.getActiveSlotIndex());
    const gun = stack ? GUN_BY_ID.get(stack.id) : undefined;
    if (!gun) return;
    if (this.reloadEndsAt > performance.now()) return;
    const ammo = this.ensureAmmo(gun);
    if (ammo.mag <= 0) {
      this.startReload();
      return;
    }
    const now = performance.now() / 1000;
    if (now - this.lastFireAt < gun.cooldown) return;
    this.lastFireAt = now;
    ammo.mag--;
    const spread = this.getEffectiveSpread(gun);
    for (let i = 0; i < gun.pellets; i++) this.fireBullet(gun, spread);
    AudioManager.playGunshot(gun.kind);
    this.renderer.playGunRecoil(gun.kind === 'sniper' ? 1.8 : gun.kind === 'shotgun' ? 1.45 : 1);
    this.applyRecoil(gun);
    EventBus.emit('cbgo:gunFired', { gunId: gun.id });
  }

  private getEffectiveSpread(gun: GunDef): number {
    const horizontalSpeed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    const movementPenalty = THREE.MathUtils.clamp(horizontalSpeed / 5.4, 0, 1) * gun.moveSpread;
    const crouchBonus = this.player.isCrouching ? 0.68 : 1;
    return Math.max(0.001, (gun.spread + movementPenalty + this.spreadBloom) * crouchBonus);
  }

  private applyRecoil(gun: GunDef): void {
    const limit = Math.PI / 2 - 0.05;
    this.camera.pitch = THREE.MathUtils.clamp(this.camera.pitch + gun.recoilPitch, -limit, limit);
    this.camera.yaw += (Math.random() - 0.5) * gun.recoilYaw;
    this.spreadBloom = Math.min(0.11, this.spreadBloom + gun.recoilPitch * (gun.kind === 'smg' ? 0.9 : 0.55));
  }

  private fireBullet(gun: GunDef, spread: number): void {
    const origin = this.player.position.clone().add(new THREE.Vector3(0, this.player.eyeHeight - 0.05, 0));
    const dir = this.camera.getDirection().normalize();
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    const positions = new Float32Array([
      origin.x, origin.y, origin.z,
      origin.x + dir.x * 0.2, origin.y + dir.y * 0.2, origin.z + dir.z * 0.2,
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: gun.kind === 'sniper' ? 0xfff5a8 : 0xffd166, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 1000;
    line.frustumCulled = false;
    this.renderer.scene.add(line);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(gun.kind === 'sniper' ? 0.09 : 0.055, 8, 8),
      new THREE.MeshBasicMaterial({ color: gun.kind === 'sniper' ? 0xfff5a8 : 0xffd166, transparent: true, opacity: 0.92 })
    );
    glow.renderOrder = 1001;
    glow.frustumCulled = false;
    glow.position.copy(origin);
    this.renderer.scene.add(glow);
    this.bullets.push({
      pos: origin.clone(),
      prev: origin.clone(),
      vel: dir.multiplyScalar(gun.speed),
      life: gun.kind === 'sniper' ? 0.95 : 0.78,
      damage: gun.damage,
      weaponId: gun.id,
      gravity: gun.gravity,
      positions,
      line,
      glow,
    });
  }

  private updateBullets(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      bullet.prev.copy(bullet.pos);
      bullet.vel.y -= bullet.gravity * dt;
      bullet.pos.addScaledVector(bullet.vel, dt);
      bullet.life -= dt;
      const hitUuid = this.findBulletPlayerHit(bullet.prev, bullet.pos);
      const blocked = this.isSolidAt(bullet.pos);
      this.updateBulletLine(bullet);
      if (hitUuid || blocked || bullet.life <= 0) {
        if (hitUuid) {
          EventBus.emit('network:sendCbgoShot', {
            targetUuid: hitUuid,
            weaponId: bullet.weaponId,
            damage: bullet.damage,
            origin: this.vec(bullet.prev),
            end: this.vec(bullet.pos),
          });
        } else if (blocked) {
          EventBus.emit('network:sendCbgoShot', {
            weaponId: bullet.weaponId,
            damage: 0,
            origin: this.vec(bullet.prev),
            end: this.vec(bullet.pos),
          });
        }
        this.disposeBullet(bullet);
        this.bullets.splice(i, 1);
      }
    }
  }

  private disposeBulletLine(line: THREE.Line): void {
    this.renderer.scene.remove(line);
    line.geometry.dispose();
    const material = line.material;
    if (Array.isArray(material)) material.forEach(mat => mat.dispose());
    else material.dispose();
  }

  private disposeBullet(bullet: Bullet): void {
    this.disposeBulletLine(bullet.line);
    this.renderer.scene.remove(bullet.glow);
    bullet.glow.geometry.dispose();
    const material = bullet.glow.material;
    if (Array.isArray(material)) material.forEach(mat => mat.dispose());
    else material.dispose();
  }

  private findBulletPlayerHit(start: THREE.Vector3, end: THREE.Vector3): string {
    let best = '';
    let bestDist = Infinity;
    const seg = end.clone().sub(start);
    const lenSq = Math.max(seg.lengthSq(), 0.0001);
    for (const [uuid, remote] of this.entities.remotePlayers) {
      const center = remote.entity.position.clone().add(new THREE.Vector3(0, 0.95, 0));
      const t = THREE.MathUtils.clamp(center.clone().sub(start).dot(seg) / lenSq, 0, 1);
      const closest = start.clone().addScaledVector(seg, t);
      const dist = closest.distanceTo(center);
      if (dist < 0.62 && dist < bestDist) {
        best = uuid;
        bestDist = dist;
      }
    }
    return best;
  }

  private isSolidAt(pos: THREE.Vector3): boolean {
    const id = this.world.getVoxel(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    return id > 0 && BlockRegistry.get(id).isSolid;
  }

  private updateBulletLine(bullet: Bullet): void {
    bullet.positions[0] = bullet.prev.x;
    bullet.positions[1] = bullet.prev.y;
    bullet.positions[2] = bullet.prev.z;
    bullet.positions[3] = bullet.pos.x;
    bullet.positions[4] = bullet.pos.y;
    bullet.positions[5] = bullet.pos.z;
    const attribute = bullet.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
    const mat = bullet.line.material as THREE.LineBasicMaterial;
    mat.opacity = Math.max(0.1, bullet.life / 0.72);
    bullet.glow.position.copy(bullet.pos);
    const glowMat = bullet.glow.material as THREE.MeshBasicMaterial;
    glowMat.opacity = Math.max(0.15, bullet.life / 0.78);
  }

  private renderRemoteShot(msg: any): void {
    const origin = new THREE.Vector3(Number(msg.origin?.x || 0), Number(msg.origin?.y || 0), Number(msg.origin?.z || 0));
    const end = new THREE.Vector3(Number(msg.end?.x || origin.x), Number(msg.end?.y || origin.y), Number(msg.end?.z || origin.z));
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xff6f61, transparent: true, opacity: 0.95 }));
    line.renderOrder = 1000;
    this.renderer.scene.add(line);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff6f61, transparent: true, opacity: 0.85 })
    );
    glow.position.copy(end);
    glow.renderOrder = 1001;
    this.renderer.scene.add(glow);
    AudioManager.playGunshot(GUN_BY_ID.get(Number(msg.weaponId))?.kind || 'rifle');
    window.setTimeout(() => {
      this.renderer.scene.remove(line);
      this.renderer.scene.remove(glow);
      geometry.dispose();
      (line.material as THREE.Material).dispose();
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
    }, 140);
  }

  private openCase(): void {
    const qty = this.caseQuantity || 1;
    const cost = 700 * qty;
    if (this.money < cost) {
      this.rollResultEl.textContent = `Need $${cost} to open ${qty} Premier case${qty === 1 ? '' : 's'}.`;
      return;
    }
    this.money -= cost;
    this.updateHudText();

    if (qty === 1) {
      const gun = this.pickCaseGun();
      this.runCrateRoll(gun);
      AudioManager.playCaseRoll(gun.rarity === 'Covert');
    } else {
      const unlockedGuns: GunDef[] = [];
      for (let i = 0; i < qty; i++) {
        const gun = this.pickCaseGun();
        this.inventory.addItem(gun.id, 1);
        unlockedGuns.push(gun);
      }
      this.rollResultEl.innerHTML = `<div style="text-align: left; font-size: 13px; color: #f5efe4; max-height: 180px; overflow-y: auto; padding: 6px; background: rgba(0,0,0,0.35); border-radius: 4px;"><strong>Unlocked ${qty} items:</strong><br>${unlockedGuns.map(g => `<span class="rarity-${g.rarity.toLowerCase().replace(/[^a-z]/g, '-')}">${g.name} (${g.rarity})</span>`).join('<br>')}</div>`;
      AudioManager.playCaseRoll(unlockedGuns.some(g => g.rarity === 'Covert'));
    }
  }

  private showComingSoonDialog(title: string): void {
    const dialogId = 'cbgo-coming-soon-dialog';
    let dialog = document.getElementById(dialogId) as HTMLDivElement;
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = dialogId;
      dialog.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.65);
        font-family: 'Inter', sans-serif;
      `;
      document.body.appendChild(dialog);
    }
    dialog.innerHTML = `
      <div style="
        background: #1e2022;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 24px;
        width: 320px;
        text-align: center;
        color: #f5efe4;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
      ">
        <h3 style="margin: 0 0 12px 0; font-size: 20px; color: #f4c36b;">Feature Coming Soon</h3>
        <p style="margin: 0 0 20px 0; font-size: 14px; color: rgba(245, 239, 228, 0.72);">${title} will be available in a future update!</p>
        <button id="coming-soon-close" style="
          background: #f4c36b;
          color: #1e2022;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          font-weight: bold;
          cursor: pointer;
        ">Close</button>
      </div>
    `;
    dialog.style.display = 'flex';
    dialog.querySelector('#coming-soon-close')?.addEventListener('click', () => {
      dialog.style.display = 'none';
    });
  }

  private pickCaseGun(): GunDef {
    const roll = Math.random();
    if (roll > 0.965) return GUNS[3];
    if (roll > 0.84) return GUNS[4];
    if (roll > 0.54) return GUNS[2];
    if (roll > 0.18) return GUNS[1];
    return GUNS[0];
  }

  private runCrateRoll(result: GunDef): void {
    const strip: GunDef[] = [];
    for (let i = 0; i < 46; i++) strip.push(this.pickCaseGun());
    strip.push(result);
    this.rollTrackEl.innerHTML = strip.map((gun, index) => `
      <div class="cbgo-roll-card rarity-${gun.rarity.toLowerCase().replace(/[^a-z]/g, '-')}" data-index="${index}">
        <div class="cbgo-roll-rarity">${gun.rarity}</div>
        <div class="cbgo-gun-silhouette kind-${gun.kind}"><i></i><b></b><em></em></div>
        <strong>${this.escapeHtml(gun.name)}</strong>
        <small>${this.escapeHtml(gun.role)}</small>
      </div>
    `).join('');
    this.rollTrackEl.style.transition = 'none';
    this.rollTrackEl.style.transform = 'translateX(42vw)';
    this.rollResultEl.innerHTML = '<span>Opening Premier case...</span>';
    requestAnimationFrame(() => {
      this.rollTrackEl.style.transition = 'transform 3.65s cubic-bezier(0.08, 0.82, 0.12, 1)';
      this.rollTrackEl.style.transform = `translateX(${-strip.length * 166 + 438}px)`;
    });
    window.setTimeout(() => {
      this.inventory.addItem(result.id, 1);
      this.rollResultEl.innerHTML = `<span class="rarity-${result.rarity.toLowerCase().replace(/[^a-z]/g, '-')}">Unlocked ${this.escapeHtml(result.rarity)}: ${this.escapeHtml(result.name)}</span>`;
      this.rollTrackEl.querySelector(`[data-index="${strip.length - 1}"]`)?.classList.add('winner');
    }, 3750);
  }

  private updateSpectatorPov(): void {
    if (!this.player.isSpectator) {
      this.deathRoot.classList.remove('visible');
      return;
    }
    const entries = Array.from(this.entities.remotePlayers.values());
    if (entries.length === 0) return;
    const target = entries[((this.spectateIndex % entries.length) + entries.length) % entries.length];
    this.player.position.copy(target.entity.position).add(new THREE.Vector3(0, 0.15, 0));
    this.player.velocity.set(0, 0, 0);
    const title = this.deathRoot.querySelector<HTMLElement>('.cbgo-death-target');
    if (title) title.textContent = `Watching ${target.entity.username}`;
  }

  private showDeathOverlay(title: string, subtitle: string): void {
    const defaultDeath = document.getElementById('death-screen');
    if (defaultDeath) defaultDeath.style.display = 'none';
    this.deathRoot.querySelector<HTMLElement>('.cbgo-death-title')!.textContent = title;
    this.deathRoot.querySelector<HTMLElement>('.cbgo-death-subtitle')!.textContent = subtitle;
    this.deathRoot.classList.add('visible');
  }

  private updateHudText(): void {
    this.moneyEl.textContent = `$${this.money}`;
    const map = CBGO_MAPS.find(entry => entry.id === this.mapId);
    const phase = String(this.matchState?.cbgoPhase || 'MENU');
    this.stateEl.textContent = `${map?.title || 'Premier'} · ${this.team || 'Assigning team'} · ${phase}`;
  }

  private updateArenaHud(): void {
    const map = CBGO_MAPS.find(entry => entry.id === this.mapId);
    const phase = String(this.matchState?.cbgoPhase || 'LIVE');
    const countdown = Math.max(0, Math.floor(Number(this.matchState?.countdown ?? 0)));
    const round = Math.max(1, Number(this.matchState?.cbgoRound || 1));
    const scores = this.matchState?.cbgoScores || {};
    const tScore = Number(scores.Terrorists || 0);
    const ctScore = Number(scores['Counter-Terrorists'] || 0);
    const stakes = this.matchState?.cbgoStakes || { win: 0, loss: 0 };
    const phaseLabel = this.phaseLabel(phase);
    this.arenaTimerEl.textContent = this.formatTimer(countdown);
    this.arenaPhaseEl.textContent = phaseLabel;
    this.arenaScoreEl.innerHTML = `
      <span class="cbgo-score-t">T ${tScore}</span>
      <b>Round ${round}/24</b>
      <span class="cbgo-score-ct">${ctScore} CT</span>
    `;
    this.arenaMetaEl.textContent = `${map?.title || 'Premier'} · ${this.team || 'Assigning side'} · ${map?.theme || 'three-lane tactical layout'}`;
    this.arenaStakesEl.textContent = `Stakes ${stakes.win >= 0 ? '+' : ''}${Number(stakes.win || 0)} / ${Number(stakes.loss || 0)}`;
    const primary = this.pickPrimaryForMoney();
    const economy = this.money >= GUNS[2].price ? 'Full buy' : this.money >= GUNS[1].price ? 'Force buy' : 'Eco / pistol';
    const utility = this.team === 'Counter-Terrorists' ? 'Kit ready' : 'C4 package';
    const active = this.inventory.getSlot(this.inventory.getActiveSlotIndex());
    const gun = active ? GUN_BY_ID.get(active.id) : undefined;
    const ammo = gun ? this.ensureAmmo(gun) : null;
    const reload = this.reloadEndsAt > performance.now() ? 'Reloading' : '';
    this.arenaBuyEl.innerHTML = `
      <span>$${Math.floor(this.money)}</span>
      <span>${economy}</span>
      <span>${gun ? `${this.escapeHtml(gun.name)} ${ammo?.mag ?? 0}/${ammo?.reserve ?? 0}` : primary ? this.escapeHtml(primary.name) : 'Sidearm only'}</span>
      <span>${utility}</span>
      ${reload ? `<span>${reload}</span>` : ''}
    `;
  }

  private updateBuyOverlay(): void {
    const phase = String(this.matchState?.cbgoPhase || '');
    const enabled = phase === 'BUY';
    this.buyRoot.querySelector<HTMLElement>('.cbgo-buy-money')!.textContent = `$${Math.floor(this.money)}`;
    this.buyRoot.querySelector<HTMLElement>('.cbgo-buy-side')!.textContent = `${this.team || 'Assigning side'} · ${enabled ? 'Buy time' : this.phaseLabel(phase)}`;
    this.buyRoot.querySelectorAll<HTMLButtonElement>('[data-buy-gun]').forEach(button => {
      const gun = GUN_BY_ID.get(Number(button.dataset.buyGun || 0));
      const owned = gun ? Array.from({ length: 9 }, (_, index) => this.inventory.getSlot(index)).some(stack => stack?.id === gun.id) : false;
      const affordable = !!gun && (this.money >= gun.price || owned);
      button.disabled = !enabled || !affordable;
      button.classList.toggle('owned', owned);
    });
    this.buyRoot.querySelectorAll<HTMLButtonElement>('[data-buy-utility]').forEach(button => {
      const kind = String(button.dataset.buyUtility || '');
      const cost = kind === 'armor' ? 650 : kind === 'flash' ? 200 : kind === 'smoke' ? 300 : 400;
      button.disabled = !enabled || this.money < cost || (kind === 'kit' && this.team !== 'Counter-Terrorists');
    });
  }

  private phaseLabel(phase: string): string {
    if (phase === 'VETO') return 'Map veto';
    if (phase === 'WARMUP') return 'Warmup';
    if (phase === 'BUY') return 'Buy phase';
    if (phase === 'BOMB') return 'Bomb planted';
    if (phase === 'ROUND_END') return 'Round end';
    return 'Live round';
  }

  private formatTimer(seconds: number): string {
    const min = Math.floor(seconds / 60).toString();
    const sec = Math.max(0, seconds % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  }

  private updateInspectAnimation(): void {
    if (!this.inspectStart) return;
    const progress = (performance.now() - this.inspectStart) / (this.inspectDuration * 1000);
    if (progress >= 1) {
      this.inspectStart = 0;
      return;
    }
    this.renderer.applyWeaponInspect(progress);
  }

  private vec(v: THREE.Vector3): { x: number; y: number; z: number } {
    return { x: v.x, y: v.y, z: v.z };
  }

  private escapeHtml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private createLobbyOverlay(): HTMLDivElement {
    this.injectStyles();
    const root = document.createElement('div');
    root.id = 'cbgo-root';
    root.innerHTML = `
      <div class="cbgo-panel cbgo-lobby">
        <div class="cbgo-topbar">
          <span data-topbar="home" style="cursor:pointer">⌂</span>
          <span data-topbar="dashboard" style="cursor:pointer">▣</span>
          <span data-topbar="settings" style="cursor:pointer">⚙</span>
          <button data-action="back">⏻</button>
          <strong data-topbar="inventory" style="cursor:pointer">Inventory</strong>
          <strong data-topbar="loadout" style="cursor:pointer">Loadout</strong>
          <strong data-topbar="play" class="active" style="cursor:pointer">Play</strong>
          <strong data-topbar="store" style="cursor:pointer">Store</strong>
        </div>
        <aside class="cbgo-lobby-left">
          <div class="cbgo-rank-card"><b>Premier</b><strong>9,334</strong><span class="cbgo-state"></span></div>
          <div class="cbgo-promo mission"><b>Mission Complete</b><span>Next mission starts soon</span></div>
          <div class="cbgo-promo pass"><b>The Armory Pass</b><span>Cases, charms, and weapon finishes</span></div>
          <div class="cbgo-promo major"><b>Major Items</b><span>Sticker capsule showcase</span></div>
        </aside>
        <main class="cbgo-lobby-stage">
          <div class="cbgo-agent-preview" aria-hidden="true">
            <div class="cbgo-agent-head"></div>
            <div class="cbgo-agent-body"></div>
            <div class="cbgo-agent-leg left"></div>
            <div class="cbgo-agent-leg right"></div>
            <div class="cbgo-agent-rifle"></div>
          </div>
          <div class="cbgo-player-card"><strong>LEOBO</strong><span class="cbgo-money"></span></div>
        </main>
        <aside class="cbgo-lobby-right">
          <div class="cbgo-play-together">Play Together</div>
          <div class="cbgo-friends">${Array.from({ length: 8 }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>
        </aside>
        <section class="cbgo-lobby-news">
          <strong>Counter-Block Premier</strong>
          <span>Veto the map, buy the round, control mid, and retake under pressure.</span>
        </section>
        <button class="cbgo-go" data-action="quickplay">GO</button>
        <div class="cbgo-veto-board">
          <div><span>Blue bans</span><strong>2 maps</strong></div>
          <div><span>Red bans</span><strong>3 maps</strong></div>
          <div><span>Pick</span><strong>Final map</strong></div>
          <div><span>Side</span><strong>T / CT</strong></div>
        </div>
        <div class="cbgo-map-row">
          ${CBGO_MAPS.map((map, index) => `
            <button class="cbgo-map" data-map="${map.id}" style="--accent:${map.accent}">
              <span>${index + 1}</span>
              <strong>${this.escapeHtml(map.title)}</strong>
              <small>${this.escapeHtml(map.theme)}</small>
            </button>
          `).join('')}
        </div>
        <div class="cbgo-roll-title">Diamond Premier Case</div>
        <div class="cbgo-roll-window"><div class="cbgo-roll-marker"></div><div class="cbgo-roll-track"></div></div>
        <div class="cbgo-roll-controls">
          <button class="active">1</button><button>2</button><button>3</button><button>4</button><button>5</button><button>10</button>
          <button data-action="case">Open</button>
        </div>
        <div class="cbgo-roll"></div>
      </div>
    `;
    document.body.appendChild(root);
    this.moneyEl = root.querySelector('.cbgo-money') as HTMLDivElement;
    this.stateEl = root.querySelector('.cbgo-state') as HTMLDivElement;
    this.rollResultEl = root.querySelector('.cbgo-roll') as HTMLDivElement;
    this.rollTrackEl = root.querySelector('.cbgo-roll-track') as HTMLDivElement;
    this.updateHudText();
    return root;
  }

  private createArenaHudOverlay(): HTMLDivElement {
    const root = document.createElement('div');
    root.id = 'cbgo-arena-hud';
    root.innerHTML = `
      <div class="cbgo-hud-top">
        <div class="cbgo-hud-score"></div>
        <div class="cbgo-hud-clock">
          <span class="cbgo-hud-phase"></span>
          <strong class="cbgo-hud-timer">0:00</strong>
        </div>
        <div class="cbgo-hud-stakes"></div>
      </div>
      <div class="cbgo-hud-meta"></div>
      <div class="cbgo-hud-buy"></div>
    `;
    document.body.appendChild(root);
    this.arenaTimerEl = root.querySelector('.cbgo-hud-timer') as HTMLDivElement;
    this.arenaPhaseEl = root.querySelector('.cbgo-hud-phase') as HTMLDivElement;
    this.arenaScoreEl = root.querySelector('.cbgo-hud-score') as HTMLDivElement;
    this.arenaMetaEl = root.querySelector('.cbgo-hud-meta') as HTMLDivElement;
    this.arenaBuyEl = root.querySelector('.cbgo-hud-buy') as HTMLDivElement;
    this.arenaStakesEl = root.querySelector('.cbgo-hud-stakes') as HTMLDivElement;
    return root;
  }

  private createBuyOverlay(): HTMLDivElement {
    const root = document.createElement('div');
    root.id = 'cbgo-buy-root';
    root.innerHTML = `
      <div class="cbgo-buy-panel">
        <div class="cbgo-buy-head">
          <div>
            <strong>Buy Menu</strong>
            <span class="cbgo-buy-side">Assigning side</span>
          </div>
          <div class="cbgo-buy-money">$800</div>
        </div>
        <div class="cbgo-buy-grid">
          ${GUNS.map(gun => `
            <button data-buy-gun="${gun.id}" class="cbgo-buy-card rarity-${gun.rarity.toLowerCase().replace(/[^a-z]/g, '-')}">
              <span>${this.escapeHtml(gun.kind.toUpperCase())}</span>
              <strong>${this.escapeHtml(gun.name)}</strong>
              <small>$${gun.price} · ${gun.magSize}/${gun.magSize * gun.reserveMags}</small>
              <em>${this.escapeHtml(gun.role)}</em>
            </button>
          `).join('')}
        </div>
        <div class="cbgo-buy-utility">
          <button data-buy-utility="armor">Kevlar $650</button>
          <button data-buy-utility="flash">Flashbang $200</button>
          <button data-buy-utility="smoke">Smoke $300</button>
          <button data-buy-utility="kit">Defuse Kit $400</button>
        </div>
        <div class="cbgo-buy-footer">
          <span>B toggles buy menu · R reloads · F inspects</span>
          <button data-action="close-buy">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  private createDeathOverlay(): HTMLDivElement {
    const root = document.createElement('div');
    root.id = 'cbgo-death-root';
    root.innerHTML = `
      <div class="cbgo-death-panel">
        <div class="cbgo-death-title">Eliminated</div>
        <div class="cbgo-death-subtitle">Spectating teammate POV</div>
        <div class="cbgo-death-target">Finding a player...</div>
        <div class="cbgo-death-actions">
          <button class="mc-btn" data-action="prev">Previous POV</button>
          <button class="mc-btn" data-action="next">Next POV</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  private injectStyles(): void {
    if (document.getElementById('cbgo-styles')) return;
    const style = document.createElement('style');
    style.id = 'cbgo-styles';
    style.textContent = `
      #cbgo-root, #cbgo-death-root {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 3900;
        color: #eef3f6;
        font-family: Inter, Segoe UI, Arial, sans-serif;
        background: rgba(8, 11, 15, 0.90);
      }
      #cbgo-root.visible, #cbgo-death-root.visible { display: flex; }
      #cbgo-root .mc-btn, #cbgo-death-root .mc-btn {
        min-height: 38px;
        padding: 0 16px;
        border: 1px solid rgba(147, 164, 180, 0.55);
        border-radius: 5px;
        color: #f5f7fa;
        background: #26313b;
        font-weight: 800;
        cursor: pointer;
      }
      #cbgo-root .mc-btn:hover, #cbgo-death-root .mc-btn:hover { border-color: #6cc18b; background: #2d433c; }
      .cbgo-panel {
        width: min(1180px, calc(100vw - 28px));
        max-height: calc(100vh - 28px);
        overflow: auto;
        padding: 18px;
        border: 1px solid rgba(143, 158, 171, 0.32);
        border-radius: 8px;
        background: #111820;
        box-shadow: 0 24px 80px rgba(0,0,0,0.58);
      }
      .cbgo-lobby {
        position: relative;
        width: min(1600px, calc(100vw - 18px));
        min-height: min(880px, calc(100vh - 18px));
        display: grid;
        grid-template-columns: 250px minmax(420px, 1fr) 250px;
        grid-template-rows: 48px minmax(360px, 1fr) auto auto auto;
        gap: 12px;
        padding: 14px;
        overflow: hidden;
        background:
          linear-gradient(180deg, rgba(8,18,28,0.48), rgba(8,12,16,0.86)),
          linear-gradient(135deg, #2d4658, #dbe8ef 52%, #697d8e);
      }
      .cbgo-lobby::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          repeating-linear-gradient(92deg, rgba(255,255,255,0.08) 0 1px, transparent 1px 92px),
          repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0 1px, transparent 1px 70px);
        opacity: 0.34;
        pointer-events: none;
      }
      .cbgo-lobby > * { position: relative; z-index: 1; }
      .cbgo-topbar {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: 42px 42px 42px 42px 1fr 1fr 1fr 1fr;
        align-items: center;
        min-height: 42px;
        margin: 0;
        color: rgba(238,243,246,0.72);
        font-size: 15px;
        text-transform: uppercase;
        text-align: center;
        border-bottom: 1px solid rgba(255,255,255,0.16);
        background: rgba(8, 13, 18, 0.30);
      }
      .cbgo-topbar strong { color: rgba(255,255,255,0.84); font-size: 18px; font-weight: 800; }
      .cbgo-topbar strong.active { color: #ffffff; text-shadow: 0 0 18px rgba(255,255,255,0.36); }
      .cbgo-topbar button {
        width: 36px;
        height: 36px;
        margin: auto;
        border: 0;
        color: #edf4f8;
        background: transparent;
        cursor: pointer;
        font-size: 18px;
      }
      .cbgo-lobby-left {
        grid-column: 1;
        grid-row: 2 / 5;
        display: grid;
        align-content: start;
        gap: 10px;
      }
      .cbgo-rank-card, .cbgo-promo, .cbgo-lobby-news, .cbgo-play-together, .cbgo-player-card {
        border: 1px solid rgba(0,0,0,0.45);
        background: rgba(12,18,24,0.58);
        box-shadow: 0 8px 26px rgba(0,0,0,0.26);
      }
      .cbgo-rank-card {
        min-height: 118px;
        padding: 12px;
        display: grid;
        align-content: center;
        color: #dce7ef;
        background: linear-gradient(135deg, rgba(33,43,52,0.94), rgba(194,160,76,0.34));
      }
      .cbgo-rank-card b { text-transform: uppercase; color: #e9c76d; }
      .cbgo-rank-card strong { font-size: 28px; margin-top: 6px; }
      .cbgo-rank-card .cbgo-state { margin-top: 8px; color: rgba(255,255,255,0.72); font-size: 11px; }
      .cbgo-promo {
        min-height: 112px;
        padding: 12px;
        display: grid;
        align-content: end;
        color: #fff;
      }
      .cbgo-promo b { font-size: 16px; text-transform: uppercase; }
      .cbgo-promo span { margin-top: 3px; color: rgba(255,255,255,0.76); font-size: 12px; }
      .cbgo-promo.mission { background: linear-gradient(135deg, #122b5a, #304a95); }
      .cbgo-promo.pass { min-height: 210px; background: linear-gradient(135deg, #082516, #18a35b 58%, #1e2a36); }
      .cbgo-promo.major { min-height: 190px; background: linear-gradient(135deg, #b99153, #efe0b9); color: #2d2112; }
      .cbgo-promo.major span { color: rgba(45,33,18,0.78); }
      .cbgo-lobby-stage {
        grid-column: 2;
        grid-row: 2;
        position: relative;
        display: grid;
        place-items: center;
        min-height: 440px;
      }
      .cbgo-lobby-right {
        grid-column: 3;
        grid-row: 2 / 4;
        display: grid;
        grid-template-rows: auto 1fr;
        gap: 12px;
        align-content: start;
      }
      .cbgo-play-together {
        min-height: 48px;
        display: grid;
        place-items: center;
        color: #ffffff;
        background: linear-gradient(90deg, #6fbf6a, #3a8a45);
        text-transform: uppercase;
        font-weight: 900;
        font-size: 18px;
      }
      .cbgo-friends {
        display: grid;
        gap: 8px;
        justify-content: end;
      }
      .cbgo-friends span {
        display: grid;
        place-items: center;
        width: 46px;
        height: 46px;
        border: 2px solid rgba(255,255,255,0.22);
        background: #17212a;
        color: #d9e2e9;
        font-weight: 900;
      }
      .cbgo-lobby-news {
        grid-column: 3;
        grid-row: 3;
        align-self: end;
        min-height: 108px;
        padding: 14px;
        background: rgba(124, 83, 42, 0.72);
      }
      .cbgo-lobby-news strong, .cbgo-lobby-news span { display: block; }
      .cbgo-lobby-news strong { font-size: 18px; color: #ffe1b6; }
      .cbgo-lobby-news span { margin-top: 6px; color: rgba(255,255,255,0.82); line-height: 1.35; }
      .cbgo-go {
        grid-column: 3;
        grid-row: 4;
        align-self: end;
        min-height: 74px;
        border: 3px solid rgba(0,0,0,0.58);
        border-radius: 3px;
        color: #9aff74;
        background: linear-gradient(180deg, #0d7e24, #056c17);
        font-size: 46px;
        font-weight: 1000;
        cursor: pointer;
        box-shadow: inset 0 0 0 2px rgba(255,255,255,0.16), 0 12px 34px rgba(0,0,0,0.38);
      }
      .cbgo-player-card {
        position: absolute;
        bottom: 32px;
        left: 50%;
        transform: translateX(-50%);
        min-width: 90px;
        padding: 8px;
        text-align: center;
        background: rgba(13,20,28,0.75);
      }
      .cbgo-player-card strong, .cbgo-player-card span { display: block; }
      .cbgo-player-card span { color: #8cea9e; font-weight: 900; }
      .cbgo-hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 190px;
        gap: 18px;
        align-items: stretch;
      }
      .cbgo-kicker { color: #e3b457; text-transform: uppercase; font-size: 12px; font-weight: 900; letter-spacing: 0; }
      .cbgo-panel h1 { margin: 3px 0 8px; font-size: 52px; line-height: 1; letter-spacing: 0; }
      .cbgo-panel p { margin: 0; max-width: 780px; color: rgba(238,243,246,0.72); line-height: 1.42; }
      .cbgo-agent-preview {
        position: relative;
        min-height: 142px;
        border: 1px solid rgba(255,255,255,0.11);
        border-radius: 6px;
        overflow: hidden;
        background:
          linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px),
          linear-gradient(0deg, rgba(255,255,255,0.04) 1px, transparent 1px),
          #1a232c;
        background-size: 24px 24px;
      }
      .cbgo-lobby .cbgo-agent-preview {
        width: 320px;
        height: 540px;
        min-height: 0;
        border: 0;
        overflow: visible;
        background: transparent;
      }
      .cbgo-agent-head, .cbgo-agent-body, .cbgo-agent-rifle { position: absolute; background: #c9d0d5; }
      .cbgo-agent-head { width: 34px; height: 34px; left: 78px; top: 22px; border-radius: 4px; box-shadow: inset 0 -10px 0 #303b45; }
      .cbgo-agent-body { width: 56px; height: 74px; left: 67px; top: 58px; border-radius: 6px 6px 3px 3px; background: #4d6578; box-shadow: inset 12px 0 0 #26313b, inset -12px 0 0 #25313b; }
      .cbgo-agent-rifle { width: 118px; height: 12px; left: 34px; top: 86px; transform: rotate(-8deg); border-radius: 2px; background: #171c22; box-shadow: 58px -10px 0 -3px #d4d8dc, 92px 0 0 -4px #171c22; }
      .cbgo-lobby .cbgo-agent-head { width: 58px; height: 66px; left: 132px; top: 46px; background: #6b5a3f; border-radius: 12px 12px 7px 7px; box-shadow: inset 0 -28px 0 #273620; }
      .cbgo-lobby .cbgo-agent-body { width: 104px; height: 210px; left: 108px; top: 116px; background: #d0c6a4; border-radius: 12px 12px 6px 6px; box-shadow: inset 20px 0 0 #7d836f, inset -20px 0 0 #4f5949; }
      .cbgo-agent-leg { position: absolute; top: 318px; width: 42px; height: 168px; background: #262c24; border-radius: 0 0 12px 12px; }
      .cbgo-agent-leg.left { left: 112px; transform: rotate(2deg); }
      .cbgo-agent-leg.right { left: 166px; transform: rotate(-3deg); }
      .cbgo-lobby .cbgo-agent-rifle { width: 210px; height: 18px; left: 56px; top: 202px; transform: rotate(20deg); background: #13191d; box-shadow: 118px -8px 0 -4px #5c3f24, 172px 0 0 -4px #0b0f13, 64px 18px 0 -6px #0b0f13; }
      .cbgo-actions, .cbgo-death-actions, .cbgo-map-row, .cbgo-status, .cbgo-roll-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .cbgo-actions { margin-top: 16px; }
      .cbgo-lobby .cbgo-veto-board {
        grid-column: 1 / -1;
        grid-row: 5;
      }
      .cbgo-veto-board {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin: 14px 0;
      }
      .cbgo-veto-board div {
        min-height: 54px;
        padding: 9px 11px;
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 6px;
        background: #18222b;
      }
      .cbgo-veto-board span, .cbgo-roll-card small {
        display: block;
        color: rgba(238,243,246,0.62);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0;
      }
      .cbgo-veto-board strong { display: block; margin-top: 3px; color: #ffffff; }
      .cbgo-lobby .cbgo-map-row {
        grid-column: 1 / -1;
        grid-row: 6;
      }
      .cbgo-map-row {
        display: grid;
        grid-template-columns: repeat(7, minmax(118px, 1fr));
        gap: 8px;
      }
      .cbgo-map {
        min-height: 88px;
        padding: 10px;
        color: #f3f6f8;
        text-align: left;
        background: #17212a;
        border: 1px solid rgba(255,255,255,0.10);
        border-top: 3px solid var(--accent);
        border-radius: 6px;
        cursor: pointer;
      }
      .cbgo-map:hover { border-color: var(--accent); background: #1d2a34; }
      .cbgo-map span {
        display: inline-grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border-radius: 4px;
        color: #0d1115;
        background: var(--accent);
        font-weight: 900;
      }
      .cbgo-map strong { display: block; margin-top: 8px; font-size: 15px; }
      .cbgo-map small { display: block; margin-top: 4px; color: rgba(238,243,246,0.62); line-height: 1.2; }
      .cbgo-status { margin-top: 12px; justify-content: space-between; color: rgba(243,246,248,0.74); font-weight: 800; }
      .cbgo-money { color: #85d892; font-size: 22px; }
      .cbgo-lobby .cbgo-roll-title,
      .cbgo-lobby .cbgo-roll-window,
      .cbgo-lobby .cbgo-roll-controls,
      .cbgo-lobby .cbgo-roll {
        grid-column: 1 / -1;
      }
      .cbgo-roll-title {
        margin-top: 14px;
        color: #e3e7eb;
        text-align: center;
        font-size: 18px;
        font-weight: 900;
      }
      .cbgo-roll { min-height: 24px; margin-top: 10px; color: #e3b457; font-weight: 900; text-align: center; }
      .cbgo-roll .rarity-consumer { color: #b8c5d0; }
      .cbgo-roll .rarity-mil-spec { color: #62d4ff; }
      .cbgo-roll .rarity-restricted { color: #b58cff; }
      .cbgo-roll .rarity-classified { color: #ff6fb7; }
      .cbgo-roll .rarity-covert { color: #ff5a72; }
      .cbgo-roll-window {
        position: relative;
        height: 150px;
        margin-top: 10px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px;
        background: #0d1218;
      }
      .cbgo-roll-window::before, .cbgo-roll-window::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        width: 90px;
        z-index: 3;
        pointer-events: none;
      }
      .cbgo-roll-window::before { left: 0; background: linear-gradient(90deg, #0d1218, rgba(13,18,24,0)); }
      .cbgo-roll-window::after { right: 0; background: linear-gradient(270deg, #0d1218, rgba(13,18,24,0)); }
      .cbgo-roll-marker {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 50%;
        width: 2px;
        transform: translateX(-50%);
        background: #e8803d;
        box-shadow: 0 0 18px #e8803d;
        z-index: 4;
      }
      .cbgo-roll-marker::before {
        content: "";
        position: absolute;
        top: -1px;
        left: 50%;
        transform: translateX(-50%);
        border-left: 7px solid transparent;
        border-right: 7px solid transparent;
        border-top: 8px solid #e8803d;
      }
      .cbgo-roll-track { display: flex; gap: 6px; align-items: stretch; height: 100%; padding: 0 0 0 8px; will-change: transform; }
      .cbgo-roll-card {
        position: relative;
        flex: 0 0 160px;
        height: 126px;
        margin-top: 12px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        border: 1px solid rgba(255,255,255,0.10);
        border-top: 4px solid #738291;
        border-radius: 3px;
        background: #161d26;
        overflow: hidden;
      }
      .cbgo-roll-rarity {
        position: absolute;
        top: 8px;
        left: 10px;
        right: 10px;
        color: rgba(238,243,246,0.68);
        font-size: 10px;
        font-weight: 900;
        text-transform: uppercase;
      }
      .cbgo-roll-card strong { position: relative; z-index: 2; font-size: 14px; line-height: 1.05; }
      .cbgo-roll-card small { position: relative; z-index: 2; margin-top: 3px; text-transform: none; }
      .cbgo-roll-card.rarity-consumer { border-top-color: #b8c5d0; }
      .cbgo-roll-card.rarity-mil-spec { border-top-color: #62d4ff; }
      .cbgo-roll-card.rarity-restricted { border-top-color: #b58cff; }
      .cbgo-roll-card.rarity-classified { border-top-color: #ff6fb7; }
      .cbgo-roll-card.rarity-covert { border-top-color: #ff5a72; box-shadow: inset 0 0 32px rgba(255,90,114,0.16); }
      .cbgo-roll-card.winner { transform: scale(1.04); box-shadow: 0 0 28px rgba(232,128,61,0.42); }
      .cbgo-gun-silhouette {
        position: absolute;
        left: 18px;
        right: 14px;
        top: 38px;
        height: 44px;
        opacity: 0.92;
      }
      .cbgo-gun-silhouette::before, .cbgo-gun-silhouette i, .cbgo-gun-silhouette b, .cbgo-gun-silhouette em {
        content: "";
        position: absolute;
        display: block;
        background: #e8edf2;
      }
      .cbgo-gun-silhouette::before { left: 18px; top: 14px; width: 82px; height: 12px; border-radius: 2px; }
      .cbgo-gun-silhouette i { right: 6px; top: 17px; width: 42px; height: 5px; }
      .cbgo-gun-silhouette b { left: 54px; top: 26px; width: 12px; height: 20px; transform: skew(-10deg); }
      .cbgo-gun-silhouette em { left: 14px; top: 18px; width: 20px; height: 16px; transform: skew(-22deg); }
      .cbgo-gun-silhouette.kind-pistol::before { left: 38px; width: 56px; }
      .cbgo-gun-silhouette.kind-pistol i { right: 24px; width: 24px; }
      .cbgo-gun-silhouette.kind-pistol em { display: none; }
      .cbgo-gun-silhouette.kind-sniper::before { width: 96px; height: 8px; }
      .cbgo-gun-silhouette.kind-sniper i { right: 0; width: 58px; height: 4px; }
      .cbgo-gun-silhouette.kind-sniper em { left: 38px; top: 4px; width: 28px; height: 10px; border-radius: 8px; }
      .cbgo-gun-silhouette.kind-shotgun::before { width: 94px; height: 10px; }
      .cbgo-gun-silhouette.kind-shotgun b { left: 42px; height: 12px; }
      .cbgo-roll-controls { justify-content: center; margin-top: 9px; }
      .cbgo-roll-controls button {
        min-width: 42px;
        height: 34px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 4px;
        color: #aeb9c3;
        background: #121820;
        font-weight: 800;
      }
      .cbgo-roll-controls button.active, .cbgo-roll-controls button[data-action="case"] {
        min-width: 118px;
        color: #d9f8e2;
        border-color: #2a9d61;
        background: #173326;
      }
      #cbgo-arena-hud {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        width: min(780px, calc(100vw - 28px));
        z-index: 2600;
        display: none;
        color: #eef3f6;
        font-family: Inter, Segoe UI, Arial, sans-serif;
        pointer-events: none;
      }
      #cbgo-arena-hud.visible { display: block; }
      #cbgo-buy-root {
        position: fixed;
        inset: 0;
        z-index: 3000;
        display: none;
        align-items: center;
        justify-content: center;
        color: #edf4f8;
        font-family: Inter, Segoe UI, Arial, sans-serif;
        background: rgba(5, 8, 12, 0.42);
        pointer-events: auto;
      }
      #cbgo-buy-root.visible { display: flex; }
      .cbgo-buy-panel {
        width: min(880px, calc(100vw - 32px));
        padding: 16px;
        border: 1px solid rgba(193, 205, 214, 0.22);
        border-radius: 6px;
        background: rgba(14, 21, 28, 0.94);
        box-shadow: 0 22px 70px rgba(0,0,0,0.56);
      }
      .cbgo-buy-head, .cbgo-buy-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .cbgo-buy-head strong {
        display: block;
        font-size: 28px;
        line-height: 1;
      }
      .cbgo-buy-head span, .cbgo-buy-footer span {
        display: block;
        margin-top: 4px;
        color: rgba(237,244,248,0.68);
        font-size: 12px;
      }
      .cbgo-buy-money {
        color: #8cea9e;
        font-size: 30px;
        font-weight: 900;
      }
      .cbgo-buy-grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 8px;
        margin: 14px 0;
      }
      .cbgo-buy-card, .cbgo-buy-utility button, .cbgo-buy-footer button {
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 5px;
        color: #edf4f8;
        background: #17212a;
        cursor: pointer;
      }
      .cbgo-buy-card {
        min-height: 142px;
        padding: 12px;
        text-align: left;
        border-top: 3px solid #7f8b96;
      }
      .cbgo-buy-card:hover:not(:disabled), .cbgo-buy-utility button:hover:not(:disabled), .cbgo-buy-footer button:hover {
        background: #21313c;
        border-color: #8cea9e;
      }
      .cbgo-buy-card:disabled, .cbgo-buy-utility button:disabled {
        opacity: 0.42;
        cursor: not-allowed;
      }
      .cbgo-buy-card.owned { box-shadow: inset 0 0 0 1px #8cea9e; }
      .cbgo-buy-card span {
        color: #95a5b2;
        font-size: 11px;
        font-weight: 900;
      }
      .cbgo-buy-card strong {
        display: block;
        margin-top: 8px;
        font-size: 16px;
        line-height: 1.05;
      }
      .cbgo-buy-card small, .cbgo-buy-card em {
        display: block;
        margin-top: 6px;
        color: rgba(237,244,248,0.64);
        font-style: normal;
        line-height: 1.25;
      }
      .cbgo-buy-utility {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin-bottom: 12px;
      }
      .cbgo-buy-utility button, .cbgo-buy-footer button {
        min-height: 38px;
        padding: 0 12px;
        font-weight: 900;
      }
      .cbgo-hud-top {
        display: grid;
        grid-template-columns: 1fr 132px 1fr;
        align-items: center;
        gap: 8px;
      }
      .cbgo-hud-score, .cbgo-hud-clock, .cbgo-hud-stakes, .cbgo-hud-meta, .cbgo-hud-buy {
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 5px;
        background: rgba(10, 15, 20, 0.82);
        box-shadow: 0 8px 24px rgba(0,0,0,0.32);
      }
      .cbgo-hud-score {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        min-height: 48px;
        padding: 0 12px;
        font-weight: 900;
      }
      .cbgo-hud-score b { color: #cfd7df; font-size: 12px; }
      .cbgo-score-t { color: #e6b762; }
      .cbgo-score-ct { color: #79bdff; text-align: right; }
      .cbgo-hud-clock { min-height: 48px; display: grid; place-items: center; }
      .cbgo-hud-phase { color: #aeb9c3; font-size: 11px; font-weight: 900; text-transform: uppercase; }
      .cbgo-hud-timer { margin-top: -4px; font-size: 27px; line-height: 1; color: #ffffff; }
      .cbgo-hud-stakes { min-height: 48px; display: grid; place-items: center; color: #85d892; font-weight: 900; }
      .cbgo-hud-meta {
        margin: 8px auto 0;
        max-width: 680px;
        min-height: 28px;
        padding: 6px 12px;
        color: rgba(238,243,246,0.72);
        font-size: 12px;
        text-align: center;
      }
      .cbgo-hud-buy {
        position: fixed;
        left: 16px;
        bottom: 92px;
        display: grid;
        gap: 4px;
        min-width: 180px;
        padding: 10px 12px;
        font-size: 13px;
        font-weight: 800;
      }
      .cbgo-hud-buy span:first-child { color: #85d892; font-size: 20px; }
      .cbgo-death-panel {
        width: min(620px, calc(100vw - 34px));
        padding: 28px;
        text-align: center;
        border-top: 4px solid #ff5a72;
        border-radius: 8px;
        background: rgba(10,12,15,0.94);
        box-shadow: 0 24px 80px rgba(0,0,0,0.62);
      }
      .cbgo-death-title { font-size: 46px; font-weight: 900; color: #ff5a72; }
      .cbgo-death-subtitle { margin-top: 8px; color: rgba(243,246,248,0.78); }
      .cbgo-death-target { margin: 18px 0; color: #e3b457; font-weight: 800; }
      @media (max-width: 900px) {
        .cbgo-panel { padding: 14px; }
        .cbgo-hero { grid-template-columns: 1fr; }
        .cbgo-agent-preview { display: none; }
        .cbgo-map-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .cbgo-veto-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .cbgo-panel h1 { font-size: 40px; }
        .cbgo-buy-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .cbgo-buy-utility { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .cbgo-hud-top { grid-template-columns: 1fr; }
        .cbgo-hud-stakes { display: none; }
        .cbgo-hud-buy { left: 10px; bottom: 82px; }
      }
    `;
    document.head.appendChild(style);
  }
}
