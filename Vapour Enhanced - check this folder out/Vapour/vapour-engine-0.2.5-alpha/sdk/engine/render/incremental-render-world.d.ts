/** Incremental render-world extraction.
 *
 * `extractRenderWorld` rebuilds everything every frame: it revalidates the
 * scene, resolves every world matrix through a chain of matrix multiplies, and
 * allocates a fresh snapshot object per instance. For a demo that is fine. For
 * ten thousand objects it is the single largest cost in the frame, and almost
 * all of it is recomputing values that did not change — a static building does
 * not need its world matrix rebuilt sixty times a second.
 *
 * This extractor keeps the previous frame's results and recomputes only what
 * changed. Both paths call the same {@link extractEntityContribution}, so the
 * incremental output is identical to the full one; the tests assert that
 * equivalence directly rather than trusting it.
 *
 * Change detection is by **content**, not by object identity: `SceneDocument`
 * mutates entity objects in place, so a reference comparison would silently
 * miss edits. Each entity's render-relevant fields are captured in a compact
 * numeric signature and compared element-wise, which is far cheaper than the
 * matrix chain and allocations it avoids.
 */
import { type SceneData, type SceneDocument } from "../core/scene-document.js";
import { type RenderWorldSnapshot } from "./render-world.js";
export interface IncrementalExtractStats {
    /** Entities examined this frame. */
    readonly entities: number;
    /** Entities whose contribution was recomputed. */
    readonly recomputed: number;
    /** Entities served entirely from the previous frame. */
    readonly reused: number;
    /** True when the scene's structure changed and everything was rebuilt. */
    readonly fullRebuild: boolean;
    /** True when change detection came from observed document events rather than
     * from comparing every entity. */
    readonly observed: boolean;
}
/**
 * A stateful extractor that reuses unchanged work between frames.
 *
 * One instance per rendered world. Call {@link extract} each frame with the
 * current scene; call {@link invalidate} if the scene was changed in a way the
 * extractor cannot observe (which should not happen, but is cheap insurance).
 */
export declare class IncrementalRenderWorld {
    #private;
    get stats(): IncrementalExtractStats;
    /** Forces the next extraction to rebuild everything. */
    invalidate(): void;
    /**
     * Subscribes to a scene document's change events.
     *
     * Comparing every entity every frame is the general solution, and it still
     * costs time proportional to the scene. A document tells the extractor
     * exactly which entities changed, so an observed scene that nothing touched
     * costs nothing at all — which is the case a static open world is in for most
     * of its frames.
     *
     * Returns an unsubscribe function. Observing a second document replaces the
     * first.
     */
    observe(document: SceneDocument): () => void;
    extract(scene: SceneData): RenderWorldSnapshot;
}
//# sourceMappingURL=incremental-render-world.d.ts.map