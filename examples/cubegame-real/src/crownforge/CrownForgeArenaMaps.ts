import {
  CROWNFORGE_BEDWARS_DIAMOND_GENERATORS,
  CROWNFORGE_BEDWARS_EMERALD_GENERATORS,
  CROWNFORGE_BEDWARS_TEAM_SPAWNS,
  CROWNFORGE_SKYWARS_SPAWNS,
  CROWNFORGE_SKYWARS_SUB_ISLANDS,
} from './CrownForgeCatalog';
import {
  checker,
  columnIsFloatingIsland,
  ColumnWriter,
  diamondDistance,
  getBlocks,
  rotatedLocal,
} from './CrownForgeLevelPrimitives';

export function generateSkyWarsColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const b = getBlocks();
  const centerTouched = columnIsFloatingIsland(write, gx, lx, gz, lz, startY, 0, 0, 20, 63, 14, b.quartz, b.endstone, b.stone, b.mossy);
  if (centerTouched) {
    placeSkyWarsCenterDetails(write, b, gx, lx, gz, lz, startY);
    return;
  }

  for (const sub of CROWNFORGE_SKYWARS_SUB_ISLANDS) {
    const touched = columnIsFloatingIsland(write, gx, lx, gz, lz, startY, sub.x, sub.z, 7, 62, 8, b.mossy, b.stoneBricks, b.stone, b.cracked);
    if (!touched) continue;
    for (let ly = 0; ly < 16; ly++) {
      const gy = startY + ly;
      const dx = gx - sub.x;
      const dz = gz - sub.z;
      if (gy === 63 && dx === 0 && dz === 0) write(lx, ly, lz, b.chest);
      if (gy === 63 && diamondDistance(dx, dz) === 3) write(lx, ly, lz, b.planks);
      if (gy >= 63 && gy <= 66 && Math.abs(dx) === 3 && Math.abs(dz) === 3) write(lx, ly, lz, b.stoneBricks);
    }
    return;
  }

  for (let i = 0; i < CROWNFORGE_SKYWARS_SPAWNS.length; i++) {
    const spawn = CROWNFORGE_SKYWARS_SPAWNS[i];
    const touched = columnIsFloatingIsland(write, gx, lx, gz, lz, startY, spawn.x, spawn.z, 10, 63, 10, checker(gx, gz, 3) ? b.grass : b.mossy, b.dirt, b.stone, b.endstone);
    if (!touched) continue;
    placeSkyWarsSpawnDetails(write, b, gx, lx, gz, lz, startY, spawn.x, spawn.z, i);
    return;
  }
}

function placeSkyWarsCenterDetails(write: ColumnWriter, b: ReturnType<typeof getBlocks>, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const ax = Math.abs(gx);
  const az = Math.abs(gz);
  const ring = (ax === 11 && az <= 11) || (az === 11 && ax <= 11);
  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (gy === 64 && ring) write(lx, ly, lz, b.cracked);
    if (gy === 64 && ((ax === 6 && az === 0) || (az === 6 && ax === 0) || (ax === 8 && az === 8))) write(lx, ly, lz, b.chest);
    if (gy >= 64 && gy <= 73 && ax <= 2 && az <= 2) {
      const shell = ax === 2 || az === 2 || gy === 73;
      if (shell) write(lx, ly, lz, gy % 4 === 0 ? b.emerald : b.quartz);
    }
    if (gy === 68 && ax <= 5 && az <= 5 && (ax === 5 || az === 5)) write(lx, ly, lz, b.planks);
    if (gy === 59 && ax <= 7 && az <= 7) write(lx, ly, lz, checker(gx, gz, 2) ? b.cracked : b.mossy);
    if (gy === 60 && ((ax === 4 && az === 4) || (ax === 0 && az === 6) || (az === 0 && ax === 6))) write(lx, ly, lz, b.chest);
    if (gy >= 60 && gy <= 66 && ax === 13 && az === 13) write(lx, ly, lz, b.chiseled);
  }
}

function placeSkyWarsSpawnDetails(write: ColumnWriter, b: ReturnType<typeof getBlocks>, gx: number, lx: number, gz: number, lz: number, startY: number, cx: number, cz: number, index: number): void {
  const angle = Math.atan2(cz, cx) + Math.PI;
  const local = rotatedLocal(gx, gz, cx, cz, angle);
  const chestSpots = [[0, -3], [-3, 2], [3, 2]];
  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (gy === 64 && chestSpots.some(([x, z]) => local.x === x && local.z === z)) write(lx, ly, lz, b.chest);
    if (gy === 64 && local.x === 0 && local.z === 0) write(lx, ly, lz, index % 2 === 0 ? b.cyanWool : b.pinkWool);
    if (local.x === 0 && local.z === -5 && gy >= 64 && gy <= 67) write(lx, ly, lz, b.log);
    if (Math.abs(local.x) + Math.abs(local.z + 5) <= 4 && gy >= 68 && gy <= 70) write(lx, ly, lz, b.leaves);

    const cageShell = Math.abs(local.x) <= 1 && Math.abs(local.z) <= 1 && gy >= 65 && gy <= 68;
    if (cageShell && (Math.abs(local.x) === 1 || Math.abs(local.z) === 1 || gy === 68)) write(lx, ly, lz, b.glass);
  }
}

export function generateBedWarsColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const b = getBlocks();
  const bases = [
    { name: 'Red', ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Red, wool: b.redWool, bed: b.redBed },
    { name: 'Blue', ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Blue, wool: b.blueWool, bed: b.blueBed },
    { name: 'Green', ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Green, wool: b.greenWool, bed: b.greenBed },
    { name: 'Yellow', ...CROWNFORGE_BEDWARS_TEAM_SPAWNS.Yellow, wool: b.yellowWool, bed: b.yellowBed },
  ];

  for (const base of bases) {
    const touched = columnIsFloatingIsland(write, gx, lx, gz, lz, startY, base.x, base.z, 12, 62, 9, checker(gx, gz, 3) ? b.sand : base.wool, b.endstone, b.stone, base.wool);
    if (!touched) continue;
    placeBedWarsBaseDetails(write, b, gx, lx, gz, lz, startY, base.x, base.z, base.wool, base.bed);
    return;
  }

  for (const diamond of CROWNFORGE_BEDWARS_DIAMOND_GENERATORS) {
    const touched = columnIsFloatingIsland(write, gx, lx, gz, lz, startY, diamond.x, diamond.z, 7, 62, 7, b.endstone, b.stoneBricks, b.stone, b.diamond);
    if (!touched) continue;
    for (let ly = 0; ly < 16; ly++) {
      const gy = startY + ly;
      const dx = gx - diamond.x;
      const dz = gz - diamond.z;
      if (gy === 63 && dx === 0 && dz === 0) write(lx, ly, lz, b.diamond);
      if (gy === 63 && diamondDistance(dx, dz) === 4) write(lx, ly, lz, b.glowstone);
      if (gy >= 63 && gy <= 67 && Math.abs(dx) === 3 && Math.abs(dz) === 3) write(lx, ly, lz, b.chiseled);
    }
    return;
  }

  const centerTouched = columnIsFloatingIsland(write, gx, lx, gz, lz, startY, 0, 0, 14, 63, 10, b.quartz, b.endstone, b.stone, b.emerald);
  if (centerTouched) placeBedWarsCenterDetails(write, b, gx, lx, gz, lz, startY);
}

export function generateCbgoMenuColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const b = getBlocks();
  if (Math.abs(gx) > 18 || Math.abs(gz) > 18) return;
  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (gy === 63) write(lx, ly, lz, checker(gx, gz, 4) ? b.stoneBricks : b.grayWool);
    if (gy >= 64 && gy <= 67 && (Math.abs(gx) === 18 || Math.abs(gz) === 18)) write(lx, ly, lz, b.glass);
    if (gy === 64 && Math.abs(gx) <= 2 && Math.abs(gz) <= 2) write(lx, ly, lz, b.glowstone);
  }
}

