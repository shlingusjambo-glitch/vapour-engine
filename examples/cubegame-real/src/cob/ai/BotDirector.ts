import { AsyncMutex } from '../core/AsyncMutex';
import { COBServerTransport, COBTeamId, PlayerRuntimeState, PlayerSession, cloneAmmo, cloneInventory, clonePlayerState, cloneTransform, createPlayerState, createSpawnPayload } from '../core/Models';
import { Vector3, clamp, lerpAngleRadians } from '../core/Math';
import { MapConfig, MapManager } from '../maps/MapManager';

export interface BotFireDecision {
  botId: string;
  targetId: string;
  origin: Vector3;
  direction: Vector3;
  damage: number;
  firedAtMs: number;
}

export interface BotSwapResult {
  humanState: PlayerRuntimeState;
  replacedBotId: string | null;
  invulnerableUntilMs: number;
}

export class AIBotController {
  private readonly aimDirection = new Vector3(0, 0, 1);
  private nextFireAtMs = 0;
  private wanderAngle = 0;
  private nextWanderChangeAtMs = 0;

  public constructor(public readonly state: PlayerRuntimeState) {}

  public performanceMetric(): number {
    return this.state.score
      + this.state.kills * 100
      + this.state.assists * 30
      - this.state.deaths * 50
      + this.state.health * 0.25;
  }

  public update(nowMs: number, dtSeconds: number, enemies: PlayerRuntimeState[]): BotFireDecision | null {
    if (this.state.health <= 0) {
      this.state.velocity.set(0, 0, 0);
      return null;
    }

    const target = this.chooseTarget(enemies);
    if (!target) {
      this.applyWander(nowMs, dtSeconds);
      return null;
    }

    const toTarget = target.transform.position.subtract(this.state.transform.position);
    const distance = toTarget.length();
    const horizontalYaw = Math.atan2(toTarget.x, toTarget.z);
    this.state.transform.rotation.y = lerpAngleRadians(this.state.transform.rotation.y, horizontalYaw, clamp(dtSeconds * 6, 0, 1));

    if (distance > 9) {
      const moveDir = new Vector3(toTarget.x, 0, toTarget.z).normalize();
      this.state.velocity.copy(moveDir.multiplyScalar(4.8));
      this.state.transform.position.addInPlace(this.state.velocity.multiplyScalar(dtSeconds));
    } else {
      this.state.velocity.multiplyScalarInPlace(0.4);
      this.state.transform.position.addInPlace(this.state.velocity.multiplyScalar(dtSeconds));
    }

    const fireDir = toTarget.normalized();
    this.aimDirection.copy(fireDir);
    const rifle = this.state.ammo[0];
    if (distance <= 80 && nowMs >= this.nextFireAtMs && rifle && rifle.current > 0) {
      rifle.current -= 1;
      this.nextFireAtMs = nowMs + 110 + Math.floor(Math.random() * 90);
      return {
        botId: this.state.id,
        targetId: target.id,
        origin: this.state.transform.position.add(new Vector3(0, 1.45, 0)),
        direction: this.aimDirection.clone(),
        damage: 18,
        firedAtMs: nowMs,
      };
    }

    if (rifle && rifle.current <= 0 && rifle.reserve > 0 && nowMs >= this.nextFireAtMs) {
      const reloadAmount = Math.min(rifle.magazineSize, rifle.reserve);
      rifle.current = reloadAmount;
      rifle.reserve -= reloadAmount;
      this.nextFireAtMs = nowMs + 1800;
    }

    return null;
  }

  private chooseTarget(enemies: PlayerRuntimeState[]): PlayerRuntimeState | null {
    let best: PlayerRuntimeState | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (enemy.health <= 0) continue;
      if (enemy.teamId === this.state.teamId) continue;
      const distSq = this.state.transform.position.distanceSquaredTo(enemy.transform.position);
      if (distSq < bestDistSq) {
        best = enemy;
        bestDistSq = distSq;
      }
    }
    return best;
  }

  private applyWander(nowMs: number, dtSeconds: number): void {
    if (nowMs >= this.nextWanderChangeAtMs) {
      this.wanderAngle += -0.9 + Math.random() * 1.8;
      this.nextWanderChangeAtMs = nowMs + 900 + Math.floor(Math.random() * 1600);
    }

    this.state.transform.rotation.y = lerpAngleRadians(this.state.transform.rotation.y, this.wanderAngle, clamp(dtSeconds * 2.5, 0, 1));
    const dir = new Vector3(Math.sin(this.state.transform.rotation.y), 0, Math.cos(this.state.transform.rotation.y));
    this.state.velocity.copy(dir.multiplyScalar(2.1));
    this.state.transform.position.addInPlace(this.state.velocity.multiplyScalar(dtSeconds));
  }
}

