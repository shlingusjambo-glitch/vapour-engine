import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';
import { Renderer } from '../graphics/Renderer';
import { WorldManager } from '../world/WorldManager';
import { PlayerController } from '../player/PlayerController';
import { CameraController } from '../player/CameraController';
import { Inventory } from '../inventory/Inventory';
import { EntityManager } from '../entities/EntityManager';
import { HUD } from '../ui/HUD';
import { AudioManager } from '../audio/AudioManager';
import { CallOfBlockFramework } from './CallOfBlockFramework';
import { Vector3 as COBVector3 } from './core/Math';
import {
  AmmoStack,
  COBServerTransport,
  COBTeamId,
  MatchStatePayload,
  MatchTimerPayload,
  PlayerSession,
  PlayerSpawnPayload,
  VehicleStatePayload,
  cloneAmmo,
  createPlayerState,
} from './core/Models';
import { MatchState } from './match/MatchStateMachine';

interface COBTransportHandlers {
  timer(payload: MatchTimerPayload): void;
  match(payload: MatchStatePayload): void;
  spawn(payload: PlayerSpawnPayload): void;
  despawn(playerId: string, reason: string): void;
  vehicle(payload: VehicleStatePayload): void;
}

const COB_ASSAULT_RIFLE_ITEM_ID = 622;
const COB_RIFLE_AMMO_TYPE = 'rifle_556';
const COB_REMOTE_SYNC_INTERVAL_MS = 100;
const COB_RIFLE_FIRE_INTERVAL_MS = 110;
const COB_RIFLE_RELOAD_MS = 1450;
const COB_BASE_FOV_DEGREES = 75;

class LocalCOBTransport implements COBServerTransport {
  public constructor(private readonly handlers: COBTransportHandlers) {}

  public broadcastMatchTimer(payload: MatchTimerPayload): void {
    this.handlers.timer(payload);
    EventBus.emit('cob:network:timer', payload);
  }

  public broadcastMatchState(payload: MatchStatePayload): void {
    this.handlers.match(payload);
    EventBus.emit('cob:network:matchState', payload);
  }

  public broadcastPlayerSpawn(payload: PlayerSpawnPayload): void {
    this.handlers.spawn(payload);
    EventBus.emit('cob:network:playerSpawn', payload);
  }

  public broadcastPlayerDespawn(playerId: string, reason: string): void {
    this.handlers.despawn(playerId, reason);
    EventBus.emit('cob:network:playerDespawn', { playerId, reason });
  }

  public broadcastVehicleState(payload: VehicleStatePayload): void {
    this.handlers.vehicle(payload);
    EventBus.emit('cob:network:vehicleState', payload);
  }
}

export class COBGameMode {
  private readonly framework: CallOfBlockFramework;
  private readonly transport: LocalCOBTransport;
  private readonly remoteIds = new Set<string>();
  private localSession: PlayerSession | null = null;
  private active = false;
  private blockingGameplay = false;
  private lastTimerCountdownMs = 60_000;
  private lastStatusEmitAtMs = 0;
  private lastLocalSyncAtMs = 0;
  private lastRemoteSyncAtMs = 0;
  private lastShotAtMs = 0;
  private lastBotShotAudioAtMs = 0;
  private lastAmmoMessageAtMs = 0;
  private localSyncInFlight = false;
  private mapLoadRequestedFor = '';
  private mapLoadedFor = '';
  private lastMapLoadRequestAtMs = 0;
  private matchStartedEmittedFor = '';
  private rifleReloadCompletesAtMs = 0;
  private viewmodelRecoilKick = 0;
  private viewmodelRecoilSide = 0;
  private readonly skinnedRemoteIds = new Set<string>();
  private readonly teamSkinCache = new Map<COBTeamId, string>();

