import * as THREE from 'three';
import { EventBus } from '../../core/EventBus';

export type TF2WeaponSlot = 'primary' | 'secondary' | 'melee';
export type TF2WeaponKind = 'hitscan' | 'projectile' | 'beam' | 'flame' | 'melee';

export interface TF2DamageFalloff {
  closeRange: number;
  farRange: number;
  closeMultiplier: number;
  farMultiplier: number;
}

export interface TF2WeaponDef {
  id: string;
  name: string;
  slot: TF2WeaponSlot;
  kind: TF2WeaponKind;
  baseDamage: number;
  fireRate: number;
  clipSize: number;
  reserveAmmo: number;
  projectileSpeed?: number;
  projectileGravity?: number;
  splashRadius?: number;
  spread?: number;
  falloff?: TF2DamageFalloff;
}

export interface TF2ProjectileState {
  id: string;
  weaponId: string;
  ownerUuid: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  damage: number;
  splashRadius: number;
  life: number;
}

export const TF2_WEAPONS: Record<string, TF2WeaponDef> = {
  scattergun: { id: 'scattergun', name: 'Scattergun', slot: 'primary', kind: 'hitscan', baseDamage: 60, fireRate: 0.625, clipSize: 6, reserveAmmo: 32, spread: 0.085, falloff: { closeRange: 5, farRange: 22, closeMultiplier: 1.05, farMultiplier: 0.52 } },
  pistol: { id: 'pistol', name: 'Pistol', slot: 'secondary', kind: 'hitscan', baseDamage: 15, fireRate: 0.15, clipSize: 12, reserveAmmo: 36, spread: 0.026, falloff: { closeRange: 7, farRange: 26, closeMultiplier: 1.0, farMultiplier: 0.5 } },
  rocket_launcher: { id: 'rocket_launcher', name: 'Rocket Launcher', slot: 'primary', kind: 'projectile', baseDamage: 90, fireRate: 0.8, clipSize: 4, reserveAmmo: 20, projectileSpeed: 31, projectileGravity: 0, splashRadius: 5.1 },
  shotgun: { id: 'shotgun', name: 'Shotgun', slot: 'secondary', kind: 'hitscan', baseDamage: 60, fireRate: 0.625, clipSize: 6, reserveAmmo: 32, spread: 0.078, falloff: { closeRange: 5, farRange: 24, closeMultiplier: 1.0, farMultiplier: 0.5 } },
  flamethrower: { id: 'flamethrower', name: 'Flamethrower', slot: 'primary', kind: 'flame', baseDamage: 9, fireRate: 0.08, clipSize: 200, reserveAmmo: 0, projectileSpeed: 13, splashRadius: 1.4 },
  flare_gun: { id: 'flare_gun', name: 'Flare Gun', slot: 'secondary', kind: 'projectile', baseDamage: 30, fireRate: 2.0, clipSize: 1, reserveAmmo: 16, projectileSpeed: 36, projectileGravity: 2, splashRadius: 1.2 },
  grenade_launcher: { id: 'grenade_launcher', name: 'Grenade Launcher', slot: 'primary', kind: 'projectile', baseDamage: 100, fireRate: 0.6, clipSize: 4, reserveAmmo: 16, projectileSpeed: 24, projectileGravity: 16, splashRadius: 4.4 },
  stickybomb_launcher: { id: 'stickybomb_launcher', name: 'Stickybomb Launcher', slot: 'secondary', kind: 'projectile', baseDamage: 120, fireRate: 0.6, clipSize: 8, reserveAmmo: 24, projectileSpeed: 22, projectileGravity: 14, splashRadius: 5.8 },
  minigun: { id: 'minigun', name: 'Minigun', slot: 'primary', kind: 'hitscan', baseDamage: 9, fireRate: 0.1, clipSize: 200, reserveAmmo: 0, spread: 0.09, falloff: { closeRange: 5, farRange: 26, closeMultiplier: 1.0, farMultiplier: 0.5 } },
  medigun: { id: 'medigun', name: 'Medi Beam', slot: 'secondary', kind: 'beam', baseDamage: -24, fireRate: 0.05, clipSize: 1, reserveAmmo: 0 },
  sniper_rifle: { id: 'sniper_rifle', name: 'Sniper Rifle', slot: 'primary', kind: 'hitscan', baseDamage: 50, fireRate: 1.5, clipSize: 25, reserveAmmo: 0, spread: 0.001, falloff: { closeRange: 1, farRange: 64, closeMultiplier: 1.0, farMultiplier: 1.0 } },
  smg: { id: 'smg', name: 'SMG', slot: 'secondary', kind: 'hitscan', baseDamage: 8, fireRate: 0.105, clipSize: 25, reserveAmmo: 75, spread: 0.045, falloff: { closeRange: 5, farRange: 26, closeMultiplier: 1.0, farMultiplier: 0.5 } },
  revolver: { id: 'revolver', name: 'Revolver', slot: 'primary', kind: 'hitscan', baseDamage: 40, fireRate: 0.5, clipSize: 6, reserveAmmo: 24, spread: 0.018, falloff: { closeRange: 6, farRange: 28, closeMultiplier: 1.0, farMultiplier: 0.55 } },
  syringe_gun: { id: 'syringe_gun', name: 'Syringe Gun', slot: 'primary', kind: 'projectile', baseDamage: 10, fireRate: 0.105, clipSize: 40, reserveAmmo: 150, projectileSpeed: 18, projectileGravity: 4, splashRadius: 0 },
  bat: { id: 'bat', name: 'Bat', slot: 'melee', kind: 'melee', baseDamage: 35, fireRate: 0.5, clipSize: 1, reserveAmmo: 0 },
  shovel: { id: 'shovel', name: 'Shovel', slot: 'melee', kind: 'melee', baseDamage: 65, fireRate: 0.8, clipSize: 1, reserveAmmo: 0 },
  fire_axe: { id: 'fire_axe', name: 'Fire Axe', slot: 'melee', kind: 'melee', baseDamage: 65, fireRate: 0.8, clipSize: 1, reserveAmmo: 0 },
  bottle: { id: 'bottle', name: 'Bottle', slot: 'melee', kind: 'melee', baseDamage: 65, fireRate: 0.8, clipSize: 1, reserveAmmo: 0 },
  fists: { id: 'fists', name: 'Fists', slot: 'melee', kind: 'melee', baseDamage: 65, fireRate: 0.8, clipSize: 1, reserveAmmo: 0 },
  wrench: { id: 'wrench', name: 'Wrench', slot: 'melee', kind: 'melee', baseDamage: 65, fireRate: 0.8, clipSize: 1, reserveAmmo: 0 },
  bonesaw: { id: 'bonesaw', name: 'Bonesaw', slot: 'melee', kind: 'melee', baseDamage: 65, fireRate: 0.8, clipSize: 1, reserveAmmo: 0 },
  kukri: { id: 'kukri', name: 'Kukri', slot: 'melee', kind: 'melee', baseDamage: 65, fireRate: 0.8, clipSize: 1, reserveAmmo: 0 },
  knife: { id: 'knife', name: 'Knife', slot: 'melee', kind: 'melee', baseDamage: 40, fireRate: 0.8, clipSize: 1, reserveAmmo: 0 },
  sapper: { id: 'sapper', name: 'Sapper', slot: 'secondary', kind: 'melee', baseDamage: 0, fireRate: 0.8, clipSize: 1, reserveAmmo: 0 },
};