export class BotDirector {
  private readonly mutex = new AsyncMutex();
  private readonly bots = new Map<string, AIBotController>();
  private botSequence = 0;

  public constructor(
    private readonly mapManager: MapManager,
    private readonly transport: COBServerTransport,
    private readonly capacityPerTeam: number = 32
  ) {}

  public async populateToCapacity(humanSessions: PlayerSession[], map: MapConfig, nowMs: number): Promise<AIBotController[]> {
    return await this.mutex.runExclusive(() => {
      this.bots.clear();
      let teamAHumans = 0;
      let teamBHumans = 0;

      for (let i = 0; i < humanSessions.length; i++) {
        const teamId = humanSessions[i].state.teamId;
        if (teamId === COBTeamId.TeamB) teamBHumans++;
        else teamAHumans++;
      }

      const spawned: AIBotController[] = [];
      const teamABotsNeeded = Math.max(0, this.capacityPerTeam - teamAHumans);
      const teamBBotsNeeded = Math.max(0, this.capacityPerTeam - teamBHumans);

      for (let i = 0; i < teamABotsNeeded; i++) {
        spawned.push(this.spawnBot(COBTeamId.TeamA, map, nowMs, null));
      }
      for (let i = 0; i < teamBBotsNeeded; i++) {
        spawned.push(this.spawnBot(COBTeamId.TeamB, map, nowMs, null));
      }

      return spawned;
    });
  }

  public async onPlayerConnectHandshake(humanSession: PlayerSession, map: MapConfig, nowMs: number): Promise<BotSwapResult> {
    return await this.mutex.runExclusive(() => {
      const human = clonePlayerState(humanSession.state);
      human.connected = true;
      human.isBot = false;
      human.inputFrozen = false;
      human.teamId = human.teamId === COBTeamId.TeamB ? COBTeamId.TeamB : COBTeamId.TeamA;

      const replacement = this.findLowestPerformanceBot(human.teamId);
      let replacedBotId: string | null = null;

      if (replacement) {
        replacedBotId = replacement.state.id;
        human.transform = cloneTransform(replacement.state.transform);
        human.velocity = replacement.state.velocity.clone();
        human.health = Math.max(1, replacement.state.health);
        human.maxHealth = replacement.state.maxHealth;
        human.ammo = cloneAmmo(replacement.state.ammo);
        human.inventory = cloneInventory(replacement.state.inventory);
        human.kills = replacement.state.kills;
        human.deaths = replacement.state.deaths;
        human.assists = replacement.state.assists;
        human.score = replacement.state.score;
        this.bots.delete(replacement.state.id);
        this.transport.broadcastPlayerDespawn(replacement.state.id, 'human_atomic_swap');
      } else {
        human.transform = this.mapManager.nextSpawnForTeam(map, human.teamId);
        human.velocity.set(0, 0, 0);
        human.health = human.maxHealth;
      }

      human.invulnerableUntilMs = nowMs + 1000;
      human.lastValidAtMs = nowMs;
      this.transport.broadcastPlayerSpawn(createSpawnPayload(human));

      return {
        humanState: human,
        replacedBotId,
        invulnerableUntilMs: human.invulnerableUntilMs,
      };
    });
  }

