/** Parameter-driven animation blend trees.
 *
 * One-dimensional trees are ideal for scalar locomotion speed. Two-dimensional
 * freeform trees cover planar velocity and aim direction without baking those
 * gameplay decisions into the animator.
 */
import { type AnimationClip, type Pose } from "./clip.js";
export interface BlendTreeChild1D {
    readonly threshold: number;
    readonly clip: AnimationClip;
    readonly speed?: number;
}
export interface BlendTree1D {
    readonly type: "1d";
    readonly parameter: string;
    readonly children: readonly BlendTreeChild1D[];
}
export interface BlendTreeChild2D {
    readonly position: readonly [number, number];
    readonly clip: AnimationClip;
    readonly speed?: number;
}
export interface BlendTree2D {
    readonly type: "2d";
    readonly parameterX: string;
    readonly parameterY: string;
    readonly children: readonly BlendTreeChild2D[];
}
export type BlendTree = BlendTree1D | BlendTree2D;
export type BlendParameters = ReadonlyMap<string, number | boolean> | Readonly<Record<string, number | boolean>>;
export declare function validateBlendTree(tree: BlendTree): BlendTree;
/** Samples and blends a tree. `into` and the scratch poses make steady-state
 * animator evaluation allocation-free. */
export declare function sampleBlendTree(tree: BlendTree, parameters: BlendParameters, time: number, into?: Pose, scratch?: Pose): Pose;
export declare function blendTreeDuration(tree: BlendTree): number;
//# sourceMappingURL=blend-tree.d.ts.map