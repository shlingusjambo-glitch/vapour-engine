/** 2D profiles and the operators that turn them into solids.
 *
 * This is the single most useful abstraction for describing real assets in
 * text. A wall is a rectangle extruded; a column is a profile revolved; a
 * moulding, a railing, a road, a river, a pipe, a roof edge, and a sword blade
 * are all a small 2D outline swept along a path. An AI agent describing a
 * building in terms of profiles and paths writes tens of numbers, where the
 * same building as raw triangles would be tens of thousands.
 *
 * Profiles are closed polygons in the XY plane, wound counter-clockwise for
 * outer boundaries. Holes are inner rings wound clockwise, which is the same
 * convention SVG, fonts, and every polygon library use, so imported outlines
 * need no conversion.
 */
import { EPSILON, type Vec2 } from "@vapour/math";
import { MeshBuilder, computeNormals, weldVertices, type MeshData } from "./mesh.js";

export type ProfilePoint = readonly [number, number];

export interface Profile {
  /** Outer boundary, counter-clockwise, first point not repeated at the end. */
  readonly outline: readonly ProfilePoint[];
  /** Inner boundaries, clockwise. */
  readonly holes?: readonly (readonly ProfilePoint[])[];
}

export function profile(outline: readonly ProfilePoint[], holes: readonly (readonly ProfilePoint[])[] = []): Profile {
  if (outline.length < 3) throw new Error(`A profile outline needs at least three points (got ${outline.length}).`);
  for (const point of outline) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) throw new Error("Profile points must be finite.");
  }
  for (const hole of holes) {
    if (hole.length < 3) throw new Error(`A profile hole needs at least three points (got ${hole.length}).`);
  }
  // Normalize winding so downstream operators never have to guess.
  const wound = signedArea(outline) < 0 ? [...outline].reverse() : [...outline];
  const woundHoles = holes.map((hole) => (signedArea(hole) > 0 ? [...hole].reverse() : [...hole]));
  return { outline: wound, ...(woundHoles.length > 0 ? { holes: woundHoles } : {}) };
}

