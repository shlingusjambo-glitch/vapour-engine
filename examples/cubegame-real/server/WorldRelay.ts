import { WebSocket } from 'ws';
import { Room, RoomManager, RoomPlayer } from './RoomManager';
import { CROWNFORGE_BEDWARS_BEDS, CROWNFORGE_LOBBY_ROOM, CROWNFORGE_PREGAME_SECONDS, CROWNFORGE_PREGAME_SPAWN, CROWNFORGE_SERVER_ID, MINIGAME_DEFINITIONS, getMinigameByCommand, isCrownForgeDimension } from '../src/crownforge/CrownForgeCatalog';
import { BinaryProtocol, PacketType } from '../src/network/BinaryProtocol';
import { getFeatureBlockId } from '../src/content/FeatureCatalog';

type Sendable = string | Buffer;

interface RoomTimeState {
  baseTimeOfDay: number;
  baseServerTimeMs: number;
  dayLengthMs: number;
}

interface RoomWeatherState {
  weather: 'clear' | 'rain' | 'thunder';
  intensity: number;
  updatedAt: number;
}

export class WorldRelay {
  private static readonly MAX_PACKET_BYTES = 64 * 1024;
  private static readonly MAX_BACKPRESSURE_BYTES = Number(process.env.CUBEGAME_MAX_BACKPRESSURE_BYTES || String(2 * 1024 * 1024));
  private static readonly MAX_BACKPRESSURE_MS = Number(process.env.CUBEGAME_MAX_BACKPRESSURE_MS || '5000');
  private static readonly MOVE_RELAY_INTERVAL_MS = 20; // server cap ~50Hz per player
  private static readonly TIME_RELAY_INTERVAL_MS = 1000;
  private static readonly CHAT_MAX_CHARS = 256;
  private static readonly MOD_PACKET_MAX_CHARS = 2048;
  private static readonly VOICE_SIGNAL_MAX_CHARS = 8192;
  private static readonly RECENT_BLOCK_HISTORY_LIMIT = 2048;
  private static readonly RECENT_ITEM_HISTORY_LIMIT = 768;
  private static readonly SYNC_REQUEST_INTERVAL_MS = 1500;
  private static readonly SYNC_BLOCK_SEND_LIMIT = 512;
  private static readonly SYNC_ITEM_SEND_LIMIT = 256;
  private static readonly SYNC_HISTORY_BATCH_SIZE = 96;
  private static readonly MOB_SNAPSHOT_LIMIT = 128;
  private static readonly MOB_AUTHORITY_STALE_MS = 2500;
  private static readonly MAX_SKIN_DATA_URL_CHARS = Number(process.env.CUBEGAME_MAX_SKIN_BYTES || String(256 * 1024));
  private static readonly TELEPORT_GRACE_MS = Number(process.env.CUBEGAME_TELEPORT_GRACE_MS || '1750');
  private static readonly TELEPORT_GRACE_MAX_DISTANCE = 18;
  private static readonly WATCHDOG_WINDOW_MS = Number(process.env.CUBEGAME_WATCHDOG_WINDOW_MS || '90000');
  private static readonly WATCHDOG_KICK_SCORE = Number(process.env.CUBEGAME_WATCHDOG_KICK_SCORE || '80');
  private static readonly WATCHDOG_BAN_SCORE = Number(process.env.CUBEGAME_WATCHDOG_BAN_SCORE || '160');
  private static readonly friendRequests = new Map<string, Set<string>>();
  private static readonly friendships = new Map<string, Set<string>>();
  private static readonly worldInvites = new Map<string, { fromUuid: string; fromName: string; roomId: string; at: number }>();

