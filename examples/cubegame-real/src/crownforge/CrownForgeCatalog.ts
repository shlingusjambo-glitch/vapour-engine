export type MinigameKind = 'lobby' | 'skywars' | 'bedwars' | 'duels' | 'castle' | 'survival_games' | 'backrooms' | 'csgo' | 'tf2' | 'anarchy';

export interface CrownForgeSpawn {
  x: number;
  y: number;
  z: number;
}

export interface MinigameDefinition {
  id: MinigameKind;
  title: string;
  shortTitle: string;
  subtitle: string;
  command: string;
  aliases: string[];
  room: string;
  dimension: string;
  icon: 'compass' | 'island' | 'bed' | 'sword' | 'castle' | 'chest' | 'flame';
  accent: string;
  spawn: CrownForgeSpawn;
  pvp: boolean;
  maxPlayers: number;
  message: string;
  matchTips: string[];
}

export const CROWNFORGE_SERVER_ID = 'crownforge_network';
export const CROWNFORGE_LOBBY_ROOM = 'crownforge_lobby';
export const CROWNFORGE_PREGAME_SECONDS = 60;

export const CROWNFORGE_DIMENSIONS = [
  'lobby',
  'skywars',
  'bedwars',
  'void_duels',
  'castle_siege',
  'survival_games',
  'backrooms',
  'cbgo_menu',
  'cbgo_mirage',
  'cbgo_inferno',
  'cbgo_nuke',
  'cbgo_overpass',
  'cbgo_ancient',
  'cbgo_anubis',
  'cbgo_vertigo',
  'tf2_payload',
  'tf2_cp',
  'tf2_koth',
  'tf2_ctf',
  'tf2_test',
] as const;

export type CrownForgeDimension = typeof CROWNFORGE_DIMENSIONS[number];

export const CROWNFORGE_PREGAME_SPAWN: CrownForgeSpawn = { x: 0, y: 74, z: 96 };

export type CbgoTeam = 'Terrorists' | 'Counter-Terrorists';
export type CbgoMapId =
  | 'cbgo_mirage'
  | 'cbgo_inferno'
  | 'cbgo_nuke'
  | 'cbgo_overpass'
  | 'cbgo_ancient'
  | 'cbgo_anubis'
  | 'cbgo_vertigo';

export interface CbgoMapDefinition {
  id: CbgoMapId;
  title: string;
  accent: string;
  theme: string;
  terroristSpawn: CrownForgeSpawn;
  counterTerroristSpawn: CrownForgeSpawn;
  spectatorSpawn: CrownForgeSpawn;
  bombsiteA: CrownForgeSpawn;
  bombsiteB: CrownForgeSpawn;
}

