import type { TF2WeaponSlot } from '../weapons/TF2WeaponFramework';

export const TF2_SLOT_ORDER: TF2WeaponSlot[] = ['primary', 'secondary', 'melee'];

export const TF2_WEAPON_ITEM_IDS: Record<string, number> = {
  scattergun: 700,
  pistol: 701,
  bat: 702,
  rocket_launcher: 703,
  shotgun: 704,
  shovel: 705,
  flamethrower: 706,
  flare_gun: 707,
  fire_axe: 708,
  grenade_launcher: 709,
  stickybomb_launcher: 710,
  bottle: 711,
  minigun: 712,
  fists: 713,
  wrench: 714,
  medigun: 715,
  bonesaw: 716,
  sniper_rifle: 717,
  smg: 718,
  kukri: 719,
  revolver: 720,
  sapper: 721,
  knife: 722,
  syringe_gun: 723,
};

export const TF2_WEAPON_DISPLAY_NAMES: Record<string, string> = {
  scattergun: 'Scattergun',
  pistol: 'Pistol',
  bat: 'Bat',
  rocket_launcher: 'Rocket Launcher',
  shotgun: 'Shotgun',
  shovel: 'Shovel',
  flamethrower: 'Flamethrower',
  flare_gun: 'Flare Gun',
  fire_axe: 'Fire Axe',
  grenade_launcher: 'Grenade Launcher',
  stickybomb_launcher: 'Stickybomb Launcher',
  bottle: 'Bottle',
  minigun: 'Minigun',
  fists: 'Fists',
  wrench: 'Wrench',
  medigun: 'Medi Gun',
  bonesaw: 'Bonesaw',
  sniper_rifle: 'Sniper Rifle',
  smg: 'SMG',
  kukri: 'Kukri',
  revolver: 'Revolver',
  sapper: 'Sapper',
  knife: 'Knife',
  syringe_gun: 'Syringe Gun',
};

export function getTF2WeaponItemId(weaponId: string): number {
  return TF2_WEAPON_ITEM_IDS[weaponId] || TF2_WEAPON_ITEM_IDS.shotgun;
}

export function getTF2WeaponDisplayName(weaponId: string): string {
  return TF2_WEAPON_DISPLAY_NAMES[weaponId] || weaponId.replace(/_/g, ' ');
}