type CbgoArenaVariant = 'mirage' | 'inferno' | 'nuke' | 'overpass' | 'ancient' | 'anubis' | 'vertigo';

interface CbgoRect {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
}

interface CbgoLayout {
  floorY: number;
  floor: 'sand' | 'stone' | 'temple' | 'metal' | 'canal' | 'deck';
  playable: CbgoRect[];
  walls: CbgoRect[];
  crates: CbgoRect[];
  tallCover: CbgoRect[];
  catwalks: CbgoRect[];
  rails: CbgoRect[];
  aSite: { x: number; z: number; rx: number; rz: number };
  bSite: { x: number; z: number; rx: number; rz: number };
  tSpawn: CbgoRect;
  ctSpawn: CbgoRect;
}

const CBGO_LAYOUTS: Record<CbgoArenaVariant, CbgoLayout> = {
  mirage: {
    floorY: 63,
    floor: 'sand',
    playable: [
      { cx: 0, cz: -46, rx: 14, rz: 6 },
      { cx: 0, cz: -25, rx: 9, rz: 18 },
      { cx: 0, cz: 0, rx: 14, rz: 10 },
      { cx: -18, cz: 16, rx: 8, rz: 13 },
      { cx: 16, cz: 18, rx: 17, rz: 6 },
      { cx: -34, cz: 10, rx: 10, rz: 28 },
      { cx: -43, cz: 29, rx: 8, rz: 9 },
      { cx: -34, cz: 36, rx: 13, rz: 10 },
      { cx: 34, cz: -6, rx: 9, rz: 28 },
      { cx: 36, cz: 24, rx: 12, rz: 8 },
      { cx: 35, cz: 34, rx: 13, rz: 10 },
      { cx: 0, cz: 45, rx: 16, rz: 7 },
      { cx: 20, cz: 39, rx: 12, rz: 5 },
    ],
    walls: [
      { cx: -16, cz: -18, rx: 1, rz: 16 },
      { cx: 16, cz: -14, rx: 1, rz: 18 },
      { cx: -7, cz: 13, rx: 7, rz: 1 },
      { cx: -26, cz: 16, rx: 1, rz: 12 },
      { cx: 23, cz: 25, rx: 1, rz: 11 },
      { cx: 33, cz: 13, rx: 7, rz: 1 },
      { cx: -45, cz: 18, rx: 1, rz: 13 },
      { cx: 45, cz: 3, rx: 1, rz: 18 },
    ],
    crates: [
      { cx: -38, cz: 36, rx: 4, rz: 3 },
      { cx: -26, cz: 34, rx: 3, rz: 4 },
      { cx: 34, cz: 35, rx: 5, rz: 3 },
      { cx: 42, cz: 26, rx: 3, rz: 4 },
      { cx: 0, cz: -2, rx: 2, rz: 2 },
      { cx: -8, cz: -24, rx: 3, rz: 2 },
    ],
    tallCover: [
      { cx: -48, cz: 29, rx: 2, rz: 7 },
      { cx: -15, cz: 27, rx: 2, rz: 5 },
      { cx: 24, cz: 37, rx: 2, rz: 6 },
      { cx: 43, cz: -16, rx: 2, rz: 8 },
    ],
    catwalks: [{ cx: 16, cz: 18, rx: 16, rz: 3 }, { cx: -17, cz: 22, rx: 7, rz: 3 }],
    rails: [{ cx: 16, cz: 22, rx: 16, rz: 1 }, { cx: -17, cz: 26, rx: 7, rz: 1 }],
    aSite: { x: -34, z: 36, rx: 9, rz: 8 },
    bSite: { x: 35, z: 34, rx: 9, rz: 8 },
    tSpawn: { cx: 0, cz: -46, rx: 14, rz: 6 },
    ctSpawn: { cx: 0, cz: 46, rx: 14, rz: 6 },
  },
  inferno: {
    floorY: 63,
    floor: 'sand',
    playable: [
      { cx: -46, cz: -40, rx: 7, rz: 8 },
      { cx: -24, cz: -35, rx: 18, rz: 7 },
      { cx: -12, cz: -18, rx: 9, rz: 20 },
      { cx: -24, cz: 8, rx: 10, rz: 18 },
      { cx: -34, cz: 36, rx: 12, rz: 9 },
      { cx: -44, cz: 18, rx: 5, rz: 18 },
      { cx: 6, cz: -32, rx: 9, rz: 8 },
      { cx: 19, cz: -16, rx: 8, rz: 21 },
      { cx: 33, cz: 4, rx: 7, rz: 24 },
      { cx: 34, cz: 34, rx: 12, rz: 9 },
      { cx: 46, cz: 40, rx: 7, rz: 8 },
    ],
    walls: [
      { cx: -3, cz: -18, rx: 1, rz: 20 },
      { cx: -33, cz: -4, rx: 1, rz: 15 },
      { cx: -22, cz: 24, rx: 8, rz: 1 },
      { cx: -44, cz: 31, rx: 1, rz: 8 },
      { cx: 8, cz: -10, rx: 1, rz: 16 },
      { cx: 28, cz: -8, rx: 1, rz: 16 },
      { cx: 34, cz: 18, rx: 7, rz: 1 },
      { cx: 45, cz: 20, rx: 1, rz: 12 },
    ],
    crates: [
      { cx: -34, cz: 36, rx: 4, rz: 4 },
      { cx: -27, cz: 29, rx: 3, rz: 3 },
      { cx: 34, cz: 36, rx: 4, rz: 4 },
      { cx: 39, cz: 24, rx: 3, rz: 4 },
      { cx: -14, cz: -4, rx: 3, rz: 3 },
      { cx: 33, cz: -20, rx: 3, rz: 3 },
    ],
    tallCover: [
      { cx: -45, cz: 6, rx: 2, rz: 10 },
      { cx: -36, cz: 22, rx: 2, rz: 8 },
      { cx: 24, cz: 2, rx: 2, rz: 8 },
      { cx: 42, cz: -28, rx: 2, rz: 6 },
    ],
    catwalks: [{ cx: -39, cz: 4, rx: 6, rz: 18 }],
    rails: [{ cx: -32, cz: 4, rx: 1, rz: 18 }],
    aSite: { x: -34, z: 36, rx: 8, rz: 8 },
    bSite: { x: 34, z: 34, rx: 8, rz: 8 },
    tSpawn: { cx: -46, cz: -40, rx: 7, rz: 8 },
    ctSpawn: { cx: 46, cz: 40, rx: 7, rz: 8 },
  },
  nuke: {
    floorY: 63,
    floor: 'metal',
    playable: [
      { cx: -46, cz: 0, rx: 7, rz: 14 },
      { cx: -28, cz: -18, rx: 13, rz: 14 },
      { cx: -18, cz: 10, rx: 15, rz: 18 },
      { cx: -30, cz: 30, rx: 11, rz: 14 },
      { cx: 0, cz: -20, rx: 18, rz: 8 },
      { cx: 0, cz: 0, rx: 14, rz: 14 },
      { cx: 4, cz: 24, rx: 12, rz: 16 },
      { cx: 25, cz: 14, rx: 10, rz: 22 },
      { cx: 30, cz: -18, rx: 10, rz: 20 },
      { cx: 46, cz: 0, rx: 7, rz: 14 },
    ],
    walls: [
      { cx: -12, cz: -18, rx: 1, rz: 15 },
      { cx: -8, cz: 16, rx: 1, rz: 18 },
      { cx: 14, cz: -6, rx: 1, rz: 18 },
      { cx: 15, cz: 20, rx: 1, rz: 16 },
      { cx: 30, cz: 2, rx: 8, rz: 1 },
      { cx: -30, cz: 14, rx: 8, rz: 1 },
    ],
    crates: [
      { cx: -30, cz: 30, rx: 5, rz: 3 },
      { cx: 28, cz: -18, rx: 5, rz: 3 },
      { cx: -22, cz: -24, rx: 4, rz: 3 },
      { cx: 10, cz: 28, rx: 4, rz: 3 },
      { cx: 0, cz: 0, rx: 4, rz: 4 },
    ],
    tallCover: [
      { cx: -33, cz: -5, rx: 2, rz: 13 },
      { cx: 6, cz: -18, rx: 2, rz: 8 },
      { cx: 24, cz: 28, rx: 2, rz: 8 },
      { cx: 38, cz: 0, rx: 2, rz: 10 },
    ],
    catwalks: [
      { cx: -4, cz: 20, rx: 7, rz: 18 },
      { cx: 12, cz: -14, rx: 7, rz: 16 },
    ],
    rails: [
      { cx: 4, cz: 20, rx: 1, rz: 18 },
      { cx: 20, cz: -14, rx: 1, rz: 16 },
    ],
    aSite: { x: -30, z: 0, rx: 9, rz: 9 },
    bSite: { x: 30, z: 0, rx: 9, rz: 9 },
    tSpawn: { cx: -46, cz: 0, rx: 7, rz: 14 },
    ctSpawn: { cx: 46, cz: 0, rx: 7, rz: 14 },
  },
  overpass: {
    floorY: 63,
    floor: 'canal',
    playable: [
      { cx: -42, cz: -38, rx: 8, rz: 8 },
      { cx: -30, cz: -18, rx: 10, rz: 24 },
      { cx: 0, cz: -22, rx: 24, rz: 8 },
      { cx: 0, cz: 0, rx: 11, rz: 32 },
      { cx: -30, cz: 24, rx: 15, rz: 10 },
      { cx: -34, cz: 34, rx: 13, rz: 9 },
      { cx: 28, cz: -10, rx: 13, rz: 25 },
      { cx: 34, cz: -34, rx: 13, rz: 9 },
      { cx: 42, cz: 38, rx: 8, rz: 8 },
      { cx: 22, cz: 28, rx: 18, rz: 7 },
    ],
    walls: [
      { cx: -16, cz: -10, rx: 1, rz: 24 },
      { cx: 16, cz: 8, rx: 1, rz: 24 },
      { cx: 0, cz: 17, rx: 12, rz: 1 },
      { cx: 0, cz: -12, rx: 14, rz: 1 },
      { cx: -40, cz: 12, rx: 1, rz: 15 },
      { cx: 40, cz: -12, rx: 1, rz: 15 },
    ],
    crates: [
      { cx: -34, cz: 34, rx: 4, rz: 4 },
      { cx: 34, cz: -34, rx: 4, rz: 4 },
      { cx: -8, cz: 8, rx: 3, rz: 3 },
      { cx: 8, cz: -8, rx: 3, rz: 3 },
      { cx: 36, cz: 26, rx: 3, rz: 5 },
    ],
    tallCover: [
      { cx: -44, cz: 24, rx: 2, rz: 8 },
      { cx: 44, cz: -24, rx: 2, rz: 8 },
      { cx: 0, cz: 32, rx: 4, rz: 2 },
    ],
    catwalks: [{ cx: 0, cz: 30, rx: 32, rz: 3 }],
    rails: [{ cx: 0, cz: 34, rx: 32, rz: 1 }],
    aSite: { x: -34, z: 34, rx: 9, rz: 8 },
    bSite: { x: 34, z: -34, rx: 9, rz: 8 },
    tSpawn: { cx: -42, cz: -38, rx: 8, rz: 8 },
    ctSpawn: { cx: 42, cz: 38, rx: 8, rz: 8 },
  },
  ancient: {
    floorY: 63,
    floor: 'temple',
    playable: [
      { cx: 0, cz: -48, rx: 14, rz: 5 },
      { cx: -22, cz: -30, rx: 16, rz: 8 },
      { cx: 0, cz: -18, rx: 10, rz: 20 },
      { cx: 0, cz: 5, rx: 13, rz: 12 },
      { cx: -18, cz: 24, rx: 15, rz: 8 },
      { cx: -34, cz: 36, rx: 13, rz: 9 },
      { cx: 24, cz: -24, rx: 18, rz: 9 },
      { cx: 34, cz: -36, rx: 13, rz: 9 },
      { cx: 28, cz: 8, rx: 12, rz: 20 },
      { cx: 0, cz: 48, rx: 14, rz: 5 },
    ],
    walls: [
      { cx: -14, cz: -13, rx: 1, rz: 18 },
      { cx: 15, cz: -8, rx: 1, rz: 17 },
      { cx: 0, cz: 18, rx: 13, rz: 1 },
      { cx: -30, cz: 24, rx: 1, rz: 10 },
      { cx: 22, cz: -12, rx: 1, rz: 12 },
      { cx: 36, cz: 12, rx: 1, rz: 14 },
    ],
    crates: [
      { cx: -34, cz: 36, rx: 4, rz: 4 },
      { cx: 34, cz: -36, rx: 4, rz: 4 },
      { cx: 0, cz: 0, rx: 3, rz: 3 },
      { cx: -32, cz: -28, rx: 3, rz: 5 },
      { cx: 32, cz: 28, rx: 3, rz: 5 },
    ],
    tallCover: [
      { cx: -45, cz: 8, rx: 2, rz: 18 },
      { cx: 45, cz: -8, rx: 2, rz: 18 },
      { cx: 0, cz: 24, rx: 5, rz: 2 },
    ],
    catwalks: [{ cx: 0, cz: 26, rx: 24, rz: 3 }],
    rails: [{ cx: 0, cz: 30, rx: 24, rz: 1 }],
    aSite: { x: -34, z: 36, rx: 9, rz: 8 },
    bSite: { x: 34, z: -36, rx: 9, rz: 8 },
    tSpawn: { cx: 0, cz: -48, rx: 14, rz: 5 },
    ctSpawn: { cx: 0, cz: 48, rx: 14, rz: 5 },
  },
  anubis: {
    floorY: 63,
    floor: 'sand',
    playable: [
      { cx: -42, cz: -42, rx: 8, rz: 8 },
      { cx: -28, cz: -24, rx: 14, rz: 10 },
      { cx: 0, cz: -16, rx: 18, rz: 8 },
      { cx: 0, cz: 0, rx: 10, rz: 34 },
      { cx: -22, cz: 18, rx: 18, rz: 8 },
      { cx: -34, cz: 34, rx: 13, rz: 9 },
      { cx: 26, cz: -20, rx: 16, rz: 9 },
      { cx: 34, cz: -34, rx: 13, rz: 9 },
      { cx: 40, cz: 8, rx: 8, rz: 27 },
      { cx: 42, cz: 42, rx: 8, rz: 8 },
    ],
    walls: [
      { cx: -15, cz: -6, rx: 1, rz: 24 },
      { cx: 16, cz: 8, rx: 1, rz: 24 },
      { cx: 0, cz: 16, rx: 14, rz: 1 },
      { cx: 0, cz: -20, rx: 14, rz: 1 },
      { cx: -36, cz: 6, rx: 1, rz: 16 },
      { cx: 35, cz: 2, rx: 7, rz: 1 },
    ],
    crates: [
      { cx: -34, cz: 34, rx: 4, rz: 4 },
      { cx: 34, cz: -34, rx: 4, rz: 4 },
      { cx: -8, cz: -2, rx: 3, rz: 3 },
      { cx: 8, cz: 2, rx: 3, rz: 3 },
      { cx: 42, cz: 24, rx: 3, rz: 4 },
    ],
    tallCover: [
      { cx: -46, cz: 20, rx: 2, rz: 8 },
      { cx: 46, cz: -20, rx: 2, rz: 8 },
      { cx: 0, cz: 32, rx: 4, rz: 2 },
    ],
    catwalks: [{ cx: 0, cz: 28, rx: 30, rz: 3 }],
    rails: [{ cx: 0, cz: 32, rx: 30, rz: 1 }],
    aSite: { x: -34, z: 34, rx: 9, rz: 8 },
    bSite: { x: 34, z: -34, rx: 9, rz: 8 },
    tSpawn: { cx: -42, cz: -42, rx: 8, rz: 8 },
    ctSpawn: { cx: 42, cz: 42, rx: 8, rz: 8 },
  },
  vertigo: {
    floorY: 65,
    floor: 'deck',
    playable: [
      { cx: -44, cz: -34, rx: 8, rz: 8 },
      { cx: -30, cz: -24, rx: 13, rz: 20 },
      { cx: 0, cz: -22, rx: 24, rz: 7 },
      { cx: 0, cz: 0, rx: 11, rz: 34 },
      { cx: -24, cz: 20, rx: 23, rz: 8 },
      { cx: -34, cz: 34, rx: 13, rz: 9 },
      { cx: 24, cz: -6, rx: 18, rz: 18 },
      { cx: 34, cz: -34, rx: 13, rz: 9 },
      { cx: 44, cz: 14, rx: 7, rz: 26 },
      { cx: 44, cz: 34, rx: 8, rz: 8 },
    ],
    walls: [
      { cx: -17, cz: -8, rx: 1, rz: 22 },
      { cx: 18, cz: 4, rx: 1, rz: 24 },
      { cx: 0, cz: 16, rx: 14, rz: 1 },
      { cx: 0, cz: -16, rx: 14, rz: 1 },
      { cx: -40, cz: -2, rx: 1, rz: 14 },
      { cx: 40, cz: 4, rx: 1, rz: 12 },
    ],
    crates: [
      { cx: -34, cz: 34, rx: 5, rz: 4 },
      { cx: 34, cz: -34, rx: 5, rz: 4 },
      { cx: 0, cz: 0, rx: 4, rz: 3 },
      { cx: -32, cz: -14, rx: 3, rz: 5 },
      { cx: 32, cz: 14, rx: 3, rz: 5 },
    ],
    tallCover: [
      { cx: -46, cz: 20, rx: 2, rz: 8 },
      { cx: 46, cz: -20, rx: 2, rz: 8 },
    ],
    catwalks: [
      { cx: 0, cz: 30, rx: 34, rz: 3 },
      { cx: 0, cz: -30, rx: 34, rz: 3 },
    ],
    rails: [
      { cx: 0, cz: 34, rx: 34, rz: 1 },
      { cx: 0, cz: -34, rx: 34, rz: 1 },
    ],
    aSite: { x: -34, z: 34, rx: 9, rz: 8 },
    bSite: { x: 34, z: -34, rx: 9, rz: 8 },
    tSpawn: { cx: -44, cz: -34, rx: 8, rz: 8 },
    ctSpawn: { cx: 44, cz: 34, rx: 8, rz: 8 },
  },
};

