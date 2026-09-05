/** Bounding volumes and intersection tests.
 *
 * These are the primitives culling, picking, physics broad-phase, navigation
 * queries, and streaming interest all need. They are plain data so they can be
 * serialized, sent to a worker, or packed into a typed array without adapters.
 */
import { EPSILON } from "./scalar.js";
import type { Mat4Like } from "./mat4.js";
import type { Vec3, Vec3Like } from "./vec3.js";

/** Axis-aligned bounding box. `min` must be component-wise <= `max`. */
export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Sphere {
  readonly center: Vec3;
  readonly radius: number;
}

/** Plane in the form `dot(normal, p) + distance = 0`, with a unit normal. */
export interface Plane {
  readonly normal: Vec3;
  readonly distance: number;
}

export interface Ray {
  readonly origin: Vec3;
  /** Unit-length. */
  readonly direction: Vec3;
}

/** Six planes with inward-facing normals: a point is inside when it is in
 * front of all of them. Ordered left, right, bottom, top, near, far. */
export interface Frustum {
  readonly planes: readonly Plane[];
}

export function aabb(min: Vec3Like, max: Vec3Like): Aabb {
  const lo: Vec3 = [min[0]!, min[1]!, min[2]!];
  const hi: Vec3 = [max[0]!, max[1]!, max[2]!];
  if (lo.some((v, i) => v > hi[i]!)) throw new Error("An AABB requires min <= max on every axis.");
  return { min: lo, max: hi };
}

