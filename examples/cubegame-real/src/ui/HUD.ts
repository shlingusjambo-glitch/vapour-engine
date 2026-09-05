import { EventBus } from '../core/EventBus';
import { CommandParser } from '../core/CommandParser';
import { PlatformRuntime } from '../core/PlatformRuntime';

export class HUD {
  private elHealthBar: HTMLElement;
  private elHungerBar: HTMLElement;
  
  private elFps: HTMLElement;
  private elPing: HTMLElement;
  private elChunks: HTMLElement;
  private elEntities: HTMLElement;
  private elWorkerQueue: HTMLElement;
  private elPos: HTMLElement;
  private elSeed: HTMLElement;
  private elTargetFps: HTMLElement | null;
  private elBlock: HTMLElement | null;
  private elChunk: HTMLElement | null;
  private elChunkLocal: HTMLElement | null;
  private elFacing: HTMLElement | null;
  private elDimension: HTMLElement | null;
  private elTargetBlock: HTMLElement | null;
  private elDisplay: HTMLElement | null;
  private elRenderer: HTMLElement | null;
  private elMemory: HTMLElement | null;
  private elFrameMs: HTMLElement | null;
  private elRefresh: HTMLElement | null;
  private elPhysicsRate: HTMLElement | null;
  private elHost: HTMLElement | null;
  private elPlatform: HTMLElement | null;
  private elBiome: HTMLElement | null;
  private elWeather: HTMLElement | null;
  private elTime: HTMLElement | null;
  private elNetworkMode: HTMLElement | null;
  private elRoom: HTMLElement | null;
  private elServerTick: HTMLElement | null;
  private elPlayers: HTMLElement | null;
  private elMobAuthority: HTMLElement | null;
  private elSyncState: HTMLElement | null;
  private elCrownForgeLine: HTMLElement | null;
  private elCrownForge: HTMLElement | null;
  private debugPanel: HTMLElement | null;
  private bedWarsShopShortcuts: HTMLElement | null;
  private bedWarsItemShopButton: HTMLButtonElement | null;
  private bedWarsUpgradeShopButton: HTMLButtonElement | null;
  private f3Visible = false;
  private activeEffectsPanel: HTMLElement | null = null;
  private effectLoopActive = false;
  private effectDurationElements = new Map<string, HTMLElement>();
  private effectCards = new Map<string, HTMLElement>();

  private elChatMessages: HTMLElement;
  private elChatInput: HTMLInputElement;

