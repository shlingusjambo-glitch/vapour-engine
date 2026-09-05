import { WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import {
  CBGO_MAPS,
  CbgoMapId,
  CbgoTeam,
  CROWNFORGE_BEDWARS_DIAMOND_GENERATORS,
  CROWNFORGE_BEDWARS_EMERALD_GENERATORS,
  CROWNFORGE_BEDWARS_TEAM_SPAWNS,
  CROWNFORGE_LOBBY_ROOM,
  CROWNFORGE_PREGAME_SECONDS,
  CROWNFORGE_SKYWARS_SPAWNS,
} from '../src/crownforge/CrownForgeCatalog';

export type RoomKind = 'anarchy' | 'minigame_lobby' | 'minigame_match' | 'custom';
export type RoomPlayerRole = 'player' | 'spectator';
export type AccountRole = 'Player' | 'Moderator' | 'Admin' | 'Owner';
export type MatchPhase = 'LOBBY' | 'QUEUEING' | 'PREGAME' | 'COUNTDOWN' | 'STARTING' | 'IN_MATCH' | 'SUDDEN_DEATH' | 'ENDING' | 'POSTGAME' | 'RETURNING_TO_LOBBY' | 'waiting' | 'pregame' | 'live' | 'ending';

const TELEPORT_GRACE_MS = Math.max(250, Number(process.env.CUBEGAME_TELEPORT_GRACE_MS || '1750'));

export interface RoomSpawn {
  x: number;
  y: number;
  z: number;
}

export interface RoomMeta {
  displayName: string;
  description: string;
  kind: RoomKind;
  dimension: string;
  permanent: boolean;
  pvp: boolean;
  gameModes: string[];
  motd: string;
  serverId?: string;
  color?: string;
  maxPlayers?: number;
  minigameId?: string;
  matchPhase?: MatchPhase;
  roomNumber?: number;
  startsAt?: number;
  startedAt?: number;
  locked?: boolean;
  pregameSeconds?: number;
  spawn?: RoomSpawn;
  pregameSpawn?: RoomSpawn;
  liveSpawn?: RoomSpawn;
  spectatorSpawn?: RoomSpawn;
  createdAt: number;
  minPlayers?: number;
  matchState?: CrownForgeMatchState;
}

export interface CrownForgeMatchState {
  mode: string;
  state: MatchPhase;
  countdown: number;
  teamMode?: 'solo' | 'doubles' | '3v3' | '4v4';
  teams?: Record<string, { color: string; bedAlive?: boolean; alivePlayers: string[]; spectators: string[]; spawn: RoomSpawn; generatorTier?: number }>;
  cbgoTeams?: Record<CbgoTeam, { color: string; alivePlayers: string[]; spawn: RoomSpawn; money: Record<string, number> }>;
  cbgoMap?: CbgoMapId;
  cbgoPhase?: 'VETO' | 'WARMUP' | 'BUY' | 'LIVE' | 'BOMB' | 'ROUND_END';
  cbgoRound?: number;
  cbgoMaxRounds?: number;
  cbgoScores?: Record<CbgoTeam, number>;
  cbgoHalfSwapped?: boolean;
  cbgoBombSite?: 'A' | 'B';
  cbgoVeto?: {
    blueBans: CbgoMapId[];
    redBans: CbgoMapId[];
    finalPair: CbgoMapId[];
    picked: CbgoMapId;
    sideChoice: CbgoTeam;
  };
  cbgoStakes?: { win: number; loss: number };
  cages?: Record<string, RoomSpawn>;
  alivePlayers?: string[];
  spectators?: string[];
  generatorTier?: number;
  diamondTier?: number;
  emeraldTier?: number;
  nextEvent?: string;
  nextEventAt?: number;
  bedsDestroyedAt?: number;
  suddenDeathAt?: number;
  tf2Mode?: 'payload' | 'control_points' | 'koth' | 'ctf';
  tf2CartProgress?: number;
  tf2CapProgress?: number;
  tf2KothTimes?: Record<'RED' | 'BLU', number>;
  tf2KothOwner?: string;
  tf2Scores?: Record<'RED' | 'BLU', number>;
  tf2Winner?: string;
  tf2FlagState?: Record<'RED' | 'BLU', 'home' | 'carried' | 'dropped'>;
  tf2FlagCarrier?: Record<'RED' | 'BLU', string>;
  tf2FlagPos?: Record<'RED' | 'BLU', RoomSpawn>;
  tf2FlagReturnTimer?: Record<'RED' | 'BLU', number>;
}


export interface RoomPlayer {
  uuid: string;
  index: number; // small index for binary packet protocol mapping
  ws: WebSocket;
  username: string;
  skinDataUrl?: string;
  role: RoomPlayerRole;
  ipAddress?: string;
  accountId?: string;
  accountRole?: AccountRole;
}

export interface BanRecord {
  id: string;
  reason: string;
  bannedAt: number;
  expiresAt: number;
  durationMs: number;
  previousOffenses: number;
  source: 'system' | 'staff';
  targetAccountId?: string;
  targetIp?: string;
  targetUsername?: string;
  targetUuid?: string;
  evidenceFlags?: string[];
  staffAccountId?: string;
}

export interface AdminActionRecord {
  adminAccountId: string;
  action: string;
  target?: string;
  reason?: string;
  timestamp: number;
}

const DEFAULT_ROOM_META: Omit<RoomMeta, 'createdAt'> = {
  displayName: 'Custom Room',
  description: 'Player-created multiplayer world.',
  kind: 'custom',
  dimension: 'overworld',
  permanent: false,
  pvp: true,
  gameModes: ['Survival'],
  motd: 'Welcome to the room.',
  color: '#8ca0ff',
};

export class Room {
  public id: string;
  public players: Map<string, RoomPlayer> = new Map();
  public meta: RoomMeta;
  private nextPlayerIdx = 1;

  constructor(id: string, meta?: Partial<RoomMeta>) {
    this.id = id;
    this.meta = {
      ...DEFAULT_ROOM_META,
      displayName: meta?.displayName || id,
      description: meta?.description || DEFAULT_ROOM_META.description,
      kind: meta?.kind || DEFAULT_ROOM_META.kind,
      dimension: meta?.dimension || DEFAULT_ROOM_META.dimension,
      permanent: meta?.permanent ?? DEFAULT_ROOM_META.permanent,
      pvp: meta?.pvp ?? DEFAULT_ROOM_META.pvp,
      gameModes: meta?.gameModes || DEFAULT_ROOM_META.gameModes,
      motd: meta?.motd || DEFAULT_ROOM_META.motd,
      serverId: meta?.serverId,
      color: meta?.color || DEFAULT_ROOM_META.color,
      maxPlayers: meta?.maxPlayers,
      minigameId: meta?.minigameId,
      matchPhase: meta?.matchPhase,
      roomNumber: meta?.roomNumber,
      startsAt: meta?.startsAt,
      startedAt: meta?.startedAt,
      locked: meta?.locked,
      pregameSeconds: meta?.pregameSeconds,
      spawn: meta?.spawn,
      pregameSpawn: meta?.pregameSpawn,
      liveSpawn: meta?.liveSpawn,
      spectatorSpawn: meta?.spectatorSpawn,
      createdAt: meta?.createdAt || Date.now(),
      minPlayers: meta?.minPlayers,
      matchState: meta?.matchState,
    };
  }

  public mergeMeta(meta?: Partial<RoomMeta>): void {
    if (!meta) return;
    const keepLiveCbgo = this.meta.minigameId === 'csgo'
      && meta.minigameId === 'csgo'
      && ['STARTING', 'IN_MATCH', 'SUDDEN_DEATH'].includes(String(this.meta.matchPhase || '').toUpperCase());
    const liveCbgoMeta = keepLiveCbgo ? {
      dimension: this.meta.dimension,
      matchPhase: this.meta.matchPhase,
      matchState: this.meta.matchState,
      spawn: this.meta.spawn,
      liveSpawn: this.meta.liveSpawn,
      spectatorSpawn: this.meta.spectatorSpawn,
      startedAt: this.meta.startedAt,
      locked: this.meta.locked,
    } : null;
    this.meta = {
      ...this.meta,
      ...meta,
      createdAt: this.meta.createdAt,
      gameModes: meta.gameModes || this.meta.gameModes,
    };
    if (liveCbgoMeta) {
      this.meta.dimension = liveCbgoMeta.dimension;
      this.meta.matchPhase = liveCbgoMeta.matchPhase;
      this.meta.matchState = liveCbgoMeta.matchState;
      this.meta.spawn = liveCbgoMeta.spawn;
      this.meta.liveSpawn = liveCbgoMeta.liveSpawn;
      this.meta.spectatorSpawn = liveCbgoMeta.spectatorSpawn;
      this.meta.startedAt = liveCbgoMeta.startedAt;
      this.meta.locked = liveCbgoMeta.locked;
    }
  }

  public addPlayer(uuid: string, ws: WebSocket, username?: string, skinDataUrl?: string, ipAddress?: string, accountId?: string, accountRole?: AccountRole, roleOverride?: RoomPlayerRole): RoomPlayer {
    const role = roleOverride || this.getJoinRole();
    const player: RoomPlayer = {
      uuid,
      index: this.nextPlayerIdx++,
      ws,
      username: username || `Guest ${uuid.substring(0, 4)}`,
      skinDataUrl,
      role,
      ipAddress,
      accountId,
      accountRole
    };

    const existingPlayers = Array.from(this.players.values());
    this.players.set(uuid, player);

    // Notify players already in the room after the newcomer is actually tracked.
    this.broadcast(JSON.stringify({
      type: 'join',
      uuid: player.uuid,
      index: player.index,
      username: player.username,
      skinDataUrl: player.skinDataUrl || null,
      role: player.role,
      room: this.id,
      meta: this.meta,
    }), uuid); // skip sender

    // Tell the new player about existing players only after room membership is
    // stable. This prevents join bursts from racing the first load path when a
    // second desktop client joins CrownForge while someone is already online.
    for (const other of existingPlayers) {
      ws.send(JSON.stringify({
        type: 'join',
        uuid: other.uuid,
        index: other.index,
        username: other.username,
        skinDataUrl: other.skinDataUrl || null,
        role: other.role,
        room: this.id,
        meta: this.meta,
      }));
    }

    return player;
  }

  private getJoinRole(): RoomPlayerRole {
    if (this.meta.kind !== 'minigame_match') return 'player';
    const phase = String(this.meta.matchPhase || '').toUpperCase();
    if (['IN_MATCH', 'SUDDEN_DEATH', 'ENDING', 'POSTGAME', 'RETURNING_TO_LOBBY', 'LIVE'].includes(phase)) return 'spectator';
    if (this.meta.locked) return 'spectator';
    const maxPlayers = this.meta.maxPlayers || 16;
    return this.getActivePlayerCount() >= maxPlayers ? 'spectator' : 'player';
  }

  public getActivePlayerCount(): number {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.role !== 'spectator') count++;
    }
    return count;
  }

  public getSpectatorCount(): number {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.role === 'spectator') count++;
    }
    return count;
  }

  public setPlayerSkin(uuid: string, skinDataUrl: string): void {
    const player = this.players.get(uuid);
    if (!player) return;

    player.skinDataUrl = skinDataUrl;
    this.broadcast(JSON.stringify({
      type: 'skin',
      uuid,
      username: player.username,
      skinDataUrl
    }), uuid);
  }

  public removePlayer(uuid: string): void {
    const player = this.players.get(uuid);
    if (player) {
      this.players.delete(uuid);
      // Notify remaining players
      this.broadcast(JSON.stringify({
        type: 'leave',
        uuid
      }));
    }
  }

  public broadcast(message: any, skipUuid?: string): void {
    const isBinary = message instanceof Buffer || message instanceof ArrayBuffer;
    for (const player of this.players.values()) {
      if (player.uuid !== skipUuid && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(message, { binary: isBinary });
      }
    }
  }

  public toJSON() {
    return {
      id: this.id,
      playerCount: this.players.size,
      activePlayerCount: this.getActivePlayerCount(),
      spectatorCount: this.getSpectatorCount(),
      players: Array.from(this.players.values()).map(p => ({ username: p.username, role: p.role, accountId: p.accountId || null })),
      meta: this.meta,
      permanent: this.meta.permanent,
      uptimeMs: Date.now() - this.meta.createdAt,
    };
  }
}

