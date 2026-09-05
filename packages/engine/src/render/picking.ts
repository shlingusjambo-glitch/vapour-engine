import { pickingHalfExtents } from "../assets/mesh-library.js";
import type { RenderWorldSnapshot } from "./render-world.js";

export interface PickRay {
  readonly origin: readonly [number, number, number];
  /** Unit-length direction in world space. */
  readonly direction: readonly [number, number, number];
}

export interface PickHit {
  readonly entityId: string;
  /** Distance along the ray, in world units, to the nearest surface. */
  readonly distance: number;
}

/**
 * Builds a world-space ray through a normalized device coordinate.
 *
 * `ndcX` and `ndcY` are in [-1, 1] with +Y up, matching WebGPU clip space. The
 * camera basis comes straight from the snapshot the renderer consumed, so a
 * pick always agrees with what is currently on screen.
 */
export function rayThroughViewport(
  snapshot: RenderWorldSnapshot,
  ndcX: number,
  ndcY: number,
  aspectRatio: number,
): PickRay {
  const camera = snapshot.camera;
  if (camera === undefined)
    throw new Error("Cannot pick without a camera in the render world.");
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY))
    throw new Error("Pick coordinates must be finite.");
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0)
    throw new Error("Viewport aspect ratio must be positive.");

  const matrix = camera.worldMatrix;
  const right: Vec3 = [matrix[0]!, matrix[1]!, matrix[2]!];
  const up: Vec3 = [matrix[4]!, matrix[5]!, matrix[6]!];
  const back: Vec3 = [matrix[8]!, matrix[9]!, matrix[10]!];
  const origin: Vec3 = [matrix[12]!, matrix[13]!, matrix[14]!];

  const tanHalfFov = Math.tan((camera.fieldOfView * Math.PI) / 180 / 2);
  const x = ndcX * tanHalfFov * aspectRatio;
  const y = ndcY * tanHalfFov;
  // The camera looks down -Z, so the view direction is -back.
  const direction = normalize([
    right[0] * x + up[0] * y - back[0],
    right[1] * x + up[1] * y - back[1],
    right[2] * x + up[2] * y - back[2],
  ]);
  return { origin, direction };
}

/**
 * Returns the nearest instance the ray enters, or `undefined` for empty space.
 *
 * Each instance is tested as an oriented box sized from its mesh's own extents:
 * the ray is moved into the instance's local space and clipped against those
 * slabs. Selection is therefore bounds-accurate rather than triangle-accurate —
 * clicking the corner of a sphere's box selects it — which is fast, predictable,
 * and needs no depth-buffer readback. Instances with a degenerate (zero-scale)
 * transform are skipped rather than producing a divide-by-zero hit.
 */
export function pickInstance(
  snapshot: RenderWorldSnapshot,
  ray: PickRay,
): PickHit | undefined {
  let nearest: PickHit | undefined;
  for (const instance of snapshot.instances) {
    const inverse = invertAffine(instance.modelMatrix);
    if (inverse === undefined) continue;
    const localOrigin = transformPoint(inverse, ray.origin);
    const localDirection = transformVector(inverse, ray.direction);
    const distance = intersectBox(
      localOrigin,
      localDirection,
      pickingHalfExtents(instance.mesh),
    );
    if (distance === undefined) continue;
    // Local distance is expressed in the instance's own units; convert back by
    // measuring the world-space point the hit corresponds to.
    const localPoint: Vec3 = [
      localOrigin[0] + localDirection[0] * distance,
      localOrigin[1] + localDirection[1] * distance,
      localOrigin[2] + localDirection[2] * distance,
    ];
    const worldPoint = transformPoint(instance.modelMatrix, localPoint);
    const worldDistance = Math.hypot(
      worldPoint[0] - ray.origin[0],
      worldPoint[1] - ray.origin[1],
      worldPoint[2] - ray.origin[2],
    );
    if (nearest === undefined || worldDistance < nearest.distance) {
      nearest = { entityId: instance.entityId, distance: worldDistance };
    }
  }
  return nearest;
}