export const CBGO_MAPS: ReadonlyArray<CbgoMapDefinition> = [
  {
    id: 'cbgo_mirage',
    title: 'Mirage Row',
    accent: '#f0b84f',
    theme: 'sun-baked mid, palace catwalks, and clean A/B retakes',
    terroristSpawn: { x: 0, y: 64, z: -46 },
    counterTerroristSpawn: { x: 0, y: 64, z: 46 },
    spectatorSpawn: { x: 0, y: 84, z: 0 },
    bombsiteA: { x: -34, y: 64, z: 36 },
    bombsiteB: { x: 35, y: 64, z: 34 },
  },
  {
    id: 'cbgo_inferno',
    title: 'Inferno Lane',
    accent: '#ff7f50',
    theme: 'narrow apartments, banana control, and brutal utility choke points',
    terroristSpawn: { x: -46, y: 64, z: -40 },
    counterTerroristSpawn: { x: 46, y: 64, z: 40 },
    spectatorSpawn: { x: 0, y: 84, z: 0 },
    bombsiteA: { x: -34, y: 64, z: 36 },
    bombsiteB: { x: 34, y: 64, z: 34 },
  },
  {
    id: 'cbgo_nuke',
    title: 'Nuke Stack',
    accent: '#88b7ff',
    theme: 'yard lanes, ramp pressure, and stacked upper/lower bombsites',
    terroristSpawn: { x: -44, y: 64, z: 0 },
    counterTerroristSpawn: { x: 44, y: 64, z: 0 },
    spectatorSpawn: { x: 0, y: 86, z: 0 },
    bombsiteA: { x: -30, y: 64, z: 0 },
    bombsiteB: { x: 30, y: 64, z: 0 },
  },
  {
    id: 'cbgo_overpass',
    title: 'Overpass Canal',
    accent: '#69d6ff',
    theme: 'long rotates, water routes, connector pressure, and layered sightlines',
    terroristSpawn: { x: -42, y: 64, z: -38 },
    counterTerroristSpawn: { x: 42, y: 65, z: 38 },
    spectatorSpawn: { x: 0, y: 86, z: 0 },
    bombsiteA: { x: -34, y: 64, z: 34 },
    bombsiteB: { x: 34, y: 64, z: -34 },
  },
  {
    id: 'cbgo_ancient',
    title: 'Ancient Court',
    accent: '#9ee493',
    theme: 'temple lanes, tight mid fights, and sharp stone geometry',
    terroristSpawn: { x: 0, y: 64, z: -48 },
    counterTerroristSpawn: { x: 0, y: 64, z: 48 },
    spectatorSpawn: { x: 0, y: 84, z: 0 },
    bombsiteA: { x: -34, y: 64, z: 36 },
    bombsiteB: { x: 34, y: 64, z: -36 },
  },
  {
    id: 'cbgo_anubis',
    title: 'Anubis Delta',
    accent: '#cda15f',
    theme: 'canal splits, bridge duels, and fast late-round re-clears',
    terroristSpawn: { x: -42, y: 64, z: -42 },
    counterTerroristSpawn: { x: 42, y: 64, z: 42 },
    spectatorSpawn: { x: 0, y: 84, z: 0 },
    bombsiteA: { x: -34, y: 64, z: 34 },
    bombsiteB: { x: 34, y: 64, z: -34 },
  },
  {
    id: 'cbgo_vertigo',
    title: 'Vertigo Deck',
    accent: '#b58cff',
    theme: 'construction ramps, elevated catwalks, and punishing exposed rotates',
    terroristSpawn: { x: -44, y: 66, z: -34 },
    counterTerroristSpawn: { x: 44, y: 68, z: 34 },
    spectatorSpawn: { x: 0, y: 90, z: 0 },
    bombsiteA: { x: -34, y: 66, z: 34 },
    bombsiteB: { x: 34, y: 66, z: -34 },
  },
];

export function getCbgoMap(id: string | null | undefined): CbgoMapDefinition {
  return CBGO_MAPS.find(map => map.id === id) || CBGO_MAPS[0];
}

// BedWars islands are intentionally separated by open void.
// Base island radius is 12, diamond radius is 7, and center radius is 14.
// These coordinates leave ~15+ blocks of air between base↔diamond and
// diamond↔mid, so the generated islands never accidentally touch.
export type BedWarsTeamName = 'Red' | 'Blue' | 'Green' | 'Yellow';

export const CROWNFORGE_BEDWARS_TEAM_SPAWNS: Record<BedWarsTeamName, CrownForgeSpawn> = {
  Red: { x: -56, y: 64, z: -56 },
  Blue: { x: 56, y: 64, z: -56 },
  Green: { x: -56, y: 64, z: 56 },
  Yellow: { x: 56, y: 64, z: 56 },
};

export interface BedWarsBedObjective {
  team: BedWarsTeamName;
  color: string;
  bedBlockName: string;
  pieces: [CrownForgeSpawn, CrownForgeSpawn];
  defensePadCenter: CrownForgeSpawn;
}

export interface BedWarsShopNpcSpawn extends CrownForgeSpawn {
  team: BedWarsTeamName;
  yaw: number;
  kind: 'itemShop' | 'teamUpgrades';
}

function towardsCenterSign(value: number): number {
  return -Math.sign(value) || 1;
}

function makeBedWarsBed(team: BedWarsTeamName, color: string): BedWarsBedObjective {
  const spawn = CROWNFORGE_BEDWARS_TEAM_SPAWNS[team];
  const sx = towardsCenterSign(spawn.x);
  const sz = towardsCenterSign(spawn.z);
  const foot = { x: spawn.x + sx * 4, y: 64, z: spawn.z + sz * 4 };
  const head = { x: spawn.x + sx * 3, y: 64, z: spawn.z + sz * 3 };
  return {
    team,
    color,
    bedBlockName: `${team} Bed`,
    pieces: [foot, head],
    defensePadCenter: foot,
  };
}

