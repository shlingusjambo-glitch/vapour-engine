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
