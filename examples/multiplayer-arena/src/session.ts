/** Wiring the arena to `@vapour/net`.
 *
 * The server owns every player and projectile; clients own nothing but their
 * own inputs. `ArenaServer` is the whole authority, and `ArenaClient` is
 * deliberately thin — if it needed to be clever, the split would be wrong.
 */
import { NetworkClient, NetworkServer, type ClientOptions, type ConnectionId, type NetState, type ServerConnection, type Transport } from "@vapour/net";
import {
  MAX_HEALTH, PROJECTILE_DAMAGE, PROJECTILE_LIFETIME, PROJECTILE_SPEED, RESPAWN_SECONDS,
  newPlayer, projectileHits, spawnPoint, stepPlayer, stepProjectile,
  type PlayerInputPayload, type PlayerState, type ProjectileState,
} from "./arena.js";

export interface ArenaServerStats {
  readonly players: number;
  readonly projectiles: number;
  readonly shotsFired: number;
  readonly hits: number;
  readonly deaths: number;
  readonly tick: number;
  readonly bytesSent: number;
}

export class ArenaServer {
  readonly net: NetworkServer;
  readonly #players = new Map<ConnectionId, number>();
  readonly #projectiles = new Set<number>();
  #shots = 0;
  #hits = 0;
  #deaths = 0;
  #nextSpawnIndex = 0;

  constructor(transport: Transport, options: { tickRate?: number; scene?: string; reconnectGraceTicks?: number } = {}) {
    this.net = new NetworkServer(transport, {
      tickRate: options.tickRate ?? 20,
      ...(options.scene === undefined ? {} : { scene: options.scene }),
      ...(options.reconnectGraceTicks === undefined ? {} : { reconnectGraceTicks: options.reconnectGraceTicks }),
      onInput: (connection, _tick, payload) => this.#applyInput(connection, payload as PlayerInputPayload),
      // Avatars are spawned here rather than in `join` so a client admitted by
      // a `join` message and one added directly get the same treatment — and a
      // resumed session gets its old avatar back instead of a new one.
      onJoin: (connection, resumed) => (resumed ? this.#rebind(connection.id) : this.#spawnAvatar(connection.id)),
    });
  }

  /** Admits a player directly, without a `join` message. */
  join(connection: ConnectionId): number {
    this.net.addConnection(connection);
    return this.#players.get(connection)!;
  }

  leave(connection: ConnectionId): void {
    this.#players.delete(connection);
    // The net layer despawns anything the connection owned.
    this.net.removeConnection(connection);
  }

  /** Drops a player but keeps their avatar for the grace window. */
  drop(connection: ConnectionId): string | undefined {
    const session = this.net.dropConnection(connection);
    if (session === undefined) this.#players.delete(connection);
    return session;
  }

  #spawnAvatar(connection: ConnectionId): void {
    const spawn = spawnPoint(this.#nextSpawnIndex++, 8);
    const entity = this.net.spawn("player", { ...newPlayer(spawn.x, spawn.z) }, connection);
    this.#players.set(connection, entity.id);
  }

  /** A resumed session's avatar already follows the new connection id; re-key it. */
  #rebind(connection: ConnectionId): void {
    for (const entity of this.net.entities) {
      if (entity.prefab !== "player" || entity.owner !== connection) continue;
      for (const [previous, id] of this.#players) if (id === entity.id) this.#players.delete(previous);
      this.#players.set(connection, entity.id);
    }
  }

  playerEntity(connection: ConnectionId): number | undefined {
    return this.#players.get(connection);
  }

  /** Advances one server tick: simulate, resolve, then replicate. */
  step(deltaSeconds: number): void {
    this.net.receive();
    this.#stepProjectiles(deltaSeconds);
    this.#tickRespawns(deltaSeconds);
    this.net.step();
  }

  stats(): ArenaServerStats {
    const stats = this.net.stats();
    return {
      players: this.#players.size,
      projectiles: this.#projectiles.size,
      shotsFired: this.#shots,
      hits: this.#hits,
      deaths: this.#deaths,
      tick: stats.tick,
      bytesSent: stats.bytesSent,
    };
  }

  #applyInput(connection: ServerConnection, input: PlayerInputPayload): void {
    const entityId = this.#players.get(connection.id);
    if (entityId === undefined) return;
    const entity = this.net.entity(entityId);
    if (!entity) return;

    // The server runs the same movement function the client predicted with.
    const next = stepPlayer(entity.state as PlayerState, input);
    this.net.setState(entityId, next);

    if (input.fire && next.respawn === 0) this.#fire(entityId, next, input);
  }

