/** Constructive solid geometry: union, subtraction, and intersection.
 *
 * This is what turns a library of shapes into a modelling language. A wall with
 * a window is a box minus a box. A room is a box hollowed by a smaller box. A
 * pipe is a cylinder minus a cylinder. A doorway, an arch, a bevel, a mortise,
 * a bullet hole, a cave mouth — all of them are one solid minus another, and
 * none of them is expressible by placing primitives alone.
 *
 * The implementation is the classic BSP approach: each solid becomes a binary
 * space partition of its polygons, the two trees clip each other, and the
 * surviving polygons are recombined. It is well understood, it produces exact
 * results for the polyhedra generators actually produce, and — importantly for
 * generated content — it fails loudly on degenerate input rather than emitting
 * subtly broken geometry.
 *
 * Operands must be **closed solids**. An open surface has no inside, so "what
 * is inside A but outside B" is undefined; {@link isClosed} is checked up front
 * so that mistake is reported here rather than as holes in the result.
 */
import { MeshBuilder, isClosed, repairTJunctions, validateMesh, weldVertices, type MeshData } from "./mesh.js";

/** Distance below which a point counts as lying on a plane.
 *
 * The single most important constant in CSG. Too small and coplanar faces
 * produce slivers and cracks; too large and thin geometry collapses. This value
 * suits assets authored in metres, which is Vapour's convention. */
const PLANE_EPSILON = 1e-5;

const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

interface Vertex {
  readonly position: [number, number, number];
  readonly normal: [number, number, number];
  readonly uv: [number, number];
}

interface Plane {
  readonly normal: [number, number, number];
  readonly w: number;
}

interface Polygon {
  readonly vertices: Vertex[];
  readonly plane: Plane;
  readonly slot: number;
}

function planeFromPoints(a: Vertex, b: Vertex, c: Vertex): Plane | undefined {
  const ux = b.position[0] - a.position[0];
  const uy = b.position[1] - a.position[1];
  const uz = b.position[2] - a.position[2];
  const vx = c.position[0] - a.position[0];
  const vy = c.position[1] - a.position[1];
  const vz = c.position[2] - a.position[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  // A degenerate triangle has no plane; dropping it is correct, because it
  // contributes no surface and would otherwise poison the partition.
  if (length < 1e-12) return undefined;
  const normal: [number, number, number] = [nx / length, ny / length, nz / length];
  return { normal, w: normal[0] * a.position[0] + normal[1] * a.position[1] + normal[2] * a.position[2] };
}

function interpolate(a: Vertex, b: Vertex, t: number): Vertex {
  return {
    position: [
      a.position[0] + (b.position[0] - a.position[0]) * t,
      a.position[1] + (b.position[1] - a.position[1]) * t,
      a.position[2] + (b.position[2] - a.position[2]) * t,
    ],
    normal: [
      a.normal[0] + (b.normal[0] - a.normal[0]) * t,
      a.normal[1] + (b.normal[1] - a.normal[1]) * t,
      a.normal[2] + (b.normal[2] - a.normal[2]) * t,
    ],
    uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t],
  };
}

function flipPolygon(polygon: Polygon): Polygon {
  return {
    vertices: [...polygon.vertices].reverse().map((vertex) => ({
      position: vertex.position,
      normal: [-vertex.normal[0], -vertex.normal[1], -vertex.normal[2]] as [number, number, number],
      uv: vertex.uv,
    })),
    plane: { normal: [-polygon.plane.normal[0], -polygon.plane.normal[1], -polygon.plane.normal[2]], w: -polygon.plane.w },
    slot: polygon.slot,
  };
}

/**
 * Splits a polygon against a plane, appending the pieces to the right lists.
 *
 * Coplanar polygons are sorted by whether they face the same way as the plane,
 * which is what makes coincident faces — two boxes sharing a wall — resolve to
 * a single surface instead of z-fighting.
 */
