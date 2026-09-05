import { BotDirector, BotFireDecision } from './ai/BotDirector';
import { COBAudioManager } from './audio/COBAudioManager';
import { AABB, Vector3 } from './core/Math';
import { COBServerTransport, COBTeamId, MatchStatePayload, MatchTimerPayload, PlayerSession, PlayerSpawnPayload, VehicleStatePayload, createPlayerState } from './core/Models';
import { MapConfig, MapManager } from './maps/MapManager';
import { KillRegistration, MatchSnapshot, MatchState, MatchStateMachine, MatchStateMachineConfig } from './match/MatchStateMachine';
import { WeaponViewmodel, WeaponViewmodelInput } from './weapons/WeaponViewmodel';

export class InMemoryCOBTransport implements COBServerTransport {
  public readonly timerPayloads: MatchTimerPayload[] = [];
  public readonly matchStatePayloads: MatchStatePayload[] = [];
  public readonly playerSpawnPayloads: PlayerSpawnPayload[] = [];
  public readonly playerDespawnPayloads: Array<{ playerId: string; reason: string }> = [];
  public readonly vehicleStatePayloads: VehicleStatePayload[] = [];

  public broadcastMatchTimer(payload: MatchTimerPayload): void {
    this.timerPayloads.push(payload);
  }

  public broadcastMatchState(payload: MatchStatePayload): void {
    this.matchStatePayloads.push(payload);
  }

  public broadcastPlayerSpawn(payload: PlayerSpawnPayload): void {
    this.playerSpawnPayloads.push(payload);
  }

  public broadcastPlayerDespawn(playerId: string, reason: string): void {
    this.playerDespawnPayloads.push({ playerId, reason });
  }

  public broadcastVehicleState(payload: VehicleStatePayload): void {
    this.vehicleStatePayloads.push(payload);
  }
}

export interface CallOfBlockFrameworkConfig {
  match: MatchStateMachineConfig;
  botCapacityPerTeam: number;
}

export class CallOfBlockFramework {
  public readonly mapManager = new MapManager();
  public readonly audioManager = new COBAudioManager();
  public readonly weaponViewmodel = new WeaponViewmodel();
  public readonly matchStateMachine: MatchStateMachine;
  public readonly botDirector: BotDirector;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickInFlight = false;
  private lastTickAtMs = 0;
  private botsPopulatedForMapId = '';
  private readonly botShots: BotFireDecision[] = [];

  public constructor(
    public readonly transport: COBServerTransport = new InMemoryCOBTransport(),
    private readonly config: CallOfBlockFrameworkConfig = CallOfBlockFramework.defaultConfig()
  ) {
    this.registerDefaultMaps();
    this.matchStateMachine = new MatchStateMachine(this.mapManager, this.transport, this.config.match);
    this.botDirector = new BotDirector(this.mapManager, this.transport, this.config.botCapacityPerTeam);
  }

  public static defaultConfig(): CallOfBlockFrameworkConfig {
    return {
      match: {
        matchId: 'call_of_block_public_001',
        fixedTickMs: 50,
        lobbyCountdownMs: 60_000,
        countdownBroadcastMs: 1000,
        loadingDurationMs: 3000,
        matchDurationMs: 600_000,
        suddenDeathDurationMs: 60_000,
        teamKillTarget: 100,
        minimumHumanPlayers: 2,
      },
      botCapacityPerTeam: 32,
    };
  }

  public start(): void {
    if (this.tickTimer) return;
    this.lastTickAtMs = Date.now();
    this.tickTimer = setInterval(() => {
      void this.tick(Date.now());
    }, this.config.match.fixedTickMs);
  }

  public async InitializeLobby(initialSessions: PlayerSession[] = [], nowMs: number = Date.now()): Promise<void> {
    this.botsPopulatedForMapId = '';
    this.botDirector.clear('lobby_reset');
    this.botShots.length = 0;
    await this.matchStateMachine.InitializeLobby(initialSessions, nowMs);
    this.start();
  }

  public async initializeLobby(initialSessions: PlayerSession[] = [], nowMs: number = Date.now()): Promise<void> {
    await this.InitializeLobby(initialSessions, nowMs);
  }