/** Positive for counter-clockwise winding. */
export function signedArea(points: readonly ProfilePoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

export function profileArea(value: Profile): number {
  return Math.abs(signedArea(value.outline)) - (value.holes ?? []).reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
}

/** An axis-aligned rectangle, the profile most walls and slabs use. */
export function rectangleProfile(width: number, height: number, options: { centered?: boolean } = {}): Profile {
  if (!(width > 0) || !(height > 0)) throw new Error("Rectangle dimensions must be positive.");
  const [x0, y0] = options.centered === false ? [0, 0] : [-width / 2, -height / 2];
  return profile([[x0, y0], [x0 + width, y0], [x0 + width, y0 + height], [x0, y0 + height]]);
}

export function circleProfile(radius: number, segments = 24): Profile {
  if (!(radius > 0)) throw new Error("A circle profile needs a positive radius.");
  if (!Number.isInteger(segments) || segments < 3) throw new Error("A circle profile needs at least three segments.");
  return profile(
    Array.from({ length: segments }, (_, index) => {
      const theta = (index / segments) * Math.PI * 2;
      return [Math.cos(theta) * radius, Math.sin(theta) * radius] as ProfilePoint;
    }),
  );
}

/** A rectangle with rounded corners — window frames, screens, furniture. */
export function roundedRectangleProfile(width: number, height: number, radius: number, segmentsPerCorner = 4): Profile {
  if (!(width > 0) || !(height > 0)) throw new Error("Rectangle dimensions must be positive.");
  const limit = Math.min(width, height) / 2;
  if (!(radius > 0) || radius > limit) throw new Error(`A corner radius must lie in (0, ${limit}] for a ${width}x${height} rectangle.`);
  if (!Number.isInteger(segmentsPerCorner) || segmentsPerCorner < 1) throw new Error("A rounded rectangle needs at least one segment per corner.");
  const [hw, hh] = [width / 2 - radius, height / 2 - radius];
  const points: ProfilePoint[] = [];
  const corners: readonly [number, number, number][] = [
    [hw, hh, 0],
    [-hw, hh, Math.PI / 2],
    [-hw, -hh, Math.PI],
    [hw, -hh, (Math.PI * 3) / 2],
  ];
  for (const [cx, cy, start] of corners) {
    for (let step = 0; step <= segmentsPerCorner; step += 1) {
      const theta = start + (step / segmentsPerCorner) * (Math.PI / 2);
      points.push([cx + Math.cos(theta) * radius, cy + Math.sin(theta) * radius]);
    }
  }
  return profile(points);
}

/** A regular polygon — hex tiles, nuts and bolts, stylized trees. */
export function polygonProfile(sides: number, radius: number): Profile {
  if (!Number.isInteger(sides) || sides < 3) throw new Error("A polygon profile needs at least three sides.");
  return circleProfile(radius, sides);
}

/**
 * Triangulates a profile by ear clipping, honouring holes.
 *
 * Ear clipping is O(n²) in the worst case and entirely adequate here: profiles
 * describing real assets have tens of points, not thousands, and the algorithm
 * is simple enough to be obviously correct — which matters more when the
 * geometry it produces feeds physics and navigation.
 */
export function triangulateProfile(value: Profile): { points: ProfilePoint[]; triangles: number[] } {
  const points: ProfilePoint[] = [...value.outline];
  // Holes are bridged into the outline, turning a multi-ring polygon into one
  // simple polygon that ear clipping can handle.
  for (const hole of value.holes ?? []) bridgeHole(points, hole);

  const indices = points.map((_, index) => index);
  const triangles: number[] = [];
  let guard = indices.length * indices.length;

  while (indices.length > 3) {
    let clipped = false;
    for (let index = 0; index < indices.length; index += 1) {
      const previous = indices[(index - 1 + indices.length) % indices.length]!;
      const current = indices[index]!;
      const next = indices[(index + 1) % indices.length]!;
      if (!isEar(points, indices, previous, current, next)) continue;
      triangles.push(previous, current, next);
      indices.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped || guard-- <= 0) {
      throw new Error("This profile could not be triangulated. It is probably self-intersecting, or a hole crosses the outline.");
    }
  }
  triangles.push(indices[0]!, indices[1]!, indices[2]!);
  return { points, triangles };
}

export interface ExtrudeOptions {
  /** Distance extruded along +Z. */
  readonly depth: number;
  /** Cap the two ends. Off produces an open tube, which is what a pipe wants. */
  readonly capped?: boolean;
  /** Extrude symmetrically about the profile plane rather than forward only. */
  readonly centered?: boolean;
}

/**
 * Extrudes a profile along +Z into a closed solid.
 *
 * The workhorse of architecture generation: walls, floors, slabs, beams,
 * kerbs, signs, and any prismatic part are one profile and a depth.
 */
export function extrudeProfile(value: Profile, options: ExtrudeOptions): MeshData {
  const depth = options.depth;
  if (!(depth > 0) || !Number.isFinite(depth)) throw new Error(`An extrusion depth must be positive and finite (got ${depth}).`);
  const capped = options.capped ?? true;
  const [z0, z1] = options.centered ? [-depth / 2, depth / 2] : [0, depth];
  const { points, triangles } = triangulateProfile(value);
  const builder = new MeshBuilder();

  if (capped) {
    for (const [z, normal, flip] of [[z0, [0, 0, -1], true], [z1, [0, 0, 1], false]] as const) {
      const base = builder.vertexCount;
      for (const point of points) {
        builder.vertex([point[0], point[1], z], { normal, uv: [point[0], point[1]] });
      }
      for (let triangle = 0; triangle < triangles.length; triangle += 3) {
        const [a, b, c] = [base + triangles[triangle]!, base + triangles[triangle + 1]!, base + triangles[triangle + 2]!];
        // The back cap faces the other way, so its winding reverses.
        if (flip) builder.triangle(a, c, b);
        else builder.triangle(a, b, c);
      }
    }
  }

  // Walls, one quad per profile edge, with per-edge normals so corners stay
  // sharp and UVs that run around the perimeter.
  for (const ring of [value.outline, ...(value.holes ?? [])]) {
    let travelled = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index]!;
      const b = ring[(index + 1) % ring.length]!;
      const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
      const length = Math.hypot(ex, ey);
      if (length < EPSILON) continue;
      // Outward normal is the edge turned 90 degrees; holes are wound the other
      // way, so their walls automatically face into the cavity.
      const normal: [number, number, number] = [ey / length, -ex / length, 0];
      const v0 = builder.vertex([a[0], a[1], z0], { normal, uv: [travelled, 0] });
      const v1 = builder.vertex([b[0], b[1], z0], { normal, uv: [travelled + length, 0] });
      const v2 = builder.vertex([b[0], b[1], z1], { normal, uv: [travelled + length, depth] });
      const v3 = builder.vertex([a[0], a[1], z1], { normal, uv: [travelled, depth] });
      builder.quad(v0, v1, v2, v3);
      travelled += length;
    }
  }
  return builder.build();
}

export interface RevolveOptions {
  /** Sweep in degrees. 360 closes the surface; less leaves it open. */
  readonly degrees?: number;
  readonly segments?: number;
  /** Cap the ends of a partial revolve. */
  readonly capped?: boolean;
}