  public async onPlayerDisconnectBackfill(humanSession: PlayerSession, nowMs: number): Promise<AIBotController> {
    return await this.mutex.runExclusive(() => {
      const botState = clonePlayerState(humanSession.state);
      botState.connected = false;
      botState.isBot = true;
      botState.inputFrozen = false;
      botState.displayName = `COB Bot ${this.botSequence + 1}`;
      botState.invulnerableUntilMs = nowMs + 500;
      botState.lastValidAtMs = nowMs;

      const botId = this.nextBotId();
      const replacementState = createPlayerState(botId, botState.displayName, botState.teamId, true, nowMs);
      replacementState.transform = cloneTransform(botState.transform);
      replacementState.velocity = botState.velocity.clone();
      replacementState.health = Math.max(1, botState.health);
      replacementState.maxHealth = botState.maxHealth;
      replacementState.ammo = cloneAmmo(botState.ammo);
      replacementState.inventory = cloneInventory(botState.inventory);
      replacementState.kills = botState.kills;
      replacementState.deaths = botState.deaths;
      replacementState.assists = botState.assists;
      replacementState.score = botState.score;
      replacementState.invulnerableUntilMs = botState.invulnerableUntilMs;
      replacementState.lastValidAtMs = nowMs;

      const bot = new AIBotController(replacementState);
      this.bots.set(bot.state.id, bot);
      this.transport.broadcastPlayerSpawn(createSpawnPayload(bot.state));
      return bot;
    });
  }

  public updateBots(nowMs: number, dtSeconds: number, humans: PlayerRuntimeState[]): BotFireDecision[] {
    const allEnemyCandidates: PlayerRuntimeState[] = [];
    for (let i = 0; i < humans.length; i++) {
      allEnemyCandidates.push(clonePlayerState(humans[i]));
    }
    for (const bot of this.bots.values()) {
      allEnemyCandidates.push(clonePlayerState(bot.state));
    }

    const shots: BotFireDecision[] = [];
    for (const bot of this.bots.values()) {
      const shot = bot.update(nowMs, dtSeconds, allEnemyCandidates);
      if (shot) shots.push(shot);
    }
    return shots;
  }

  public getBotSessions(nowMs: number): PlayerSession[] {
    const sessions: PlayerSession[] = [];
    for (const bot of this.bots.values()) {
      sessions.push({
        id: bot.state.id,
        state: clonePlayerState(bot.state),
        clientSequence: 0,
        lastHeardAtMs: nowMs,
      });
    }
    return sessions;
  }

  public getBotCount(teamId?: COBTeamId): number {
    let count = 0;
    for (const bot of this.bots.values()) {
      if (teamId === undefined || bot.state.teamId === teamId) count++;
    }
    return count;
  }

  public clear(reason: string = 'cob_shutdown'): void {
    for (const bot of this.bots.values()) {
      this.transport.broadcastPlayerDespawn(bot.state.id, reason);
    }
    this.bots.clear();
  }

  private spawnBot(teamId: COBTeamId, map: MapConfig, nowMs: number, source: PlayerRuntimeState | null): AIBotController {
    const botId = this.nextBotId();
    const state = createPlayerState(botId, `COB Bot ${this.botSequence}`, teamId, true, nowMs);

    if (source) {
      state.transform = cloneTransform(source.transform);
      state.velocity = source.velocity.clone();
      state.health = Math.max(1, source.health);
      state.ammo = cloneAmmo(source.ammo);
      state.inventory = cloneInventory(source.inventory);
    } else {
      state.transform = this.mapManager.nextSpawnForTeam(map, teamId);
      state.velocity.set(0, 0, 0);
      state.health = state.maxHealth;
    }

    state.connected = false;
    state.isBot = true;
    state.invulnerableUntilMs = nowMs + 1000;
    state.lastValidAtMs = nowMs;

    const bot = new AIBotController(state);
    this.bots.set(bot.state.id, bot);
    this.transport.broadcastPlayerSpawn(createSpawnPayload(bot.state));
    return bot;
  }

  private findLowestPerformanceBot(teamId: COBTeamId): AIBotController | null {
    let selected: AIBotController | null = null;
    let selectedMetric = Number.POSITIVE_INFINITY;
    for (const bot of this.bots.values()) {
      if (bot.state.teamId !== teamId) continue;
      const metric = bot.performanceMetric();
      if (metric < selectedMetric) {
        selected = bot;
        selectedMetric = metric;
      }
    }
    return selected;
  }

  private nextBotId(): string {
    this.botSequence++;
    return `cob_bot_${this.botSequence.toString(36)}`;
  }
}
