/** The TypeScript side of the Rust renderer's FFI contract.
 *
 * These declarations describe exactly what `vapour-wasm` exports. They are the
 * only place in the engine that knows the shape of the WASM boundary, so a
 * change on the Rust side surfaces here as a type error rather than as a
 * runtime failure somewhere inside the host.
 */

export interface RustRenderCapabilities {
  readonly tier: "baseline" | "enhanced" | "highEnd";
  readonly adapterName: string;
  readonly backend: string;
  readonly timestampQueries: boolean;
  readonly multiDrawIndirect: boolean;
  readonly indirectFirstInstance: boolean;
  /** Frustum culling can run as a compute pass (needs indirect-first-instance). */
  readonly gpuCulling: boolean;
  readonly shaderF16: boolean;
  readonly textureCompression: "none" | "etc2" | "bc" | "astc";
  readonly maxTextureDimension2d: number;
  readonly maxBindGroups: number;
  readonly maxStorageBuffersPerShaderStage: number;
}

export interface RustFrameStats {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly cpuEncodeMs: number;
  /** Whether frustum culling ran as a compute pass this frame. */
  readonly gpuCulling: boolean;
  /** Instances the CPU fallback dropped; `null` on the GPU path. */
  readonly culledInstances: number | null;
}

export interface RustRenderer {
  resize(width: number, height: number): void;
  set_post_process?(
    exposure: number,
    toneMapping: number,
    bloomIntensity: number,
    bloomThreshold: number,
    bloomScatter: number,
    saturation: number,
    contrast: number,
    vignette: number,
    chromaticAberration: number,
    antiAliasing: number,
    debugView: number,
  ): void;
  set_render_world_json(json: string): void;
  render(timeSeconds: number): string;
  capabilities_json(): string;
  /** Prefer compute culling (default) or force the CPU fallback. */
  set_gpu_culling?(enabled: boolean): void;
  upload_mesh(
    id: string,
    positions: Float32Array,
    normals: Float32Array,
    uvs: Float32Array,
    colors: Float32Array,
    tangents: Float32Array,
    textureLayers: Float32Array,
    indices: Uint32Array,
  ): void;
  release_mesh(id: string): boolean;
  mesh_ids_json(): string;
  upload_texture_rgba8(
    id: string,
    width: number,
    height: number,
    pixels: Uint8Array,
    srgb: boolean,
    mipmaps: boolean,
  ): void;
  release_texture(id: string): boolean;
  /** Six RGBA8 faces, `faceSize² * 4 * 6` bytes, for image-based lighting. */
  upload_environment_cubemap?(
    faceSize: number,
    faces: Uint8Array,
    srgb: boolean,
    intensity: number,
  ): void;
  set_environment_from_sky?(intensity: number): void;
  /** 28 floats per decal (see `packDecals`); an empty atlas id means tint-only. */
  set_decals?(atlasTextureId: string, decals: Float32Array): void;
  clear_environment?(): void;
  environment_live?(): boolean;
  define_material_json(id: string, json: string): void;
  release_material(id: string): boolean;
  set_render_frame(
    meshTableJson: string,
    meshIndices: Uint32Array,
    materialTableJson: string,
    materialIndices: Uint32Array,
    matrices: Float32Array,
    baseColors: Float32Array,
    materialParams: Float32Array,
    camera: Float32Array,
    light: Float32Array,
    environment: Float32Array,
  ): void;
  set_render_layers(
    meshTableJson: string,
    meshIndices: Uint32Array,
    materialTableJson: string,
    materialIndices: Uint32Array,
    matrices: Float32Array,
    baseColors: Float32Array,
    materialParams: Float32Array,
    layerInstanceCounts: Uint32Array,
    layerFlags: Uint32Array,
    cameras: Float32Array,
    lights: Float32Array,
    layerLightCounts: Uint32Array,
    environments: Float32Array,
    /** Per-instance offset into `boneMatrices`, or empty if nothing is skinned. */
    boneOffsets: Float32Array,
    /** Every skinned instance's bone palette this frame, 16 floats per bone. */
    boneMatrices: Float32Array,
    /** JSON array of one render-target id per layer ("" = surface), or "". */
    layerTargetsJson: string,
    /** Four values per layer, or empty. */
    viewports: Float32Array,
    /** Sixteen values per layer with the projection flag, or empty. */
    projections: Float32Array,
  ): void;
  /** `scale > 0` follows the surface at that fraction; otherwise fixed. */
  create_render_target?(id: string, width: number, height: number, scale: number): void;
  release_render_target?(id: string): boolean;
  /** GPU particles (M113). Absent from builds that predate them. */
  set_gpu_particles?(enabled: boolean): void;
  create_particle_system?(id: string, descriptorJson: string): void;
  update_particle_system?(id: string, dt: number, spawn: number, x: number, y: number, z: number): void;
  clear_particle_system?(id: string): void;
  release_particle_system?(id: string): boolean;
  particle_system_stats_json?(id: string): string;
  /** Uploads a skinned mesh: `upload_mesh` plus 4 bone indices/weights per vertex. */
  upload_skinned_mesh(
    id: string,
    positions: Float32Array,
    normals: Float32Array,
    uvs: Float32Array,
    colors: Float32Array,
    tangents: Float32Array,
    textureLayers: Float32Array,
    indices: Uint32Array,
    boneIndices: Uint32Array,
    boneWeights: Float32Array,
  ): void;
  free(): void;
}

export interface RustRendererConstructor {
  create(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ): Promise<RustRenderer>;
}

export interface VapourWasmModule {
  default(
    moduleOrPath?: WebAssembly.Module | URL | RequestInfo,
  ): Promise<unknown>;
  WebGpuRenderer: RustRendererConstructor;
}

export type WasmModuleLoader = (moduleUrl: string) => Promise<VapourWasmModule>;

export const defaultModuleLoader: WasmModuleLoader = async (moduleUrl) =>
  (await import(/* @vite-ignore */ moduleUrl)) as VapourWasmModule;