  constructor() {
    // Stat Bars
    this.elHealthBar = document.getElementById('health-bar')!;
    this.elHungerBar = document.getElementById('hunger-bar')!;

    // Debug panel spans
    this.elFps = document.getElementById('debug-fps')!;
    this.elPing = document.getElementById('debug-ping')!;
    this.elChunks = document.getElementById('debug-chunks')!;
    this.elEntities = document.getElementById('debug-entities')!;
    this.elWorkerQueue = document.getElementById('debug-worker-queue')!;
    this.elPos = document.getElementById('debug-pos')!;
    this.elSeed = document.getElementById('debug-seed')!;
    this.elTargetFps = document.getElementById('debug-target-fps');
    this.elBlock = document.getElementById('debug-block');
    this.elChunk = document.getElementById('debug-chunk');
    this.elChunkLocal = document.getElementById('debug-chunk-local');
    this.elFacing = document.getElementById('debug-facing');
    this.elDimension = document.getElementById('debug-dimension');
    this.elTargetBlock = document.getElementById('debug-target-block');
    this.elDisplay = document.getElementById('debug-display');
    this.elRenderer = document.getElementById('debug-renderer');
    this.elMemory = document.getElementById('debug-memory');
    this.elFrameMs = document.getElementById('debug-frame-ms');
    this.elRefresh = document.getElementById('debug-refresh');
    this.elPhysicsRate = document.getElementById('debug-physics-rate');
    this.elHost = document.getElementById('debug-host');
    this.elPlatform = document.getElementById('debug-platform');
    this.elBiome = document.getElementById('debug-biome');
    this.elWeather = document.getElementById('debug-weather');
    this.elTime = document.getElementById('debug-time');
    this.elNetworkMode = document.getElementById('debug-network-mode');
    this.elRoom = document.getElementById('debug-room');
    this.elServerTick = document.getElementById('debug-server-tick');
    this.elPlayers = document.getElementById('debug-players');
    this.elMobAuthority = document.getElementById('debug-mob-authority');
    this.elSyncState = document.getElementById('debug-sync-state');
    this.elCrownForgeLine = document.getElementById('debug-crownforge-line');
    this.elCrownForge = document.getElementById('debug-crownforge');
    this.debugPanel = document.getElementById('debug-panel');
    this.bedWarsShopShortcuts = document.getElementById('bedwars-shop-shortcuts');
    this.bedWarsItemShopButton = document.getElementById('bedwars-open-item-shop') as HTMLButtonElement | null;
    this.bedWarsUpgradeShopButton = document.getElementById('bedwars-open-upgrade-shop') as HTMLButtonElement | null;
    PlatformRuntime.updateDebugPanel();

    this.f3Visible = false;
    this.applyF3Visibility();

    // Dynamically append gamemode indicator to debug panel
    const debugPanel = this.debugPanel;
    if (debugPanel) {
      const modeEl = document.createElement('div');
      modeEl.className = 'debug-line';
      modeEl.innerHTML = 'MODE: <span id="debug-gamemode">SURVIVAL</span>';
      debugPanel.querySelector('.debug-column')?.appendChild(modeEl);
    }

    // Chat Log
    this.elChatMessages = document.getElementById('chat-messages')!;
    this.elChatInput = document.getElementById('chat-input') as HTMLInputElement;

    // Bind chat events
    EventBus.on('press:enter', () => this.handleChatSubmit());
    EventBus.on('network:chat', (msg: string) => this.addChatMessage(msg));
    EventBus.on('debug:toggleF3', () => this.toggleF3());
    this.bedWarsItemShopButton?.addEventListener('click', (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      EventBus.emit('bedwars:openShopButton', { kind: 'itemShop' });
    });
    this.bedWarsUpgradeShopButton?.addEventListener('click', (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      EventBus.emit('bedwars:openShopButton', { kind: 'teamUpgrades' });
    });

    // Bind XP events
    EventBus.on('player:xpChanged', (data: { xp: number, level: number, max: number }) => {
      const elBar = document.getElementById('xp-bar');
      const elLvl = document.getElementById('xp-level');
      if (elBar) {
        const pct = Math.max(0, Math.min(100, (data.xp / data.max) * 100));
        elBar.style.width = `${pct}%`;
      }
      if (elLvl) {
        elLvl.textContent = data.level.toString();
        // Brief scale pop effect
        elLvl.style.transform = 'scale(1.3)';
        setTimeout(() => {
          elLvl.style.transform = 'scale(1)';
        }, 150);
      }
    });

    EventBus.on('player:armorChanged', (points: number) => {
      this.updateArmor(points);
    });

    this.activeEffectsPanel = document.getElementById('active-effects-panel');
    EventBus.on('player:effectsChanged', (effects: string[]) => {
      this.rebuildActiveEffectsDOM(effects);
      this.updateActiveEffectsDurations();
      if (effects.length > 0 && !this.effectLoopActive) {
        this.startEffectTimerLoop();
      }
    });
  }

  public updateGamemode(mode: string): void {
    const el = document.getElementById('debug-gamemode');
    if (el) {
      el.textContent = mode.toUpperCase();
    }
  }

  public updateHealth(hp: number, maxHp: number = 20): void {
    this.renderIconMeter(this.elHealthBar, hp, maxHp, 'health');
  }

