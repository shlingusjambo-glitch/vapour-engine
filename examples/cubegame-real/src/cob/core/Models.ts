import { Matrix4, Vector3 } from './Math';

export enum COBTeamId {
  TeamA = 0,
  TeamB = 1,
  Neutral = 2,
}

export interface AmmoStack {
  readonly ammoType: string;
  current: number;
  reserve: number;
  magazineSize: number;
}

export interface InventorySlot {
  readonly itemId: string;
  quantity: number;
  durability: number;
}

export interface TransformState {
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
}

export interface PlayerRuntimeState {
  readonly id: string;
  displayName: string;
  teamId: COBTeamId;
  transform: TransformState;
  velocity: Vector3;
  health: number;
  maxHealth: number;
  ammo: AmmoStack[];
  inventory: InventorySlot[];
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  connected: boolean;
  isBot: boolean;
  inputFrozen: boolean;
  invulnerableUntilMs: number;
  lastValidAtMs: number;
}

export interface PlayerSession {
  readonly id: string;
  state: PlayerRuntimeState;
  clientSequence: number;
  lastHeardAtMs: number;
}

export interface TeamScoreState {
  teamId: COBTeamId;
  kills: number;
  deaths: number;
  objectiveScore: number;
}

export interface SpawnAssignment {
  playerId: string;
  teamId: COBTeamId;
  transform: TransformState;
}

export interface MatchTimerPayload {
  matchId: string;
  state: string;
  countdownMs: number;
  serverNowMs: number;
  sequence: number;
}

export interface MatchStatePayload {
  matchId: string;
  state: string;
  mapId: string;
  serverNowMs: number;
  teamScores: TeamScoreState[];
  remainingMatchMs: number;
}

export interface PlayerSpawnPayload {
  playerId: string;
  teamId: COBTeamId;
  transform: TransformState;
  health: number;
  ammo: AmmoStack[];
  invulnerableUntilMs: number;
  isBot: boolean;
}

export interface VehicleStatePayload {
  vehicleId: string;
  vehicleType: string;
  transform: TransformState;
  velocity: Vector3;
  health: number;
  seatOccupants: Array<string | null>;
}

export interface COBServerTransport {
  broadcastMatchTimer(payload: MatchTimerPayload): void;
  broadcastMatchState(payload: MatchStatePayload): void;
  broadcastPlayerSpawn(payload: PlayerSpawnPayload): void;
  broadcastPlayerDespawn(playerId: string, reason: string): void;
  broadcastVehicleState(payload: VehicleStatePayload): void;
}

export interface LocalViewmodelPose {
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  matrix: Matrix4;
  cameraFov: number;
}

export function createTransform(position?: Vector3, rotation?: Vector3, scale?: Vector3): TransformState {
  return {
    position: position ? position.clone() : Vector3.zero(),
    rotation: rotation ? rotation.clone() : Vector3.zero(),
    scale: scale ? scale.clone() : new Vector3(1, 1, 1),
  };
}

export function cloneTransform(transform: TransformState): TransformState {
  return {
    position: transform.position.clone(),
    rotation: transform.rotation.clone(),
    scale: transform.scale.clone(),
  };
}

export function cloneAmmo(ammo: AmmoStack[]): AmmoStack[] {
  const out: AmmoStack[] = [];
  for (let i = 0; i < ammo.length; i++) {
    const entry = ammo[i];
    out.push({
      ammoType: entry.ammoType,
      current: Math.max(0, Math.floor(entry.current)),
      reserve: Math.max(0, Math.floor(entry.reserve)),
      magazineSize: Math.max(1, Math.floor(entry.magazineSize)),
    });
  }
  return out;
}

export function cloneInventory(inventory: InventorySlot[]): InventorySlot[] {
  const out: InventorySlot[] = [];
  for (let i = 0; i < inventory.length; i++) {
    const slot = inventory[i];
    out.push({
      itemId: slot.itemId,
      quantity: Math.max(0, Math.floor(slot.quantity)),
      durability: Math.max(0, slot.durability),
    });
  }
  return out;
}

export function createDefaultAmmo(): AmmoStack[] {
  return [
    { ammoType: 'rifle_556', current: 30, reserve: 120, magazineSize: 30 },
    { ammoType: 'sidearm_9mm', current: 15, reserve: 45, magazineSize: 15 },
    { ammoType: 'rocket_70mm', current: 1, reserve: 2, magazineSize: 1 },
  ];
}

export function createDefaultInventory(): InventorySlot[] {
  return [
    { itemId: 'cob.assault_rifle', quantity: 1, durability: 1 },
    { itemId: 'cob.sidearm', quantity: 1, durability: 1 },
    { itemId: 'cob.frag_grenade', quantity: 2, durability: 1 },
    { itemId: 'cob.field_medkit', quantity: 1, durability: 1 },
  ];
}

export function createPlayerState(
  id: string,
  displayName: string,
  teamId: COBTeamId,
  isBot: boolean,
  nowMs: number
): PlayerRuntimeState {
  return {
    id,
    displayName,
    teamId,
    transform: createTransform(),
    velocity: Vector3.zero(),
    health: 100,
    maxHealth: 100,
    ammo: createDefaultAmmo(),
    inventory: createDefaultInventory(),
    kills: 0,
    deaths: 0,
    assists: 0,
    score: 0,
    connected: !isBot,
    isBot,
    inputFrozen: false,
    invulnerableUntilMs: 0,
    lastValidAtMs: nowMs,
  };
}

export function clonePlayerState(state: PlayerRuntimeState): PlayerRuntimeState {
  return {
    id: state.id,
    displayName: state.displayName,
    teamId: state.teamId,
    transform: cloneTransform(state.transform),
    velocity: state.velocity.clone(),
    health: Math.max(0, state.health),
    maxHealth: Math.max(1, state.maxHealth),
    ammo: cloneAmmo(state.ammo),
    inventory: cloneInventory(state.inventory),
    kills: Math.max(0, Math.floor(state.kills)),
    deaths: Math.max(0, Math.floor(state.deaths)),
    assists: Math.max(0, Math.floor(state.assists)),
    score: Math.floor(state.score),
    connected: state.connected,
    isBot: state.isBot,
    inputFrozen: state.inputFrozen,
    invulnerableUntilMs: Math.max(0, state.invulnerableUntilMs),
    lastValidAtMs: Math.max(0, state.lastValidAtMs),
  };
}

export function createSpawnPayload(state: PlayerRuntimeState): PlayerSpawnPayload {
  return {
    playerId: state.id,
    teamId: state.teamId,
    transform: cloneTransform(state.transform),
    health: Math.max(0, state.health),
    ammo: cloneAmmo(state.ammo),
    invulnerableUntilMs: Math.max(0, state.invulnerableUntilMs),
    isBot: state.isBot,
  };
}
