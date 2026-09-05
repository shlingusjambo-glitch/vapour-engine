import { LIGHT_STRIDE } from "./lights.js";
import { ENVIRONMENT_STRIDE } from "./environment.js";
import { CAMERA_STRIDE } from "../core/frame-builder.js";
import {
  validateMaterialUpload,
  validateTextureUpload,
  type MaterialUpload,
  type MeshUpload,
  type PackedFrame,
  type PostProcessSettings,
  type RenderHost,
  type RenderStats,
  type TextureUpload,
} from "./host/index.js";
import type { RenderLayerSubmission } from "./render-layers.js";

export interface HeadlessFrameSnapshot {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly instances: number;
  readonly meshIds: readonly string[];
}

/**
 * Explicit no-GPU render host for automated gameplay tests, dedicated servers,
 * import validation, and CI. It validates the same public mesh/frame contract
 * and computes workload statistics but never creates a graphics context.
 *
 * This is not selected automatically when WebGPU fails. Shipping games still
 * receive the actionable WebGPU error instead of a misleading blank fallback.
 */
export class HeadlessRenderHost extends EventTarget implements RenderHost {
  readonly #meshes = new Map<string, MeshUpload>();
  readonly #textures = new Map<string, TextureUpload>();
  readonly #materials = new Map<string, MaterialUpload>();
  #initialized = false;
  #destroyed = false;
  #lastTime = 0;
  #postProcess: PostProcessSettings = { exposure: 1, toneMapping: "aces" };
  #snapshot: HeadlessFrameSnapshot = {
    drawCalls: 0,
    triangles: 0,
    instances: 0,
    meshIds: [],
  };

  get initialized(): boolean {
    return this.#initialized && !this.#destroyed;
  }

  async initialize(): Promise<void> {
    if (this.#destroyed)
      throw new Error("Cannot initialize a destroyed headless render host.");
    this.#initialized = true;
  }

  uploadMesh(id: string, mesh: MeshUpload): void {
    this.#requireAlive();
    validateMesh(id, mesh);
    this.#meshes.set(id, mesh);
  }

  releaseMesh(id: string): boolean {
    this.#requireAlive();
    return this.#meshes.delete(id);
  }

  meshIds(): readonly string[] {
    return [...this.#meshes.keys()];
  }

  uploadTexture(id: string, texture: TextureUpload): void {
    this.#requireAlive();
    validateTextureUpload(id, texture);
    this.#textures.set(id, texture);
  }

  releaseTexture(id: string): boolean {
    this.#requireAlive();
    for (const [materialId, material] of this.#materials) {
      if (Object.values(material.textures ?? {}).includes(id))
        throw new Error(
          `Texture '${id}' is still used by material '${materialId}'.`,
        );
    }
    return this.#textures.delete(id);
  }

  defineMaterial(id: string, material: MaterialUpload): void {
    this.#requireAlive();
    validateMaterialUpload(id, material, (textureId) =>
      this.#textures.has(textureId),
    );
    this.#materials.set(id, material);
  }

  releaseMaterial(id: string): boolean {
    this.#requireAlive();
    return this.#materials.delete(id);
  }

  setPostProcess(settings: PostProcessSettings): void {
    this.#requireAlive();
    if (
      !Number.isFinite(settings.exposure) ||
      settings.exposure < 0 ||
      settings.exposure > 64
    )
      throw new Error("HDR exposure must be finite and in [0, 64].");
    if (!["none", "reinhard", "aces"].includes(settings.toneMapping))
      throw new Error(
        `Unknown tone mapping mode '${String(settings.toneMapping)}'.`,
      );
    for (const [name, value, maximum] of [
      ["Bloom intensity", settings.bloom?.intensity ?? 0, 10],
      ["Bloom threshold", settings.bloom?.threshold ?? 1, 64],
      ["Bloom scatter", settings.bloom?.scatter ?? 0.5, 1],
      ["Saturation", settings.saturation ?? 1, 4],
      ["Contrast", settings.contrast ?? 1, 4],
      ["Vignette", settings.vignette ?? 0, 1],
      ["Chromatic aberration", settings.chromaticAberration ?? 0, 1],
    ] as const)
      if (!Number.isFinite(value) || value < 0 || value > maximum)
        throw new Error(
          `${name} must be finite and in [0, ${String(maximum)}].`,
        );
    this.#postProcess = { ...settings };
  }

  postProcess(): Readonly<PostProcessSettings> {
    return this.#postProcess;
  }

  submitFrame(frame: PackedFrame): void {
    this.#requireReady();
    this.#snapshot = this.#measureFrames([frame]);
  }

  submitLayers(layers: readonly RenderLayerSubmission[]): void {
    this.#requireReady();
    if (layers.length === 0)
      throw new Error("A render submission needs at least one layer.");
    this.#snapshot = this.#measureFrames(layers.map((layer) => layer.frame));
  }

  #measureFrames(frames: readonly PackedFrame[]): HeadlessFrameSnapshot {
    let drawCalls = 0;
    let triangles = 0;
    let instances = 0;
    const meshIds = new Set<string>();
    for (const frame of frames) {
      validateFrame(frame);
      const distinct = new Set<number>();
      for (const meshIndex of frame.meshIndices) {
        if (meshIndex >= frame.meshTable.length) {
          throw new Error(
            `Frame mesh index ${String(meshIndex)} is outside table length ${String(frame.meshTable.length)}.`,
          );
        }
        const id = frame.meshTable[meshIndex]!;
        const mesh = this.#meshes.get(id);
        if (mesh === undefined && !id.startsWith("builtin:"))
          throw new Error(`Frame references missing mesh '${id}'.`);
        distinct.add(meshIndex);
        meshIds.add(id);
        if (mesh !== undefined) triangles += mesh.indices.length / 3;
      }
      for (let index = 0; index < frame.materialIndices.length; index += 1) {
        const materialIndex = frame.materialIndices[index]!;
        if (materialIndex >= frame.materialTable.length)
          throw new Error(
            `Frame material index ${String(materialIndex)} is outside table length ${String(frame.materialTable.length)}.`,
          );
        const id = frame.materialTable[materialIndex]!;
        if (id !== "builtin:default" && !this.#materials.has(id))
          throw new Error(`Frame references missing material '${id}'.`);
      }
      drawCalls += distinct.size;
      instances += frame.meshIndices.length;
    }
    return { drawCalls, triangles, instances, meshIds: [...meshIds] };
  }

  renderFrame(timeMilliseconds: number): RenderStats {
    this.#requireReady();
    const delta =
      this.#lastTime === 0
        ? 1000 / 60
        : Math.max(0.001, timeMilliseconds - this.#lastTime);
    this.#lastTime = timeMilliseconds;
    return {
      fps: 1000 / delta,
      frameTimeMs: delta,
      cpuEncodeMs: 0,
      drawCalls: this.#snapshot.drawCalls,
      triangles: this.#snapshot.triangles,
    };
  }

  snapshot(): HeadlessFrameSnapshot {
    return this.#snapshot;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#initialized = false;
    this.#meshes.clear();
    this.#materials.clear();
    this.#textures.clear();
  }

  #requireAlive(): void {
    if (this.#destroyed) throw new Error("Headless render host is destroyed.");
  }

  #requireReady(): void {
    this.#requireAlive();
    if (!this.#initialized)
      throw new Error("Headless render host is not initialized.");
  }
}

function validateMesh(id: string, mesh: MeshUpload): void {
  if (id.trim() === "")
    throw new Error("A headless mesh needs a non-empty identifier.");
  if (mesh.positions.length === 0 || mesh.positions.length % 3 !== 0)
    throw new Error(`Mesh '${id}' has invalid positions.`);
  if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0)
    throw new Error(`Mesh '${id}' has invalid triangle indices.`);
  const vertexCount = mesh.positions.length / 3;
  const attributes: ReadonlyArray<[string, Float32Array | undefined, number]> =
    [
      ["normals", mesh.normals, 3],
      ["uvs", mesh.uvs, 2],
      ["colors", mesh.colors, 4],
      ["tangents", mesh.tangents, 4],
      ["textureLayers", mesh.textureLayers, 1],
    ];
  for (const [name, values, stride] of attributes) {
    if (values !== undefined && values.length !== vertexCount * stride) {
      throw new Error(
        `Mesh '${id}' ${name} length does not match its ${String(vertexCount)} vertices.`,
      );
    }
  }
  for (const index of mesh.indices)
    if (index >= vertexCount)
      throw new Error(`Mesh '${id}' index ${String(index)} is out of range.`);
}

function validateFrame(frame: PackedFrame): void {
  const count = frame.meshIndices.length;
  if (frame.materialIndices.length !== count)
    throw new Error(
      "Frame material index array length does not match its instances.",
    );
  if (frame.matrices.length !== count * 16)
    throw new Error("Frame matrix array length does not match its instances.");
  if (frame.baseColors.length !== 0 && frame.baseColors.length !== count * 4)
    throw new Error("Frame color array length does not match its instances.");
  if (
    frame.materialParams.length !== 0 &&
    frame.materialParams.length !== count * 4
  )
    throw new Error(
      "Frame material array length does not match its instances.",
    );
  if (frame.camera.length !== 0 && frame.camera.length !== CAMERA_STRIDE)
    throw new Error(`Frame camera requires ${String(CAMERA_STRIDE)} values.`);
  if (
    frame.light.length !== 0 &&
    frame.light.length !== 7 &&
    frame.light.length % LIGHT_STRIDE !== 0
  ) {
    throw new Error(
      `Frame light requires 7 values or a whole number of ${String(LIGHT_STRIDE)}-float lights.`,
    );
  }
  if (
    frame.environment !== undefined &&
    frame.environment.length !== 0 &&
    frame.environment.length !== ENVIRONMENT_STRIDE
  ) {
    throw new Error(
      `Frame environment requires ${String(ENVIRONMENT_STRIDE)} values.`,
    );
  }
  for (const value of [
    frame.matrices,
    frame.baseColors,
    frame.materialParams,
    frame.camera,
    frame.light,
    frame.environment ?? EMPTY,
  ]) {
    for (const number of value)
      if (!Number.isFinite(number))
        throw new Error("Frame contains a non-finite number.");
  }
}

const EMPTY = new Float32Array(0);