/** The empty box: inverted bounds so the first {@link expandAabb} sets exact values. */
export function emptyAabb(): Aabb {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function isEmptyAabb(box: Aabb): boolean {
  return box.min[0] > box.max[0] || box.min[1] > box.max[1] || box.min[2] > box.max[2];
}

export function aabbFromCenterExtents(center: Vec3Like, halfExtents: Vec3Like): Aabb {
  return aabb(
    [center[0]! - halfExtents[0]!, center[1]! - halfExtents[1]!, center[2]! - halfExtents[2]!],
    [center[0]! + halfExtents[0]!, center[1]! + halfExtents[1]!, center[2]! + halfExtents[2]!],
  );
}

export function aabbFromPoints(points: Iterable<Vec3Like>): Aabb {
  let box = emptyAabb();
  for (const point of points) box = expandAabb(box, point);
  if (isEmptyAabb(box)) throw new Error("An AABB requires at least one point.");
  return box;
}

export function expandAabb(box: Aabb, point: Vec3Like): Aabb {
  return {
    min: [Math.min(box.min[0], point[0]!), Math.min(box.min[1], point[1]!), Math.min(box.min[2], point[2]!)],
    max: [Math.max(box.max[0], point[0]!), Math.max(box.max[1], point[1]!), Math.max(box.max[2], point[2]!)],
  };
}

export function unionAabb(a: Aabb, b: Aabb): Aabb {
  if (isEmptyAabb(a)) return b;
  if (isEmptyAabb(b)) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export function aabbCenter(box: Aabb): Vec3 {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

export function aabbHalfExtents(box: Aabb): Vec3 {
  return [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2, (box.max[2] - box.min[2]) / 2];
}

export function aabbContainsPoint(box: Aabb, point: Vec3Like): boolean {
  return (
    point[0]! >= box.min[0] && point[0]! <= box.max[0] &&
    point[1]! >= box.min[1] && point[1]! <= box.max[1] &&
    point[2]! >= box.min[2] && point[2]! <= box.max[2]
  );
}

export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return (
    a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] && a.max[2] >= b.min[2]
  );
}

/** Nearest point on or inside the box, used for distance and sphere overlap. */
export function closestPointOnAabb(box: Aabb, point: Vec3Like): Vec3 {
  return [
    Math.min(Math.max(point[0]!, box.min[0]), box.max[0]),
    Math.min(Math.max(point[1]!, box.min[1]), box.max[1]),
    Math.min(Math.max(point[2]!, box.min[2]), box.max[2]),
  ];
}

/**
 * World-space AABB of a transformed local AABB.
 *
 * Transforms the centre and projects the half-extents through the absolute
 * value of the matrix's basis, which is far cheaper than transforming all
 * eight corners and gives the same result.
 */
export function transformAabb(box: Aabb, matrix: Mat4Like): Aabb {
  const center = aabbCenter(box);
  const extents = aabbHalfExtents(box);
  const worldCenter: Vec3 = [
    matrix[0]! * center[0] + matrix[4]! * center[1] + matrix[8]! * center[2] + matrix[12]!,
    matrix[1]! * center[0] + matrix[5]! * center[1] + matrix[9]! * center[2] + matrix[13]!,
    matrix[2]! * center[0] + matrix[6]! * center[1] + matrix[10]! * center[2] + matrix[14]!,
  ];
  const worldExtents: Vec3 = [
    Math.abs(matrix[0]!) * extents[0] + Math.abs(matrix[4]!) * extents[1] + Math.abs(matrix[8]!) * extents[2],
    Math.abs(matrix[1]!) * extents[0] + Math.abs(matrix[5]!) * extents[1] + Math.abs(matrix[9]!) * extents[2],
    Math.abs(matrix[2]!) * extents[0] + Math.abs(matrix[6]!) * extents[1] + Math.abs(matrix[10]!) * extents[2],
  ];
  return aabbFromCenterExtents(worldCenter, worldExtents);
}

export function sphere(center: Vec3Like, radius: number): Sphere {
  if (!(radius >= 0) || !Number.isFinite(radius)) throw new Error("A sphere requires a finite, non-negative radius.");
  return { center: [center[0]!, center[1]!, center[2]!], radius };
}

/** Bounding sphere of a box; conservative but cheap for a first cull pass. */
export function sphereFromAabb(box: Aabb): Sphere {
  const extents = aabbHalfExtents(box);
  return { center: aabbCenter(box), radius: Math.hypot(extents[0], extents[1], extents[2]) };
}

export function sphereIntersects(a: Sphere, b: Sphere): boolean {
  const radii = a.radius + b.radius;
  const dx = a.center[0] - b.center[0];
  const dy = a.center[1] - b.center[1];
  const dz = a.center[2] - b.center[2];
  return dx * dx + dy * dy + dz * dz <= radii * radii;
}

export function sphereIntersectsAabb(value: Sphere, box: Aabb): boolean {
  const closest = closestPointOnAabb(box, value.center);
  const dx = closest[0] - value.center[0];
  const dy = closest[1] - value.center[1];
  const dz = closest[2] - value.center[2];
  return dx * dx + dy * dy + dz * dz <= value.radius * value.radius;
}

export function plane(normal: Vec3Like, distance: number): Plane {
  const magnitude = Math.hypot(normal[0]!, normal[1]!, normal[2]!);
  if (magnitude < EPSILON) throw new Error("A plane requires a non-zero normal.");
  return { normal: [normal[0]! / magnitude, normal[1]! / magnitude, normal[2]! / magnitude], distance: distance / magnitude };
}

export function planeFromPointNormal(point: Vec3Like, normal: Vec3Like): Plane {
  const unit = plane(normal, 0).normal;
  return { normal: unit, distance: -(unit[0] * point[0]! + unit[1] * point[1]! + unit[2] * point[2]!) };
}

/** Signed distance: positive in front of the plane, negative behind. */
export function planeDistanceToPoint(value: Plane, point: Vec3Like): number {
  return value.normal[0] * point[0]! + value.normal[1] * point[1]! + value.normal[2] * point[2]! + value.distance;
}

export function ray(origin: Vec3Like, direction: Vec3Like): Ray {
  const magnitude = Math.hypot(direction[0]!, direction[1]!, direction[2]!);
  if (magnitude < EPSILON) throw new Error("A ray requires a non-zero direction.");
  return {
    origin: [origin[0]!, origin[1]!, origin[2]!],
    direction: [direction[0]! / magnitude, direction[1]! / magnitude, direction[2]! / magnitude],
  };
}

export function rayPoint(value: Ray, distance: number): Vec3 {
  return [
    value.origin[0] + value.direction[0] * distance,
    value.origin[1] + value.direction[1] * distance,
    value.origin[2] + value.direction[2] * distance,
  ];
}

/** Slab test. Returns the entry distance, or `undefined` when there is no hit
 * ahead of the origin; a ray starting inside the box returns 0. */
export function rayIntersectsAabb(value: Ray, box: Aabb): number | undefined {
  let near = 0;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const origin = value.origin[axis]!;
    const direction = value.direction[axis]!;
    if (Math.abs(direction) < EPSILON) {
      // Parallel to this slab: a miss unless the origin already lies within it.
      if (origin < box.min[axis]! || origin > box.max[axis]!) return undefined;
      continue;
    }
    const inverse = 1 / direction;
    let t0 = (box.min[axis]! - origin) * inverse;
    let t1 = (box.max[axis]! - origin) * inverse;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return undefined;
  }
  return near;
}