export function calculateTF2Damage(def: TF2WeaponDef, distance: number, critical = false): number {
  if (critical) return Math.round(def.baseDamage * 3);
  const falloff = def.falloff;
  if (!falloff) return def.baseDamage;
  const t = THREE.MathUtils.clamp((distance - falloff.closeRange) / Math.max(0.01, falloff.farRange - falloff.closeRange), 0, 1);
  const multiplier = THREE.MathUtils.lerp(falloff.closeMultiplier, falloff.farMultiplier, t);
  return Math.max(1, Math.round(def.baseDamage * multiplier));
}

export class TF2WeaponHandler {
  private lastFireAt = new Map<string, number>();

  public canFire(def: TF2WeaponDef, now = performance.now() / 1000): boolean {
    return now - (this.lastFireAt.get(def.id) || -999) >= def.fireRate;
  }

  public markFired(def: TF2WeaponDef, now = performance.now() / 1000): void {
    this.lastFireAt.set(def.id, now);
  }

  public emitHitscan(def: TF2WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, ownerUuid: string): void {
    if (!this.canFire(def)) return;
    this.markFired(def);
    EventBus.emit('tf2:hitscan', { weaponId: def.id, ownerUuid, origin, dir, damage: def.baseDamage, spread: def.spread || 0 });
  }

  public emitProjectile(def: TF2WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, ownerUuid: string): TF2ProjectileState | null {
    if (!this.canFire(def)) return null;
    this.markFired(def);
    const projectile: TF2ProjectileState = {
      id: `${ownerUuid}:${def.id}:${performance.now().toFixed(2)}`,
      weaponId: def.id,
      ownerUuid,
      pos: origin.clone(),
      vel: dir.clone().normalize().multiplyScalar(def.projectileSpeed || 20),
      radius: 0.18,
      damage: def.baseDamage,
      splashRadius: def.splashRadius || 0,
      life: 5,
    };
    EventBus.emit('tf2:projectileSpawned', projectile);
    return projectile;
  }
}
