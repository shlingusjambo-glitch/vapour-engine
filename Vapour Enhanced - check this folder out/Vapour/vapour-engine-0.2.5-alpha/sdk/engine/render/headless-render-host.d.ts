import { type EnvironmentUpload, type MaterialUpload, type RenderTargetSize, type MeshUpload, type PackedFrame, type PostProcessSettings, type RenderHost, type RenderStats, type TextureUpload } from "./host/index.js";
import { type RenderLayerSubmission } from "./render-layers.js";
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
export declare class HeadlessRenderHost extends EventTarget implements RenderHost {
    #private;
    get initialized(): boolean;
    initialize(): Promise<void>;
    uploadMesh(id: string, mesh: MeshUpload): void;
    releaseMesh(id: string): boolean;
    meshIds(): readonly string[];
    uploadTexture(id: string, texture: TextureUpload): void;
    releaseTexture(id: string): boolean;
    createRenderTarget(id: string, size: RenderTargetSize): void;
    releaseRenderTarget(id: string): boolean;
    renderTargetIds(): readonly string[];
    defineMaterial(id: string, material: MaterialUpload): void;
    releaseMaterial(id: string): boolean;
    uploadEnvironment(environment: EnvironmentUpload): void;
    deriveEnvironmentFromSky(intensity?: number): void;
    clearEnvironment(): void;
    submitDecals(decals: Float32Array, atlasTexture?: string): void;
    decalCount(): number;
    /** What lights the scene's ambient term: an uploaded map, the captured
     * sky, or nothing (the analytic gradient). */
    environment(): EnvironmentUpload | "sky" | undefined;
    setPostProcess(settings: PostProcessSettings): void;
    postProcess(): Readonly<PostProcessSettings>;
    submitFrame(frame: PackedFrame): void;
    submitLayers(layers: readonly RenderLayerSubmission[]): void;
    renderFrame(timeMilliseconds: number): RenderStats;
    snapshot(): HeadlessFrameSnapshot;
    destroy(): void;
}
//# sourceMappingURL=headless-render-host.d.ts.map