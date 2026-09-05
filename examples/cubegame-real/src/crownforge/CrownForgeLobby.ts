import { CROWNFORGE_PREGAME_SPAWN } from './CrownForgeCatalog';
import { checker, ColumnWriter, getBlocks } from './CrownForgeLevelPrimitives';

export const CROWNFORGE_PORTALS = [
  { command: '/skywars', x: 0, z: -30, frame: 'blueWool', cap: 'whiteWool' },
  { command: '/bedwars', x: 30, z: 0, frame: 'redWool', cap: 'gold' },
  { command: '/castle', x: 0, z: 30, frame: 'yellowWool', cap: 'greenWool' },
  { command: '/duels', x: -30, z: 0, frame: 'purpleWool', cap: 'whiteWool' },
  { command: '/sg', x: -30, z: -30, frame: 'greenWool', cap: 'emerald' },
] as const;

export function generateLobbyColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const b = getBlocks();
  const dx = gx;
  const dz = gz;
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  const dist = Math.hypot(dx, dz);
  if (ax > 74 || az > 74) return;

  const clearSpawn = dist <= 15;
  const centralPlaza = dist <= 21;
  const rotundaRing = dist >= 22 && dist <= 24;
  const cardinalPath = ax <= 4 || az <= 4;
  const diagonalPath = Math.abs(ax - az) <= 1 && ax <= 42 && az <= 42;
  const promenade = (ax <= 56 && az <= 56) && (cardinalPath || diagonalPath || ax === 42 || az === 42);
  const outerWall = (ax >= 66 || az >= 66) && ax <= 72 && az <= 72;
  const gate = (az >= 66 && ax <= 7) || (ax >= 66 && az <= 7);
  const tower = ax >= 58 && az >= 58;
  const balcony = ((ax >= 45 && ax <= 58 && az <= 58) || (az >= 45 && az <= 58 && ax <= 58));

  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;

    const portalBlock = lobbyPortalBlock(b, gx, gz, gy);
    if (portalBlock) {
      write(lx, ly, lz, portalBlock);
      continue;
    }

    if (gy >= 57 && gy <= 63) {
      if (ax <= 72 && az <= 72) write(lx, ly, lz, gy >= 61 && clearSpawn ? b.quartz : b.stoneBricks);
    } else if (gy === 64) {
      if (outerWall && !gate) write(lx, ly, lz, b.cracked);
      else if (centralPlaza) write(lx, ly, lz, clearSpawn ? (Math.floor(dist) % 5 === 0 ? b.glowstone : b.quartz) : b.quartz);
      else if (promenade) write(lx, ly, lz, checker(gx, gz, 3) ? b.planks : b.mossy);
      else write(lx, ly, lz, checker(gx, gz, 5) ? b.stoneBricks : b.mossy);
    } else if (gy >= 65 && gy <= (tower ? 92 : 78) && outerWall && !gate) {
      const window = !tower && gy >= 69 && gy <= 74 && ((ax === 66 && az % 8 === 0) || (az === 66 && ax % 8 === 0));
      write(lx, ly, lz, window ? b.glass : (gy % 7 === 0 ? b.mossy : b.stoneBricks));
    } else if (gy === 79 && outerWall && !gate && ((gx + gz) & 1) === 0) {
      write(lx, ly, lz, b.stoneBricks);
    } else if (gy >= 65 && gy <= 77 && rotundaRing && ((gx + gz + gy) % 3 !== 0)) {
      write(lx, ly, lz, gy % 5 === 0 ? b.gold : b.chiseled);
    } else if (gy === 78 && rotundaRing) {
      write(lx, ly, lz, b.glowstone);
    } else if (gy === 73 && balcony && !centralPlaza) {
      write(lx, ly, lz, checker(gx, gz, 4) ? b.planks : b.grayWool);
    } else if (gy >= 76 && gy <= 82 && ax % 16 === 0 && az % 16 === 0 && ax <= 48 && az <= 48) {
      write(lx, ly, lz, gy === 76 ? b.glowstone : b.chain);
    } else if (gy === 65 && isLobbyNpcPad(dx, dz)) {
      write(lx, ly, lz, b.gold);
    } else if (gy === 66 && isLobbyNpcStand(dx, dz)) {
      write(lx, ly, lz, b.chest);
    } else if (gy >= 66 && gy <= 74 && isLobbyParkourBlock(dx, dz, gy)) {
      write(lx, ly, lz, gy % 2 === 0 ? b.yellowWool : b.greenWool);
    } else if (gy === 66 && ((ax === 60 && az % 10 === 0) || (az === 60 && ax % 10 === 0))) {
      write(lx, ly, lz, b.torch);
    } else if (gy >= 65 && gy <= 71 && ax <= 2 && az <= 2 && !clearSpawn) {
      write(lx, ly, lz, b.glowstone);
    }
  }
}

