/* tslint:disable */
/* eslint-disable */

/**
 * Browser-facing runtime. Commands are intentionally passed in batches to
 * keep gameplay loops from making fine-grained JS/WASM calls.
 */
export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    apply_commands(json: string): void;
    constructor();
    snapshot_json(): string;
    tick(delta_seconds: number): number;
}

/**
 * Coarse-grained browser boundary for Vapour's native 2D physics world.
 */
export class PhysicsEngine2d {
    free(): void;
    [Symbol.dispose](): void;
    apply_commands(json: string): number;
    body_count(): number;
    cast_shape_json(position: Float32Array, rotation: number, direction: Float32Array, max_distance: number, shape_json: string, layer: number, mask: number, include_sensors: boolean): string;
    move_character_json(timestep: number, position: Float32Array, rotation: number, desired_translation: Float32Array, descriptor_json: string): string;
    constructor(gravity_x: number, gravity_y: number);
    overlap_shape_json(position: Float32Array, rotation: number, shape_json: string, layer: number, mask: number, include_sensors: boolean): string;
    raycast_json(origin: Float32Array, direction: Float32Array, max_distance: number, layer: number, mask: number, include_sensors: boolean): string;
    step_json(timestep: number): string;
}

/**
 * Browser-facing Rust physics world. Commands and results cross once per
 * simulation step; Rapier handles and fine-grained solver calls stay in WASM.
 */
export class PhysicsEngine3d {
    free(): void;
    [Symbol.dispose](): void;
    apply_commands(json: string): number;
    body_count(): number;
    cast_shape_json(position: Float32Array, rotation: Float32Array, direction: Float32Array, max_distance: number, shape_json: string, layer: number, mask: number, include_sensors: boolean): string;
    /**
     * Solver contacts from the last step, for debug rendering. Kept out of
     * `step_json` because a settled pile of crates has thousands of them.
     */
    contacts_json(): string;
    joint_count(): number;
    move_character_json(timestep: number, position: Float32Array, rotation: Float32Array, desired_translation: Float32Array, descriptor_json: string): string;
    constructor(gravity_x: number, gravity_y: number, gravity_z: number);
    overlap_shape_json(position: Float32Array, rotation: Float32Array, shape_json: string, layer: number, mask: number, include_sensors: boolean): string;
    /**
     * `exclude_body` is a body id or `0` for none; passed as a float because
     * wasm-bindgen would otherwise force `BigInt` on every caller.
     */
    raycast_json(origin: Float32Array, direction: Float32Array, max_distance: number, layer: number, mask: number, include_sensors: boolean, exclude_body: number): string;
    step_json(timestep: number): string;
}

/**
 * Rust-owned WebGPU renderer exported to the browser. TypeScript supplies the
 * canvas and animation clock, while all GPU resources and commands stay in
 * Rust/WASM.
 */
