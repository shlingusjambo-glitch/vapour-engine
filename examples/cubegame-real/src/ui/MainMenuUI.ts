import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';

interface COBLobbyStatus {
  state: string;
  countdownMs: number;
  activePlayers: number;
  humanPlayers: number;
  mapId: string;
  mapName?: string;
}

export class MainMenuUI {
  private readonly root: HTMLDivElement;
  private readonly countdownText: HTMLDivElement;
  private readonly playerText: HTMLDivElement;
  private readonly stateText: HTMLDivElement;
  private readonly mapText: HTMLDivElement;
  private readonly leaveButton: HTMLButtonElement;
  private cobButton: HTMLButtonElement | null = null;

  public constructor() {
    this.injectModdedModeButton();
    this.injectLobbyOverlay();

    this.root = document.getElementById('cob-lobby-root') as HTMLDivElement;
    this.countdownText = this.root.querySelector('[data-cob-countdown]') as HTMLDivElement;
    this.playerText = this.root.querySelector('[data-cob-players]') as HTMLDivElement;
    this.stateText = this.root.querySelector('[data-cob-state]') as HTMLDivElement;
    this.mapText = this.root.querySelector('[data-cob-map]') as HTMLDivElement;
    this.leaveButton = this.root.querySelector('[data-cob-leave]') as HTMLButtonElement;

    this.cobButton?.addEventListener('click', () => this.openCallOfBlock());
    this.leaveButton.addEventListener('click', () => {
      this.leaveButton.disabled = true;
      this.stateText.textContent = 'Leaving Call of Block...';
      EventBus.emit('game:leaveCOB');
    });

    EventBus.on('cob:lobbyStatus', (status: COBLobbyStatus) => this.applyLobbyStatus(status));
    EventBus.on('cob:matchStarted', () => this.hideLobbyOverlay());
    EventBus.on('cob:closed', () => this.returnToMainMenu());
    EventBus.on('cob:error', (message: string) => this.showError(message));
  }

  private openCallOfBlock(): void {
    const mainMenu = document.getElementById('main-menu-screen') as HTMLElement | null;
    const moddedMenu = document.getElementById('modded-modes-screen') as HTMLElement | null;
    const usernameInput = document.getElementById('cfg-username') as HTMLInputElement | null;
    const username = usernameInput?.value.trim() || 'Steve';

    if (mainMenu) mainMenu.style.display = 'none';
    if (moddedMenu) moddedMenu.style.display = 'none';
    this.showLobbyOverlay();
    this.stateText.textContent = 'Opening COB lobby...';
    this.mapText.textContent = 'Lobby instance';
    this.countdownText.textContent = '60';
    this.playerText.textContent = 'Players 0 / 64';
    EventBus.emit('game:joinCOB', { username });
  }

  private applyLobbyStatus(status: COBLobbyStatus): void {
    if (status.state === 'Match_Active') {
      this.hideLobbyOverlay();
      return;
    }
    if (!this.root.classList.contains('visible')) this.showLobbyOverlay();
    const seconds = Math.max(0, Math.ceil(status.countdownMs / 1000));
    this.countdownText.textContent = String(seconds).padStart(2, '0');
    this.playerText.textContent = `Players ${Math.max(0, status.activePlayers)} / 64`;
    this.stateText.textContent = this.formatState(status.state);
    this.mapText.textContent = status.mapName || status.mapId || 'Lobby instance';
    this.leaveButton.disabled = false;
  }

  private showLobbyOverlay(): void {
    this.root.classList.add('visible');
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
  }

  private hideLobbyOverlay(): void {
    this.root.classList.remove('visible');
    const pauseScreen = document.getElementById('pause-screen') as HTMLElement | null;
    if (pauseScreen) pauseScreen.style.display = 'none';
    InputManager.isUIActive = false;
    InputManager.lockPointer();
  }

  private returnToMainMenu(): void {
    this.root.classList.remove('visible');
    this.leaveButton.disabled = false;
    const mainMenu = document.getElementById('main-menu-screen') as HTMLElement | null;
    const moddedMenu = document.getElementById('modded-modes-screen') as HTMLElement | null;
    const pauseScreen = document.getElementById('pause-screen') as HTMLElement | null;
    if (moddedMenu) moddedMenu.style.display = 'none';
    if (pauseScreen) pauseScreen.style.display = 'none';
    if (mainMenu) mainMenu.style.display = 'flex';
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
  }

  private showError(message: string): void {
    this.showLobbyOverlay();
    this.leaveButton.disabled = false;
    this.stateText.textContent = message || 'Call of Block failed to start.';
  }

  private formatState(state: string): string {
    if (state === 'Lobby_Wait') return 'Lobby countdown';
    if (state === 'Match_Loading') return 'Loading combat map';
    if (state === 'Match_Active') return 'Match active';
    if (state === 'Match_SuddenDeath') return 'Sudden death';
    if (state === 'Match_PostGame') return 'Post game';
    return state || 'Preparing';
  }

