import type { PackedFrame } from "../render/host/index.js";
import { LightRig } from "../render/lights.js";
import {
  ENVIRONMENT_STRIDE,
  packEnvironment,
  type EnvironmentSettings,
} from "../render/environment.js";

export interface DrawOptions {
  /** Linear RGBA tint multiplied into the material. Defaults to opaque white. */
  readonly color?: readonly [number, number, number, number];
  readonly metallic?: number;
  readonly roughness?: number;
  /** Emission strength; the glow takes the instance's own colour. */
  readonly emissive?: number;
  readonly alphaCutoff?: number;
  /** Stable standard-material asset identifier. */
  readonly material?: string;
  /** Skinning matrices for a mesh uploaded with `boneIndices`/`boneWeights`:
   * 16 column-major floats per bone, as produced by `skinningMatrices`. */
  readonly bones?: Float32Array;
}

const MATRIX_STRIDE = 16;
export const CAMERA_STRIDE = 20;
const VECTOR4_STRIDE = 4;
const DEFAULT_COLOR: readonly [number, number, number, number] = [1, 1, 1, 1];
const DEFAULT_METALLIC = 0;
const DEFAULT_ROUGHNESS = 0.6;
const DEFAULT_EMISSIVE = 0;
const DEFAULT_ALPHA_CUTOFF = 0.01;

/**
 * Accumulates one frame's draws into packed arrays.
 *
 * A game calls `draw` once per visible object per frame, which for a streaming
 * voxel world is hundreds to thousands of calls. The builder is therefore
 * written to allocate nothing in steady state: buffers grow by doubling and are
 * then reused frame after frame, and `reset` only moves a cursor. That matters
 * because a garbage collection pause during gameplay is a visible stutter.
 *
 * Mesh identifiers are interned into a small table so the only text crossing
 * into WebAssembly is one entry per distinct mesh, not one per instance.
 */
export class FrameBuilder {
  #meshTable: string[] = [];
  #meshLookup = new Map<string, number>();
  #meshIndices: Uint32Array;
  #materialTable: string[] = [DEFAULT_MATERIAL];
  #materialLookup = new Map<string, number>([[DEFAULT_MATERIAL, 0]]);
  #materialIndices: Uint32Array;
  #matrices: Float32Array;
  #baseColors: Float32Array;
  #materialParams: Float32Array;
  #camera = new Float32Array(CAMERA_STRIDE);
  #light = new Float32Array(7);
  #lights = new LightRig();
  #environment = new Float32Array(ENVIRONMENT_STRIDE);
  #count = 0;
  #hasCamera = false;
  #hasLight = false;
  #hasEnvironment = false;

  constructor(initialCapacity = 256) {
    if (!Number.isInteger(initialCapacity) || initialCapacity < 1) {
      throw new Error("Frame builder capacity must be a positive integer.");
    }
    this.#meshIndices = new Uint32Array(initialCapacity);
    this.#materialIndices = new Uint32Array(initialCapacity);
    this.#matrices = new Float32Array(initialCapacity * MATRIX_STRIDE);
    this.#baseColors = new Float32Array(initialCapacity * VECTOR4_STRIDE);
    this.#materialParams = new Float32Array(initialCapacity * VECTOR4_STRIDE);
  }

  /** Instances recorded so far this frame. */
  get drawCount(): number {
    return this.#count;
  }

  /** How many instances fit before the next growth. */
  get capacity(): number {
    return this.#meshIndices.length;
  }

  /** Begins a new frame. Retains buffers; only the cursor moves. */
  /** Skinned instances this frame: [instance index, bone palette]. */
  #skinned: [number, Float32Array][] = [];
  reset(): void {
    this.#count = 0;
    this.#skinned.length = 0;
    this.#meshTable.length = 0;
    this.#meshLookup.clear();
    this.#materialTable.length = 1;
    this.#materialTable[0] = DEFAULT_MATERIAL;
    this.#materialLookup.clear();
    this.#materialLookup.set(DEFAULT_MATERIAL, 0);
    this.#hasCamera = false;
    this.#hasLight = false;
    this.#lights.reset();
    this.#hasEnvironment = false;
  }

