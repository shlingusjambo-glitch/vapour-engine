/** The presentation contract: packed frames, render statistics, and the
 * `RenderHost` interface that both the WebGPU and headless hosts implement.
 */
import type { EnvironmentUpload, MeshUpload, MaterialUpload, RenderTargetSize, TextureUpload } from "./uploads.js";
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
    /** Edge-aware post-process AA. FXAA is the stable default until motion-vector TAA is available. */
    readonly antiAliasing?: "none" | "fxaa";
    /** Final presentation or an HDR inspection view useful while lighting scenes. */
    readonly debugView?: "final" | "luminance" | "false-color";
}
export interface RenderStats {
    fps: number;
    frameTimeMs: number;
    cpuEncodeMs: number;
    drawCalls: number;
    triangles: number;
    /** Which frustum-culling path the renderer ran this frame; absent from
     * hosts that never cull. */
    culling?: "gpu" | "cpu";
    /** Instances the CPU culling path dropped; unknown on the GPU path. */
    culledInstances?: number;
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
    /** One entry per instance: that instance's index into `boneMatrices`
     * (in bones, not floats), or a negative value if it is not skinned. Empty
     * means no instance in this frame is skinned. */
    readonly boneOffsets?: Float32Array;
    /** This frame's skinned instances' bone palettes, concatenated — 16
     * column-major floats per bone. Build with `packBonePalette` from
     * `@vapour/engine`'s `skinningMatrices` output. */
    readonly boneMatrices?: Float32Array;
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
    /** Replaces the image-based-lighting environment. Safe before initialize.
     * Optional on the contract so minimal test hosts stay small; both shipped
     * hosts implement it. */
    uploadEnvironment?(environment: EnvironmentUpload): void;
    /** Captures the most recently submitted frame's procedural sky as the
     * environment. Deliberately explicit rather than automatic: the capture
     * and convolution cost several dozen small passes, so a day/night cycle
     * should call it at a cadence it chooses, not every frame. */
    deriveEnvironmentFromSky?(intensity?: number): void;
    clearEnvironment?(): void;
    /** Replaces the decal set projected onto the first layer's opaque depth.
     * `decals` is `packDecals` output; `atlasTexture` names an uploaded texture
     * the regions address, or undefined for tint-only decals. The set persists
     * until replaced. */
    submitDecals?(decals: Float32Array, atlasTexture?: string): void;
    /** Creates (or resizes) a render target that layers can draw into via
     * `RenderLayerOptions.target` and materials can sample as a texture. */
    createRenderTarget?(id: string, size: RenderTargetSize): void;
    releaseRenderTarget?(id: string): boolean;
    submitFrame(frame: PackedFrame): void;
    submitLayers(layers: readonly RenderLayerSubmission[]): void;
    renderFrame(timeMilliseconds: number): RenderStats | undefined;
    destroy(): void;
}
//# sourceMappingURL=frame.d.ts.map