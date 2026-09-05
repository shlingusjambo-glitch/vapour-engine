/** Convex hulls.
 *
 * A convex hull is the collision shape that matters most for generated
 * content. A triangle-mesh collider is exact but slow and cannot be dynamic; a
 * bounding box is fast but wrong for anything that is not a box. The hull is
 * the middle: cheap to test against, valid for dynamic bodies, and a close fit
 * for the props, furniture, rocks, and vehicle parts a generator produces.
 *
 * The algorithm is incremental construction: start from a tetrahedron, then add
 * each remaining point by deleting the faces it can see and stitching a cone of
 * new faces to the resulting horizon. It is O(n²) in the worst case, which is
 * irrelevant here — hulls are built from at most a few thousand points, once,
 * at generation time.
 */
import { MeshBuilder, computeNormals, type MeshData } from "./mesh.js";

const HULL_EPSILON = 1e-9;

interface Face {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly normal: [number, number, number];
  readonly offset: number;
}

function makeFace(points: readonly [number, number, number][], a: number, b: number, c: number): Face | undefined {
  const pa = points[a]!;
  const pb = points[b]!;
  const pc = points[c]!;
  const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
  const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length < HULL_EPSILON) return undefined;
  const normal: [number, number, number] = [nx / length, ny / length, nz / length];
  return { a, b, c, normal, offset: normal[0] * pa[0] + normal[1] * pa[1] + normal[2] * pa[2] };
}

function distanceToFace(points: readonly [number, number, number][], face: Face, index: number): number {
  const p = points[index]!;
  return face.normal[0] * p[0] + face.normal[1] * p[1] + face.normal[2] * p[2] - face.offset;
}

/**
 * The convex hull of a point cloud, as a closed outward-wound mesh.
 *
 * Degenerate inputs — fewer than four points, or points that are collinear or
 * coplanar — have no volume and therefore no hull. That is reported rather than
 * approximated, because a "hull" with no inside would silently produce a
 * collider that nothing can collide with.
 */
export function convexHull(input: readonly (readonly number[])[], options: { tolerance?: number } = {}): MeshData {
  const tolerance = options.tolerance ?? 1e-7;
  if (!(tolerance > 0)) throw new Error("A hull tolerance must be positive.");
  const points: [number, number, number][] = input.map((point) => [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0]);
  if (points.length < 4) throw new Error(`A convex hull needs at least four points (got ${points.length}).`);

  // Seed with the two most separated extreme points along each axis.
  let [minIndex, maxIndex] = [0, 0];
  for (let index = 1; index < points.length; index += 1) {
    if (points[index]![0] < points[minIndex]![0]) minIndex = index;
    if (points[index]![0] > points[maxIndex]![0]) maxIndex = index;
  }
  if (minIndex === maxIndex) throw new Error("Every point is identical, so there is no convex hull.");

  // Third point: furthest from the seed line.
  let third = -1;
  let bestDistance = tolerance;
  const [p0, p1] = [points[minIndex]!, points[maxIndex]!];
  const [ex, ey, ez] = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const edgeLengthSquared = ex * ex + ey * ey + ez * ez;
  for (let index = 0; index < points.length; index += 1) {
    const p = points[index]!;
    const t = ((p[0] - p0[0]) * ex + (p[1] - p0[1]) * ey + (p[2] - p0[2]) * ez) / edgeLengthSquared;
    const distance = Math.hypot(p[0] - (p0[0] + ex * t), p[1] - (p0[1] + ey * t), p[2] - (p0[2] + ez * t));
    if (distance > bestDistance) {
      bestDistance = distance;
      third = index;
    }
  }
  if (third < 0) throw new Error("All points are collinear, so there is no convex hull.");

  // Fourth point: furthest from the seed plane.
  const seed = makeFace(points, minIndex, maxIndex, third);
  if (!seed) throw new Error("All points are collinear, so there is no convex hull.");
  let fourth = -1;
  bestDistance = tolerance;
  for (let index = 0; index < points.length; index += 1) {
    const distance = Math.abs(distanceToFace(points, seed, index));
    if (distance > bestDistance) {
      bestDistance = distance;
      fourth = index;
    }
  }
  if (fourth < 0) throw new Error("All points are coplanar, so the hull has no volume.");

  // Build the seed tetrahedron with every face wound outward.
  let faces: Face[] = [];
  const addFace = (a: number, b: number, c: number, inside: number): void => {
    let face = makeFace(points, a, b, c);
    if (!face) return;
    if (distanceToFace(points, face, inside) > 0) face = makeFace(points, a, c, b)!;
    faces.push(face);
  };
  addFace(minIndex, maxIndex, third, fourth);
  addFace(minIndex, maxIndex, fourth, third);
  addFace(minIndex, third, fourth, maxIndex);
  addFace(maxIndex, third, fourth, minIndex);

  const consumed = new Set([minIndex, maxIndex, third, fourth]);
  for (let index = 0; index < points.length; index += 1) {
    if (consumed.has(index)) continue;
    // Faces this point is in front of are no longer on the hull.
    const visible = faces.filter((face) => distanceToFace(points, face, index) > tolerance);
    if (visible.length === 0) continue;

    // The horizon is every edge shared by exactly one visible face.
    const edgeUse = new Map<string, [number, number]>();
    for (const face of visible) {
      for (const [a, b] of [[face.a, face.b], [face.b, face.c], [face.c, face.a]] as const) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (edgeUse.has(key)) edgeUse.delete(key);
        else edgeUse.set(key, [a, b]);
      }
    }

    const visibleSet = new Set(visible);
    faces = faces.filter((face) => !visibleSet.has(face));
    for (const [a, b] of edgeUse.values()) {
      const face = makeFace(points, a, b, index);
      if (face) faces.push(face);
    }
  }

  const builder = new MeshBuilder();
  const remap = new Map<number, number>();
  const vertexFor = (index: number): number => {
    let mapped = remap.get(index);
    if (mapped === undefined) {
      mapped = builder.vertex(points[index]!);
      remap.set(index, mapped);
    }
    return mapped;
  };
  for (const face of faces) builder.triangle(vertexFor(face.a), vertexFor(face.b), vertexFor(face.c));
  return computeNormals(builder.build(), { smooth: false });
}

/** The convex hull of a mesh's vertices. */
export function hullOfMesh(mesh: MeshData, options: { tolerance?: number } = {}): MeshData {
  const points: [number, number, number][] = [];
  for (let index = 0; index < mesh.positions.length / 3; index += 1) {
    points.push([mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!]);
  }
  return convexHull(points, options);
}