  /**
   * Records one instance.
   *
   * `matrix` is 16 column-major floats, the same layout the renderer uses. It
   * is copied immediately, so the caller is free to reuse a scratch matrix.
   */
  draw(meshId: string, matrix: ArrayLike<number>, options?: DrawOptions): void {
    if (meshId === "") throw new Error("A draw needs a mesh identifier.");
    if (matrix.length !== MATRIX_STRIDE) {
      throw new Error(
        `A model matrix needs ${String(MATRIX_STRIDE)} values, received ${String(matrix.length)}.`,
      );
    }
    if (this.#count === this.#meshIndices.length) this.#grow();

    const index = this.#count;
    this.#meshIndices[index] = this.#internMesh(meshId);
    this.#materialIndices[index] = this.#internMaterial(
      options?.material ?? DEFAULT_MATERIAL,
    );
    const matrixOffset = index * MATRIX_STRIDE;
    for (let element = 0; element < MATRIX_STRIDE; element += 1) {
      this.#matrices[matrixOffset + element] = matrix[element]!;
    }

    const vectorOffset = index * VECTOR4_STRIDE;
    const color = options?.color ?? DEFAULT_COLOR;
    this.#baseColors[vectorOffset] = color[0];
    this.#baseColors[vectorOffset + 1] = color[1];
    this.#baseColors[vectorOffset + 2] = color[2];
    this.#baseColors[vectorOffset + 3] = color[3];

    this.#materialParams[vectorOffset] = options?.metallic ?? DEFAULT_METALLIC;
    this.#materialParams[vectorOffset + 1] =
      options?.roughness ?? DEFAULT_ROUGHNESS;
    this.#materialParams[vectorOffset + 2] =
      options?.emissive ?? DEFAULT_EMISSIVE;
    this.#materialParams[vectorOffset + 3] =
      options?.alphaCutoff ?? DEFAULT_ALPHA_CUTOFF;

    this.#count = index + 1;
    // Skinned draw: keep this instance's bone palette (16 floats per bone).
    if (options?.bones !== undefined && options.bones.length > 0) {
      if (options.bones.length % 16 !== 0)
        throw new Error(
          `A bone palette needs 16 floats per bone, received ${String(options.bones.length)}.`,
        );
      this.#skinned.push([index, options.bones]);
    }
  }

  /** Sets the view for this frame. `worldMatrix` is the camera's transform;
   * the renderer looks down its -Z. */
  setCamera(
    worldMatrix: ArrayLike<number>,
    fieldOfViewDegrees: number,
    near: number,
    far: number,
  ): void {
    if (worldMatrix.length !== MATRIX_STRIDE) {
      throw new Error(
        `A camera matrix needs ${String(MATRIX_STRIDE)} values, received ${String(worldMatrix.length)}.`,
      );
    }
    if (!(near > 0) || !(far > near)) {
      throw new Error(
        `Camera planes must satisfy 0 < near < far; received near ${String(near)}, far ${String(far)}.`,
      );
    }
    for (let element = 0; element < MATRIX_STRIDE; element += 1) {
      this.#camera[element] = worldMatrix[element]!;
    }
    this.#camera[16] = 0;
    this.#camera[17] = fieldOfViewDegrees;
    this.#camera[18] = near;
    this.#camera[19] = far;
    this.#hasCamera = true;
  }

  /** Sets a true orthographic view. `verticalSize` is the visible world-space
   * height; horizontal size follows the render target aspect ratio. */
  setOrthographicCamera(worldMatrix: ArrayLike<number>, verticalSize: number, near: number, far: number): void {
    if (worldMatrix.length !== MATRIX_STRIDE) throw new Error(`A camera matrix needs ${String(MATRIX_STRIDE)} values, received ${String(worldMatrix.length)}.`);
    if (!Number.isFinite(verticalSize) || verticalSize <= 0) throw new Error("Orthographic camera verticalSize must be finite and positive.");
    if (!(near > 0) || !(far > near)) throw new Error(`Camera planes must satisfy 0 < near < far; received near ${String(near)}, far ${String(far)}.`);
    for (let element = 0; element < MATRIX_STRIDE; element++) this.#camera[element] = worldMatrix[element]!;
    this.#camera[16] = 1;
    this.#camera[17] = verticalSize;
    this.#camera[18] = near;
    this.#camera[19] = far;
    this.#hasCamera = true;
  }

  /**
   * This frame's light rig.
   *
   * Add as many lights as the scene needs — ambient, hemisphere, directional,
   * point, and spot. Anything added here takes precedence over [`setLight`],
   * which remains as shorthand for the single-directional case.
   */
  get lights(): LightRig {
    return this.#lights;
  }

  /** Shorthand for a scene lit by one directional light. Equivalent to
   * clearing the rig and adding a single directional entry. */
  setLight(
    direction: readonly [number, number, number],
    color: readonly [number, number, number],
    intensity: number,
  ): void {
    this.#light[0] = direction[0];
    this.#light[1] = direction[1];
    this.#light[2] = direction[2];
    this.#light[3] = color[0];
    this.#light[4] = color[1];
    this.#light[5] = color[2];
    this.#light[6] = intensity;
    this.#hasLight = true;
  }

