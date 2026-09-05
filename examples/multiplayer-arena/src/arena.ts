/** An authoritative multiplayer arena.
 *
 * The Mirage showcase for `@vapour/net`. Like the physics sandbox, its job is to
 * prove the systems compose under conditions that matter — here, a real network
 * with latency, jitter, and packet loss — rather than to be a game.
 *
 * The shape it demonstrates is the one every competitive game needs and most
 * tutorials get wrong:
 *
 * - **Clients send inputs, the server decides.** A client never says where it
 *   is; it says which keys are down. That is the only arrangement in which a
 *   modified client cannot teleport or shoot through walls.
 * - **The same movement function runs on both sides.** Prediction is only
 *   correct if the client's guess and the server's truth are computed
 *   identically — so `stepPlayer` is one function, imported by both.
 * - **Everyone else is interpolated.** Predicting remote players makes them
 *   jitter on every packet.
 */
import type { NetState } from "@vapour/net";

export const ARENA_SIZE = 40;
export const PLAYER_SPEED = 6;
export const PLAYER_RADIUS = 0.5;
export const PROJECTILE_SPEED = 25;
export const PROJECTILE_LIFETIME = 2;
export const MAX_HEALTH = 100;
export const PROJECTILE_DAMAGE = 34;
export const RESPAWN_SECONDS = 3;

export interface PlayerInputPayload extends NetState {
  /** Movement axes in `[-1, 1]`. */
  readonly moveX: number;
  readonly moveZ: number;
  /** Aim direction, normalized. */
  readonly aimX: number;
  readonly aimZ: number;
  readonly fire: boolean;
  /** Seconds this input covers, so the server integrates the same amount. */
  readonly dt: number;
}

export interface PlayerState extends NetState {
  readonly x: number;
  readonly z: number;
  readonly health: number;
  readonly score: number;
  /** Seconds until respawn; zero when alive. */
  readonly respawn: number;
}

export interface ProjectileState extends NetState {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly owner: number;
  readonly life: number;
}

/**
 * Advances one player by one input.
 *
 * **This is the shared function.** The client calls it to predict; the server
 * calls it to decide. Any divergence between two copies of this logic shows up
 * as constant mispredictions, so there is deliberately only one.
 */
export function stepPlayer(state: PlayerState, input: PlayerInputPayload): PlayerState {
  if (state.respawn > 0) {
    const remaining = Math.max(0, state.respawn - input.dt);
    // Respawning at the centre is a server decision the client predicts too, so
    // the transition does not snap when the snapshot arrives.
    return remaining > 0
      ? { ...state, respawn: remaining }
      : { ...state, respawn: 0, health: MAX_HEALTH, x: 0, z: 0 };
  }

  const magnitude = Math.hypot(input.moveX, input.moveZ);
  // Normalizing here rather than trusting the client is what stops a modified
  // client sending a movement vector of length ten.
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  const limit = ARENA_SIZE / 2 - PLAYER_RADIUS;
  return {
    ...state,
    x: clamp(state.x + input.moveX * scale * PLAYER_SPEED * input.dt, -limit, limit),
    z: clamp(state.z + input.moveZ * scale * PLAYER_SPEED * input.dt, -limit, limit),
  };
}

/** Advances one projectile, returning `undefined` when it expires. */
export function stepProjectile(state: ProjectileState, deltaSeconds: number): ProjectileState | undefined {
  const life = state.life - deltaSeconds;
  if (life <= 0) return undefined;
  const x = state.x + state.vx * deltaSeconds;
  const z = state.z + state.vz * deltaSeconds;
  const limit = ARENA_SIZE / 2;
  if (Math.abs(x) > limit || Math.abs(z) > limit) return undefined;
  return { ...state, x, z, life };
}

/** Whether a projectile hits a player this step. */
export function projectileHits(projectile: ProjectileState, player: PlayerState, playerId: number): boolean {
  if (projectile.owner === playerId) return false;
  if (player.respawn > 0) return false;
  return Math.hypot(projectile.x - player.x, projectile.z - player.z) <= PLAYER_RADIUS;
}

export function newPlayer(x = 0, z = 0): PlayerState {
  return { x, z, health: MAX_HEALTH, score: 0, respawn: 0 };
}

/** A spawn point on a ring, so players do not start on top of each other. */
export function spawnPoint(index: number, total: number): { x: number; z: number } {
  const angle = (index / Math.max(1, total)) * Math.PI * 2;
  const radius = ARENA_SIZE / 3;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}