export const CROWNFORGE_BEDWARS_BEDS: Record<BedWarsTeamName, BedWarsBedObjective> = {
  Red: makeBedWarsBed('Red', '#ff5555'),
  Blue: makeBedWarsBed('Blue', '#5599ff'),
  Green: makeBedWarsBed('Green', '#55ff77'),
  Yellow: makeBedWarsBed('Yellow', '#ffe066'),
};

export const CROWNFORGE_BEDWARS_SHOP_NPCS: BedWarsShopNpcSpawn[] = (Object.keys(CROWNFORGE_BEDWARS_TEAM_SPAWNS) as BedWarsTeamName[]).flatMap((team) => {
  const spawn = CROWNFORGE_BEDWARS_TEAM_SPAWNS[team];
  const sx = towardsCenterSign(spawn.x);
  const sz = towardsCenterSign(spawn.z);
  const faceCenter = Math.atan2(-spawn.x, -spawn.z);
  return [
    { team, kind: 'itemShop', x: spawn.x - sx * 4 + 0.5, y: 64.15, z: spawn.z + sz * 3 + 0.5, yaw: faceCenter },
    { team, kind: 'teamUpgrades', x: spawn.x + sx * 3 + 0.5, y: 64.15, z: spawn.z - sz * 4 + 0.5, yaw: faceCenter },
  ];
});

export const CROWNFORGE_BEDWARS_DIAMOND_GENERATORS: CrownForgeSpawn[] = [
  { x: -27, y: 64, z: -27 },
  { x: 27, y: 64, z: -27 },
  { x: -27, y: 64, z: 27 },
  { x: 27, y: 64, z: 27 },
];

export const CROWNFORGE_BEDWARS_EMERALD_GENERATORS: CrownForgeSpawn[] = [
  { x: 6, y: 65, z: 0 },
  { x: -6, y: 65, z: 0 },
  { x: 0, y: 65, z: 6 },
  { x: 0, y: 65, z: -6 },
];

export const CROWNFORGE_SKYWARS_SPAWNS: CrownForgeSpawn[] = Array.from({ length: 12 }, (_, index) => {
  const angle = (-Math.PI / 2) + (index / 12) * Math.PI * 2;
  return {
    x: Math.round(Math.cos(angle) * 52),
    y: 66,
    z: Math.round(Math.sin(angle) * 52),
  };
});

export const CROWNFORGE_SKYWARS_SUB_ISLANDS: CrownForgeSpawn[] = Array.from({ length: 12 }, (_, index) => {
  const angle = (-Math.PI / 2) + (index / 12) * Math.PI * 2;
  return {
    x: Math.round(Math.cos(angle) * 34),
    y: 64,
    z: Math.round(Math.sin(angle) * 34),
  };
});