  public constructor(
    private readonly renderer: Renderer,
    private readonly worldManager: WorldManager,
    private readonly playerController: PlayerController,
    private readonly cameraController: CameraController,
    private readonly inventory: Inventory,
    private readonly entityManager: EntityManager,
    private readonly hud: HUD
  ) {
    this.transport = new LocalCOBTransport({
      timer: payload => this.handleTimer(payload),
      match: payload => this.handleMatchState(payload),
      spawn: payload => this.handlePlayerSpawn(payload),
      despawn: (playerId, reason) => this.handlePlayerDespawn(playerId, reason),
      vehicle: payload => this.handleVehicleState(payload),
    });
    this.framework = new CallOfBlockFramework(this.transport);
    EventBus.on('cob:mapLoaded', (payload?: any) => {
      const mapId = String(payload?.mapId || '');
      if (mapId) this.mapLoadedFor = mapId;
    });
    EventBus.on('mouse:leftClick', () => {
      void this.tryLocalFire();
    });
  }

  public async enterLobby(username: string): Promise<void> {
    const nowMs = Date.now();
    this.active = true;
    document.body.dataset.cobActive = 'true';
    this.blockingGameplay = true;
    this.lastTimerCountdownMs = 60_000;
    this.lastStatusEmitAtMs = 0;
    this.lastLocalSyncAtMs = 0;
    this.lastRemoteSyncAtMs = 0;
    this.mapLoadRequestedFor = '';
    this.mapLoadedFor = '';
    this.lastMapLoadRequestAtMs = 0;
    this.matchStartedEmittedFor = '';
    this.rifleReloadCompletesAtMs = 0;
    this.lastAmmoMessageAtMs = 0;
    this.viewmodelRecoilKick = 0;
    this.viewmodelRecoilSide = 0;
    this.remoteIds.clear();
    this.skinnedRemoteIds.clear();

    const local = createPlayerState('cob_local_player', username || 'Steve', COBTeamId.TeamA, false, nowMs);
    local.transform.position = this.toCOBVector(this.playerController.position);
    local.transform.rotation = new COBVector3(0, this.cameraController.yaw, this.cameraController.pitch);
    local.velocity = this.toCOBVector(this.playerController.velocity);
    local.health = this.playerController.health;
    local.connected = true;
    this.resetRifleAmmo(local.ammo);

    const warmupBot = createPlayerState('cob_lobby_opponent', 'COB Warmup Bot', COBTeamId.TeamB, true, nowMs);
    warmupBot.transform.position = new COBVector3(4, 74, 4);
    warmupBot.transform.rotation = new COBVector3(0, Math.PI, 0);
    warmupBot.connected = false;

    this.localSession = {
      id: local.id,
      state: local,
      clientSequence: 0,
      lastHeardAtMs: nowMs,
    };

    this.inventory.clearPlayerSlots(true);
    this.inventory.setSlot(this.inventory.getActiveSlotIndex(), { id: COB_ASSAULT_RIFLE_ITEM_ID, count: 1, customName: 'COB Assault Rifle' });
    this.renderer.updateHandMeshBlock(COB_ASSAULT_RIFLE_ITEM_ID);

    await this.framework.audioManager.initialize();
    await this.framework.InitializeLobby([
      this.localSession,
      { id: warmupBot.id, state: warmupBot, clientSequence: 0, lastHeardAtMs: nowMs },
    ], nowMs);

    this.hud.addChatMessage('[COB] Lobby initialized. Match starts when the countdown reaches zero.');
    this.emitStatus(this.framework.getSnapshot(nowMs), true);
  }

  public async leave(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    delete document.body.dataset.cobActive;
    this.blockingGameplay = false;
    this.localSession = null;
    this.mapLoadRequestedFor = '';
    this.mapLoadedFor = '';
    this.lastMapLoadRequestAtMs = 0;
    this.matchStartedEmittedFor = '';
    this.rifleReloadCompletesAtMs = 0;
    this.lastAmmoMessageAtMs = 0;
    this.viewmodelRecoilKick = 0;
    this.viewmodelRecoilSide = 0;
    this.framework.stop();
    await this.framework.shutdown();
    for (const id of Array.from(this.remoteIds)) {
      this.entityManager.removeRemotePlayer(id);
    }
    this.remoteIds.clear();
    this.skinnedRemoteIds.clear();
    this.entityManager.clearRemotePlayers();
    EventBus.emit('cob:closed');
  }