export class RoomManager {
  public rooms: Map<string, Room> = new Map();
  private matchCounters: Map<string, number> = new Map();
  private bans: Map<string, BanRecord> = new Map();
  private offenseCounts: Map<string, number> = new Map();
  private dataDir: string;
  private bansPath: string;
  private offenseCountsPath: string;
  private adminAuditPath: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.join(__dirname, '../server_data');
    this.bansPath = path.join(this.dataDir, 'bans.json');
    this.offenseCountsPath = path.join(this.dataDir, 'punishment_history.json');
    this.adminAuditPath = path.join(this.dataDir, 'admin_audit.log');
    this.loadBans();
    this.loadOffenseCounts();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  private readJsonFile<T>(filePath: string, fallback: T, label: string): T {
    try {
      if (!fs.existsSync(filePath)) return fallback;

      const text = fs.readFileSync(filePath, 'utf8').trim();
      if (!text) {
        console.warn(`[Bans] ${label} was empty, resetting it to a safe default.`);
        this.writeJsonFileAtomic(filePath, fallback, label);
        return fallback;
      }

      return JSON.parse(text) as T;
    } catch (err) {
      const backupPath = `${filePath}.corrupt-${Date.now()}.bak`;
      try {
        fs.copyFileSync(filePath, backupPath);
      } catch {
        // Best effort only; the important part is that the server can keep booting.
      }

      console.warn(`[Bans] ${label} was unreadable, backed it up to ${path.basename(backupPath)} and reset it.`);
      if (err instanceof Error) console.warn(`[Bans] ${err.message}`);
      this.writeJsonFileAtomic(filePath, fallback, label);
      return fallback;
    }
  }