/**
 * Revolves a profile around the Y axis.
 *
 * Columns, vases, bottles, wheels, domes, balusters, and lathe-turned furniture
 * are all one outline revolved — a handful of numbers instead of a mesh.
 *
 * The profile's X coordinate is the radius, so it must not be negative: a
 * negative radius folds the surface through the axis and produces geometry that
 * looks right and is inside out.
 */
export function revolveProfile(points: readonly ProfilePoint[], options: RevolveOptions = {}): MeshData {
  if (points.length < 2) throw new Error("A revolve profile needs at least two points.");
  for (const point of points) {
    if (point[0] < 0) throw new Error(`A revolve profile's X is a radius and must not be negative (got ${point[0]}).`);
  }
  const degrees = options.degrees ?? 360;
  if (!(degrees > 0 && degrees <= 360)) throw new Error("A revolve sweep must lie in (0, 360] degrees.");
  const segments = options.segments ?? Math.max(3, Math.round((degrees / 360) * 32));
  if (!Number.isInteger(segments) || segments < 3) throw new Error("A revolve needs at least three segments.");

  const closed = degrees >= 360 - 1e-6;
  const builder = new MeshBuilder();
  const steps = closed ? segments : segments + 1;

  for (let step = 0; step < steps; step += 1) {
    const u = step / segments;
    const theta = u * (degrees * Math.PI) / 180;
    const [cos, sin] = [Math.cos(theta), Math.sin(theta)];
    for (const [index, point] of points.entries()) {
      builder.vertex([point[0] * cos, point[1], -point[0] * sin], {
        uv: [u, index / (points.length - 1)],
      });
    }
  }
  for (let step = 0; step < (closed ? segments : segments); step += 1) {
    const current = step * points.length;
    const next = ((step + 1) % steps) * points.length;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = current + index;
      const b = next + index;
      if (points[index]![0] > EPSILON) builder.triangle(a, b, a + 1);
      if (points[index + 1]![0] > EPSILON) builder.triangle(a + 1, b, b + 1);
    }
  }
  const mesh = builder.build();
  return computeNormals(weldVertices(mesh, 1e-6), { smooth: true });
}

export interface SweepOptions {
  /** Points the profile is swept through, in order. */
  readonly path: readonly (readonly [number, number, number])[];
  /** Join the last path point back to the first. */
  readonly closed?: boolean;
  /** Cap the open ends of a non-closed sweep. */
  readonly capped?: boolean;
}

/**
 * Sweeps a profile along a 3D path.
 *
 * Roads, rivers, pipes, cables, handrails, ropes, and vines are all a small
 * profile swept along a polyline. Frames are computed with a rotation-minimizing
 * sweep: each frame is carried forward from the last rather than derived from a
 * fixed up vector, so the profile does not spin as the path turns — the artefact
 * that makes a naive sweep produce twisted railings.
 */
