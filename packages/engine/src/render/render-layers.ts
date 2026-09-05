import type { PackedFrame } from "./host/index.js";
import { LIGHT_STRIDE, normalizeLightRig } from "./lights.js";
import { ENVIRONMENT_STRIDE } from "./environment.js";
import { CAMERA_STRIDE } from "../core/frame-builder.js";

export interface RenderLayerOptions {
  /** Clear the presentation colour before this layer. Defaults to true only
   * for the first layer. */
  readonly clearColor?: boolean;
  /** Clear depth before this layer. Defaults to true only for the first layer. */
  readonly clearDepth?: boolean;
}

export interface RenderLayerSubmission extends RenderLayerOptions {
  readonly frame: PackedFrame;
}

/** One atomic multi-camera submission. Tables and instance arrays are shared
 * across layers; layer counts and flags divide them without per-draw objects. */
export interface PackedRenderLayers {
  readonly meshTable: readonly string[];
  readonly meshIndices: Uint32Array;
  readonly materialTable: readonly string[];
  readonly materialIndices: Uint32Array;
  readonly matrices: Float32Array;
  readonly baseColors: Float32Array;
  readonly materialParams: Float32Array;
  readonly layerInstanceCounts: Uint32Array;
  /** bit 0 clear colour, bit 1 clear depth, bit 2 camera present, bit 3 light present */
  readonly layerFlags: Uint32Array;
  readonly cameras: Float32Array;
  /** Every layer's rig, concatenated; `LIGHT_STRIDE` floats per light. */
  readonly lights: Float32Array;
  /** Lights belonging to each layer, dividing `lights`. */
  readonly layerLightCounts: Uint32Array;
  /** Exactly `ENVIRONMENT_STRIDE` values per layer. */
  readonly environments: Float32Array;
}

export const RENDER_LAYER_CLEAR_COLOR = 1;
export const RENDER_LAYER_CLEAR_DEPTH = 2;
export const RENDER_LAYER_HAS_CAMERA = 4;
export const RENDER_LAYER_HAS_LIGHT = 8;
export const RENDER_LAYER_HAS_ENVIRONMENT = 16;

/** Packs a small number of camera layers into one WASM call. This function is
 * intentionally allocation-oriented: callers with a steady multi-view layout
 * should reuse the returned arrays through a future RenderLayerBuilder, while
 * migration bridges value a simple, fully validated boundary today. */