  private writeJsonFileAtomic(filePath: string, value: unknown, label: string): void {
    this.ensureDataDir();
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // Ignore tmp cleanup errors.
      }
      console.error(`[Bans] Could not save ${label}:`, err);
    }
  }

  private loadBans(): void {
    const raw = this.readJsonFile<BanRecord[]>(this.bansPath, [], 'bans.json');
    const now = Date.now();

    if (Array.isArray(raw)) {
      for (const ban of raw) {
        if (!ban?.id || ban.expiresAt <= now) continue;
        this.bans.set(ban.id, {
          ...ban,
          durationMs: ban.durationMs ?? Math.max(0, ban.expiresAt - ban.bannedAt),
          previousOffenses: ban.previousOffenses ?? 1,
          source: ban.source ?? 'system',
        });
      }
    } else {
      console.warn('[Bans] bans.json was not an array, so it was reset.');
      this.writeJsonFileAtomic(this.bansPath, [], 'bans.json');
    }

    console.log(`[Bans] Loaded ${this.bans.size} active bans from disk.`);
  }

  private saveBans(): void {
    this.writeJsonFileAtomic(this.bansPath, Array.from(this.bans.values()), 'bans.json');
  }

  private loadOffenseCounts(): void {
    const raw = this.readJsonFile<Record<string, number>>(this.offenseCountsPath, {}, 'punishment_history.json');
    for (const [id, count] of Object.entries(raw || {})) {
      if (Number.isFinite(count) && count > 0) this.offenseCounts.set(id, count);
    }
  }

  private saveOffenseCounts(): void {
    this.writeJsonFileAtomic(this.offenseCountsPath, Object.fromEntries(this.offenseCounts), 'punishment_history.json');
  }

  private sanitizeAuditValue<T>(value: T): T {
    if (typeof value === 'string') {
      return value.replace(/[\r\n\u2028\u2029]/g, ' ') as T;
    }
    if (Array.isArray(value)) {
      return value.map(item => this.sanitizeAuditValue(item)) as T;
    }
    if (value && typeof value === 'object') {
      const clean: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        clean[key] = this.sanitizeAuditValue(entry);
      }
      return clean as T;
    }
    return value;
  }

  private logAdminAction(record: AdminActionRecord): void {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      fs.appendFileSync(this.adminAuditPath, JSON.stringify(this.sanitizeAuditValue(record)) + '\n');
    } catch (err) {
      console.error('[Admin] Could not append admin_audit.log:', err);
    }
  }

  /** Write a human-readable bans.txt for a specific permanent room. */
  private writeBansTxt(roomId: string): void {
    try {
      const roomDir = path.join(this.dataDir, roomId);
      if (!fs.existsSync(roomDir)) fs.mkdirSync(roomDir, { recursive: true });
      const usernameBans = Array.from(this.bans.values())
        .filter(b => b.id.startsWith('user:') && Date.now() < b.expiresAt)
        .map(b => b.id.replace(/^user:/, ''));
      fs.writeFileSync(path.join(roomDir, 'bans.txt'), usernameBans.join('\n'));
    } catch (err) {
      console.error(`[Bans] Could not write bans.txt for ${roomId}:`, err);
    }
  }

  /** Auto-unban the server owner's local IP addresses so they can never lock themselves out. */
  public unbanLocalAddresses(localIps: string[]): void {
    let changed = false;
    for (const ip of localIps) {
      const norm = this.normalizeBanId(ip);
      if (norm && this.bans.has(norm)) {
        this.bans.delete(norm);
        changed = true;
        console.log(`[Bans] Auto-unbanned local address: ${norm}`);
      }
    }
    if (changed) this.saveBans();
  }

  // ── Admin-only ban controls ────────────────────────────────────────────────

  public adminUnbanAll(requestingAdminId: string, confirm = false, reason = 'admin bulk unban'): { ok: boolean; unbanned: number; error?: string } {
    if (!requestingAdminId) return { ok: false, unbanned: 0, error: 'Missing admin account ID.' };
    if (!confirm) return { ok: false, unbanned: 0, error: 'adminUnbanAll requires confirm=true.' };

    const count = this.bans.size;
    this.bans.clear();
    this.saveBans();
    for (const room of Array.from(this.rooms.values())) {
      if (room.meta.permanent) this.writeBansTxt(room.id);
    }
    this.logAdminAction({ adminAccountId: requestingAdminId, action: 'unban_all', reason, timestamp: Date.now() });
    console.log(`[Bans] Admin ${requestingAdminId} cleared all ${count} bans.`);
    return { ok: true, unbanned: count };
  }

  public adminUnbanById(requestingAdminId: string, identifier: string, reason = 'admin unban'): boolean {
    if (!requestingAdminId) return false;
    const removed = this.removeBanIdentifiers(identifier);
    if (removed) {
      this.logAdminAction({ adminAccountId: requestingAdminId, action: 'unban_by_id', target: identifier, reason, timestamp: Date.now() });
    }
    return removed;
  }

  public adminUnbanByIp(requestingAdminId: string, targetIp: string, reason = 'admin IP unban'): boolean {
    if (!requestingAdminId) return false;
    const ipId = this.normalizeBanId(targetIp);
    const removed = ipId ? this.removeBanIdentifiers(ipId) : false;
    if (removed) {
      this.logAdminAction({ adminAccountId: requestingAdminId, action: 'unban_by_ip', target: targetIp, reason, timestamp: Date.now() });
    }
    return removed;
  }

  public adminListBans(requestingAdminId: string): BanRecord[] {
    if (!requestingAdminId) return [];
    this.logAdminAction({ adminAccountId: requestingAdminId, action: 'list_bans', timestamp: Date.now() });
    return this.listBans();
  }

  /**
   * Compatibility wrappers intentionally refuse public unban operations.
   * All real unban calls must flow through adminUnban* after server-side auth.
   */
  public unbanAll(): number {
    console.warn('[Bans] Refused unsafe public unbanAll(). Use adminUnbanAll(requestingAdminId, true).');
    return 0;
  }

  public unbanById(_identifier: string): boolean {
    console.warn('[Bans] Refused unsafe public unbanById(). Use adminUnbanById(requestingAdminId, target).');
    return false;
  }

  private removeBanIdentifiers(identifier: string): boolean {
    const candidates = new Set<string>();
    const norm = this.normalizeBanId(identifier);
    if (norm) candidates.add(norm);
    const byUser = this.normalizeBanId(`user:${identifier}`);
    if (byUser) candidates.add(byUser);
    const byAcct = this.normalizeBanId(`acct:${identifier}`);
    if (byAcct) candidates.add(byAcct);

    let removed = false;
    for (const id of candidates) {
      if (this.bans.delete(id)) removed = true;
    }
    if (removed) {
      this.saveBans();
      for (const room of Array.from(this.rooms.values())) {
        if (room.meta.permanent) this.writeBansTxt(room.id);
      }
    }
    return removed;
  }

  public listBans(): BanRecord[] {
    const now = Date.now();
    return Array.from(this.bans.values()).filter(b => b.expiresAt > now);
  }

  public getOrCreateRoom(roomId: string, meta?: Partial<RoomMeta>): Room {
    const cleanId = this.normalizeRoomId(roomId);
    let room = this.rooms.get(cleanId);
    if (!room) {
      room = new Room(cleanId, meta);
      this.rooms.set(cleanId, room);
      console.log(`Created new room: ${cleanId}${room.meta.permanent ? ' (permanent)' : ''}`);
    } else {
      room.mergeMeta(meta);
    }
    return room;
  }

  public bootstrapPermanentRooms(rooms: Array<{ id: string; meta: Partial<RoomMeta> }>): void {
    for (const config of rooms) {
      this.getOrCreateRoom(config.id, { ...config.meta, permanent: true });
    }
  }

  public getPlayerSession(uuid: string): { room: Room; player: RoomPlayer } | null {
    for (const room of Array.from(this.rooms.values())) {
      const player = room.players.get(uuid);
      if (player) return { room, player };
    }
    return null;
  }

  public movePlayerToRoom(uuid: string, targetRoomOrId: Room | string, roleOverride?: RoomPlayerRole): RoomPlayer | null {
    const session = this.getPlayerSession(uuid);
    if (!session) return null;
    const destination = typeof targetRoomOrId === 'string'
      ? this.getOrCreateRoom(targetRoomOrId)
      : targetRoomOrId;

    if (session.room.id === destination.id) {
      if (roleOverride) session.player.role = roleOverride;
      return session.player;
    }

    const previous = session.player;
    const sourceRoom = session.room;
    sourceRoom.players.delete(uuid);
    sourceRoom.broadcast(JSON.stringify({ type: 'leave', uuid }));

    const moved = destination.addPlayer(
      previous.uuid,
      previous.ws,
      previous.username,
      previous.skinDataUrl,
      previous.ipAddress,
      previous.accountId,
      previous.accountRole,
      roleOverride
    );
    (moved as any).__teleportGraceUntil = Date.now() + TELEPORT_GRACE_MS;
    (moved as any).__teleportGraceAnchor = this.getSpawnForPlayer(destination, moved);
    (moved as any).__antiCheatMove = null;
    (moved as any).__lastMove = null;
    (moved as any).__crownforgeTeam = (previous as any).__crownforgeTeam;
    (moved as any).__skywarsSpawnIndex = (previous as any).__skywarsSpawnIndex;

    if (sourceRoom.players.size === 0 && !sourceRoom.meta.permanent) {
      this.rooms.delete(sourceRoom.id);
      console.log(`Removed empty room: ${sourceRoom.id}`);
    }

    return moved;
  }

  public findBestMatchRoom(config: {
    id: string;
    baseRoom: string;
    title: string;
    description: string;
    dimension: string;
    pvp: boolean;
    gameModes: string[];
    motd: string;
    color: string;
    maxPlayers: number;
    liveSpawn: RoomSpawn;
    pregameSpawn: RoomSpawn;
    spectatorSpawn: RoomSpawn;
  }): Room {
    const available = Array.from(this.rooms.values())
      .filter(room => room.meta.kind === 'minigame_match')
      .filter(room => room.meta.minigameId === config.id)
      .filter(room => !room.meta.locked)
      .filter(room => ['WAITING', 'QUEUEING', 'PREGAME', 'COUNTDOWN', 'waiting', 'pregame'].includes(String(room.meta.matchPhase || 'PREGAME')))
      .filter(room => room.getActivePlayerCount() < (room.meta.maxPlayers || config.maxPlayers))
      .sort((a, b) => b.getActivePlayerCount() - a.getActivePlayerCount());

    if (available[0]) return available[0];

    const nextNumber = (this.matchCounters.get(config.baseRoom) || 0) + 1;
    this.matchCounters.set(config.baseRoom, nextNumber);

    const roomId = `${config.baseRoom}_${String(nextNumber).padStart(2, '0')}`;
    return this.getOrCreateRoom(roomId, {
      displayName: `${config.title} #${nextNumber}`,
      description: config.description,
      kind: 'minigame_match',
      dimension: config.dimension,
      permanent: false,
      pvp: config.pvp,
      gameModes: config.gameModes,
      motd: config.motd,
      serverId: 'crownforge_network',
      color: config.color,
      maxPlayers: config.maxPlayers,
      minigameId: config.id,
      matchPhase: 'PREGAME',
      roomNumber: nextNumber,
      startsAt: Date.now() + (CROWNFORGE_PREGAME_SECONDS * 1000),
      pregameSeconds: CROWNFORGE_PREGAME_SECONDS,
      minPlayers: this.getDefaultMinPlayers(config.id),
      matchState: this.createInitialMatchState(config.id, config.maxPlayers, Date.now()),
      locked: false,
      spawn: config.pregameSpawn,
      pregameSpawn: config.pregameSpawn,
      liveSpawn: config.liveSpawn,
      spectatorSpawn: config.spectatorSpawn,
    });
  }

  public tickMinigameRooms(now = Date.now()): void {
    for (const room of Array.from(this.rooms.values())) {
      try {
      if (room.meta.kind !== 'minigame_match') continue;
      if (room.players.size === 0 && !room.meta.permanent) {
        if (now - room.meta.createdAt > 15_000) {
          this.rooms.delete(room.id);
          console.log(`Removed abandoned match room: ${room.id}`);
        }
        continue;
      }

      this.ensureMatchState(room, now);
      const phase = this.normalizedPhase(room.meta.matchPhase);
      const minPlayers = room.meta.minPlayers ?? this.getDefaultMinPlayers(room.meta.minigameId || '');
      const active = room.getActivePlayerCount();
      const startAllowed = this.canStartWithCurrentPlayers(room, active, minPlayers);

      if (phase === 'PREGAME' || phase === 'QUEUEING' || phase === 'COUNTDOWN') {
        if (room.meta.minigameId === 'csgo') {
          room.meta.matchPhase = 'PREGAME';
          this.updateMatchState(room, now, 'Waiting in CBGO menu');
          continue;
        }
        // BedWars must not be held hostage by player count. The timer starts when
        // the first player enters and reaches 0 exactly once unless that solo
        // player explicitly asks to wait longer.
        if (!room.meta.startsAt || (room.meta.startsAt < now && phase !== 'COUNTDOWN')) {
          room.meta.startsAt = now + ((room.meta.pregameSeconds ?? CROWNFORGE_PREGAME_SECONDS) * 1000);
        }

        if (!startAllowed) {
          room.meta.matchPhase = 'QUEUEING';
          this.updateMatchState(room, now, `Waiting for players: ${active}/${minPlayers}`);
          const lastNotice = (room as any).__lastNeedPlayersNotice || 0;
          if (now - lastNotice > 10_000) {
            (room as any).__lastNeedPlayersNotice = now;
            room.broadcast(JSON.stringify({
              type: 'chat',
              sender: 'Matchmaker',
              text: `Need ${Math.max(0, minPlayers - active)} more player${Math.max(0, minPlayers - active) === 1 ? '' : 's'} to start ${room.meta.displayName}.`
            }));
          }
          this.broadcastServerInfo(room, now);
          continue;
        }

        if (room.meta.minigameId === 'bedwars' && active === 1) {
          this.promptSoloBedWarsPlayer(room, now);
        }
        const secondsLeft = Math.max(0, Math.ceil((room.meta.startsAt - now) / 1000));
        room.meta.matchPhase = secondsLeft <= 10 ? 'COUNTDOWN' : 'PREGAME';
        this.updateMatchState(room, now, secondsLeft <= 10 ? 'Match starting' : 'Pregame lobby');

        const lastCountdown = (room as any).__lastCountdownSecond;
        if (secondsLeft !== lastCountdown && (secondsLeft === 60 || secondsLeft === 45 || secondsLeft === 30 || secondsLeft === 15 || secondsLeft <= 10)) {
          (room as any).__lastCountdownSecond = secondsLeft;
          room.broadcast(JSON.stringify({
            type: 'chat',
            sender: 'Matchmaker',
            text: secondsLeft > 0 ? `Match starts in ${secondsLeft}s. Players: ${active}/${room.meta.maxPlayers || 16}.` : 'Match starting now.'
          }));
          this.broadcastServerInfo(room, now);
        }

        if (secondsLeft <= 0) {
          room.meta.matchPhase = 'STARTING';
          this.prepareMatchStart(room, now);
          room.meta.matchPhase = 'IN_MATCH';
          room.meta.startedAt = now;
          room.meta.locked = true;
          room.meta.spawn = room.meta.liveSpawn || room.meta.spawn;
          this.updateMatchState(room, now, 'In match');
          room.broadcast(JSON.stringify({
            type: 'chat',
            sender: 'Matchmaker',
            text: `${room.meta.displayName} started. Protected arena blocks will reset; only player-placed blocks are temporary.`
          }));
          this.sendMatchStart(room);
        }
      } else if (phase === 'IN_MATCH') {
        this.tickLiveMatch(room, now);
      } else if (phase === 'SUDDEN_DEATH') {
        this.tickSuddenDeath(room, now);
      } else if (phase === 'ENDING') {
        room.meta.matchPhase = 'POSTGAME';
        room.meta.startsAt = now + 15_000;
        this.updateMatchState(room, now, 'Postgame results');
        room.broadcast(JSON.stringify({ type: 'chat', sender: 'Matchmaker', text: 'Round ended. Returning to CrownForge lobby soon.' }));
        this.broadcastServerInfo(room, now);
      } else if (phase === 'POSTGAME') {
        if (now >= (room.meta.startsAt || now)) {
          room.meta.matchPhase = 'RETURNING_TO_LOBBY';
          this.returnRoomToLobby(room);
        }
      }
      } catch (err) {
        console.warn(`[RoomManager] tick failed for ${room.id}:`, err);
      }
    }
  }

  public forceStartMinigameRoom(room: Room, now = Date.now()): boolean {
    const phase = this.normalizedPhase(room.meta.matchPhase);
    if (room.meta.kind !== 'minigame_match') return false;
    if (!['PREGAME', 'QUEUEING', 'COUNTDOWN'].includes(phase)) return false;
    if (room.getActivePlayerCount() <= 0) return false;
    room.meta.startsAt = now;
    room.meta.matchPhase = 'COUNTDOWN';
    this.updateMatchState(room, now, 'Force starting');
    room.broadcast(JSON.stringify({
      type: 'chat',
      sender: 'Matchmaker',
      text: `${room.meta.displayName} is starting now.`
    }));
    this.broadcastServerInfo(room, now);
    return true;
  }

  public extendPregameRoom(room: Room, seconds = CROWNFORGE_PREGAME_SECONDS, now = Date.now()): boolean {
    const phase = this.normalizedPhase(room.meta.matchPhase);
    if (room.meta.kind !== 'minigame_match') return false;
    if (!['PREGAME', 'QUEUEING', 'COUNTDOWN'].includes(phase)) return false;
    const extensionMs = Math.max(10, Math.floor(seconds)) * 1000;
    room.meta.startsAt = Math.max(room.meta.startsAt || now, now) + extensionMs;
    room.meta.matchPhase = 'PREGAME';
    (room as any).__lastSoloChoicePrompt = 0;
    this.updateMatchState(room, now, 'Waiting a little longer');
    room.broadcast(JSON.stringify({
      type: 'chat',
      sender: 'Matchmaker',
      text: `${room.meta.displayName} timer extended by ${Math.ceil(extensionMs / 1000)}s.`
    }));
    this.broadcastServerInfo(room, now);
    return true;
  }

  public getSpawnForPlayer(room: Room, player: RoomPlayer): RoomSpawn {
    if (room.meta.kind === 'minigame_match') {
      const phase = this.normalizedPhase(room.meta.matchPhase);
      if (player.role === 'spectator') {
        return room.meta.spectatorSpawn || room.meta.liveSpawn || room.meta.spawn || { x: 8, y: 82, z: 8 };
      }
      if (phase === 'PREGAME' || phase === 'QUEUEING' || phase === 'COUNTDOWN') {
        return room.meta.pregameSpawn || room.meta.spawn || { x: 8, y: 74, z: 96 };
      }
      return this.getLiveSpawnForPlayer(room, player);
    }

    return room.meta.spawn || { x: 8.5, y: 65.05, z: 8.5 };
  }

  private canStartWithCurrentPlayers(room: Room, active: number, minPlayers: number): boolean {
    if (active <= 0) return false;
    if (room.meta.minigameId === 'bedwars') return true;
    return active >= minPlayers;
  }

  private promptSoloBedWarsPlayer(room: Room, now: number): void {
    const lastPrompt = (room as any).__lastSoloChoicePrompt || 0;
    if (now - lastPrompt < 15_000) return;
    (room as any).__lastSoloChoicePrompt = now;
    const secondsLeft = Math.max(0, Math.ceil(((room.meta.startsAt || now) - now) / 1000));
    room.broadcast(JSON.stringify({
      type: 'chat',
      sender: 'BedWars',
      text: `Only you are queued. Type /start to begin now, /wait to add 60s, /lobby to leave, or do nothing and the round starts in ${secondsLeft}s.`
    }));
  }

  private normalizedPhase(phase?: MatchPhase): string {
    const clean = String(phase || 'PREGAME').toUpperCase();
    if (clean === 'WAITING') return 'QUEUEING';
    if (clean === 'LIVE') return 'IN_MATCH';
    if (clean === 'PREGAME') return 'PREGAME';
    if (clean === 'ENDING') return 'ENDING';
    return clean;
  }

  private getDefaultMinPlayers(mode: string): number {
    const env = Number(process.env.CROWNFORGE_MIN_PLAYERS || '1');
    if (Number.isFinite(env) && env >= 1) return Math.floor(env);
    return mode === 'duels' ? 2 : 2;
  }

  private createInitialMatchState(mode: string, maxPlayers: number, now: number): CrownForgeMatchState {
    const state: CrownForgeMatchState = {
      mode,
      state: 'PREGAME',
      countdown: CROWNFORGE_PREGAME_SECONDS,
      alivePlayers: [],
      spectators: [],
      generatorTier: 1,
      diamondTier: 1,
      emeraldTier: 1,
      nextEvent: mode === 'bedwars' ? 'Diamond II' : mode === 'skywars' ? 'Chest Refill I' : 'Sudden Death',
      nextEventAt: now + 5 * 60_000,
    };

    if (mode === 'bedwars') {
      state.teamMode = maxPlayers <= 8 ? 'doubles' : '4v4';
      state.teams = this.createBedWarsTeams();
      state.bedsDestroyedAt = now + 20 * 60_000;
      state.suddenDeathAt = now + 25 * 60_000;
    }
    if (mode === 'skywars') {
      state.cages = {};
      state.nextEvent = 'Chest Refill I';
      state.nextEventAt = now + 4 * 60_000;
      state.suddenDeathAt = now + 12 * 60_000;
    }
    if (mode === 'csgo') {
      const map = CBGO_MAPS[Math.floor(Math.random() * CBGO_MAPS.length)];
      state.cbgoMap = map.id;
      state.cbgoTeams = this.createCbgoTeams(map.id);
      state.cbgoPhase = 'VETO';
      state.cbgoRound = 1;
      state.cbgoMaxRounds = 24;
      state.cbgoScores = { Terrorists: 0, 'Counter-Terrorists': 0 };
      state.cbgoStakes = this.createCbgoStakes(10);
      state.cbgoVeto = this.createCbgoVeto(map.id);
      state.nextEvent = 'Premier Map Veto';
      state.nextEventAt = now + 15_000;
      state.suddenDeathAt = now + 30 * 60_000;
    }
    if (mode === 'tf2') {
      state.teams = {
        RED: { color: '#ff4444', alivePlayers: [], spectators: [], spawn: { x: -48, y: 65, z: 0 } },
        BLU: { color: '#4444ff', alivePlayers: [], spectators: [], spawn: { x: 48, y: 65, z: 0 } },
      };
      state.tf2Mode = 'payload';
      state.tf2CartProgress = 0;
      state.tf2CapProgress = 0;
      state.tf2KothTimes = { RED: 180, BLU: 180 };
      state.tf2KothOwner = '';
      state.tf2Scores = { RED: 0, BLU: 0 };
      state.tf2Winner = '';
      state.tf2FlagState = { RED: 'home', BLU: 'home' };
      state.tf2FlagCarrier = { RED: '', BLU: '' };
      state.tf2FlagPos = { RED: { x: -76, y: 64, z: 0 }, BLU: { x: 76, y: 64, z: 0 } };
      state.tf2FlagReturnTimer = { RED: 0, BLU: 0 };
      state.nextEvent = 'Match Start';
      state.nextEventAt = now + 5000;
      state.suddenDeathAt = now + 30 * 60_000;
    }
    return state;
  }

  private createCbgoTeams(mapId: CbgoMapId): CrownForgeMatchState['cbgoTeams'] {
    const map = CBGO_MAPS.find(entry => entry.id === mapId) || CBGO_MAPS[0];
    return {
      Terrorists: { color: '#f0b84f', alivePlayers: [], spawn: map.terroristSpawn, money: {} },
      'Counter-Terrorists': { color: '#6fb7ff', alivePlayers: [], spawn: map.counterTerroristSpawn, money: {} },
    };
  }

  private createCbgoVeto(pickedMap: CbgoMapId): NonNullable<CrownForgeMatchState['cbgoVeto']> {
    const pool = CBGO_MAPS.map(map => map.id);
    const shuffled = pool
      .filter(id => id !== pickedMap)
      .sort(() => Math.random() - 0.5);
    const decoy = shuffled[5] || shuffled[0] || pickedMap;
    return {
      blueBans: shuffled.slice(0, 2),
      redBans: shuffled.slice(2, 5),
      finalPair: [pickedMap, decoy].filter((id, index, arr) => arr.indexOf(id) === index) as CbgoMapId[],
      picked: pickedMap,
      sideChoice: Math.random() < 0.5 ? 'Terrorists' : 'Counter-Terrorists',
    };
  }

  private createCbgoStakes(playerCount: number): { win: number; loss: number } {
    const pressure = Math.max(0, Math.min(70, (playerCount - 2) * 8));
    const swing = Math.floor(Math.random() * 36);
    return { win: 105 + pressure + swing, loss: -(95 + Math.floor(pressure * 0.72) + Math.floor(swing * 0.65)) };
  }

  private createBedWarsTeams(): CrownForgeMatchState['teams'] {
    return {
      Red: { color: '#ff5555', bedAlive: true, alivePlayers: [], spectators: [], spawn: CROWNFORGE_BEDWARS_TEAM_SPAWNS.Red, generatorTier: 1 },
      Blue: { color: '#5599ff', bedAlive: true, alivePlayers: [], spectators: [], spawn: CROWNFORGE_BEDWARS_TEAM_SPAWNS.Blue, generatorTier: 1 },
      Green: { color: '#55ff77', bedAlive: true, alivePlayers: [], spectators: [], spawn: CROWNFORGE_BEDWARS_TEAM_SPAWNS.Green, generatorTier: 1 },
      Yellow: { color: '#ffe066', bedAlive: true, alivePlayers: [], spectators: [], spawn: CROWNFORGE_BEDWARS_TEAM_SPAWNS.Yellow, generatorTier: 1 },
    };
  }

  private ensureMatchState(room: Room, now: number): void {
    if (!room.meta.matchState) {
      room.meta.matchState = this.createInitialMatchState(room.meta.minigameId || 'unknown', room.meta.maxPlayers || 16, now);
    }
    room.meta.matchState.state = this.normalizedPhase(room.meta.matchPhase) as MatchPhase;
    const countdownAt = room.meta.minigameId === 'csgo'
      ? (room.meta.matchState.nextEventAt || now)
      : (room.meta.startsAt || now);
    room.meta.matchState.countdown = Math.max(0, Math.ceil((countdownAt - now) / 1000));
    room.meta.matchState.alivePlayers = Array.from(room.players.values()).filter(p => p.role !== 'spectator').map(p => p.username);
    room.meta.matchState.spectators = Array.from(room.players.values()).filter(p => p.role === 'spectator').map(p => p.username);
  }

  private updateMatchState(room: Room, now: number, nextEventFallback: string): void {
    this.ensureMatchState(room, now);
    const state = room.meta.matchState!;
    state.state = this.normalizedPhase(room.meta.matchPhase) as MatchPhase;
    const countdownAt = room.meta.minigameId === 'csgo'
      ? (state.nextEventAt || now)
      : (room.meta.startsAt || now);
    state.countdown = Math.max(0, Math.ceil((countdownAt - now) / 1000));
    if (!state.nextEvent) state.nextEvent = nextEventFallback;
    room.broadcast(JSON.stringify({
      type: 'crownforgeMatch',
      room: room.id,
      matchPhase: room.meta.matchPhase,
      matchState: state,
      meta: room.meta,
    }));
  }

  private prepareMatchStart(room: Room, now: number): void {
    this.ensureMatchState(room, now);
    const state = room.meta.matchState!;
    state.state = 'STARTING';
    state.alivePlayers = [];
    state.spectators = [];

    if (room.meta.minigameId === 'bedwars') {
      state.teams = this.createBedWarsTeams();
      const teams = state.teams!;
      const teamNames = Object.keys(teams);
      let idx = 0;
      for (const player of room.players.values()) {
        if (player.role === 'spectator') continue;
        const teamName = teamNames[idx++ % teamNames.length];
        const team = teams[teamName];
        team.alivePlayers.push(player.username);
        (player as any).__crownforgeTeam = teamName;
      }
      state.nextEvent = 'Diamond II';
      state.nextEventAt = now + 5 * 60_000;
      state.bedsDestroyedAt = now + 20 * 60_000;
      state.suddenDeathAt = now + 25 * 60_000;
      this.resetTemporaryArenaBlocks(room);
      this.clearGeneratorDrops(room);
    } else if (room.meta.minigameId === 'skywars') {
      state.cages = {};
      let idx = 0;
      for (const player of room.players.values()) {
        if (player.role === 'spectator') continue;
        const spawn = this.getSkyWarsSpawn(idx++);
        state.cages[player.username] = spawn;
        state.alivePlayers?.push(player.username);
        (player as any).__skywarsSpawnIndex = idx - 1;
      }
      state.nextEvent = 'Chest Refill I';
      state.nextEventAt = now + 4 * 60_000;
      state.suddenDeathAt = now + 12 * 60_000;
      this.resetTemporaryArenaBlocks(room);
    } else if (room.meta.minigameId === 'csgo') {
      this.beginCbgoRound(room, now, true);
    }
  }

  private beginCbgoRound(room: Room, now: number, includeWarmup = false): void {
    this.ensureMatchState(room, now);
    const state = room.meta.matchState!;
    const requestedMap = String((room as any).__cbgoNextMap || state.cbgoMap || '');
    const map = CBGO_MAPS.find(entry => entry.id === requestedMap) || CBGO_MAPS[0];
    state.cbgoMap = map.id;
    state.cbgoTeams = this.createCbgoTeams(map.id);
    state.cbgoMaxRounds = 24;
    state.cbgoRound = Math.max(1, Math.min(state.cbgoMaxRounds, Number(state.cbgoRound || 1)));
    state.cbgoScores ||= { Terrorists: 0, 'Counter-Terrorists': 0 };
    state.cbgoHalfSwapped = (state.cbgoRound || 1) > 12;
    state.cbgoBombSite = undefined;
    state.state = 'IN_MATCH';
    state.alivePlayers = [];
    state.spectators = [];

    const teamNames: CbgoTeam[] = state.cbgoHalfSwapped
      ? ['Counter-Terrorists', 'Terrorists']
      : ['Terrorists', 'Counter-Terrorists'];
    let idx = 0;
    for (const player of room.players.values()) {
      player.role = 'player';
      const teamName = teamNames[idx++ % teamNames.length];
      const roundStartMoney = state.cbgoRound === 1 || state.cbgoRound === 13
        ? 800
        : Math.max(800, Number((player as any).__cbgoMoney || 800));
      const cbgoTeams = state.cbgoTeams!;
      cbgoTeams[teamName].alivePlayers.push(player.username);
      cbgoTeams[teamName].money[player.username] = roundStartMoney;
      (player as any).__cbgoTeam = teamName;
      (player as any).__cbgoMoney = roundStartMoney;
      (player as any).__lastCbgoAttacker = '';
      state.alivePlayers?.push(player.username);
    }

    room.meta.dimension = map.id;
    room.meta.liveSpawn = map.terroristSpawn;
    room.meta.spawn = map.terroristSpawn;
    room.meta.spectatorSpawn = map.spectatorSpawn;
    room.meta.matchPhase = 'IN_MATCH';
    room.meta.startedAt ||= now;
    room.meta.locked = false;
    state.cbgoPhase = includeWarmup ? 'WARMUP' : 'BUY';
    state.nextEvent = includeWarmup ? 'Warmup ends' : 'Buy phase ends';
    state.nextEventAt = now + (includeWarmup ? 15_000 : 15_000);
    state.suddenDeathAt = now + 30 * 60_000;
    this.resetTemporaryArenaBlocks(room);
  }

  private getLiveSpawnForPlayer(room: Room, player: RoomPlayer): RoomSpawn {
    const mode = room.meta.minigameId || '';
    if (mode === 'bedwars') {
      const state = room.meta.matchState;
      const teamName = (player as any).__crownforgeTeam || this.assignPersistentTeam(room, player);
      const team = state?.teams?.[teamName];
      return team?.spawn || room.meta.liveSpawn || CROWNFORGE_BEDWARS_TEAM_SPAWNS.Red;
    }
    if (mode === 'skywars') {
      const index = (player as any).__skywarsSpawnIndex ?? Math.max(0, player.index - 1);
      return this.getSkyWarsSpawn(index);
    }
    if (mode === 'csgo') {
      const state = room.meta.matchState;
      const team = ((player as any).__cbgoTeam || this.assignCbgoTeam(room, player)) as CbgoTeam;
      return state?.cbgoTeams?.[team]?.spawn || room.meta.liveSpawn || room.meta.spawn || { x: 0, y: 65, z: 0 };
    }
    if (mode === 'tf2') {
      const team = (player as any).__tf2Team || this.assignTf2Team(room, player);
      const dimension = room.meta.dimension || 'tf2_payload';
      if (dimension === 'tf2_cp') {
        return team === 'RED' ? { x: 70, y: 68, z: 0 } : { x: -70, y: 68, z: 0 };
      }
      if (dimension === 'tf2_payload') {
        return team === 'RED' ? { x: 72, y: 68, z: 0 } : { x: -72, y: 68, z: 0 };
      }
      if (dimension === 'tf2_koth') {
        return team === 'RED' ? { x: 42, y: 68, z: 0 } : { x: -42, y: 68, z: 0 };
      }
      if (dimension === 'tf2_ctf') {
        return team === 'RED' ? { x: -62, y: 68, z: 0 } : { x: 62, y: 68, z: 0 };
      }
      return team === 'RED' ? { x: 48, y: 65, z: 0 } : { x: -48, y: 65, z: 0 };
    }
    return room.meta.liveSpawn || room.meta.spawn || { x: 8, y: 68, z: 8 };
  }

  private assignCbgoTeam(room: Room, player: RoomPlayer): CbgoTeam {
    this.ensureMatchState(room, Date.now());
    const state = room.meta.matchState!;
    if (!state.cbgoTeams) state.cbgoTeams = this.createCbgoTeams((state.cbgoMap || 'cbgo_mirage') as CbgoMapId);
    const teams = state.cbgoTeams!;
    const target = teams.Terrorists.alivePlayers.length <= teams['Counter-Terrorists'].alivePlayers.length
      ? 'Terrorists'
      : 'Counter-Terrorists';
    if (!teams[target].alivePlayers.includes(player.username)) teams[target].alivePlayers.push(player.username);
    teams[target].money[player.username] = Math.max(800, Number((player as any).__cbgoMoney || 800));
    (player as any).__cbgoTeam = target;
    return target;
  }

  private assignPersistentTeam(room: Room, player: RoomPlayer): string {
    this.ensureMatchState(room, Date.now());
    const state = room.meta.matchState!;
    if (!state.teams) state.teams = this.createBedWarsTeams();
    const teams = state.teams!;
    const teamNames = Object.keys(teams);
    const target = teamNames.sort((a, b) => teams[a].alivePlayers.length - teams[b].alivePlayers.length)[0] || 'Red';
    const team = teams[target];
    if (!team.alivePlayers.includes(player.username)) team.alivePlayers.push(player.username);
    (player as any).__crownforgeTeam = target;
    return target;
  }

  private getSkyWarsSpawn(index: number): RoomSpawn {
    return CROWNFORGE_SKYWARS_SPAWNS[Math.abs(index) % CROWNFORGE_SKYWARS_SPAWNS.length];
  }

  private tickLiveMatch(room: Room, now: number): void {
    this.ensureMatchState(room, now);
    const state = room.meta.matchState!;
    const liveFor = now - (room.meta.startedAt || now);

    if (room.meta.minigameId === 'bedwars') {
      this.tickBedWarsGenerators(room, now);
      if (state.nextEventAt && now >= state.nextEventAt) {
        if (state.nextEvent === 'Diamond II') {
          state.diamondTier = 2; state.nextEvent = 'Emerald II'; state.nextEventAt = now + 5 * 60_000;
        } else if (state.nextEvent === 'Emerald II') {
          state.emeraldTier = 2; state.nextEvent = 'Diamond III'; state.nextEventAt = now + 5 * 60_000;
        } else if (state.nextEvent === 'Diamond III') {
          state.diamondTier = 3; state.nextEvent = 'Beds Destroyed'; state.nextEventAt = state.bedsDestroyedAt || now + 5 * 60_000;
        } else if (state.nextEvent === 'Beds Destroyed') {
          if (state.teams) for (const team of Object.values(state.teams)) team.bedAlive = false;
          state.nextEvent = 'Sudden Death'; state.nextEventAt = state.suddenDeathAt || now + 5 * 60_000;
          room.broadcast(JSON.stringify({ type: 'chat', sender: 'BedWars', text: 'All beds have been destroyed. Final deaths are now active.' }));
        } else {
          room.meta.matchPhase = 'SUDDEN_DEATH';
          state.state = 'SUDDEN_DEATH';
          state.nextEvent = 'Game End';
          state.nextEventAt = now + 5 * 60_000;
          room.broadcast(JSON.stringify({ type: 'chat', sender: 'BedWars', text: 'Sudden Death: aggressive endgame pressure has started.' }));
        }
        this.broadcastServerInfo(room, now);
      }
    } else if (room.meta.minigameId === 'skywars') {
      if (state.nextEventAt && now >= state.nextEventAt) {
        room.broadcast(JSON.stringify({ type: 'chat', sender: 'SkyWars', text: `${state.nextEvent || 'Chest Refill'}: island and center chests have refilled with stronger loot.` }));
        state.nextEvent = state.nextEvent === 'Chest Refill I' ? 'Chest Refill II' : 'Sudden Death';
        state.nextEventAt = state.nextEvent === 'Sudden Death' ? (state.suddenDeathAt || now + 4 * 60_000) : now + 4 * 60_000;
        this.broadcastServerInfo(room, now);
      }
      if (state.suddenDeathAt && now >= state.suddenDeathAt) {
        room.meta.matchPhase = 'SUDDEN_DEATH';
        state.state = 'SUDDEN_DEATH';
      }
    } else if (room.meta.minigameId === 'csgo') {
      this.tickCbgoRound(room, now);
    } else if (room.meta.minigameId === 'tf2') {
      this.tickTf2Match(room, now);
    }

    if (liveFor > 30 * 60_000) room.meta.matchPhase = 'ENDING';
    this.updateMatchState(room, now, state.nextEvent || 'In match');
  }

  private assignTf2Team(room: Room, player: RoomPlayer): string {
    this.ensureMatchState(room, Date.now());
    const state = room.meta.matchState!;
    if (!state.teams) {
      state.teams = {
        RED: { color: '#ff4444', alivePlayers: [], spectators: [], spawn: { x: -48, y: 65, z: 0 } },
        BLU: { color: '#4444ff', alivePlayers: [], spectators: [], spawn: { x: 48, y: 65, z: 0 } },
      };
    }
    const redCount = state.teams.RED.alivePlayers.length;
    const bluCount = state.teams.BLU.alivePlayers.length;
    const target = redCount <= bluCount ? 'RED' : 'BLU';
    
    if (!state.teams[target].alivePlayers.includes(player.username)) {
      state.teams[target].alivePlayers.push(player.username);
    }
    (player as any).__tf2Team = target;
    return target;
  }

  private tickTf2Match(room: Room, now: number): void {
    const state = room.meta.matchState!;
    const dimension = room.meta.dimension || 'tf2_payload';
    
    let tf2Mode: 'payload' | 'control_points' | 'koth' | 'ctf' = 'payload';
    if (dimension.endsWith('_cp')) tf2Mode = 'control_points';
    else if (dimension.endsWith('_koth')) tf2Mode = 'koth';
    else if (dimension.endsWith('_ctf')) tf2Mode = 'ctf';
    state.tf2Mode = tf2Mode;

    // Balance/assign teams for players who entered after match start
    for (const player of room.players.values()) {
      if (player.role !== 'spectator' && !(player as any).__tf2Team) {
        this.assignTf2Team(room, player);
      }
    }

    const dt = 1.0; // Server ticks every second
    const floorY = 64;

    // Collect alive players and their position from their last known positions
    const playersObj = Array.from(room.players.values())
      .filter(p => p.role !== 'spectator')
      .map(p => {
        const lastMove = (p as any).__lastMove || { x: 0, y: 65, z: 0 };
        return {
          uuid: p.uuid,
          username: p.username,
          team: ((p as any).__tf2Team || 'BLU') as 'RED' | 'BLU',
          alive: !((p as any).__isDead || false),
          position: lastMove
        };
      });

    // Count down the pre-game match starts timer if any
    if (state.nextEvent === 'Match Start') {
      if (state.nextEventAt && now >= state.nextEventAt) {
        state.nextEvent = 'In Match';
        state.nextEventAt = now + 10 * 60_000;
        state.countdown = 0;
        room.broadcast(JSON.stringify({ type: 'chat', sender: 'Matchmaker', text: 'Match started! Fight!' }));
      } else {
        const timeLeft = Math.max(0, Math.ceil(((state.nextEventAt || now) - now) / 1000));
        state.countdown = timeLeft;
        return; // wait for start
      }
    }

    if (tf2Mode === 'payload') {
      const startX = -36;
      const endX = 36;
      const cartProgress = state.tf2CartProgress ?? 0;
      const cartX = startX + cartProgress * (endX - startX);

      const attackers = playersObj.filter(p => p.alive && p.team === 'BLU' && Math.hypot(p.position.x - cartX, p.position.y - floorY, p.position.z - 0) <= 5.5).length;
      const blockers = playersObj.filter(p => p.alive && p.team === 'RED' && Math.hypot(p.position.x - cartX, p.position.y - floorY, p.position.z - 0) <= 5.5).length;

      if (attackers > 0 && blockers === 0) {
        state.tf2CartProgress = Math.min(1.0, (state.tf2CartProgress ?? 0) + dt * (0.012 + attackers * 0.008));
      } else if (attackers === 0 && blockers === 0) {
        const idle = (state as any).__tf2CartIdleTime || 0;
        if (idle >= 15) {
          state.tf2CartProgress = Math.max(0, (state.tf2CartProgress ?? 0) - dt * 0.01);
        } else {
          (state as any).__tf2CartIdleTime = idle + dt;
        }
      } else {
        (state as any).__tf2CartIdleTime = 0; // contested
      }

      if ((state.tf2CartProgress ?? 0) >= 1.0) {
        state.tf2Scores = state.tf2Scores || { RED: 0, BLU: 0 };
        state.tf2Scores.BLU++;
        state.tf2Winner = 'BLU';
        room.meta.matchPhase = 'ENDING';
        room.broadcast(JSON.stringify({ type: 'chat', sender: 'Matchmaker', text: 'BLU pushed the cart to the final point! BLU Wins!' }));
      }
    }

    else if (tf2Mode === 'koth') {
      const center = { x: 0, y: floorY, z: 0 };
      const redNear = playersObj.some(p => p.alive && p.team === 'RED' && Math.hypot(p.position.x - center.x, p.position.y - center.y, p.position.z - center.z) <= 6.0);
      const bluNear = playersObj.some(p => p.alive && p.team === 'BLU' && Math.hypot(p.position.x - center.x, p.position.y - center.y, p.position.z - center.z) <= 6.0);

      if (redNear && !bluNear) {
        state.tf2KothOwner = 'RED';
      } else if (bluNear && !redNear) {
        state.tf2KothOwner = 'BLU';
      }

      if (state.tf2KothOwner) {
        const owner = state.tf2KothOwner as 'RED' | 'BLU';
        state.tf2KothTimes = state.tf2KothTimes || { RED: 180, BLU: 180 };
        state.tf2KothTimes[owner] = Math.max(0, state.tf2KothTimes[owner] - dt);
        if (state.tf2KothTimes[owner] <= 0) {
          state.tf2Scores = state.tf2Scores || { RED: 0, BLU: 0 };
          state.tf2Scores[owner]++;
          state.tf2Winner = owner;
          room.meta.matchPhase = 'ENDING';
          room.broadcast(JSON.stringify({ type: 'chat', sender: 'Matchmaker', text: `${owner} held the point until timer expired! ${owner} Wins!` }));
        }
      }
    }

    else if (tf2Mode === 'control_points') {
      const cpCoords: Record<number, number> = { 1: -24, 2: 0, 3: 24 };
      const cpOwners = (state as any).tf2CpOwners || { 1: 'RED', 2: 'RED', 3: 'RED' };
      const cpProgress = (state as any).tf2CpProgress || { 1: 0, 2: 0, 3: 0 };

      let targetCP = 1;
      if (cpOwners[1] === 'BLU') targetCP = 2;
      if (cpOwners[2] === 'BLU') targetCP = 3;

      const cpX = cpCoords[targetCP];
      const attackers = playersObj.filter(p => p.alive && p.team === 'BLU' && Math.hypot(p.position.x - cpX, p.position.y - floorY, p.position.z - 0) <= 6.0).length;
      const defenders = playersObj.filter(p => p.alive && p.team === 'RED' && Math.hypot(p.position.x - cpX, p.position.y - floorY, p.position.z - 0) <= 6.0).length;

      if (attackers > 0 && defenders === 0) {
        cpProgress[targetCP] = Math.min(100, cpProgress[targetCP] + dt * (10 + attackers * 5));
        if (cpProgress[targetCP] >= 100) {
          cpOwners[targetCP] = 'BLU';
          room.broadcast(JSON.stringify({ type: 'chat', sender: 'Matchmaker', text: `BLU captured Control Point ${targetCP}/3!` }));
          if (targetCP === 3) {
            state.tf2Scores = state.tf2Scores || { RED: 0, BLU: 0 };
            state.tf2Scores.BLU++;
            state.tf2Winner = 'BLU';
            room.meta.matchPhase = 'ENDING';
            room.broadcast(JSON.stringify({ type: 'chat', sender: 'Matchmaker', text: 'BLU captured the final control point! BLU Wins!' }));
          }
        }
      } else if (defenders > 0 && attackers === 0) {
        cpProgress[targetCP] = Math.max(0, cpProgress[targetCP] - dt * 12);
      }

      (state as any).tf2CpOwners = cpOwners;
      (state as any).tf2CpProgress = cpProgress;
      state.tf2CapProgress = cpProgress[targetCP] / 100;
    }

    else if (tf2Mode === 'ctf') {
      const redIntelHome = { x: -76, y: floorY, z: 0 };
      const bluIntelHome = { x: 76, y: floorY, z: 0 };

      state.tf2FlagState = state.tf2FlagState || { RED: 'home', BLU: 'home' };
      state.tf2FlagCarrier = state.tf2FlagCarrier || { RED: '', BLU: '' };
      state.tf2FlagPos = state.tf2FlagPos || { RED: { x: -76, y: floorY, z: 0 }, BLU: { x: 76, y: floorY, z: 0 } };
      state.tf2FlagReturnTimer = state.tf2FlagReturnTimer || { RED: 0, BLU: 0 };
      state.tf2Scores = state.tf2Scores || { RED: 0, BLU: 0 };

      const flagState = state.tf2FlagState!;
      const flagCarrier = state.tf2FlagCarrier!;
      const flagPos = state.tf2FlagPos!;
      const flagReturnTimer = state.tf2FlagReturnTimer!;
      const scores = state.tf2Scores!;

      for (const team of ['RED', 'BLU'] as const) {
        const enemyTeam = team === 'RED' ? 'BLU' : 'RED';
        const homePos = team === 'RED' ? redIntelHome : bluIntelHome;
        const deliveryHome = enemyTeam === 'RED' ? redIntelHome : bluIntelHome;

        if (flagState[team] === 'home') {
          const carrier = playersObj.find(p => p.alive && p.team === enemyTeam && Math.hypot(p.position.x - homePos.x, p.position.y - homePos.y, p.position.z - homePos.z) <= 3.5);
          if (carrier) {
            flagState[team] = 'carried';
            flagCarrier[team] = carrier.uuid;
            room.broadcast(JSON.stringify({ type: 'chat', sender: 'Intelligence', text: `${carrier.username} picked up the ${team} intelligence!` }));
          }
        }
        
        else if (flagState[team] === 'carried') {
          const carrier = playersObj.find(p => p.uuid === flagCarrier[team]);
          if (!carrier || !carrier.alive) {
            flagState[team] = 'dropped';
            flagCarrier[team] = '';
            flagReturnTimer[team] = 30.0;
            room.broadcast(JSON.stringify({ type: 'chat', sender: 'Intelligence', text: `The ${team} intelligence was dropped!` }));
          } else {
            flagPos[team] = { x: carrier.position.x, y: carrier.position.y, z: carrier.position.z };
            if (Math.hypot(carrier.position.x - deliveryHome.x, carrier.position.y - deliveryHome.y, carrier.position.z - deliveryHome.z) <= 4.0) {
              if (flagState[enemyTeam] === 'home') {
                scores[enemyTeam]++;
                flagState[team] = 'home';
                flagPos[team] = { x: homePos.x, y: homePos.y, z: homePos.z };
                flagCarrier[team] = '';
                room.broadcast(JSON.stringify({ type: 'chat', sender: 'Intelligence', text: `${carrier.username} captured the ${team} intelligence! Score is RED ${scores.RED} - BLU ${scores.BLU}` }));
                if (scores[enemyTeam] >= 3) {
                  state.tf2Winner = enemyTeam;
                  room.meta.matchPhase = 'ENDING';
                  room.broadcast(JSON.stringify({ type: 'chat', sender: 'Matchmaker', text: `${enemyTeam} captured the intel 3 times! ${enemyTeam} Wins!` }));
                }
              }
            }
          }
        }
        
        else if (flagState[team] === 'dropped') {
          flagReturnTimer[team] = Math.max(0, flagReturnTimer[team] - dt);
          if (flagReturnTimer[team] <= 0) {
            flagState[team] = 'home';
            flagPos[team] = { x: homePos.x, y: homePos.y, z: homePos.z };
            room.broadcast(JSON.stringify({ type: 'chat', sender: 'Intelligence', text: `The ${team} intelligence has returned to base.` }));
          } else {
            const defender = playersObj.find(p => p.alive && p.team === team && Math.hypot(p.position.x - flagPos[team].x, p.position.y - flagPos[team].y, p.position.z - flagPos[team].z) <= 3.5);
            if (defender) {
              flagState[team] = 'home';
              flagPos[team] = { x: homePos.x, y: homePos.y, z: homePos.z };
              room.broadcast(JSON.stringify({ type: 'chat', sender: 'Intelligence', text: `${defender.username} returned the ${team} intelligence!` }));
            } else {
              const carrier = playersObj.find(p => p.alive && p.team === enemyTeam && Math.hypot(p.position.x - flagPos[team].x, p.position.y - flagPos[team].y, p.position.z - flagPos[team].z) <= 3.5);
              if (carrier) {
                flagState[team] = 'carried';
                flagCarrier[team] = carrier.uuid;
                room.broadcast(JSON.stringify({ type: 'chat', sender: 'Intelligence', text: `${carrier.username} picked up the dropped ${team} intelligence!` }));
              }
            }
          }
        }
      }
    }

    if (state.tf2Winner) {
      room.meta.matchPhase = 'ENDING';
    }

    this.broadcastServerInfo(room, now);
  }

  private tickCbgoRound(room: Room, now: number): void {
    const state = room.meta.matchState!;
    if (!state) return;
    const phase = state.cbgoPhase || 'LIVE';
    const endsAt = Number(state.nextEventAt || 0);
    if (endsAt > now) {
      state.countdown = Math.max(0, Math.ceil((endsAt - now) / 1000));
      return;
    }

    if (phase === 'WARMUP') {
      state.cbgoPhase = 'BUY';
      state.nextEvent = 'Buy phase ends';
      state.nextEventAt = now + 15_000;
      state.countdown = 15;
      room.broadcast(JSON.stringify({ type: 'chat', sender: 'CBGO Premier', text: 'Warmup complete. $800 pistol round. Buy phase is live.' }));
      this.broadcastServerInfo(room, now);
      return;
    }

    if (phase === 'BUY') {
      state.cbgoPhase = 'LIVE';
      state.nextEvent = 'Round timer';
      state.nextEventAt = now + 115_000;
      state.countdown = 115;
      room.broadcast(JSON.stringify({ type: 'chat', sender: 'CBGO Premier', text: `Round ${state.cbgoRound || 1} live. Hold utility, trade cleanly, and clear every angle.` }));
      this.broadcastServerInfo(room, now);
      return;
    }

    if (phase === 'BOMB') {
      this.finishCbgoRound(room, 'Terrorists', 'bomb', now);
      return;
    }

    if (phase === 'ROUND_END') {
      const scores = state.cbgoScores || { Terrorists: 0, 'Counter-Terrorists': 0 };
      const matchWon = scores.Terrorists >= 13 || scores['Counter-Terrorists'] >= 13 || (state.cbgoRound || 1) >= (state.cbgoMaxRounds || 24);
      if (matchWon) {
        room.meta.matchPhase = 'ENDING';
        state.nextEvent = 'Postgame';
        state.nextEventAt = now + 15_000;
        this.broadcastServerInfo(room, now);
        return;
      }

      state.cbgoRound = Math.min((state.cbgoRound || 1) + 1, state.cbgoMaxRounds || 24);
      if (state.cbgoRound === 13) {
        for (const player of room.players.values()) (player as any).__cbgoMoney = 800;
        room.broadcast(JSON.stringify({ type: 'chat', sender: 'CBGO Premier', text: 'Halftime. Teams swap sides and money resets to $800.' }));
      }
      this.beginCbgoRound(room, now, false);
      this.broadcastServerInfo(room, now);
      this.sendMatchStart(room);
      return;
    }

    this.finishCbgoRound(room, 'Counter-Terrorists', 'time', now);
  }

  private finishCbgoRound(room: Room, winner: CbgoTeam, reason: string, now = Date.now()): void {
    const state = room.meta.matchState!;
    if (!state || state.cbgoPhase === 'ROUND_END') return;
    state.cbgoScores ||= { Terrorists: 0, 'Counter-Terrorists': 0 };
    state.cbgoScores[winner] = Math.min(13, (state.cbgoScores[winner] || 0) + 1);
    state.cbgoPhase = 'ROUND_END';
    state.nextEvent = 'Next round';
    state.nextEventAt = now + 5_000;
    state.countdown = 5;
    this.awardCbgoRoundWin(room, winner);
    room.broadcast(JSON.stringify({ type: 'cbgoRoundEnd', winner, reason, matchState: state, meta: room.meta }));
    this.broadcastServerInfo(room, now);
  }

  private tickSuddenDeath(room: Room, now: number): void {
    this.ensureMatchState(room, now);
    const state = room.meta.matchState!;
    state.state = 'SUDDEN_DEATH';
    if (!state.nextEventAt) state.nextEventAt = now + 5 * 60_000;
    if (now >= state.nextEventAt) room.meta.matchPhase = 'ENDING';
    this.tickBedWarsGenerators(room, now);
    this.updateMatchState(room, now, 'Game End');
  }

  public startCbgoQuickPlay(room: Room, mapId?: string): void {
    if (room.meta.minigameId !== 'csgo') return;
    const now = Date.now();
    const map = CBGO_MAPS.find(entry => entry.id === mapId) || CBGO_MAPS[Math.floor(Math.random() * CBGO_MAPS.length)];
    (room as any).__cbgoNextMap = map.id;
    if (!room.meta.matchState) room.meta.matchState = this.createInitialMatchState('csgo', room.meta.maxPlayers || 10, now);
    const state = room.meta.matchState!;
    state.cbgoMap = map.id;
    state.cbgoRound = 1;
    state.cbgoMaxRounds = 24;
    state.cbgoScores = { Terrorists: 0, 'Counter-Terrorists': 0 };
    state.cbgoVeto = this.createCbgoVeto(map.id);
    state.cbgoStakes = this.createCbgoStakes(Math.max(2, room.players.size));
    state.cbgoPhase = 'WARMUP';
    room.meta.matchPhase = 'IN_MATCH';
    room.meta.startedAt = now;
    room.meta.locked = false;
    this.beginCbgoRound(room, now, true);
    this.updateMatchState(room, now, 'Round End');
    room.broadcast(JSON.stringify({ type: 'cbgoQuickPlayStarted', map, matchState: room.meta.matchState, meta: room.meta }));
    this.sendMatchStart(room);
  }

  public awardCbgoKill(room: Room, killer: RoomPlayer, victim: RoomPlayer): void {
    if (room.meta.minigameId !== 'csgo') return;
    const amount = 300;
    (killer as any).__cbgoMoney = Math.min(16000, Math.max(800, Number((killer as any).__cbgoMoney || 800)) + amount);
    const state = room.meta.matchState;
    const team = (killer as any).__cbgoTeam as CbgoTeam | undefined;
    if (state?.cbgoTeams && team && state.cbgoTeams[team]) {
      state.cbgoTeams[team].money[killer.username] = (killer as any).__cbgoMoney;
    }
    room.broadcast(JSON.stringify({
      type: 'cbgoEconomy',
      killerUuid: killer.uuid,
      victimUuid: victim.uuid,
      amount,
      money: (killer as any).__cbgoMoney,
      matchState: state,
    }));
  }

  public handleCbgoPlayerEliminated(room: Room, victim: RoomPlayer, now = Date.now()): void {
    if (room.meta.minigameId !== 'csgo') return;
    const state = room.meta.matchState;
    if (!state?.cbgoTeams || !['LIVE', 'BOMB'].includes(String(state.cbgoPhase || ''))) return;

    const victimTeam = (victim as any).__cbgoTeam as CbgoTeam | undefined;
    if (victimTeam && state.cbgoTeams[victimTeam]) {
      state.cbgoTeams[victimTeam].alivePlayers = state.cbgoTeams[victimTeam].alivePlayers.filter(name => name !== victim.username);
    }

    const tAlive = state.cbgoTeams.Terrorists.alivePlayers.length;
    const ctAlive = state.cbgoTeams['Counter-Terrorists'].alivePlayers.length;
    if (tAlive <= 0 && ctAlive > 0) {
      this.finishCbgoRound(room, 'Counter-Terrorists', 'elimination', now);
    } else if (ctAlive <= 0 && tAlive > 0) {
      this.finishCbgoRound(room, 'Terrorists', 'elimination', now);
    }
  }

  public handleCbgoObjective(room: Room, player: RoomPlayer, action: string, siteName: string, now = Date.now()): void {
    if (room.meta.minigameId !== 'csgo') return;
    const state = room.meta.matchState;
    const map = CBGO_MAPS.find(entry => entry.id === state?.cbgoMap) || CBGO_MAPS[0];
    const team = (player as any).__cbgoTeam as CbgoTeam | undefined;
    const cleanAction = action.trim().toLowerCase();
    const site = siteName.trim().toUpperCase() === 'B' ? 'B' : 'A';
    const sitePos = site === 'A' ? map.bombsiteA : map.bombsiteB;
    const move = (player as any).__lastMove || this.getSpawnForPlayer(room, player);
    const dx = Number(move?.x || 0) - sitePos.x;
    const dz = Number(move?.z || 0) - sitePos.z;
    if (dx * dx + dz * dz > 11 * 11) return;

    if (cleanAction === 'plant') {
      if (team !== 'Terrorists' || state?.cbgoPhase !== 'LIVE') return;
      state.cbgoPhase = 'BOMB';
      state.cbgoBombSite = site;
      state.nextEvent = `Bombsite ${site}`;
      state.nextEventAt = now + 40_000;
      state.countdown = 40;
      room.broadcast(JSON.stringify({
        type: 'cbgoObjective',
        action: 'plant',
        site,
        username: player.username,
        matchState: state,
        meta: room.meta,
      }));
      room.broadcast(JSON.stringify({ type: 'chat', sender: 'CBGO', text: `${player.username} planted the bomb at ${site}. CTs have 40 seconds.` }));
      this.broadcastServerInfo(room, now);
    } else if (cleanAction === 'defuse') {
      if (team !== 'Counter-Terrorists' || state?.cbgoPhase !== 'BOMB') return;
      room.broadcast(JSON.stringify({
        type: 'cbgoObjective',
        action: 'defuse',
        site: state.cbgoBombSite || site,
        username: player.username,
        matchState: state,
        meta: room.meta,
      }));
      this.finishCbgoRound(room, 'Counter-Terrorists', 'defuse', now);
    }
  }

  private awardCbgoRoundWin(room: Room, winner: CbgoTeam): void {
    const state = room.meta.matchState;
    if (!state?.cbgoTeams?.[winner]) return;
    for (const username of state.cbgoTeams[winner].alivePlayers) {
      const player = Array.from(room.players.values()).find(entry => entry.username === username);
      if (!player) continue;
      (player as any).__cbgoMoney = Math.min(16000, Math.max(800, Number((player as any).__cbgoMoney || 800)) + 3250);
      state.cbgoTeams[winner].money[username] = (player as any).__cbgoMoney;
    }
  }

  private tickBedWarsGenerators(room: Room, now: number): void {
    const state = room.meta.matchState;
    if (!state || room.meta.minigameId !== 'bedwars') return;
    const last = (room as any).__lastGeneratorTick || 0;
    if (now - last < 1800) return;
    (room as any).__lastGeneratorTick = now;
    const iron = 202;
    const gold = 203;
    const diamond = 204;
    const emerald = 471; // FeatureCatalog Emerald item; harmless if absent, clients ignore unknown item styles but keep stacks.
    const drops = [
      { itemId: iron, count: 1, ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Red },
      { itemId: gold, count: 1, ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Red },
      { itemId: iron, count: 1, ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Blue },
      { itemId: gold, count: 1, ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Blue },
      { itemId: iron, count: 1, ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Green },
      { itemId: gold, count: 1, ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Green },
      { itemId: iron, count: 1, ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Yellow },
      { itemId: gold, count: 1, ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Yellow },
      ...CROWNFORGE_BEDWARS_DIAMOND_GENERATORS.map(spawn => ({ itemId: diamond, count: state.diamondTier || 1, ...spawn })),
      ...CROWNFORGE_BEDWARS_EMERALD_GENERATORS.map(spawn => ({ itemId: emerald, count: state.emeraldTier || 1, ...spawn })),
    ];
    for (const drop of drops) this.spawnServerItemDrop(room, drop.itemId, drop.count, drop.x, drop.y, drop.z, now);
  }

  private spawnServerItemDrop(room: Room, itemId: number, count: number, x: number, y: number, z: number, now: number): void {
    const anyRoom = room as any;
    const id = `gen-${room.id}-${itemId}-${Math.floor(now / 1800)}-${Math.floor(x)}-${Math.floor(z)}`;
    if (!anyRoom.__recentItemDrops) anyRoom.__recentItemDrops = [];
    if (!anyRoom.__recentItemDropIds) anyRoom.__recentItemDropIds = new Set<string>();
    if (anyRoom.__recentItemDropIds.has(id)) return;

    const packet = JSON.stringify({ type: 'itemDrop', id, itemId, count, x, y, z, vx: 0, vy: 0.05, vz: 0 });
    anyRoom.__recentItemDropIds.add(id);
    anyRoom.__recentItemDrops.push(packet);
    while (anyRoom.__recentItemDrops.length > 512) {
      const removed = anyRoom.__recentItemDrops.shift();
      if (typeof removed === 'string') {
        try {
          const parsed = JSON.parse(removed);
          if (parsed?.id) anyRoom.__recentItemDropIds.delete(parsed.id);
        } catch {
          // Ignore malformed historical packets.
        }
      }
    }
    room.broadcast(packet);
  }

  private clearGeneratorDrops(room: Room): void {
    const anyRoom = room as any;
    anyRoom.__recentItemDrops = [];
    anyRoom.__recentItemDropIds = new Set<string>();
  }

  private resetTemporaryArenaBlocks(room: Room): void {
    (room as any).__playerPlacedBlocks = new Set<string>();
  }

  private returnRoomToLobby(room: Room): void {
    const lobby = this.getOrCreateRoom(CROWNFORGE_LOBBY_ROOM);
    for (const oldPlayer of Array.from(room.players.values())) {
      if (oldPlayer.ws.readyState === WebSocket.CLOSED || oldPlayer.ws.readyState === WebSocket.CLOSING) {
        this.removePlayerFromAll(oldPlayer.uuid);
        continue;
      }
      const moved = this.movePlayerToRoom(oldPlayer.uuid, lobby, 'player') || oldPlayer;
      if (moved.ws.readyState !== WebSocket.OPEN) {
        this.removePlayerFromAll(moved.uuid);
        continue;
      }
      const spawn = this.getSpawnForPlayer(lobby, moved);
      moved.ws.send(JSON.stringify({
        type: 'serverJump',
        room: lobby.id,
        dimension: lobby.meta.dimension,
        title: lobby.meta.displayName,
        spawn,
        role: 'player',
        matchPhase: lobby.meta.matchPhase || 'LOBBY',
        meta: lobby.meta,
        message: 'Returning to CrownForge lobby.'
      }));
      (moved as any).__teleportGraceUntil = Date.now() + TELEPORT_GRACE_MS;
      (moved as any).__teleportGraceAnchor = spawn;
      (moved as any).__antiCheatMove = null;
      (moved as any).__lastMove = null;
    }
  }

  private sendMatchStart(room: Room): void {
    for (const player of room.players.values()) {
      const spawn = this.getSpawnForPlayer(room, player);
      if (player.ws.readyState !== WebSocket.OPEN) continue;
      player.ws.send(JSON.stringify({
        type: 'serverJump',
        room: room.id,
        dimension: room.meta.dimension,
        title: room.meta.displayName,
        spawn,
        role: player.role,
        matchPhase: room.meta.matchPhase,
        meta: { ...room.meta, bedWarsTeam: (player as any).__crownforgeTeam },
        bedWarsTeam: (player as any).__crownforgeTeam,
        forceSpawn: true,
        matchState: room.meta.matchState,
        message: player.role === 'spectator'
          ? 'You are spectating this live match.'
          : `${room.meta.displayName} started. Good luck.`
      }));
      (player as any).__teleportGraceUntil = Date.now() + TELEPORT_GRACE_MS;
      (player as any).__teleportGraceAnchor = spawn;
      (player as any).__antiCheatMove = null;
      (player as any).__lastMove = null;
    }
  }

  private broadcastServerInfo(room: Room, now: number): void {
    room.broadcast(JSON.stringify({
      type: 'serverInfo',
      serverTime: now,
      players: room.players.size,
      room: room.id,
      matchPhase: room.meta.matchPhase,
      matchState: room.meta.matchState,
      meta: room.meta,
    }));
  }

  public removePlayerFromAll(uuid: string): void {
    for (const room of Array.from(this.rooms.values())) {
      if (room.players.has(uuid)) {
        room.removePlayer(uuid);
        if (room.players.size === 0 && !room.meta.permanent) {
          this.rooms.delete(room.id);
          console.log(`Removed empty room: ${room.id}`);
        }
      }
    }
  }

  public snapshotRooms(): ReturnType<Room['toJSON']>[] {
    return Array.from(this.rooms.values()).map(room => room.toJSON());
  }

  public getBan(id?: string | null): BanRecord | null {
    const cleanId = this.normalizeBanId(id);
    if (!cleanId) return null;
    const ban = this.bans.get(cleanId);
    if (!ban) return null;
    if (Date.now() > ban.expiresAt) {
      this.bans.delete(cleanId);
      return null;
    }
    return ban;
  }

  public isBanned(id?: string | null): boolean {
    return !!this.getBan(id);
  }

  public banPlayer(player: RoomPlayer, reason: string, durationMs?: number, evidenceFlags: string[] = []): void {
    const now = Date.now();
    const primaryId = this.getPrimaryPunishmentId(player);
    const previousOffenses = (this.offenseCounts.get(primaryId) || 0) + 1;
    this.offenseCounts.set(primaryId, previousOffenses);
    this.saveOffenseCounts();

    const resolvedDurationMs = durationMs ?? this.getEscalatingDuration(previousOffenses);
    const expiresAt = resolvedDurationMs >= Number.MAX_SAFE_INTEGER / 4
      ? Number.MAX_SAFE_INTEGER
      : now + resolvedDurationMs;

    const ids = [
      player.accountId ? this.normalizeBanId(`acct:${player.accountId}`) : '',
      this.normalizeBanId(player.ipAddress),
      this.normalizeBanId(player.uuid),
      this.normalizeBanId(player.username ? `user:${player.username.toLowerCase()}` : ''),
    ].filter(Boolean) as string[];

    for (const id of ids) {
      this.bans.set(id, {
        id,
        reason,
        bannedAt: now,
        expiresAt,
        durationMs: resolvedDurationMs,
        previousOffenses,
        source: 'system',
        targetAccountId: player.accountId,
        targetIp: player.ipAddress,
        targetUsername: player.username,
        targetUuid: player.uuid,
        evidenceFlags,
      });
    }
    this.saveBans();
    for (const room of Array.from(this.rooms.values())) {
      if (room.meta.permanent) this.writeBansTxt(room.id);
    }

    try {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify({
          type: 'banned',
          reason,
          expiresAt,
          durationMs: resolvedDurationMs,
          previousOffenses,
        }));
      }
      player.ws.close(4003, 'Anti-cheat ban');
    } catch {
      // Socket may already be closing.
    }

    this.removePlayerFromAll(player.uuid);
    console.warn(`Anti-cheat ban #${previousOffenses}: ${player.username} (${player.ipAddress || player.uuid}) - ${reason}`);
  }

  private getPrimaryPunishmentId(player: RoomPlayer): string {
    return this.normalizeBanId(player.accountId ? `acct:${player.accountId}` : (player.username ? `user:${player.username}` : (player.ipAddress || player.uuid))) || player.uuid;
  }

  private getEscalatingDuration(offenseNumber: number): number {
    const ladder = [
      5 * 60 * 1000,
      30 * 60 * 1000,
      2 * 60 * 60 * 1000,
      24 * 60 * 60 * 1000,
      7 * 24 * 60 * 60 * 1000,
      Number.MAX_SAFE_INTEGER,
    ];
    return ladder[Math.min(Math.max(offenseNumber, 1), ladder.length) - 1];
  }

  private normalizeRoomId(roomId: string): string {
    return String(roomId || 'lobby_1')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_\-]/g, '_')
      .slice(0, 64) || 'lobby_1';
  }

  private normalizeBanId(id?: string | null): string {
    return String(id || '')
      .trim()
      .toLowerCase()
      .replace(/^::ffff:/, '')
      .slice(0, 96);
  }
}