  public updateHunger(hunger: number, maxHunger: number = 20): void {
    this.renderIconMeter(this.elHungerBar, hunger, maxHunger, 'hunger');
  }

  public updateArmor(armorPoints: number): void {
    const container = document.getElementById('armor-container');
    if (!container) return;
    if (armorPoints > 0) {
      container.style.display = 'flex';
      const bar = document.getElementById('armor-bar');
      if (bar) {
        const pct = Math.max(0, Math.min(100, (armorPoints / 20) * 100));
        bar.style.width = `${pct}%`;
      }
    } else {
      container.style.display = 'none';
    }
  }

  public updateDebug(
    fps: number,
    ping: number,
    chunks: number,
    entities: number,
    workerQueue: number,
    pos: { x: number; y: number; z: number },
    seed: number | string
  ): void {
    this.elFps.textContent = fps.toString();
    this.elPing.textContent = `${ping}ms`;
    this.elFrameMs && (this.elFrameMs.textContent = fps > 0 ? (1000 / fps).toFixed(2) : '0.0');
    this.elPhysicsRate && (this.elPhysicsRate.textContent = '20');
    this.elChunks.textContent = chunks.toString();
    this.elEntities.textContent = entities.toString();
    this.elWorkerQueue.textContent = workerQueue.toString();
    this.elPos.textContent = `${pos.x.toFixed(3)} / ${pos.y.toFixed(5)} / ${pos.z.toFixed(3)}`;
    this.elSeed.textContent = seed.toString();
    const refreshLabel = this.estimateRefreshLabel(fps);
    this.elTargetFps && (this.elTargetFps.textContent = refreshLabel);
    this.elRefresh && (this.elRefresh.textContent = refreshLabel);

    const bx = Math.floor(pos.x);
    const by = Math.floor(pos.y);
    const bz = Math.floor(pos.z);
    const cx = Math.floor(bx / 16);
    const cy = Math.floor(by / 16);
    const cz = Math.floor(bz / 16);
    const lx = ((bx % 16) + 16) % 16;
    const ly = ((by % 16) + 16) % 16;
    const lz = ((bz % 16) + 16) % 16;

    this.elBlock && (this.elBlock.textContent = `${bx} ${by} ${bz}`);
    this.elChunk && (this.elChunk.textContent = `${cx} ${cy} ${cz}`);
    this.elChunkLocal && (this.elChunkLocal.textContent = `${lx} ${ly} ${lz}`);

    const camera = (window as any).gameCameraController;
    this.elFacing && (this.elFacing.textContent = this.getFacingLabel(Number(camera?.yaw || 0)));

    const world = (window as any).gamePlayerController?.world;
    const dimension = String(world?.currentDimension || 'overworld');
    this.elDimension && (this.elDimension.textContent = dimension);
    this.elBiome && (this.elBiome.textContent = String(world?.getBiomeAt?.(bx, bz) || world?.currentBiome || 'unknown'));
    this.elWeather && (this.elWeather.textContent = String((window as any).gameWeatherState || world?.weather || 'clear'));
    this.elTime && (this.elTime.textContent = String((window as any).gameTimeOfDayLabel || world?.timeOfDayLabel || 'day'));

    const isCrownForge = dimension === 'lobby' || dimension.includes('skywars') || dimension.includes('bedwars') || dimension.includes('castle') || dimension.includes('duels') || dimension.includes('survival_games') || dimension.startsWith('cbgo_') || dimension.startsWith('cob_');
    if (this.bedWarsShopShortcuts) {
      this.bedWarsShopShortcuts.classList.toggle('visible', dimension.includes('bedwars'));
    }
    const net = (window as any).gameNetworkManager || {};
    this.elNetworkMode && (this.elNetworkMode.textContent = isCrownForge ? 'CrownForge' : (net.connected ? 'Public Multiplayer' : 'Singleplayer'));
    this.elRoom && (this.elRoom.textContent = String(net.roomId || net.currentRoom || (isCrownForge ? dimension : 'local')));
    this.elServerTick && (this.elServerTick.textContent = String(net.serverTick || 'n/a'));
    this.elPlayers && (this.elPlayers.textContent = String(net.playersOnline || net.playerCount || (net.connected ? '?' : 1)));
    this.elMobAuthority && (this.elMobAuthority.textContent = String(net.mobAuthorityUuid || 'local'));
    this.elSyncState && (this.elSyncState.textContent = String(net.syncState || (net.connected ? 'connected' : 'offline')));
    if (this.elCrownForgeLine) this.elCrownForgeLine.style.display = isCrownForge ? 'block' : 'none';
    if (this.elCrownForge) this.elCrownForge.textContent = isCrownForge ? dimension : 'none';

    const target = (window as any).gamePlayerController?.targetBlock;
    if (this.elTargetBlock) {
      this.elTargetBlock.textContent = target
        ? `${target.x} ${target.y} ${target.z} (${target.blockId})`
        : 'none';
    }

    if (this.elDisplay) {
      const dpr = window.devicePixelRatio || 1;
      this.elDisplay.textContent = `${Math.round(window.innerWidth * dpr)}x${Math.round(window.innerHeight * dpr)} (${dpr.toFixed(2)}x)`;
    }
    const platform = PlatformRuntime.getInfo();
    this.elHost && (this.elHost.textContent = platform.host === 'native' ? 'Electron/Native Host' : 'Browser');
    this.elPlatform && (this.elPlatform.textContent = platform.os);
    this.elRenderer && (this.elRenderer.textContent = this.getRendererLabel());
    this.elMemory && (this.elMemory.textContent = this.getMemoryLabel());
  }

