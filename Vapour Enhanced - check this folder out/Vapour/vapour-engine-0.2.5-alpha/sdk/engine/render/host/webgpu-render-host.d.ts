/** The WebGPU render host.
 *
 * Owns the lifecycle of the Rust renderer instance: module loading, canvas
 * surface configuration, resource upload, frame submission, and teardown.
 */
import type { EnvironmentUpload, MaterialUpload, MeshUpload, RenderTargetSize, TextureUpload } from "./uploads.js";
import type { PackedFrame, PostProcessSettings, RenderHost, RenderStats } from "./frame.js";
import type { WasmModuleLoader, RustRenderCapabilities } from "./wasm-contract.js";
import type { GpuParticleDescriptor, GpuParticleHost, GpuParticleHostStats } from "../../particles/gpu-particles.js";
/** Browser presentation host for Vapour's Rust renderer. The DOM owns sizing
 * and animation scheduling; WebGPU objects, shaders, resources, and command
 * encoding remain inside the WASM runtime. */
export declare class WebGpuRenderHost extends EventTarget implements RenderHost, GpuParticleHost {
    #private;
    constructor(canvas: HTMLCanvasElement, options?: {
        readonly moduleUrl?: string;
        readonly loadModule?: WasmModuleLoader;
        /** Upper bound for browser adapter/device creation. Some browser/driver
         * combinations expose `navigator.gpu` but never settle the request. */
        readonly initializationTimeoutMs?: number;
    });
    initialize(): Promise<void>;
    /**
     * Uploads or replaces a runtime mesh under `id`.
     *
     * Safe to call before the renderer initializes: the upload is remembered and
     * replayed once the GPU is ready. Replacing an identifier keeps instances
     * that reference it pointing at the new geometry, which is how a remeshed
     * voxel chunk updates.
     */
    uploadMesh(id: string, mesh: MeshUpload): void;
    /** Frees a runtime mesh. Returns whether it was known here. */
    releaseMesh(id: string): boolean;
    /** Runtime meshes this host has uploaded, in insertion order. */
    meshIds(): readonly string[];
    uploadTexture(id: string, texture: TextureUpload): void;
    releaseTexture(id: string): boolean;
    createRenderTarget(id: string, size: RenderTargetSize): void;
    releaseRenderTarget(id: string): boolean;
    /** GPU particle systems live entirely in the renderer, so they exist only
     * while it does: create them after `initialize()`. `GpuParticleSystem`
     * falls back to a CPU emitter when this reports false. */
    supportsGpuParticles(): boolean;
    createParticleSystem(id: string, descriptor: GpuParticleDescriptor): void;
    updateParticleSystem(id: string, deltaSeconds: number, spawn: number, origin: readonly [number, number, number]): void;
    clearParticleSystem(id: string): void;
    releaseParticleSystem(id: string): boolean;
    particleSystemStats(id: string): GpuParticleHostStats | undefined;
    /** Prefers GPU simulation for particle systems created from now on. */
    setGpuParticles(enabled: boolean): void;
    defineMaterial(id: string, material: MaterialUpload): void;
    releaseMaterial(id: string): boolean;
    uploadEnvironment(environment: EnvironmentUpload): void;
    deriveEnvironmentFromSky(intensity?: number): void;
    clearEnvironment(): void;
    submitDecals(decals: Float32Array, atlasTexture?: string): void;
    capabilities(): RustRenderCapabilities;
    /** Starts a self-driven animation loop. The editor uses this; a running game
     * drives frames itself so simulation happens before rendering. */
    start(): void;
    get initialized(): boolean;
    /** Configures final HDR exposure and tone mapping. Safe before initialize. */
    setPostProcess(settings: PostProcessSettings): void;
    postProcess(): Readonly<PostProcessSettings>;
    /** Prefers compute frustum culling (the default) or forces the CPU
     * fallback. The renderer still needs `capabilities().gpuCulling` for the
     * compute path; each frame's `RenderStats.culling` says which one ran. */
    setGpuCulling(enabled: boolean): void;
    gpuCulling(): boolean;
    /**
     * Submits one frame as packed arrays, bypassing the authored-scene path.
     *
     * This is what a running game uses: nothing but the small mesh table is
     * serialized, so a scene of thousands of instances costs a few buffer copies
     * rather than restating every matrix as JSON.
     */
    submitFrame(frame: PackedFrame): void;
    /** Submits several camera layers atomically for one acquire/present cycle. */
    submitLayers(layers: readonly RenderLayerSubmission[]): void;
    /**
     * Renders one frame under external control and returns its statistics.
     *
     * Returns `undefined` once the renderer has failed, so a game loop can stop
     * cleanly instead of throwing every frame.
     */
    renderFrame(nowMilliseconds: number): RenderStats | undefined;
    setScene(scene: SceneData): void;
    /** Overrides the snapshot camera with an editor-owned viewpoint.
     *
     * The Scene view navigates with the editor camera while the Game view falls
     * back to the authored `vapour.Camera`, and neither path mutates the other:
     * pass `undefined` to return to the scene's own camera. */
    setViewer(camera: RenderCameraSnapshot | undefined): void;
    /** The snapshot most recently submitted to the renderer, camera override
     * applied. Editor tooling reads this to frame or pick against exactly what
     * is on screen. */
    snapshot(): RenderWorldSnapshot | undefined;
    stop(): void;
    destroy(): void;
    /** True once the Rust renderer has thrown and can no longer be called. */
    get failed(): boolean;
    /** Pins the drawing buffer to an exact pixel size — an XR eye layout —
     * instead of following the canvas's CSS size. `undefined` restores
     * CSS-driven sizing. */
    setFixedSize(width: number, height: number): void;
    setFixedSize(width: undefined): void;
}
import { type RenderCameraSnapshot, type RenderWorldSnapshot } from "../render-world.js";
import type { SceneData } from "../../core/scene-document.js";
import { type RenderLayerSubmission } from "../render-layers.js";
//# sourceMappingURL=webgpu-render-host.d.ts.map