  public isActive(): boolean {
    return this.active;
  }

  public isBlockingGameplay(): boolean {
    return this.active && this.blockingGameplay;
  }

  public update(dtSeconds: number): void {
    if (!this.active) return;

    const nowMs = Date.now();
    const snapshot = this.framework.getSnapshot(nowMs);
    this.blockingGameplay = snapshot.state === MatchState.Lobby_Wait || snapshot.state === MatchState.Match_Loading;

    if (snapshot.mapId && this.shouldEnsureCombatMapLoaded(snapshot.state)) {
      this.requestCombatMapLoad(snapshot.mapId, nowMs);
    }

    if (snapshot.state === MatchState.Match_Active && this.matchStartedEmittedFor !== snapshot.mapId) {
      this.matchStartedEmittedFor = snapshot.mapId || 'active';
      this.blockingGameplay = false;
      EventBus.emit('cob:matchStarted', snapshot);
      this.hud.addChatMessage('[COB] Match active. First team to 100 kills wins.');
      InputManager.isUIActive = false;
      InputManager.lockPointer();
    }

    this.finishRifleReloadIfReady(nowMs);
    this.syncLocalSession(nowMs);
    if (nowMs - this.lastRemoteSyncAtMs >= COB_REMOTE_SYNC_INTERVAL_MS || snapshot.state === MatchState.Match_Loading) {
      this.lastRemoteSyncAtMs = nowMs;
      this.syncRemotePlayers(snapshot.sessions);
    }
    this.applyViewmodel(dtSeconds, nowMs);

    if (nowMs - this.lastStatusEmitAtMs >= 200 || this.blockingGameplay) {
      this.emitStatus(snapshot, false);
    }

    const botShots = this.framework.drainBotFireDecisions();
    const listener = this.toCOBVector(this.renderer.camera.getWorldPosition(new THREE.Vector3()));
    for (let i = 0; i < botShots.length; i++) {
      const shot = botShots[i];
      this.framework.audioManager.playSpatial('rifle_fire_02', shot.origin, listener, 82);
      const distanceToListener = shot.origin.distanceTo(listener);
      if (distanceToListener <= 92 && nowMs - this.lastBotShotAudioAtMs >= 90) {
        this.lastBotShotAudioAtMs = nowMs;
        AudioManager.playGunshot('rifle');
      }
      this.spawnTracer(this.toThreeVector(shot.origin), this.toThreeVector(shot.direction).normalize(), Math.min(44, Math.max(8, distanceToListener)), 0xffbe63, false);
    }
  }

  private handleTimer(payload: MatchTimerPayload): void {
    this.lastTimerCountdownMs = payload.countdownMs;
    this.emitStatus(this.framework.getSnapshot(payload.serverNowMs), true);
  }

  private handleMatchState(payload: MatchStatePayload): void {
    if (payload.mapId && this.shouldEnsureCombatMapLoaded(payload.state)) {
      this.requestCombatMapLoad(payload.mapId, payload.serverNowMs || Date.now());
    }
  }

  private handlePlayerSpawn(payload: PlayerSpawnPayload): void {
    if (payload.playerId === this.localSession?.id) {
      const spawn = this.toThreeVector(payload.transform.position);
      this.playerController.position.copy(spawn);
      this.playerController.velocity.set(0, 0, 0);
      this.playerController.grounded = false;
      this.playerController.health = Math.max(1, payload.health);
      this.localSession.state.ammo = cloneAmmo(payload.ammo);
      this.rifleReloadCompletesAtMs = 0;
      this.cameraController.resetView(payload.transform.rotation.y, payload.transform.rotation.x);
      EventBus.emit('player:healthChanged', this.playerController.health);
      return;
    }
    if (!this.remoteIds.has(payload.playerId) || !this.entityManager.hasRemotePlayer(payload.playerId)) {
      this.entityManager.spawnRemotePlayer(payload.playerId, payload.isBot ? 'COB Bot' : payload.playerId);
      this.remoteIds.add(payload.playerId);
      this.skinnedRemoteIds.delete(payload.playerId);
    }
    this.applyRemoteTeamSkin(payload.playerId, payload.teamId);
    const pos = this.toThreeVector(payload.transform.position);
    this.entityManager.updateRemotePlayer(payload.playerId, pos, payload.transform.rotation.y, payload.transform.rotation.x, COB_ASSAULT_RIFLE_ITEM_ID);
    this.entityManager.reviveRemotePlayer(payload.playerId);
  }