export const MINIGAME_DEFINITIONS: ReadonlyArray<MinigameDefinition> = [
  {
    id: 'lobby',
    title: 'CrownForge Lobby',
    shortTitle: 'Lobby',
    subtitle: 'Return to the hub, group up, and pick the next mode.',
    command: '/lobby',
    aliases: ['/hub'],
    room: CROWNFORGE_LOBBY_ROOM,
    dimension: 'lobby',
    icon: 'compass',
    accent: '#55b8ff',
    spawn: { x: 0, y: 68, z: 0 },
    pvp: false,
    maxPlayers: 96,
    message: 'Returned to the CrownForge lobby. Use the CrownForge Navigator or slash commands to join matches.',
    matchTips: ['Meet friends here first.', 'Use the navigator item to jump modes.', 'Lobby does not enable PvP.'],
  },
  {
    id: 'skywars',
    title: 'CrownForge SkyWars',
    shortTitle: 'SkyWars',
    subtitle: 'Twelve mirrored cages, three chests each, 18-block sub-island routes, and a tiered center tower.',
    command: '/skywars',
    aliases: [],
    room: 'crownforge_skywars',
    dimension: 'skywars',
    icon: 'island',
    accent: '#69d6ff',
    spawn: CROWNFORGE_SKYWARS_SPAWNS[0],
    pvp: true,
    maxPlayers: 12,
    message: 'SkyWars loaded: loot three island chests, bridge to the ring, and fight for the center tower.',
    matchTips: ['Every spawn island is mirrored.', 'Mid has the strongest chest route.', 'Use the lower ring to break line of sight.'],
  },
  {
    id: 'bedwars',
    title: 'CrownForge BedWars',
    shortTitle: 'BedWars',
    subtitle: 'Four diagonal bases, 20-block diamond routes, open emerald mid, and no free bridges.',
    command: '/bedwars',
    aliases: [],
    room: 'crownforge_bedwars',
    dimension: 'bedwars',
    icon: 'bed',
    accent: '#ff5a72',
    spawn: CROWNFORGE_BEDWARS_TEAM_SPAWNS.Red,
    pvp: true,
    maxPlayers: 16,
    message: 'BedWars loaded: protect your bed, collect generators, bridge, and break enemy beds.',
    matchTips: ['Beds sit more than 8 blocks from the edge.', 'Diamonds are the fast route.', 'Center is open enough for PvP, not chokepoints.'],
  },
  {
    id: 'duels',
    title: 'CrownForge Void Duels',
    shortTitle: 'Void Duels',
    subtitle: 'Tiny arena PvP for fast 1v1, 2v2, and warm-up fights.',
    command: '/duels',
    aliases: [],
    room: 'crownforge_duels',
    dimension: 'void_duels',
    icon: 'sword',
    accent: '#b58cff',
    spawn: { x: 0, y: 65, z: 0 },
    pvp: true,
    maxPlayers: 8,
    message: 'Void Duels loaded: quick fights on a small floating arena.',
    matchTips: ['Keep your crosshair center mass.', 'Spacing matters more than spam clicking.', 'Knockback wins rounds.'],
  },
  {
    id: 'castle',
    title: 'CrownForge Castle Siege',
    shortTitle: 'Castle Siege',
    subtitle: 'Two mirrored castles, clear lanes, gatehouses, towers, and a contested center bridge.',
    command: '/castle',
    aliases: [],
    room: 'crownforge_castle_siege',
    dimension: 'castle_siege',
    icon: 'castle',
    accent: '#ffd166',
    spawn: { x: 0, y: 66, z: -56 },
    pvp: true,
    maxPlayers: 24,
    message: 'Castle Siege loaded: storm the walls and hold the bridge.',
    matchTips: ['Control the bridge first.', 'Archers should stay on towers.', 'Gatehouses have clean cover.'],
  },
  {
    id: 'survival_games',
    title: 'CrownForge Survival Games',
    shortTitle: 'Survival Games',
    subtitle: 'A ruined empire arena with a clean cornucopia and route-readable outer walls.',
    command: '/sg',
    aliases: ['/survivalgames'],
    room: 'crownforge_survival_games',
    dimension: 'survival_games',
    icon: 'chest',
    accent: '#9ee493',
    spawn: { x: 0, y: 68, z: 0 },
    pvp: true,
    maxPlayers: 24,
    message: 'Survival Games loaded: scatter, loot ruins, and survive.',
    matchTips: ['Loot fast, then leave spawn.', 'Do not fight without food.', 'Use ruins as ambush cover.'],
  },
  {
    id: 'backrooms',
    title: 'The Backrooms',
    shortTitle: 'Backrooms',
    subtitle: 'Endless yellow rooms, buzzing lights, damp carpet, and maze corridors that should not exist.',
    command: '/backrooms',
    aliases: ['backrooms'],
    room: 'crownforge_backrooms',
    dimension: 'backrooms',
    icon: 'chest',
    accent: '#d8c86a',
    spawn: { x: 0, y: 65, z: 0 },
    pvp: false,
    maxPlayers: 32,
    message: 'You clipped into the Backrooms. Keep moving and listen for exits.',
    matchTips: ['No sun. No music. Just humming lights.', 'Storage rooms and broken offices hide supplies.', 'Do not shout. Monsters follow sound.'],
  },
  {
    id: 'csgo',
    title: 'Counter-Block Offensive',
    shortTitle: 'CSGO',
    subtitle: 'Premier tactical PvP with map veto, warmup, MR12 economy rounds, bombsites, smokes, and voice-first callouts.',
    command: '/csgo',
    aliases: ['/counterblock', '/cbo'],
    room: 'crownforge_csgo',
    dimension: 'cbgo_menu',
    icon: 'sword',
    accent: '#f0b84f',
    spawn: { x: 0, y: 65, z: -44 },
    pvp: true,
    maxPlayers: 16,
    message: 'Counter-Block Offensive loaded: veto the map, control mid, manage the economy, and fight over A/B sites.',
    matchTips: ['Voice chat starts by default.', 'Counter-strafe before firing.', 'Utility and economy win rounds before aim does.'],
  },
  {
    id: 'tf2',
    title: 'Fortress Arena',
    shortTitle: 'Fortress',
    subtitle: 'Source-style class combat with air strafing, blast jumps, ragdolls, Payload, Control Points, KOTH, and CTF.',
    command: '/tf2',
    aliases: ['/fortress', '/teamfortress'],
    room: 'crownforge_tf2',
    dimension: 'tf2_payload',
    icon: 'sword',
    accent: '#d9853b',
    spawn: { x: -48, y: 65, z: 0 },
    pvp: true,
    maxPlayers: 24,
    message: 'Fortress Arena loaded: pick a class, surf the air, push objectives, and make the ragdoll physics do the paperwork.',
    matchTips: ['Comma opens class select.', 'Soldier and Demo can blast jump.', 'Payload, CP, KOTH, and CTF share the same class framework.'],
  },
  {
    id: 'anarchy',
    title: 'Ashfall Anarchy',
    shortTitle: 'Anarchy',
    subtitle: 'Permanent anything-goes survival world. PvP on. No claims. No resets.',
    command: '/anarchy',
    aliases: [],
    room: 'ashfall_anarchy_survival',
    dimension: 'survival_247',
    icon: 'flame',
    accent: '#d95032',
    spawn: { x: 8.5, y: 65.05, z: 8.5 },
    pvp: true,
    maxPlayers: 64,
    message: 'Ashfall Anarchy loaded: one permanent survival world, PvP on, no hand-holding.',
    matchTips: ['Hide your base far away.', 'Trust nobody with your stash.', 'The world stays online while the server runs.'],
  },
];