  private toggleF3(): void {
    this.f3Visible = !this.f3Visible;
    this.applyF3Visibility();
  }

  private applyF3Visibility(): void {
    this.debugPanel?.classList.toggle('f3-visible', this.f3Visible);
  }

  private renderIconMeter(container: HTMLElement, value: number, maxValue: number, kind: 'health' | 'hunger'): void {
    const slots = 10;
    const safeMax = Math.max(1, maxValue);
    const unitsPerIcon = safeMax / slots;
    const clamped = Math.max(0, Math.min(safeMax, value));
    const fullChar = kind === 'health' ? '♥' : '🍗';
    const emptyChar = kind === 'health' ? '♡' : '🍗';

    container.classList.toggle('health-icons', kind === 'health');
    container.classList.toggle('hunger-icons', kind === 'hunger');
    container.innerHTML = '';

    for (let i = 0; i < slots; i++) {
      const fill = Math.max(0, Math.min(1, (clamped - i * unitsPerIcon) / unitsPerIcon));
      const icon = document.createElement('span');
      icon.className = `stat-icon ${kind}`;
      icon.dataset.fill = fill >= 0.99 ? 'full' : fill >= 0.49 ? 'half' : 'empty';

      const empty = document.createElement('span');
      empty.className = 'stat-icon-empty';
      empty.textContent = emptyChar;

      const filled = document.createElement('span');
      filled.className = 'stat-icon-fill';
      filled.textContent = fullChar;
      filled.style.width = `${Math.round(fill * 100)}%`;

      icon.append(empty, filled);
      container.appendChild(icon);
    }
  }

  private estimateRefreshLabel(fps: number): string {
    if (fps >= 116) return '120';
    if (fps >= 88) return '90';
    if (fps >= 58) return '60';
    if (fps >= 28) return '30';
    return 'display';
  }