  private handlePlayerDespawn(playerId: string, _reason: string): void {
    if (playerId === this.localSession?.id) return;
    this.entityManager.removeRemotePlayer(playerId);
    this.remoteIds.delete(playerId);
    this.skinnedRemoteIds.delete(playerId);
  }

  private handleVehicleState(_payload: VehicleStatePayload): void {
    // Vehicle payloads are exposed over cob:network:vehicleState for future render bindings.
  }

  private shouldEnsureCombatMapLoaded(state: string): boolean {
    return state === MatchState.Match_Loading
      || state === MatchState.Match_Active
      || state === MatchState.Match_SuddenDeath;
  }

  private requestCombatMapLoad(mapId: string, nowMs: number): void {
    if (!mapId || this.mapLoadedFor === mapId) return;
    if (this.mapLoadRequestedFor === mapId && nowMs - this.lastMapLoadRequestAtMs < 1000) return;
    this.mapLoadRequestedFor = mapId;
    this.lastMapLoadRequestAtMs = nowMs;
    EventBus.emit('game:loadCOBMap', { mapId });
  }

  private emitStatus(snapshot: ReturnType<CallOfBlockFramework['getSnapshot']>, force: boolean): void {
    const nowMs = Date.now();
    if (!force && nowMs - this.lastStatusEmitAtMs < 200) return;
    this.lastStatusEmitAtMs = nowMs;
    const map = snapshot.mapId ? this.framework.mapManager.getMap(snapshot.mapId) : null;
    EventBus.emit('cob:lobbyStatus', {
      state: snapshot.state,
      countdownMs: snapshot.state === MatchState.Lobby_Wait ? snapshot.remainingLobbyCountdownMs : this.lastTimerCountdownMs,
      activePlayers: snapshot.activePlayers,
      humanPlayers: snapshot.humanPlayers,
      mapId: snapshot.mapId,
      mapName: map?.displayName,
    });
  }

  private syncLocalSession(nowMs: number): void {
    if (!this.localSession || nowMs - this.lastLocalSyncAtMs < 50 || this.localSyncInFlight) return;
    this.lastLocalSyncAtMs = nowMs;
    this.localSyncInFlight = true;
    this.localSession.clientSequence++;
    this.localSession.lastHeardAtMs = nowMs;
    this.localSession.state.transform.position = this.toCOBVector(this.playerController.position);
    this.localSession.state.transform.rotation = new COBVector3(0, this.cameraController.yaw, this.cameraController.pitch);
    this.localSession.state.velocity = this.toCOBVector(this.playerController.velocity);
    this.localSession.state.health = this.playerController.health;
    this.localSession.state.lastValidAtMs = nowMs;
    void this.framework.matchStateMachine.addOrUpdatePlayer(this.localSession).finally(() => {
      this.localSyncInFlight = false;
    });
  }

