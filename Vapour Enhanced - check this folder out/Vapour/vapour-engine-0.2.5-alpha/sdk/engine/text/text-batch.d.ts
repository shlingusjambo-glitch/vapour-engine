/** Text batching, cached layout, and world/screen placement.
 *
 * `layoutText2D` builds one mesh per string. A HUD has dozens of strings and a
 * dialogue scene has more, and each as its own draw call is what makes text
 * the surprising line at the top of a frame profile. Every label sharing an
 * atlas can be one draw: the glyph quads are already in the same texture and
 * the same material, so all that is needed is to offset each label's vertices
 * to its position and concatenate.
 *
 * Caching sits in front of layout for the same reason: an unchanged label
 * costs a map lookup, not a mesh build. The cache reports hits and misses into
 * the engine's counter registry so the diagnostics overlay can show whether
 * text is actually being reused.
 *
 * Screen and world placement differ only in the transform applied to the
 * batched mesh — a screen batch is in pixels, a world batch is in
 * metres on a plane — so they share one batch type and differ in one matrix.
 */
import { type Mat4, type Quat, type Vec3Like } from "@vapour/math";
import type { Diagnostics } from "../diagnostics/counters.js";
import type { MeshUpload } from "../render/host/index.js";
import { TextLayoutCache } from "./rich-text.js";
import { type FontAtlas, type TextLayoutOptions, type TextLayoutResult } from "./text-2d.js";
export declare const TEXT_COUNTERS: {
    readonly cacheHits: "text.cacheHits";
    readonly cacheMisses: "text.cacheMisses";
    readonly cacheEntries: "text.cacheEntries";
    readonly batches: "text.batches";
    readonly batchedGlyphs: "text.batchedGlyphs";
};
/** A laid-out label and where it sits in its batch's space. */
export interface TextBatchItem {
    readonly layout: TextLayoutResult;
    /** Offset of the label origin in batch space (pixels for screen, metres for world). */
    readonly position: readonly [number, number];
    /** Uniform scale applied to the label's mesh; world batches use `1 / pixelsPerUnit`. */
    readonly scale?: number;
}
/** One draw call's worth of text. */
export interface TextBatch {
    readonly material: string;
    readonly mesh: MeshUpload;
    readonly labelCount: number;
    readonly glyphCount: number;
}
/**
 * Lays out text through a cache, keyed on everything that changes the result.
 *
 * `bytes` is the glyph vertex data size, so the cache's byte total in the
 * overlay is an honest number rather than a count of entries.
 */
export declare class CachedTextLayout {
    #private;
    constructor(options?: {
        readonly maxEntries?: number;
        readonly diagnostics?: Diagnostics;
    });
    layout(font: FontAtlas, text: string, options: TextLayoutOptions): TextLayoutResult;
    stats(): ReturnType<TextLayoutCache<TextLayoutResult>["stats"]>;
    clear(): void;
}
/**
 * Merges labels that share a material into one mesh per material.
 *
 * Labels are grouped by material rather than by font id because two fonts
 * packed into one atlas can and should share a draw. Draw order within a batch
 * is input order, which is what a caller laying out a HUD top-to-bottom wants.
 */
export declare function batchText(items: readonly TextBatchItem[], diagnostics?: Diagnostics): readonly TextBatch[];
/**
 * The transform placing a screen-space text batch.
 *
 * Batches are authored in layout pixels (baseline at 0, +Y up), the same
 * space as every other 2D mesh, so this matrix only has to translate by the
 * label's screen offset; scale stays 1 pixel per unit.
 */
export declare function screenTextTransform(x: number, y: number): Mat4;
/**
 * The transform placing a world-space text batch on a plane.
 *
 * Text layout is in design pixels with the baseline at y = 0 and +Y up (lines
 * descend to negative Y); a world label needs metres, so the scale is
 * `1 / pixelsPerUnit`. The batch itself stays in pixels — the same cached
 * layout serves a HUD and a sign.
 */
export declare function worldTextTransform(position: Vec3Like, rotation: Quat, pixelsPerUnit: number): Mat4;
/** A batched text mesh's corners in world space, for culling or debug draw. */
export declare function textBatchBounds(batch: TextBatch, transform: Mat4): {
    readonly min: [number, number, number];
    readonly max: [number, number, number];
};
/** Attaches a text batch to a parent transform (a name tag over a head, a dial on a dash). */
export declare function attachedTextTransform(parentWorld: Mat4, local: Mat4): Mat4;
//# sourceMappingURL=text-batch.d.ts.map