export function sweepProfile(value: Profile, options: SweepOptions): MeshData {
  const path = options.path;
  if (path.length < 2) throw new Error("A sweep path needs at least two points.");
  const closed = options.closed ?? false;
  const ring = value.outline;
  const builder = new MeshBuilder();

  let normal: [number, number, number] | undefined;
  const frames: { origin: readonly [number, number, number]; right: [number, number, number]; up: [number, number, number] }[] = [];

  for (let index = 0; index < path.length; index += 1) {
    const previous = path[(index - 1 + path.length) % path.length]!;
    const next = path[(index + 1) % path.length]!;
    const from = index === 0 && !closed ? path[0]! : previous;
    const to = index === path.length - 1 && !closed ? path[path.length - 1]! : next;
    let tangent: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    let length = Math.hypot(tangent[0], tangent[1], tangent[2]);
    if (length < EPSILON) {
      const fallback = path[Math.min(index + 1, path.length - 1)]!;
      tangent = [fallback[0] - path[index]![0], fallback[1] - path[index]![1], fallback[2] - path[index]![2]];
      length = Math.hypot(tangent[0], tangent[1], tangent[2]) || 1;
    }
    tangent = [tangent[0] / length, tangent[1] / length, tangent[2] / length];

    if (!normal) {
      const reference: [number, number, number] = Math.abs(tangent[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      normal = normalize(cross(reference, tangent));
    } else {
      // Carry the previous frame forward and re-orthogonalize, rather than
      // rebuilding from a world axis — that is what keeps the sweep untwisted.
      normal = normalize(subtract(normal, scale(tangent, dot(normal, tangent))));
    }
    const right = normal;
    const up = normalize(cross(tangent, right));
    frames.push({ origin: path[index]!, right: [...right], up: [...up] });
  }

  for (const frame of frames) {
    for (const point of ring) {
      builder.vertex([
        frame.origin[0] + frame.right[0] * point[0] + frame.up[0] * point[1],
        frame.origin[1] + frame.right[1] * point[0] + frame.up[1] * point[1],
        frame.origin[2] + frame.right[2] * point[0] + frame.up[2] * point[1],
      ]);
    }
  }

  const sections = closed ? frames.length : frames.length - 1;
  for (let section = 0; section < sections; section += 1) {
    const current = section * ring.length;
    const next = ((section + 1) % frames.length) * ring.length;
    for (let index = 0; index < ring.length; index += 1) {
      const nextIndex = (index + 1) % ring.length;
      builder.quad(current + index, current + nextIndex, next + nextIndex, next + index);
    }
  }

  if ((options.capped ?? true) && !closed) {
    const { points, triangles } = triangulateProfile(value);
    for (const [frameIndex, flip] of [[0, true], [frames.length - 1, false]] as const) {
      const frame = frames[frameIndex]!;
      const base = builder.vertexCount;
      for (const point of points) {
        builder.vertex([
          frame.origin[0] + frame.right[0] * point[0] + frame.up[0] * point[1],
          frame.origin[1] + frame.right[1] * point[0] + frame.up[1] * point[1],
          frame.origin[2] + frame.right[2] * point[0] + frame.up[2] * point[1],
        ]);
      }
      for (let triangle = 0; triangle < triangles.length; triangle += 3) {
        const [a, b, c] = [base + triangles[triangle]!, base + triangles[triangle + 1]!, base + triangles[triangle + 2]!];
        if (flip) builder.triangle(a, c, b);
        else builder.triangle(a, b, c);
      }
    }
  }
  return computeNormals(builder.build(), { smooth: true });
}

/**
 * Lofts between profiles with the same point count.
 *
 * Where a sweep carries one cross-section along a path, a loft blends between
 * different ones — a boat hull, a limb tapering into a hand, an aerofoil.
 */
export function loftProfiles(sections: readonly { profile: Profile; position: readonly [number, number, number] }[]): MeshData {
  if (sections.length < 2) throw new Error("A loft needs at least two sections.");
  const count = sections[0]!.profile.outline.length;
  for (const [index, section] of sections.entries()) {
    if (section.profile.outline.length !== count) {
      throw new Error(`Loft section ${index} has ${section.profile.outline.length} points but section 0 has ${count}. Lofted profiles must match.`);
    }
  }
  const builder = new MeshBuilder();
  for (const section of sections) {
    for (const point of section.profile.outline) {
      builder.vertex([section.position[0] + point[0], section.position[1] + point[1], section.position[2]]);
    }
  }
  for (let section = 0; section + 1 < sections.length; section += 1) {
    const current = section * count;
    const next = (section + 1) * count;
    for (let index = 0; index < count; index += 1) {
      const nextIndex = (index + 1) % count;
      builder.quad(current + index, current + nextIndex, next + nextIndex, next + index);
    }
  }
  return computeNormals(builder.build(), { smooth: true });
}

// --- ear clipping helpers ----------------------------------------------------

function bridgeHole(points: ProfilePoint[], hole: readonly ProfilePoint[]): void {
  // Connect the hole's rightmost point to the nearest visible outline point.
  let holeIndex = 0;
  for (let index = 1; index < hole.length; index += 1) {
    if (hole[index]![0] > hole[holeIndex]![0]) holeIndex = index;
  }
  const anchor = hole[holeIndex]!;
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    if (point[0] < anchor[0]) continue;
    const distance = (point[0] - anchor[0]) ** 2 + (point[1] - anchor[1]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  const bridged: ProfilePoint[] = [];
  for (let index = 0; index < hole.length; index += 1) bridged.push(hole[(holeIndex + index) % hole.length]!);
  bridged.push(hole[holeIndex]!, points[best]!);
  points.splice(best + 1, 0, ...bridged);
}

function isEar(points: readonly ProfilePoint[], indices: readonly number[], previous: number, current: number, next: number): boolean {
  const a = points[previous]!;
  const b = points[current]!;
  const c = points[next]!;
  // A reflex corner cannot be an ear.
  if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) return false;
  for (const index of indices) {
    if (index === previous || index === current || index === next) continue;
    if (pointInTriangle(points[index]!, a, b, c)) return false;
  }
  return true;
}

function pointInTriangle(p: ProfilePoint, a: ProfilePoint, b: ProfilePoint, c: ProfilePoint): boolean {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < EPSILON) return false;
  const s = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / area;
  const t = ((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / area;
  return s > 0 && t > 0 && s + t < 1;
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function subtract(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

function scale(a: readonly number[], factor: number): [number, number, number] {
  return [a[0]! * factor, a[1]! * factor, a[2]! * factor];
}

function normalize(a: readonly number[]): [number, number, number] {
  const length = Math.hypot(a[0]!, a[1]!, a[2]!);
  if (length < EPSILON) return [1, 0, 0];
  return [a[0]! / length, a[1]! / length, a[2]! / length];
}
