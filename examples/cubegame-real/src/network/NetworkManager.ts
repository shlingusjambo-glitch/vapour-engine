import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { BinaryProtocol, PacketType } from './BinaryProtocol';
import { EntityManager } from '../entities/EntityManager';
import { WorldManager } from '../world/WorldManager';
import { StorageManager } from '../storage/StorageManager';
import { ModLoader } from '../core/ModLoader';
import { PlatformRuntime } from '../core/PlatformRuntime';
import * as THREE from 'three';
import { getFeatureBlockId } from '../content/FeatureCatalog';
import { CROWNFORGE_BEDWARS_TEAM_SPAWNS, CROWNFORGE_SKYWARS_SPAWNS, defaultSpawnForDimension as crownForgeDefaultSpawnForDimension, getMinigameByCommand } from '../crownforge/CrownForgeCatalog';
import { NetworkRegistry } from '../engine/EngineRegistries';
import { createDefaultSteveSkinDataUrl } from '../player/DefaultSteveSkin';

// No offline/mock WebSocket fallback lives here anymore. Multiplayer joins use only
// the real CubeGame WebSocket server and wait for its welcome handshake.

type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'retrying'
  | 'failed'
  | 'disconnected';

interface ConnectionCandidate {
  url: string;
  label: string;
}

interface LastMoveState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  sentAt: number;
}

export class NetworkManager {
  private ws: WebSocket | null = null;
  private entityManager: EntityManager;
  private worldManager: WorldManager;

  private isConnected = false;
  private isConnecting = false;
  private myUuid: string = '';
  private myPlayerIndex: number = -1;
  private playerIndexToUuid: Map<number, string> = new Map();
  public ping = 0;

  private lastPingTime = 0;
  private sendMoveInterval: number | null = null;
  private sendMobInterval: number | null = null;
  private connectTimeout: number | null = null;
  private pingTimeout: number | null = null;
  private reconnectTimeout: number | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 8;
  private readonly reconnectBaseDelayMs = 700;
  private handshakeTimeout: number | null = null;
  private welcomeReceived = false;
  private lastStableUrl = "";

  private currentUrl = '';
  private connectCandidates: ConnectionCandidate[] = [];
  private connectAttempt = 0;
  private wantedRoomId = '';
  public wantedUsername = '';
  private authToken = '';

  private lastMove: LastMoveState | null = null;
  private readonly moveSendMs = 33; // ~30Hz for smoother interpolation.
  private readonly forcedMoveHeartbeatMs = 200;
  private readonly maxBufferedBytes = 256 * 1024;
  private isMobAuthority = false;
  private lastBreakProgressKey = '';
  private lastBreakProgressSentAt = 0;
  private applyingRemoteTime = false;
  private lastLocalTimeBroadcastMs = 0;
  private lastCrouchSent: boolean | null = null;
  private lastPlayerStateSignature = '';
  private lastPunchSentAt = 0;
  private lastPunchStateSentAt = 0;
  private userRequestedDisconnect = false;

  constructor(entityManager: EntityManager, worldManager: WorldManager) {
    this.entityManager = entityManager;
    this.worldManager = worldManager;

    // Listen to user request to connect
    EventBus.on('network:connect', (data: any) => {
      if (typeof data === 'string') {
        void this.connect(data);
      } else if (data && (data.ip || data.url || data.address)) {
        void this.connect(
          data.ip || data.url || data.address,
          data.room || data.roomId || data.roomCode || data.code,
          data.username || data.name
        );
      }
    });

    EventBus.on('network:disconnect', () => this.disconnect());

    // Optional hooks. If your SkySystem emits one of these while advancing time,
    // the host can publish time-of-day without needing direct NetworkManager wiring.
    const publishTime = (time: any) => {
      if (this.applyingRemoteTime) return;
      const timeOfDay = typeof time === 'number' ? time : Number(time?.timeOfDay);
      if (!Number.isFinite(timeOfDay)) return;

      const now = performance.now();
      // Time moves continuously; publishing every ~5s keeps clients aligned without spam.
      if (now - this.lastLocalTimeBroadcastMs > 5000) {
        this.lastLocalTimeBroadcastMs = now;
        this.sendTimeSync(timeOfDay);
      }
    };
    EventBus.on('time:changed', publishTime);
    EventBus.on('world:timeChanged', publishTime);
    EventBus.on('sky:timeChanged', publishTime);

    // Listen to local block modifications to sync to server
    EventBus.on('world:blockChanged', (data: { x: number; y: number; z: number; blockId: number }) => {
      this.sendBlockEdit(data.x, data.y, data.z, data.blockId);
    });

    // Listen to local chat input to send to server
    EventBus.on('chat:send', (msg: string) => this.sendChat(msg));

    EventBus.on('player:skinChanged', (skinDataUrl: string) => this.sendSkin(skinDataUrl));
    EventBus.on('player:crouchChanged', () => this.syncLocalPlayerState(true));
    EventBus.on('mouse:leftClick', () => this.sendPlayerAction('punch'));
    EventBus.on('player:sprintChanged', () => this.syncLocalPlayerState(true));

    // World item drops are part of the shared simulation now: breaking a block,
    // mob drops, redstone dispensers, and manual drops all appear for everyone.
    EventBus.on('item:networkSpawned', (data: any) => this.sendItemDrop(data));
    EventBus.on('item:networkPickedUp', (data: any) => this.sendItemPickup(data));
    EventBus.on('network:blockBreakProgress', (data: any) => this.sendBlockBreakProgress(data));
    EventBus.on('mod:networkSend', (data: any) => this.sendModPacket(data));

    EventBus.on('network:sendPvpDamage', (data: { targetUuid: string; damage: number }) => {
      this.safeSendJson({ type: 'playerDamage', targetUuid: data.targetUuid, damage: data.damage });
    });
    EventBus.on('network:sendCbgoShot', (data: any) => {
      this.safeSendJson({ type: 'cbgoShot', ...data });
    });
    EventBus.on('network:cbgoObjective', (data: any) => {
      this.safeSendJson({ type: 'cbgoObjective', ...(data || {}) });
    });
    EventBus.on('network:cbgoQuickPlay', (data?: any) => {
      this.safeSendJson({ type: 'cbgoQuickPlay', ...(data || {}) });
    });
    EventBus.on('player:healthChanged', (health: number) => {
      this.safeSendJson({ type: 'playerHealth', health });
    });
    EventBus.on('network:sendWeather', (data: { weather: string; intensity: number }) => {
      this.safeSendJson({ type: 'weatherSync', weather: data.weather, intensity: data.intensity });
    });
    EventBus.on('network:sendMobDamage', (data: { mobId: string; damage: number }) => {
      this.safeSendJson({ type: 'mobDamage', mobId: data.mobId, damage: data.damage });
    });
    EventBus.on('network:voice:sendSignal', (data: any) => this.sendVoiceSignal(data));
  }

