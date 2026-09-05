import { COBServerTransport, COBTeamId, PlayerSession, SpawnAssignment, TeamScoreState, clonePlayerState, cloneTransform, createSpawnPayload } from '../core/Models';
import { AsyncMutex } from '../core/AsyncMutex';
import { MapConfig, MapManager } from '../maps/MapManager';

export enum MatchState {
  Lobby_Wait = 'Lobby_Wait',
  Match_Loading = 'Match_Loading',
  Match_Active = 'Match_Active',
  Match_SuddenDeath = 'Match_SuddenDeath',
  Match_PostGame = 'Match_PostGame',
}

export interface MatchStateMachineConfig {
  matchId: string;
  fixedTickMs: number;
  lobbyCountdownMs: number;
  countdownBroadcastMs: number;
  loadingDurationMs: number;
  matchDurationMs: number;
  suddenDeathDurationMs: number;
  teamKillTarget: number;
  minimumHumanPlayers: number;
}

export interface KillRegistration {
  attackerId: string;
  victimId: string;
  assistIds: string[];
  occurredAtMs: number;
}

export interface MatchSnapshot {
  matchId: string;
  state: MatchState;
  mapId: string;
  humanPlayers: number;
  activePlayers: number;
  teamScores: TeamScoreState[];
  remainingLobbyCountdownMs: number;
  remainingMatchMs: number;
  sessions: PlayerSession[];
}

export class MatchStateMachine {
  private readonly sessions = new Map<string, PlayerSession>();
  private readonly mutex = new AsyncMutex();
  private readonly teamScores: TeamScoreState[] = [
    { teamId: COBTeamId.TeamA, kills: 0, deaths: 0, objectiveScore: 0 },
    { teamId: COBTeamId.TeamB, kills: 0, deaths: 0, objectiveScore: 0 },
  ];

  private state = MatchState.Lobby_Wait;
  private currentMap: MapConfig | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lobbyCountdownStartedAtMs = 0;
  private nextLobbyBroadcastAtMs = 0;
  private lobbyTimerSequence = 0;
  private loadingStartedAtMs = 0;
  private matchStartedAtMs = 0;
  private suddenDeathStartedAtMs = 0;
  private postGameStartedAtMs = 0;
  private matchDeadlineCheckpointsMs: number[] = [];