const byId = new Map<MinigameKind, MinigameDefinition>();
const byCommand = new Map<string, MinigameDefinition>();
const byRoom = new Map<string, MinigameDefinition>();
const byDimension = new Map<string, MinigameDefinition>();

for (const mode of MINIGAME_DEFINITIONS) {
  byId.set(mode.id, mode);
  byCommand.set(mode.command.toLowerCase(), mode);
  byRoom.set(mode.room.toLowerCase(), mode);
  byDimension.set(mode.dimension.toLowerCase(), mode);
  for (const alias of mode.aliases) byCommand.set(alias.toLowerCase(), mode);
}

export function getMinigameById(id: string | null | undefined): MinigameDefinition | undefined {
  return byId.get(String(id || '').trim().toLowerCase() as MinigameKind);
}

export function getMinigameByCommand(command: string | null | undefined): MinigameDefinition | undefined {
  const clean = String(command || '').trim().toLowerCase().split(/\s+/)[0];
  return byCommand.get(clean);
}

export function getMinigameByRoom(room: string | null | undefined): MinigameDefinition | undefined {
  return byRoom.get(String(room || '').trim().toLowerCase());
}

export function getMinigameByDimension(dimension: string | null | undefined): MinigameDefinition | undefined {
  return byDimension.get(String(dimension || '').trim().toLowerCase());
}

export function isCrownForgeDimension(dimension: string | null | undefined): dimension is CrownForgeDimension {
  const clean = String(dimension || '').trim().toLowerCase();
  return (CROWNFORGE_DIMENSIONS as readonly string[]).includes(clean);
}

export function isCrownForgeRoom(room: string | null | undefined, serverId?: string | null): boolean {
  const cleanRoom = String(room || '').toLowerCase();
  const cleanServer = String(serverId || '').toLowerCase();
  return cleanServer === CROWNFORGE_SERVER_ID || cleanRoom.startsWith('crownforge_');
}

export function defaultSpawnForDimension(dimension: string): CrownForgeSpawn {
  return getMinigameByDimension(dimension)?.spawn || { x: 8, y: 68, z: 8 };
}