function splitPolygon(
  plane: Plane,
  polygon: Polygon,
  coplanarFront: Polygon[],
  coplanarBack: Polygon[],
  front: Polygon[],
  back: Polygon[],
): void {
  let polygonType = 0;
  const types: number[] = [];
  for (const vertex of polygon.vertices) {
    const distance =
      plane.normal[0] * vertex.position[0] + plane.normal[1] * vertex.position[1] + plane.normal[2] * vertex.position[2] - plane.w;
    const type = distance < -PLANE_EPSILON ? BACK : distance > PLANE_EPSILON ? FRONT : COPLANAR;
    polygonType |= type;
    types.push(type);
  }

  if (polygonType === COPLANAR) {
    const facing =
      plane.normal[0] * polygon.plane.normal[0] + plane.normal[1] * polygon.plane.normal[1] + plane.normal[2] * polygon.plane.normal[2];
    (facing > 0 ? coplanarFront : coplanarBack).push(polygon);
    return;
  }
  if (polygonType === FRONT) {
    front.push(polygon);
    return;
  }
  if (polygonType === BACK) {
    back.push(polygon);
    return;
  }

  const frontVertices: Vertex[] = [];
  const backVertices: Vertex[] = [];
  for (let index = 0; index < polygon.vertices.length; index += 1) {
    const next = (index + 1) % polygon.vertices.length;
    const currentType = types[index]!;
    const nextType = types[next]!;
    const current = polygon.vertices[index]!;
    const following = polygon.vertices[next]!;
    if (currentType !== BACK) frontVertices.push(current);
    if (currentType !== FRONT) backVertices.push(current);
    if ((currentType | nextType) === SPANNING) {
      const currentDistance =
        plane.normal[0] * current.position[0] + plane.normal[1] * current.position[1] + plane.normal[2] * current.position[2] - plane.w;
      const nextDistance =
        plane.normal[0] * following.position[0] + plane.normal[1] * following.position[1] + plane.normal[2] * following.position[2] - plane.w;
      const t = currentDistance / (currentDistance - nextDistance);
      const split = interpolate(current, following, t);
      frontVertices.push(split);
      backVertices.push(split);
    }
  }
  if (frontVertices.length >= 3) front.push({ vertices: frontVertices, plane: polygon.plane, slot: polygon.slot });
  if (backVertices.length >= 3) back.push({ vertices: backVertices, plane: polygon.plane, slot: polygon.slot });
}

/** A node of the binary space partition. */
class Node {
  plane: Plane | undefined;
  front: Node | undefined;
  back: Node | undefined;
  polygons: Polygon[] = [];

  constructor(polygons?: Polygon[]) {
    if (polygons && polygons.length > 0) this.build(polygons);
  }

  invert(): void {
    this.polygons = this.polygons.map(flipPolygon);
    if (this.plane) this.plane = { normal: [-this.plane.normal[0], -this.plane.normal[1], -this.plane.normal[2]], w: -this.plane.w };
    this.front?.invert();
    this.back?.invert();
    const swap = this.front;
    this.front = this.back;
    this.back = swap;
  }

  /** Removes the parts of `polygons` that lie inside this solid. */
  clipPolygons(polygons: Polygon[]): Polygon[] {
    if (!this.plane) return [...polygons];
    let front: Polygon[] = [];
    let back: Polygon[] = [];
    for (const polygon of polygons) splitPolygon(this.plane, polygon, front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    // With no back child, everything behind the plane is inside the solid and
    // is therefore discarded — this is where subtraction actually happens.
    back = this.back ? this.back.clipPolygons(back) : [];
    return [...front, ...back];
  }

  clipTo(other: Node): void {
    this.polygons = other.clipPolygons(this.polygons);
    this.front?.clipTo(other);
    this.back?.clipTo(other);
  }

  allPolygons(): Polygon[] {
    return [...this.polygons, ...(this.front?.allPolygons() ?? []), ...(this.back?.allPolygons() ?? [])];
  }

  build(polygons: Polygon[]): void {
    if (polygons.length === 0) return;
    this.plane ??= polygons[0]!.plane;
    const front: Polygon[] = [];
    const back: Polygon[] = [];
    for (const polygon of polygons) splitPolygon(this.plane, polygon, this.polygons, this.polygons, front, back);
    if (front.length > 0) {
      this.front ??= new Node();
      this.front.build(front);
    }
    if (back.length > 0) {
      this.back ??= new Node();
      this.back.build(back);
    }
  }
}

function toPolygons(mesh: MeshData, label: string): Polygon[] {
  validateMesh(mesh, label);
  if (!isClosed(weldVertices(mesh))) {
    throw new Error(
      `The ${label} is not a closed solid, so it has no inside and cannot be used in a boolean operation. Weld its seams, or cap the open ends of an extrusion or sweep.`,
    );
  }
  const polygons: Polygon[] = [];
  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    const vertices: Vertex[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = mesh.indices[triangle * 3 + corner]!;
      vertices.push({
        position: [mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!],
        normal: mesh.normals
          ? [mesh.normals[index * 3]!, mesh.normals[index * 3 + 1]!, mesh.normals[index * 3 + 2]!]
          : [0, 1, 0],
        uv: mesh.uvs ? [mesh.uvs[index * 2]!, mesh.uvs[index * 2 + 1]!] : [0, 0],
      });
    }
    const plane = planeFromPoints(vertices[0]!, vertices[1]!, vertices[2]!);
    if (!plane) continue;
    polygons.push({ vertices, plane, slot: mesh.materialSlots?.[triangle] ?? 0 });
  }
  if (polygons.length === 0) throw new Error(`The ${label} has no non-degenerate triangles.`);
  return polygons;
}

