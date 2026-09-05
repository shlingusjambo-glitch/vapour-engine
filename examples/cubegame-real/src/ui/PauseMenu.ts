import { EventBus } from '../core/EventBus';
import { InputManager, type InputAction } from '../core/InputManager';
import { StorageManager, WorldMeta } from '../storage/StorageManager';
import { SHADER_PACKS } from '../graphics/ShaderPacks';
import { createDefaultAlexSkinDataUrl, createDefaultSteveSkinDataUrl } from '../player/DefaultSteveSkin';

export class PauseMenu {
  private readonly inputActions: InputAction[] = [
    'moveForward',
    'moveBackward',
    'moveLeft',
    'moveRight',
    'jump',
    'sprint',
    'crouch',
    'inventory',
    'drop',
    'chat',
    'pause',
    'attack',
    'place',
    'pickBlock',
  ];
  // Screens
  private mainMenuScreen: HTMLElement;
  private moddedModesScreen: HTMLElement;
  private authScreen: HTMLElement;
  private connectionModeScreen: HTMLElement;
  private multiplayerScreen: HTMLElement;
  private pauseScreen: HTMLElement;
  private optionsScreen: HTMLElement;
  private worldSelectScreen: HTMLElement;
  private createWorldModal: HTMLElement;
  private serverLinkModal: HTMLElement | null = null;
  private serverLinkInput: HTMLInputElement | null = null;
  private pendingServerLinkCallback: ((result: { connected: boolean; address: string }) => void) | null = null;

  // Main Menu Buttons
  private mainSingleplayerBtn: HTMLButtonElement;
  private mainMultiplayerBtn: HTMLButtonElement;
  private mainModdedModesBtn: HTMLButtonElement;
  private moddedCsgoPlayBtn: HTMLButtonElement;
  private moddedTf2PlayBtn: HTMLButtonElement;
  private moddedModesBackBtn: HTMLButtonElement;
  private mainOptionsBtn: HTMLButtonElement;
  private mainQuitBtn: HTMLButtonElement;
  private skinImportBtn: HTMLButtonElement;
  private skinImportInput: HTMLInputElement;
  private skinImportStatus: HTMLElement;
  private skinDefaultSteveBtn: HTMLButtonElement;
  private skinDefaultAlexBtn: HTMLButtonElement;
  private startupOfflineLanBtn: HTMLButtonElement;
  private startupGlobalBtn: HTMLButtonElement;
  private authSignInTab: HTMLButtonElement;
  private authSignUpTab: HTMLButtonElement;
  private authUsernameInput: HTMLInputElement;
  private authPasswordInput: HTMLInputElement;
  private authStatus: HTMLElement;
  private authSubmitBtn: HTMLButtonElement;

  // Pause Screen Buttons
  private resumeBtn: HTMLButtonElement;
  private pauseDisconnectBtn: HTMLButtonElement;
  private pauseOptionsBtn: HTMLButtonElement;

  // Options Screen Buttons
  private resetBtn: HTMLButtonElement;
  private worldCreateBtn: HTMLButtonElement;
  private randomSeedBtn: HTMLButtonElement;

  // World Selection Controls
  private worldListDiv: HTMLElement;
  private btnCreateWorldMenu: HTMLButtonElement;
  private btnCancelWorldSelect: HTMLButtonElement;

  // Create World Modal Controls
  private newWorldNameInput: HTMLInputElement;
  private newWorldSeedInput: HTMLInputElement;
  private newWorldRandSeedBtn: HTMLButtonElement;
  private newWorldPresetSelect: HTMLSelectElement;
  private btnConfirmCreateWorld: HTMLButtonElement;
  private btnCancelCreateWorld: HTMLButtonElement;

  // Multiplayer Screen Controls
  private cfgUsername: HTMLInputElement;
  private cfgRoomName: HTMLInputElement;
  private cfgRoomCode: HTMLInputElement;
  private btnCreateRoom: HTMLButtonElement;
  private btnRefreshServers: HTMLButtonElement;
  private btnJoinServer: HTMLButtonElement;
  private btnCancelMultiplayer: HTMLButtonElement;
  private serverListDiv: HTMLElement;

  // Configuration elements
  private sliderFov: HTMLInputElement;
  private sliderRenderDist: HTMLInputElement;
  private selectShaderPack: HTMLSelectElement;
  private selectShadows: HTMLSelectElement;
  private inputServerIp: HTMLInputElement;
  private inputSeed: HTMLInputElement;
  private selectPreset: HTMLSelectElement;
  private selectDifficulty: HTMLSelectElement;
  private sliderBiomeScale: HTMLInputElement;
  private sliderTerrainScale: HTMLInputElement;
  private sliderCaveDensity: HTMLInputElement;
  private sliderStructureRate: HTMLInputElement;

  private selectedRoomId: string | null = null;
  private isMultiplayerMode = false;
  private lastActiveScreen: HTMLElement | null = null;
  private authMode: 'signin' | 'signup' = 'signin';
  private desktopSharePromptResolved = false;
  private pendingMultiplayerJoin = false;
  private joinStatusRestoreText = '';

  private splashTexts = [
    "Procedural voxel logic!",
    "Nearest filtering active!",
    "Real-time shadow mapping!",
    "Multiplayer worlds!",
    "CubeGame action!",
    "Hand-built block chaos!",
    "Infinite survival!",
    "Bring extra torches!",
    "Nice textures!",
    "Retro voxel aesthetics!"
  ];