export function packRenderLayers(
  layers: readonly RenderLayerSubmission[],
): PackedRenderLayers {
  if (layers.length === 0)
    throw new Error("A render submission needs at least one layer.");
  const meshTable: string[] = [];
  const meshLookup = new Map<string, number>();
  const materialTable: string[] = [];
  const materialLookup = new Map<string, number>();
  let instanceCount = 0;
  for (const layer of layers) instanceCount += layer.frame.meshIndices.length;

  const meshIndices = new Uint32Array(instanceCount);
  const materialIndices = new Uint32Array(instanceCount);
  const matrices = new Float32Array(instanceCount * 16);
  const baseColors = new Float32Array(instanceCount * 4);
  const materialParams = new Float32Array(instanceCount * 4);
  const layerInstanceCounts = new Uint32Array(layers.length);
  const layerFlags = new Uint32Array(layers.length);
  const cameras = new Float32Array(layers.length * CAMERA_STRIDE);
  const environments = new Float32Array(layers.length * ENVIRONMENT_STRIDE);
  // A layer's rig is variable length, so the normalized records are collected
  // first and the shared buffer sized from the total.
  const layerLightCounts = new Uint32Array(layers.length);
  const perLayerLights = layers.map((layer) =>
    normalizeLightRig(layer.frame.light),
  );
  let totalLightFloats = 0;
  for (const rig of perLayerLights) totalLightFloats += rig.length;
  const lights = new Float32Array(totalLightFloats);
  let lightOffset = 0;

  let instanceOffset = 0;
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex]!;
    const frame = layer.frame;
    validatePackedFrameForLayer(frame, layerIndex);
    const count = frame.meshIndices.length;
    layerInstanceCounts[layerIndex] = count;
    let flags = 0;
    if (layer.clearColor ?? layerIndex === 0) flags |= RENDER_LAYER_CLEAR_COLOR;
    if (layer.clearDepth ?? layerIndex === 0) flags |= RENDER_LAYER_CLEAR_DEPTH;
    if (frame.camera.length !== 0) {
      flags |= RENDER_LAYER_HAS_CAMERA;
      cameras.set(frame.camera, layerIndex * CAMERA_STRIDE);
    }
    const rig = perLayerLights[layerIndex]!;
    if (rig.length !== 0) {
      flags |= RENDER_LAYER_HAS_LIGHT;
      lights.set(rig, lightOffset);
      layerLightCounts[layerIndex] = rig.length / LIGHT_STRIDE;
      lightOffset += rig.length;
    }
    const environment = frame.environment ?? EMPTY;
    if (environment.length !== 0) {
      flags |= RENDER_LAYER_HAS_ENVIRONMENT;
      environments.set(environment, layerIndex * ENVIRONMENT_STRIDE);
    }
    layerFlags[layerIndex] = flags;

    const meshRemap = frame.meshTable.map((id) =>
      intern(id, meshTable, meshLookup),
    );
    const materialRemap = frame.materialTable.map((id) =>
      intern(id, materialTable, materialLookup),
    );
    for (let index = 0; index < count; index += 1) {
      meshIndices[instanceOffset + index] =
        meshRemap[frame.meshIndices[index]!]!;
      materialIndices[instanceOffset + index] =
        materialRemap[frame.materialIndices[index]!]!;
    }
    matrices.set(frame.matrices, instanceOffset * 16);
    if (frame.baseColors.length === 0) {
      for (let index = 0; index < count; index += 1) {
        const offset = (instanceOffset + index) * 4;
        baseColors[offset] = 1;
        baseColors[offset + 1] = 1;
        baseColors[offset + 2] = 1;
        baseColors[offset + 3] = 1;
      }
    } else {
      baseColors.set(frame.baseColors, instanceOffset * 4);
    }
    if (frame.materialParams.length === 0) {
      for (let index = 0; index < count; index += 1) {
        const offset = (instanceOffset + index) * 4;
        materialParams[offset] = 0;
        materialParams[offset + 1] = 0.6;
        materialParams[offset + 2] = 0;
        materialParams[offset + 3] = 0.01;
      }
    } else {
      materialParams.set(frame.materialParams, instanceOffset * 4);
    }
    instanceOffset += count;
  }
  if (
    (layerFlags[0]! & (RENDER_LAYER_CLEAR_COLOR | RENDER_LAYER_CLEAR_DEPTH)) !==
    (RENDER_LAYER_CLEAR_COLOR | RENDER_LAYER_CLEAR_DEPTH)
  ) {
    throw new Error(
      "The first presentation layer must clear both colour and depth.",
    );
  }
  return {
    meshTable,
    meshIndices,
    materialTable,
    materialIndices,
    matrices,
    baseColors,
    materialParams,
    layerInstanceCounts,
    layerFlags,
    cameras,
    lights,
    layerLightCounts,
    environments,
  };
}

function intern(
  id: string,
  table: string[],
  lookup: Map<string, number>,
): number {
  const existing = lookup.get(id);
  if (existing !== undefined) return existing;
  const index = table.length;
  table.push(id);
  lookup.set(id, index);
  return index;
}

function validatePackedFrameForLayer(frame: PackedFrame, layer: number): void {
  const count = frame.meshIndices.length;
  if (
    frame.materialIndices.length !== count ||
    frame.matrices.length !== count * 16 ||
    (frame.baseColors.length !== 0 && frame.baseColors.length !== count * 4) ||
    (frame.materialParams.length !== 0 &&
      frame.materialParams.length !== count * 4)
  ) {
    throw new Error(
      `Render layer ${String(layer)} has inconsistent instance-array lengths.`,
    );
  }
  const environment = frame.environment;
  if (
    environment !== undefined &&
    environment.length !== 0 &&
    environment.length !== ENVIRONMENT_STRIDE
  ) {
    throw new Error(
      `Render layer ${String(layer)} environment needs ${String(ENVIRONMENT_STRIDE)} values.`,
    );
  }
  if (frame.camera.length !== 0 && frame.camera.length !== CAMERA_STRIDE)
    throw new Error(
      `Render layer ${String(layer)} camera needs ${String(CAMERA_STRIDE)} values.`,
    );
  if (
    frame.light.length !== 0 &&
    frame.light.length !== 7 &&
    frame.light.length % LIGHT_STRIDE !== 0
  ) {
    throw new Error(
      `Render layer ${String(layer)} light needs 7 values or a whole number of ${String(LIGHT_STRIDE)}-float lights.`,
    );
  }
  for (const index of frame.meshIndices)
    if (index >= frame.meshTable.length)
      throw new Error(
        `Render layer ${String(layer)} has an invalid mesh-table index.`,
      );
  for (const index of frame.materialIndices)
    if (index >= frame.materialTable.length)
      throw new Error(
        `Render layer ${String(layer)} has an invalid material-table index.`,
      );
}

const EMPTY = new Float32Array(0);