  /**
   * Processes an incoming message from a room player and broadcasts it.
   */
  public static handleClientMessage(player: RoomPlayer, room: Room, message: any, roomManager?: RoomManager): void {
    this.ensureRoomTimeState(room);

    // 1. Binary Packet Relay
    if (message instanceof Buffer) {
      if (message.length < 1 || message.length > this.MAX_PACKET_BYTES) return;

      const type = message.readUInt8(0);

      if (type === PacketType.PlayerMove) {
        if (message.length < BinaryProtocol.PLAYER_MOVE_BYTES) return;

        const now = Date.now();
        const lastRelayAt = (player as any).__lastMoveRelayAt || now;
        let tokens = (player as any).__moveRelayTokens ?? 5.0;
        const elapsed = now - lastRelayAt;
        
        // Add tokens at a rate of 50 per second (1 token per 20ms)
        tokens = Math.min(10.0, tokens + elapsed / 20.0);
        (player as any).__lastMoveRelayAt = now;

        if (tokens < 1.0) {
          return; // Rate limit exceeded (drop packet)
        }
        tokens -= 1.0;
        (player as any).__moveRelayTokens = tokens;

        const move = BinaryProtocol.decodePlayerMove(message);
        if (!this.checkMoveAntiCheat(player, room, move, now, roomManager)) return;
        const oldMove = (player as any).__lastMove;
        if (oldMove) {
          (player as any).__prevMove = oldMove;
        }
        (player as any).__lastMove = { x: move.x, y: move.y, z: move.z, yaw: move.yaw, pitch: move.pitch, heldItemId: move.heldItemId, at: now };

        // Clear teleport grace when first legit move arrives after it expires naturally.
        // (no action needed — we just don't reset it here)

        // Extract 20 bytes of move float coordinates and prepend player's numeric index.
        // Broadcast packet size: 1 byte type + 2 bytes index + 20 bytes values = 23 bytes.
        const broadcastMsg = Buffer.allocUnsafe(BinaryProtocol.SERVER_PLAYER_MOVE_BYTES);
        broadcastMsg.writeUInt8(PacketType.PlayerMove, 0);
        broadcastMsg.writeUInt16BE(player.index & 0xffff, 1);
        message.copy(broadcastMsg, 3, 1, BinaryProtocol.PLAYER_MOVE_BYTES);

        this.broadcastToRoom(room, broadcastMsg, player.uuid);
      }

      else if (type === PacketType.BlockEdit) {
        if (message.length < BinaryProtocol.BLOCK_EDIT_BYTES) return;

        const edit = BinaryProtocol.decodeBlockEdit(message);
        if (!this.checkBlockEditAntiCheat(player, room, edit, roomManager)) return;

        // CrownForge: track player-placed blocks server-side.
        // Only player-placed blocks (blockId > 0) can be broken by players.
        const isCrownForge = this.isCrownForgeRoom(room);
        if (isCrownForge) {
          const key = `${edit.x},${edit.y},${edit.z}`;
          if (!(room as any).__playerPlacedBlocks) (room as any).__playerPlacedBlocks = new Set<string>();
          const placed: Set<string> = (room as any).__playerPlacedBlocks;

          if (edit.blockId === 0) {
            // Removal: player-placed temporary blocks are breakable; protected arena blocks restore.
            // BedWars beds are objective blocks, so they go through objective rules instead of generic protection.
            if (!placed.has(key)) {
              const objectiveResult = this.handleCrownForgeObjectiveBreak(room, player, edit);
              if (objectiveResult === 'allow') {
                // objective handler updated match state and allowed this block removal to broadcast
              } else {
                if (objectiveResult !== 'handledReject') {
                  this.safeSend(player.ws, JSON.stringify({
                    type: 'chat',
                    sender: String(room.meta?.dimension || '').toLowerCase() === 'backrooms' ? 'Backrooms' : 'Server',
                    text: String(room.meta?.dimension || '').toLowerCase() === 'backrooms'
                      ? 'The walls refuse to break.'
                      : 'You can only break blocks you placed here.'
                  }));
                }
                return;
              }
            } else {
              placed.delete(key);
            }
          } else {
            // Placement: register this block as player-placed
            placed.add(key);
          }
        }

        this.rememberBlockEdit(room, message.subarray(0, BinaryProtocol.BLOCK_EDIT_BYTES));
        this.broadcastToRoom(room, message.subarray(0, BinaryProtocol.BLOCK_EDIT_BYTES), player.uuid);
      }

      else if (type === PacketType.TimeSync) {
        if (message.length < BinaryProtocol.LEGACY_TIME_SYNC_BYTES) return;

        const now = Date.now();
        const lastTimeAt = (player as any).__lastTimeRelayAt || 0;
        if (now - lastTimeAt < this.TIME_RELAY_INTERVAL_MS) return;
        (player as any).__lastTimeRelayAt = now;

        const sync = BinaryProtocol.decodeTimeSync(message);
        this.setRoomTime(room, sync.timeOfDay, now);

        // Re-encode from the server so everyone receives the same timestamp.
        const packet = Buffer.from(BinaryProtocol.encodeTimeSync(sync.timeOfDay, now));
        this.broadcastToRoom(room, packet, player.uuid);
      }

      return;
    }

    // 2. JSON Packet Relay (Chats, Pings, time/snapshot requests)
    if (typeof message === 'string') {
      if (message.length > 4096) return;

      try {
        const msg = JSON.parse(message);

        if (msg.type === 'chat') {
          const text = String(msg.text || '').trim().slice(0, this.CHAT_MAX_CHARS);
          if (!text) return;

          if (text.startsWith('/')) {
            this.handleSlashCommand(text, player, room, roomManager);
            return;
          }

          this.broadcastToRoom(room, JSON.stringify({
            type: 'chat',
            sender: player.username,
            text
          }));
        }

        else if (msg.type === 'ping') {
          this.safeSend(player.ws, JSON.stringify({
            type: 'pong',
            t: msg.t || null,
            serverTime: Date.now()
          }));
        }

        else if (msg.type === 'timeRequest') {
          const now = Date.now();
          const timeOfDay = this.getRoomTime(room, now);
          this.safeSend(player.ws, Buffer.from(BinaryProtocol.encodeTimeSync(timeOfDay, now)));
        }

        else if (msg.type === 'syncRequest' || msg.type === 'serverInfo') {
          const now = Date.now();
          const lastSyncAt = (player as any).__lastSyncRequestAt || 0;
          if (now - lastSyncAt < this.SYNC_REQUEST_INTERVAL_MS) return;
          (player as any).__lastSyncRequestAt = now;

          const timeOfDay = this.getRoomTime(room, now);
          this.safeSend(player.ws, JSON.stringify({
            type: 'serverInfo',
            timeOfDay,
            serverTime: now,
            protocol: BinaryProtocol.PROTOCOL_VERSION,
            players: this.getRoomPlayerCount(room),
            playersList: this.getRoomPlayersPayload(room, player.uuid),
            mobAuthorityUuid: this.getMobAuthority(room),
            weather: this.getRoomWeather(room),
            room: room.id,
            role: player.role,
            spawn: roomManager?.getSpawnForPlayer(room, player),
            matchPhase: room.meta.matchPhase || '',
            matchState: room.meta.matchState || null,
            meta: (room as any).meta || null,
            modManifest: (room as any).__modManifest || null
          }));

          this.safeSend(player.ws, Buffer.from(BinaryProtocol.encodeServerSnapshot(timeOfDay, now)));
          this.flushSyncHistory(player, room);
        }

        else if (msg.type === 'itemDrop') {
          const sanitized = this.sanitizeItemDrop(msg);
          if (!sanitized) return;

          // Proximity check: ensure the item drop is near the player's last known location.
          const move = (player as any).__lastMove || (player as any).__antiCheatMove;
          if (move) {
            const dx = sanitized.x - move.x;
            const dy = sanitized.y - move.y;
            const dz = sanitized.z - move.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq > 15 * 15) {
              this.rejectSuspiciousAction(player, 'item drop too far away');
              return;
            }
          }

          // Rate-limiting check: prevent item drop flood exploits.
          const now = Date.now();
          const dropWindowStart = (player as any).__itemDropWindowStart || 0;
          if (now - dropWindowStart > 1000) {
            (player as any).__itemDropWindowStart = now;
            (player as any).__itemDropCount = 0;
          }
          (player as any).__itemDropCount = ((player as any).__itemDropCount || 0) + 1;
          if ((player as any).__itemDropCount > 20) {
            this.rejectSuspiciousAction(player, 'too many item drops');
            return;
          }

          const serialized = JSON.stringify(sanitized);
          this.rememberItemDrop(room, serialized, sanitized.id);
          this.broadcastToRoom(room, serialized, player.uuid);
        }

        else if (msg.type === 'itemPickup') {
          const id = String(msg.id || '').slice(0, 64);
          if (!id) return;
          const drop = this.findRecentItemDrop(room, id);
          if (!drop) {
            // Stale client-side drops are common after chunk reloads; ignore them
            // instead of turning normal desync into Watchdog evidence.
            this.rejectSuspiciousAction(player, 'that item no longer exists');
            return;
          }
          const move = (player as any).__lastMove || (player as any).__antiCheatMove;
          const dx = Number(move?.x ?? NaN) - Number(drop.x);
          const dy = Number(move?.y ?? NaN) - Number(drop.y);
          const dz = Number(move?.z ?? NaN) - Number(drop.z);
          if (!move || Math.hypot(dx, dy, dz) > 8) {
            this.rejectSuspiciousAction(player, 'item too far away');
            return;
          }
          this.forgetItemDrop(room, id);
          this.broadcastToRoom(room, JSON.stringify({ type: 'itemPickup', id }), player.uuid);
        }

        else if (msg.type === 'blockBreakProgress') {
          const packet = this.sanitizeBlockBreakProgress(msg, player);
          if (!packet) return;
          this.broadcastToRoom(room, JSON.stringify(packet), player.uuid);
        }

        else if (msg.type === 'mobSnapshot') {
          if (player.uuid !== this.getMobAuthority(room)) return;
          const packet = this.sanitizeMobSnapshot(msg, player);
          if (!packet) return;
          const serialized = JSON.stringify(packet);
          (room as any).__lastMobSnapshot = serialized;
          (room as any).__mobAuthorityLastAt = Date.now();
          this.broadcastToRoom(room, serialized, player.uuid);
        }

        else if (msg.type === 'modPacket') {
          const packet = this.sanitizeModPacket(msg, player);
          if (!packet) return;
          this.broadcastToRoom(room, JSON.stringify(packet), player.uuid);
        }

        else if (msg.type === 'voiceSignal') {
          const packet = this.sanitizeVoiceSignal(msg, player);
          if (!packet) return;
          const target = room.players.get(packet.toUuid);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            this.safeSend(target.ws, JSON.stringify(packet));
          }
        }

        else if (msg.type === 'hello') {
          if (typeof msg.username === 'string' && msg.username.trim()) {
            player.username = msg.username.trim().slice(0, 24);
          }
          if (this.isValidSkinDataUrl(msg.skinDataUrl)) {
            room.setPlayerSkin(player.uuid, msg.skinDataUrl);
          }

          const now = Date.now();
          this.safeSend(player.ws, JSON.stringify({
            type: 'serverInfo',
            timeOfDay: this.getRoomTime(room, now),
            serverTime: now,
            protocol: BinaryProtocol.PROTOCOL_VERSION,
            players: this.getRoomPlayerCount(room),
            playersList: this.getRoomPlayersPayload(room, player.uuid),
            mobAuthorityUuid: this.getMobAuthority(room),
            weather: this.getRoomWeather(room),
            room: room.id,
            role: player.role,
            spawn: roomManager?.getSpawnForPlayer(room, player),
            matchPhase: room.meta.matchPhase || '',
            matchState: room.meta.matchState || null,
            meta: (room as any).meta || null,
            modManifest: (room as any).__modManifest || null
          }));

          const requiredManifest = (room as any).__modManifest || null;
          if (requiredManifest && !this.modManifestMatches(msg.mods, requiredManifest)) {
            this.safeSend(player.ws, JSON.stringify({
              type: 'modManifest',
              policy: 'required',
              required: requiredManifest,
            }));
          }
        }

        else if (msg.type === 'skin' && this.isValidSkinDataUrl(msg.skinDataUrl)) {
          room.setPlayerSkin(player.uuid, msg.skinDataUrl);
        }

        else if (msg.type === 'playerDamage') {
          const packet = this.sanitizePlayerDamage(msg, player, room, roomManager);
          if (!packet) return;
          this.broadcastToRoom(room, JSON.stringify(packet));
        }

        else if (msg.type === 'cbgoShot') {
          const packet = this.sanitizeCbgoShot(msg, player, room, roomManager);
          if (!packet) return;
          this.broadcastToRoom(room, JSON.stringify(packet));
        }

        else if (msg.type === 'cbgoQuickPlay') {
          if (room.meta.minigameId !== 'csgo' || !roomManager) return;
          roomManager.startCbgoQuickPlay(room, String(msg.mapId || ''));
        }

        else if (msg.type === 'cbgoObjective') {
          if (room.meta.minigameId !== 'csgo' || !roomManager) return;
          roomManager.handleCbgoObjective(room, player, String(msg.action || ''), String(msg.site || ''));
        }

        else if (msg.type === 'tf2State') {
          if (room.meta.minigameId !== 'tf2') return;
          if (msg.classId) (player as any).__tf2Class = msg.classId;
          if (msg.team) (player as any).__tf2Team = msg.team;
          if (msg.weaponId) (player as any).__tf2WeaponId = msg.weaponId;
          if (msg.invulnerable !== undefined) (player as any).__tf2Invulnerable = msg.invulnerable;

          this.broadcastToRoom(room, JSON.stringify({
            type: 'tf2State',
            uuid: player.uuid,
            classId: msg.classId,
            team: msg.team,
            weaponId: msg.weaponId,
            invulnerable: msg.invulnerable
          }));
        }

        else if (msg.type === 'tf2Fire') {
          if (room.meta.minigameId !== 'tf2') return;
          this.broadcastToRoom(room, JSON.stringify({
            type: 'tf2Fire',
            uuid: player.uuid,
            weaponId: msg.weaponId,
            origin: msg.origin,
            direction: msg.direction
          }), player.uuid);
        }

        else if (msg.type === 'tf2Blast') {
          if (room.meta.minigameId !== 'tf2') return;
          this.broadcastToRoom(room, JSON.stringify({
            type: 'tf2Blast',
            uuid: player.uuid,
            origin: msg.origin,
            radius: msg.radius,
            damage: msg.damage,
            force: msg.force
          }), player.uuid);
        }

        else if (msg.type === 'tf2Damage') {
          if (room.meta.minigameId !== 'tf2') return;
          const targetUuid = String(msg.targetUuid || '');
          const target = room.players.get(targetUuid);
          if (!target) return;

          const isHeal = Number(msg.damage) < 0 || msg.heal === true;
          const sameTeam = (player as any).__tf2Team && (target as any).__tf2Team && (player as any).__tf2Team === (target as any).__tf2Team;
          if (sameTeam && !isHeal) {
            return;
          }

          if ((target as any).__tf2Invulnerable && !isHeal) {
            return;
          }

          this.safeSend(target.ws, JSON.stringify({
            type: 'tf2Damage',
            attackerUuid: player.uuid,
            damage: msg.damage,
            heal: msg.heal,
            knockback: msg.knockback
          }));

          this.broadcastToRoom(room, JSON.stringify({
            type: 'tf2DamageIndicator',
            uuid: player.uuid,
            targetUuid: target.uuid,
            damage: msg.damage,
            heal: msg.heal
          }));
        }

        else if (msg.type === 'playerHealth') {
          const health = Number(msg.health ?? 20);
          this.broadcastToRoom(room, JSON.stringify({
            type: 'playerHealth',
            uuid: player.uuid,
            health: health
          }));

          if (health <= 0 && room.meta.kind === 'minigame_match' && !(player as any).__bedwarsDeathPending) {
            const phase = String(room.meta.matchPhase || '').toUpperCase();
            if (['IN_MATCH', 'SUDDEN_DEATH'].includes(phase)) {
              if (room.meta.minigameId === 'csgo') {
                player.role = 'spectator';
                if (room.meta.matchState) {
                  room.meta.matchState.alivePlayers = Array.from(room.players.values()).filter(p => p.role !== 'spectator').map(p => p.username);
                  room.meta.matchState.spectators = Array.from(room.players.values()).filter(p => p.role === 'spectator').map(p => p.username);
                }
                const killerUuid = String((player as any).__lastCbgoAttacker || '');
                const killer = killerUuid && killerUuid !== player.uuid ? room.players.get(killerUuid) : null;
                if (killer && roomManager) roomManager.awardCbgoKill(room, killer, player);
                this.broadcastToRoom(room, JSON.stringify({
                  type: 'cbgoDeath',
                  uuid: player.uuid,
                  username: player.username,
                  killerUuid,
                  matchState: room.meta.matchState,
                  meta: room.meta,
                }));
                if (roomManager) roomManager.handleCbgoPlayerEliminated(room, player);
                setTimeout(() => {
                  if (roomManager?.getPlayerSession(player.uuid)?.room.id === room.id && room.players.has(player.uuid) && player.ws.readyState === WebSocket.OPEN) {
                    const spawn = roomManager ? roomManager.getSpawnForPlayer(room, player) : { x: 0, y: 86, z: 0 };
                    this.safeSend(player.ws, JSON.stringify({
                      type: 'serverJump',
                      room: room.id,
                      dimension: room.meta.dimension,
                      spawn,
                      role: 'spectator',
                      matchPhase: room.meta.matchPhase,
                      matchState: room.meta.matchState,
                      meta: room.meta,
                      forceSpawn: true,
                      reason: 'cbgoDeath',
                      message: 'Eliminated. Spectating teammate POV.',
                    }));
                  }
                }, 700);
                return;
              }

              (player as any).__isDead = true;
              let hasSpawnBackup = false;
              const isTf2 = room.meta.minigameId === 'tf2';
              if (room.meta.minigameId === 'bedwars') {
                const teamName = (player as any).__crownforgeTeam;
                const state = room.meta.matchState;
                const team = state?.teams?.[teamName];
                if (team && team.bedAlive) {
                  hasSpawnBackup = true;
                }
              } else if (isTf2) {
                hasSpawnBackup = true;
              }

              (player as any).__bedwarsDeathPending = true;
              if (hasSpawnBackup) {
                // Respawn player at their team spawn after a short delay
                setTimeout(() => {
                  if (roomManager?.getPlayerSession(player.uuid)?.room.id === room.id && room.players.has(player.uuid) && player.ws.readyState === WebSocket.OPEN) {
                    const spawn = roomManager ? roomManager.getSpawnForPlayer(room, player) : { x: 8, y: 68, z: 8 };
                    this.safeSend(player.ws, JSON.stringify({
                      type: 'serverJump',
                      room: room.id,
                      dimension: room.meta.dimension,
                      spawn,
                      role: player.role,
                      matchPhase: room.meta.matchPhase,
                      matchState: room.meta.matchState,
                      meta: isTf2 ? { ...room.meta, tf2Team: (player as any).__tf2Team } : { ...room.meta, bedWarsTeam: (player as any).__crownforgeTeam },
                      bedWarsTeam: (player as any).__crownforgeTeam,
                      tf2Team: (player as any).__tf2Team,
                      forceSpawn: true,
                      reason: 'respawn',
                      message: isTf2 ? 'You respawned at your team base!' : 'You respawned at your team bed!',
                    }));
                    this.grantTeleportGrace(player, spawn);
                    (player as any).__bedwarsDeathPending = false;
                    (player as any).__isDead = false;
                  }
                }, isTf2 ? 5000 : 3000);
              } else {
                // Final death - transition to spectator
                player.role = 'spectator';
                this.broadcastToRoom(room, JSON.stringify({
                  type: 'chat',
                  sender: 'Server',
                  text: `${player.username} has been eliminated!`
                }));
                // Update matchState
                if (room.meta.matchState) {
                  room.meta.matchState.alivePlayers = Array.from(room.players.values()).filter(p => p.role !== 'spectator').map(p => p.username);
                  room.meta.matchState.spectators = Array.from(room.players.values()).filter(p => p.role === 'spectator').map(p => p.username);
                }

                // Send spectator serverJump
                setTimeout(() => {
                  if (roomManager?.getPlayerSession(player.uuid)?.room.id === room.id && room.players.has(player.uuid) && player.ws.readyState === WebSocket.OPEN) {
                    const spawn = roomManager ? roomManager.getSpawnForPlayer(room, player) : { x: 8, y: 82, z: 8 };
                    this.safeSend(player.ws, JSON.stringify({
                      type: 'serverJump',
                      room: room.id,
                      dimension: room.meta.dimension,
                      spawn,
                      role: 'spectator',
                      matchPhase: room.meta.matchPhase,
                      matchState: room.meta.matchState,
                      meta: { ...room.meta, bedWarsTeam: (player as any).__crownforgeTeam },
                      bedWarsTeam: (player as any).__crownforgeTeam,
                      forceSpawn: true,
                      reason: 'finalDeath',
                      message: 'Eliminated! You are now spectating.',
                    }));
                    (player as any).__bedwarsDeathPending = false;
                  }
                }, 3000);
              }
            }
          }
        }

        else if (msg.type === 'playerState') {
          const state = this.sanitizePlayerState(msg, player);
          if (!state) return;
          this.broadcastToRoom(room, JSON.stringify(state), player.uuid);
        }

        else if (msg.type === 'playerAction') {
          const action = String(msg.action || '').toLowerCase();
          if (action !== 'punch') return;
          const now = Date.now();
          const last = (player as any).__lastActionAt || 0;
          if (now - last < 80) return;
          (player as any).__lastActionAt = now;
          this.broadcastToRoom(room, JSON.stringify({
            type: 'playerAction',
            uuid: player.uuid,
            username: player.username,
            action: 'punch',
            at: now
          }), player.uuid);
        }

        else if (msg.type === 'weatherSync') {
          const weather = this.sanitizeWeather(msg);
          if (!weather) return;
          (room as any).__weatherState = weather;
          this.broadcastToRoom(room, JSON.stringify({
            type: 'weatherSync',
            weather: weather.weather,
            intensity: weather.intensity
          }), player.uuid);
        }

        else if (msg.type === 'mobDamage') {
          const authUuid = this.getMobAuthority(room);
          const playersMap = (room as any).players;
          if (playersMap instanceof Map) {
            const authPlayer = playersMap.get(authUuid);
            if (authPlayer) {
              this.safeSend(authPlayer.ws, JSON.stringify({
                type: 'mobDamage',
                mobId: msg.mobId,
                damage: msg.damage
              }));
            }
          }
        }
      } catch (e) {
        console.error('Error parsing JSON packet on relay:', e);
      }
    }
  }


  private static playerKey(player: RoomPlayer): string {
    return String(player.accountId || player.uuid || player.username).toLowerCase();
  }

  private static usernameKey(name: string): string {
    return String(name || '').trim().toLowerCase();
  }

  private static sendSystem(player: RoomPlayer, text: string, sender = 'Friends'): void {
    this.safeSend(player.ws, JSON.stringify({ type: 'chat', sender, text }));
  }

  private static findOnlinePlayer(roomManager: RoomManager | undefined, name: string): { room: Room; player: RoomPlayer } | null {
    const key = this.usernameKey(name);
    if (!roomManager || !key) return null;
    for (const candidateRoom of roomManager.rooms.values()) {
      for (const candidate of candidateRoom.players.values()) {
        if (this.usernameKey(candidate.username) === key || this.playerKey(candidate) === key) {
          return { room: candidateRoom, player: candidate };
        }
      }
    }
    return null;
  }

  private static areFriends(a: RoomPlayer, b: RoomPlayer): boolean {
    const aKey = this.playerKey(a);
    const bKey = this.playerKey(b);
    return !!this.friendships.get(aKey)?.has(bKey);
  }

  private static addFriendship(a: RoomPlayer, b: RoomPlayer): void {
    const aKey = this.playerKey(a);
    const bKey = this.playerKey(b);
    if (!this.friendships.has(aKey)) this.friendships.set(aKey, new Set());
    if (!this.friendships.has(bKey)) this.friendships.set(bKey, new Set());
    this.friendships.get(aKey)!.add(bKey);
    this.friendships.get(bKey)!.add(aKey);
  }

  private static handleSocialCommand(text: string, player: RoomPlayer, room: Room, roomManager?: RoomManager): boolean {
    const parts = text.trim().split(/\s+/);
    const command = String(parts[0] || '').toLowerCase();
    if (!['/friend', '/friends', '/f', '/msg', '/w', '/tell', '/invite', '/acceptinvite', '/joininvite'].includes(command)) return false;

    const sub = String(parts[1] || '').toLowerCase();

    if (command === '/msg' || command === '/w' || command === '/tell') {
      const targetName = parts[1];
      const message = parts.slice(2).join(' ').slice(0, this.CHAT_MAX_CHARS);
      const target = this.findOnlinePlayer(roomManager, targetName);
      if (!target || !message) {
        this.sendSystem(player, 'Usage: /msg <friend> <message>');
        return true;
      }
      if (!this.areFriends(player, target.player)) {
        this.sendSystem(player, `You can only friend-chat with friends. Use /friend add ${target.player.username} first.`);
        return true;
      }
      this.sendSystem(player, `[to ${target.player.username}] ${message}`, 'Friend Chat');
      this.sendSystem(target.player, `[from ${player.username}] ${message}`, 'Friend Chat');
      return true;
    }

    if (command === '/invite') {
      const targetName = parts[1];
      const target = this.findOnlinePlayer(roomManager, targetName);
      if (!target) {
        this.sendSystem(player, 'Usage: /invite <friend-or-player>');
        return true;
      }
      if (!this.areFriends(player, target.player)) {
        this.sendSystem(player, `Invite blocked: add ${target.player.username} as a friend first with /friend add ${target.player.username}.`);
        return true;
      }
      this.worldInvites.set(this.playerKey(target.player), { fromUuid: player.uuid, fromName: player.username, roomId: room.id, at: Date.now() });
      this.sendSystem(player, `Invite sent to ${target.player.username} for ${room.meta?.displayName || room.id}.`);
      this.sendSystem(target.player, `${player.username} invited you to ${room.meta?.displayName || room.id}. Type /acceptinvite ${player.username} to join.`, 'Invite');
      return true;
    }

    if (command === '/acceptinvite' || command === '/joininvite') {
      const inviterName = parts[1];
      const invite = this.worldInvites.get(this.playerKey(player));
      if (!invite || Date.now() - invite.at > 5 * 60_000 || (inviterName && this.usernameKey(inviterName) !== this.usernameKey(invite.fromName))) {
        this.sendSystem(player, 'No active invite found. Ask your friend to /invite you again.');
        return true;
      }
      if (!roomManager) {
        this.sendSystem(player, 'Invites are only available on multiplayer servers.');
        return true;
      }
      const destination = roomManager.getOrCreateRoom(invite.roomId);
      const moved = roomManager.movePlayerToRoom(player.uuid, destination, 'player') || player;
      const spawn = roomManager.getSpawnForPlayer(destination, moved);
      this.safeSend(moved.ws, JSON.stringify({
        type: 'serverJump',
        room: destination.id,
        dimension: destination.meta.dimension,
        title: destination.meta.displayName,
        spawn,
        role: moved.role,
        matchPhase: destination.meta.matchPhase || 'LOBBY',
        matchState: destination.meta.matchState,
        meta: destination.meta,
        message: `Joined ${invite.fromName}'s lobby/world.`
      }));
      this.grantTeleportGrace(moved, spawn);
      this.worldInvites.delete(this.playerKey(player));
      return true;
    }

    if (command === '/friend' || command === '/friends' || command === '/f') {
      if (sub === 'list' || !sub) {
        const friends = this.friendships.get(this.playerKey(player)) || new Set<string>();
        const online: string[] = [];
        for (const candidateRoom of roomManager?.rooms.values() || []) {
          for (const candidate of candidateRoom.players.values()) {
            if (friends.has(this.playerKey(candidate))) online.push(`${candidate.username} (${candidateRoom.meta?.displayName || candidateRoom.id})`);
          }
        }
        this.sendSystem(player, online.length ? `Online friends: ${online.join(', ')}` : 'No friends online. Use /friend add <name>.');
        return true;
      }

      if (sub === 'add') {
        const target = this.findOnlinePlayer(roomManager, parts[2]);
        if (!target || target.player.uuid === player.uuid) {
          this.sendSystem(player, 'Usage: /friend add <online-player>');
          return true;
        }
        const targetKey = this.playerKey(target.player);
        const myKey = this.playerKey(player);
        if (this.areFriends(player, target.player)) {
          this.sendSystem(player, `You and ${target.player.username} are already friends.`);
          return true;
        }
        if (!this.friendRequests.has(targetKey)) this.friendRequests.set(targetKey, new Set());
        this.friendRequests.get(targetKey)!.add(myKey);
        this.sendSystem(player, `Friend request sent to ${target.player.username}.`);
        this.sendSystem(target.player, `${player.username} sent you a friend request. Type /friend accept ${player.username}.`);
        return true;
      }

      if (sub === 'accept') {
        const target = this.findOnlinePlayer(roomManager, parts[2]);
        if (!target) {
          this.sendSystem(player, 'Usage: /friend accept <online-player>');
          return true;
        }
        const myKey = this.playerKey(player);
        const theirKey = this.playerKey(target.player);
        if (!this.friendRequests.get(myKey)?.has(theirKey)) {
          this.sendSystem(player, `No request from ${target.player.username}.`);
          return true;
        }
        this.friendRequests.get(myKey)?.delete(theirKey);
        this.addFriendship(player, target.player);
        this.sendSystem(player, `You are now friends with ${target.player.username}.`);
        this.sendSystem(target.player, `${player.username} accepted your friend request.`);
        return true;
      }

      if (sub === 'remove') {
        const target = this.findOnlinePlayer(roomManager, parts[2]);
        const targetKey = target ? this.playerKey(target.player) : this.usernameKey(parts[2]);
        const myKey = this.playerKey(player);
        this.friendships.get(myKey)?.delete(targetKey);
        if (target) this.friendships.get(targetKey)?.delete(myKey);
        this.sendSystem(player, 'Friend removed if they were on your list.');
        return true;
      }

      // Shortcut: /f <name> <message>
      const target = this.findOnlinePlayer(roomManager, parts[1]);
      const message = parts.slice(2).join(' ').slice(0, this.CHAT_MAX_CHARS);
      if (target && message && this.areFriends(player, target.player)) {
        this.sendSystem(player, `[to ${target.player.username}] ${message}`, 'Friend Chat');
        this.sendSystem(target.player, `[from ${player.username}] ${message}`, 'Friend Chat');
        return true;
      }

      this.sendSystem(player, 'Friend commands: /friend add <name>, /friend accept <name>, /friend list, /msg <friend> <message>, /invite <friend>.');
      return true;
    }

    return true;
  }

  private static handleSlashCommand(text: string, player: RoomPlayer, room: Room, roomManager?: RoomManager): void {
    const command = text.trim().toLowerCase().split(/\s+/)[0];

    if (command === '/help' || command === '/modes' || command === '/minigames') {
      const commandList = MINIGAME_DEFINITIONS
        .map(mode => `${mode.command} (${mode.shortTitle})`)
        .join(', ');
      this.safeSend(player.ws, JSON.stringify({
        type: 'chat',
        sender: 'Server',
        text: `Commands: ${commandList}, /start, /wait, /friend add <name>, /msg <friend> <message>, /invite <friend>.`
      }));
      return;
    }

    if (this.handleSocialCommand(text, player, room, roomManager)) return;

    if (command === '/start') {
      if (!roomManager?.forceStartMinigameRoom(room)) {
        this.safeSend(player.ws, JSON.stringify({
          type: 'chat',
          sender: 'Matchmaker',
          text: 'There is no waiting minigame round here to start.'
        }));
      }
      return;
    }

    if (command === '/wait') {
      if (!roomManager?.extendPregameRoom(room, CROWNFORGE_PREGAME_SECONDS)) {
        this.safeSend(player.ws, JSON.stringify({
          type: 'chat',
          sender: 'Matchmaker',
          text: 'There is no pregame timer here to extend.'
        }));
      }
      return;
    }

    if (command === '/lobby' || command === '/hub') {
      if (!roomManager) return;
      const destination = roomManager.getOrCreateRoom(CROWNFORGE_LOBBY_ROOM);
      const moved = roomManager.movePlayerToRoom(player.uuid, destination, 'player') || player;
      const spawn = roomManager.getSpawnForPlayer(destination, moved);
      this.safeSend(moved.ws, JSON.stringify({
        type: 'serverJump',
        room: destination.id,
        dimension: destination.meta.dimension,
        title: destination.meta.displayName,
        spawn,
        role: 'player',
        matchPhase: destination.meta.matchPhase || 'LOBBY',
        meta: destination.meta,
        message: 'Returned to CrownForge lobby.'
      }));
      this.grantTeleportGrace(moved, spawn);
      return;
    }

    const jump = getMinigameByCommand(command);
    if (!jump) {
      this.safeSend(player.ws, JSON.stringify({
        type: 'chat',
        sender: 'Server',
        text: `Unknown command "${command}". Try /help or right-click the CrownForge Navigator.`
      }));
      return;
    }

    let targetRoom = jump.room;
    let spawn = jump.spawn;
    let role = 'player';
    let matchPhase = '';
    let meta: any = null;

    if (roomManager && jump.id === 'csgo') {
      const destination = roomManager.getOrCreateRoom(jump.room, {
        displayName: jump.title,
        description: jump.subtitle,
        kind: 'minigame_match',
        dimension: 'cbgo_menu',
        permanent: false,
        pvp: true,
        serverId: CROWNFORGE_SERVER_ID,
        gameModes: [jump.shortTitle],
        motd: jump.message,
        color: jump.accent,
        maxPlayers: jump.maxPlayers,
        minigameId: 'csgo',
        matchPhase: 'PREGAME',
        spawn: { x: 0, y: 65, z: 0 },
        pregameSpawn: { x: 0, y: 65, z: 0 },
      });
      const moved = roomManager.movePlayerToRoom(player.uuid, destination, 'player') || player;
      const cbgoSpawn = roomManager.getSpawnForPlayer(destination, moved);
      this.safeSend(moved.ws, JSON.stringify({
        type: 'serverJump',
        room: destination.id,
        dimension: destination.meta.dimension,
        title: destination.meta.displayName,
        spawn: cbgoSpawn,
        role: 'player',
        matchPhase: destination.meta.matchPhase || 'PREGAME',
        matchState: destination.meta.matchState || null,
        meta: destination.meta,
        forceSpawn: true,
        message: 'Opened CBGO menu. Choose Start Premier to enter veto, warmup, and MR12 bomb-defusal play.'
      }));
      this.grantTeleportGrace(moved, cbgoSpawn);
      return;
    }

    if (roomManager && jump.id !== 'lobby' && jump.id !== 'anarchy' && jump.id !== 'backrooms') {
      const pregameSpawn = CROWNFORGE_PREGAME_SPAWN;
      const spectatorSpawn = { x: 0, y: 84, z: 0 };
      const match = roomManager.findBestMatchRoom({
        id: jump.id,
        baseRoom: jump.room,
        title: jump.title,
        description: jump.subtitle,
        dimension: jump.dimension,
        pvp: jump.pvp,
        gameModes: [jump.shortTitle],
        motd: jump.message,
        color: jump.accent,
        maxPlayers: jump.maxPlayers,
        liveSpawn: jump.spawn,
        pregameSpawn,
        spectatorSpawn,
      });
      targetRoom = match.id;
      spawn = roomManager.getSpawnForPlayer(match, {
        ...player,
        role: ['IN_MATCH','SUDDEN_DEATH','ENDING','POSTGAME','LIVE'].includes(String(match.meta.matchPhase || '').toUpperCase()) ? 'spectator' : 'player',
      });
      role = ['IN_MATCH','SUDDEN_DEATH','ENDING','POSTGAME','LIVE'].includes(String(match.meta.matchPhase || '').toUpperCase()) ? 'spectator' : 'player';
      matchPhase = match.meta.matchPhase || '';
      meta = match.meta;
    } else if (roomManager) {
      const destinationMeta = jump.id === 'backrooms'
        ? {
            displayName: jump.title,
            description: jump.subtitle,
            kind: 'custom' as const,
            dimension: jump.dimension,
            permanent: true,
            pvp: false,
            serverId: CROWNFORGE_SERVER_ID,
            gameModes: [jump.shortTitle],
            motd: jump.message,
            color: jump.accent,
            maxPlayers: jump.maxPlayers,
            minigameId: 'backrooms',
            matchPhase: 'LOBBY' as const,
            spawn: jump.spawn,
          }
        : undefined;
      const destination = roomManager.getOrCreateRoom(jump.room, destinationMeta);
      targetRoom = destination.id;
      spawn = roomManager.getSpawnForPlayer(destination, player);
      meta = destination.meta;
    }

    const destination = roomManager?.getOrCreateRoom(targetRoom, meta || undefined);
    const movedPlayer = roomManager && destination
      ? (roomManager.movePlayerToRoom(player.uuid, destination, role as any) || player)
      : player;
    if (roomManager && destination) {
      spawn = roomManager.getSpawnForPlayer(destination, movedPlayer);
      meta = destination.meta;
      targetRoom = destination.id;
      role = movedPlayer.role;
      matchPhase = destination.meta.matchPhase || matchPhase;
    }

    this.safeSend(movedPlayer.ws, JSON.stringify({
      type: 'serverJump',
      room: targetRoom,
      dimension: meta?.dimension || jump.dimension,
      title: meta?.displayName || jump.title,
      spawn,
      role,
      matchPhase,
      matchState: meta?.matchState,
      meta,
      message: role === 'spectator'
        ? `Joining ${jump.title} as a spectator.`
        : (['PREGAME','COUNTDOWN','QUEUEING','pregame'].includes(String(matchPhase || '').toUpperCase())
          ? `Queued for ${jump.title}. Pregame starts in the lobby and launches in ${CROWNFORGE_PREGAME_SECONDS} seconds.`
          : jump.message),
    }));

    // Grant a short bounded grace for the authoritative serverJump only.
    this.grantTeleportGrace(movedPlayer, spawn);

    this.broadcastToRoom(room, JSON.stringify({
      type: 'chat',
      sender: 'Server',
      text: `${player.username} left for ${jump.title}.`
    }), player.uuid);
  }

  private static modManifestMatches(clientManifest: any, requiredManifest: any): boolean {
    const requiredMods = Array.isArray(requiredManifest?.mods) ? requiredManifest.mods : [];
    if (requiredMods.length === 0) return true;

    const clientMods = Array.isArray(clientManifest?.mods) ? clientManifest.mods : [];
    const clientByName = new Map<string, string>();
    for (const mod of clientMods) {
      if (typeof mod?.name === 'string') {
        clientByName.set(mod.name, String(mod.hash || ''));
      }
    }

    return requiredMods.every((mod: any) => (
      typeof mod?.name === 'string' &&
      clientByName.get(mod.name) === String(mod.hash || '')
    ));
  }


  private static getMobAuthority(room: Room): string {
    const anyRoom = room as any;
    const players: Map<string, RoomPlayer> | null = anyRoom.players instanceof Map ? anyRoom.players : null;
    const now = Date.now();

    if (anyRoom.__mobAuthorityUuid && players?.has(anyRoom.__mobAuthorityUuid)) {
      const holder = players.get(anyRoom.__mobAuthorityUuid) as any;
      const lastMoveAt = Number(holder?.__lastMove?.at || holder?.__antiCheatMove?.at || 0);
      const lastSnapshotAt = Number(anyRoom.__mobAuthorityLastAt || 0);
      if (holder?.ws?.readyState === WebSocket.OPEN && (now - Math.max(lastMoveAt, lastSnapshotAt)) < this.MOB_AUTHORITY_STALE_MS) {
        return anyRoom.__mobAuthorityUuid;
      }
    }

    const candidates = players ? Array.from(players.values()) : [];
    const active = candidates
      .filter(p => p.ws.readyState === WebSocket.OPEN && p.role !== 'spectator')
      .sort((a: any, b: any) => Number(b.__lastMove?.at || b.__antiCheatMove?.at || 0) - Number(a.__lastMove?.at || a.__antiCheatMove?.at || 0));
    const next = active[0] || candidates.find(p => p.ws.readyState === WebSocket.OPEN) || null;
    anyRoom.__mobAuthorityUuid = next?.uuid || '';
    anyRoom.__mobAuthorityLastAt = now;
    return anyRoom.__mobAuthorityUuid;
  }

  private static sanitizeBlockBreakProgress(msg: any, player: RoomPlayer): any | null {
    const stage = Math.max(0, Math.min(6, Math.floor(Number(msg.stage ?? 0))));
    const x = Math.floor(Number(msg.x ?? 0));
    const y = Math.floor(Number(msg.y ?? 0));
    const z = Math.floor(Number(msg.z ?? 0));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return {
      type: 'blockBreakProgress',
      uuid: player.uuid,
      x: Math.max(-2_000_000, Math.min(2_000_000, x)),
      y: Math.max(-2048, Math.min(4096, y)),
      z: Math.max(-2_000_000, Math.min(2_000_000, z)),
      stage,
    };
  }

  private static sanitizeVoiceSignal(msg: any, player: RoomPlayer): any | null {
    const toUuid = String(msg.toUuid || '').slice(0, 64);
    const kind = String(msg.kind || '').toLowerCase();
    if (!toUuid || !['offer', 'answer', 'ice'].includes(kind)) return null;

    const payloadText = JSON.stringify(msg.payload ?? null);
    if (payloadText.length > this.VOICE_SIGNAL_MAX_CHARS) return null;

    return {
      type: 'voiceSignal',
      fromUuid: player.uuid,
      username: player.username,
      toUuid,
      kind,
      payload: msg.payload ?? null,
    };
  }

  private static checkMoveAntiCheat(
    player: RoomPlayer,
    room: Room,
    move: { x: number; y: number; z: number; yaw: number; pitch: number; heldItemId: number },
    now: number,
    roomManager?: RoomManager
  ): boolean {
    const values = [move.x, move.y, move.z, move.yaw, move.pitch];
    if (values.some(v => !Number.isFinite(v))) {
      return this.flagCheat(player, room, 'invalid movement packet', roomManager, true);
    }

    if (Math.abs(move.pitch) > 1.75 || Math.abs(move.yaw) > Math.PI * 32 || !Number.isInteger(move.heldItemId) || move.heldItemId < 0 || move.heldItemId > 65535) {
      return this.flagCheat(player, room, 'impossible movement look or held item data', roomManager, true);
    }

    const moveWindowStart = (player as any).__moveWindowStart || 0;
    if (now - moveWindowStart > 1000) {
      (player as any).__moveWindowStart = now;
      (player as any).__movePacketCount = 0;
    }
    (player as any).__movePacketCount = ((player as any).__movePacketCount || 0) + 1;
    if ((player as any).__movePacketCount > 85) {
      return this.flagCheat(player, room, 'movement packet flood', roomManager);
    }

    if (Math.abs(move.x) > 2_000_000 || Math.abs(move.z) > 2_000_000 || move.y < -2048 || move.y > 4096) {
      return this.flagCheat(player, room, 'movement outside world bounds', roomManager, true);
    }

    const graceUntil = (player as any).__teleportGraceUntil || 0;
    const graceAnchor = (player as any).__teleportGraceAnchor;
    if (now < graceUntil) {
      if (graceAnchor) {
        const distFromAnchor = Math.hypot(move.x - Number(graceAnchor.x || 0), move.y - Number(graceAnchor.y || 0), move.z - Number(graceAnchor.z || 0));
        if (!Number.isFinite(distFromAnchor) || distFromAnchor > this.TELEPORT_GRACE_MAX_DISTANCE) {
          return this.flagCheat(player, room, 'teleport grace movement exceeded spawn bounds', roomManager, true);
        }
      }
      (player as any).__antiCheatMove = { x: move.x, y: move.y, z: move.z, at: now };
      return true;
    }

    const previous = (player as any).__antiCheatMove;
    (player as any).__antiCheatMove = { x: move.x, y: move.y, z: move.z, at: now };
    if (!previous) return true;

    const gapMs = now - previous.at;
    const dx = move.x - previous.x;
    const dy = move.y - previous.y;
    const dz = move.z - previous.z;
    const horizontal = Math.hypot(dx, dz);
    const total = Math.hypot(dx, dy, dz);
    if (gapMs > 2500) {
      return total <= 64 || this.rejectSuspiciousAction(player, 'movement resumed after a network stall');
    }

    const isMinigame = room.meta.minigameId === 'tf2' ||
                       room.meta.minigameId === 'csgo' ||
                       room.meta.minigameId === 'duels' ||
                       room.meta.minigameId === 'castle' ||
                       room.meta.minigameId === 'survival_games' ||
                       String(room.meta.dimension || '').startsWith('tf2_') ||
                       String(room.meta.dimension || '').startsWith('cbgo_') ||
                       String(room.meta.dimension || '').startsWith('cob_');

    const dt = Math.max(0.05, Math.min(0.25, gapMs / 1000));
    const spectator = player.role === 'spectator';
    // Raised maxHorizontal to 36 (was 28) to account for elytra/sprint + latency burst.
    // maxTotal raised to 60 (was 46). For minigames (e.g. TF2 rocket jumping), speed limits are relaxed.
    const maxHorizontal = spectator ? 120 : (isMinigame ? 180 : 58);
    const maxTotal = spectator ? 160 : (isMinigame ? 240 : 92);

    if (horizontal > maxHorizontal * dt + 12 || total > maxTotal * dt + 16) {
      return this.rejectSuspiciousAction(player, `movement correction ignored (${horizontal.toFixed(1)} blocks/s)`);
    }

    if (!spectator && dy > (isMinigame ? 180 : 46) * dt + (isMinigame ? 45 : 14)) {
      return this.rejectSuspiciousAction(player, 'vertical movement correction ignored');
    }

    return true;
  }

  private static checkBlockEditAntiCheat(
    player: RoomPlayer,
    room: Room,
    edit: { x: number; y: number; z: number; blockId: number },
    roomManager?: RoomManager
  ): boolean {
    const values = [edit.x, edit.y, edit.z, edit.blockId];
    if (values.some(v => !Number.isFinite(v))) {
      return this.flagCheat(player, room, 'invalid block edit packet', roomManager, true);
    }

    if (Math.abs(edit.x) > 2_000_000 || Math.abs(edit.z) > 2_000_000 || edit.y < -2048 || edit.y > 4096) {
      return this.flagCheat(player, room, 'block edit outside world bounds', roomManager, true);
    }

    const now = Date.now();
    const blockWindowStart = (player as any).__blockEditWindowStart || 0;
    if (now - blockWindowStart > 1000) {
      (player as any).__blockEditWindowStart = now;
      (player as any).__blockEditCount = 0;
    }
    (player as any).__blockEditCount = ((player as any).__blockEditCount || 0) + 1;
    if ((player as any).__blockEditCount > 64) {
      return this.rejectSuspiciousAction(player, 'too many block edits at once');
    }

    const move = (player as any).__lastMove || (player as any).__antiCheatMove;
    if (!move || !move.at || now - Number(move.at) > 3500) return this.rejectSuspiciousAction(player, 'block edit without recent position');

    const dx = Number(move.x) - (edit.x + 0.5);
    const dy = (Number(move.y) + 1.6) - (edit.y + 0.5);
    const dz = Number(move.z) - (edit.z + 0.5);
    const reachSq = dx * dx + dy * dy + dz * dz;
    const maxReach = player.role === 'spectator' ? 128 : 24;

    if (!Number.isFinite(reachSq) || reachSq > maxReach * maxReach) {
      return this.rejectSuspiciousAction(player, 'block is too far away');
    }

    return true;
  }

  private static rejectSuspiciousAction(player: RoomPlayer, reason: string): boolean {
    const now = Date.now();
    const last = (player as any).__lastAntiCheatWarnAt || 0;
    if (now - last > 2500) {
      (player as any).__lastAntiCheatWarnAt = now;
      this.safeSend(player.ws, JSON.stringify({
        type: 'chat',
        sender: 'AntiCheat',
        text: `Suspicious action ignored: ${reason}.`
      }));
    }
    return false;
  }

  private static flagCheat(player: RoomPlayer, room: Room, reason: string, roomManager?: RoomManager, immediate = false): boolean {
    const now = Date.now();
    const graceUntil = (player as any).__teleportGraceUntil || 0;
    if (now < graceUntil && !immediate) return false;

    const key = String(reason).replace(/\(.+\)/, '').trim();
    const severe = immediate || /outside world bounds|invalid|teleport grace/i.test(key);
    const weight = severe ? 8 : (/packet flood|client attempted/i.test(key) ? 2 : 1);
    const flags: Array<{ at: number; reason: string; weight: number }> = ((player as any).__cheatFlagsDetailed || [])
      .filter((flag: { at: number; reason: string; weight?: number }) => now - flag.at < this.WATCHDOG_WINDOW_MS)
      .map((flag: { at: number; reason: string; weight?: number }) => ({ ...flag, weight: Number(flag.weight || 1) }));
    flags.push({ at: now, reason: key, weight });
    (player as any).__cheatFlagsDetailed = flags;

    const sameReason = flags.filter(flag => flag.reason === key);
    const totalScore = flags.reduce((sum, flag) => sum + Number(flag.weight || 1), 0);
    const evidence = flags.slice(-18).map(flag => `${flag.reason}@${flag.at}`);
    const mode = String(process.env.CUBEGAME_WATCHDOG_MODE || 'monitor').toLowerCase();
    const allowBan = process.env.CUBEGAME_WATCHDOG_BAN === '1' || process.env.ANTICHEAT_AUTO_BAN === '1';
    const shouldBan = allowBan && totalScore >= this.WATCHDOG_BAN_SCORE && sameReason.length >= 6;
    const shouldKick = mode === 'enforce' && totalScore >= this.WATCHDOG_KICK_SCORE && sameReason.length >= 5;

    console.warn(`[Watchdog] ${player.username}/${player.uuid} ${key} score=${totalScore} room=${room.id}`);

    if ((shouldBan || shouldKick) && !(player as any).__watchdogActionScheduled) {
      (player as any).__watchdogActionScheduled = true;
      setTimeout(() => {
        try {
          this.broadcastToRoom(room, JSON.stringify({
            type: 'chat',
            sender: 'Watchdog',
            text: `${player.username} was removed for unfair play.`
          }), player.uuid);
          if (shouldBan && allowBan) {
            roomManager?.banPlayer(player, key, undefined, evidence);
          } else {
            this.safeSend(player.ws, JSON.stringify({
              type: 'banned',
              reason: `Watchdog removed you: ${key}`
            }));
            try { player.ws.close(4002, 'Watchdog unfair play'); } catch {}
            roomManager?.removePlayerFromAll(player.uuid);
          }
        } finally {
          (player as any).__watchdogActionScheduled = false;
        }
      }, severe ? 450 : 1400);
    }

    const last = (player as any).__lastAntiCheatWarnAt || 0;
    if (now - last > 2500) {
      (player as any).__lastAntiCheatWarnAt = now;
      this.safeSend(player.ws, JSON.stringify({
        type: 'chat',
        sender: 'Watchdog',
        text: `Action ignored: ${reason}.`
      }));
    }
    return false;
  }

  private static sanitizeMobSnapshot(msg: any, player: RoomPlayer): any | null {
    if (!Array.isArray(msg.mobs)) return null;
    const mobs = msg.mobs.slice(0, this.MOB_SNAPSHOT_LIMIT).map((m: any) => {
      const id = String(m.id || '').slice(0, 64);
      const mobType = String(m.mobType || '').slice(0, 32);
      const x = Number(m.x), y = Number(m.y), z = Number(m.z);
      if (!id || !mobType || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
      return {
        id, mobType,
        x: Math.max(-2_000_000, Math.min(2_000_000, x)),
        y: Math.max(-2048, Math.min(4096, y)),
        z: Math.max(-2_000_000, Math.min(2_000_000, z)),
        vx: Number.isFinite(Number(m.vx)) ? Math.max(-64, Math.min(64, Number(m.vx))) : 0,
        vy: Number.isFinite(Number(m.vy)) ? Math.max(-64, Math.min(64, Number(m.vy))) : 0,
        vz: Number.isFinite(Number(m.vz)) ? Math.max(-64, Math.min(64, Number(m.vz))) : 0,
        yaw: Number.isFinite(Number(m.yaw)) ? Number(m.yaw) : 0,
        health: Math.max(0, Math.min(1000, Number(m.health ?? 1))),
        maxHealth: Math.max(1, Math.min(1000, Number(m.maxHealth ?? 20))),
        dead: !!m.dead,
        state: String(m.state || 'idle').slice(0, 24),
        slimeSize: Math.max(1, Math.min(8, Math.floor(Number(m.slimeSize ?? 3)))),
        tamed: !!m.tamed,
        sitting: !!m.sitting,
        staticShop: !!m.staticShop,
        shopTeam: typeof m.shopTeam === 'string' ? m.shopTeam.slice(0, 16) : undefined,
        shopKind: typeof m.shopKind === 'string' ? m.shopKind.slice(0, 24) : undefined,
        displayName: typeof m.displayName === 'string' ? m.displayName.slice(0, 64) : undefined,
      };
    }).filter(Boolean);

    return { type: 'mobSnapshot', uuid: player.uuid, mobs };
  }

  private static isValidSkinDataUrl(dataUrl: unknown): dataUrl is string {
    return typeof dataUrl === 'string' &&
      /^data:image\/(png|jpeg);base64,/i.test(dataUrl) &&
      dataUrl.length <= this.MAX_SKIN_DATA_URL_CHARS;
  }

  private static broadcastToRoom(room: Room, data: Sendable, excludeUuid?: string): void {
    const anyRoom = room as any;

    // Prefer direct sends so overloaded clients don't slow everyone else down.
    const players = anyRoom.players;
    if (players instanceof Map) {
      for (const p of players.values()) {
        if (p?.uuid === excludeUuid) continue;
        this.safeSend(p.ws, data);
      }
      return;
    }

    if (Array.isArray(players)) {
      for (const p of players) {
        if (p?.uuid === excludeUuid) continue;
        this.safeSend(p.ws, data);
      }
      return;
    }

    // Fallback for the existing RoomManager implementation.
    room.broadcast(data, excludeUuid);
  }

  private static flushSyncHistory(player: RoomPlayer, room: Room): void {
    const anyRoom = room as any;
    const blockHistory: Buffer[] = (anyRoom.__recentBlockEdits || []).slice(-this.SYNC_BLOCK_SEND_LIMIT);
    const itemHistory: string[] = (anyRoom.__recentItemDrops || []).slice(-this.SYNC_ITEM_SEND_LIMIT);
    const packets: Sendable[] = [...blockHistory, ...itemHistory];
    if (anyRoom.__lastMobSnapshot) packets.push(anyRoom.__lastMobSnapshot);

    let offset = 0;
    const pump = () => {
      if (player.ws.readyState !== WebSocket.OPEN) return;
      const end = Math.min(offset + this.SYNC_HISTORY_BATCH_SIZE, packets.length);
      for (; offset < end; offset++) {
        if (!this.safeSend(player.ws, packets[offset])) return;
      }
      if (offset < packets.length) setImmediate(pump);
    };
    pump();
  }

  private static grantTeleportGrace(player: RoomPlayer, spawn: { x: number; y: number; z: number }): void {
    (player as any).__teleportGraceUntil = Date.now() + this.TELEPORT_GRACE_MS;
    (player as any).__teleportGraceAnchor = { x: Number(spawn.x), y: Number(spawn.y), z: Number(spawn.z) };
    (player as any).__antiCheatMove = null;
    (player as any).__lastMove = null;
  }

  private static safeSend(ws: WebSocket, data: Sendable): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const anySocket = ws as any;
    const now = Date.now();
    if (ws.bufferedAmount > this.MAX_BACKPRESSURE_BYTES) {
      if (!anySocket.__backpressureStartedAt) anySocket.__backpressureStartedAt = now;
      // Do not instantly kill clients during a join burst. Drop optional outgoing
      // payloads first; only close sockets that stay wedged for several seconds.
      if (now - anySocket.__backpressureStartedAt > this.MAX_BACKPRESSURE_MS) {
        try { ws.close(1013, 'Backpressure timeout'); } catch { /* ignore */ }
        setTimeout(() => {
          if (ws.readyState !== WebSocket.CLOSED) {
            try { ws.terminate(); } catch { /* ignore */ }
          }
        }, 1500).unref?.();
      }
      return false;
    }
    anySocket.__backpressureStartedAt = 0;

    try {
      ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  private static getRoomPlayersPayload(room: Room, skipUuid?: string): any[] {
    return Array.from(room.players.values())
      .filter(p => p.uuid !== skipUuid && p.ws.readyState === WebSocket.OPEN)
      .map(p => {
        const move = (p as any).__lastMove || null;
        return {
          uuid: p.uuid,
          index: p.index,
          username: p.username,
          skinDataUrl: p.skinDataUrl || null,
          role: p.role,
          lastMove: move ? {
            x: Number(move.x || 0),
            y: Number(move.y || 68),
            z: Number(move.z || 0),
            yaw: Number(move.yaw || 0),
            pitch: Number(move.pitch || 0),
            heldItemId: Number(move.heldItemId || 0),
          } : null,
        };
      });
  }

  private static rememberBlockEdit(room: Room, edit: Buffer): void {
    const anyRoom = room as any;
    if (!anyRoom.__recentBlockEdits) anyRoom.__recentBlockEdits = [];

    const history: Buffer[] = anyRoom.__recentBlockEdits;
    history.push(Buffer.from(edit));

    if (history.length > this.RECENT_BLOCK_HISTORY_LIMIT) {
      history.splice(0, history.length - this.RECENT_BLOCK_HISTORY_LIMIT);
    }
  }

  private static sanitizePlayerDamage(msg: any, player: RoomPlayer, room: Room, roomManager?: RoomManager): any | null {
    const now = Date.now();
    const lastHitAt = (player as any).__lastPvpHitAt || 0;
    if (now - lastHitAt < 260) return null;

    const targetUuid = String(msg.targetUuid || '').slice(0, 64);
    const damage = Math.max(0.5, Math.min(20, Number(msg.damage ?? 1)));
    if (!targetUuid || !Number.isFinite(damage) || targetUuid === player.uuid) return null;

    const players = (room as any).players;
    const target = players instanceof Map ? players.get(targetUuid) : null;
    if (!target) return null;

    const aPositions = [
      (player as any).__lastMove,
      (player as any).__prevMove,
      roomManager?.getSpawnForPlayer(room, player)
    ].filter(Boolean);

    const bPositions = [
      (target as any).__lastMove,
      (target as any).__prevMove,
      roomManager?.getSpawnForPlayer(room, target)
    ].filter(Boolean);

    const heldItemId = Number(aPositions[0]?.heldItemId || 0);
    const isRanged = room.meta.kind === 'minigame_match' ||
                     !!room.meta.minigameId ||
                     heldItemId === 270 ||
                     heldItemId === 465;

    const maxDist = isRanged ? 140 : 8;
    const maxDistSq = maxDist * maxDist;

    if (aPositions.length > 0 && bPositions.length > 0) {
      let minDistSq = Infinity;
      for (const posA of aPositions) {
        for (const posB of bPositions) {
          const dx = Number(posA.x) - Number(posB.x);
          const dy = Number(posA.y) - Number(posB.y);
          const dz = Number(posA.z) - Number(posB.z);
          const distSq = dx * dx + dy * dy + dz * dz;
          if (Number.isFinite(distSq) && distSq < minDistSq) {
            minDistSq = distSq;
          }
        }
      }
      if (minDistSq > maxDistSq) return null;
    } else {
      return null;
    }

    (player as any).__lastPvpHitAt = now;
    return {
      type: 'playerDamage',
      uuid: player.uuid,
      targetUuid,
      damage
    };
  }

  private static sanitizeCbgoShot(msg: any, player: RoomPlayer, room: Room, roomManager?: RoomManager): any | null {
    if (room.meta.minigameId !== 'csgo') return null;
    const now = Date.now();
    const lastShotAt = (player as any).__lastCbgoShotAt || 0;
    if (now - lastShotAt < 65) return null;
    (player as any).__lastCbgoShotAt = now;

    const weaponId = Math.max(0, Math.min(65535, Number(msg.weaponId || 0)));
    const targetUuid = String(msg.targetUuid || '').slice(0, 64);
    const damage = Math.max(1, Math.min(34, Number(msg.damage ?? 8)));
    const origin = {
      x: Number(msg.origin?.x),
      y: Number(msg.origin?.y),
      z: Number(msg.origin?.z),
    };
    const end = {
      x: Number(msg.end?.x),
      y: Number(msg.end?.y),
      z: Number(msg.end?.z),
    };
    if (![origin.x, origin.y, origin.z, end.x, end.y, end.z].every(Number.isFinite)) return null;

    const moves = [
      (player as any).__lastMove,
      (player as any).__prevMove,
      roomManager?.getSpawnForPlayer(room, player)
    ].filter(Boolean);

    let match = false;
    for (const m of moves) {
      const dx = Number(m.x) - origin.x;
      const dy = Number(m.y) + 1.4 - origin.y;
      const dz = Number(m.z) - origin.z;
      if (dx * dx + dy * dy + dz * dz <= 36) { // Allow up to 6 blocks from any recent move position
        match = true;
        break;
      }
    }
    if (!match && moves.length > 0) return null;

    const shotDx = end.x - origin.x;
    const shotDy = end.y - origin.y;
    const shotDz = end.z - origin.z;
    const rangeSq = shotDx * shotDx + shotDy * shotDy + shotDz * shotDz;
    if (!Number.isFinite(rangeSq) || rangeSq > 140 * 140) return null;

    if (targetUuid) {
      const target = room.players.get(targetUuid);
      if (!target || target.uuid === player.uuid || target.role === 'spectator') return null;
      if ((target as any).__cbgoTeam && (player as any).__cbgoTeam && (target as any).__cbgoTeam === (player as any).__cbgoTeam) {
        return null;
      }
      const targetMove = (target as any).__lastMove || roomManager?.getSpawnForPlayer(room, target);
      if (!targetMove) return null;
      const distSq = (Number(targetMove.x) - origin.x) ** 2 + (Number(targetMove.y) - origin.y) ** 2 + (Number(targetMove.z) - origin.z) ** 2;
      if (!Number.isFinite(distSq) || distSq > 140 * 140) return null;
      (target as any).__lastCbgoAttacker = player.uuid;
    }

    return {
      type: 'cbgoShot',
      uuid: player.uuid,
      username: player.username,
      targetUuid,
      weaponId,
      damage,
      origin,
      end,
      at: now,
    };
  }

  private static sanitizeWeather(msg: any): RoomWeatherState | null {
    const weather = String(msg.weather || 'clear').toLowerCase();
    if (weather !== 'clear' && weather !== 'rain' && weather !== 'thunder') return null;
    const intensity = Math.max(0, Math.min(1, Number(msg.intensity ?? 1)));
    return { weather: weather as RoomWeatherState['weather'], intensity: Number.isFinite(intensity) ? intensity : 1, updatedAt: Date.now() };
  }

  private static sanitizePlayerState(msg: any, player: RoomPlayer): any | null {
    return {
      type: 'playerState',
      uuid: player.uuid,
      username: player.username,
      crouching: !!msg.crouching,
      sprinting: !!msg.sprinting,
      moving: !!msg.moving,
      punching: !!msg.punching,
      invisible: !!msg.invisible,
    };
  }

  private static sanitizeModPacket(msg: any, player: RoomPlayer): any | null {
    const channel = String(msg.channel || '').slice(0, 96);
    if (!channel) return null;

    let payload = msg.payload ?? null;
    try {
      const serialized = JSON.stringify(payload);
      if (serialized.length > this.MOD_PACKET_MAX_CHARS) return null;
      payload = JSON.parse(serialized);
    } catch {
      payload = null;
    }

    return {
      type: 'modPacket',
      channel,
      payload,
      uuid: player.uuid,
      username: player.username,
    };
  }

  private static findRecentItemDrop(room: Room, id: string): any | null {
    const anyRoom = room as any;
    if (!(anyRoom.__recentItemDropIds instanceof Set) || !anyRoom.__recentItemDropIds.has(id)) return null;
    for (const entry of (anyRoom.__recentItemDrops || []) as string[]) {
      try {
        const parsed = JSON.parse(entry);
        if (String(parsed?.id || '') === id) return parsed;
      } catch {
        // Ignore malformed history entries.
      }
    }
    return null;
  }

  private static sanitizeItemDrop(msg: any): any | null {
    const id = String(msg.id || '').slice(0, 64);
    const itemId = Number(msg.itemId);
    const count = Number(msg.count ?? 1);
    const x = Number(msg.x);
    const y = Number(msg.y);
    const z = Number(msg.z);
    const vx = Number(msg.vx ?? 0);
    const vy = Number(msg.vy ?? 0);
    const vz = Number(msg.vz ?? 0);

    if (!id || !Number.isFinite(itemId) || !Number.isFinite(count) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return {
      type: 'itemDrop',
      id,
      itemId: Math.max(0, Math.min(65535, Math.floor(itemId))),
      count: Math.max(1, Math.min(999, Math.floor(count))),
      x: Math.max(-2_000_000, Math.min(2_000_000, x)),
      y: Math.max(-2048, Math.min(4096, y)),
      z: Math.max(-2_000_000, Math.min(2_000_000, z)),
      vx: Number.isFinite(vx) ? Math.max(-64, Math.min(64, vx)) : 0,
      vy: Number.isFinite(vy) ? Math.max(-64, Math.min(64, vy)) : 0,
      vz: Number.isFinite(vz) ? Math.max(-64, Math.min(64, vz)) : 0,
    };
  }

  private static rememberItemDrop(room: Room, packet: string, id: string): void {
    const anyRoom = room as any;
    if (!anyRoom.__recentItemDrops) anyRoom.__recentItemDrops = [];
    if (!anyRoom.__recentItemDropIds) anyRoom.__recentItemDropIds = new Set<string>();

    this.forgetItemDrop(room, id);

    const history: string[] = anyRoom.__recentItemDrops;
    const ids: Set<string> = anyRoom.__recentItemDropIds;
    history.push(packet);
    ids.add(id);

    if (history.length > this.RECENT_ITEM_HISTORY_LIMIT) {
      const removed = history.splice(0, history.length - this.RECENT_ITEM_HISTORY_LIMIT);
      for (const entry of removed) {
        try {
          const parsed = JSON.parse(entry);
          if (parsed?.id) ids.delete(String(parsed.id));
        } catch {
          // ignore corrupted history entries
        }
      }
    }
  }

  private static forgetItemDrop(room: Room, id: string): void {
    const anyRoom = room as any;
    const history: string[] = anyRoom.__recentItemDrops || [];
    anyRoom.__recentItemDrops = history.filter(entry => {
      try {
        return String(JSON.parse(entry)?.id || '') !== id;
      } catch {
        return false;
      }
    });
    if (anyRoom.__recentItemDropIds instanceof Set) anyRoom.__recentItemDropIds.delete(id);
  }

  private static ensureRoomTimeState(room: Room): RoomTimeState {
    const anyRoom = room as any;
    if (!anyRoom.__timeState) {
      anyRoom.__timeState = {
        baseTimeOfDay: 0.15,
        baseServerTimeMs: Date.now(),
        dayLengthMs: 240_000
      } satisfies RoomTimeState;
    }

    return anyRoom.__timeState;
  }

  private static getRoomWeather(room: Room): RoomWeatherState {
    const anyRoom = room as any;
    if (!anyRoom.__weatherState) {
      anyRoom.__weatherState = { weather: 'clear', intensity: 0, updatedAt: Date.now() } satisfies RoomWeatherState;
    }
    return anyRoom.__weatherState;
  }

  private static setRoomTime(room: Room, timeOfDay: number, serverTimeMs: number): void {
    const state = this.ensureRoomTimeState(room);
    state.baseTimeOfDay = BinaryProtocol.normalizeTime(timeOfDay);
    state.baseServerTimeMs = serverTimeMs;
  }

  private static getRoomTime(room: Room, nowMs: number = Date.now()): number {
    const state = this.ensureRoomTimeState(room);
    const elapsed = Math.max(0, nowMs - state.baseServerTimeMs);
    return BinaryProtocol.normalizeTime(state.baseTimeOfDay + elapsed / state.dayLengthMs);
  }

  private static getRoomPlayerCount(room: Room): number {
    const players = (room as any).players;
    if (players instanceof Map) return players.size;
    if (Array.isArray(players)) return players.length;
    if (typeof (room as any).playerCount === 'number') return (room as any).playerCount;
    return 0;
  }


  private static handleCrownForgeObjectiveBreak(
    room: Room,
    player: RoomPlayer,
    edit: { x: number; y: number; z: number; blockId: number }
  ): 'allow' | 'handledReject' | 'none' {
    if (String(room.meta?.minigameId || '').toLowerCase() !== 'bedwars') return 'none';
    if (String(room.meta?.matchPhase || '').toUpperCase() !== 'IN_MATCH') return 'none';

    const bed = this.getBedWarsBedAt(edit.x, edit.y, edit.z);
    if (!bed) return 'none';

    const state = room.meta.matchState;
    const teamState = state?.teams?.[bed.team];
    if (teamState && teamState.bedAlive === false) return 'allow';

    const playerTeam = String((player as any).__crownforgeTeam || '').toLowerCase();
    if (playerTeam && playerTeam === bed.team.toLowerCase()) {
      this.safeSend(player.ws, JSON.stringify({
        type: 'chat',
        sender: 'BedWars',
        text: 'You cannot destroy your own bed.'
      }));
      const restoreId = getFeatureBlockId(`${bed.team} Bed`) || getFeatureBlockId('Bed') || 18;
      this.safeSend(player.ws, Buffer.from(BinaryProtocol.encodeBlockEdit(edit.x, edit.y, edit.z, restoreId)));
      return 'handledReject';
    }

    if (teamState) teamState.bedAlive = false;

    // A BedWars bed is a two-block objective. Breaking either half removes both
    // halves for every player, including the breaker, and persists both edits in
    // the room history for late joiners.
    for (const piece of bed.pieces) {
      const remove = Buffer.from(BinaryProtocol.encodeBlockEdit(piece.x, piece.y, piece.z, 0));
      this.rememberBlockEdit(room, remove);
      this.broadcastToRoom(room, remove);
    }

    room.broadcast(JSON.stringify({
      type: 'crownforgeMatch',
      room: room.id,
      matchPhase: room.meta.matchPhase,
      matchState: state,
      meta: room.meta,
    }));
    room.broadcast(JSON.stringify({
      type: 'chat',
      sender: 'BedWars',
      text: `${bed.team} bed was destroyed by ${player.username}! Final deaths enabled for that team.`
    }));
    return 'handledReject';
  }

  private static getBedWarsBedAt(x: number, y: number, z: number): { team: string; pieces: Array<{ x: number; y: number; z: number }> } | null {
    const teams = Object.entries(CROWNFORGE_BEDWARS_BEDS) as Array<[string, { pieces: Array<{ x: number; y: number; z: number }> }]>;
    for (const [team, bed] of teams) {
      if (bed.pieces.some((piece) => piece.x === x && piece.y === y && piece.z === z)) {
        return { team, pieces: bed.pieces };
      }
    }
    return null;
  }

  /** Is this a CrownForge-managed room that needs block protection? */
  private static isCrownForgeRoom(room: Room): boolean {
    const meta = room.meta;
    const serverId = String(meta?.serverId || '').toLowerCase();
    const dimension = String(meta?.dimension || '').toLowerCase();
    return serverId === CROWNFORGE_SERVER_ID || isCrownForgeDimension(dimension);
  }
}