export function generateCsgoColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number, variant: CbgoArenaVariant = 'mirage'): void {
  const b = getBlocks();
  const layout = CBGO_LAYOUTS[variant] || CBGO_LAYOUTS.mirage;
  const ax = Math.abs(gx);
  const az = Math.abs(gz);
  const inArena = ax <= 56 && az <= 56;
  if (!inArena) return;

  const playable = layout.playable.some(rect => inRect(gx, gz, rect)) || inRect(gx, gz, layout.tSpawn) || inRect(gx, gz, layout.ctSpawn);
  const perimeterWall = false;
  const wall = perimeterWall || layout.walls.some(rect => inRect(gx, gz, rect));
  const crate = layout.crates.some(rect => inRect(gx, gz, rect));
  const tallCover = layout.tallCover.some(rect => inRect(gx, gz, rect));
  const catwalk = layout.catwalks.some(rect => inRect(gx, gz, rect));
  const rail = layout.rails.some(rect => inRect(gx, gz, rect));
  const siteA = Math.abs(gx - layout.aSite.x) <= layout.aSite.rx && Math.abs(gz - layout.aSite.z) <= layout.aSite.rz;
  const siteB = Math.abs(gx - layout.bSite.x) <= layout.bSite.rx && Math.abs(gz - layout.bSite.z) <= layout.bSite.rz;
  const spawnT = inRect(gx, gz, layout.tSpawn);
  const spawnCt = inRect(gx, gz, layout.ctSpawn);
  const floorY = layout.floorY;
  const floorBlock = floorMaterial(layout.floor, b, gx, gz);

  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (gy < floorY - 2 || gy > floorY + 8) continue;

    if (gy >= floorY - 2 && gy < floorY && (playable || wall || catwalk)) {
      write(lx, ly, lz, variant === 'vertigo' ? b.stoneBricks : b.stone);
    }

    if (gy === floorY && playable) {
      write(lx, ly, lz, floorBlock);
      if (spawnT && spawnPattern(gx, gz, layout.tSpawn)) write(lx, ly, lz, b.yellowWool);
      if (spawnCt && spawnPattern(gx, gz, layout.ctSpawn)) write(lx, ly, lz, b.cyanWool);
      if (siteA && sitePattern(gx, gz, layout.aSite.x, layout.aSite.z)) write(lx, ly, lz, b.redWool);
      if (siteB && sitePattern(gx, gz, layout.bSite.x, layout.bSite.z)) write(lx, ly, lz, b.blueWool);
    }

    if (gy >= floorY + 1 && gy <= floorY + 5 && wall) {
      write(lx, ly, lz, gy === floorY + 5 ? b.quartz : wallMaterial(layout.floor, b, gx, gz, gy));
    }

    if (gy >= floorY + 1 && gy <= floorY + 2 && crate) {
      write(lx, ly, lz, variant === 'nuke' || variant === 'vertigo' ? b.grayWool : b.planks);
    }

    if (gy >= floorY + 1 && gy <= floorY + 4 && tallCover) {
      write(lx, ly, lz, variant === 'ancient' ? b.chiseled : variant === 'nuke' ? b.grayWool : b.stoneBricks);
    }

    if (gy === floorY + 3 && catwalk) {
      write(lx, ly, lz, variant === 'vertigo' || variant === 'nuke' ? b.grayWool : b.stoneBricks);
    }
    if (gy >= floorY + 4 && gy <= floorY + 5 && rail) {
      write(lx, ly, lz, b.glass);
    }

    const siteMarker = (Math.abs(gx - layout.aSite.x) <= 1 && Math.abs(gz - layout.aSite.z) <= 1)
      || (Math.abs(gx - layout.bSite.x) <= 1 && Math.abs(gz - layout.bSite.z) <= 1);
    if (siteMarker && gy === floorY + 4) {
      write(lx, ly, lz, b.torch);
    }
  }
}

