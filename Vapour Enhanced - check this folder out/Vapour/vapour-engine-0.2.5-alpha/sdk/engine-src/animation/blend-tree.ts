/** Parameter-driven animation blend trees.
 *
 * One-dimensional trees are ideal for scalar locomotion speed. Two-dimensional
 * freeform trees cover planar velocity and aim direction without baking those
 * gameplay decisions into the animator.
 */
import {
  blendPoses,
  samplePose,
  validateClip,
  type AnimationClip,
  type Pose,
} from "./clip.js";

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
export type BlendParameters =
  | ReadonlyMap<string, number | boolean>
  | Readonly<Record<string, number | boolean>>;

export function validateBlendTree(tree: BlendTree): BlendTree {
  const parameterNames =
    tree.type === "1d" ? [tree.parameter] : [tree.parameterX, tree.parameterY];
  if (parameterNames.some((name) => !name.trim()))
    throw new Error("A blend tree requires non-empty parameter names.");
  if (tree.children.length === 0)
    throw new Error("A blend tree requires at least one child clip.");
  for (const [index, child] of tree.children.entries()) {
    validateClip(child.clip);
    if (
      child.speed !== undefined &&
      (!Number.isFinite(child.speed) || child.speed < 0)
    )
      throw new Error(
        `Blend tree child ${String(index)} speed must be finite and non-negative.`,
      );
    const coordinates =
      tree.type === "1d"
        ? [(child as BlendTreeChild1D).threshold]
        : (child as BlendTreeChild2D).position;
    if (coordinates.some((value) => !Number.isFinite(value)))
      throw new Error(
        `Blend tree child ${String(index)} has a non-finite position.`,
      );
  }
  if (tree.type === "1d") {
    for (let index = 1; index < tree.children.length; index += 1) {
      if (
        tree.children[index - 1]!.threshold >= tree.children[index]!.threshold
      )
        throw new Error(
          "A 1D blend tree requires strictly increasing child thresholds.",
        );
    }
  } else {
    const seen = new Set<string>();
    for (const child of tree.children) {
      const key = `${String(child.position[0])},${String(child.position[1])}`;
      if (seen.has(key))
        throw new Error(
          `A 2D blend tree has duplicate child position (${key}).`,
        );
      seen.add(key);
    }
  }
  return tree;
}

/** Samples and blends a tree. `into` and the scratch poses make steady-state
 * animator evaluation allocation-free. */
export function sampleBlendTree(
  tree: BlendTree,
  parameters: BlendParameters,
  time: number,
  into: Pose = new Map(),
  scratch: Pose = new Map(),
): Pose {
  validateBlendTree(tree);
  if (!Number.isFinite(time))
    throw new Error("Blend tree time must be finite.");
  const weights =
    tree.type === "1d"
      ? weights1d(tree, numericParameter(parameters, tree.parameter))
      : weights2d(
          tree,
          numericParameter(parameters, tree.parameterX),
          numericParameter(parameters, tree.parameterY),
        );
  into.clear();
  let accumulated = 0;
  for (let index = 0; index < tree.children.length; index += 1) {
    const weight = weights[index]!;
    if (weight <= 1e-7) continue;
    const child = tree.children[index]!;
    scratch.clear();
    samplePose(child.clip, time * (child.speed ?? 1), scratch);
    if (accumulated === 0) {
      for (const [name, bone] of scratch) into.set(name, { ...bone });
      accumulated = weight;
      continue;
    }
    const blended = blendPoses(into, scratch, weight / (accumulated + weight));
    into.clear();
    for (const [name, bone] of blended) into.set(name, bone);
    accumulated += weight;
  }
  return into;
}

export function blendTreeDuration(tree: BlendTree): number {
  return Math.max(
    ...tree.children.map((child) => child.clip.duration / (child.speed ?? 1)),
  );
}

function weights1d(tree: BlendTree1D, value: number): number[] {
  const weights = new Array<number>(tree.children.length).fill(0);
  if (value <= tree.children[0]!.threshold) {
    weights[0] = 1;
    return weights;
  }
  const last = tree.children.length - 1;
  if (value >= tree.children[last]!.threshold) {
    weights[last] = 1;
    return weights;
  }
  for (let index = 0; index < last; index += 1) {
    const left = tree.children[index]!.threshold;
    const right = tree.children[index + 1]!.threshold;
    if (value <= right) {
      const t = (value - left) / (right - left);
      weights[index] = 1 - t;
      weights[index + 1] = t;
      return weights;
    }
  }
  return weights;
}

function weights2d(tree: BlendTree2D, x: number, y: number): number[] {
  const inverseDistances = tree.children.map((child) => {
    const distanceSquared =
      (x - child.position[0]) ** 2 + (y - child.position[1]) ** 2;
    return distanceSquared < 1e-12
      ? Number.POSITIVE_INFINITY
      : 1 / distanceSquared;
  });
  const exact = inverseDistances.indexOf(Number.POSITIVE_INFINITY);
  if (exact >= 0)
    return inverseDistances.map((_, index) => Number(index === exact));
  const sum = inverseDistances.reduce((total, weight) => total + weight, 0);
  return inverseDistances.map((weight) => weight / sum);
}

function numericParameter(parameters: BlendParameters, name: string): number {
  const get = (parameters as ReadonlyMap<string, number | boolean>).get;
  const value =
    typeof get === "function"
      ? get.call(parameters, name)
      : (parameters as Readonly<Record<string, number | boolean>>)[name];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`Blend tree parameter "${name}" must be a finite number.`);
  return value;
}