  public constructor(
    private readonly mapManager: MapManager,
    private readonly transport: COBServerTransport,
    private readonly config: MatchStateMachineConfig
  ) {}

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick(Date.now());
    }, Math.max(10, this.config.fixedTickMs));
  }

  public async InitializeLobby(initialSessions: PlayerSession[] = [], nowMs: number = Date.now()): Promise<void> {
    await this.mutex.runExclusive(() => {
      this.state = MatchState.Lobby_Wait;
      this.currentMap = null;
      this.lobbyCountdownStartedAtMs = 0;
      this.nextLobbyBroadcastAtMs = 0;
      this.lobbyTimerSequence = 0;
      this.loadingStartedAtMs = 0;
      this.matchStartedAtMs = 0;
      this.suddenDeathStartedAtMs = 0;
      this.postGameStartedAtMs = 0;
      this.matchDeadlineCheckpointsMs = [];
      this.sessions.clear();

      for (let i = 0; i < this.teamScores.length; i++) {
        this.teamScores[i].kills = 0;
        this.teamScores[i].deaths = 0;
        this.teamScores[i].objectiveScore = 0;
      }

      for (let i = 0; i < initialSessions.length; i++) {
        const session = initialSessions[i];
        const clonedState = clonePlayerState(session.state);
        clonedState.teamId = this.assignBalancedTeam(clonedState.teamId);
        clonedState.inputFrozen = false;
        clonedState.health = Math.max(1, clonedState.health);
        clonedState.lastValidAtMs = nowMs;
        this.sessions.set(session.id, {
          id: session.id,
          state: clonedState,
          clientSequence: Math.max(0, session.clientSequence),
          lastHeardAtMs: Math.max(0, session.lastHeardAtMs || nowMs),
        });
      }

      this.transport.broadcastMatchTimer({
        matchId: this.config.matchId,
        state: this.state,
        countdownMs: this.config.lobbyCountdownMs,
        serverNowMs: nowMs,
        sequence: this.lobbyTimerSequence,
      });
      this.broadcastState(nowMs);
    });
  }

  public async initializeLobby(initialSessions: PlayerSession[] = [], nowMs: number = Date.now()): Promise<void> {
    await this.InitializeLobby(initialSessions, nowMs);
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  public async addOrUpdatePlayer(session: PlayerSession): Promise<void> {
    await this.mutex.runExclusive(() => {
      const clonedState = clonePlayerState(session.state);
      clonedState.teamId = this.assignBalancedTeam(clonedState.teamId);
      clonedState.inputFrozen = this.state === MatchState.Match_Loading;
      this.sessions.set(session.id, {
        id: session.id,
        state: clonedState,
        clientSequence: Math.max(0, session.clientSequence),
        lastHeardAtMs: Math.max(0, session.lastHeardAtMs),
      });
    });
  }

  public async removePlayer(playerId: string): Promise<PlayerSession | null> {
    return await this.mutex.runExclusive(() => {
      const existing = this.sessions.get(playerId);
      if (!existing) return null;
      this.sessions.delete(playerId);
      this.transport.broadcastPlayerDespawn(playerId, 'left_match');
      return {
        id: existing.id,
        state: clonePlayerState(existing.state),
        clientSequence: existing.clientSequence,
        lastHeardAtMs: existing.lastHeardAtMs,
      };
    });
  }

  public async registerKill(event: KillRegistration): Promise<void> {
    await this.mutex.runExclusive(() => {
      if (this.state !== MatchState.Match_Active && this.state !== MatchState.Match_SuddenDeath) return;
      const attacker = this.sessions.get(event.attackerId);
      const victim = this.sessions.get(event.victimId);
      if (!attacker || !victim) return;
      if (attacker.state.teamId === victim.state.teamId) return;
      if (victim.state.health <= 0) return;

      victim.state.health = 0;
      victim.state.deaths += 1;
      victim.state.lastValidAtMs = Math.max(victim.state.lastValidAtMs, event.occurredAtMs);
      attacker.state.kills += 1;
      attacker.state.score += 100;

      for (let i = 0; i < event.assistIds.length; i++) {
        const assistant = this.sessions.get(event.assistIds[i]);
        if (!assistant) continue;
        if (assistant.id === attacker.id) continue;
        if (assistant.state.teamId !== attacker.state.teamId) continue;
        assistant.state.assists += 1;
        assistant.state.score += 35;
      }

      const score = this.scoreForTeam(attacker.state.teamId);
      score.kills += 1;
      const victimTeamScore = this.scoreForTeam(victim.state.teamId);
      victimTeamScore.deaths += 1;

      if (this.state === MatchState.Match_SuddenDeath) {
        this.transitionToPostGame(Date.now());
        return;
      }

      if (score.kills >= this.config.teamKillTarget) {
        this.transitionToPostGame(Date.now());
      }
    });
  }

  public async tick(nowMs: number): Promise<void> {
    await this.mutex.runExclusive(() => {
      if (this.state === MatchState.Lobby_Wait) {
        this.tickLobby(nowMs);
      } else if (this.state === MatchState.Match_Loading) {
        this.tickLoading(nowMs);
      } else if (this.state === MatchState.Match_Active) {
        this.tickActive(nowMs);
      } else if (this.state === MatchState.Match_SuddenDeath) {
        this.tickSuddenDeath(nowMs);
      } else if (this.state === MatchState.Match_PostGame) {
        this.tickPostGame(nowMs);
      }
    });
  }

  public getSnapshot(nowMs: number = Date.now()): MatchSnapshot {
    const sessions: PlayerSession[] = [];
    for (const session of this.sessions.values()) {
      sessions.push({
        id: session.id,
        state: clonePlayerState(session.state),
        clientSequence: session.clientSequence,
        lastHeardAtMs: session.lastHeardAtMs,
      });
    }

    return {
      matchId: this.config.matchId,
      state: this.state,
      mapId: this.currentMap?.id ?? '',
      humanPlayers: this.countHumanPlayers(),
      activePlayers: this.sessions.size,
      teamScores: this.cloneScores(),
      remainingLobbyCountdownMs: this.remainingLobbyCountdownMs(nowMs),
      remainingMatchMs: this.remainingMatchMs(nowMs),
      sessions,
    };
  }

  public getState(): MatchState {
    return this.state;
  }

  public getCurrentMap(): MapConfig | null {
    return this.currentMap;
  }

  private tickLobby(nowMs: number): void {
    const activePlayers = this.countActivePlayers();
    if (activePlayers < this.config.minimumHumanPlayers) {
      this.lobbyCountdownStartedAtMs = 0;
      this.nextLobbyBroadcastAtMs = 0;
      this.lobbyTimerSequence = 0;
      this.broadcastState(nowMs);
      return;
    }

    if (this.lobbyCountdownStartedAtMs <= 0) {
      this.lobbyCountdownStartedAtMs = nowMs;
      this.nextLobbyBroadcastAtMs = nowMs;
      this.lobbyTimerSequence = 0;
    }

    while (this.nextLobbyBroadcastAtMs > 0 && nowMs >= this.nextLobbyBroadcastAtMs) {
      const countdownAtScheduledTick = Math.max(0, this.config.lobbyCountdownMs - (this.nextLobbyBroadcastAtMs - this.lobbyCountdownStartedAtMs));
      this.transport.broadcastMatchTimer({
        matchId: this.config.matchId,
        state: this.state,
        countdownMs: countdownAtScheduledTick,
        serverNowMs: this.nextLobbyBroadcastAtMs,
        sequence: this.lobbyTimerSequence,
      });
      this.lobbyTimerSequence++;
      this.nextLobbyBroadcastAtMs += this.config.countdownBroadcastMs;
    }

    if (nowMs - this.lobbyCountdownStartedAtMs >= this.config.lobbyCountdownMs) {
      this.transitionToLoading(nowMs);
    }
  }

  private tickLoading(nowMs: number): void {
    if (nowMs - this.loadingStartedAtMs < this.config.loadingDurationMs) return;
    this.transitionToActive(nowMs);
  }

  private tickActive(nowMs: number): void {
    const teamA = this.scoreForTeam(COBTeamId.TeamA);
    const teamB = this.scoreForTeam(COBTeamId.TeamB);
    if (teamA.kills >= this.config.teamKillTarget || teamB.kills >= this.config.teamKillTarget) {
      this.transitionToPostGame(nowMs);
      return;
    }

    if (this.hasStrictMatchClockExpired(nowMs)) {
      if (teamA.kills === teamB.kills) {
        this.transitionToSuddenDeath(nowMs);
      } else {
        this.transitionToPostGame(nowMs);
      }
    }
  }

  private tickSuddenDeath(nowMs: number): void {
    if (nowMs - this.suddenDeathStartedAtMs >= this.config.suddenDeathDurationMs) {
      this.transitionToPostGame(nowMs);
    }
  }

  private tickPostGame(nowMs: number): void {
    if (this.postGameStartedAtMs <= 0) this.postGameStartedAtMs = nowMs;
    this.broadcastState(nowMs);
  }

  private transitionToLoading(nowMs: number): void {
    this.state = MatchState.Match_Loading;
    this.loadingStartedAtMs = nowMs;
    this.lobbyCountdownStartedAtMs = 0;
    this.nextLobbyBroadcastAtMs = 0;
    this.currentMap = this.mapManager.selectNextMap(nowMs ^ this.sessions.size ^ this.config.teamKillTarget);

    const sessions = Array.from(this.sessions.values());
    const assignments = this.mapManager.allocateInitialSpawns(this.currentMap, sessions);
    this.applySpawnAssignments(assignments, nowMs, true);
    this.broadcastState(nowMs);
  }

  private transitionToActive(nowMs: number): void {
    this.state = MatchState.Match_Active;
    this.matchStartedAtMs = nowMs;
    this.matchDeadlineCheckpointsMs = [];
    for (let elapsed = 1000; elapsed <= this.config.matchDurationMs; elapsed += 1000) {
      this.matchDeadlineCheckpointsMs.push(nowMs + elapsed);
    }

    for (const score of this.teamScores) {
      score.kills = 0;
      score.deaths = 0;
      score.objectiveScore = 0;
    }

    for (const session of this.sessions.values()) {
      session.state.inputFrozen = false;
      session.state.health = session.state.maxHealth;
      session.state.invulnerableUntilMs = nowMs + 1500;
      this.transport.broadcastPlayerSpawn(createSpawnPayload(session.state));
    }

    this.broadcastState(nowMs);
  }

  private transitionToSuddenDeath(nowMs: number): void {
    this.state = MatchState.Match_SuddenDeath;
    this.suddenDeathStartedAtMs = nowMs;
    for (const session of this.sessions.values()) {
      session.state.inputFrozen = false;
    }
    this.broadcastState(nowMs);
  }

  private transitionToPostGame(nowMs: number): void {
    this.state = MatchState.Match_PostGame;
    this.postGameStartedAtMs = nowMs;
    for (const session of this.sessions.values()) {
      session.state.inputFrozen = true;
    }
    this.broadcastState(nowMs);
  }

  private applySpawnAssignments(assignments: SpawnAssignment[], nowMs: number, freezeInputs: boolean): void {
    for (let i = 0; i < assignments.length; i++) {
      const assignment = assignments[i];
      const session = this.sessions.get(assignment.playerId);
      if (!session) continue;
      session.state.teamId = assignment.teamId;
      session.state.transform = cloneTransform(assignment.transform);
      session.state.velocity.set(0, 0, 0);
      session.state.health = session.state.maxHealth;
      session.state.inputFrozen = freezeInputs;
      session.state.lastValidAtMs = nowMs;
      this.transport.broadcastPlayerSpawn(createSpawnPayload(session.state));
    }
  }

  private hasStrictMatchClockExpired(nowMs: number): boolean {
    if (this.matchDeadlineCheckpointsMs.length === 0) return false;
    for (let i = 0; i < this.matchDeadlineCheckpointsMs.length; i++) {
      if (nowMs < this.matchDeadlineCheckpointsMs[i]) return false;
    }
    return true;
  }

  private assignBalancedTeam(requestedTeam: COBTeamId): COBTeamId {
    if (requestedTeam === COBTeamId.TeamA || requestedTeam === COBTeamId.TeamB) return requestedTeam;
    let teamA = 0;
    let teamB = 0;
    for (const session of this.sessions.values()) {
      if (session.state.teamId === COBTeamId.TeamA) teamA++;
      else if (session.state.teamId === COBTeamId.TeamB) teamB++;
    }
    return teamA <= teamB ? COBTeamId.TeamA : COBTeamId.TeamB;
  }

  private scoreForTeam(teamId: COBTeamId): TeamScoreState {
    for (let i = 0; i < this.teamScores.length; i++) {
      if (this.teamScores[i].teamId === teamId) return this.teamScores[i];
    }
    return this.teamScores[0];
  }

  private countHumanPlayers(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (!session.state.isBot && session.state.connected) count++;
    }
    return count;
  }

  private countActivePlayers(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.state.health > 0 || this.state === MatchState.Lobby_Wait || this.state === MatchState.Match_Loading) {
        count++;
      }
    }
    return count;
  }

  private remainingLobbyCountdownMs(nowMs: number): number {
    if (this.lobbyCountdownStartedAtMs <= 0) return this.config.lobbyCountdownMs;
    return Math.max(0, this.config.lobbyCountdownMs - (nowMs - this.lobbyCountdownStartedAtMs));
  }

  private remainingMatchMs(nowMs: number): number {
    if (this.state === MatchState.Match_SuddenDeath) {
      return Math.max(0, this.config.suddenDeathDurationMs - (nowMs - this.suddenDeathStartedAtMs));
    }
    if (this.matchStartedAtMs <= 0) return this.config.matchDurationMs;
    return Math.max(0, this.config.matchDurationMs - (nowMs - this.matchStartedAtMs));
  }

  private cloneScores(): TeamScoreState[] {
    const scores: TeamScoreState[] = [];
    for (let i = 0; i < this.teamScores.length; i++) {
      const score = this.teamScores[i];
      scores.push({
        teamId: score.teamId,
        kills: score.kills,
        deaths: score.deaths,
        objectiveScore: score.objectiveScore,
      });
    }
    return scores;
  }

  private broadcastState(nowMs: number): void {
    this.transport.broadcastMatchState({
      matchId: this.config.matchId,
      state: this.state,
      mapId: this.currentMap?.id ?? '',
      serverNowMs: nowMs,
      teamScores: this.cloneScores(),
      remainingMatchMs: this.remainingMatchMs(nowMs),
    });
  }
}