function inRect(gx: number, gz: number, rect: CbgoRect): boolean {
  return Math.abs(gx - rect.cx) <= rect.rx && Math.abs(gz - rect.cz) <= rect.rz;
}

function sitePattern(gx: number, gz: number, cx: number, cz: number): boolean {
  return Math.abs((gx - cx) % 4) === 0 || Math.abs((gz - cz) % 4) === 0;
}

function spawnPattern(gx: number, gz: number, spawn: CbgoRect): boolean {
  const dx = Math.abs(gx - spawn.cx);
  const dz = Math.abs(gz - spawn.cz);
  return (dx <= 1 && dz <= 1) || dx === spawn.rx || dz === spawn.rz;
}

function floorMaterial(style: CbgoLayout['floor'], b: ReturnType<typeof getBlocks>, gx: number, gz: number): number {
  if (style === 'metal' || style === 'deck') return checker(gx, gz, 3) ? b.grayWool : b.stoneBricks;
  if (style === 'temple') return checker(gx, gz, 4) ? b.mossy : b.stoneBricks;
  if (style === 'canal') return checker(gx, gz, 5) ? b.blueWool : b.stoneBricks;
  if (style === 'stone') return checker(gx, gz, 5) ? b.cracked : b.stoneBricks;
  if ((Math.abs(gx) * 3 + Math.abs(gz) * 5) % 17 === 0) return b.sand;
  return checker(gx, gz, 4) ? b.cracked : b.stoneBricks;
}

