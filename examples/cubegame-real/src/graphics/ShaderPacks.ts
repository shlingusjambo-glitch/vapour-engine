import { EventBus } from '../core/EventBus';
export interface ShaderPackSettings {
  id: string;
  name: string;
  enabled: boolean;
  bloom: boolean;
  saturation: number;
  gradeStrength: number;
  exposure: number;
  pixelRatioCap: number;
}

/**
 * Built-in shader packs. These are deliberately calmer than the earlier build:
 * the default look is less saturated, cheaper to render, and can be disabled
 * completely from the menu for low-end laptops or browser/driver issues.
 */
export const SHADER_PACKS: ShaderPackSettings[] = [
  {
    id: 'off',
    name: 'Off / Vanilla Performance',
    enabled: false,
    bloom: false,
    saturation: 0.86,
    gradeStrength: 0.0,
    exposure: 0.88,
    pixelRatioCap: 1.0,
  },
  {
    id: 'performance',
    name: 'Performance',
    enabled: false,
    bloom: false,
    saturation: 0.88,
    gradeStrength: 0.0,
    exposure: 0.90,
    pixelRatioCap: 1.0,
  },
  {
    id: 'balanced',
    name: 'Balanced',
    enabled: true,
    bloom: false,
    saturation: 0.90,
    gradeStrength: 0.56,
    exposure: 0.91,
    pixelRatioCap: 1.25,
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    enabled: true,
    bloom: true,
    saturation: 0.94,
    gradeStrength: 0.74,
    exposure: 0.94,
    pixelRatioCap: 1.5,
  },
  {
    id: 'vivid',
    name: 'Vivid Colors',
    enabled: true,
    bloom: true,
    saturation: 1.02,
    gradeStrength: 0.82,
    exposure: 0.96,
    pixelRatioCap: 1.35,
  },
];


export function registerShaderPack(pack: ShaderPackSettings): void {
  if (!pack?.id || !pack?.name) return;

  const cleanPack: ShaderPackSettings = {
    id: String(pack.id).trim(),
    name: String(pack.name).trim(),
    enabled: !!pack.enabled,
    bloom: !!pack.bloom,
    saturation: Number.isFinite(pack.saturation) ? pack.saturation : 0.9,
    gradeStrength: Number.isFinite(pack.gradeStrength) ? pack.gradeStrength : 0.55,
    exposure: Number.isFinite(pack.exposure) ? pack.exposure : 0.92,
    pixelRatioCap: Number.isFinite(pack.pixelRatioCap) ? pack.pixelRatioCap : 1.25,
  };

  const existing = SHADER_PACKS.findIndex(existingPack => existingPack.id === cleanPack.id);
  if (existing >= 0) SHADER_PACKS[existing] = cleanPack;
  else SHADER_PACKS.push(cleanPack);

  EventBus.emit('shaders:packRegistered', cleanPack);
}

export function getAllShaderPacks(): ShaderPackSettings[] {
  return [...SHADER_PACKS];
}

export function getShaderPack(id: string): ShaderPackSettings {
  return SHADER_PACKS.find(pack => pack.id === id) || SHADER_PACKS.find(pack => pack.id === 'balanced') || SHADER_PACKS[0];
}
