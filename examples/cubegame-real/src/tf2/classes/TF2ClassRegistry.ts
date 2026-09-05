export type TF2Team = 'RED' | 'BLU';
export type TF2ClassId =
  | 'scout'
  | 'soldier'
  | 'pyro'
  | 'demoman'
  | 'heavy'
  | 'engineer'
  | 'medic'
  | 'sniper'
  | 'spy';

export type TF2ClassRole = 'offense' | 'defense' | 'support';

export interface TF2ClassProfile {
  id: TF2ClassId;
  name: string;
  role: TF2ClassRole;
  maxHealth: number;
  speedScale: number;
  jumpPower: number;
  airControlScale: number;
  primary: string;
  secondary: string;
  melee: string;
  passive?: string;
}

const CLASS_PROFILES: Record<TF2ClassId, TF2ClassProfile> = {
  scout: {
    id: 'scout',
    name: 'Scout',
    role: 'offense',
    maxHealth: 125,
    speedScale: 1.33,
    jumpPower: 8.8,
    airControlScale: 1.14,
    primary: 'scattergun',
    secondary: 'pistol',
    melee: 'bat',
    passive: 'double_jump',
  },
  soldier: {
    id: 'soldier',
    name: 'Soldier',
    role: 'offense',
    maxHealth: 200,
    speedScale: 0.80,
    jumpPower: 8.2,
    airControlScale: 0.94,
    primary: 'rocket_launcher',
    secondary: 'shotgun',
    melee: 'shovel',
    passive: 'blast_jump_bonus',
  },
  pyro: {
    id: 'pyro',
    name: 'Pyro',
    role: 'offense',
    maxHealth: 175,
    speedScale: 1.00,
    jumpPower: 8.2,
    airControlScale: 1.00,
    primary: 'flamethrower',
    secondary: 'flare_gun',
    melee: 'fire_axe',
  },
  demoman: {
    id: 'demoman',
    name: 'Demoman',
    role: 'defense',
    maxHealth: 175,
    speedScale: 0.93,
    jumpPower: 8.2,
    airControlScale: 1.02,
    primary: 'grenade_launcher',
    secondary: 'stickybomb_launcher',
    melee: 'bottle',
    passive: 'blast_jump_bonus',
  },
  heavy: {
    id: 'heavy',
    name: 'Heavy',
    role: 'defense',
    maxHealth: 300,
    speedScale: 0.77,
    jumpPower: 7.8,
    airControlScale: 0.82,
    primary: 'minigun',
    secondary: 'shotgun',
    melee: 'fists',
  },
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    role: 'defense',
    maxHealth: 125,
    speedScale: 1.00,
    jumpPower: 8.2,
    airControlScale: 1.00,
    primary: 'shotgun',
    secondary: 'pistol',
    melee: 'wrench',
    passive: 'buildings',
  },
  medic: {
    id: 'medic',
    name: 'Medic',
    role: 'support',
    maxHealth: 150,
    speedScale: 1.07,
    jumpPower: 8.2,
    airControlScale: 1.05,
    primary: 'syringe_gun',
    secondary: 'medigun',
    melee: 'bonesaw',
    passive: 'regen_uber',
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    role: 'support',
    maxHealth: 125,
    speedScale: 1.00,
    jumpPower: 8.2,
    airControlScale: 1.00,
    primary: 'sniper_rifle',
    secondary: 'smg',
    melee: 'kukri',
  },
  spy: {
    id: 'spy',
    name: 'Spy',
    role: 'support',
    maxHealth: 125,
    speedScale: 1.07,
    jumpPower: 8.2,
    airControlScale: 1.08,
    primary: 'revolver',
    secondary: 'sapper',
    melee: 'knife',
    passive: 'cloak_disguise',
  },
};

export const TF2_CLASS_ORDER: TF2ClassId[] = [
  'scout',
  'soldier',
  'pyro',
  'demoman',
  'heavy',
  'engineer',
  'medic',
  'sniper',
  'spy',
];

export function getTF2ClassProfile(id: TF2ClassId | string | null | undefined): TF2ClassProfile {
  return CLASS_PROFILES[String(id || '').toLowerCase() as TF2ClassId] || CLASS_PROFILES.soldier;
}

export function listTF2ClassProfiles(): TF2ClassProfile[] {
  return TF2_CLASS_ORDER.map(id => CLASS_PROFILES[id]);
}