function wallMaterial(style: CbgoLayout['floor'], b: ReturnType<typeof getBlocks>, gx: number, gz: number, gy: number): number {
  if (style === 'metal' || style === 'deck') return ((gx + gz + gy) % 5 === 0) ? b.quartz : b.grayWool;
  if (style === 'temple') return ((gx + gz + gy) % 6 === 0) ? b.mossy : b.chiseled;
  if (style === 'canal') return ((gx + gz + gy) % 6 === 0) ? b.cracked : b.stoneBricks;
  return ((gx + gz + gy) % 7 === 0) ? b.sand : b.chiseled;
}

export type Tf2ArenaVariant = 'payload' | 'cp' | 'koth' | 'ctf';

export function generateTf2Column(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number, variant: Tf2ArenaVariant = 'payload'): void {
  const b = getBlocks();
  const ax = Math.abs(gx);
  const az = Math.abs(gz);
  if (ax > 88 || az > 54) return;

  const floorY = 64;
  const boundsX = 86;
  const boundsZ = 52;
  const border = ax >= boundsX || az >= boundsZ;
  const redSide = gx < -42;
  const blueSide = gx > 42;
  const midZone = ax <= 18 && az <= 28;
  const redSpawn = inBox(gx, gz, -72, 0, 7, 9);
  const blueSpawn = inBox(gx, gz, 72, 0, 7, 9);
  const redBase = inBox(gx, gz, -66, 0, 18, 28);
  const blueBase = inBox(gx, gz, 66, 0, 18, 28);
  const redBaseShell = redBase && (Math.abs(gx + 66) === 18 || az === 28);
  const blueBaseShell = blueBase && (Math.abs(gx - 66) === 18 || az === 28);
  const baseDoor = (gx === -48 || gx === 48) && az <= 6;
  const sideDoor = (az === 28) && ((Math.abs(gx + 66) <= 4 && redBase) || (Math.abs(gx - 66) <= 4 && blueBase));
  const bridgeDeck = variant === 'ctf' && ax <= 16 && az <= 7;
  const sewerLane = variant === 'ctf' && ((Math.abs(gz - 38) <= 3 || Math.abs(gz + 38) <= 3) && ax <= 70);
  const waterChannel = variant === 'ctf' && ax <= 13 && (Math.abs(gz - 31) <= 2 || Math.abs(gz + 31) <= 2);
  const battlement = variant === 'ctf' && ((Math.abs(gx + 49) <= 2 && az <= 20) || (Math.abs(gx - 49) <= 2 && az <= 20));
  const redIntel = variant === 'ctf' && inBox(gx, gz, -76, 0, 2, 2);
  const blueIntel = variant === 'ctf' && inBox(gx, gz, 76, 0, 2, 2);

  const gorgeA = variant === 'cp' && inBox(gx, gz, -28, 0, 5, 5);
  const gorgeB = variant === 'cp' && inBox(gx, gz, 42, 0, 5, 5);
  const gorgeWarehouse =
    variant === 'cp'
    && (
      (inBox(gx, gz, -54, -24, 14, 10) && (Math.abs(gx + 54) === 14 || Math.abs(gz + 24) === 10))
      || (inBox(gx, gz, 12, 25, 18, 9) && (Math.abs(gx - 12) === 18 || Math.abs(gz - 25) === 9))
      || (inBox(gx, gz, 58, -22, 12, 12) && (Math.abs(gx - 58) === 12 || Math.abs(gz + 22) === 12))
    );
  const gorgeChoke =
    variant === 'cp'
    && (
      (Math.abs(gx + 8) <= 1 && az >= 10 && az <= 32)
      || (Math.abs(gx - 24) <= 1 && az >= 8 && az <= 31)
      || (Math.abs(gz) === 16 && gx >= -54 && gx <= -36)
      || (Math.abs(gz) === 18 && gx >= 34 && gx <= 58)
    );

  const payloadPathZ = Math.round(Math.sin((gx + 55) * 0.07) * 13);
  const payloadRail = variant === 'payload' && gx >= -74 && gx <= 70 && Math.abs(gz - payloadPathZ) <= 1;
  const payloadCart = variant === 'payload' && Math.abs(gx + 16) <= 2 && Math.abs(gz - Math.round(Math.sin((-16 + 55) * 0.07) * 13)) <= 2;
  const payloadShed =
    variant === 'payload'
    && (
      (inBox(gx, gz, -48, 24, 16, 9) && (Math.abs(gx + 48) === 16 || Math.abs(gz - 24) === 9))
      || (inBox(gx, gz, 4, -26, 18, 10) && (Math.abs(gx - 4) === 18 || Math.abs(gz + 26) === 10))
      || (inBox(gx, gz, 52, 20, 14, 11) && (Math.abs(gx - 52) === 14 || Math.abs(gz - 20) === 11))
    );
  const payloadGate = variant === 'payload' && ((Math.abs(gx + 24) <= 1 && gz >= -4 && gz <= 32) || (Math.abs(gx - 34) <= 1 && gz >= -34 && gz <= 4));

  const kothPoint = variant === 'koth' && ax <= 7 && az <= 7;
  const kothHill = variant === 'koth' && ax <= 16 && az <= 16;
  const kothHouse =
    variant === 'koth'
    && (
      (inBox(gx, gz, -38, 25, 12, 9) && (Math.abs(gx + 38) === 12 || Math.abs(gz - 25) === 9))
      || (inBox(gx, gz, 38, -25, 12, 9) && (Math.abs(gx - 38) === 12 || Math.abs(gz + 25) === 9))
    );
  const kothFlankWall = variant === 'koth' && ((Math.abs(gz) === 22 && ax <= 52) || (Math.abs(gx) === 26 && az >= 22 && az <= 40));

  const crate =
    inBox(gx, gz, -36, 13, 2, 2)
    || inBox(gx, gz, -36, -14, 2, 2)
    || inBox(gx, gz, 36, 13, 2, 2)
    || inBox(gx, gz, 36, -14, 2, 2)
    || inBox(gx, gz, -4, 25, 2, 3)
    || inBox(gx, gz, 4, -25, 2, 3);

  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (gy < floorY - 5 || gy > floorY + 12) continue;

    if (gy >= floorY - 5 && gy < floorY) {
      write(lx, ly, lz, gy <= floorY - 3 ? b.stone : b.stoneBricks);
    }

    if (gy === floorY) {
      let floor = checker(gx, gz, variant === 'ctf' ? 4 : 5) ? b.gravel : b.stoneBricks;
      if (redSide) floor = checker(gx, gz, 5) ? b.redWool : b.planks;
      if (blueSide) floor = checker(gx, gz, 5) ? b.blueWool : b.planks;
      if (midZone) floor = checker(gx, gz, 4) ? b.sand : b.gravel;
      if (sewerLane || waterChannel) floor = b.cracked;
      if (bridgeDeck) floor = b.planks;
      if (payloadRail) floor = checker(gx, gz, 2) ? b.chain : b.grayWool;
      if (gorgeA || gorgeB || kothPoint) floor = b.gold;
      if (kothHill && !kothPoint) floor = b.mossy;
      if (redSpawn || redIntel) floor = b.redWool;
      if (blueSpawn || blueIntel) floor = b.blueWool;
      write(lx, ly, lz, floor);
    }

    if (border && gy >= floorY + 1 && gy <= floorY + 8) {
      write(lx, ly, lz, gy === floorY + 8 ? b.chiseled : b.stoneBricks);
    }

    if (gy >= floorY + 1 && gy <= floorY + 6 && ((redBaseShell && !baseDoor && !sideDoor) || (blueBaseShell && !baseDoor && !sideDoor))) {
      const wall = gx < 0 ? b.redWool : b.blueWool;
      write(lx, ly, lz, gy === floorY + 6 ? b.planks : wall);
    }

    if ((redBase || blueBase) && gy === floorY + 7 && ((gx + gz) & 1) === 0) {
      write(lx, ly, lz, b.planks);
    }

    if (battlement && gy >= floorY + 5 && gy <= floorY + 6) {
      write(lx, ly, lz, gx < 0 ? b.redWool : b.blueWool);
    }

    if ((bridgeDeck && az === 7) || (bridgeDeck && az === 0 && ax <= 1)) {
      if (gy >= floorY + 1 && gy <= floorY + 2) write(lx, ly, lz, b.log);
    }

    if ((sewerLane || payloadGate || gorgeChoke || kothFlankWall) && gy >= floorY + 1 && gy <= floorY + 3) {
      const opening = (az <= 5 && (Math.abs(gx + 8) <= 1 || Math.abs(gx - 24) <= 1 || Math.abs(gx + 24) <= 1 || Math.abs(gx - 34) <= 1));
      if (!opening) write(lx, ly, lz, gy === floorY + 3 ? b.planks : b.stoneBricks);
    }

    if ((gorgeWarehouse || payloadShed || kothHouse) && gy >= floorY + 1 && gy <= floorY + 7) {
      const roof = gy === floorY + 7;
      const woodWall = variant === 'payload' || variant === 'koth';
      write(lx, ly, lz, roof ? b.planks : woodWall ? b.log : b.grayWool);
    }

    if (payloadCart && gy >= floorY + 1 && gy <= floorY + 3) {
      write(lx, ly, lz, gy === floorY + 3 ? b.glowstone : b.grayWool);
    }

    if ((crate || redIntel || blueIntel) && gy >= floorY + 1 && gy <= floorY + 2) {
      write(lx, ly, lz, redIntel ? b.redWool : blueIntel ? b.blueWool : b.planks);
    }

    if ((gorgeA || gorgeB || kothPoint || redIntel || blueIntel) && gy === floorY + 4 && ((gx + gz) & 3) === 0) {
      write(lx, ly, lz, b.torch);
    }

    if ((redSpawn || blueSpawn) && gy >= floorY + 1 && gy <= floorY + 3 && (Math.abs(gx - (redSpawn ? -72 : 72)) === 7 || az === 9)) {
      write(lx, ly, lz, redSpawn ? b.redWool : b.blueWool);
    }
  }
}