  private syncRemotePlayers(sessions: PlayerSession[]): void {
    const seen = new Set<string>();
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      if (session.id === this.localSession?.id) continue;
      seen.add(session.id);
      if (!this.remoteIds.has(session.id) || !this.entityManager.hasRemotePlayer(session.id)) {
        this.entityManager.spawnRemotePlayer(session.id, session.state.displayName || 'COB Player');
        this.remoteIds.add(session.id);
        this.skinnedRemoteIds.delete(session.id);
      }
      this.applyRemoteTeamSkin(session.id, session.state.teamId);
      const pos = this.toThreeVector(session.state.transform.position);
      this.entityManager.updateRemotePlayer(
        session.id,
        pos,
        session.state.transform.rotation.y,
        session.state.transform.rotation.x,
        COB_ASSAULT_RIFLE_ITEM_ID
      );
      if (session.state.health <= 0) this.entityManager.markRemotePlayerDead(session.id);
      else this.entityManager.reviveRemotePlayer(session.id);
    }

    for (const id of Array.from(this.remoteIds)) {
      if (seen.has(id)) continue;
      this.entityManager.removeRemotePlayer(id);
      this.remoteIds.delete(id);
      this.skinnedRemoteIds.delete(id);
    }
  }

  private applyViewmodel(dtSeconds: number, nowMs: number): void {
    if (!this.active || this.blockingGameplay) return;
    const baseFov = COB_BASE_FOV_DEGREES;
    const pose = this.framework.updateLocalWeaponViewmodel({
      nowMs,
      dtSeconds,
      playerVelocity: this.toCOBVector(this.playerController.velocity),
      rightClickHeld: InputManager.isActionDown('place'),
      baseCameraFovDegrees: baseFov,
      walkingSpeedThreshold: 4.4,
      footstepIntervalMs: 420,
    });
    const recoilDecay = Math.exp(-Math.max(0, dtSeconds) * 13.5);
    this.viewmodelRecoilKick *= recoilDecay;
    this.viewmodelRecoilSide *= recoilDecay;

    const weaponPosition = new THREE.Vector3(
      pose.position.x + this.viewmodelRecoilSide * 0.024,
      pose.position.y - this.viewmodelRecoilKick * 0.038,
      pose.position.z + this.viewmodelRecoilKick * 0.085
    );
    const weaponRotation = new THREE.Euler(
      pose.rotation.x - this.viewmodelRecoilKick * 0.16,
      pose.rotation.y - Math.PI * 0.5 + this.viewmodelRecoilSide * 0.035,
      pose.rotation.z + this.viewmodelRecoilSide * 0.09,
      'XYZ'
    );
    const weaponScale = new THREE.Vector3(pose.scale.x * 1.08, pose.scale.y * 1.08, pose.scale.z * 1.08);
    this.renderer.applyProceduralWeaponPose(weaponPosition, weaponRotation, weaponScale);
    if (Math.abs(this.renderer.camera.fov - pose.cameraFov) > 0.05) {
      this.renderer.camera.fov = pose.cameraFov;
      this.renderer.camera.updateProjectionMatrix();
    }
  }

  private async tryLocalFire(): Promise<void> {
    if (!this.active || this.blockingGameplay || !this.localSession) return;
    const nowMs = Date.now();
    this.finishRifleReloadIfReady(nowMs);
    if (this.rifleReloadCompletesAtMs > nowMs) return;
    const rifleAmmo = this.getLocalRifleAmmo();
    if (!rifleAmmo) return;
    if (rifleAmmo.current <= 0) {
      this.beginRifleReload(nowMs, rifleAmmo);
      return;
    }
    if (nowMs - this.lastShotAtMs < COB_RIFLE_FIRE_INTERVAL_MS) return;
    this.lastShotAtMs = nowMs;
    rifleAmmo.current = Math.max(0, rifleAmmo.current - 1);
    this.applyLocalAmmoToSession(rifleAmmo);

    this.viewmodelRecoilKick = Math.min(1.25, this.viewmodelRecoilKick + 0.52);
    this.viewmodelRecoilSide = Math.max(-1, Math.min(1, this.viewmodelRecoilSide + (Math.random() - 0.5) * 0.42));
    this.renderer.playGunRecoil(0.78);
    this.applyCameraRecoil();
    AudioManager.playGunshot('rifle');

    const origin = this.playerController.position.clone().add(new THREE.Vector3(0, this.playerController.eyeHeight, 0));
    const direction = this.cameraController.getDirection().normalize();
    const snapshot = this.framework.getSnapshot(nowMs);
    let bestTarget: PlayerSession | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < snapshot.sessions.length; i++) {
      const session = snapshot.sessions[i];
      if (session.id === this.localSession.id) continue;
      if (session.state.teamId === this.localSession.state.teamId) continue;
      if (session.state.health <= 0) continue;

      const target = this.toThreeVector(session.state.transform.position).add(new THREE.Vector3(0, 1.1, 0));
      const toTarget = target.clone().sub(origin);
      const projected = toTarget.dot(direction);
      if (projected < 0.75 || projected > 90) continue;
      const closest = origin.clone().addScaledVector(direction, projected);
      const missDistance = closest.distanceTo(target);
      if (missDistance > 0.95) continue;
      if (projected < bestDistance) {
        bestDistance = projected;
        bestTarget = session;
      }
    }

    this.framework.audioManager.playSpatial('rifle_fire_01', this.toCOBVector(origin), this.toCOBVector(this.renderer.camera.getWorldPosition(new THREE.Vector3())), 95);
    this.spawnMuzzleFlashAndTracer(origin, direction, Number.isFinite(bestDistance) ? bestDistance : 92, Boolean(bestTarget));
    if (rifleAmmo.current <= 0) this.beginRifleReload(nowMs + 120, rifleAmmo);
    if (!bestTarget) return;
    this.entityManager.flashPlayer(bestTarget.id);
    EventBus.emit('particles:spawn', this.toThreeVector(bestTarget.state.transform.position).add(new THREE.Vector3(0, 1.1, 0)), 13, 12);
    await this.framework.registerKill({
      attackerId: this.localSession.id,
      victimId: bestTarget.id,
      assistIds: [],
      occurredAtMs: nowMs,
    });
    this.entityManager.markRemotePlayerDead(bestTarget.id);
    this.hud.addChatMessage(`[COB] Eliminated ${bestTarget.state.displayName}.`);
  }

  private resetRifleAmmo(ammo: AmmoStack[]): void {
    let rifle: AmmoStack | null = null;
    for (let i = 0; i < ammo.length; i++) {
      if (ammo[i].ammoType === COB_RIFLE_AMMO_TYPE) {
        rifle = ammo[i];
        break;
      }
    }
    if (!rifle) {
      ammo.push({ ammoType: COB_RIFLE_AMMO_TYPE, current: 30, reserve: 120, magazineSize: 30 });
      return;
    }
    rifle.magazineSize = 30;
    rifle.current = 30;
    rifle.reserve = 120;
  }

  private getLocalRifleAmmo(): AmmoStack | null {
    if (!this.localSession) return null;
    const ammo = this.localSession.state.ammo;
    for (let i = 0; i < ammo.length; i++) {
      if (ammo[i].ammoType === COB_RIFLE_AMMO_TYPE) return ammo[i];
    }
    return null;
  }

  private applyLocalAmmoToSession(rifleAmmo: AmmoStack): void {
    if (!this.localSession) return;
    const ammo = this.localSession.state.ammo;
    for (let i = 0; i < ammo.length; i++) {
      if (ammo[i].ammoType !== COB_RIFLE_AMMO_TYPE) continue;
      ammo[i].current = Math.max(0, Math.min(ammo[i].magazineSize, Math.floor(rifleAmmo.current)));
      ammo[i].reserve = Math.max(0, Math.floor(rifleAmmo.reserve));
      ammo[i].magazineSize = Math.max(1, Math.floor(rifleAmmo.magazineSize));
      return;
    }
    ammo.push({
      ammoType: COB_RIFLE_AMMO_TYPE,
      current: Math.max(0, Math.min(rifleAmmo.magazineSize, Math.floor(rifleAmmo.current))),
      reserve: Math.max(0, Math.floor(rifleAmmo.reserve)),
      magazineSize: Math.max(1, Math.floor(rifleAmmo.magazineSize)),
    });
  }

  private beginRifleReload(nowMs: number, rifleAmmo: AmmoStack): void {
    if (this.rifleReloadCompletesAtMs > nowMs) return;
    if (rifleAmmo.current >= rifleAmmo.magazineSize) return;
    if (rifleAmmo.reserve <= 0) {
      if (nowMs - this.lastAmmoMessageAtMs > 900) {
        this.lastAmmoMessageAtMs = nowMs;
        this.hud.addChatMessage('[COB] Rifle dry. No reserve ammo.');
      }
      return;
    }
    this.rifleReloadCompletesAtMs = nowMs + COB_RIFLE_RELOAD_MS;
    AudioManager.playGunReload('rifle');
    if (nowMs - this.lastAmmoMessageAtMs > 900) {
      this.lastAmmoMessageAtMs = nowMs;
      this.hud.addChatMessage(`[COB] Reloading ${rifleAmmo.current}/${rifleAmmo.reserve}.`);
    }
  }

  private finishRifleReloadIfReady(nowMs: number): void {
    if (this.rifleReloadCompletesAtMs <= 0 || nowMs < this.rifleReloadCompletesAtMs) return;
    this.rifleReloadCompletesAtMs = 0;
    const rifleAmmo = this.getLocalRifleAmmo();
    if (!rifleAmmo) return;
    const missing = Math.max(0, rifleAmmo.magazineSize - rifleAmmo.current);
    if (missing <= 0 || rifleAmmo.reserve <= 0) return;
    const transferred = Math.min(missing, rifleAmmo.reserve);
    rifleAmmo.current += transferred;
    rifleAmmo.reserve -= transferred;
    this.applyLocalAmmoToSession(rifleAmmo);
    this.hud.addChatMessage(`[COB] Rifle ready ${rifleAmmo.current}/${rifleAmmo.reserve}.`);
  }

  private applyCameraRecoil(): void {
    const limit = Math.PI / 2 - 0.05;
    this.cameraController.pitch = THREE.MathUtils.clamp(this.cameraController.pitch + 0.022 + Math.random() * 0.012, -limit, limit);
    this.cameraController.yaw += (Math.random() - 0.5) * 0.018;
  }

  private spawnMuzzleFlashAndTracer(origin: THREE.Vector3, direction: THREE.Vector3, distance: number, hit: boolean): void {
    const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
    right.normalize();
    const muzzle = origin.clone()
      .addScaledVector(direction, 0.58)
      .addScaledVector(right, 0.22)
      .add(new THREE.Vector3(0, -0.12, 0));

    const color = hit ? 0xfff2a6 : 0xffbf4d;
    const flashGeometry = new THREE.SphereGeometry(hit ? 0.105 : 0.085, 9, 7);
    const flashMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.94, depthWrite: false });
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.copy(muzzle);
    flash.renderOrder = 1005;
    flash.frustumCulled = false;
    this.renderer.scene.add(flash);

    const light = new THREE.PointLight(color, hit ? 2.4 : 1.7, hit ? 4.8 : 3.6);
    light.position.copy(muzzle);
    this.renderer.scene.add(light);

    this.spawnTracer(muzzle, direction, distance, color, true);

    window.setTimeout(() => {
      this.renderer.scene.remove(flash);
      flashGeometry.dispose();
      flashMaterial.dispose();
      this.renderer.scene.remove(light);
      light.dispose();
    }, 58);
  }

  private spawnTracer(origin: THREE.Vector3, direction: THREE.Vector3, distance: number, color: number, bright: boolean): void {
    const clampedDistance = Math.max(1.2, Math.min(96, Number.isFinite(distance) ? distance : 72));
    const end = origin.clone().addScaledVector(direction, clampedDistance);
    const geometry = new THREE.BufferGeometry().setFromPoints([origin.clone(), end]);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: bright ? 0.84 : 0.42,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = bright ? 1003 : 78;
    line.frustumCulled = false;
    this.renderer.scene.add(line);
    window.setTimeout(() => {
      this.renderer.scene.remove(line);
      geometry.dispose();
      material.dispose();
    }, bright ? 62 : 48);
  }

  private applyRemoteTeamSkin(playerId: string, teamId: COBTeamId): void {
    if (this.skinnedRemoteIds.has(playerId)) return;
    const skin = this.getTeamSkin(teamId);
    if (!skin) return;
    this.entityManager.setRemotePlayerSkin(playerId, skin);
    this.skinnedRemoteIds.add(playerId);
  }

  private getTeamSkin(teamId: COBTeamId): string {
    const cached = this.teamSkinCache.get(teamId);
    if (cached) return cached;
    const skin = this.createTeamUniformSkin(teamId);
    if (skin) this.teamSkinCache.set(teamId, skin);
    return skin;
  }

  private createTeamUniformSkin(teamId: COBTeamId): string {
    if (typeof document === 'undefined') return '';
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.imageSmoothingEnabled = false;

    const teamPrimary = teamId === COBTeamId.TeamB ? '#b92334' : '#1e64c8';
    const teamDark = teamId === COBTeamId.TeamB ? '#681622' : '#123a73';
    const teamAccent = teamId === COBTeamId.TeamB ? '#ff6b72' : '#6bb5ff';
    const skin = teamId === COBTeamId.TeamB ? '#b8794f' : '#c68655';
    const skinDark = teamId === COBTeamId.TeamB ? '#89563b' : '#a66a43';
    const helmet = '#171a1f';
    const vest = '#202832';
    const pants = '#222933';
    const boots = '#0d1015';

    const fill = (color: string, x: number, y: number, w: number, h: number): void => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };

    fill(skin, 0, 0, 64, 64);

    fill(skin, 0, 8, 32, 8);
    fill(skin, 8, 0, 16, 8);
    fill(helmet, 0, 8, 8, 8);
    fill(helmet, 16, 8, 16, 8);
    fill(helmet, 8, 0, 16, 5);
    fill(teamAccent, 9, 5, 14, 1);
    fill('#f1efe7', 10, 12, 2, 1);
    fill('#f1efe7', 15, 12, 2, 1);
    fill('#171a1f', 11, 12, 1, 1);
    fill('#171a1f', 15, 12, 1, 1);
    fill(skinDark, 12, 14, 4, 1);

    fill(teamPrimary, 16, 20, 24, 12);
    fill(teamDark, 16, 20, 5, 12);
    fill(teamDark, 35, 20, 5, 12);
    fill(vest, 21, 21, 14, 10);
    fill(teamAccent, 18, 18, 20, 2);
    fill('#d9dde2', 25, 22, 6, 2);

    fill(teamPrimary, 40, 16, 16, 8);
    fill(teamDark, 40, 20, 4, 4);
    fill(teamDark, 52, 20, 4, 4);
    fill(skin, 40, 24, 16, 8);
    fill(skinDark, 40, 29, 16, 3);

    fill(pants, 0, 16, 16, 12);
    fill(teamDark, 0, 16, 3, 10);
    fill(teamDark, 13, 16, 3, 10);
    fill(boots, 0, 28, 16, 4);

    fill(teamPrimary, 32, 48, 16, 8);
    fill(teamDark, 32, 52, 4, 4);
    fill(teamDark, 44, 52, 4, 4);
    fill(skin, 32, 56, 16, 8);
    fill(skinDark, 32, 61, 16, 3);

    fill(pants, 16, 48, 16, 12);
    fill(teamDark, 16, 48, 3, 10);
    fill(teamDark, 29, 48, 3, 10);
    fill(boots, 16, 60, 16, 4);

    return canvas.toDataURL('image/png');
  }

  private toCOBVector(vector: THREE.Vector3): COBVector3 {
    return new COBVector3(vector.x, vector.y, vector.z);
  }

  private toThreeVector(vector: COBVector3): THREE.Vector3 {
    return new THREE.Vector3(vector.x, vector.y, vector.z);
  }
}