  public get connected(): boolean {
    return this.isConnected;
  }

  public async connect(url: string, roomId?: string, username?: string): Promise<void> {
    this.disconnect(false);

    this.wantedRoomId = roomId || '';
    this.wantedUsername = username || '';
    this.authToken = await StorageManager.getGlobalData<string>('auth_token', '');

    this.connectCandidates = this.buildConnectionCandidates(url, this.wantedRoomId, this.wantedUsername);
    this.connectAttempt = 0;
    this.reconnectAttempts = 0;
    this.clearReconnectTimeout();

    if (this.connectCandidates.length === 0) {
      this.emitStatus('failed', 'No usable WebSocket address was provided.');
      return;
    }

    const firstHttpUrl = PlatformRuntime.webSocketToHttpUrl(this.connectCandidates[0].url);
    if (firstHttpUrl) {
      // Mod sync must never block the real multiplayer handshake. If the tunnel
      // or server mod endpoint is slow, join first and let the welcome/serverInfo
      // packet request the exact manifest after the socket is alive.
      void ModLoader.syncWithServer(firstHttpUrl).catch((err) => {
        console.warn('Server mod pre-sync skipped; joining anyway:', err);
      });
    }

    this.tryCurrentCandidate();
  }

  public disconnect(emitEvent: boolean = true): void {
    this.userRequestedDisconnect = emitEvent;
    this.clearTimers();
    this.clearHandshakeTimeout();
    if (emitEvent) this.clearReconnectTimeout();

    const oldWs = this.ws;
    this.ws = null;
    this.isConnecting = false;
    this.isConnected = false;
    this.lastMove = null;
    this.lastCrouchSent = null;
    this.isMobAuthority = false;

    if (oldWs) {
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      if (oldWs.readyState === WebSocket.OPEN || oldWs.readyState === WebSocket.CONNECTING) {
        oldWs.close();
      }
    }

    this.myPlayerIndex = -1;
    this.playerIndexToUuid.clear();
    this.entityManager.clearRemotePlayers();

    if (emitEvent) {
      EventBus.emit('network:disconnected', { explicit: true, userRequested: true, reconnectable: false });
      this.emitStatus('disconnected', 'Disconnected from server.');
    }
  }

  private tryCurrentCandidate(): void {
    const candidate = this.connectCandidates[this.connectAttempt];
    if (!candidate) {
      this.failConnection('Cannot reach server. Check the IP/port and make sure the Node WebSocket server is running.');
      return;
    }

    this.currentUrl = candidate.url;
    this.emitStatus(this.connectAttempt === 0 ? 'connecting' : 'retrying', `Connecting to ${candidate.label}...`);

    try {
      this.isConnecting = true;
      const ws: WebSocket = new WebSocket(candidate.url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => this.handleOpen();
      ws.onmessage = (e: MessageEvent) => this.handleMessage(e);
      ws.onclose = (event: CloseEvent) => this.handleClose(event);
      ws.onerror = () => {
        // Browsers hide most WebSocket error details for security, so the close
        // handler does the actual retry/failure reporting.
        this.emitStatus('retrying', `Could not reach ${candidate.label}. Trying another address...`);
      };

      this.connectTimeout = window.setTimeout(() => {
        if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) {
          this.emitStatus('retrying', `Timed out connecting to ${candidate.label}.`);
          ws.close();
        }
      }, 12000);
    } catch (e) {
      console.error('Connection failed:', e);
      this.advanceToNextCandidate();
    }
  }

  private handleOpen(): void {
    this.userRequestedDisconnect = false;
    this.clearConnectTimeout();
    this.clearHandshakeTimeout();
    this.isConnected = true;
    this.isConnecting = false;
    this.welcomeReceived = false;
    this.connectAttempt = 0;
    this.reconnectAttempts = 0;
    this.lastStableUrl = this.currentUrl;
    this.clearReconnectTimeout();
    EventBus.emit('network:connected', { url: this.currentUrl });
    this.emitStatus('connecting', `Socket open. Waiting for CubeGame welcome from ${this.currentUrl}...`);

    this.handshakeTimeout = window.setTimeout(() => {
      if (this.ws && this.isConnected && !this.welcomeReceived) {
        const stuckUrl = this.currentUrl;
        this.emitStatus('failed', `Connected to ${stuckUrl}, but it did not answer with a CubeGame welcome packet.`);
        const closing = this.ws;
        this.ws = null;
        this.isConnected = false;
        this.isConnecting = false;
        try { closing.close(); } catch {}
        this.failConnection('Server connection opened, but CubeGame handshake never arrived. Make sure the pasted loca.lt link points to the Node server port printed by npm run server, not the Vite page or another app.');
      }
    }, 8000);

    this.sendIdentity();
    this.safeSendJson({ type: 'timeRequest' });
    this.safeSendJson({ type: 'syncRequest' });
    this.syncLocalPlayerState(true);

    this.sendPing();

    // Movement synchronization loop. 20Hz + dead-reckoning/interpolation on the
    // receiver side looks smooth without hammering the server.
    this.sendMoveInterval = window.setInterval(() => {
      this.syncLocalMovement();
    }, this.moveSendMs);

    this.sendMobInterval = window.setInterval(() => {
      this.syncLocalMobs();
    }, 150);
  }

  private handleClose(event?: CloseEvent): void {
    this.clearConnectTimeout();
    this.clearHandshakeTimeout();

    const wasConnected = this.isConnected;
    const hadWelcome = this.welcomeReceived;
    const explicitDisconnect = this.userRequestedDisconnect;
    this.isConnected = false;
    this.isConnecting = false;
    this.ws = null;

    if ((!wasConnected || !hadWelcome) && this.connectCandidates.length > 0) {
      if (this.connectAttempt + 1 < this.connectCandidates.length) {
        this.advanceToNextCandidate();
      } else {
        const detail = event ? ` WebSocket closed with code ${event.code || 'unknown'}${event.reason ? ` (${event.reason})` : ''}.` : '';
        this.failConnection(`Could not complete the real CubeGame server handshake.${detail}`);
      }
      return;
    }

    this.clearLiveIntervals();

    if (explicitDisconnect) {
      this.myPlayerIndex = -1;
      this.playerIndexToUuid.clear();
      this.entityManager.clearRemotePlayers();
      EventBus.emit('network:disconnected', { explicit: true, userRequested: true, reconnectable: false });
      this.emitStatus('disconnected', 'Disconnected from server.');
    } else {
      EventBus.emit('network:connectionLost', { explicit: false, userRequested: false, reconnectable: true, url: this.currentUrl });
      EventBus.emit('network:chat', '[Network] Connection lost. Staying in-world and reconnecting automatically...');
      this.emitStatus('retrying', 'Connection lost; reconnecting without returning to the main menu.');
      this.scheduleReconnect();
    }
    this.userRequestedDisconnect = false;
  }