export function generateTf2TestColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const b = getBlocks();
  const ax = Math.abs(gx);
  const az = Math.abs(gz);
  if (ax > 54 || az > 54) return;

  const floorY = 4;

  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    
    // Solid floor plate (100x100, i.e. -50 to 50 in gx and gz) from y = 0 to 4
    if (ax <= 50 && az <= 50 && gy >= 0 && gy <= floorY) {
      write(lx, ly, lz, checker(gx, gz, 4) ? b.stoneBricks : b.quartz);
    }

    // Boundary walls (from floorY + 1 to floorY + 12)
    if (((ax === 50 && az <= 50) || (az === 50 && ax <= 50)) && gy >= floorY + 1 && gy <= floorY + 12) {
      write(lx, ly, lz, b.stoneBricks);
    }
  }
}

function inBox(gx: number, gz: number, cx: number, cz: number, rx: number, rz: number): boolean {
  return Math.abs(gx - cx) <= rx && Math.abs(gz - cz) <= rz;
}

function placeBedWarsBaseDetails(write: ColumnWriter, b: ReturnType<typeof getBlocks>, gx: number, lx: number, gz: number, lz: number, startY: number, cx: number, cz: number, wool: number, bedBlock: number): void {
  const toCenterX = -Math.sign(cx) || 1;
  const toCenterZ = -Math.sign(cz) || 1;
  const dx = gx - cx;
  const dz = gz - cz;

  const bedX = toCenterX * 4;
  const bedZ = toCenterZ * 4;
  const shopX = -toCenterX * 4;
  const shopZ = toCenterZ * 3;
  const upgradeX = toCenterX * 3;
  const upgradeZ = -toCenterZ * 4;

  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;

    // Team generator pad at spawn.
    if (gy === 63 && dx === 0 && dz === 0) write(lx, ly, lz, b.glowstone);
    if (gy === 64 && Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && (Math.abs(dx) === 1 || Math.abs(dz) === 1)) write(lx, ly, lz, wool);

    // Bed objective: colored pillow pad plus the actual bed block.
    if (gy === 63 && Math.abs(dx - bedX) <= 1 && Math.abs(dz - bedZ) <= 1) write(lx, ly, lz, wool);
    if (gy === 64 && dx === bedX && dz === bedZ) write(lx, ly, lz, bedBlock || b.bed);
    if (gy === 64 && dx === bedX - toCenterX && dz === bedZ - toCenterZ) write(lx, ly, lz, bedBlock || b.bed);

    // Stationary shop locations are marked with chest blocks; actual NPCs are
    // spawned client-side at these coordinates and never run wander AI.
    if (gy === 63 && Math.abs(dx - shopX) <= 1 && Math.abs(dz - shopZ) <= 1) write(lx, ly, lz, b.planks);
    if (gy === 64 && dx === shopX && dz === shopZ) write(lx, ly, lz, b.chest);
    if (gy === 63 && Math.abs(dx - upgradeX) <= 1 && Math.abs(dz - upgradeZ) <= 1) write(lx, ly, lz, b.planks);
    if (gy === 64 && dx === upgradeX && dz === upgradeZ) write(lx, ly, lz, b.chest);

    // Small team-colored rim. The radius was lowered to keep islands separated.
    if (gy === 63 && Math.max(Math.abs(dx), Math.abs(dz)) === 9 && Math.abs(dx) <= 10 && Math.abs(dz) <= 10) write(lx, ly, lz, wool);
    if (gy >= 64 && gy <= 67 && Math.abs(dx) === 9 && Math.abs(dz) === 9) write(lx, ly, lz, b.log);
    if (gy === 68 && Math.abs(dx) <= 10 && Math.abs(dz) <= 10 && (Math.abs(dx) === 10 || Math.abs(dz) === 10) && ((gx + gz) & 1) === 0) write(lx, ly, lz, wool);
  }
}

function placeBedWarsCenterDetails(write: ColumnWriter, b: ReturnType<typeof getBlocks>, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const ax = Math.abs(gx);
  const az = Math.abs(gz);
  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (gy === 64 && ((ax === 8 && az <= 8) || (az === 8 && ax <= 8))) write(lx, ly, lz, b.mossy);
    if (gy === 64 && CROWNFORGE_BEDWARS_EMERALD_GENERATORS.some(p => gx === p.x && gz === p.z)) write(lx, ly, lz, b.emerald);
    if (gy >= 64 && gy <= 75 && ax <= 2 && az <= 2) {
      const shell = ax === 2 || az === 2 || gy === 75;
      if (shell) write(lx, ly, lz, gy % 4 === 0 ? b.emerald : b.quartz);
    }
    if (gy === 69 && ax <= 5 && az <= 5 && (ax === 5 || az === 5)) write(lx, ly, lz, b.planks);
    if (gy === 65 && ((ax === 0 && az === 11) || (az === 0 && ax === 11))) write(lx, ly, lz, b.chest);
    if (gy >= 64 && gy <= 70 && ax === 12 && az === 12) write(lx, ly, lz, b.chiseled);
  }
}