function lobbyPortalBlock(b: ReturnType<typeof getBlocks>, gx: number, gz: number, gy: number): number {
  for (const def of CROWNFORGE_PORTALS) {
    const pdx = Math.abs(gx - def.x);
    const pdz = Math.abs(gz - def.z);
    const frame = b[def.frame];
    const cap = b[def.cap];
    if (pdx <= 2 && pdz <= 1 && gy >= 65 && gy <= 68) return b.portal;
    if (gy >= 65 && gy <= 69) {
      const isFrame = (pdx === 3 && pdz <= 2) || (pdz === 2 && pdx <= 3) || (gy === 69 && pdx <= 3 && pdz <= 2);
      if (isFrame) return frame;
    }
    if (gy === 70 && pdx <= 2 && pdz === 3) return cap;
    if (gy === 64 && pdx <= 4 && pdz <= 4) return frame;
  }
  return 0;
}

function isLobbyNpcPad(dx: number, dz: number): boolean {
  const pads = [[18, -18], [-18, 18], [18, 18], [-18, -18], [0, -24], [24, 0], [0, 24], [-24, 0]];
  return pads.some(([x, z]) => Math.abs(dx - x) <= 1 && Math.abs(dz - z) <= 1);
}

function isLobbyNpcStand(dx: number, dz: number): boolean {
  return [[18, -18], [-18, 18], [18, 18], [-18, -18]].some(([x, z]) => dx === x && dz === z);
}

function isLobbyParkourBlock(dx: number, dz: number, gy: number): boolean {
  const blocks = [
    [22, -8, 66], [25, -11, 67], [28, -14, 68], [31, -18, 70], [34, -22, 72], [37, -26, 74],
    [-8, 22, 66], [-11, 25, 67], [-14, 28, 69], [-18, 31, 71], [-22, 34, 73], [-26, 37, 74],
    [8, 31, 66], [12, 34, 68], [16, 36, 70], [20, 38, 72],
  ];
  return blocks.some(([x, z, y]) => dx === x && dz === z && gy === y);
}

export function generatePregameLobbyColumn(write: ColumnWriter, gx: number, lx: number, gz: number, lz: number, startY: number): void {
  const b = getBlocks();
  const dx = gx - CROWNFORGE_PREGAME_SPAWN.x;
  const dz = gz - CROWNFORGE_PREGAME_SPAWN.z;
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  if (ax > 28 || az > 28) return;

  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    if (gy >= 68 && gy <= 71) {
      write(lx, ly, lz, b.stoneBricks);
    } else if (gy === 72) {
      if (ax === 28 || az === 28) write(lx, ly, lz, b.glass);
      else if (ax <= 3 || az <= 3) write(lx, ly, lz, b.planks);
      else if ((ax === 13 && az <= 5) || (az === 13 && ax <= 5)) write(lx, ly, lz, b.yellowWool);
      else write(lx, ly, lz, checker(gx, gz, 4) ? b.quartz : b.grayWool);
    } else if (gy === 73) {
      if ((ax === 23 && az === 23) || (ax <= 1 && az <= 1)) write(lx, ly, lz, b.glowstone);
      if ((ax === 8 && az === 8) || (ax === 18 && az === 0) || (az === 18 && ax === 0)) write(lx, ly, lz, b.chest);
    } else if (gy >= 73 && gy <= 81 && (ax === 28 || az === 28)) {
      write(lx, ly, lz, gy === 81 ? b.stoneBricks : b.glass);
    } else if (gy >= 73 && gy <= 78 && ax === 22 && az === 22) {
      write(lx, ly, lz, b.stoneBricks);
    } else if (gy === 74 && isPregameParkour(dx, dz)) {
      write(lx, ly, lz, b.greenWool);
    }
  }
}

function isPregameParkour(dx: number, dz: number): boolean {
  return [[-16, -12], [-11, -7], [-6, -3], [0, 1], [6, 4], [11, 8], [16, 12]].some(([x, z]) => dx === x && dz === z);
}