  private advanceToNextCandidate(): void {
    this.clearConnectTimeout();
    this.connectAttempt++;

    if (this.connectAttempt < this.connectCandidates.length) {
      window.setTimeout(() => this.tryCurrentCandidate(), 250);
    } else if (this.reconnectAttempts > 0 && !this.userRequestedDisconnect) {
      this.clearLiveIntervals();
      this.emitStatus('retrying', 'Reconnect attempt failed; waiting before trying again.');
      this.scheduleReconnect();
    } else {
      this.failConnection('Cannot reach server. Use something like 192.168.1.50:8080, localhost:8080, or wss://your-domain.com/ws.');
    }
  }

  private failConnection(reason: string): void {
    this.userRequestedDisconnect = false;
    this.clearTimers();
    this.clearHandshakeTimeout();
    this.clearReconnectTimeout();
    this.isConnecting = false;
    this.isConnected = false;
    this.ws = null;
    EventBus.emit('network:error', { message: reason, tried: this.connectCandidates.map(c => c.url) });
    this.emitStatus('failed', reason);
  }

  private scheduleReconnect(): void {
    if (this.userRequestedDisconnect) return;
    if (this.reconnectTimeout !== null) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      EventBus.emit('network:error', { message: 'Lost connection and automatic reconnect gave up.' });
      this.emitStatus('failed', 'Automatic reconnect gave up. Use Multiplayer to join again.');
      return;
    }

    const baseUrl = this.lastStableUrl || this.currentUrl;
    if (!baseUrl) return;