export function generateVoidDuelsColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const b = getBlocks();
  const distSq = gx * gx + gz * gz;
  const ax = Math.abs(gx);
  const az = Math.abs(gz);
  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (gy >= 59 && gy <= 62 && distSq <= 20 * 20) write(lx, ly, lz, b.stone);
    else if (gy === 63 && distSq <= 20 * 20) write(lx, ly, lz, distSq > 17 * 17 ? b.quartz : b.stoneBricks);
    else if (gy === 64) {
      if ((ax === 16 && az <= 16) || (az === 16 && ax <= 16)) write(lx, ly, lz, b.glass);
      if ((gx === -10 && gz === 0) || (gx === 10 && gz === 0) || (gx === 0 && gz === 0)) write(lx, ly, lz, b.glowstone);
      if ((ax === 5 && az === 5) || (ax === 12 && az === 0) || (az === 12 && ax === 0)) write(lx, ly, lz, b.cracked);
    }
  }
}

export function generateCastleSiegeColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const b = getBlocks();
  const x = gx;
  const z = gz;
  const ax = Math.abs(x);
  const north = z < 0;
  const localZ = north ? z + 54 : z - 54;
  const inCastle = ax <= 28 && Math.abs(localZ) <= 24;
  const inBridge = ax <= 5 && Math.abs(z) <= 34;
  const sideLane = Math.abs(x) >= 16 && Math.abs(x) <= 21 && Math.abs(z) <= 46;
  const inField = ax <= 38 && Math.abs(z) <= 82;

  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (gy < 60 && inField) {
      write(lx, ly, lz, b.stone);
      continue;
    }
    if (gy === 60 && inField) {
      if (inBridge) write(lx, ly, lz, b.planks);
      else if (sideLane) write(lx, ly, lz, b.gravel);
      else if (inCastle) write(lx, ly, lz, b.stoneBricks);
      else write(lx, ly, lz, b.grass);
    }

    if (!inCastle) {
      if (gy === 61 && inBridge && Math.abs(z) % 6 === 0 && ax === 6) write(lx, ly, lz, b.planks);
      if (gy >= 61 && gy <= 73 && ax <= 1 && Math.abs(z) <= 2) write(lx, ly, lz, gy === 73 ? b.torch : b.chiseled);
      if (gy === 61 && sideLane && Math.abs(z) % 12 === 0) write(lx, ly, lz, b.chest);
      continue;
    }

    const wall = ax === 28 || Math.abs(localZ) === 24;
    const gate = ax <= 5 && Math.abs(localZ) === 24;
    const tower = ax >= 21 && Math.abs(localZ) >= 17;
    const innerKeep = ax <= 9 && Math.abs(localZ) <= 8;
    const battlement = gy === 71 && wall && !gate && ((x + localZ) & 1) === 0;
    const arrowWindow = !tower && gy >= 65 && gy <= 68 && wall && !gate && ((ax === 28 && Math.abs(localZ) % 6 === 0) || (Math.abs(localZ) === 24 && ax % 6 === 0));

    if (gy >= 61 && gy <= (tower ? 78 : 70) && wall && !gate) {
      write(lx, ly, lz, arrowWindow ? b.glass : (((x + localZ + gy) % 5 === 0) ? b.mossy : b.stoneBricks));
    } else if (battlement) {
      write(lx, ly, lz, b.stoneBricks);
    } else if (gy >= 61 && gy <= 69 && innerKeep && (ax === 9 || Math.abs(localZ) === 8)) {
      write(lx, ly, lz, gy === 69 ? b.cracked : b.stoneBricks);
    } else if (gy === 70 && innerKeep && ax <= 7 && Math.abs(localZ) <= 6) {
      write(lx, ly, lz, b.planks);
    } else if (gy === 61 && !wall && ((ax === 13 && Math.abs(localZ) <= 15) || (Math.abs(localZ) === 12 && ax <= 13))) {
      write(lx, ly, lz, b.gravel);
    } else if (gy === 71 && wall && ((x + z) % 10 === 0)) {
      write(lx, ly, lz, b.torch);
    } else if (gy === 61 && ((ax === 5 && Math.abs(localZ) === 16) || (ax === 17 && Math.abs(localZ) === 5))) {
      write(lx, ly, lz, b.chest);
    }
  }
}

export function generateSurvivalGamesOverlay(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const b = getBlocks();
  const ax = Math.abs(gx);
  const az = Math.abs(gz);
  const dist = Math.hypot(gx, gz);

  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (ax <= 16 && az <= 16) {
      if (gy === 66 && dist <= 16) write(lx, ly, lz, b.stoneBricks);
      if (gy === 67 && ((ax === az && ax <= 11) || ax + az <= 4)) write(lx, ly, lz, b.cracked);
      if (gy === 68 && ((ax === 5 && gz === 0) || (az === 5 && gx === 0) || (ax === 9 && az === 9))) write(lx, ly, lz, b.chest);
      if (gy >= 68 && gy <= 75 && ax <= 1 && az <= 1) write(lx, ly, lz, gy === 75 ? b.glowstone : b.chiseled);
    }

    const wall = (Math.abs(ax - 34) <= 1 && az <= 34) || (Math.abs(az - 34) <= 1 && ax <= 34);
    const gate = (ax <= 5 && Math.abs(az - 34) <= 1) || (az <= 5 && Math.abs(ax - 34) <= 1);
    if (wall && !gate && gy >= 66 && gy <= 73) write(lx, ly, lz, ((gx + gz + gy) % 6 === 0) ? b.mossy : b.cracked);
    if (gy === 66 && ((ax === 22 && az <= 6) || (az === 22 && ax <= 6))) write(lx, ly, lz, b.gravel);
    if (gy === 67 && ((ax === 24 && az === 12) || (az === 24 && ax === 12) || (ax === 30 && az === 30))) write(lx, ly, lz, b.chest);
  }
}


export function generateSurvivalGamesArenaColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  // A fully-built CrownForge arena. This intentionally does not call survival
  // terrain generation; joining CrownForge must never drop players into a normal
  // survival world.
  const y = 66;
  const ax = Math.abs(gx);
  const az = Math.abs(gz);
  const inArena = ax <= 58 && az <= 58;
  if (!inArena) return;

  // Bedrock void catch and flat arena slab.
  write(lx, 0, lz, 3);
  for (let by = y - 4; by <= y; by++) write(lx, by, lz, by === y ? 45 : 3);

  // Border walls around the arena.
  if (ax >= 55 || az >= 55) {
    for (let by = y + 1; by <= y + 7; by++) write(lx, by, lz, by % 2 === 0 ? 45 : 3);
  }

  // Central cornucopia platform and raised loot mound.
  const d = Math.hypot(gx, gz);
  if (d <= 13) {
    write(lx, y + 1, lz, 45);
    if (d <= 5) write(lx, y + 2, lz, 42);
  }

  // Four approach roads.
  if ((Math.abs(gx) <= 3 && az <= 54) || (Math.abs(gz) <= 3 && ax <= 54)) {
    write(lx, y + 1, lz, 1);
  }

  // Ruins / cover clusters, deterministic and symmetrical.
  const ruins = [
    [28, 24], [-28, 24], [28, -24], [-28, -24],
    [38, 0], [-38, 0], [0, 38], [0, -38]
  ];
  for (const [rx, rz] of ruins) {
    const dx = Math.abs(gx - rx);
    const dz = Math.abs(gz - rz);
    if (dx <= 5 && dz <= 5) {
      const edge = dx === 5 || dz === 5;
      if (edge) {
        const h = 3 + ((Math.abs(rx + rz + gx + gz) % 3));
        for (let by = y + 1; by <= y + h; by++) write(lx, by, lz, 45);
      } else if ((dx + dz) % 5 === 0) {
        write(lx, y + 1, lz, 85);
      }
    }
  }

  // Chest markers at fixed balanced points.
  const chests = [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7], [32, 28], [-32, 28], [32, -28], [-32, -28]];
  for (const [cx, cz] of chests) {
    if (gx === cx && gz === cz) write(lx, y + 2, lz, 54);
  }
}