  private injectModdedModeButton(): void {
    if (document.getElementById('modded-cob-play-btn')) {
      this.cobButton = document.getElementById('modded-cob-play-btn') as HTMLButtonElement;
      return;
    }

    const panel = document.querySelector('#modded-modes-screen .menu-panel') as HTMLElement | null;
    if (!panel) return;

    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex',
      'align-items:flex-start',
      'justify-content:space-between',
      'gap:18px',
      'flex-wrap:wrap',
      'padding-top:12px',
      'border-top:1px solid rgba(255,255,255,0.12)'
    ].join(';');

    const copy = document.createElement('div');
    copy.innerHTML = [
      '<div class="panel-title" style="margin-bottom: 6px;">Call of Block</div>',
      '<div style="color: var(--menu-soft-text); line-height: 1.35;">64-player combined-arms block warfare with server-authoritative countdowns, AI backfill, vehicles, ADS viewmodels, and spatial MP3 combat audio.</div>',
    ].join('');

    this.cobButton = document.createElement('button');
    this.cobButton.id = 'modded-cob-play-btn';
    this.cobButton.type = 'button';
    this.cobButton.className = 'mc-btn';
    this.cobButton.style.minWidth = '190px';
    this.cobButton.textContent = 'Start COB';

    const modes = document.createElement('div');
    modes.className = 'server-modes';
    modes.innerHTML = [
      '<span>32v32</span>',
      '<span>Vehicles</span>',
      '<span>AI Backfill</span>',
      '<span>100 Kills</span>',
    ].join('');

    row.appendChild(copy);
    row.appendChild(this.cobButton);
    panel.appendChild(row);
    panel.appendChild(modes);
  }

  private injectLobbyOverlay(): void {
    if (document.getElementById('cob-lobby-root')) return;

    const style = document.createElement('style');
    style.id = 'cob-lobby-styles';
    style.textContent = [
      '#cob-lobby-root{position:fixed;inset:0;z-index:9100;display:none;align-items:center;justify-content:center;background:rgba(4,8,13,.58);color:#eef6ff;font-family:Inter,Segoe UI,Arial,sans-serif;}',
      '#cob-lobby-root.visible{display:flex;}',
      '.cob-lobby-panel{width:min(520px,calc(100vw - 32px));border:1px solid rgba(180,220,255,.26);background:rgba(12,17,24,.92);box-shadow:0 28px 90px rgba(0,0,0,.48);padding:22px;}',
      '.cob-lobby-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:1px solid rgba(255,255,255,.12);padding-bottom:14px;}',
      '.cob-lobby-title{font-size:28px;font-weight:900;line-height:1;}',
      '.cob-lobby-state{margin-top:6px;color:rgba(238,246,255,.72);font-size:14px;}',
      '.cob-lobby-countdown{font-variant-numeric:tabular-nums;font-size:54px;font-weight:950;line-height:.9;color:#9ee493;text-align:right;}',
      '.cob-lobby-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px;}',
      '.cob-lobby-stat{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.045);padding:12px;}',
      '.cob-lobby-label{display:block;font-size:11px;text-transform:uppercase;color:rgba(238,246,255,.58);font-weight:800;}',
      '.cob-lobby-value{display:block;margin-top:5px;font-size:15px;font-weight:800;}',
      '.cob-lobby-actions{display:flex;justify-content:flex-end;margin-top:18px;}',
      '.cob-lobby-actions button{min-width:132px;}',
      '@media (max-width:620px){.cob-lobby-top,.cob-lobby-grid{grid-template-columns:1fr;display:grid}.cob-lobby-countdown{text-align:left;font-size:44px}}',
    ].join('');
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'cob-lobby-root';
    root.innerHTML = [
      '<div class="cob-lobby-panel" role="dialog" aria-modal="true" aria-label="Call of Block lobby">',
      '<div class="cob-lobby-top">',
      '<div>',
      '<div class="cob-lobby-title">Call of Block</div>',
      '<div class="cob-lobby-state" data-cob-state>Preparing lobby</div>',
      '</div>',
      '<div class="cob-lobby-countdown" data-cob-countdown>60</div>',
      '</div>',
      '<div class="cob-lobby-grid">',
      '<div class="cob-lobby-stat"><span class="cob-lobby-label">Population</span><span class="cob-lobby-value" data-cob-players>Players 0 / 64</span></div>',
      '<div class="cob-lobby-stat"><span class="cob-lobby-label">Map</span><span class="cob-lobby-value" data-cob-map>Lobby instance</span></div>',
      '</div>',
      '<div class="cob-lobby-actions"><button class="mc-btn" type="button" data-cob-leave>Leave Game</button></div>',
      '</div>',
    ].join('');
    document.body.appendChild(root);
  }
}