export function rayIntersectsSphere(value: Ray, target: Sphere): number | undefined {
  const ox = value.origin[0] - target.center[0];
  const oy = value.origin[1] - target.center[1];
  const oz = value.origin[2] - target.center[2];
  const b = ox * value.direction[0] + oy * value.direction[1] + oz * value.direction[2];
  const c = ox * ox + oy * oy + oz * oz - target.radius * target.radius;
  if (c > 0 && b > 0) return undefined;
  const discriminant = b * b - c;
  if (discriminant < 0) return undefined;
  const distance = -b - Math.sqrt(discriminant);
  return distance < 0 ? 0 : distance;
}

export function rayIntersectsPlane(value: Ray, target: Plane): number | undefined {
  const denominator = target.normal[0] * value.direction[0] + target.normal[1] * value.direction[1] + target.normal[2] * value.direction[2];
  if (Math.abs(denominator) < EPSILON) return undefined;
  const distance = -planeDistanceToPoint(target, value.origin) / denominator;
  return distance < 0 ? undefined : distance;
}

/**
 * Extracts the six clip planes from a view-projection matrix (Gribb/Hartmann).
 *
 * Because Vapour projects into WebGPU's `[0, 1]` depth range, the near plane is
 * row 3 alone rather than `row3 + row4` as it would be for OpenGL's `[-1, 1]`.
 */
export function frustumFromViewProjection(viewProjection: Mat4Like): Frustum {
  const m = viewProjection;
  const row = (index: number): [number, number, number, number] => [m[index]!, m[4 + index]!, m[8 + index]!, m[12 + index]!];
  const [r0, r1, r2, r3] = [row(0), row(1), row(2), row(3)];
  const build = (a: readonly number[], b: readonly number[], sign: 1 | -1): Plane =>
    plane([a[0]! + sign * b[0]!, a[1]! + sign * b[1]!, a[2]! + sign * b[2]!], a[3]! + sign * b[3]!);
  return {
    planes: [
      build(r3, r0, 1), // left
      build(r3, r0, -1), // right
      build(r3, r1, 1), // bottom
      build(r3, r1, -1), // top
      plane([r2[0], r2[1], r2[2]], r2[3]), // near
      build(r3, r2, -1), // far
    ],
  };
}

/** Conservative test: false means definitely outside, true means possibly visible. */
export function frustumIntersectsAabb(value: Frustum, box: Aabb): boolean {
  for (const p of value.planes) {
    // Test the box corner furthest along the plane normal; if even that corner
    // is behind the plane, every corner is, so the box is fully outside.
    const x = p.normal[0] >= 0 ? box.max[0] : box.min[0];
    const y = p.normal[1] >= 0 ? box.max[1] : box.min[1];
    const z = p.normal[2] >= 0 ? box.max[2] : box.min[2];
    if (p.normal[0] * x + p.normal[1] * y + p.normal[2] * z + p.distance < 0) return false;
  }
  return true;
}

export function frustumIntersectsSphere(value: Frustum, target: Sphere): boolean {
  return value.planes.every((p) => planeDistanceToPoint(p, target.center) >= -target.radius);
}

export function frustumContainsPoint(value: Frustum, point: Vec3Like): boolean {
  return value.planes.every((p) => planeDistanceToPoint(p, point) >= 0);
}
