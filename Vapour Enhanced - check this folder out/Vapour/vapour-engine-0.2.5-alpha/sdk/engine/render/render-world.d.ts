import { type SceneData, type SceneEntityData } from "../core/scene-document.js";
export declare const RENDER_WORLD_VERSION: 1;
export interface RenderWorldSnapshot {
    readonly version: typeof RENDER_WORLD_VERSION;
    readonly camera?: RenderCameraSnapshot;
    readonly directionalLight?: RenderDirectionalLightSnapshot;
    readonly instances: readonly RenderInstanceSnapshot[];
}
export interface RenderCameraSnapshot {
    readonly entityId: string;
    readonly worldMatrix: readonly number[];
    readonly fieldOfView: number;
    readonly projection?: "perspective" | "orthographic";
    readonly orthographicSize?: number;
    readonly near: number;
    readonly far: number;
}
export interface RenderDirectionalLightSnapshot {
    readonly entityId: string;
    readonly worldMatrix: readonly number[];
    readonly color: readonly [number, number, number];
    readonly intensity: number;
}
export interface RenderInstanceSnapshot {
    readonly entityId: string;
    /** A mesh identifier from the shared mesh library. */
    readonly mesh: string;
    readonly material: string;
    readonly modelMatrix: readonly number[];
    readonly baseColor: readonly [number, number, number, number];
    /** `[metallic, roughness, emissive strength, alpha cutoff]`, packed to match
     * the single vertex attribute the renderer reads them from. */
    readonly materialParams: readonly [number, number, number, number];
}
/**
 * World matrices for every entity in the scene, keyed by entity ID.
 *
 * Editor tooling needs the world placement of entities the renderer never
 * draws — an empty group, a camera, a light — so gizmos and framing share this
 * one resolver with the render extraction rather than reimplementing it.
 */
export declare function computeWorldMatrices(scene: SceneData): Map<string, number[]>;
export declare function extractRenderWorld(scene: SceneData): RenderWorldSnapshot;
/** One entity's contribution to a render world. */
export interface RenderEntityContribution {
    readonly instances: readonly RenderInstanceSnapshot[];
    readonly camera?: RenderCameraSnapshot;
    readonly directionalLight?: RenderDirectionalLightSnapshot;
}
/**
 * Extracts what a single entity contributes to the render world, given its
 * already-resolved world matrix.
 *
 * Factored out of {@link extractRenderWorld} so that the incremental extractor
 * can recompute exactly the entities that changed and reuse the rest. Both
 * paths must produce identical output, which is only guaranteed if there is one
 * implementation of the per-entity rules.
 */
export declare function extractEntityContribution(entity: SceneEntityData, matrix: readonly number[]): RenderEntityContribution;
//# sourceMappingURL=render-world.d.ts.map