/** Convenience pick straight from viewport pixels. */
export function pickAtPixel(
  snapshot: RenderWorldSnapshot,
  pixelX: number,
  pixelY: number,
  widthPixels: number,
  heightPixels: number,
): PickHit | undefined {
  if (widthPixels <= 0 || heightPixels <= 0)
    throw new Error("Viewport size must be positive to pick.");
  const ndcX = (pixelX / widthPixels) * 2 - 1;
  const ndcY = 1 - (pixelY / heightPixels) * 2;
  return pickInstance(
    snapshot,
    rayThroughViewport(snapshot, ndcX, ndcY, widthPixels / heightPixels),
  );
}

type Vec3 = [number, number, number];

/** Slab test against an axis-aligned box, returning the entry distance
 * (or 0 when the ray starts inside). */
function intersectBox(
  origin: Vec3,
  direction: Vec3,
  halfExtents: readonly number[],
): number | undefined {
  let entry = Number.NEGATIVE_INFINITY;
  let exit = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const componentOrigin = origin[axis]!;
    const componentDirection = direction[axis]!;
    const extent = halfExtents[axis]!;
    if (Math.abs(componentDirection) < 1e-9) {
      if (componentOrigin < -extent || componentOrigin > extent)
        return undefined;
      continue;
    }
    const inverse = 1 / componentDirection;
    let near = (-extent - componentOrigin) * inverse;
    let far = (extent - componentOrigin) * inverse;
    if (near > far) [near, far] = [far, near];
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit) return undefined;
  }
  if (exit < 0) return undefined;
  return Math.max(entry, 0);
}

function invertAffine(matrix: readonly number[]): number[] | undefined {
  const a = matrix[0]!,
    b = matrix[1]!,
    c = matrix[2]!;
  const d = matrix[4]!,
    e = matrix[5]!,
    f = matrix[6]!;
  const g = matrix[8]!,
    h = matrix[9]!,
    i = matrix[10]!;
  const determinant =
    a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    return undefined;
  const inverseDeterminant = 1 / determinant;
  const linear = [
    (e * i - f * h) * inverseDeterminant,
    (c * h - b * i) * inverseDeterminant,
    (b * f - c * e) * inverseDeterminant,
    (f * g - d * i) * inverseDeterminant,
    (a * i - c * g) * inverseDeterminant,
    (c * d - a * f) * inverseDeterminant,
    (d * h - e * g) * inverseDeterminant,
    (b * g - a * h) * inverseDeterminant,
    (a * e - b * d) * inverseDeterminant,
  ];
  const translation: Vec3 = [matrix[12]!, matrix[13]!, matrix[14]!];
  return [
    linear[0]!,
    linear[1]!,
    linear[2]!,
    0,
    linear[3]!,
    linear[4]!,
    linear[5]!,
    0,
    linear[6]!,
    linear[7]!,
    linear[8]!,
    0,
    -(
      linear[0]! * translation[0] +
      linear[3]! * translation[1] +
      linear[6]! * translation[2]
    ),
    -(
      linear[1]! * translation[0] +
      linear[4]! * translation[1] +
      linear[7]! * translation[2]
    ),
    -(
      linear[2]! * translation[0] +
      linear[5]! * translation[1] +
      linear[8]! * translation[2]
    ),
    1,
  ];
}

function transformPoint(
  matrix: readonly number[],
  point: readonly number[],
): Vec3 {
  return [0, 1, 2].map(
    (row) =>
      matrix[row]! * point[0]! +
      matrix[4 + row]! * point[1]! +
      matrix[8 + row]! * point[2]! +
      matrix[12 + row]!,
  ) as Vec3;
}

function transformVector(
  matrix: readonly number[],
  vector: readonly number[],
): Vec3 {
  return [0, 1, 2].map(
    (row) =>
      matrix[row]! * vector[0]! +
      matrix[4 + row]! * vector[1]! +
      matrix[8 + row]! * vector[2]!,
  ) as Vec3;
}

function normalize(value: readonly number[]): Vec3 {
  const length = Math.hypot(value[0]!, value[1]!, value[2]!);
  if (length < Number.EPSILON)
    throw new Error("Cannot build a pick ray with zero length.");
  return [value[0]! / length, value[1]! / length, value[2]! / length];
}