  #fire(ownerId: number, shooter: PlayerState, input: PlayerInputPayload): void {
    const length = Math.hypot(input.aimX, input.aimZ);
    if (length < 1e-6) return;
    const projectile: ProjectileState = {
      x: shooter.x,
      z: shooter.z,
      vx: (input.aimX / length) * PROJECTILE_SPEED,
      vz: (input.aimZ / length) * PROJECTILE_SPEED,
      owner: ownerId,
      life: PROJECTILE_LIFETIME,
    };
    const entity = this.net.spawn("projectile", { ...projectile });
    this.#projectiles.add(entity.id);
    this.#shots += 1;
  }

  #stepProjectiles(deltaSeconds: number): void {
    for (const id of [...this.#projectiles]) {
      const entity = this.net.entity(id);
      if (!entity) {
        this.#projectiles.delete(id);
        continue;
      }
      const next = stepProjectile(entity.state as ProjectileState, deltaSeconds);
      if (!next) {
        this.net.despawn(id);
        this.#projectiles.delete(id);
        continue;
      }

      let consumed = false;
      for (const playerId of this.#players.values()) {
        const player = this.net.entity(playerId);
        if (!player) continue;
        if (!projectileHits(next, player.state as PlayerState, playerId)) continue;

        const state = player.state as PlayerState;
        const health = state.health - PROJECTILE_DAMAGE;
        this.#hits += 1;
        if (health <= 0) {
          this.#deaths += 1;
          this.net.setState(playerId, { ...state, health: 0, respawn: RESPAWN_SECONDS });
          const shooter = this.net.entity(next.owner);
          // Scoring on the server, because a client reporting its own kills is
          // a client reporting whatever it likes.
          if (shooter) this.net.setState(next.owner, { ...(shooter.state as PlayerState), score: (shooter.state as PlayerState).score + 1 });
        } else {
          this.net.setState(playerId, { ...state, health });
        }
        this.net.despawn(id);
        this.#projectiles.delete(id);
        consumed = true;
        break;
      }
      if (!consumed) this.net.setState(id, next);
    }
  }

  #tickRespawns(deltaSeconds: number): void {
    for (const playerId of this.#players.values()) {
      const entity = this.net.entity(playerId);
      if (!entity) continue;
      const state = entity.state as PlayerState;
      if (state.respawn <= 0) continue;
      const remaining = Math.max(0, state.respawn - deltaSeconds);
      this.net.setState(
        playerId,
        remaining > 0 ? { ...state, respawn: remaining } : { ...state, respawn: 0, health: MAX_HEALTH, x: 0, z: 0 },
      );
    }
  }
}

export class ArenaClient {
  readonly net: NetworkClient;

  constructor(transport: Transport, options: Pick<ClientOptions, "onSceneLoad" | "onSpawn" | "onReject"> = {}) {
    this.net = new NetworkClient(transport, {
      // Prediction uses the *same* function the server does. Two copies of this
      // logic would diverge and show up as constant mispredictions.
      predict: (state, input) => stepPlayer(state as PlayerState, input as PlayerInputPayload) as NetState,
      interpolationDelayTicks: 2,
      ...options,
    });
  }

  join(credentials: NetState = {}): void {
    this.net.join(credentials, 0);
  }

  /** Reconnects with the token from a previous connection; the avatar is kept. */
  resume(session: string): void {
    this.net.resume(session, {}, 0);
  }

  /** Tells the server the scene is loaded, which releases replication. */
  ready(): void {
    this.net.reportSceneProgress(1, true);
  }

  receive(): void {
    this.net.receive(0);
  }

  send(input: PlayerInputPayload): void {
    this.net.sendInput(input, 0);
  }

  /** This client's own player, predicted. */
  self(): PlayerState | undefined {
    for (const entity of this.net.entities) {
      if (entity.local && entity.prefab === "player") return entity.state as PlayerState;
    }
    return undefined;
  }

  /** Other players, interpolated — never predicted. */
  others(): readonly PlayerState[] {
    const out: PlayerState[] = [];
    for (const entity of this.net.entities) {
      if (entity.local || entity.prefab !== "player") continue;
      out.push((this.net.interpolated(entity.id) ?? entity.state) as PlayerState);
    }
    return out;
  }

  projectiles(): readonly ProjectileState[] {
    const out: ProjectileState[] = [];
    for (const entity of this.net.entities) {
      if (entity.prefab !== "projectile") continue;
      out.push((this.net.interpolated(entity.id) ?? entity.state) as ProjectileState);
    }
    return out;
  }
}
