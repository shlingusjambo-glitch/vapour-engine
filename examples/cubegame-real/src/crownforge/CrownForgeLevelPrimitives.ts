import { getFeatureBlockId } from '../content/FeatureCatalog';

export type ColumnWriter = (lx: number, ly: number, lz: number, blockId: number) => void;

export interface Blocks {
  grass: number;
  dirt: number;
  stone: number;
  sand: number;
  planks: number;
  glass: number;
  chest: number;
  torch: number;
  portal: number;
  bed: number;
  redBed: number;
  blueBed: number;
  greenBed: number;
  yellowBed: number;
  endstone: number;
  quartz: number;
  stoneBricks: number;
  cracked: number;
  mossy: number;
  chiseled: number;
  glowstone: number;
  gold: number;
  diamond: number;
  emerald: number;
  log: number;
  leaves: number;
  redWool: number;
  blueWool: number;
  greenWool: number;
  yellowWool: number;
  whiteWool: number;
  cyanWool: number;
  pinkWool: number;
  grayWool: number;
  purpleWool: number;
  chain: number;
  bookshelf: number;
  gravel: number;
  bedrock: number;
}

export function getBlocks(): Blocks {
  const stoneBricks = getFeatureBlockId('Stone Bricks') || 3;
  const quartz = getFeatureBlockId('Quartz Block') || 10;
  const glowstone = getFeatureBlockId('Glowstone') || 32;
  return {
    grass: 1,
    dirt: 2,
    stone: 3,
    sand: 6,
    planks: 15,
    glass: 11,
    chest: 23,
    torch: 21,
    portal: 29,
    bed: getFeatureBlockId('Bed') || 18,
    redBed: getFeatureBlockId('Red Bed') || getFeatureBlockId('Bed') || 18,
    blueBed: getFeatureBlockId('Blue Bed') || getFeatureBlockId('Bed') || 18,
    greenBed: getFeatureBlockId('Green Bed') || getFeatureBlockId('Bed') || 18,
    yellowBed: getFeatureBlockId('Yellow Bed') || getFeatureBlockId('Bed') || 18,
    endstone: getFeatureBlockId('End Stone') || 34,
    quartz,
    stoneBricks,
    cracked: getFeatureBlockId('Cracked Stone Bricks') || stoneBricks,
    mossy: getFeatureBlockId('Mossy Stone Bricks') || stoneBricks,
    chiseled: getFeatureBlockId('Chiseled Stone Bricks') || stoneBricks,
    glowstone,
    gold: getFeatureBlockId('Gold Block') || glowstone,
    diamond: getFeatureBlockId('Diamond Block') || glowstone,
    emerald: getFeatureBlockId('Emerald Block') || glowstone,
    log: getFeatureBlockId('Jungle Log') || getFeatureBlockId('Oak Log') || 4,
    leaves: getFeatureBlockId('Jungle Leaves') || getFeatureBlockId('Oak Leaves') || 5,
    redWool: getFeatureBlockId('Red Wool') || quartz,
    blueWool: getFeatureBlockId('Blue Wool') || quartz,
    greenWool: getFeatureBlockId('Green Wool') || quartz,
    yellowWool: getFeatureBlockId('Yellow Wool') || quartz,
    whiteWool: getFeatureBlockId('White Wool') || quartz,
    cyanWool: getFeatureBlockId('Cyan Wool') || quartz,
    pinkWool: getFeatureBlockId('Pink Wool') || quartz,
    grayWool: getFeatureBlockId('Gray Wool') || quartz,
    purpleWool: getFeatureBlockId('Purple Wool') || quartz,
    chain: getFeatureBlockId('Chain') || stoneBricks,
    bookshelf: 20,
    gravel: 16,
    bedrock: getFeatureBlockId('Bedrock') || 35,
  };
}

export function columnIndex(x: number, y: number, z: number): number {
  return x + (y << 4) + (z << 8);
}

export function writeSafe(data: Uint16Array): ColumnWriter {
  return (x, y, z, blockId) => {
    if (blockId === 0) return;
    if (x < 0 || x > 15 || y < 0 || y > 15 || z < 0 || z > 15) return;
    data[columnIndex(x, y, z)] = blockId;
  };
}

export function checker(gx: number, gz: number, scale = 4): boolean {
  return ((Math.floor(gx / scale) + Math.floor(gz / scale)) & 1) === 0;
}

export function diamondDistance(x: number, z: number): number {
  return Math.abs(x) + Math.abs(z);
}

export function rotatedLocal(gx: number, gz: number, cx: number, cz: number, angle: number): { x: number; z: number } {
  const dx = gx - cx;
  const dz = gz - cz;
  return {
    x: Math.round(Math.cos(angle) * dx + Math.sin(angle) * dz),
    z: Math.round(-Math.sin(angle) * dx + Math.cos(angle) * dz),
  };
}

export function columnIsFloatingIsland(
  write: ColumnWriter,
  gx: number,
  lx: number,
  gz: number,
  lz: number,
  startY: number,
  cx: number,
  cz: number,
  radius: number,
  top: number,
  depth: number,
  topBlock: number,
  upperBlock: number,
  coreBlock: number,
  rimBlock?: number
): boolean {
  const dx = gx - cx;
  const dz = gz - cz;
  const dist = Math.hypot(dx, dz);
  if (dist > radius + 1.5) return false;

  let touched = false;
  for (let ly = 0; ly < 16; ly++) {
    const gy = startY + ly;
    const fall = top - gy;
    if (fall < 0 || fall > depth) continue;

    const taper = Math.max(2.1, radius - Math.max(0, fall - 1) * 0.72);
    const ragged = (((gx * 734287 + gz * 912271 + gy * 43891) >>> 0) % 11) * 0.04;
    if (dist > taper + ragged) continue;

    if (gy === top) {
      const edge = dist > radius - 1.7;
      write(lx, ly, lz, edge && rimBlock ? rimBlock : topBlock);
    } else if (gy >= top - 3) {
      write(lx, ly, lz, upperBlock);
    } else {
      write(lx, ly, lz, coreBlock);
    }
    touched = true;
  }
  return touched;
}