  private getFacingLabel(yaw: number): string {
    const twoPi = Math.PI * 2;
    const normalized = ((yaw % twoPi) + twoPi) % twoPi;
    const directions = [
      { name: 'south (+Z)', angle: 0 },
      { name: 'west (-X)', angle: Math.PI / 2 },
      { name: 'north (-Z)', angle: Math.PI },
      { name: 'east (+X)', angle: Math.PI * 1.5 },
    ];
    let best = directions[0];
    let bestDelta = Infinity;
    for (const dir of directions) {
      const delta = Math.abs(Math.atan2(Math.sin(normalized - dir.angle), Math.cos(normalized - dir.angle)));
      if (delta < bestDelta) {
        best = dir;
        bestDelta = delta;
      }
    }
    return `${best.name} (${(normalized * 180 / Math.PI).toFixed(1)} / ${bestDelta.toFixed(2)})`;
  }

  private getRendererLabel(): string {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && dbg) {
      return String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || 'WebGL');
    }
    return 'WebGL';
  }

  private getMemoryLabel(): string {
    const memory = (performance as any).memory;
    if (!memory?.usedJSHeapSize) return 'n/a';
    const used = Math.round(memory.usedJSHeapSize / 1048576);
    const total = Math.round((memory.jsHeapSizeLimit || memory.totalJSHeapSize || 0) / 1048576);
    return total > 0 ? `${used}/${total}MB` : `${used}MB`;
  }

  // CHAT OVERLAY LOGIC
  private handleChatSubmit(): void {
    const isOpen = this.elChatInput.style.display === 'block';

    if (!isOpen) {
      // Open chat input, release pointer lock
      this.elChatInput.style.display = 'block';
      this.elChatInput.focus();
      EventBus.emit('chat:active', true);
    } else {
      // Send chat message or run command
      const text = this.elChatInput.value.trim();
      if (text.length > 0) {
        if (text.startsWith('/')) {
          CommandParser.parse(text);
        } else {
          EventBus.emit('chat:send', text);
          this.addChatMessage(`[You]: ${text}`);
        }
      }

      this.elChatInput.value = '';
      this.elChatInput.style.display = 'none';
      this.elChatInput.blur();
      EventBus.emit('chat:active', false);
    }
  }

  public addChatMessage(message: string): void {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg';
    msgEl.textContent = message;
    
    this.elChatMessages.appendChild(msgEl);
    this.elChatMessages.scrollTop = this.elChatMessages.scrollHeight;

    // Fade chat messages out after 6 seconds to keep HUD clean
    setTimeout(() => {
      msgEl.style.transition = 'opacity 1s';
      msgEl.style.opacity = '0';
      setTimeout(() => msgEl.remove(), 1000);
    }, 6000);
  }

  private rebuildActiveEffectsDOM(effects: string[]): void {
    if (!this.activeEffectsPanel) return;

    this.activeEffectsPanel.innerHTML = '';
    this.effectDurationElements.clear();
    this.effectCards.clear();

    const sortedEffects = [...effects].sort();

    for (const effectName of sortedEffects) {
      const card = document.createElement('div');
      card.className = 'active-effect-card';
      card.id = `effect-card-${effectName}`;

      const info = this.getEffectInfo(effectName);

      const iconEl = document.createElement('div');
      iconEl.className = 'active-effect-icon';
      iconEl.textContent = info.emoji;
      iconEl.style.backgroundColor = info.color;
      iconEl.style.boxShadow = `0 0 8px ${info.color}`;

      const detailsEl = document.createElement('div');
      detailsEl.className = 'active-effect-details';

      const nameEl = document.createElement('div');
      nameEl.className = 'active-effect-name';
      nameEl.textContent = info.displayName;

      const durationEl = document.createElement('div');
      durationEl.className = 'active-effect-duration';
      durationEl.id = `effect-duration-${effectName}`;

      detailsEl.append(nameEl, durationEl);
      card.append(iconEl, detailsEl);
      this.activeEffectsPanel.appendChild(card);

      this.effectDurationElements.set(effectName, durationEl);
      this.effectCards.set(effectName, card);
    }
  }

  private updateActiveEffectsDurations(): void {
    const playerController = (window as any).gamePlayerController;
    if (!playerController) return;

    const activeEffectsMap = playerController.activeEffects as Map<string, number>;

    for (const [effectName, durationEl] of this.effectDurationElements.entries()) {
      const duration = activeEffectsMap.get(effectName) || 0;
      if (duration <= 0) continue;

      const formatted = this.formatDuration(duration);
      if (durationEl.textContent !== formatted) {
        durationEl.textContent = formatted;
      }

      const card = this.effectCards.get(effectName);
      if (card) {
        if (duration < 10) {
          if (!card.classList.contains('wearing-off')) {
            card.classList.add('wearing-off');
          }
        } else {
          if (card.classList.contains('wearing-off')) {
            card.classList.remove('wearing-off');
          }
        }
      }
    }
  }

  private formatDuration(seconds: number): string {
    if (seconds === Infinity || seconds > 99999) return 'Infinite';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  private getEffectInfo(name: string): { displayName: string; emoji: string; color: string } {
    const map: Record<string, { displayName: string; emoji: string; color: string }> = {
      speed: { displayName: 'Speed', emoji: '⚡', color: 'rgba(0, 230, 255, 0.25)' },
      slowness: { displayName: 'Slowness', emoji: '🕸️', color: 'rgba(90, 90, 90, 0.25)' },
      jump_boost: { displayName: 'Jump Boost', emoji: '🐇', color: 'rgba(92, 255, 92, 0.25)' },
      slow_falling: { displayName: 'Slow Falling', emoji: '🪂', color: 'rgba(230, 230, 250, 0.25)' },
      invisibility: { displayName: 'Invisibility', emoji: '👻', color: 'rgba(255, 255, 255, 0.15)' },
      fire_resistance: { displayName: 'Fire Resistance', emoji: '🔥', color: 'rgba(255, 120, 0, 0.25)' },
      water_breathing: { displayName: 'Water Breathing', emoji: '🐡', color: 'rgba(0, 150, 255, 0.25)' },
      regeneration: { displayName: 'Regeneration', emoji: '💖', color: 'rgba(255, 0, 100, 0.25)' },
      poison: { displayName: 'Poison', emoji: '🤢', color: 'rgba(0, 200, 0, 0.25)' },
      wither: { displayName: 'Wither', emoji: '💀', color: 'rgba(30, 30, 30, 0.35)' },
      strength: { displayName: 'Strength', emoji: '💪', color: 'rgba(200, 0, 0, 0.25)' },
      haste: { displayName: 'Haste', emoji: '⛏️', color: 'rgba(255, 215, 0, 0.25)' },
      resistance: { displayName: 'Resistance', emoji: '🛡️', color: 'rgba(128, 128, 128, 0.25)' },
      leaping: { displayName: 'Leaping', emoji: '🐇', color: 'rgba(92, 255, 92, 0.25)' },
      night_vision: { displayName: 'Night Vision', emoji: '👁️', color: 'rgba(148, 0, 211, 0.25)' },
    };

    return map[name.toLowerCase()] || { displayName: name, emoji: '🧪', color: 'rgba(180, 0, 255, 0.25)' };
  }

  private startEffectTimerLoop(): void {
    if (this.effectLoopActive) return;
    this.effectLoopActive = true;

    const tick = () => {
      const playerController = (window as any).gamePlayerController;
      if (!playerController) {
        this.effectLoopActive = false;
        return;
      }

      const effectsCount = playerController.activeEffects?.size ?? 0;
      if (effectsCount === 0) {
        if (this.activeEffectsPanel) this.activeEffectsPanel.innerHTML = '';
        this.effectDurationElements.clear();
        this.effectCards.clear();
        this.effectLoopActive = false;
        return;
      }

      this.updateActiveEffectsDurations();
      setTimeout(tick, 200);
    };

    setTimeout(tick, 200);
  }
}