function toMesh(polygons: readonly Polygon[]): MeshData {
  const builder = new MeshBuilder();
  for (const polygon of polygons) {
    builder.setMaterialSlot(polygon.slot);
    const indices = polygon.vertices.map((vertex) =>
      builder.vertex(vertex.position, { normal: vertex.normal, uv: vertex.uv }),
    );
    // Splitting produces convex polygons, so a fan is a valid triangulation.
    builder.polygon(indices);
  }
  return builder.build();
}

export interface BooleanOptions {
  /** Weld the result. On by default: boolean output is full of split-edge
   * duplicates, and leaving them makes the mesh look open and shade badly. */
  readonly weld?: boolean;
  readonly weldTolerance?: number;
  /**
   * Repair T-junctions in the result. On by default, because without it the
   * output is geometrically watertight but topologically open, which makes it
   * unusable as a later CSG operand and leaky as a physics collider.
   */
  readonly repair?: boolean;
}

function finish(polygons: readonly Polygon[], options: BooleanOptions): MeshData {
  let mesh = toMesh(polygons);
  if (mesh.indices.length === 0) return mesh;
  if (options.weld ?? true) mesh = weldVertices(mesh, options.weldTolerance ?? 1e-5);
  if (options.repair ?? true) mesh = repairTJunctions(mesh, (options.weldTolerance ?? 1e-5) / 10);
  return mesh;
}

/** Everything inside either solid. */
export function union(a: MeshData, b: MeshData, options: BooleanOptions = {}): MeshData {
  const nodeA = new Node(toPolygons(a, "first operand"));
  const nodeB = new Node(toPolygons(b, "second operand"));
  nodeA.clipTo(nodeB);
  nodeB.clipTo(nodeA);
  // Removing B's faces that coincide with A's is what prevents a doubled
  // surface where the two solids touch.
  nodeB.invert();
  nodeB.clipTo(nodeA);
  nodeB.invert();
  nodeA.build(nodeB.allPolygons());
  return finish(nodeA.allPolygons(), options);
}

/** Everything inside `a` and outside `b`. The workhorse: walls minus windows. */
export function subtract(a: MeshData, b: MeshData, options: BooleanOptions = {}): MeshData {
  const nodeA = new Node(toPolygons(a, "first operand"));
  const nodeB = new Node(toPolygons(b, "second operand"));
  nodeA.invert();
  nodeA.clipTo(nodeB);
  nodeB.clipTo(nodeA);
  nodeB.invert();
  nodeB.clipTo(nodeA);
  nodeB.invert();
  nodeA.build(nodeB.allPolygons());
  nodeA.invert();
  return finish(nodeA.allPolygons(), options);
}

/** Everything inside both solids. */
export function intersect(a: MeshData, b: MeshData, options: BooleanOptions = {}): MeshData {
  const nodeA = new Node(toPolygons(a, "first operand"));
  const nodeB = new Node(toPolygons(b, "second operand"));
  nodeA.invert();
  nodeB.clipTo(nodeA);
  nodeB.invert();
  nodeA.clipTo(nodeB);
  nodeB.clipTo(nodeA);
  nodeA.build(nodeB.allPolygons());
  nodeA.invert();
  return finish(nodeA.allPolygons(), options);
}

/** Subtracts many solids in turn. Cutting twenty windows from a facade is one
 * call rather than twenty nested ones. */
export function subtractAll(base: MeshData, cutters: readonly MeshData[], options: BooleanOptions = {}): MeshData {
  // Weld only at the end: welding between every cut costs time and can round
  // away the thin features a later cut still needs.
  let result = base;
  // Repair between cuts as well: a later cut needs a closed operand, and the
  // repair is what keeps the intermediate result usable.
  for (const cutter of cutters) result = subtract(result, cutter, { ...options, weld: true });
  return result;
}

/** Unions many solids into one. */
export function unionAll(meshes: readonly MeshData[], options: BooleanOptions = {}): MeshData {
  if (meshes.length === 0) throw new Error("unionAll needs at least one mesh.");
  let result = meshes[0]!;
  for (let index = 1; index < meshes.length; index += 1) result = union(result, meshes[index]!, { ...options, weld: true });
  return result;
}