  constructor() {
    // Screens
    this.mainMenuScreen = document.getElementById('main-menu-screen')!;
    this.moddedModesScreen = document.getElementById('modded-modes-screen')!;
    this.authScreen = document.getElementById('auth-screen')!;
    this.connectionModeScreen = document.getElementById('connection-mode-screen')!;
    this.multiplayerScreen = document.getElementById('multiplayer-screen')!;
    this.pauseScreen = document.getElementById('pause-screen')!;
    this.optionsScreen = document.getElementById('options-screen')!;
    this.worldSelectScreen = document.getElementById('world-select-screen')!;
    this.createWorldModal = document.getElementById('create-world-modal')!;

    // Main Menu Buttons
    this.mainSingleplayerBtn = document.getElementById('main-singleplayer-btn') as HTMLButtonElement;
    this.mainMultiplayerBtn = document.getElementById('main-multiplayer-btn') as HTMLButtonElement;
    this.mainModdedModesBtn = document.getElementById('main-modded-modes-btn') as HTMLButtonElement;
    this.moddedCsgoPlayBtn = document.getElementById('modded-csgo-play-btn') as HTMLButtonElement;
    this.moddedTf2PlayBtn = document.getElementById('modded-tf2-play-btn') as HTMLButtonElement;
    this.moddedModesBackBtn = document.getElementById('modded-modes-back-btn') as HTMLButtonElement;
    this.mainOptionsBtn = document.getElementById('main-options-btn') as HTMLButtonElement;
    this.mainQuitBtn = document.getElementById('main-quit-btn') as HTMLButtonElement;
    this.skinImportBtn = document.getElementById('skin-import-btn') as HTMLButtonElement;
    this.skinImportInput = document.getElementById('skin-import-input') as HTMLInputElement;
    this.skinImportStatus = document.getElementById('skin-import-status')!;
    this.skinDefaultSteveBtn = document.getElementById('skin-default-steve-btn') as HTMLButtonElement;
    this.skinDefaultAlexBtn = document.getElementById('skin-default-alex-btn') as HTMLButtonElement;
    this.startupOfflineLanBtn = document.getElementById('startup-offline-lan-btn') as HTMLButtonElement;
    this.startupGlobalBtn = document.getElementById('startup-global-btn') as HTMLButtonElement;
    this.authSignInTab = document.getElementById('auth-signin-tab') as HTMLButtonElement;
    this.authSignUpTab = document.getElementById('auth-signup-tab') as HTMLButtonElement;
    this.authUsernameInput = document.getElementById('auth-username') as HTMLInputElement;
    this.authPasswordInput = document.getElementById('auth-password') as HTMLInputElement;
    this.authStatus = document.getElementById('auth-status')!;
    this.authSubmitBtn = document.getElementById('auth-submit-btn') as HTMLButtonElement;

    // Pause Screen Buttons
    this.resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement;
    this.pauseDisconnectBtn = document.getElementById('pause-disconnect-btn') as HTMLButtonElement;
    this.pauseOptionsBtn = document.getElementById('pause-options-btn') as HTMLButtonElement;

    // Options Screen Buttons
    this.resetBtn = document.getElementById('reset-world-btn') as HTMLButtonElement;
    this.worldCreateBtn = document.getElementById('world-create-btn') as HTMLButtonElement;
    this.randomSeedBtn = document.getElementById('random-seed-btn') as HTMLButtonElement;

    // World Select Controls
    this.worldListDiv = document.getElementById('world-list')!;
    this.btnCreateWorldMenu = document.getElementById('btn-create-world-menu') as HTMLButtonElement;
    this.btnCancelWorldSelect = document.getElementById('btn-cancel-world-select') as HTMLButtonElement;

    // Create World Modal Controls
    this.newWorldNameInput = document.getElementById('new-world-name') as HTMLInputElement;
    this.newWorldSeedInput = document.getElementById('new-world-seed') as HTMLInputElement;
    this.newWorldRandSeedBtn = document.getElementById('new-world-rand-seed-btn') as HTMLButtonElement;
    this.newWorldPresetSelect = document.getElementById('new-world-preset') as HTMLSelectElement;
    this.btnConfirmCreateWorld = document.getElementById('btn-confirm-create-world') as HTMLButtonElement;
    this.btnCancelCreateWorld = document.getElementById('btn-cancel-create-world') as HTMLButtonElement;

    // Multiplayer Controls
    this.cfgUsername = document.getElementById('cfg-username') as HTMLInputElement;
    this.cfgRoomName = document.getElementById('cfg-room-name') as HTMLInputElement;
    this.cfgRoomCode = document.getElementById('cfg-room-code') as HTMLInputElement;
    this.btnCreateRoom = document.getElementById('btn-create-room') as HTMLButtonElement;
    this.btnRefreshServers = document.getElementById('btn-refresh-servers') as HTMLButtonElement;
    this.btnJoinServer = document.getElementById('btn-join-server') as HTMLButtonElement;
    this.btnCancelMultiplayer = document.getElementById('btn-cancel-multiplayer') as HTMLButtonElement;
    this.serverListDiv = document.getElementById('server-list')!;

    // Config inputs
    this.sliderFov = document.getElementById('cfg-fov') as HTMLInputElement;
    this.sliderRenderDist = document.getElementById('cfg-render-dist') as HTMLInputElement;
    this.selectShaderPack = document.getElementById('cfg-shader-pack') as HTMLSelectElement;
    this.selectShadows = document.getElementById('cfg-shadows') as HTMLSelectElement;
    this.refreshShaderPackOptions();
    EventBus.on('shaders:packRegistered', () => this.refreshShaderPackOptions());
    this.inputServerIp = document.getElementById('cfg-server-ip') as HTMLInputElement;
    this.inputSeed = document.getElementById('cfg-world-seed') as HTMLInputElement;
    this.selectPreset = document.getElementById('cfg-world-preset') as HTMLSelectElement;
    this.selectDifficulty = document.getElementById('cfg-difficulty') as HTMLSelectElement;
    this.sliderBiomeScale = document.getElementById('cfg-biome-scale') as HTMLInputElement;
    this.sliderTerrainScale = document.getElementById('cfg-terrain-scale') as HTMLInputElement;
    this.sliderCaveDensity = document.getElementById('cfg-cave-density') as HTMLInputElement;
    this.sliderStructureRate = document.getElementById('cfg-structure-rate') as HTMLInputElement;

    // Initially hide Gameplay UI
    this.hideGameplayUI();
    InputManager.isUIActive = true;

    // Select random splash text
    this.randomizeSplash();

    this.bindDOMEvents();
    this.bindInputSettings();
    this.refreshSkinImportStatus();
    this.initializeAuthGate();

    // Bind system toggle event
    EventBus.on('toggle:pause', () => this.toggle());
    EventBus.on('ui:openSettings', () => {
      const cbgoRoot = document.getElementById('cbgo-root');
      const tf2Root = document.getElementById('tf2-root');
      if (cbgoRoot && cbgoRoot.classList.contains('visible')) {
        cbgoRoot.classList.remove('visible');
        this.lastActiveScreen = 'cbgo' as any;
      } else if (tf2Root && tf2Root.classList.contains('visible')) {
        tf2Root.classList.remove('visible');
        this.lastActiveScreen = 'tf2' as any;
      } else {
        this.lastActiveScreen = this.pauseScreen;
      }
      this.optionsScreen.style.display = 'flex';
      InputManager.isUIActive = true;
    });
    EventBus.on('cbgo:closedMenu', () => {
      this.hideGameplayUI();
      this.moddedModesScreen.style.display = 'none';
      this.multiplayerScreen.style.display = 'none';
      this.mainMenuScreen.style.display = 'flex';
      InputManager.isUIActive = true;
      InputManager.unlockPointer();
    });

    // Only explicit user disconnects return to the main menu. A dropped join/socket
    // must not boot the player out while the multiplayer screen is retrying.
    EventBus.on('network:disconnected', (detail?: any) => {
      if (detail?.explicit === false || detail?.reconnectable) return;
      this.disconnectToMainMenu();
    });
    EventBus.on('network:connectionLost', () => {
      // During an already-loaded session, do not kick back to the title. The
      // NetworkManager may reconnect, but the user must not be left at a fake
      // rotating sky/background with no world load.
      if (this.pendingMultiplayerJoin) {
        this.cancelPendingJoin('Connection dropped before the server finished the CubeGame handshake. Check the loca.lt link and make sure npm run server is still running.');
      }
    });
    EventBus.on('network:error', (detail?: any) => {
      const message = String(detail?.message || 'Could not connect to that CubeGame server.');
      if (this.pendingMultiplayerJoin) this.cancelPendingJoin(message);
    });
    EventBus.on('network:status', (detail?: any) => {
      if (!this.pendingMultiplayerJoin || !detail?.message) return;
      this.setJoinButtonBusy(String(detail.message));
    });
    EventBus.on('network:worldLoaded', (detail?: any) => {
      if (!this.pendingMultiplayerJoin) return;
      this.completePendingJoin();
    });
  }

  private randomizeSplash() {
    const splash = document.getElementById('splash-text');
    if (splash) {
      const idx = Math.floor(Math.random() * this.splashTexts.length);
      splash.innerText = this.splashTexts[idx];
    }
  }

