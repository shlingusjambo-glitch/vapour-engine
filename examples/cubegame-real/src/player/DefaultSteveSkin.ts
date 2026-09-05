let cachedDefaultSteveSkin = '';
let cachedDefaultAlexSkin = '';

type SkinPalette = {
  skin: string;
  skinDark: string;
  hair: string;
  hairHi: string;
  shirt: string;
  shirtDark: string;
  pants: string;
  pantsDark: string;
  shoe: string;
  slimArms?: boolean;
};

function paintMinecraftSkin(palette: SkinPalette): string {
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 64, 64);

  const fill = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  const { skin, skinDark, hair, hairHi, shirt, shirtDark, pants, pantsDark, shoe } = palette;
  const armW = palette.slimArms ? 3 : 4;

  fill(skin, 0, 0, 64, 64);

  // Head.
  fill(skin, 0, 8, 32, 8);
  fill(skin, 8, 0, 16, 8);
  fill(hair, 0, 8, 8, 8);
  fill(hair, 16, 8, 16, 8);
  fill(hair, 8, 0, 16, 4);
  fill(hairHi, 9, 4, 5, 2);
  fill(hairHi, 2, 10, 3, 3);
  fill('#f7f1e9', 10, 12, 2, 1);
  fill('#f7f1e9', 14, 12, 2, 1);
  fill('#3a67d8', 11, 12, 1, 1);
  fill('#3a67d8', 14, 12, 1, 1);
  fill(skinDark, 11, 13, 2, 1);
  fill('#6d3023', 11, 15, 3, 1);

  // Body.
  fill(shirt, 16, 20, 24, 12);
  fill(shirtDark, 16, 20, 4, 12);
  fill(shirtDark, 28, 20, 4, 12);
  fill(shirt, 20, 16, 16, 4);
  fill(skin, 22, 20, 4, 2);

  // Right arm. Steve uses 4px arms; Alex uses a 3px visual stripe inside the
  // standard 64x64 skin map so both texture layouts still load everywhere.
  fill(shirt, 40, 16, 16, 8);
  fill(shirtDark, 40, 20, 4, 4);
  fill(shirtDark, 52, 20, 4, 4);
  fill(skin, 40, 24, 16, 8);
  fill(skinDark, 40, 29, 16, 3);
  if (armW === 3) {
    fill('rgba(0,0,0,0)', 47, 20, 1, 12);
    fill('rgba(0,0,0,0)', 47, 52, 1, 12);
  }

  // Right leg.
  fill(pants, 0, 16, 16, 12);
  fill(pantsDark, 0, 20, 4, 8);
  fill(pantsDark, 12, 20, 4, 8);
  fill(shoe, 0, 28, 16, 4);

  // Left arm.
  fill(shirt, 32, 48, 16, 8);
  fill(shirtDark, 32, 52, 4, 4);
  fill(shirtDark, 44, 52, 4, 4);
  fill(skin, 32, 56, 16, 8);
  fill(skinDark, 32, 61, 16, 3);

  // Left leg.
  fill(pants, 16, 48, 16, 12);
  fill(pantsDark, 16, 52, 4, 8);
  fill(pantsDark, 28, 52, 4, 8);
  fill(shoe, 16, 60, 16, 4);

  return canvas.toDataURL('image/png');
}

export function createDefaultSteveSkinDataUrl(): string {
  if (cachedDefaultSteveSkin) return cachedDefaultSteveSkin;
  cachedDefaultSteveSkin = paintMinecraftSkin({
    skin: '#c68655',
    skinDark: '#a66a43',
    hair: '#2b1a12',
    hairHi: '#4a2d1d',
    shirt: '#128f8d',
    shirtDark: '#0c6e73',
    pants: '#283a91',
    pantsDark: '#1d276b',
    shoe: '#3b3430',
  });
  return cachedDefaultSteveSkin;
}

export function createDefaultAlexSkinDataUrl(): string {
  if (cachedDefaultAlexSkin) return cachedDefaultAlexSkin;
  cachedDefaultAlexSkin = paintMinecraftSkin({
    skin: '#d9a071',
    skinDark: '#ad744f',
    hair: '#b5522c',
    hairHi: '#e08345',
    shirt: '#6cc24a',
    shirtDark: '#3b8d3b',
    pants: '#6a4bc1',
    pantsDark: '#493084',
    shoe: '#3b3430',
    slimArms: true,
  });
  return cachedDefaultAlexSkin;
}

export function getDefaultSkinDataUrl(kind: 'steve' | 'alex' = 'steve'): string {
  return kind === 'alex' ? createDefaultAlexSkinDataUrl() : createDefaultSteveSkinDataUrl();
}