  /** Sets the presentation clear colour and optional distance fog. */
  setEnvironment(settings: EnvironmentSettings): void {
    packEnvironment(settings, this.#environment);
    this.#hasEnvironment = true;
  }

  /**
   * The packed frame, as views over the builder's own buffers.
   *
   * The arrays are only valid until the next `reset`; the renderer copies them
   * during submission, so nothing outlives the call.
   */
  pack(): PackedFrame {
    return {
      meshTable: this.#meshTable,
      meshIndices: this.#meshIndices.subarray(0, this.#count),
      materialTable: this.#materialTable,
      materialIndices: this.#materialIndices.subarray(0, this.#count),
      matrices: this.#matrices.subarray(0, this.#count * MATRIX_STRIDE),
      baseColors: this.#baseColors.subarray(0, this.#count * VECTOR4_STRIDE),
      materialParams: this.#materialParams.subarray(
        0,
        this.#count * VECTOR4_STRIDE,
      ),
      // An empty camera or light means "use the renderer's default", which is
      // what a game that has not set one yet should get.
      camera: this.#hasCamera ? this.#camera : EMPTY,
      light: this.#packLight(),
      environment: this.#hasEnvironment ? this.#environment : EMPTY,
      ...this.#packBones(),
    };
  }

  /** Per-instance palette offsets (in bones) and the concatenated palettes. */
  #packBones(): { boneOffsets?: Float32Array; boneMatrices?: Float32Array } {
    if (this.#skinned.length === 0) return {};
    const offsets = new Float32Array(this.#count).fill(-1);
    let total = 0;
    for (const [, palette] of this.#skinned) total += palette.length;
    const matrices = new Float32Array(total);
    let cursor = 0;
    for (const [index, palette] of this.#skinned) {
      offsets[index] = cursor / 16;
      matrices.set(palette, cursor);
      cursor += palette.length;
    }
    return { boneOffsets: offsets, boneMatrices: matrices };
  }

  #packLight(): Float32Array {
    // A rig always wins: a caller that added lights meant those, not a
    // directional light left over from an earlier `setLight`.
    if (this.#lights.count > 0) return this.#lights.pack();
    return this.#hasLight ? this.#light : EMPTY;
  }

  #internMesh(meshId: string): number {
    const existing = this.#meshLookup.get(meshId);
    if (existing !== undefined) return existing;
    const index = this.#meshTable.length;
    this.#meshTable.push(meshId);
    this.#meshLookup.set(meshId, index);
    return index;
  }

  #internMaterial(materialId: string): number {
    if (materialId.trim() === "")
      throw new Error("A draw material needs a non-empty identifier.");
    const existing = this.#materialLookup.get(materialId);
    if (existing !== undefined) return existing;
    const index = this.#materialTable.length;
    this.#materialTable.push(materialId);
    this.#materialLookup.set(materialId, index);
    return index;
  }

  #grow(): void {
    const capacity = this.#meshIndices.length * 2;
    this.#meshIndices = growUint32(this.#meshIndices, capacity);
    this.#materialIndices = growUint32(this.#materialIndices, capacity);
    this.#matrices = growFloat32(this.#matrices, capacity * MATRIX_STRIDE);
    this.#baseColors = growFloat32(this.#baseColors, capacity * VECTOR4_STRIDE);
    this.#materialParams = growFloat32(
      this.#materialParams,
      capacity * VECTOR4_STRIDE,
    );
  }
}

const EMPTY = new Float32Array(0);
const DEFAULT_MATERIAL = "builtin:default";

function growFloat32(source: Float32Array, length: number): Float32Array {
  const grown = new Float32Array(length);
  grown.set(source);
  return grown;
}

function growUint32(source: Uint32Array, length: number): Uint32Array {
  const grown = new Uint32Array(length);
  grown.set(source);
  return grown;
}

/**
 * Builds a column-major transform matrix into `target`, allocating nothing.
 *
 * Game code composes a matrix per object per frame; a helper that returns a new
 * array would allocate thousands of times a second.
 */
export function composeMatrix(
  target: Float32Array,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number, number],
  scale: readonly [number, number, number],
): Float32Array {
  if (target.length < MATRIX_STRIDE)
    throw new Error("A matrix target needs 16 elements.");
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  target[0] = (1 - (yy + zz)) * sx;
  target[1] = (xy + wz) * sx;
  target[2] = (xz - wy) * sx;
  target[3] = 0;
  target[4] = (xy - wz) * sy;
  target[5] = (1 - (xx + zz)) * sy;
  target[6] = (yz + wx) * sy;
  target[7] = 0;
  target[8] = (xz + wy) * sz;
  target[9] = (yz - wx) * sz;
  target[10] = (1 - (xx + yy)) * sz;
  target[11] = 0;
  target[12] = position[0];
  target[13] = position[1];
  target[14] = position[2];
  target[15] = 1;
  return target;
}

/** Translation-only transform: the common case for voxel chunks and tiles. */
export function composeTranslation(
  target: Float32Array,
  x: number,
  y: number,
  z: number,
  scale = 1,
): Float32Array {
  if (target.length < MATRIX_STRIDE)
    throw new Error("A matrix target needs 16 elements.");
  target.fill(0, 0, MATRIX_STRIDE);
  target[0] = scale;
  target[5] = scale;
  target[10] = scale;
  target[12] = x;
  target[13] = y;
  target[14] = z;
  target[15] = 1;
  return target;
}