    const attempt = this.reconnectAttempts++;
    const jitter = Math.floor(Math.random() * 220);
    const delay = Math.min(8000, this.reconnectBaseDelayMs * Math.pow(1.65, attempt) + jitter);
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.userRequestedDisconnect || this.isConnected || this.isConnecting) return;
      this.connectCandidates = this.buildConnectionCandidates(baseUrl, this.wantedRoomId, this.wantedUsername);
      this.connectAttempt = 0;
      this.emitStatus('retrying', `Reconnect attempt ${attempt + 1}/${this.maxReconnectAttempts}...`);
      this.tryCurrentCandidate();
    }, delay);
  }

  private applyPlayersList(players: any[]): void {
    for (const item of players) {
      const id = String(item.uuid || '');
      if (!id || id === this.myUuid) continue;
      const index = Number(item.index);
      if (Number.isFinite(index)) this.playerIndexToUuid.set(index, id);
      if (!this.entityManager.remotePlayers.has(id)) {
        this.entityManager.spawnRemotePlayer(id, item.username || `Guest ${id.substring(0, 4)}`);
        (window as any).gameVoiceChatManager?.onRemotePlayerJoined?.(id);
      }
      if (item.skinDataUrl) this.entityManager.setRemotePlayerSkin(id, String(item.skinDataUrl));
      const m = item.lastMove;
      if (m && Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.z)) {
        this.entityManager.updateRemotePlayer(
          id,
          new THREE.Vector3(Number(m.x), Number(m.y), Number(m.z)),
          Number(m.yaw || 0),
          Number(m.pitch || 0),
          Number(m.heldItemId || 0)
        );
      }
    }
  }

  private cleanupSelfRemoteAliases(): void {
    if (this.myUuid) this.entityManager.removeRemotePlayer(this.myUuid);
    if (this.myPlayerIndex >= 0) this.entityManager.removeRemotePlayer(`player_${this.myPlayerIndex}`);
  }

  private isMoveFromLocalPlayer(index: number): boolean {
    return this.myPlayerIndex >= 0 && index === this.myPlayerIndex;
  }

  private handleMessage(e: MessageEvent): void {
    const data = e.data;

    // 1. Parse Binary Packets
    if (data instanceof ArrayBuffer) {
      if (data.byteLength < 1) return;

      const view = new DataView(data);
      const type = view.getUint8(0);

      if (type === PacketType.PlayerMove) {
        if (data.byteLength < 23) return;

        const moveData = BinaryProtocol.decodeServerPlayerMove(data);
        if (this.isMoveFromLocalPlayer(moveData.index)) {
          this.entityManager.removeRemotePlayer(`player_${moveData.index}`);
          return;
        }

        const uuid = this.playerIndexToUuid.get(moveData.index) || `player_${moveData.index}`;
        if (uuid === this.myUuid || (this.myPlayerIndex >= 0 && uuid === `player_${this.myPlayerIndex}`)) {
          this.cleanupSelfRemoteAliases();
          return;
        }

        const pos = new THREE.Vector3(moveData.x, moveData.y, moveData.z);
        const local = (window as any).gamePlayerController;
        const localPos = local?.getPosition?.();
        if (uuid.startsWith('player_') && localPos && pos.distanceTo(localPos) < 0.35) {
          this.entityManager.removeRemotePlayer(uuid);
          return;
        }

        if (!this.entityManager.remotePlayers.has(uuid)) {
          this.entityManager.spawnRemotePlayer(uuid, `Guest ${moveData.index}`);
          (window as any).gameVoiceChatManager?.onRemotePlayerJoined?.(uuid);
        }

        this.entityManager.updateRemotePlayer(
          uuid,
          pos,
          moveData.yaw,
          moveData.pitch,
          moveData.heldItemId
        );
      }

      else if (type === PacketType.BlockEdit) {
        if (data.byteLength < BinaryProtocol.BLOCK_EDIT_BYTES) return;

        const edit = BinaryProtocol.decodeBlockEdit(data);
        // Persist server-originated edits into the local multiplayer cache, but
        // do not emit world:blockChanged or the client would echo the packet.
        this.worldManager.setVoxel(edit.x, edit.y, edit.z, edit.blockId, true, false);
      }

      else if (type === PacketType.TimeSync) {
        const timeData = BinaryProtocol.decodeTimeSync(data);
        this.applyTimeSync(timeData.timeOfDay);
      }

      else if (type === PacketType.ServerSnapshot) {
        const snapshot = BinaryProtocol.decodeServerSnapshot(data);
        this.applyTimeSync(snapshot.timeOfDay);
      }
    }

    // 2. Parse JSON/Text Packets (Handshakes, chat, leave messages, server info)
    else if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);

        if (msg.type === 'welcome') {
          this.welcomeReceived = true;
          this.clearHandshakeTimeout();
          this.emitStatus('connected', `Joined ${msg.room || this.wantedRoomId || 'server'} on ${this.currentUrl}`);
          this.myUuid = msg.uuid;
          this.isMobAuthority = !msg.mobAuthorityUuid || msg.mobAuthorityUuid === this.myUuid;
          if (typeof msg.index === 'number') {
            this.myPlayerIndex = msg.index;
            this.playerIndexToUuid.set(msg.index, msg.uuid);
            this.cleanupSelfRemoteAliases();
          }

          if (typeof msg.timeOfDay === 'number') {
            this.applyTimeSync(msg.timeOfDay);
          }
          if (msg.meta?.dimension) {
            const meta = { ...(msg.meta || {}) };
            const cbgoMap = String(msg.matchState?.cbgoMap || meta.matchState?.cbgoMap || '').trim();
            const cbgoPhase = String(msg.matchState?.cbgoPhase || meta.matchState?.cbgoPhase || '').trim();
            const activeCbgoDimension = meta.minigameId === 'csgo'
              && meta.dimension === 'cbgo_menu'
              && /^cbgo_/.test(cbgoMap)
              && !['', 'MENU', 'PREGAME', 'POSTGAME', 'VETO'].includes(cbgoPhase)
              ? cbgoMap
              : meta.dimension;
            meta.dimension = activeCbgoDimension;
            this.applyServerMode({
              ...msg,
              meta,
              dimension: activeCbgoDimension,
              spawn: msg.spawn || meta.spawn || this.defaultSpawnForDimension(activeCbgoDimension),
              forceSpawn: false,
              message: msg.message || meta.motd || ''
            }, false);
          }
          if (Array.isArray(msg.playersList)) this.applyPlayersList(msg.playersList);
          if (msg.modManifest) void this.syncServerMods(msg.modManifest);

          EventBus.emit('network:chat', `Connected! Assigned ID: ${this.myUuid.substring(0, 5)}`);
          EventBus.emit('network:welcome', msg);
          this.safeSendJson({ type: 'timeRequest' });
        }

        else if (msg.type === 'join') {
          const id = msg.uuid;
          if (typeof msg.index === 'number') {
            this.playerIndexToUuid.set(msg.index, id);
          }
          if (id === this.myUuid || (typeof msg.index === 'number' && msg.index === this.myPlayerIndex)) {
            this.cleanupSelfRemoteAliases();
            return;
          }
          EventBus.emit('network:chat', `${msg.username || id.substring(0, 5)} joined the room.`);
          if (!this.entityManager.remotePlayers.has(id)) {
            this.entityManager.spawnRemotePlayer(id, msg.username || `Guest ${id.substring(0, 4)}`);
            (window as any).gameVoiceChatManager?.onRemotePlayerJoined?.(id);
          }
          if (msg.skinDataUrl) {
            this.entityManager.setRemotePlayerSkin(id, msg.skinDataUrl);
          }
        }

        else if (msg.type === 'leave') {
          const id = msg.uuid;
          for (const [index, uuid] of this.playerIndexToUuid.entries()) {
            if (uuid === id) this.playerIndexToUuid.delete(index);
          }
          EventBus.emit('network:chat', `Player left the room.`);
          this.entityManager.removeRemotePlayer(id);
          (window as any).gameVoiceChatManager?.onRemotePlayerLeft?.(id);
        }

        else if (msg.type === 'chat') {
          EventBus.emit('network:chat', `${msg.sender}: ${msg.text}`);
        }

        else if (msg.type === 'banned') {
          const reason = String(msg.reason || 'Anti-cheat violation');
          EventBus.emit('network:chat', `[AntiCheat] Banned: ${reason}`);
          EventBus.emit('network:error', { message: `Banned from server: ${reason}` });
          this.disconnect();
        }

        else if (msg.type === 'pong') {
          this.ping = Math.round(performance.now() - this.lastPingTime);
          EventBus.emit('network:ping', this.ping);
          this.clearPingTimeout();
          this.pingTimeout = window.setTimeout(() => {
            this.pingTimeout = null;
            this.sendPing();
          }, 4000);
        }

        else if (msg.type === 'timeSync' && typeof msg.timeOfDay === 'number') {
          this.applyTimeSync(msg.timeOfDay);
        }

        else if (msg.type === 'serverList' || msg.type === 'servers') {
          EventBus.emit('network:servers', msg.servers || []);
        }

        else if (msg.type === 'serverInfo') {
          if (msg.mobAuthorityUuid) this.isMobAuthority = msg.mobAuthorityUuid === this.myUuid;
          if (Array.isArray(msg.playersList)) this.applyPlayersList(msg.playersList);
          EventBus.emit('network:serverInfo', msg);
          if (typeof msg.timeOfDay === 'number') {
            this.applyTimeSync(msg.timeOfDay);
          }
          if (msg.meta?.dimension) {
            this.applyServerMode({
              ...msg,
              dimension: msg.meta.dimension,
              spawn: msg.spawn || msg.meta.spawn || this.defaultSpawnForDimension(msg.meta.dimension),
              forceSpawn: false,
              message: msg.message || msg.meta.motd || ''
            }, false);
          }
          if (msg.weather?.weather) {
            const sky = (window as any).gameSkySystem;
            if (sky) {
              sky.weatherState = msg.weather.weather;
              sky.weatherTimer = 999999;
            }
          }
          if (msg.modManifest) void this.syncServerMods(msg.modManifest);
        }

        else if (msg.type === 'modManifest') {
          if (msg.required) void this.syncServerMods(msg.required);
        }

        else if (msg.type === 'serverJump') {
          this.wantedRoomId = String(msg.room || this.wantedRoomId || '');
          this.applyServerMode({ ...msg, forceSpawn: true }, false);
          this.safeSendJson({ type: 'syncRequest' });
        }

        else if (msg.type === 'crownforgeMatch') {
          const meta = { ...(msg.meta || {}), matchState: msg.matchState || msg.meta?.matchState };
          const cbgoPhase = String(msg.matchState?.cbgoPhase || meta.matchState?.cbgoPhase || '').trim();
          const cbgoMap = String(msg.matchState?.cbgoMap || meta.matchState?.cbgoMap || '').trim();
          if (meta.minigameId === 'csgo' && meta.dimension === 'cbgo_menu' && cbgoPhase === 'VETO') {
            return;
          }
          if (
            meta.minigameId === 'csgo'
            && meta.dimension === 'cbgo_menu'
            && /^cbgo_/.test(cbgoMap)
            && !['', 'MENU', 'PREGAME', 'POSTGAME', 'VETO'].includes(cbgoPhase)
          ) {
            meta.dimension = cbgoMap;
          }
          EventBus.emit('network:serverMode', {
            room: msg.room,
            dimension: meta.dimension,
            matchPhase: msg.matchPhase,
            matchState: msg.matchState,
            meta,
            message: msg.matchState?.nextEvent ? `Next event: ${msg.matchState.nextEvent}` : ''
          });
        }

        else if (msg.type === 'itemDrop') {
          this.applyRemoteItemDrop(msg);
        }

        else if (msg.type === 'itemPickup') {
          this.applyRemoteItemPickup(msg);
        }

        else if (msg.type === 'blockBreakProgress') {
          if (msg.uuid !== this.myUuid) EventBus.emit('network:blockBreakProgressRemote', msg);
        }

        else if (msg.type === 'mobSnapshot') {
          if (msg.uuid !== this.myUuid && Array.isArray(msg.mobs)) {
            (this.entityManager as any).applyRemoteMobSnapshot?.(msg.mobs);
          }
        }

        else if (msg.type === 'modPacket') {
          if (typeof msg.channel === 'string') {
            NetworkRegistry.receive(msg.channel, msg.payload, { uuid: msg.uuid, username: msg.username });
          }
        }

        else if (msg.type === 'playerDamage') {
          if (msg.targetUuid === this.myUuid) {
            const pc = (window as any).gamePlayerController;
            if (pc) {
              pc.takeDamage(msg.damage, 'pvp');
            }
          } else {
            this.entityManager.flashPlayer(msg.targetUuid);
            const targetPlayer = this.entityManager.remotePlayers.get(msg.targetUuid);
            if (targetPlayer) {
              const bloodPos = targetPlayer.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0));
              EventBus.emit('particles:spawn', bloodPos, 337, 12);
            }
          }
          AudioManager.playPlayerHit();
        }

        else if (msg.type === 'cbgoShot') {
          EventBus.emit('cbgo:shotRemote', msg);
          if (msg.targetUuid === this.myUuid) {
            const pc = (window as any).gamePlayerController;
            pc?.takeDamage?.(Number(msg.damage || 0), 'pvp');
          } else if (msg.targetUuid) {
            this.entityManager.flashPlayer(msg.targetUuid);
          }
        }

        else if (msg.type === 'cbgoQuickPlayStarted' || msg.type === 'cbgoEconomy' || msg.type === 'cbgoDeath' || msg.type === 'cbgoRoundEnd' || msg.type === 'cbgoObjective') {
          EventBus.emit(`network:${msg.type}`, msg);
        }

        else if (msg.type === 'playerHealth') {
          const rPlayer = this.entityManager.remotePlayers.get(msg.uuid);
          if (rPlayer) {
            rPlayer.entity.health = msg.health;
            this.entityManager.updatePlayerNameTag(rPlayer.mesh, rPlayer.entity.username, msg.health);
            if (Number(msg.health) <= 0) {
              (this.entityManager as any).markRemotePlayerDead?.(msg.uuid);
            } else {
              (this.entityManager as any).reviveRemotePlayer?.(msg.uuid);
            }
          }
        }

        else if (msg.type === 'playerState') {
          if (msg.uuid && msg.uuid !== this.myUuid) {
            if (!this.entityManager.remotePlayers.has(msg.uuid)) {
              this.entityManager.spawnRemotePlayer(msg.uuid, msg.username || `Guest ${String(msg.uuid).substring(0, 4)}`);
              (window as any).gameVoiceChatManager?.onRemotePlayerJoined?.(msg.uuid);
            }
            (this.entityManager as any).setRemotePlayerState?.(msg.uuid, {
              crouching: !!msg.crouching,
              sprinting: !!msg.sprinting,
              moving: !!msg.moving,
              punching: !!msg.punching,
              invisible: !!msg.invisible
            });
          }
        }

        else if (msg.type === 'playerAction') {
          if (msg.uuid && msg.uuid !== this.myUuid) {
            if (!this.entityManager.remotePlayers.has(msg.uuid)) {
              this.entityManager.spawnRemotePlayer(msg.uuid, msg.username || `Guest ${String(msg.uuid).substring(0, 4)}`);
              (window as any).gameVoiceChatManager?.onRemotePlayerJoined?.(msg.uuid);
            }
            (this.entityManager as any).playRemotePlayerAction?.(msg.uuid, String(msg.action || ''));
          }
        }

        else if (msg.type === 'weatherSync') {
          const sky = (window as any).gameSkySystem;
          if (sky) {
            sky.weatherState = msg.weather;
            sky.weatherTimer = 999999;
          }
        }

        else if (msg.type === 'voiceSignal') {
          EventBus.emit('network:voice:signal', msg);
        }

        else if (msg.type === 'mobDamage') {
          if (this.isMobAuthority) {
            this.entityManager.damageMob(msg.mobId, msg.damage);
          }
        }

        else if (msg.type === 'skin' && msg.uuid && msg.uuid !== this.myUuid && msg.skinDataUrl) {
          if (!this.entityManager.remotePlayers.has(msg.uuid)) {
            this.entityManager.spawnRemotePlayer(msg.uuid, msg.username || `Guest ${String(msg.uuid).substring(0, 4)}`);
            (window as any).gameVoiceChatManager?.onRemotePlayerJoined?.(msg.uuid);
          }
          this.entityManager.setRemotePlayerSkin(msg.uuid, msg.skinDataUrl);
        }
      } catch (e) {
        console.error('Error parsing JSON packet:', e);
      }
    }
  }

  // OUTBOUND TRANSMISSIONS
  private syncLocalMovement(): void {
    if (!this.canSend()) return;

    const player = (window as any).gamePlayerController;
    const camera = (window as any).gameCameraController;
    if (!player || !camera || !player.position) return;

    const now = performance.now();
    const x = player.position.x;
    const y = player.position.y;
    const z = player.position.z;
    const yaw = camera.yaw || 0;
    const pitch = camera.pitch || 0;

    if (this.lastMove) {
      const dx = x - this.lastMove.x;
      const dy = y - this.lastMove.y;
      const dz = z - this.lastMove.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const yawDelta = Math.abs(yaw - this.lastMove.yaw);
      const pitchDelta = Math.abs(pitch - this.lastMove.pitch);
      const heartbeatDue = now - this.lastMove.sentAt > this.forcedMoveHeartbeatMs;

      // Don't send identical packets every tick. This is a big server CPU/bandwidth save.
      if (!heartbeatDue && distSq < 0.0001 && yawDelta < 0.002 && pitchDelta < 0.002) {
        return;
      }
    }

    const heldItemId = player.getHeldItemId ? player.getHeldItemId() : 0;
    const buffer = BinaryProtocol.encodePlayerMove(x, y, z, yaw, pitch, heldItemId);
    if (this.safeSend(buffer)) {
      this.lastMove = { x, y, z, yaw, pitch, sentAt: now };
    }
    this.syncLocalPlayerState(false);
  }

  private syncLocalPlayerState(force: boolean): void {
    if (!this.canSend()) return;

    const player = (window as any).gamePlayerController;
    const velocity = player?.velocity;
    const crouching = !!player?.isCrouching;
    const sprinting = !!player?.isSprinting;
    const moving = !!velocity && ((velocity.x * velocity.x + velocity.z * velocity.z) > 0.006);
    const punching = InputManager.isActionDown('attack');
    const invisible = player?.activeEffects ? player.activeEffects.has('invisibility') : false;
    const now = performance.now();
    const punchRefresh = punching && now - this.lastPunchStateSentAt > 130;
    const signature = `${crouching ? 1 : 0}:${sprinting ? 1 : 0}:${moving ? 1 : 0}:${punching ? 1 : 0}:${invisible ? 1 : 0}`;
    if (!force && this.lastPlayerStateSignature === signature && !punchRefresh) return;

    this.lastCrouchSent = crouching;
    this.lastPlayerStateSignature = signature;
    if (punching) this.lastPunchStateSentAt = now;
    this.safeSendJson({
      type: 'playerState',
      crouching,
      sprinting,
      moving,
      punching,
      invisible,
    });
  }

  private sendPlayerAction(action: 'punch'): void {
    if (!this.canSend()) return;
    const now = performance.now();
    if (action === 'punch' && now - this.lastPunchSentAt < 95) return;
    this.lastPunchSentAt = now;
    this.safeSendJson({ type: 'playerAction', action });
  }

  private sendBlockEdit(x: number, y: number, z: number, blockId: number): void {
    if (!this.canSend()) return;

    const buffer = BinaryProtocol.encodeBlockEdit(x, y, z, blockId);
    this.safeSend(buffer);
  }

  private sendItemDrop(data: any): void {
    if (!this.canSend() || !data) return;

    const itemId = Number(data.itemId);
    const count = Number(data.count ?? 1);
    const x = Number(data.x);
    const y = Number(data.y);
    const z = Number(data.z);
    const vx = Number(data.vx ?? 0);
    const vy = Number(data.vy ?? 0);
    const vz = Number(data.vz ?? 0);
    const id = String(data.id || '');

    if (!id || !Number.isFinite(itemId) || !Number.isFinite(count) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;

    this.safeSendJson({
      type: 'itemDrop',
      id,
      itemId: Math.max(0, Math.min(65535, Math.floor(itemId))),
      count: Math.max(1, Math.min(999, Math.floor(count))),
      x,
      y,
      z,
      vx: Number.isFinite(vx) ? vx : 0,
      vy: Number.isFinite(vy) ? vy : 0,
      vz: Number.isFinite(vz) ? vz : 0,
    });
  }

  private sendItemPickup(data: any): void {
    if (!this.canSend() || !data?.id) return;
    this.safeSendJson({ type: 'itemPickup', id: String(data.id).slice(0, 64) });
  }

  private sendBlockBreakProgress(data: any): void {
    if (!this.canSend() || !data) return;

    const stage = Math.max(0, Math.min(6, Math.floor(Number(data.stage ?? 0))));
    const x = Math.floor(Number(data.x ?? 0));
    const y = Math.floor(Number(data.y ?? 0));
    const z = Math.floor(Number(data.z ?? 0));
    const key = `${x},${y},${z},${stage}`;
    const now = performance.now();
    if (key === this.lastBreakProgressKey && now - this.lastBreakProgressSentAt < 120) return;
    this.lastBreakProgressKey = key;
    this.lastBreakProgressSentAt = now;

    this.safeSendJson({ type: 'blockBreakProgress', x, y, z, stage });
  }

  private syncLocalMobs(): void {
    if (!this.canSend() || !this.isMobAuthority) return;
    const getStates = (this.entityManager as any).getMobNetworkStates;
    if (typeof getStates !== 'function') return;

    const mobs = getStates.call(this.entityManager, 96);
    if (!Array.isArray(mobs) || mobs.length === 0) return;
    this.safeSendJson({ type: 'mobSnapshot', mobs });
  }

  private sendModPacket(data: any): void {
    if (!this.canSend() || !data?.channel) return;
    this.safeSendJson({
      type: 'modPacket',
      channel: String(data.channel).slice(0, 96),
      payload: data.payload ?? null,
    });
  }

  private sendVoiceSignal(data: any): void {
    if (!this.canSend() || !data?.toUuid || !data?.kind) return;
    this.safeSendJson({
      type: 'voiceSignal',
      toUuid: String(data.toUuid),
      kind: String(data.kind),
      payload: data.payload ?? null,
    });
  }

  private sendChat(text: string): void {
    if (!this.canSend()) return;

    const cleanText = String(text || '').trim().slice(0, 256);
    if (!cleanText) return;
    const lower = cleanText.toLowerCase();
    if (lower === '/voice' || lower === '/voice on' || lower === '/voicechat' || lower === '/voicechat on') {
      EventBus.emit('network:voice:start');
      return;
    }
    if (lower === '/voice off' || lower === '/voicechat off' || lower === '/mutevoice') {
      EventBus.emit('network:voice:stop');
      EventBus.emit('network:chat', '[Voice] Proximity voice chat disabled.');
      return;
    }

    this.safeSendJson({
      type: 'chat',
      text: cleanText
    });
  }

  private sendPing(): void {
    if (!this.canSend()) return;

    this.lastPingTime = performance.now();
    this.safeSendJson({ type: 'ping', t: Date.now() });
  }

  private async sendIdentity(): Promise<void> {
    const skinDataUrl = await StorageManager.getGlobalData<string>('player_skin_data_url', '');
    this.safeSendJson({
      type: 'hello',
      client: 'voxel-sandbox',
      protocol: BinaryProtocol.PROTOCOL_VERSION,
      username: this.wantedUsername || undefined,
      resumeUuid: this.myUuid || undefined,
      room: this.wantedRoomId || undefined,
      skinDataUrl: skinDataUrl || createDefaultSteveSkinDataUrl() || undefined,
      mods: ModLoader.getLoadedManifest(),
    });
  }

  private async syncServerMods(manifest: any): Promise<void> {
    const httpUrl = PlatformRuntime.webSocketToHttpUrl(this.currentUrl);
    if (!httpUrl) return;

    try {
      await ModLoader.syncWithServer(httpUrl, manifest);
      EventBus.emit('network:chat', '[Mods] Server mod manifest synced.');
    } catch (err) {
      console.error('Server mod manifest sync failed:', err);
      EventBus.emit('network:error', { message: 'Failed to sync required server mods.' });
    }
  }

  private sendSkin(skinDataUrl: string): void {
    if (!this.canSend() || !skinDataUrl) return;

    this.safeSendJson({
      type: 'skin',
      username: this.wantedUsername || undefined,
      skinDataUrl,
    });
  }

  public sendTimeSync(timeOfDay: number): void {
    if (!this.canSend()) return;

    const buffer = BinaryProtocol.encodeTimeSync(timeOfDay, Date.now());
    this.safeSend(buffer);
  }

  private applyServerMode(msg: any, reconnect: boolean): void {
    const dimension = String(msg?.dimension || '').trim();
    if (!dimension) return;

    const spawn = msg?.spawn || this.defaultSpawnForDimension(dimension);

    if (msg?.message) EventBus.emit('network:chat', `[Server] ${msg.message}`);
    EventBus.emit('network:serverMode', {
      room: msg?.room,
      dimension,
      spawn,
      role: msg?.role,
      matchPhase: msg?.matchPhase || msg?.meta?.matchPhase,
      meta: msg?.meta,
      forceSpawn: Boolean(msg?.forceSpawn),
      title: msg?.title,
      message: msg?.message,
    });
    AudioManager.playTeleport();

    // Room transitions now happen on the existing server-side session. Reconnecting
    // here used to race the server and could dump the client into the menu sky or
    // a survival room while CrownForge was still assigning the match room.
    void reconnect;
  }

  private defaultSpawnForDimension(dimension: string): { x: number; y: number; z: number } {
    switch (dimension) {
      case 'survival_247': return { x: 8, y: 68, z: 8 };
      default: return crownForgeDefaultSpawnForDimension(dimension);
    }
  }

  private applyTimeSync(timeOfDay: number): void {
    if (!Number.isFinite(timeOfDay)) return;
    const normalized = ((timeOfDay % 1) + 1) % 1;

    this.applyingRemoteTime = true;
    EventBus.emit('command:time', normalized);
    EventBus.emit('network:timeSync', normalized);
    // Let other event handlers finish before we allow local time rebroadcasts.
    window.setTimeout(() => {
      this.applyingRemoteTime = false;
    }, 0);
  }

  private applyRemoteItemDrop(msg: any): void {
    const manager = (window as any).gameItemDropManager;
    if (!manager?.spawn || !msg?.id) return;

    const itemId = Number(msg.itemId);
    const count = Number(msg.count ?? 1);
    const x = Number(msg.x);
    const y = Number(msg.y);
    const z = Number(msg.z);
    if (!Number.isFinite(itemId) || !Number.isFinite(count) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;

    const velocity = new THREE.Vector3(
      Number.isFinite(Number(msg.vx)) ? Number(msg.vx) : 0,
      Number.isFinite(Number(msg.vy)) ? Number(msg.vy) : 0,
      Number.isFinite(Number(msg.vz)) ? Number(msg.vz) : 0,
    );

    manager.spawn(
      new THREE.Vector3(x, y, z),
      Math.max(0, Math.min(65535, Math.floor(itemId))),
      Math.max(1, Math.min(999, Math.floor(count))),
      { id: String(msg.id).slice(0, 64), velocity, network: false, pickupDelay: 1.0 }
    );
  }

  private applyRemoteItemPickup(msg: any): void {
    const manager = (window as any).gameItemDropManager;
    if (!manager?.removeById || !msg?.id) return;
    manager.removeById(String(msg.id).slice(0, 64));
  }

  private canSend(): boolean {
    return !!this.ws &&
      this.isConnected &&
      this.ws.readyState === WebSocket.OPEN &&
      this.ws.bufferedAmount < this.maxBufferedBytes;
  }

  private safeSend(data: string | ArrayBuffer): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (this.ws.bufferedAmount > this.maxBufferedBytes) return false;

    try {
      this.ws.send(data);
      return true;
    } catch (err) {
      console.error('WebSocket send failed:', err);
      return false;
    }
  }

  private safeSendJson(data: Record<string, any>): boolean {
    return this.safeSend(JSON.stringify(data));
  }

  private normalizeWebSocketUrl(input: string): string {
    const candidates = this.buildConnectionCandidates(input, '', '');
    return candidates[0]?.url || this.defaultWebSocketUrl();
  }

  private buildConnectionCandidates(input: string, roomId?: string, username?: string): ConnectionCandidate[] {
    const pageHost = window.location.hostname || 'localhost';
    const pagePort = window.location.port;
    const pageProtocol = window.location.protocol;
    const pageIsHttps = pageProtocol === 'https:';
    const pageIsLocal = pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '::1';
    const defaultWsScheme = pageIsHttps ? 'wss' : 'ws';
    const defaultPort = '8080';

    let raw = String(input || '').trim();

    // Fix the exact broken placeholder style that causes "ws:serverip:serverport".
    raw = raw
      .replace(/^wss?:serverip:serverport$/i, '')
      .replace(/^serverip:serverport$/i, '')
      .replace(/^server-ip:server-port$/i, '');

    if (!raw) {
      raw = pageIsLocal ? `${pageHost}:${defaultPort}` : window.location.host;
    }

    // Browser WebSocket URLs need ws:// or wss://. "ws:1.2.3.4:8080" is not a
    // useful address here, so repair it to "ws://1.2.3.4:8080".
    if (/^wss?:[^/]/i.test(raw)) {
      raw = raw.replace(/^wss?:/i, (scheme) => `${scheme}//`);
    }

    // Allow users/server-list buttons to pass http(s) URLs.
    if (/^http:\/\//i.test(raw)) raw = `ws://${raw.slice('http://'.length)}`;
    if (/^https:\/\//i.test(raw)) raw = `wss://${raw.slice('https://'.length)}`;

    if (!/^wss?:\/\//i.test(raw)) {
      const hostOnly = raw.split('/')[0].split('?')[0].replace(/:\d+$/, '');
      const tunnelHost = /\.(loca\.lt|localtunnel\.me)$/i.test(hostOnly);
      raw = `${tunnelHost ? 'wss' : defaultWsScheme}://${raw}`;
    }

    const built: ConnectionCandidate[] = [];
    const addCandidate = (urlText: string, label?: string) => {
      try {
        const url = new URL(urlText);

        if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return;

        // loca.lt/localtunnel public links are HTTPS tunnels. A native file:// app
        // otherwise guesses ws:// for bare hosts, which immediately fails with 1006.
        if (/\.(loca\.lt|localtunnel\.me)$/i.test(url.hostname)) {
          url.protocol = 'wss:';
          url.port = '';
        }

        // Fix server lists that ship placeholder hostnames.
        if (/^(serverip|server-ip|host|hostname)$/i.test(url.hostname)) {
          url.hostname = pageHost;
        }

        if (!url.port && !url.pathname.includes('/') && (pageIsLocal || url.protocol === 'ws:')) {
          url.port = defaultPort;
        }

        const finalUrl = this.withQuery(url.toString(), roomId, username);
        if (!built.some(c => c.url === finalUrl)) {
          built.push({ url: finalUrl, label: label || finalUrl });
        }
        // If a stale saved token breaks a public server join, retry the same real
        // server as a guest instead of showing a fake fallback world.
        if (this.authToken) {
          const guestUrl = new URL(finalUrl);
          guestUrl.searchParams.delete('token');
          const guestText = guestUrl.toString();
          if (!built.some(c => c.url === guestText)) {
            built.push({ url: guestText, label: `${label || guestText} (guest retry)` });
          }
        }
      } catch {
        // Try one more time with host:port parsing.
        const repaired = `${defaultWsScheme}://${urlText.replace(/^wss?:\/\//i, '')}`;
        try {
          const url = new URL(repaired);
          const finalUrl = this.withQuery(url.toString(), roomId, username);
          if (!built.some(c => c.url === finalUrl)) {
            built.push({ url: finalUrl, label: label || finalUrl });
          }
          if (this.authToken) {
            const guestUrl = new URL(finalUrl);
            guestUrl.searchParams.delete('token');
            const guestText = guestUrl.toString();
            if (!built.some(c => c.url === guestText)) {
              built.push({ url: guestText, label: `${label || guestText} (guest retry)` });
            }
          }
        } catch {
          // ignore invalid candidate
        }
      }
    };

    addCandidate(raw);

    // LAN convenience: if the webpage is served from a different machine and
    // the UI suggested localhost, also try the page host on the same port.
    try {
      const primary = new URL(raw);
      const isLoopback = primary.hostname === 'localhost' || primary.hostname === '127.0.0.1' || primary.hostname === '[::1]';
      const pageIsRemote = pageHost !== 'localhost' && pageHost !== '127.0.0.1' && pageHost !== '::1';

      if (isLoopback && pageIsRemote) {
        primary.hostname = pageHost;
        addCandidate(primary.toString(), `${pageHost}:${primary.port || defaultPort}`);
      }

      if (!primary.port && (pageIsLocal || primary.protocol === 'ws:')) {
        primary.port = defaultPort;
        addCandidate(primary.toString(), `${primary.hostname}:${defaultPort}`);
      }

      // When Vite/dev server is on 5173 and WS server is separate, try 8080 on
      // the same host as the page. This fixes a ton of "server list can't reach"
      // local/LAN setups.
      if (pageIsLocal && pagePort && pagePort !== defaultPort) {
        addCandidate(`${defaultWsScheme}://${pageHost}:${defaultPort}`, `${pageHost}:${defaultPort}`);
      }
    } catch {
      // no-op
    }

    return built;
  }

  private defaultWebSocketUrl(): string {
    // Check if user provided a server URL via the desktop startup modal.
    let modalUrl = (window as any).cubeGameServerUrl as string | undefined;
    if (!modalUrl) {
      try {
        modalUrl = window.localStorage?.getItem('cubegame_desktop_server_link') || undefined;
      } catch {
        modalUrl = undefined;
      }
    }
    if (modalUrl && /^https?:\/\//i.test(modalUrl)) {
      // Convert https://host -> wss://host, http://host -> ws://host
      const wsUrl = modalUrl.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://').replace(/\/+$/, '');
      return wsUrl;
    }
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname || 'localhost';
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return isLocal ? `${scheme}://${host}:8080` : `${scheme}://${window.location.host}`;
  }

  private withQuery(urlText: string, roomId?: string, username?: string): string {
    const url = new URL(urlText);
    if (roomId) {
      url.searchParams.set('room', roomId);
      url.searchParams.set('roomCode', roomId);
    }
    if (username) url.searchParams.set('username', username);
    if (this.authToken) url.searchParams.set('token', this.authToken);
    return url.toString();
  }

  private clearLiveIntervals(): void {
    this.clearPingTimeout();

    if (this.sendMoveInterval !== null) {
      window.clearInterval(this.sendMoveInterval);
      this.sendMoveInterval = null;
    }

    if (this.sendMobInterval !== null) {
      window.clearInterval(this.sendMobInterval);
      this.sendMobInterval = null;
    }
  }

  private clearTimers(): void {
    this.clearConnectTimeout();
    this.clearLiveIntervals();
  }

  private clearPingTimeout(): void {
    if (this.pingTimeout !== null) {
      window.clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeout !== null) {
      window.clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private clearHandshakeTimeout(): void {
    if (this.handshakeTimeout !== null) {
      window.clearTimeout(this.handshakeTimeout);
      this.handshakeTimeout = null;
    }
  }

  private emitStatus(status: ConnectionStatus, message: string): void {
    EventBus.emit('network:status', {
      status,
      message,
      url: this.currentUrl,
      tried: this.connectCandidates.map(c => c.url),
      ping: this.ping
    });
  }
}
