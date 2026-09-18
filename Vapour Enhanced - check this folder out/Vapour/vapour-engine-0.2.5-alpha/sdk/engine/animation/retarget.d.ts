import type { Pose } from "./clip.js";
import { type SkinnedSkeleton } from "./skinning.js";
export interface RetargetOptions {
    /** Explicit source-name to target-name overrides. Exact and canonical name
     * matching fill everything not listed here. */
    readonly boneMap?: Readonly<Record<string, string>>;
    /** Scale positional animation by corresponding rest-bone lengths. */
    readonly scaleTranslation?: boolean;
}
export interface RetargetMapEntry {
    readonly source: string;
    readonly target: string;
    readonly translationScale: number;
}
export interface RetargetMap {
    readonly entries: ReadonlyMap<string, RetargetMapEntry>;
    readonly unmappedSource: readonly string[];
    readonly unmappedTarget: readonly string[];
}
export declare function buildRetargetMap(source: SkinnedSkeleton, target: SkinnedSkeleton, options?: RetargetOptions): RetargetMap;
/** Retargets local-space animation while retaining the target rest pose.
 * Rotations and scales transfer directly; translation transfers as an offset
 * from the source rest transform and is proportionally scaled. */
export declare function retargetPose(pose: Pose, source: SkinnedSkeleton, target: SkinnedSkeleton, options?: RetargetOptions, into?: Pose): Pose;
/** Normalizes common exporter prefixes and separators without guessing
 * semantic aliases such as "pelvis" → "hips"; those belong in `boneMap`. */
export declare function canonicalBoneName(name: string): string;
//# sourceMappingURL=retarget.d.ts.map