export class WebGpuRenderer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    capabilities_json(): string;
    clear_environment(): void;
    clear_particle_system(id: string): void;
    static create(canvas: HTMLCanvasElement, width: number, height: number): Promise<WebGpuRenderer>;
    /**
     * Creates (or replaces) a particle system from a JSON
     * `ParticleSystemDescriptor`.
     */
    create_particle_system(id: string, descriptor_json: string): void;
    /**
     * Creates or resizes a render-to-texture target. A positive `scale`
     * makes it follow the surface at that fraction (reallocating on
     * resize); otherwise `width`/`height` fix its size.
     */
    create_render_target(id: string, width: number, height: number, scale: number): void;
    define_material_json(id: string, json: string): void;
    environment_live(): boolean;
    /**
     * Identifiers currently uploaded, for diagnostics and tests.
     */
    mesh_ids_json(): string;
    /**
     * `ParticleSystemStats` as JSON: `gpu`, `requested`, and — exact on the
     * CPU path, `null` on the GPU path — `alive`, `emitted`, `expired`,
     * `dropped`.
     */
    particle_system_stats_json(id: string): string;
    release_material(id: string): boolean;
    /**
     * Frees a runtime mesh. Returns whether it existed.
     */
    release_mesh(id: string): boolean;
    release_particle_system(id: string): boolean;
    release_render_target(id: string): boolean;
    release_texture(id: string): boolean;
    render(time_seconds: number): string;
    resize(width: number, height: number): void;
    /**
     * Replaces the frame's decals: `DECAL_STRIDE` (28) floats per decal.
     * An empty `atlas_texture_id` means tint-only decals.
     */
    set_decals(atlas_texture_id: string, decals: Float32Array): void;
    /**
     * Captures the submitted frame's procedural sky into the environment
     * map. Explicit and not per-frame: see `SurfaceRenderer::set_environment_from_sky`.
     */
    set_environment_from_sky(intensity: number): void;
    /**
     * Prefers compute frustum culling (the default) or forces the CPU
     * fallback; the frame statistics report which path actually ran.
     */
    set_gpu_culling(enabled: boolean): void;
    /**
     * Whether particle systems created from now on simulate on the GPU
     * (the default) or with the CPU fallback; existing systems keep their
     * path. `particle_system_stats_json` reports which one a system uses.
     */
    set_gpu_particles(enabled: boolean): void;
    /**
     * Configures the scene-referred HDR presentation pass. Tone mapping is
     * 0 none, 1 Reinhard, or 2 ACES.
     */
    set_post_process(exposure: number, tone_mapping: number, bloom_intensity: number, bloom_threshold: number, bloom_scatter: number, saturation: number, contrast: number, vignette: number, chromatic_aberration: number, anti_aliasing: number, debug_view: number): void;
    /**
     * Submits one frame as packed arrays: the path a running game uses.
     *
     * Everything except the small mesh table crosses as typed arrays, so a
     * scene of a thousand instances costs a handful of buffer copies rather
     * than hundreds of kilobytes of JSON per frame.
     */
    set_render_frame(mesh_table_json: string, mesh_indices: Uint32Array, material_table_json: string, material_indices: Uint32Array, matrices: Float32Array, base_colors: Float32Array, material_params: Float32Array, camera: Float32Array, light: Float32Array, environment: Float32Array): void;
    /**
     * Submits several camera layers in one surface acquire/present cycle.
     * Instance arrays are concatenated in layer order and remain typed arrays
     * across the JS/WASM boundary; only the two small identifier tables use
     * JSON. This supports view models, editor overlays, minimaps, and portals
     * without forcing games to own renderer internals.
     */
    set_render_layers(mesh_table_json: string, mesh_indices: Uint32Array, material_table_json: string, material_indices: Uint32Array, matrices: Float32Array, base_colors: Float32Array, material_params: Float32Array, layer_instance_counts: Uint32Array, layer_flags: Uint32Array, cameras: Float32Array, lights: Float32Array, layer_light_counts: Uint32Array, environments: Float32Array, bone_offsets: Float32Array, bone_matrices: Float32Array, layer_targets_json: string, viewports: Float32Array, projections: Float32Array): void;
    set_render_world_json(json: string): void;
    /**
     * Spawns `spawn` particles at the origin and advances the system by
     * `dt` seconds.
     */
    update_particle_system(id: string, dt: number, spawn: number, origin_x: number, origin_y: number, origin_z: number): void;
    /**
     * Replaces the environment map used for image-based lighting with six
     * RGBA8 faces (+X, -X, +Y, -Y, +Z, -Z), each `face_size²` texels.
     */
    upload_environment_cubemap(face_size: number, faces: Uint8Array, srgb: boolean, intensity: number): void;
    /**
     * Uploads or replaces a runtime mesh.
     *
     * Geometry crosses as typed arrays rather than JSON: a meshed voxel chunk
     * is hundreds of kilobytes of floats, and serializing that per edit would
     * dominate the frame. `normals`, `uvs`, and `colors` may be empty, in
     * which case defaults are generated.
     *
     * Replacing an existing identifier keeps its slot, so instances already
     * referencing the mesh show the new geometry on the next frame.
     */
    upload_mesh(id: string, positions: Float32Array, normals: Float32Array, uvs: Float32Array, colors: Float32Array, tangents: Float32Array, texture_layers: Float32Array, indices: Uint32Array): void;
    /**
     * Uploads or replaces a skinned runtime mesh: identical to `upload_mesh`
     * plus one bone index and one bone weight quartet per vertex (flat, 4
     * values each, in vertex order) — the layout `@vapour/engine`'s
     * `skinningMatrices` bone palette is meant to drive per-instance via
     * `set_render_layers`'s `bone_offsets`/`bone_matrices`.
     */
    upload_skinned_mesh(id: string, positions: Float32Array, normals: Float32Array, uvs: Float32Array, colors: Float32Array, tangents: Float32Array, texture_layers: Float32Array, indices: Uint32Array, bone_indices: Uint32Array, bone_weights: Float32Array): void;
    /**
     * Uploads or replaces an uncompressed RGBA8 texture. Import processing
     * happens outside the frame loop; this typed-array baseline also serves
     * procedural atlases and migration adapters without base64 or JSON.
     */
    upload_texture_rgba8(id: string, width: number, height: number, pixels: Uint8Array, srgb: boolean, mipmaps: boolean): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly __wbg_physicsengine2d_free: (a: number, b: number) => void;
    readonly __wbg_physicsengine3d_free: (a: number, b: number) => void;
    readonly __wbg_webgpurenderer_free: (a: number, b: number) => void;
    readonly engine_apply_commands: (a: number, b: number, c: number) => [number, number];
    readonly engine_new: () => number;
    readonly engine_snapshot_json: (a: number) => [number, number, number, number];
    readonly engine_tick: (a: number, b: number) => [number, number, number];
    readonly physicsengine2d_apply_commands: (a: number, b: number, c: number) => [number, number, number];
    readonly physicsengine2d_cast_shape_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number, number];
    readonly physicsengine2d_move_character_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly physicsengine2d_new: (a: number, b: number) => number;
    readonly physicsengine2d_overlap_shape_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly physicsengine2d_raycast_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly physicsengine2d_step_json: (a: number, b: number) => [number, number, number, number];
    readonly physicsengine3d_apply_commands: (a: number, b: number, c: number) => [number, number, number];
    readonly physicsengine3d_cast_shape_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number, number];
    readonly physicsengine3d_contacts_json: (a: number) => [number, number, number, number];
    readonly physicsengine3d_move_character_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly physicsengine3d_new: (a: number, b: number, c: number) => number;
    readonly physicsengine3d_overlap_shape_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly physicsengine3d_raycast_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly physicsengine3d_step_json: (a: number, b: number) => [number, number, number, number];
    readonly webgpurenderer_capabilities_json: (a: number) => [number, number, number, number];
    readonly webgpurenderer_clear_particle_system: (a: number, b: number, c: number) => [number, number];
    readonly webgpurenderer_create: (a: any, b: number, c: number) => any;
    readonly webgpurenderer_create_particle_system: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly webgpurenderer_create_render_target: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly webgpurenderer_define_material_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly webgpurenderer_environment_live: (a: number) => number;
    readonly webgpurenderer_mesh_ids_json: (a: number) => [number, number, number, number];
    readonly webgpurenderer_particle_system_stats_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly webgpurenderer_release_material: (a: number, b: number, c: number) => [number, number, number];
    readonly webgpurenderer_release_mesh: (a: number, b: number, c: number) => [number, number, number];
    readonly webgpurenderer_release_particle_system: (a: number, b: number, c: number) => number;
    readonly webgpurenderer_release_render_target: (a: number, b: number, c: number) => [number, number, number];
    readonly webgpurenderer_release_texture: (a: number, b: number, c: number) => [number, number, number];
    readonly webgpurenderer_render: (a: number, b: number) => [number, number, number, number];
    readonly webgpurenderer_resize: (a: number, b: number, c: number) => void;
    readonly webgpurenderer_set_decals: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly webgpurenderer_set_environment_from_sky: (a: number, b: number) => [number, number];
    readonly webgpurenderer_set_gpu_culling: (a: number, b: number) => void;
    readonly webgpurenderer_set_gpu_particles: (a: number, b: number) => void;
    readonly webgpurenderer_set_post_process: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number];
    readonly webgpurenderer_set_render_frame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number) => [number, number];
    readonly webgpurenderer_set_render_layers: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number, c1: number, d1: number, e1: number, f1: number, g1: number, h1: number, i1: number, j1: number, k1: number) => [number, number];
    readonly webgpurenderer_set_render_world_json: (a: number, b: number, c: number) => [number, number];
    readonly webgpurenderer_update_particle_system: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly webgpurenderer_upload_environment_cubemap: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly webgpurenderer_upload_mesh: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => [number, number];
    readonly webgpurenderer_upload_skinned_mesh: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number) => [number, number];
    readonly webgpurenderer_upload_texture_rgba8: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly physicsengine2d_body_count: (a: number) => number;
    readonly physicsengine3d_body_count: (a: number) => number;
    readonly physicsengine3d_joint_count: (a: number) => number;
    readonly webgpurenderer_clear_environment: (a: number) => void;
    readonly wasm_bindgen_b5d886e581309d04___convert__closures_____invoke___wasm_bindgen_b5d886e581309d04___JsValue__core_f0fd674eaa06beef___result__Result_____wasm_bindgen_b5d886e581309d04___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_b5d886e581309d04___convert__closures_____invoke___wasm_bindgen_b5d886e581309d04___sys__JsNullable_wgpu_159534b247c26f8a___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_f0fd674eaa06beef___result__Result_____wasm_bindgen_b5d886e581309d04___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_b5d886e581309d04___convert__closures_____invoke___wasm_bindgen_b5d886e581309d04___sys__JsNullable_wgpu_159534b247c26f8a___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_f0fd674eaa06beef___result__Result_____wasm_bindgen_b5d886e581309d04___JsError___true__2: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_b5d886e581309d04___convert__closures_____invoke___wasm_bindgen_b5d886e581309d04___sys__JsNullable_wgpu_159534b247c26f8a___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_f0fd674eaa06beef___result__Result_____wasm_bindgen_b5d886e581309d04___JsError___true__3: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_b5d886e581309d04___convert__closures_____invoke___js_sys_ac97b44574e90909___Function_fn_wasm_bindgen_b5d886e581309d04___JsValue_____wasm_bindgen_b5d886e581309d04___sys__Undefined___js_sys_ac97b44574e90909___Function_fn_wasm_bindgen_b5d886e581309d04___JsValue_____wasm_bindgen_b5d886e581309d04___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
