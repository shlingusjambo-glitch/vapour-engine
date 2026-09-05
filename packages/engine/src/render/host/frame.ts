/** The presentation contract: packed frames, render statistics, and the
 * `RenderHost` interface that both the WebGPU and headless hosts implement.
 */
import type { MeshUpload, MaterialUpload, TextureUpload } from "./uploads.js";
import type { RustRenderCapabilities } from "./wasm-contract.js";
import type { RenderLayerSubmission } from "../render-layers.js";

export interface PostProcessSettings {
  /** Linear multiplier applied before tone mapping. */
  readonly exposure: number;
  readonly toneMapping: "none" | "reinhard" | "aces";
  readonly bloom?: {
    readonly intensity?: number;
    readonly threshold?: number;
    readonly scatter?: number;
  };
  readonly saturation?: number;
  readonly contrast?: number;
  readonly vignette?: number;
  readonly chromaticAberration?: number;
}

export interface RenderStats {
  fps: number;
  frameTimeMs: number;
  cpuEncodeMs: number;
  drawCalls: number;
  triangles: number;
}

/** One frame's instances and view, already packed for the WASM boundary. */
export interface PackedFrame {
  /** Distinct mesh identifiers; one entry per mesh, not per instance. */
  readonly meshTable: readonly string[];
  /** One entry per instance, indexing `meshTable`. */
  readonly meshIndices: Uint32Array;
  /** Distinct material identifiers. `builtin:default` is always available. */
  readonly materialTable: readonly string[];
  /** One entry per instance, indexing `materialTable`. */
  readonly materialIndices: Uint32Array;
  /** 16 column-major floats per instance. */
  readonly matrices: Float32Array;
  /** 4 floats per instance, or empty for opaque white. */
  readonly baseColors: Float32Array;
  /** 4 floats per instance, or empty for the default surface. */
  readonly materialParams: Float32Array;
  /** 16 matrix floats then field of view, near, far. */
  readonly camera: Float32Array;
  /** The frame's lights. Either the original seven floats — 3 direction, 3
   * colour, intensity — or a whole number of 16-float packed light records;
   * see `LightRig`. Empty means the renderer's default rig. */
  readonly light: Float32Array;
  /** Three aligned vec4 lanes: clear RGBA, fog RGB/mode, and fog parameters.
   * Empty uses the renderer's default environment. */
  readonly environment?: Float32Array;
}

/** Presentation boundary used by a running game.
 *
 * The WebGPU browser host and the explicit headless host both implement this
 * contract. Keeping it in the runtime package means game loops, migration
 * adapters, capture tools, dedicated servers, and tests can share the same
 * frame producer without depending on a concrete renderer implementation. */
export interface RenderHost {
  readonly initialized: boolean;
  initialize(): Promise<void>;
  uploadMesh(id: string, mesh: MeshUpload): void;
  releaseMesh(id: string): boolean;
  uploadTexture(id: string, texture: TextureUpload): void;
  releaseTexture(id: string): boolean;
  defineMaterial(id: string, material: MaterialUpload): void;
  releaseMaterial(id: string): boolean;
  setPostProcess(settings: PostProcessSettings): void;
  postProcess(): Readonly<PostProcessSettings>;
  submitFrame(frame: PackedFrame): void;
  submitLayers(layers: readonly RenderLayerSubmission[]): void;
  renderFrame(timeMilliseconds: number): RenderStats | undefined;
  destroy(): void;
}