  public stop(): void {
    if (!this.tickTimer) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  public async shutdown(): Promise<void> {
    this.stop();
    this.matchStateMachine.stop();
    this.botDirector.clear('mode_exit');
    this.botShots.length = 0;
    this.botsPopulatedForMapId = '';
    this.audioManager.clearLoadedAssets();
    await this.matchStateMachine.InitializeLobby([], Date.now());
  }

  public async connectHuman(playerId: string, displayName: string, preferredTeam: COBTeamId, nowMs: number = Date.now()): Promise<PlayerSession> {
    const session: PlayerSession = {
      id: playerId,
      state: createPlayerState(playerId, displayName, preferredTeam, false, nowMs),
      clientSequence: 0,
      lastHeardAtMs: nowMs,
    };

    const currentMap = this.matchStateMachine.getCurrentMap();
    const state = this.matchStateMachine.getState();
    if (currentMap && (state === MatchState.Match_Active || state === MatchState.Match_SuddenDeath)) {
      const swap = await this.botDirector.onPlayerConnectHandshake(session, currentMap, nowMs);
      session.state = swap.humanState;
      if (swap.replacedBotId) await this.matchStateMachine.removePlayer(swap.replacedBotId);
    }

    await this.matchStateMachine.addOrUpdatePlayer(session);
    return {
      id: session.id,
      state: session.state,
      clientSequence: session.clientSequence,
      lastHeardAtMs: session.lastHeardAtMs,
    };
  }

  public async disconnectHuman(playerId: string, nowMs: number = Date.now()): Promise<void> {
    const removed = await this.matchStateMachine.removePlayer(playerId);
    if (!removed) return;
    const currentMap = this.matchStateMachine.getCurrentMap();
    const state = this.matchStateMachine.getState();
    if (!currentMap) return;
    if (state !== MatchState.Match_Active && state !== MatchState.Match_SuddenDeath) return;
    const bot = await this.botDirector.onPlayerDisconnectBackfill(removed, nowMs);
    await this.matchStateMachine.addOrUpdatePlayer({
      id: bot.state.id,
      state: bot.state,
      clientSequence: 0,
      lastHeardAtMs: nowMs,
    });
  }

  public async registerKill(event: KillRegistration): Promise<void> {
    await this.matchStateMachine.registerKill(event);
  }

  public async tick(nowMs: number): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      const dtSeconds = this.lastTickAtMs > 0 ? Math.max(0, Math.min(0.25, (nowMs - this.lastTickAtMs) / 1000)) : 0;
      this.lastTickAtMs = nowMs;
      await this.matchStateMachine.tick(nowMs);

      const snapshot = this.matchStateMachine.getSnapshot(nowMs);
      const map = this.matchStateMachine.getCurrentMap();
      if (map && snapshot.state === MatchState.Match_Active && this.botsPopulatedForMapId !== map.id) {
        for (let i = 0; i < snapshot.sessions.length; i++) {
          const session = snapshot.sessions[i];
          if (session.state.isBot) {
            await this.matchStateMachine.removePlayer(session.id);
          }
        }
        const humans = snapshot.sessions.filter(session => !session.state.isBot);
        const bots = await this.botDirector.populateToCapacity(humans, map, nowMs);
        for (let i = 0; i < bots.length; i++) {
          await this.matchStateMachine.addOrUpdatePlayer({
            id: bots[i].state.id,
            state: bots[i].state,
            clientSequence: 0,
            lastHeardAtMs: nowMs,
          });
        }
        this.botsPopulatedForMapId = map.id;
      }

      if (snapshot.state === MatchState.Match_PostGame) {
        this.botsPopulatedForMapId = '';
      }

      if (snapshot.state === MatchState.Match_Active || snapshot.state === MatchState.Match_SuddenDeath) {
        const humans = snapshot.sessions
          .filter(session => !session.state.isBot)
          .map(session => session.state);
        const shots = this.botDirector.updateBots(nowMs, dtSeconds, humans);
        for (let i = 0; i < shots.length; i++) this.botShots.push(shots[i]);
        const botSessions = this.botDirector.getBotSessions(nowMs);
        for (let i = 0; i < botSessions.length; i++) {
          await this.matchStateMachine.addOrUpdatePlayer(botSessions[i]);
        }
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  public updateLocalWeaponViewmodel(input: WeaponViewmodelInput) {
    return this.weaponViewmodel.update(input);
  }

  public drainBotFireDecisions(): BotFireDecision[] {
    const drained: BotFireDecision[] = [];
    while (this.botShots.length > 0) {
      const shot = this.botShots.shift();
      if (shot) drained.push(shot);
    }
    return drained;
  }

  public getSnapshot(nowMs: number = Date.now()): MatchSnapshot {
    return this.matchStateMachine.getSnapshot(nowMs);
  }

  private registerDefaultMaps(): void {
    const crossfire: MapConfig = {
      id: 'cob_crossfire_blocks',
      displayName: 'Crossfire Blocks',
      teamASpawnPoints: [
        this.mapManager.createSpawn(new Vector3(-42, 65, -46), Math.PI * 0.18),
        this.mapManager.createSpawn(new Vector3(-36, 65, -48), Math.PI * 0.16),
        this.mapManager.createSpawn(new Vector3(-48, 65, -38), Math.PI * 0.22),
        this.mapManager.createSpawn(new Vector3(-31, 65, -41), Math.PI * 0.14),
      ],
      teamBSpawnPoints: [
        this.mapManager.createSpawn(new Vector3(42, 65, 46), -Math.PI * 0.82),
        this.mapManager.createSpawn(new Vector3(36, 65, 48), -Math.PI * 0.84),
        this.mapManager.createSpawn(new Vector3(48, 65, 38), -Math.PI * 0.78),
        this.mapManager.createSpawn(new Vector3(31, 65, 41), -Math.PI * 0.86),
      ],
      vehicleSpawnNodes: [
        { id: 'a_tank_pad', vehicleType: 'tank', teamId: COBTeamId.TeamA, transform: this.mapManager.createSpawn(new Vector3(-52, 65, -30), Math.PI * 0.25), respawnDelayMs: 45_000 },
        { id: 'b_tank_pad', vehicleType: 'tank', teamId: COBTeamId.TeamB, transform: this.mapManager.createSpawn(new Vector3(52, 65, 30), -Math.PI * 0.75), respawnDelayMs: 45_000 },
        { id: 'a_humvee_pad', vehicleType: 'humvee', teamId: COBTeamId.TeamA, transform: this.mapManager.createSpawn(new Vector3(-45, 65, -18), Math.PI * 0.35), respawnDelayMs: 25_000 },
        { id: 'b_humvee_pad', vehicleType: 'humvee', teamId: COBTeamId.TeamB, transform: this.mapManager.createSpawn(new Vector3(45, 65, 18), -Math.PI * 0.65), respawnDelayMs: 25_000 },
        { id: 'center_heli_pad', vehicleType: 'helicopter', teamId: COBTeamId.Neutral, transform: this.mapManager.createSpawn(new Vector3(0, 68, -58), 0), respawnDelayMs: 60_000 },
      ],
      capturePointBounds: [
        { id: 'alpha', bounds: new AABB(new Vector3(-10, 0, -8), new Vector3(3, 7, 7)), owningTeamId: COBTeamId.Neutral, captureSeconds: 12 },
        { id: 'bravo', bounds: new AABB(new Vector3(-6, 0, 24), new Vector3(8, 7, 38)), owningTeamId: COBTeamId.Neutral, captureSeconds: 14 },
        { id: 'charlie', bounds: new AABB(new Vector3(18, 0, -22), new Vector3(33, 8, -7)), owningTeamId: COBTeamId.Neutral, captureSeconds: 14 },
      ],
      staticWorldCollisionHulls: [
        { id: 'north_wall', bounds: new AABB(new Vector3(-64, 0, -64), new Vector3(64, 12, -60)), material: 'concrete', processingCost: 12 },
        { id: 'south_wall', bounds: new AABB(new Vector3(-64, 0, 60), new Vector3(64, 12, 64)), material: 'concrete', processingCost: 12 },
        { id: 'west_wall', bounds: new AABB(new Vector3(-64, 0, -64), new Vector3(-60, 12, 64)), material: 'concrete', processingCost: 12 },
        { id: 'east_wall', bounds: new AABB(new Vector3(60, 0, -64), new Vector3(64, 12, 64)), material: 'concrete', processingCost: 12 },
        { id: 'center_factory', bounds: new AABB(new Vector3(-14, 0, -12), new Vector3(14, 14, 12)), material: 'metal', processingCost: 35 },
        { id: 'factory_roof', bounds: new AABB(new Vector3(-15, 14, -13), new Vector3(15, 16, 13)), material: 'metal', processingCost: 20 },
        { id: 'a_spawn_bunker', bounds: new AABB(new Vector3(-54, 0, -54), new Vector3(-24, 10, -28)), material: 'concrete', processingCost: 26 },
        { id: 'b_spawn_bunker', bounds: new AABB(new Vector3(24, 0, 28), new Vector3(54, 10, 54)), material: 'concrete', processingCost: 26 },
        { id: 'river_bridge', bounds: new AABB(new Vector3(-8, 1, 17), new Vector3(21, 4, 23)), material: 'wood', processingCost: 16 },
        { id: 'glass_atrium', bounds: new AABB(new Vector3(20, 0, -28), new Vector3(36, 11, -14)), material: 'glass', processingCost: 24 },
        { id: 'terrain_ridge_a', bounds: new AABB(new Vector3(-58, 0, 8), new Vector3(-24, 8, 22)), material: 'terrain', processingCost: 18 },
        { id: 'terrain_ridge_b', bounds: new AABB(new Vector3(24, 0, -22), new Vector3(58, 8, -8)), material: 'terrain', processingCost: 18 },
      ],
      combatRadius: 180,
      lodNearDistance: 36,
      lodMidDistance: 84,
      lodFarDistance: 150,
      gridCellSize: 16,
    };

    const frostline: MapConfig = {
      id: 'cob_frostline_airbase',
      displayName: 'Frostline Airbase',
      teamASpawnPoints: [
        this.mapManager.createSpawn(new Vector3(-88, 66, 0), Math.PI * 0.5),
        this.mapManager.createSpawn(new Vector3(-88, 66, 8), Math.PI * 0.5),
        this.mapManager.createSpawn(new Vector3(-88, 66, -8), Math.PI * 0.5),
        this.mapManager.createSpawn(new Vector3(-78, 66, 0), Math.PI * 0.48),
      ],
      teamBSpawnPoints: [
        this.mapManager.createSpawn(new Vector3(88, 66, 0), -Math.PI * 0.5),
        this.mapManager.createSpawn(new Vector3(88, 66, 8), -Math.PI * 0.5),
        this.mapManager.createSpawn(new Vector3(88, 66, -8), -Math.PI * 0.5),
        this.mapManager.createSpawn(new Vector3(78, 66, 0), -Math.PI * 0.48),
      ],
      vehicleSpawnNodes: [
        { id: 'a_jet_hangar', vehicleType: 'fighter_jet', teamId: COBTeamId.TeamA, transform: this.mapManager.createSpawn(new Vector3(-96, 66, -30), Math.PI * 0.5), respawnDelayMs: 75_000 },
        { id: 'b_jet_hangar', vehicleType: 'fighter_jet', teamId: COBTeamId.TeamB, transform: this.mapManager.createSpawn(new Vector3(96, 66, 30), -Math.PI * 0.5), respawnDelayMs: 75_000 },
        { id: 'a_heli_pad', vehicleType: 'helicopter', teamId: COBTeamId.TeamA, transform: this.mapManager.createSpawn(new Vector3(-74, 68, 34), Math.PI * 0.5), respawnDelayMs: 55_000 },
        { id: 'b_heli_pad', vehicleType: 'helicopter', teamId: COBTeamId.TeamB, transform: this.mapManager.createSpawn(new Vector3(74, 68, -34), -Math.PI * 0.5), respawnDelayMs: 55_000 },
      ],
      capturePointBounds: [
        { id: 'runway_mid', bounds: new AABB(new Vector3(-12, 0, -12), new Vector3(12, 8, 12)), owningTeamId: COBTeamId.Neutral, captureSeconds: 16 },
        { id: 'radar_dish', bounds: new AABB(new Vector3(-4, 0, 44), new Vector3(18, 12, 63)), owningTeamId: COBTeamId.Neutral, captureSeconds: 18 },
      ],
      staticWorldCollisionHulls: [
        { id: 'runway_strip', bounds: new AABB(new Vector3(-104, 0, -10), new Vector3(104, 1, 10)), material: 'concrete', processingCost: 22 },
        { id: 'a_hangar', bounds: new AABB(new Vector3(-110, 0, -42), new Vector3(-72, 18, -18)), material: 'metal', processingCost: 32 },
        { id: 'b_hangar', bounds: new AABB(new Vector3(72, 0, 18), new Vector3(110, 18, 42)), material: 'metal', processingCost: 32 },
        { id: 'radar_tower', bounds: new AABB(new Vector3(0, 0, 48), new Vector3(14, 24, 62)), material: 'metal', processingCost: 28 },
        { id: 'fuel_depot', bounds: new AABB(new Vector3(-32, 0, -48), new Vector3(-12, 9, -28)), material: 'metal', processingCost: 26 },
        { id: 'snow_berm_north', bounds: new AABB(new Vector3(-112, 0, -72), new Vector3(112, 9, -58)), material: 'terrain', processingCost: 18 },
        { id: 'snow_berm_south', bounds: new AABB(new Vector3(-112, 0, 58), new Vector3(112, 9, 72)), material: 'terrain', processingCost: 18 },
      ],
      combatRadius: 260,
      lodNearDistance: 52,
      lodMidDistance: 120,
      lodFarDistance: 220,
      gridCellSize: 24,
    };

    this.mapManager.registerMap(crossfire);
    this.mapManager.registerMap(frostline);
  }
}