export function generateBackroomsColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const b = getBlocks();
  const floorY = 60;
  const ceilingY = 68;
  const cell = 13;
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  const hash2 = (x: number, z: number, salt = 0) => Math.abs(((x * 734287) ^ (z * 912931) ^ (salt * 19349663)) | 0);
  const cellX = Math.floor(gx / cell);
  const cellZ = Math.floor(gz / cell);
  const localX = mod(gx, cell);
  const localZ = mod(gz, cell);
  const hash = hash2(cellX, cellZ, 1337);
  const distanceFromSpawn = Math.hypot(gx, gz);
  const dangerBand = Math.min(1, distanceFromSpawn / 320);
  const forgotten = dangerBand > 0.38 && (hash % Math.max(3, Math.floor(10 - dangerBand * 5))) === 0;
  const distortedRoom = dangerBand > 0.55 && (hash % 6) <= 2;

  const spawnClear = Math.abs(gx) <= 5 && Math.abs(gz) <= 5;
  const roomVariant = hash % 12;
  const maintenanceRoom = roomVariant === 2 || (hash % 37) === 4;
  const storageRoom = roomVariant === 5 || (hash % 41) === 9;
  const officeRoom = roomVariant === 8;
  const furnitureStoreRoom = roomVariant === 10 || forgotten;
  const collapsedRoom = roomVariant === 11 || distortedRoom;
  const deadEndRoom = (hash % 17) === 0;
  const rareExitRoom = (hash % 131) === 0 && Math.abs(cellX) + Math.abs(cellZ) > 9;

  const xDoor = localZ >= 5 && localZ <= 7 && (deadEndRoom ? localX < 2 : (hash % 5) !== 0);
  const zDoor = localX >= 5 && localX <= 7 && (deadEndRoom ? localZ < 2 : (Math.floor(hash / 7) % 5) !== 0);
  const wallX = localX === 0 && !xDoor;
  const wallZ = localZ === 0 && !zDoor;
  const pillar = localX === 0 && localZ === 0;
  const thickPillar = maintenanceRoom && localX <= 1 && localZ <= 1;
  const wall = !spawnClear && (wallX || wallZ || pillar || thickPillar);
  const edge = localX === 0 || localZ === 0 || localX === cell - 1 || localZ === cell - 1;

  const carpetPatch = (hash2(gx >> 1, gz >> 1, 51) % 19) === 0;
  const carpetStain = (hash2(gx, gz, 93) % 47) === 0;
  const wallpaperPatch = (hash2(gx, gz, startY + 19) % 23) === 0;
  const verticalStain = (hash2(gx >> 1, gz, 71) % 31) === 0;
  const ceilingStripA = localZ === 6 && localX >= 2 && localX <= 10;
  const ceilingStripB = (hash % 3) === 0 && localX === 6 && localZ >= 2 && localZ <= 10;
  const flickerGap = (hash2(cellX, cellZ, localX + localZ * 13) % 11) === 0;
  const fluorescentLight = (ceilingStripA || ceilingStripB) && !flickerGap;

  const shelf = storageRoom && localX >= 3 && localX <= 5 && localZ >= 3 && localZ <= 9;
  const desk = officeRoom && localX >= 3 && localX <= 5 && localZ >= 7 && localZ <= 10;
  const chair = officeRoom && localX === 7 && localZ === 8;
  const sofa = furnitureStoreRoom && localX >= 7 && localX <= 10 && localZ >= 3 && localZ <= 4;
  const crookedShelf = furnitureStoreRoom && localX >= 3 && localX <= 4 && localZ >= 6 && localZ <= 11;
  const fallenPanel = collapsedRoom && ((localX >= 2 && localX <= 9 && localZ === 10) || (localZ >= 2 && localZ <= 9 && localX === 10));
  const pipe = maintenanceRoom && ((localX === 3 && localZ >= 3 && localZ <= 10) || (localZ === 3 && localX >= 3 && localX <= 10));
  const chainDrop = maintenanceRoom && ((localX === 10 && localZ === 4) || (localX === 4 && localZ === 10));
  const foundChest = (storageRoom && localX === 8 && localZ === 8) || (officeRoom && localX === 4 && localZ === 9) || (rareExitRoom && localX === 6 && localZ === 6);
  const portalFrame = rareExitRoom && localX >= 4 && localX <= 8 && localZ >= 4 && localZ <= 8;

  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (gy < floorY - 1 || gy > ceilingY) continue;

    if (gy === floorY - 1) {
      write(lx, ly, lz, b.bedrock);
      continue;
    }

    if (gy === floorY) {
      const damp = carpetPatch || carpetStain || (dangerBand > 0.55 && (hash2(gx, gz, 404) % 9) === 0);
      const block = carpetStain ? b.gravel : (damp ? b.sand : (((gx >> 2) + (gz >> 2)) & 1 ? b.yellowWool : b.sand));
      write(lx, ly, lz, block);
      continue;
    }

    if (gy === ceilingY) {
      if (fluorescentLight) write(lx, ly, lz, b.glowstone);
      else write(lx, ly, lz, ((localX + localZ + hash) % 7 === 0) ? b.cracked : b.planks);
      continue;
    }

    if (wall) {
      const base = wallpaperPatch ? b.sand : b.yellowWool;
      const stained = (verticalStain || distortedRoom) && gy >= floorY + 1 && gy <= floorY + 4;
      const wrongWall = forgotten && (gy + localX + localZ) % 5 === 0;
      write(lx, ly, lz, stained ? b.gravel : wrongWall ? b.planks : (((gy + gx + gz + hash) % 11 === 0) ? b.sand : base));
      continue;
    }

    // Rare discoveries: storage rooms, broken offices, maintenance rooms, and a barely-lit exit room.
    if (gy === floorY + 1) {
      if (foundChest) write(lx, ly, lz, b.chest);
      else if (shelf && (localX === 3 || localX === 5 || localZ === 3 || localZ === 9)) write(lx, ly, lz, b.bookshelf);
      else if (desk) write(lx, ly, lz, b.planks);
      else if (chair) write(lx, ly, lz, b.log);
      else if (sofa) write(lx, ly, lz, b.redWool || b.planks);
      else if (crookedShelf && (localX === 3 || localZ === 6 || localZ === 11)) write(lx, ly, lz, b.bookshelf);
      else if (fallenPanel) write(lx, ly, lz, b.planks);
      else if (edge && (hash2(gx, gz, 202) % 29) === 0) write(lx, ly, lz, b.cracked);
      else if ((hash2(gx, gz, 303) % 211) === 0) write(lx, ly, lz, b.chest);
    }

    if (gy === floorY + 2) {
      if (shelf && (localX === 3 || localX === 5 || localZ === 3 || localZ === 9)) write(lx, ly, lz, b.bookshelf);
      if (crookedShelf && (localX === 3 || localX === 4)) write(lx, ly, lz, b.bookshelf);
      if (fallenPanel && distortedRoom && (hash2(gx, gz, 909) % 3) === 0) write(lx, ly, lz, b.chain);
      if (chainDrop) write(lx, ly, lz, b.chain);
      if (portalFrame && (localX === 4 || localX === 8 || localZ === 4 || localZ === 8)) write(lx, ly, lz, b.chiseled);
    }

    if (gy === floorY + 3) {
      if (pipe) write(lx, ly, lz, b.chain);
      if (chainDrop) write(lx, ly, lz, b.chain);
      if (portalFrame && localX >= 5 && localX <= 7 && localZ >= 5 && localZ <= 7) write(lx, ly, lz, b.portal);
    }

    if (gy === floorY + 4 && pipe) write(lx, ly, lz, b.chain);
    if (gy === floorY + 4 && distortedRoom && (localX === 2 || localZ === 2) && (hash2(gx, gz, 808) % 7) === 0) write(lx, ly, lz, b.chain);
    if (gy === ceilingY - 1 && fluorescentLight && (hash2(gx, gz, 707) % 5) === 0) write(lx, ly, lz, b.chain);
  }
}
