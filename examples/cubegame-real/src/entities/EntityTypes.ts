import * as THREE from 'three';
import type { Combatant } from '@vapour/engine';

export type EntityType = 'player' | 'mob' | 'item_drop';
export type MobType =
  | 'cow' | 'pig' | 'sheep'
  | 'zombie' | 'skeleton' | 'creeper' | 'spider'
  | 'warden' | 'dragon' | 'enderman' | 'villager'
  | 'wither' | 'blaze' | 'ghast' | 'slime' | 'magma_cube'
  | 'wolf' | 'cat' | 'iron_golem' | 'snow_golem'
  | 'bacteria' | 'still_life' | 'clark_monster';

export interface BaseEntity {
  id: string;
  type: EntityType;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  dimensions: THREE.Vector3;
  grounded: boolean;
}

export interface PlayerEntity extends BaseEntity {
  username: string;
  ping: number;
  heldItemId: number;
  health?: number;
  maxHealth?: number;
  isCrouching?: boolean;
  isSprinting?: boolean;
  isMoving?: boolean;
  punchUntil?: number;
  isDead?: boolean;
}

export interface MobEntity extends BaseEntity {
  combatant: Combatant<string>;
  mobType: MobType;
  health: number;
  maxHealth: number;
  aiState: 'idle' | 'wander' | 'chase' | 'flee' | 'attack_range' | 'explode' | 'scared' | 'angry' | 'shop' | 'stalk' | 'ambush';
  aiTimer: number;
  targetPos: THREE.Vector3 | null;
  targetEntityId: string | null;

  // Combat
  attackCooldown: number;
  attackDamage: number;
  isAngered: boolean;

  // Creeper-specific
  fuseTimer: number;
  isExploding: boolean;

  // Death
  deathTimer: number;  // -1 = alive, >0 = dying animation playing
  isDead: boolean;

  // Drops (itemId, count)
  drops: Array<{ id: number; count: number }>;
}

export interface ItemDropEntity extends BaseEntity {
  blockId: number;
  count: number;
  age: number;
  pickupDelay: number;
  mesh: THREE.Group | null;
}
