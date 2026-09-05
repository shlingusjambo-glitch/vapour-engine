import * as THREE from 'three';

export type SkinPart = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
export type SkinFaceRects = Record<'right' | 'left' | 'top' | 'bottom' | 'front' | 'back', [number, number, number, number]>;

export function isSkinDataUrl(value: string): boolean {
  return /^data:image\/(png|jpeg);base64,/i.test(value || '');
}

export function skinPartRects(part: SkinPart, legacy: boolean, outer = false): SkinFaceRects {
  const base: Record<SkinPart, SkinFaceRects> = {
    head: {
      right: [0, 8, 8, 8], left: [16, 8, 8, 8], top: [8, 0, 8, 8],
      bottom: [16, 0, 8, 8], front: [8, 8, 8, 8], back: [24, 8, 8, 8],
    },
    body: {
      right: [16, 20, 4, 12], left: [28, 20, 4, 12], top: [20, 16, 8, 4],
      bottom: [28, 16, 8, 4], front: [20, 20, 8, 12], back: [32, 20, 8, 12],
    },
    rightArm: {
      right: [40, 20, 4, 12], left: [48, 20, 4, 12], top: [44, 16, 4, 4],
      bottom: [48, 16, 4, 4], front: [44, 20, 4, 12], back: [52, 20, 4, 12],
    },
    leftArm: {
      right: [32, 52, 4, 12], left: [40, 52, 4, 12], top: [36, 48, 4, 4],
      bottom: [40, 48, 4, 4], front: [36, 52, 4, 12], back: [44, 52, 4, 12],
    },
    rightLeg: {
      right: [0, 20, 4, 12], left: [8, 20, 4, 12], top: [4, 16, 4, 4],
      bottom: [8, 16, 4, 4], front: [4, 20, 4, 12], back: [12, 20, 4, 12],
    },
    leftLeg: {
      right: [16, 52, 4, 12], left: [24, 52, 4, 12], top: [20, 48, 4, 4],
      bottom: [24, 48, 4, 4], front: [20, 52, 4, 12], back: [28, 52, 4, 12],
    },
  };

  const overlay: Record<SkinPart, SkinFaceRects> = {
    head: {
      right: [32, 8, 8, 8], left: [48, 8, 8, 8], top: [40, 0, 8, 8],
      bottom: [48, 0, 8, 8], front: [40, 8, 8, 8], back: [56, 8, 8, 8],
    },
    body: {
      right: [16, 36, 4, 12], left: [28, 36, 4, 12], top: [20, 32, 8, 4],
      bottom: [28, 32, 8, 4], front: [20, 36, 8, 12], back: [32, 36, 8, 12],
    },
    rightArm: {
      right: [40, 36, 4, 12], left: [48, 36, 4, 12], top: [44, 32, 4, 4],
      bottom: [48, 32, 4, 4], front: [44, 36, 4, 12], back: [52, 36, 4, 12],
    },
    leftArm: {
      right: [48, 52, 4, 12], left: [56, 52, 4, 12], top: [52, 48, 4, 4],
      bottom: [56, 48, 4, 4], front: [52, 52, 4, 12], back: [60, 52, 4, 12],
    },
    rightLeg: {
      right: [0, 36, 4, 12], left: [8, 36, 4, 12], top: [4, 32, 4, 4],
      bottom: [8, 32, 4, 4], front: [4, 36, 4, 12], back: [12, 36, 4, 12],
    },
    leftLeg: {
      right: [0, 52, 4, 12], left: [8, 52, 4, 12], top: [4, 48, 4, 4],
      bottom: [8, 48, 4, 4], front: [4, 52, 4, 12], back: [12, 52, 4, 12],
    },
  };

  const resolvedPart = legacy && (part === 'leftArm' || part === 'leftLeg')
    ? (part === 'leftArm' ? 'rightArm' : 'rightLeg')
    : part;

  return outer && !legacy ? overlay[resolvedPart] : base[resolvedPart];
}

export function createSkinCanvas(img: HTMLImageElement, rect: [number, number, number, number], mirrorX = false): HTMLCanvasElement {
  const [x, y, w, h] = rect;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const normalizedH = img.height <= 32 ? 32 : 64;
  const sx = Math.round((x / 64) * img.width);
  const sy = Math.round((y / normalizedH) * img.height);
  const sw = Math.max(1, Math.round((w / 64) * img.width));
  const sh = Math.max(1, Math.round((h / normalizedH) * img.height));

  if (mirrorX) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function createSkinTexture(img: HTMLImageElement, rect: [number, number, number, number], mirrorX = false): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(createSkinCanvas(img, rect, mirrorX));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function createSkinMaterial(
  img: HTMLImageElement,
  rect: [number, number, number, number],
  mirrorX = false,
  options: { outer?: boolean; standard?: boolean } = {}
): THREE.Material {
  const map = createSkinTexture(img, rect, mirrorX);
  const params = {
    map,
    color: 0xffffff,
    transparent: !!options.outer,
    alphaTest: options.outer ? 0.08 : 0.01,
    depthWrite: true,
  };
  return options.standard
    ? new THREE.MeshStandardMaterial({ ...params, roughness: 0.82, metalness: 0.0 })
    : new THREE.MeshLambertMaterial(params);
}

export function setBoxSkin(
  root: THREE.Object3D,
  objectName: string,
  img: HTMLImageElement,
  rects: SkinFaceRects,
  mirrorX = false,
  options: { outer?: boolean; standard?: boolean } = {}
): void {
  const obj = root.getObjectByName(objectName);
  if (!(obj instanceof THREE.Mesh)) return;

  disposeMaterial(obj.material);
  // BoxGeometry order: +X, -X, +Y, -Y, +Z, -Z.
  // The avatar faces -Z, so +Z receives back and -Z receives front.
  obj.material = [
    createSkinMaterial(img, rects.right, mirrorX, options),
    createSkinMaterial(img, rects.left, mirrorX, options),
    createSkinMaterial(img, rects.top, mirrorX, options),
    createSkinMaterial(img, rects.bottom, mirrorX, options),
    createSkinMaterial(img, rects.back, mirrorX, options),
    createSkinMaterial(img, rects.front, mirrorX, options),
  ];
  obj.castShadow = true;
  obj.receiveShadow = true;
}

export function disposeMaterial(material: THREE.Material | THREE.Material[] | undefined): void {
  if (!material) return;
  const mats = Array.isArray(material) ? material : [material];
  for (const mat of mats) {
    const map = (mat as any).map as THREE.Texture | undefined;
    map?.dispose?.();
    mat.dispose?.();
  }
}
