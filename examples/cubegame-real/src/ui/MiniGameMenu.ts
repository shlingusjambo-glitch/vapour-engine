import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { MINIGAME_DEFINITIONS, type MinigameDefinition } from '../crownforge/CrownForgeCatalog';

interface MiniGameMenuState {
  activeRoom?: string;
  activeDimension?: string;
  serverName?: string;
  connected?: boolean;
}

export class MiniGameMenu {
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private grid: HTMLDivElement;
  private statusText: HTMLDivElement;
  private selectedIndex = 0;
  private isVisible = false;
  private state: MiniGameMenuState = {};
  private cards: HTMLButtonElement[] = [];

  constructor() {
    this.injectStyles();

    this.root = document.createElement('div');
    this.root.id = 'minigame-menu-root';
    this.root.className = 'minigame-menu hidden';
    this.root.innerHTML = `
      <div class="minigame-backdrop" data-close="true"></div>
      <div class="minigame-panel" role="dialog" aria-modal="true" aria-label="CrownForge minigame selector">
        <div class="minigame-panel-topline"></div>
        <div class="minigame-header">
          <div>
            <div class="minigame-eyebrow">CrownForge Navigator</div>
            <h2>Choose a server mode</h2>
            <p>Right-click the navigator item anytime. Click a card to teleport with your friends.</p>
          </div>
          <button class="minigame-close" aria-label="Close minigame menu">×</button>
        </div>
        <div class="minigame-status"></div>
        <div class="minigame-grid"></div>
        <div class="minigame-footer">
          <span>Hotkeys: <kbd>Esc</kbd> close • <kbd>Enter</kbd> join selected • <kbd>1-7</kbd> quick select</span>
          <span class="minigame-command-hint">Commands still work: /skywars, /bedwars, /duels, /castle, /sg</span>
        </div>
      </div>
    `;

    document.body.appendChild(this.root);
    this.panel = this.root.querySelector('.minigame-panel') as HTMLDivElement;
    this.grid = this.root.querySelector('.minigame-grid') as HTMLDivElement;
    this.statusText = this.root.querySelector('.minigame-status') as HTMLDivElement;

    this.root.querySelector('.minigame-close')?.addEventListener('click', () => this.close());
    this.root.querySelector('.minigame-backdrop')?.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));

    EventBus.on('ui:openMinigameMenu', () => this.open());
    EventBus.on('ui:closeMinigameMenu', () => this.close());
    EventBus.on('network:serverInfo', (msg: any) => this.applyServerInfo(msg));
    EventBus.on('network:welcome', (msg: any) => this.applyServerInfo(msg));
    EventBus.on('network:connected', () => {
      this.state.connected = true;
      this.updateStatus();
    });
    EventBus.on('network:disconnected', () => {
      this.state.connected = false;
      this.updateStatus();
    });

    this.renderCards();
    this.updateStatus();
  }

  public open(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    this.root.classList.remove('hidden');
    this.root.classList.add('visible');
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
    AudioManager.playMenuOpen();
    this.focusSelectedCard();
  }

  public close(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.root.classList.remove('visible');
    this.root.classList.add('hidden');
    InputManager.isUIActive = false;
    AudioManager.playMenuClose();
    if (!document.getElementById('pause-menu')?.classList.contains('active')) {
      InputManager.lockPointer();
    }
  }

  private applyServerInfo(msg: any): void {
    const meta = msg?.meta || {};
    this.state = {
      ...this.state,
      activeRoom: msg?.room || meta?.roomId || this.state.activeRoom,
      activeDimension: meta?.dimension || msg?.dimension || this.state.activeDimension,
      serverName: meta?.displayName || msg?.title || this.state.serverName,
      connected: true,
    };
    this.updateStatus();
    this.updateActiveCards();
  }

  private renderCards(): void {
    this.grid.innerHTML = '';
    this.cards = [];

    MINIGAME_DEFINITIONS.forEach((mode, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'minigame-card';
      card.dataset.modeId = mode.id;
      card.style.setProperty('--mg-accent', mode.accent);
      card.innerHTML = this.cardHtml(mode, index);

      card.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelectedCard();
        AudioManager.playMenuHover();
      });
      card.addEventListener('click', () => this.joinMode(mode));

      this.grid.appendChild(card);
      this.cards.push(card);
    });

    this.updateSelectedCard();
    this.updateActiveCards();
  }

  private cardHtml(mode: MinigameDefinition, index: number): string {
    return `
      <div class="minigame-icon ${mode.icon}" aria-hidden="true"><span></span></div>
      <div class="minigame-card-body">
        <div class="minigame-card-title-row">
          <span class="minigame-card-title">${this.escapeHtml(mode.shortTitle)}</span>
          <span class="minigame-card-hotkey">${index + 1}</span>
        </div>
        <div class="minigame-card-subtitle">${this.escapeHtml(mode.subtitle)}</div>
        <div class="minigame-card-meta">
          <span>${mode.pvp ? 'PvP enabled' : 'Safe hub'}</span>
          <span>${mode.maxPlayers} slots</span>
          <span>${this.escapeHtml(mode.command)}</span>
        </div>
      </div>
    `;
  }

  private joinMode(mode: MinigameDefinition): void {
    AudioManager.playMenuSelect();
    EventBus.emit('minigame:join', {
      id: mode.id,
      command: mode.command,
      room: mode.room,
      dimension: mode.dimension,
      title: mode.title,
      spawn: mode.spawn,
    });
    EventBus.emit('network:chat', `[Navigator] Sending you to ${mode.shortTitle}...`);
    this.close();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isVisible) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const mode = MINIGAME_DEFINITIONS[this.selectedIndex];
      if (mode) this.joinMode(mode);
      return;
    }

    const numeric = Number(e.key);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= MINIGAME_DEFINITIONS.length) {
      e.preventDefault();
      this.selectedIndex = numeric - 1;
      this.updateSelectedCard();
      this.focusSelectedCard();
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.cards.length;
      this.updateSelectedCard();
      this.focusSelectedCard();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.cards.length) % this.cards.length;
      this.updateSelectedCard();
      this.focusSelectedCard();
    }
  }

  private focusSelectedCard(): void {
    window.setTimeout(() => this.cards[this.selectedIndex]?.focus({ preventScroll: true }), 0);
  }

  private updateSelectedCard(): void {
    this.cards.forEach((card, index) => card.classList.toggle('selected', index === this.selectedIndex));
  }

  private updateActiveCards(): void {
    const room = this.state.activeRoom || '';
    const dimension = this.state.activeDimension || '';
    this.cards.forEach((card) => {
      const mode = MINIGAME_DEFINITIONS.find((entry) => entry.id === card.dataset.modeId);
      const active = !!mode && (mode.room === room || mode.dimension === dimension);
      card.classList.toggle('active-mode', active);
    });
  }

  private updateStatus(): void {
    const server = this.state.serverName || 'Not connected to a room yet';
    const room = this.state.activeRoom ? `Room: ${this.state.activeRoom}` : 'Choose CrownForge from Multiplayer to sync with friends';
    const dot = this.state.connected ? 'online' : 'offline';
    this.statusText.innerHTML = `
      <span class="minigame-status-dot ${dot}"></span>
      <span>${this.escapeHtml(server)}</span>
      <span class="minigame-status-room">${this.escapeHtml(room)}</span>
    `;
  }

  private escapeHtml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private injectStyles(): void {
    if (document.getElementById('minigame-menu-styles')) return;
    const style = document.createElement('style');
    style.id = 'minigame-menu-styles';
    style.textContent = `
      .minigame-menu { position: fixed; inset: 0; z-index: 4000; display: flex; align-items: center; justify-content: center; font-family: 'Inter', 'Segoe UI', sans-serif; }
      .minigame-menu.hidden { display: none; }
      .minigame-backdrop { position: absolute; inset: 0; background: radial-gradient(circle at 50% 30%, rgba(40, 60, 95, 0.54), rgba(0, 0, 0, 0.76)); backdrop-filter: blur(8px); }
      .minigame-panel { position: relative; width: min(1040px, calc(100vw - 38px)); max-height: calc(100vh - 40px); overflow: hidden; color: #eef6ff; border: 1px solid rgba(174, 209, 255, 0.22); border-radius: 22px; background: linear-gradient(145deg, rgba(14, 18, 30, 0.94), rgba(16, 22, 39, 0.90)); box-shadow: 0 28px 90px rgba(0,0,0,0.58), inset 0 1px 0 rgba(255,255,255,0.08); transform: translateY(8px) scale(0.98); opacity: 0; animation: minigame-in 130ms ease-out forwards; }
      .minigame-panel-topline { height: 4px; background: linear-gradient(90deg, #55b8ff, #ff5a72, #ffd166, #9ee493, #d95032); }
      .minigame-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 26px 28px 16px; }
      .minigame-eyebrow { text-transform: uppercase; letter-spacing: 0.18em; color: #84d9ff; font-size: 12px; font-weight: 800; }
      .minigame-header h2 { margin: 4px 0 6px; font-size: clamp(28px, 4vw, 44px); line-height: 1; letter-spacing: -0.04em; }
      .minigame-header p { margin: 0; max-width: 630px; color: rgba(236,245,255,0.68); font-size: 15px; }
      .minigame-close { width: 42px; height: 42px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.08); color: #fff; font-size: 26px; cursor: pointer; }
      .minigame-close:hover { background: rgba(255,255,255,0.15); }
      .minigame-status { margin: 0 28px 18px; padding: 11px 13px; display: flex; align-items: center; gap: 10px; border-radius: 14px; background: rgba(255,255,255,0.065); color: rgba(238,246,255,0.82); font-size: 13px; }
      .minigame-status-dot { width: 9px; height: 9px; border-radius: 50%; background: #777; box-shadow: 0 0 12px currentColor; }
      .minigame-status-dot.online { background: #50f090; color: #50f090; }
      .minigame-status-dot.offline { background: #f0b050; color: #f0b050; }
      .minigame-status-room { margin-left: auto; color: rgba(238,246,255,0.52); }
      .minigame-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; padding: 0 28px 24px; overflow: auto; max-height: min(56vh, 560px); }
      .minigame-card { --mg-accent: #55b8ff; display: flex; gap: 14px; align-items: stretch; text-align: left; border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; padding: 14px; background: linear-gradient(135deg, color-mix(in srgb, var(--mg-accent) 18%, rgba(255,255,255,0.05)), rgba(255,255,255,0.045)); color: #eef6ff; cursor: pointer; min-height: 126px; transition: transform 120ms ease, border-color 120ms ease, background 120ms ease, box-shadow 120ms ease; }
      .minigame-card:hover, .minigame-card.selected { transform: translateY(-2px); border-color: color-mix(in srgb, var(--mg-accent) 68%, white); box-shadow: 0 12px 28px color-mix(in srgb, var(--mg-accent) 20%, transparent); }
      .minigame-card.active-mode { outline: 2px solid color-mix(in srgb, var(--mg-accent) 74%, white); }
      .minigame-card.active-mode::after { content: 'Current'; align-self: flex-start; padding: 3px 7px; border-radius: 999px; background: color-mix(in srgb, var(--mg-accent) 36%, rgba(0,0,0,0.28)); color: white; font-size: 11px; font-weight: 800; }
      .minigame-icon { width: 58px; height: 58px; border-radius: 16px; flex: 0 0 auto; position: relative; background: radial-gradient(circle at 35% 25%, rgba(255,255,255,0.42), transparent 28%), linear-gradient(145deg, var(--mg-accent), rgba(0,0,0,0.3)); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18), 0 8px 18px rgba(0,0,0,0.25); }
      .minigame-icon span, .minigame-icon::before, .minigame-icon::after { content: ''; position: absolute; display: block; }
      .minigame-icon.compass::before { inset: 13px; border: 3px solid white; border-radius: 50%; }
      .minigame-icon.compass::after { left: 27px; top: 8px; width: 4px; height: 38px; background: white; transform: rotate(38deg); border-radius: 2px; }
      .minigame-icon.island::before { left: 12px; right: 12px; bottom: 13px; height: 10px; background: #6a4a2f; transform: skewX(-18deg); }
      .minigame-icon.island::after { left: 18px; top: 16px; width: 22px; height: 17px; background: #73e681; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
      .minigame-icon.bed::before { left: 10px; right: 10px; top: 27px; height: 15px; background: #fff; border-radius: 3px; }
      .minigame-icon.bed::after { left: 10px; top: 20px; width: 17px; height: 14px; background: #ff405c; border-radius: 3px; }
      .minigame-icon.sword::before { left: 28px; top: 8px; width: 4px; height: 38px; background: white; transform: rotate(42deg); border-radius: 2px; }
      .minigame-icon.sword::after { left: 19px; top: 34px; width: 24px; height: 5px; background: #ffd166; transform: rotate(42deg); border-radius: 2px; }
      .minigame-icon.castle::before { left: 12px; right: 12px; bottom: 12px; height: 27px; background: white; clip-path: polygon(0 25%, 15% 25%, 15% 0, 30% 0, 30% 25%, 70% 25%, 70% 0, 85% 0, 85% 25%, 100% 25%, 100% 100%, 0 100%); }
      .minigame-icon.castle::after { left: 25px; bottom: 12px; width: 9px; height: 14px; background: rgba(0,0,0,0.35); border-radius: 8px 8px 0 0; }
      .minigame-icon.chest::before { left: 11px; right: 11px; top: 21px; height: 23px; background: #8b5a32; border: 2px solid white; border-radius: 3px; }
      .minigame-icon.chest::after { left: 26px; top: 27px; width: 8px; height: 9px; background: #ffd166; border-radius: 2px; }
      .minigame-icon.flame::before { left: 18px; top: 8px; width: 22px; height: 37px; background: white; border-radius: 70% 30% 60% 40%; transform: rotate(25deg); }
      .minigame-card-body { min-width: 0; flex: 1; }
      .minigame-card-title-row { display: flex; align-items: center; gap: 10px; }
      .minigame-card-title { font-size: 19px; font-weight: 900; letter-spacing: -0.02em; }
      .minigame-card-hotkey { margin-left: auto; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.72); font-weight: 800; font-size: 12px; }
      .minigame-card-subtitle { margin-top: 6px; color: rgba(238,246,255,0.68); font-size: 13px; line-height: 1.32; }
      .minigame-card-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
      .minigame-card-meta span { padding: 4px 7px; border-radius: 999px; background: rgba(0,0,0,0.24); color: rgba(238,246,255,0.72); font-size: 11px; font-weight: 700; }
      .minigame-footer { display: flex; justify-content: space-between; gap: 16px; padding: 14px 28px 20px; color: rgba(238,246,255,0.52); font-size: 12px; border-top: 1px solid rgba(255,255,255,0.08); }
      .minigame-footer kbd { padding: 2px 6px; border-radius: 5px; background: rgba(255,255,255,0.12); color: #fff; font-family: inherit; }
      @keyframes minigame-in { to { opacity: 1; transform: translateY(0) scale(1); } }
      @media (max-width: 760px) { .minigame-grid { grid-template-columns: 1fr; } .minigame-footer { flex-direction: column; } .minigame-status { align-items: flex-start; flex-wrap: wrap; } .minigame-status-room { margin-left: 0; width: 100%; } }
    `;
    document.head.appendChild(style);
  }
}