  private randomSeedString(): string {
    const cryptoObj = window.crypto;
    if (cryptoObj?.getRandomValues) {
      const parts = new Uint32Array(2);
      cryptoObj.getRandomValues(parts);
      return `${Date.now().toString(36)}-${parts[0].toString(36)}${parts[1].toString(36)}`;
    }
    return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000_000).toString(36)}`;
  }

  private getDesktopCachedShareAddress(): string {
    const fromWindow = String((window as any).cubeGameServerUrl || '').trim();
    if (this.isRemoteShareAddress(fromWindow)) return this.normalizeServerAddressInput(fromWindow);
    try {
      const fromLocalStorage = window.localStorage?.getItem('cubegame_desktop_server_link') || '';
      if (this.isRemoteShareAddress(fromLocalStorage)) return this.normalizeServerAddressInput(fromLocalStorage);
    } catch {
      // Local storage can be unavailable in some embedded WebView privacy modes.
    }
    return '';
  }

  private desktopServerPromptHandledThisLaunch(): boolean {
    try {
      return window.sessionStorage?.getItem('cubegame_desktop_server_link_ready') === '1';
    } catch {
      return false;
    }
  }

  private markDesktopServerPromptHandled(): void {
    this.desktopSharePromptResolved = true;
    try {
      window.sessionStorage?.setItem('cubegame_desktop_server_link_ready', '1');
    } catch {
      // Ignore embedded WebView storage failures.
    }
  }

  private async initializeAuthGate(): Promise<void> {
    let savedServerIp = await StorageManager.getGlobalData<string>('setting_serverIp', '');
    const cachedDesktopShare = this.getDesktopCachedShareAddress();
    if (!this.isRemoteShareAddress(savedServerIp) && cachedDesktopShare) {
      savedServerIp = cachedDesktopShare;
      await this.applyServerAddress(cachedDesktopShare);
      await StorageManager.setGlobalData('setting_connectionMode', 'global');
    }
    if (savedServerIp) this.inputServerIp.value = savedServerIp;

    if (this.shouldAskForShareLinkBeforeAuth(savedServerIp)) {
      this.authScreen.style.display = 'none';
      this.connectionModeScreen.style.display = 'none';
      this.mainMenuScreen.style.display = 'none';
      InputManager.isUIActive = true;
      this.showServerLinkModal(async (result) => {
        this.desktopSharePromptResolved = true;
        if (result.connected && result.address && this.isRemoteShareAddress(result.address)) {
          await StorageManager.setGlobalData('setting_connectionMode', 'global');
        } else {
          const localAddress = this.getDefaultServerWsAddress();
          this.inputServerIp.value = localAddress;
          (window as any).cubeGameServerUrl = localAddress;
          await StorageManager.setGlobalData('setting_connectionMode', 'offline_lan');
          await StorageManager.setGlobalData('setting_serverIp', localAddress);
        }
        await this.initializeAuthGate();
      }, true);
      return;
    }

    const savedUsername = await StorageManager.getGlobalData<string>('auth_username', '');
    if (savedUsername) {
      this.authScreen.style.display = 'none';
      this.connectionModeScreen.style.display = 'flex';
      this.cfgUsername.value = savedUsername;
      return;
    }

    this.authScreen.style.display = 'flex';
    this.connectionModeScreen.style.display = 'none';
    this.authUsernameInput.value = await StorageManager.getGlobalData<string>('setting_username', '');
    setTimeout(() => (this.authUsernameInput.value ? this.authPasswordInput : this.authUsernameInput).focus(), 80);
  }

  private shouldAskForShareLinkBeforeAuth(savedServerIp: string): boolean {
    if (!this.isDesktopShell()) return false;
    if (this.desktopSharePromptResolved || this.desktopServerPromptHandledThisLaunch()) return false;
    const cachedDesktopShare = this.getDesktopCachedShareAddress();
    return !this.isRemoteShareAddress(savedServerIp) && !this.isRemoteShareAddress(cachedDesktopShare);
  }

  private isDesktopShell(): boolean {
    const nativeBridge = Boolean((window as any).CubeGameNative || (window as any).electronAPI);
    const nativeQuery = new URLSearchParams(window.location.search).get('native') === '1';
    return nativeBridge || nativeQuery || window.location.protocol === 'file:';
  }

  private isRemoteShareAddress(address: string): boolean {
    let clean = String(address || '').trim();
    if (!clean) return false;
    if (/serverip|server-port|serverport|your-server|your-game/i.test(clean)) return false;
    if (/^wss?:[^/]/i.test(clean)) {
      clean = clean.replace(/^wss?:/i, (scheme) => `${scheme}//`);
    }
    if (!/^https?:\/\//i.test(clean) && !/^wss?:\/\//i.test(clean)) return false;
    try {
      const url = new URL(clean);
      const host = url.hostname.toLowerCase();
      if (!host) return false;
      return !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
    } catch {
      return false;
    }
  }

  private showServerLinkModal(
    callback: (result: { connected: boolean; address: string }) => void | Promise<void>,
    forceEmpty = false
  ): void {
    this.pendingServerLinkCallback = (result) => { void callback(result); };
    // This modal is a startup gate in desktop builds. Hide every other menu
    // first so the account form can never appear before the loca.lt prompt.
    this.authScreen.style.display = 'none';
    this.connectionModeScreen.style.display = 'none';
    this.mainMenuScreen.style.display = 'none';
    if (this.serverLinkModal) {
      const current = this.inputServerIp.value.trim() || this.getDesktopCachedShareAddress();
      if (this.serverLinkInput) {
        this.serverLinkInput.value = !forceEmpty && this.isRemoteShareAddress(current) ? current : '';
      }
      this.setServerLinkStatus('Paste your current https://____.loca.lt link before logging in.');
      this.serverLinkModal.style.display = 'flex';
      InputManager.isUIActive = true;
      setTimeout(() => this.serverLinkInput?.focus(), 80);
    } else {
      void callback({ connected: false, address: this.inputServerIp.value.trim() });
    }
  }

  private setServerLinkStatus(message: string): void {
    const status = document.getElementById('server-link-status');
    if (status) status.textContent = message;
  }

  private async dismissServerLinkModal(rawUrl: string, connected: boolean): Promise<void> {
    const address = rawUrl.trim() ? this.normalizeServerAddressInput(rawUrl) : '';
    if (connected && !this.isRemoteShareAddress(address)) {
      this.setServerLinkStatus('That is not a valid public server link. Paste the full current link, for example https://quiet-cubes.loca.lt.');
      this.serverLinkInput?.focus();
      return;
    }
    if (address) {
      await this.applyServerAddress(address);
      await StorageManager.setGlobalData('setting_connectionMode', 'global');
    }
    this.markDesktopServerPromptHandled();
    if (this.serverLinkModal) this.serverLinkModal.style.display = 'none';
    if (this.pendingServerLinkCallback) {
      const cb = this.pendingServerLinkCallback;
      this.pendingServerLinkCallback = null;
      cb({ connected, address });
    }
  }

  private async applyServerAddress(address: string): Promise<void> {
    const normalized = this.normalizeServerAddressInput(address);
    this.inputServerIp.value = normalized;
    if (this.serverLinkInput) this.serverLinkInput.value = normalized;
    (window as any).cubeGameServerUrl = normalized;
    try {
      if (this.isRemoteShareAddress(normalized)) {
        window.localStorage?.setItem('cubegame_desktop_server_link', normalized);
      }
    } catch {
      // Ignore embedded WebView storage failures.
    }
    await StorageManager.setGlobalData('setting_serverIp', normalized);
  }

  private setAuthMode(mode: 'signin' | 'signup'): void {
    this.authMode = mode;
    this.authSignInTab.classList.toggle('active', mode === 'signin');
    this.authSignUpTab.classList.toggle('active', mode === 'signup');
    this.authSubmitBtn.textContent = mode === 'signin' ? 'Sign In' : 'Sign Up';
    this.authPasswordInput.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    this.authStatus.textContent = mode === 'signin'
      ? 'Sign in with your CubeGame username.'
      : 'Create a CubeGame username and password.';
  }

  private async handleAuthSubmit(): Promise<void> {
    const username = this.normalizeAuthUsername(this.authUsernameInput.value);
    const password = this.authPasswordInput.value;
    if (!username) {
      this.authStatus.textContent = 'Username must be 3-24 letters, numbers, _ or -.';
      return;
    }
    if (password.length < 4) {
      this.authStatus.textContent = 'Password must be at least 4 characters.';
      return;
    }

    const desktopAddress = this.inputServerIp.value.trim() || this.getDesktopCachedShareAddress();
    if (this.isDesktopShell() && !this.desktopServerPromptHandledThisLaunch() && !this.isRemoteShareAddress(desktopAddress)) {
      this.authStatus.textContent = 'Enter the current loca.lt server link first.';
      this.showServerLinkModal(async () => {
        await this.initializeAuthGate();
      }, true);
      return;
    }

    this.authSubmitBtn.disabled = true;
    this.authStatus.textContent = this.authMode === 'signin' ? 'Signing in...' : 'Creating account...';

    try {
      const serverResult = await this.tryServerAuth(username, password, this.authMode);
      if (serverResult.ok) {
        await this.finishAuth(username, serverResult.token || '', serverResult.accountId || '', serverResult.role || 'Player');
        return;
      }

      if (serverResult.reachable) {
        this.authStatus.textContent = serverResult.error || 'Authentication failed.';
        return;
      }

      const localResult = await this.tryLocalAuth(username, password, this.authMode);
      if (!localResult.ok) {
        this.authStatus.textContent = localResult.error || 'Authentication failed.';
        return;
      }

      await this.finishAuth(username, '', 'local', 'Player');
    } finally {
      this.authSubmitBtn.disabled = false;
    }
  }

  private normalizeAuthUsername(value: string): string {
    const clean = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
    return clean.length >= 3 ? clean : '';
  }

  private async tryServerAuth(username: string, password: string, mode: 'signin' | 'signup'): Promise<{
    ok: boolean;
    reachable: boolean;
    error?: string;
    token?: string;
    accountId?: string;
    role?: string;
  }> {
    const endpoint = mode === 'signin' ? 'login' : 'register';
    const urls = await this.getServerHttpCandidates();

    for (const base of urls) {
      try {
        const res = await fetch(`${base}/api/auth/${endpoint}`, {
          method: 'POST',
          headers: this.serverApiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ username, password }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { ok: false, reachable: true, error: String(body?.error || 'Authentication failed.') };
        }
        if (body?.ok !== true || !body?.token) {
          return { ok: false, reachable: true, error: 'The server link did not return CubeGame auth JSON. Check the current loca.lt link and LocalTunnel browser/IP reminder.' };
        }
        const wsAddress = this.normalizeServerAddressInput(base);
        await this.applyServerAddress(wsAddress);
        return {
          ok: true,
          reachable: true,
          token: String(body?.token || ''),
          accountId: String(body?.accountId || ''),
          role: String(body?.role || 'Player'),
        };
      } catch {
        // Try the next reachable candidate before falling back to local auth.
      }
    }

    return { ok: false, reachable: false, error: 'Auth server unavailable.' };
  }

  private serverApiHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Bypass-Tunnel-Reminder': '1',
      'X-CubeGame-Client': this.isDesktopShell() ? 'desktop' : 'browser',
      ...extra,
    };
  }

  private async getServerHttpCandidates(): Promise<string[]> {
    const savedServerIp = await StorageManager.getGlobalData<string>('setting_serverIp', '');
    const candidates = [
      this.inputServerIp?.value?.trim(),
      savedServerIp,
      (window as any).cubeGameServerUrl,
      this.getDefaultServerWsAddress(),
      window.location.hostname === 'localhost' || window.location.protocol === 'file:' ? 'ws://localhost:8080' : '',
    ]
      .filter(Boolean)
      .map(value => this.getServerHttpUrl(String(value)));
    return Array.from(new Set(candidates));
  }

  private async tryLocalAuth(username: string, password: string, mode: 'signin' | 'signup'): Promise<{ ok: boolean; error?: string }> {
    const profiles = await StorageManager.getGlobalData<Record<string, { hash: string; createdAt: number }>>('local_auth_profiles', {});
    const key = username.toLowerCase();
    const hash = await this.hashLocalPassword(username, password);

    if (mode === 'signup') {
      if (profiles[key]) return { ok: false, error: 'That local username already exists. Sign in instead.' };
      profiles[key] = { hash, createdAt: Date.now() };
      await StorageManager.setGlobalData('local_auth_profiles', profiles);
      return { ok: true };
    }

    if (!profiles[key]) return { ok: false, error: 'No local account found. Use Sign Up while offline.' };
    if (profiles[key].hash !== hash) return { ok: false, error: 'Incorrect password.' };
    return { ok: true };
  }

  private async hashLocalPassword(username: string, password: string): Promise<string> {
    const text = `CubeGameLocalAuth:v1:${username.toLowerCase()}:${password}`;
    if (window.crypto?.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }

    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return `fallback-${Math.abs(hash)}`;
  }

  private async finishAuth(username: string, token: string, accountId: string, role: string): Promise<void> {
    await StorageManager.setGlobalData('auth_username', username);
    await StorageManager.setGlobalData('auth_token', token);
    await StorageManager.setGlobalData('auth_account_id', accountId);
    await StorageManager.setGlobalData('auth_role', role);
    await StorageManager.setGlobalData('setting_username', username);
    this.cfgUsername.value = username;
    this.authPasswordInput.value = '';
    this.authScreen.style.display = 'none';
    this.connectionModeScreen.style.display = 'flex';
    InputManager.isUIActive = true;
  }

  private showGameplayUI() {
    document.body.classList.add('cubegame-game-active');
    document.body.classList.remove('cubegame-ui-active');
    document.getElementById('hud-overlay')!.style.display = 'flex';
    document.getElementById('chat-overlay')!.style.display = 'flex';
    EventBus.emit('mobile:gameplayControls', true);
  }

  private hideGameplayUI() {
    document.body.classList.remove('cubegame-game-active');
    document.body.classList.add('cubegame-ui-active');
    document.getElementById('hud-overlay')!.style.display = 'none';
    document.getElementById('chat-overlay')!.style.display = 'none';
    EventBus.emit('mobile:gameplayControls', false);
  }

  public isOpen(): boolean {
    return this.pauseScreen.style.display === 'flex' || 
           this.connectionModeScreen.style.display === 'flex' ||
           this.authScreen.style.display === 'flex' ||
           this.mainMenuScreen.style.display === 'flex' || 
           this.moddedModesScreen.style.display === 'flex' ||
           this.multiplayerScreen.style.display === 'flex' ||
           this.worldSelectScreen.style.display === 'flex' ||
           this.createWorldModal.style.display === 'flex' ||
           this.optionsScreen.style.display === 'flex';
  }

  public show(): void {
    if (this.isMainMenuActive()) return;
    this.pauseScreen.style.display = 'flex';
    document.body.classList.add('cubegame-ui-active');
    InputManager.isUIActive = true;
    EventBus.emit('mobile:gameplayControls', false);
    InputManager.unlockPointer();
  }

  public hide(): void {
    this.pauseScreen.style.display = 'none';
    this.authScreen.style.display = 'none';
    this.connectionModeScreen.style.display = 'none';
    this.mainMenuScreen.style.display = 'none';
    this.moddedModesScreen.style.display = 'none';
    this.multiplayerScreen.style.display = 'none';
    this.worldSelectScreen.style.display = 'none';
    this.createWorldModal.style.display = 'none';
    this.optionsScreen.style.display = 'none';
    InputManager.isUIActive = false;
    document.body.classList.remove('cubegame-ui-active');
    EventBus.emit('mobile:gameplayControls', true);
    InputManager.lockPointer();
  }

  public isMainMenuActive(): boolean {
    return this.connectionModeScreen.style.display === 'flex' ||
           this.authScreen.style.display === 'flex' ||
           this.mainMenuScreen.style.display === 'flex' || 
           this.moddedModesScreen.style.display === 'flex' ||
           this.multiplayerScreen.style.display === 'flex' ||
           this.worldSelectScreen.style.display === 'flex' ||
           this.createWorldModal.style.display === 'flex' ||
           (this.optionsScreen.style.display === 'flex' && this.lastActiveScreen === this.mainMenuScreen);
  }

  public toggle(): void {
    if (this.optionsScreen.style.display === 'flex') {
      this.optionsScreen.style.display = 'none';
      if (this.lastActiveScreen) {
        this.lastActiveScreen.style.display = 'flex';
        if (this.lastActiveScreen === this.pauseScreen) {
          InputManager.isUIActive = true;
        }
      }
      return;
    }
    if (this.isMainMenuActive()) return; // Disallow Esc closing main menu
    if (this.isOpen()) {
      this.hide();
    } else {
      this.show();
    }
  }

  private bindDOMEvents(): void {
    this.authSignInTab.addEventListener('click', () => this.setAuthMode('signin'));
    this.authSignUpTab.addEventListener('click', () => this.setAuthMode('signup'));
    this.authSubmitBtn.addEventListener('click', () => this.handleAuthSubmit());
    this.authPasswordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleAuthSubmit();
      }
    });
    this.authUsernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleAuthSubmit();
      }
    });

    // Server link modal setup
    this.serverLinkModal = document.getElementById('server-link-modal');
    this.serverLinkInput = document.getElementById('server-link-input') as HTMLInputElement | null;

    const connectBtn = document.getElementById('server-link-connect-btn');
    const skipBtn = document.getElementById('server-link-skip-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', () => {
        const url = this.serverLinkInput?.value.trim() || '';
        void this.dismissServerLinkModal(url, true);
      });
    }
    if (skipBtn) {
      skipBtn.addEventListener('click', () => { void this.dismissServerLinkModal('', false); });
    }
    if (this.serverLinkInput) {
      this.serverLinkInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const url = this.serverLinkInput?.value.trim() || '';
          void this.dismissServerLinkModal(url, true);
        }
      });
    }

    this.startupOfflineLanBtn.addEventListener('click', () => {
      this.inputServerIp.value = this.getDefaultServerWsAddress();
      StorageManager.setGlobalData('setting_connectionMode', 'offline_lan');
      StorageManager.setGlobalData('setting_serverIp', this.inputServerIp.value);
      this.connectionModeScreen.style.display = 'none';
      this.mainMenuScreen.style.display = 'flex';
      InputManager.isUIActive = true;
    });

    this.startupGlobalBtn.addEventListener('click', () => {
      StorageManager.setGlobalData('setting_connectionMode', 'global');
      this.showServerLinkModal(() => {
        this.connectionModeScreen.style.display = 'none';
        this.mainMenuScreen.style.display = 'flex';
        InputManager.isUIActive = true;
      });
    });

    // 1. MAIN MENU ACTIONS
      this.mainSingleplayerBtn.addEventListener('click', () => {
        console.log('Main Singleplayer button clicked');
        this.selectedRoomId = null;
        this.cfgRoomCode.value = '';
        this.cfgRoomName.value = '';
        this.mainMenuScreen.style.display = 'none';
        this.worldSelectScreen.style.display = 'flex';
        this.refreshWorldList();
      });

    this.mainMultiplayerBtn.addEventListener('click', () => {
      console.log('Main Multiplayer button clicked');
      this.selectedRoomId = null;
      this.cfgRoomCode.value = '';
      this.cfgRoomName.value = '';
      this.mainMenuScreen.style.display = 'none';
      this.multiplayerScreen.style.display = 'flex';
      this.refreshServerList();
    });

    this.mainModdedModesBtn.addEventListener('click', () => {
      this.mainMenuScreen.style.display = 'none';
      this.moddedModesScreen.style.display = 'flex';
      InputManager.isUIActive = true;
    });

    this.moddedModesBackBtn.addEventListener('click', () => {
      this.moddedModesScreen.style.display = 'none';
      this.mainMenuScreen.style.display = 'flex';
      InputManager.isUIActive = true;
    });

    this.moddedCsgoPlayBtn.addEventListener('click', () => {
      this.moddedModesScreen.style.display = 'none';
      this.mainMenuScreen.style.display = 'none';
      EventBus.emit('network:voice:start');
      EventBus.emit('cbgo:openMenu', {
        serverIp: this.inputServerIp.value.trim() || this.getDefaultServerWsAddress(),
        username: this.cfgUsername.value.trim() || 'Steve',
      });
    });

    this.moddedTf2PlayBtn.addEventListener('click', () => {
      this.moddedModesScreen.style.display = 'none';
      this.mainMenuScreen.style.display = 'none';
      this.hideGameplayUI();
      EventBus.emit('network:voice:start');
      EventBus.emit('network:connect', {
        ip: this.inputServerIp.value.trim() || this.getDefaultServerWsAddress(),
        room: 'crownforge_tf2',
        username: this.cfgUsername.value.trim() || 'Steve',
      });
    });

    this.mainOptionsBtn.addEventListener('click', () => {
      console.log('Main Options button clicked');
      this.lastActiveScreen = this.mainMenuScreen;
      this.mainMenuScreen.style.display = 'none';
      this.optionsScreen.style.display = 'flex';
      InputManager.isUIActive = true;
    });

    this.mainQuitBtn.addEventListener('click', () => {
      window.close();
    });

    this.skinImportBtn.addEventListener('click', () => {
      this.skinImportInput.click();
    });

    this.skinImportInput.addEventListener('change', async () => {
      const file = this.skinImportInput.files?.[0];
      if (!file) return;
      await this.importSkinFile(file);
      this.skinImportInput.value = '';
    });

    this.skinDefaultSteveBtn?.addEventListener('click', () => void this.applyDefaultSkin('steve'));
    this.skinDefaultAlexBtn?.addEventListener('click', () => void this.applyDefaultSkin('alex'));

    // 2. WORLD SELECTION ACTIONS
    this.btnCancelWorldSelect.addEventListener('click', () => {
      this.worldSelectScreen.style.display = 'none';
      this.mainMenuScreen.style.display = 'flex';
    });

    this.btnCreateWorldMenu.addEventListener('click', () => {
      this.newWorldNameInput.value = 'New World';
      this.newWorldSeedInput.value = this.randomSeedString();
      this.createWorldModal.style.display = 'flex';
    });

    this.newWorldRandSeedBtn.addEventListener('click', () => {
      this.newWorldSeedInput.value = this.randomSeedString();
    });

    this.btnCancelCreateWorld.addEventListener('click', () => {
      this.createWorldModal.style.display = 'none';
    });

    this.btnConfirmCreateWorld.addEventListener('click', async () => {
      const name = this.newWorldNameInput.value.trim() || 'New World';
      const seed = this.newWorldSeedInput.value.trim() || this.randomSeedString();
      const preset = this.newWorldPresetSelect.value;
      
      const newWorld = await StorageManager.createWorld(name, seed, preset);
      this.createWorldModal.style.display = 'none';
      this.worldSelectScreen.style.display = 'none';
      
      this.startWorld(newWorld.id);
    });

    // 3. PAUSE MENU ACTIONS
    this.pauseOptionsBtn.addEventListener('click', () => {
      this.lastActiveScreen = this.pauseScreen;
      this.pauseScreen.style.display = 'none';
      this.optionsScreen.style.display = 'flex';
      InputManager.isUIActive = true;
    });

    const optionsDoneBtn = document.getElementById('options-done-btn') as HTMLButtonElement;
    optionsDoneBtn.addEventListener('click', () => {
      this.optionsScreen.style.display = 'none';
      if (this.lastActiveScreen) {
        if ((this.lastActiveScreen as any) === 'cbgo') {
          document.getElementById('cbgo-root')?.classList.add('visible');
          InputManager.isUIActive = true;
        } else if ((this.lastActiveScreen as any) === 'tf2') {
          document.getElementById('tf2-root')?.classList.add('visible');
          InputManager.isUIActive = true;
        } else {
          this.lastActiveScreen.style.display = 'flex';
        }
      }
    });

    this.resumeBtn.addEventListener('click', () => {
      this.hide();
    });

    this.pauseDisconnectBtn.addEventListener('click', () => {
      if (document.body.dataset.cobActive === 'true') {
        EventBus.emit('game:leaveCOB');
        return;
      }
      EventBus.emit('network:disconnect');
      this.disconnectToMainMenu();
    });

    this.worldCreateBtn.addEventListener('click', async () => {
      await this.saveWorldSettings();
      await StorageManager.clearCurrentWorld();
      await this.saveWorldSettings();
      window.location.reload();
    });

    this.randomSeedBtn.addEventListener('click', () => {
      this.inputSeed.value = this.randomSeedString();
      StorageManager.setWorldData('world_seed', this.inputSeed.value);
    });

    // Reset database button
    this.resetBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete all worlds and settings? This cannot be undone!')) {
        await StorageManager.clearAll();
        window.location.reload();
      }
    });

    // FOV slider (Global Setting)
    this.sliderFov.addEventListener('input', () => {
      const val = parseInt(this.sliderFov.value);
      EventBus.emit('settings:fov', val);
      StorageManager.setGlobalData('setting_fov', val);
    });

    // Render Distance slider (Global Setting)
    this.sliderRenderDist.addEventListener('input', () => {
      const val = parseInt(this.sliderRenderDist.value);
      EventBus.emit('settings:renderDistance', val);
      StorageManager.setGlobalData('setting_renderDist', val);
    });

    this.selectShaderPack.addEventListener('change', () => {
      EventBus.emit('settings:shaderPack', this.selectShaderPack.value);
      StorageManager.setGlobalData('setting_shaderPack', this.selectShaderPack.value);
    });

    this.selectShadows.addEventListener('change', () => {
      const enabled = this.selectShadows.value === 'on';
      EventBus.emit('settings:shadows', enabled);
      StorageManager.setGlobalData('setting_shadows', enabled);
    });

    // World Seed
    this.inputSeed.addEventListener('change', () => {
      const val = this.inputSeed.value.trim();
      StorageManager.setWorldData('world_seed', val);
    });

    this.selectPreset.addEventListener('change', () => StorageManager.setWorldData('world_preset', this.selectPreset.value));
    this.selectDifficulty.addEventListener('change', () => StorageManager.setWorldData('world_difficulty', this.selectDifficulty.value));
    this.sliderBiomeScale.addEventListener('input', () => StorageManager.setWorldData('world_biome_scale', parseInt(this.sliderBiomeScale.value)));
    this.sliderTerrainScale.addEventListener('input', () => StorageManager.setWorldData('world_terrain_scale', parseInt(this.sliderTerrainScale.value)));
    this.sliderCaveDensity.addEventListener('input', () => StorageManager.setWorldData('world_cave_density', parseInt(this.sliderCaveDensity.value)));
    this.sliderStructureRate.addEventListener('input', () => StorageManager.setWorldData('world_structure_rate', parseInt(this.sliderStructureRate.value)));

    // 4. MULTIPLAYER SERVER LIST ACTIONS
    this.btnCancelMultiplayer.addEventListener('click', () => {
      this.multiplayerScreen.style.display = 'none';
      this.mainMenuScreen.style.display = 'flex';
    });

    this.btnRefreshServers.addEventListener('click', () => {
      this.refreshServerList();
    });

    this.btnJoinServer.addEventListener('click', () => {
      this.joinSelectedRoom();
    });

    this.btnCreateRoom.addEventListener('click', () => {
      const input = this.cfgRoomCode.value.trim() || this.cfgRoomName.value.trim();
      if (!input) {
        alert('Please enter a room/world name or room code.');
        return;
      }
      this.selectedRoomId = input;
      this.joinSelectedRoom();
    });
  }

  private bindInputSettings(): void {
    const list = document.getElementById('input-bindings-list');
    const flipBtn = document.getElementById('flip-run-crouch-btn') as HTMLButtonElement | null;
    const resetBtn = document.getElementById('reset-input-bindings-btn') as HTMLButtonElement | null;
    if (!list) return;

    const render = () => this.renderInputBindings(list);
    EventBus.on('input:bindingsChanged', render);
    flipBtn?.addEventListener('click', () => {
      InputManager.flipSprintCrouch();
      render();
    });
    resetBtn?.addEventListener('click', () => {
      InputManager.resetKeyBindings();
      render();
    });
    render();
  }

  private renderInputBindings(list: HTMLElement): void {
    list.innerHTML = '';
    for (const action of this.inputActions) {
      const row = document.createElement('div');
      row.className = 'input-bind-row';

      const label = document.createElement('span');
      label.textContent = InputManager.getActionLabel(action);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'keybind-btn';
      button.textContent = this.formatKeyLabel(InputManager.getPrimaryBinding(action));
      button.addEventListener('click', () => {
        button.textContent = 'Press key...';
        button.classList.add('listening');
        InputManager.captureNextBinding(action, () => {
          button.classList.remove('listening');
          this.renderInputBindings(list);
        });
      });

      row.appendChild(label);
      row.appendChild(button);
      list.appendChild(row);
    }
  }

  private formatKeyLabel(key: string): string {
    if (key === ' ') return 'Space';
    if (key.startsWith('key') && key.length === 4) return key.slice(3).toUpperCase();
    if (key === 'shiftleft' || key === 'shiftright') return 'Shift';
    if (key === 'controlleft' || key === 'controlright' || key === 'ctrl') return 'Ctrl';
    if (key === 'arrowup') return 'Up';
    if (key === 'arrowdown') return 'Down';
    if (key === 'arrowleft') return 'Left';
    if (key === 'arrowright') return 'Right';
    if (key === 'mouse0') return 'Mouse Left';
    if (key === 'mouse1') return 'Mouse Middle';
    if (key === 'mouse2') return 'Mouse Right';
    if (/^mouse\d+$/.test(key)) return `Mouse ${key.slice(5)}`;
    return key ? key[0].toUpperCase() + key.slice(1) : 'Unbound';
  }

  private disconnectToMainMenu() {
    this.isMultiplayerMode = false;
    this.hideGameplayUI();
    this.pauseScreen.style.display = 'none';
    this.authScreen.style.display = 'none';
    this.connectionModeScreen.style.display = 'none';
    this.multiplayerScreen.style.display = 'none';
    this.optionsScreen.style.display = 'none';
    this.worldSelectScreen.style.display = 'none';
    this.createWorldModal.style.display = 'none';
    this.mainMenuScreen.style.display = 'flex';
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
    this.randomizeSplash();
  }

  private async startWorld(worldId: string): Promise<void> {
    this.isMultiplayerMode = false;
    
    // Set active world
    StorageManager.setCurrentWorld(worldId);
    await StorageManager.updateWorldMeta(worldId, { lastPlayed: Date.now() });

    // Load settings for the active world
    await this.loadWorldSettings();

    EventBus.emit('world:selected', worldId);

    this.showGameplayUI();
    this.hide();
  }

  private async refreshWorldList(): Promise<void> {
    this.worldListDiv.innerHTML = '<div style="color: #aaa; padding: 12px; font-family: monospace;">Loading worlds...</div>';
    
    try {
      const worlds = await StorageManager.listWorlds();
      this.worldListDiv.innerHTML = '';
      
      if (worlds.length === 0) {
        this.worldListDiv.innerHTML = '<div style="color: #ff5555; padding: 12px; font-family: monospace;">No local worlds found. Create a new one!</div>';
        return;
      }

      worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);

      worlds.forEach((w: WorldMeta) => {
        const item = document.createElement('div');
        item.className = 'server-item';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        
        const info = document.createElement('div');
        
        const name = document.createElement('span');
        name.className = 'server-name';
        name.innerText = w.name;
        info.appendChild(name);

        const details = document.createElement('span');
        details.className = 'server-players';
        details.style.fontSize = '12px';
        details.style.color = '#8888aa';
        details.innerText = ` [Seed: ${w.seed}] (${w.preset || 'survival'}) - Last played: ${new Date(w.lastPlayed).toLocaleDateString()}`;
        info.appendChild(details);

        item.appendChild(info);

        const actionGroup = document.createElement('div');
        actionGroup.style.display = 'flex';
        actionGroup.style.gap = '8px';

        const playBtn = document.createElement('button');
        playBtn.className = 'mc-btn';
        playBtn.style.padding = '4px 10px';
        playBtn.style.fontSize = '11px';
        playBtn.innerText = 'PLAY';
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.startWorld(w.id);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'mc-btn';
        deleteBtn.style.padding = '4px 10px';
        deleteBtn.style.fontSize = '11px';
        deleteBtn.style.background = 'rgba(220, 50, 50, 0.2)';
        deleteBtn.style.borderColor = 'rgb(220, 50, 50)';
        deleteBtn.innerText = 'DELETE';
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete world "${w.name}"?`)) {
            await StorageManager.deleteWorld(w.id);
            this.refreshWorldList();
          }
        });

        actionGroup.appendChild(playBtn);
        actionGroup.appendChild(deleteBtn);
        item.appendChild(actionGroup);

        item.addEventListener('dblclick', () => {
          this.startWorld(w.id);
        });

        this.worldListDiv.appendChild(item);
      });
    } catch (e) {
      console.error(e);
      this.worldListDiv.innerHTML = '<div style="color: #ff5555; padding: 12px; font-family: monospace;">Failed to load local worlds.</div>';
    }
  }

  private async refreshSkinImportStatus(): Promise<void> {
    const savedName = await StorageManager.getGlobalData<string>('player_skin_name', '');
    if (this.skinImportStatus) {
      this.skinImportStatus.textContent = savedName ? `Saved skin: ${savedName}` : 'Default Steve skin active';
    }
  }


  private async applyDefaultSkin(kind: 'steve' | 'alex'): Promise<void> {
    const dataUrl = kind === 'alex' ? createDefaultAlexSkinDataUrl() : createDefaultSteveSkinDataUrl();
    const label = kind === 'alex' ? 'Default Alex' : 'Default Steve';
    await StorageManager.setGlobalData('player_skin_data_url', dataUrl);
    await StorageManager.setGlobalData('player_skin_name', label);
    this.skinImportStatus.textContent = `${label} skin active`;
    EventBus.emit('player:skinChanged', dataUrl);
    this.uploadSkinToServer(dataUrl, `${label}.png`).catch(() => {});
  }

  private async importSkinFile(file: File): Promise<void> {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      this.skinImportStatus.textContent = 'Use a PNG or JPG skin file';
      return;
    }
    if (file.size > 1_000_000) {
      this.skinImportStatus.textContent = 'Skin file is too large';
      return;
    }

    try {
      const dataUrl = await this.readFileAsDataUrl(file);
      await this.validateSkinImage(dataUrl);
      await StorageManager.setGlobalData('player_skin_data_url', dataUrl);
      await StorageManager.setGlobalData('player_skin_name', file.name);
      this.skinImportStatus.textContent = `Saved skin: ${file.name}`;
      EventBus.emit('player:skinChanged', dataUrl);
      this.uploadSkinToServer(dataUrl, file.name).catch(() => {
        this.skinImportStatus.textContent = `Saved locally: ${file.name}`;
      });
    } catch (err) {
      console.error(err);
      this.skinImportStatus.textContent = 'Could not read that skin image';
    }
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Read failed'));
      reader.readAsDataURL(file);
    });
  }

  private validateSkinImage(dataUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const valid = (img.width === 64 && (img.height === 64 || img.height === 32)) ||
          (img.width >= 32 && img.height >= 32);
        valid ? resolve() : reject(new Error('Unexpected skin dimensions'));
      };
      img.onerror = () => reject(new Error('Invalid skin image'));
      img.src = dataUrl;
    });
  }

  private async uploadSkinToServer(dataUrl: string, fileName: string): Promise<void> {
    const username = this.cfgUsername.value.trim() || await StorageManager.getGlobalData<string>('setting_username', 'Steve');
    const payload = {
      method: 'POST',
      headers: this.serverApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ username, fileName, dataUrl }),
    };

    let res = await fetch(`${this.getServerHttpUrl(this.inputServerIp.value.trim())}/api/skins`, payload);
    if (!res.ok && window.location.hostname === 'localhost') {
      res = await fetch('http://localhost:8080/api/skins', payload);
    }
    if (!res.ok) throw new Error('Skin upload failed');
    this.skinImportStatus.textContent = `Saved skin: ${fileName}`;
  }

  private setJoinButtonBusy(message: string): void {
    const clean = String(message || 'Connecting...').slice(0, 140);
    if (!this.joinStatusRestoreText) this.joinStatusRestoreText = this.btnJoinServer.textContent || 'JOIN SERVER';
    this.btnJoinServer.disabled = true;
    this.btnJoinServer.textContent = 'CONNECTING...';
    this.btnJoinServer.title = clean;
    const existing = this.multiplayerScreen.querySelector('.join-status-line') as HTMLElement | null;
    const status = existing || document.createElement('div');
    status.className = 'join-status-line';
    status.textContent = clean;
    status.setAttribute('style', 'margin-top:10px;color:#ffe082;font-family:monospace;font-size:14px;');
    if (!existing) this.btnJoinServer.parentElement?.appendChild(status);
  }

  private clearJoinButtonBusy(): void {
    this.btnJoinServer.disabled = false;
    this.btnJoinServer.textContent = this.joinStatusRestoreText || 'JOIN SERVER';
    this.btnJoinServer.title = '';
    this.joinStatusRestoreText = '';
    this.multiplayerScreen.querySelector('.join-status-line')?.remove();
  }

  private cancelPendingJoin(message: string): void {
    this.pendingMultiplayerJoin = false;
    this.isMultiplayerMode = false;
    this.clearJoinButtonBusy();
    this.hideGameplayUI();
    this.pauseScreen.style.display = 'none';
    this.authScreen.style.display = 'none';
    this.connectionModeScreen.style.display = 'none';
    this.mainMenuScreen.style.display = 'none';
    this.moddedModesScreen.style.display = 'none';
    this.multiplayerScreen.style.display = 'flex';
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
    const status = document.createElement('div');
    status.className = 'join-status-line join-status-error';
    status.textContent = message;
    status.setAttribute('style', 'margin-top:10px;color:#ff7777;font-family:monospace;font-size:14px;');
    this.btnJoinServer.parentElement?.appendChild(status);
  }

  private completePendingJoin(): void {
    this.pendingMultiplayerJoin = false;
    this.clearJoinButtonBusy();
    this.isMultiplayerMode = true;
    this.multiplayerScreen.style.display = 'none';
    this.showGameplayUI();
    this.hide();
  }

  private joinSelectedRoom() {
    const roomName = this.cfgRoomName.value.trim();
    const roomCode = this.cfgRoomCode.value.trim();
    const pastedShareLink = [roomCode, roomName, this.inputServerIp.value.trim()].find(value => this.looksLikeShareLink(value));
    const manuallyTypedRoom = this.looksLikeShareLink(roomCode)
      ? ''
      : (roomCode || (this.looksLikeShareLink(roomName) ? '' : roomName));
    const room = this.normalizeRoomSelection(this.selectedRoomId || manuallyTypedRoom || 'lobby_1');
    const username = this.cfgUsername.value.trim() || 'Steve';
    const serverIp = this.normalizeServerAddressInput(pastedShareLink || this.inputServerIp.value.trim() || this.getDefaultServerWsAddress());

    this.inputServerIp.value = serverIp;
    StorageManager.setGlobalData('setting_serverIp', serverIp);
    StorageManager.setGlobalData('setting_username', username);

    this.pendingMultiplayerJoin = true;
    this.isMultiplayerMode = false;
    this.hideGameplayUI();
    this.multiplayerScreen.querySelectorAll('.join-status-line').forEach(el => el.remove());
    this.setJoinButtonBusy(`Opening real WebSocket to ${serverIp} for room ${room}...`);

    // Do not hide the multiplayer UI until the server sends a CubeGame welcome
    // packet and the multiplayer world has actually loaded. This prevents the
    // broken rotating-sky state where a failed join looked like a fallback game.
    EventBus.emit('network:connect', {
      ip: serverIp,
      room,
      roomCode: this.looksLikeShareLink(roomCode) ? undefined : (roomCode || undefined),
      username
    });
  }

  private async refreshServerList() {
    this.serverListDiv.innerHTML = '<div class="server-list-empty">Scanning featured servers...</div>';
    this.selectedRoomId = null;

    const defaultAddress = this.inputServerIp.value.trim() || this.getDefaultServerWsAddress();
    const httpUrl = this.getServerHttpUrl(defaultAddress);

    const fallbackFeatured = [
      {
        id: 'ashfall_anarchy',
        displayName: 'Ashfall Anarchy',
        roomId: 'ashfall_anarchy_survival',
        description: 'Permanent anarchy survival. Boots with the Node server and stays loaded even when empty.',
        gameModes: ['Anarchy Survival', 'PvP', 'Shared Mobs', 'Weather'],
        playerCount: 0,
        status: 'Online',
        color: '#d95032',
        motd: 'No claims. No resets. Bring armor.'
      },
      {
        id: 'crownforge_network',
        displayName: 'CrownForge Network',
        roomId: 'crownforge_lobby',
        description: 'Minigame hub with SkyWars, BedWars, Void Duels, Castle Siege, Survival Games, and modded tactical modes.',
        gameModes: ['SkyWars', 'BedWars', 'Void Duels', 'Castle Siege', 'Survival Games', 'Counter-Block Offensive', 'Fortress Arena'],
        playerCount: 0,
        status: 'Online',
        color: '#55b8ff',
        motd: 'Join lobby then use /skywars, /bedwars, /duels, /castle, /sg, /csgo, or /tf2.'
      }
    ];

    this.serverListDiv.innerHTML = '';

    let featuredServers: any[] = fallbackFeatured;
    try {
      const res = await fetch(`${httpUrl}/api/featured-servers`, { headers: this.serverApiHeaders() });
      if (res.ok) {
        const apiServers = await res.json();
        if (Array.isArray(apiServers) && apiServers.length > 0) featuredServers = apiServers;
      }
    } catch {
      // Fall back to local definitions so the menu still works while the server is starting.
    }

    const featuredHeader = document.createElement('div');
    featuredHeader.className = 'server-list-header';
    featuredHeader.textContent = 'Featured Servers';
    this.serverListDiv.appendChild(featuredHeader);

    featuredServers.forEach((server) => {
      const roomId = String(server.roomId || server.id || 'lobby_1');
      const address = String(server.address || defaultAddress);
      const item = this.createServerItem({
        title: server.displayName || server.id || roomId,
        subtitle: server.description || server.motd || 'Featured multiplayer server.',
        modes: Array.isArray(server.gameModes) ? server.gameModes : [],
        players: Number(server.playerCount || 0),
        status: server.status || (server.online === false ? 'Offline' : 'Online'),
        address,
        roomId,
        color: server.color || server.roomMeta?.color || '#55ff55',
        featured: true,
      });
      this.serverListDiv.appendChild(item);
    });

    const roomsHeader = document.createElement('div');
    roomsHeader.className = 'server-list-header secondary';
    roomsHeader.textContent = 'Rooms on this server';
    this.serverListDiv.appendChild(roomsHeader);

    try {
      const share = await this.fetchServerShare(httpUrl);
      const res = await fetch(`${httpUrl}/api/rooms`, { headers: this.serverApiHeaders() });
      if (!res.ok) throw new Error('API unreachable');

      const rooms = await res.json();

      if (share) {
        const shareItem = document.createElement('div');
        shareItem.className = 'server-item utility-card';
        shareItem.innerHTML = share.publicUrl
          ? `<div><span class="server-name">Public Share Link</span><div class="server-desc">Click to copy the public URL for friends.</div></div><span class="server-players">${this.escapeHtml(share.publicUrl)}</span>`
          : `<div><span class="server-name">Public Share Link</span><div class="server-desc">Tunnel status from the Node server.</div></div><span class="server-players">${this.escapeHtml(share.tunnelStatus || 'starting')}</span>`;
        shareItem.addEventListener('click', () => {
          if (share.publicUrl) navigator.clipboard?.writeText(share.publicUrl).catch(() => {});
        });
        this.serverListDiv.appendChild(shareItem);
      }

      if (Array.isArray(rooms) && rooms.length > 0) {
        rooms
          .sort((a: any, b: any) => Number(b?.meta?.permanent || b?.permanent || 0) - Number(a?.meta?.permanent || a?.permanent || 0))
          .forEach((room: any) => {
            const meta = room.meta || {};
            const item = this.createServerItem({
              title: meta.displayName || room.id,
              subtitle: meta.description || 'Player-created multiplayer room.',
              modes: Array.isArray(meta.gameModes) ? meta.gameModes : [],
              players: Number(room.playerCount || 0),
              status: meta.permanent || room.permanent ? 'Permanent' : 'Room',
              address: defaultAddress,
              roomId: room.id,
              color: meta.color || '#8ca0ff',
              featured: !!meta.permanent,
            });
            this.serverListDiv.appendChild(item);
          });
      } else {
        const empty = document.createElement('div');
        empty.className = 'server-list-empty';
        empty.textContent = 'No rooms returned yet. The permanent rooms should appear after the Node server finishes booting.';
        this.serverListDiv.appendChild(empty);
      }
    } catch {
      const offline = document.createElement('div');
      offline.className = 'server-list-empty warning';
      offline.textContent = 'Could not reach the local room API yet. Start the server with npm run server or npm run start.';
      this.serverListDiv.appendChild(offline);
    }
  }

  private createServerItem(server: {
    title: string;
    subtitle: string;
    modes: string[];
    players: number;
    status: string;
    address: string;
    roomId: string;
    color: string;
    featured: boolean;
  }): HTMLElement {
    const item = document.createElement('div');
    item.className = `server-item ${server.featured ? 'featured-server' : ''}`;
    item.style.setProperty('--server-accent', server.color);

    const modeText = server.modes.length > 0 ? server.modes.slice(0, 5).join(' • ') : 'Survival';
    item.innerHTML = `
      <div class="server-main">
        <div class="server-title-row">
          <span class="server-name">${server.featured ? '★ ' : ''}${this.escapeHtml(server.title)}</span>
          <span class="server-badge">${this.escapeHtml(server.status)}</span>
        </div>
        <div class="server-desc">${this.escapeHtml(server.subtitle)}</div>
        <div class="server-modes">${this.escapeHtml(modeText)}</div>
      </div>
      <div class="server-side">
        <span class="server-players">${server.players} player${server.players === 1 ? '' : 's'}</span>
        <span class="server-address">${this.escapeHtml(server.address)}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      document.querySelectorAll('.server-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      this.selectedRoomId = this.normalizeRoomSelection(server.roomId);
      this.cfgRoomCode.value = this.selectedRoomId;
      this.cfgRoomName.value = '';
      this.inputServerIp.value = server.address;
    });

    item.addEventListener('dblclick', () => {
      this.selectedRoomId = this.normalizeRoomSelection(server.roomId);
      this.cfgRoomCode.value = this.selectedRoomId;
      this.cfgRoomName.value = '';
      this.inputServerIp.value = server.address;
      this.joinSelectedRoom();
    });

    return item;
  }

  private normalizeRoomSelection(roomId: string): string {
    const clean = String(roomId || '').trim();
    const lower = clean.toLowerCase();
    if (lower === 'crownforge' || lower === 'crownforge_network' || lower === 'crownforge-network') {
      return 'crownforge_lobby';
    }
    if (lower === 'ashfall' || lower === 'ashfall_anarchy') {
      return 'ashfall_anarchy_survival';
    }
    return clean || 'lobby_1';
  }

  private getDefaultServerWsAddress(): string {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname || 'localhost';
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return isLocal ? `${scheme}://${host}:8080` : `${scheme}://${window.location.host}`;
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private getServerHttpUrl(address: string): string {
    let base = String(address || '').trim() || window.location.host;
    if (/^ws:\/\//i.test(base)) base = `http://${base.slice(5)}`;
    else if (/^wss:\/\//i.test(base)) base = `https://${base.slice(6)}`;
    else if (!/^https?:\/\//i.test(base)) {
      const scheme = window.location.protocol === 'https:' ? 'https' : 'http';
      base = `${scheme}://${base}`;
    }
    return base.replace(/\/+$/, '');
  }

  private normalizeServerAddressInput(address: string): string {
    let raw = String(address || '').trim();
    if (!raw) return this.getDefaultServerWsAddress();

    raw = raw
      .replace(/^wss?:serverip:serverport$/i, '')
      .replace(/^serverip:serverport$/i, '')
      .replace(/^server-ip:server-port$/i, '');
    if (!raw) return this.getDefaultServerWsAddress();

    if (/^wss?:[^/]/i.test(raw)) {
      raw = raw.replace(/^wss?:/i, (scheme) => `${scheme}//`);
    }
    if (/^http:\/\//i.test(raw)) raw = `ws://${raw.slice('http://'.length)}`;
    else if (/^https:\/\//i.test(raw)) raw = `wss://${raw.slice('https://'.length)}`;
    else if (!/^wss?:\/\//i.test(raw)) {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      raw = `${scheme}://${raw}`;
    }

    try {
      const url = new URL(raw);
      return url.toString().replace(/\/$/, '');
    } catch {
      return raw.replace(/\/+$/, '');
    }
  }

  private looksLikeShareLink(value: string): boolean {
    return /^https?:\/\//i.test(value) || /^wss?:\/\//i.test(value);
  }

  private async fetchServerShare(httpUrl: string): Promise<any | null> {
    try {
      const res = await fetch(`${httpUrl}/api/share`, { headers: this.serverApiHeaders() });
      return res.ok ? await res.json() : null;
    } catch {
      if (window.location.hostname !== 'localhost') return null;
      try {
        const res = await fetch('http://localhost:8080/api/share', { headers: this.serverApiHeaders() });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    }
  }

  private refreshShaderPackOptions(): void {
    if (!this.selectShaderPack) return;
    const current = this.selectShaderPack.value || 'balanced';
    this.selectShaderPack.innerHTML = '';

    for (const pack of SHADER_PACKS) {
      const option = document.createElement('option');
      option.value = pack.id;
      option.textContent = pack.name;
      this.selectShaderPack.appendChild(option);
    }

    if (SHADER_PACKS.some(pack => pack.id === current)) {
      this.selectShaderPack.value = current;
    }
  }

  // Loaded stored settings updater
  public loadSettings(settings: { fov: number; renderDist: number; seed: string; serverIp: string; shaderPack?: string; shadows?: boolean }): void {
    this.sliderFov.value = settings.fov.toString();
    this.sliderRenderDist.value = settings.renderDist.toString();
    if (settings.shaderPack && this.selectShaderPack) this.selectShaderPack.value = settings.shaderPack;
    if (typeof settings.shadows === 'boolean' && this.selectShadows) {
      this.selectShadows.value = settings.shadows ? 'on' : 'off';
    }
    this.inputSeed.value = settings.seed;
    this.inputServerIp.value = settings.serverIp;
    this.loadWorldSettings();
  }

  public getSettings(): { fov: number; renderDist: number; seed: string; serverIp: string } {
    return {
      fov: parseInt(this.sliderFov.value),
      renderDist: parseInt(this.sliderRenderDist.value),
      seed: this.inputSeed.value.trim(),
      serverIp: this.inputServerIp.value.trim()
    };
  }

  private async saveWorldSettings(): Promise<void> {
    await StorageManager.setWorldData('world_seed', this.inputSeed.value.trim() || '12345');
    await StorageManager.setGlobalData('setting_serverIp', this.inputServerIp.value.trim());
    await StorageManager.setWorldData('world_preset', this.selectPreset.value);
    await StorageManager.setWorldData('world_difficulty', this.selectDifficulty.value);
    await StorageManager.setWorldData('world_biome_scale', parseInt(this.sliderBiomeScale.value));
    await StorageManager.setWorldData('world_terrain_scale', parseInt(this.sliderTerrainScale.value));
    await StorageManager.setWorldData('world_cave_density', parseInt(this.sliderCaveDensity.value));
    await StorageManager.setWorldData('world_structure_rate', parseInt(this.sliderStructureRate.value));
  }

  private async loadWorldSettings(): Promise<void> {
    this.selectPreset.value = await StorageManager.getWorldData<string>('world_preset', 'survival');
    this.selectDifficulty.value = await StorageManager.getWorldData<string>('world_difficulty', 'normal');
    this.sliderBiomeScale.value = (await StorageManager.getWorldData<number>('world_biome_scale', 5)).toString();
    this.sliderTerrainScale.value = (await StorageManager.getWorldData<number>('world_terrain_scale', 5)).toString();
    this.sliderCaveDensity.value = (await StorageManager.getWorldData<number>('world_cave_density', 4)).toString();
    this.sliderStructureRate.value = (await StorageManager.getWorldData<number>('world_structure_rate', 3)).toString();
    this.cfgUsername.value = await StorageManager.getGlobalData<string>('setting_username', 'Steve');
  }
}
