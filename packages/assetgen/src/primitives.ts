/** Parametric primitives.
 *
 * These are the leaves of every generated asset: a building is boxes and
 * extrusions, a character is capsules and lofts, a tree is cylinders and
 * planes. They are parametric rather than fixed so a shape grammar can drive
 * them from numbers it computed, and every one produces a **closed, correctly
 * wound** solid so it can be used directly as a CSG operand and as a physics
 * collider.
 *
 * All primitives are centred on the origin unless stated, because centring is
 * what makes composition predictable: an operator that places a shape does not
 * also have to know where inside its own bounds that shape sits.
 */
import { MeshBuilder, computeNormals, type MeshData } from "./mesh.js";

function requirePositive(value: number, label: string): number {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`${label} must be a positive, finite number (got ${value}).`);
  return value;
}

function requireSegments(value: number, minimum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be a whole number of at least ${minimum} (got ${value}).`);
  }
  return value;
}

export interface BoxOptions {
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
  /** Splits each face into a grid, for later displacement or subdivision. */
  readonly segments?: number;
}

/** An axis-aligned box with per-face UVs and flat normals. */
export function box(options: BoxOptions = {}): MeshData {
  const width = requirePositive(options.width ?? 1, "Box width");
  const height = requirePositive(options.height ?? 1, "Box height");
  const depth = requirePositive(options.depth ?? 1, "Box depth");
  const segments = requireSegments(options.segments ?? 1, 1, "Box segments");
  const [hw, hh, hd] = [width / 2, height / 2, depth / 2];
  const builder = new MeshBuilder();

  // Each face is generated in its own tangent frame so UVs are per-face and a
  // texture never stretches across a corner.
  const faces: readonly { normal: readonly [number, number, number]; origin: readonly [number, number, number]; right: readonly [number, number, number]; up: readonly [number, number, number] }[] = [
    { normal: [0, 0, 1], origin: [-hw, -hh, hd], right: [width, 0, 0], up: [0, height, 0] },
    { normal: [0, 0, -1], origin: [hw, -hh, -hd], right: [-width, 0, 0], up: [0, height, 0] },
    { normal: [1, 0, 0], origin: [hw, -hh, hd], right: [0, 0, -depth], up: [0, height, 0] },
    { normal: [-1, 0, 0], origin: [-hw, -hh, -hd], right: [0, 0, depth], up: [0, height, 0] },
    { normal: [0, 1, 0], origin: [-hw, hh, hd], right: [width, 0, 0], up: [0, 0, -depth] },
    { normal: [0, -1, 0], origin: [-hw, -hh, -hd], right: [width, 0, 0], up: [0, 0, depth] },
  ];

  for (const face of faces) {
    const base = builder.vertexCount;
    for (let row = 0; row <= segments; row += 1) {
      for (let column = 0; column <= segments; column += 1) {
        const u = column / segments;
        const v = row / segments;
        builder.vertex(
          [
            face.origin[0] + face.right[0] * u + face.up[0] * v,
            face.origin[1] + face.right[1] * u + face.up[1] * v,
            face.origin[2] + face.right[2] * u + face.up[2] * v,
          ],
          { normal: face.normal, uv: [u, v] },
        );
      }
    }
    for (let row = 0; row < segments; row += 1) {
      for (let column = 0; column < segments; column += 1) {
        const a = base + row * (segments + 1) + column;
        builder.quad(a, a + 1, a + segments + 2, a + segments + 1);
      }
    }
  }
  return builder.build();
}

export interface SphereOptions {
  readonly radius?: number;
  /** Divisions around the equator. */
  readonly segments?: number;
  /** Divisions from pole to pole. */
  readonly rings?: number;
}

/** A UV sphere with spherical normals and equirectangular UVs. */
export function sphere(options: SphereOptions = {}): MeshData {
  const radius = requirePositive(options.radius ?? 0.5, "Sphere radius");
  const segments = requireSegments(options.segments ?? 24, 3, "Sphere segments");
  const rings = requireSegments(options.rings ?? 16, 2, "Sphere rings");
  const builder = new MeshBuilder();

  for (let ring = 0; ring <= rings; ring += 1) {
    const v = ring / rings;
    const phi = v * Math.PI;
    const [sinPhi, cosPhi] = [Math.sin(phi), Math.cos(phi)];
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const theta = u * Math.PI * 2;
      const normal: [number, number, number] = [Math.cos(theta) * sinPhi, cosPhi, Math.sin(theta) * sinPhi];
      builder.vertex([normal[0] * radius, normal[1] * radius, normal[2] * radius], { normal, uv: [u, 1 - v] });
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      // The pole rings degenerate to a point, so emit only the one real
      // triangle there instead of a zero-area quad.
      if (ring !== 0) builder.triangle(a, a + 1, b);
      if (ring !== rings - 1) builder.triangle(a + 1, b + 1, b);
    }
  }
  return builder.build();
}

export interface CylinderOptions {
  readonly radius?: number;
  /** Radius of the top cap; differs from `radius` to make a cone or frustum. */
  readonly topRadius?: number;
  readonly height?: number;
  readonly segments?: number;
  readonly capped?: boolean;
}

/** A cylinder, cone, or frustum depending on the two radii. */
export function cylinder(options: CylinderOptions = {}): MeshData {
  const radius = options.radius ?? 0.5;
  const topRadius = options.topRadius ?? radius;
  if (!(radius >= 0) || !(topRadius >= 0)) throw new Error("Cylinder radii must not be negative.");
  if (radius === 0 && topRadius === 0) throw new Error("A cylinder needs at least one non-zero radius.");
  const height = requirePositive(options.height ?? 1, "Cylinder height");
  const segments = requireSegments(options.segments ?? 24, 3, "Cylinder segments");
  const capped = options.capped ?? true;
  const builder = new MeshBuilder();
  const [halfHeight, slope] = [height / 2, radius - topRadius];
  // Side normals tilt with the slope; using a purely radial normal is the usual
  // mistake and makes a cone shade like a cylinder.
  const normalY = slope / Math.hypot(slope, height);
  const normalScale = height / Math.hypot(slope, height);

  const sideBase = builder.vertexCount;
  for (let ring = 0; ring <= 1; ring += 1) {
    const currentRadius = ring === 0 ? radius : topRadius;
    const y = ring === 0 ? -halfHeight : halfHeight;
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const theta = u * Math.PI * 2;
      const [cos, sin] = [Math.cos(theta), Math.sin(theta)];
      builder.vertex([cos * currentRadius, y, sin * currentRadius], {
        normal: [cos * normalScale, normalY, sin * normalScale],
        uv: [u, ring],
      });
    }
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const a = sideBase + segment;
    const b = a + segments + 1;
    if (radius > 0) builder.triangle(a, b, a + 1);
    if (topRadius > 0) builder.triangle(a + 1, b, b + 1);
  }

  if (capped) {
    for (const [ring, currentRadius] of [[0, radius], [1, topRadius]] as const) {
      if (currentRadius === 0) continue;
      const y = ring === 0 ? -halfHeight : halfHeight;
      const normal: [number, number, number] = ring === 0 ? [0, -1, 0] : [0, 1, 0];
      const center = builder.vertex([0, y, 0], { normal, uv: [0.5, 0.5] });
      const rim: number[] = [];
      for (let segment = 0; segment < segments; segment += 1) {
        const theta = (segment / segments) * Math.PI * 2;
        const [cos, sin] = [Math.cos(theta), Math.sin(theta)];
        rim.push(builder.vertex([cos * currentRadius, y, sin * currentRadius], { normal, uv: [cos * 0.5 + 0.5, sin * 0.5 + 0.5] }));
      }
      for (let segment = 0; segment < segments; segment += 1) {
        const a = rim[segment]!;
        const b = rim[(segment + 1) % segments]!;
        // The rim runs counter-clockwise seen from +Y, so the bottom cap keeps
        // that order and the top cap reverses it to face outward.
        if (ring === 0) builder.triangle(center, a, b);
        else builder.triangle(center, b, a);
      }
    }
  }
  return builder.build();
}

export interface PlaneOptions {
  readonly width?: number;
  readonly depth?: number;
  readonly segments?: number;
  /** `y` for a ground plane, `z` for a wall or sprite quad. */
  readonly up?: "y" | "z";
}

/** A subdivided plane, the base for terrain, water, walls, and sprites. */
export function plane(options: PlaneOptions = {}): MeshData {
  const width = requirePositive(options.width ?? 1, "Plane width");
  const depth = requirePositive(options.depth ?? 1, "Plane depth");
  const segments = requireSegments(options.segments ?? 1, 1, "Plane segments");
  const up = options.up ?? "y";
  const builder = new MeshBuilder();
  const normal: [number, number, number] = up === "y" ? [0, 1, 0] : [0, 0, 1];

  for (let row = 0; row <= segments; row += 1) {
    for (let column = 0; column <= segments; column += 1) {
      const u = column / segments;
      const v = row / segments;
      const x = (u - 0.5) * width;
      const secondary = (v - 0.5) * depth;
      builder.vertex(up === "y" ? [x, 0, -secondary] : [x, secondary, 0], { normal, uv: [u, v] });
    }
  }
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const a = row * (segments + 1) + column;
      builder.quad(a, a + 1, a + segments + 2, a + segments + 1);
    }
  }
  return builder.build();
}

export interface CapsuleOptions {
  readonly radius?: number;
  /** Length of the cylindrical section, excluding the hemispherical caps. */
  readonly height?: number;
  readonly segments?: number;
  readonly rings?: number;
}

/**
 * A capsule: the shape character controllers and limb colliders actually use.
 *
 * Built as one continuous surface rather than a cylinder with two spheres
 * stuck on, so it welds cleanly and stays closed.
 */
export function capsule(options: CapsuleOptions = {}): MeshData {
  const radius = requirePositive(options.radius ?? 0.5, "Capsule radius");
  const height = requirePositive(options.height ?? 1, "Capsule height");
  const segments = requireSegments(options.segments ?? 24, 3, "Capsule segments");
  const rings = requireSegments(options.rings ?? 8, 2, "Capsule rings");
  const builder = new MeshBuilder();
  const halfHeight = height / 2;

  // Rows: bottom hemisphere, then the two cylinder seams, then the top.
  const rows: { y: number; normalY: number; scale: number; v: number }[] = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * (Math.PI / 2);
    rows.push({ y: -halfHeight - Math.cos(phi) * radius, normalY: -Math.cos(phi), scale: Math.sin(phi), v: (ring / rings) * 0.25 });
  }
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * (Math.PI / 2);
    rows.push({ y: halfHeight + Math.sin(phi) * radius, normalY: Math.sin(phi), scale: Math.cos(phi), v: 0.75 + (ring / rings) * 0.25 });
  }
  // The seam between the hemispheres carries the cylindrical section.
  rows.splice(rings + 1, 0, { y: halfHeight, normalY: 0, scale: 1, v: 0.75 });
  rows.splice(rings + 1, 0, { y: -halfHeight, normalY: 0, scale: 1, v: 0.25 });

  for (const row of rows) {
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const theta = u * Math.PI * 2;
      const [cos, sin] = [Math.cos(theta), Math.sin(theta)];
      builder.vertex([cos * row.scale * radius, row.y, sin * row.scale * radius], {
        normal: [cos * row.scale, row.normalY, sin * row.scale],
        uv: [u, row.v],
      });
    }
  }
  for (let row = 0; row + 1 < rows.length; row += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = row * (segments + 1) + segment;
      const b = a + segments + 1;
      if (rows[row]!.scale > 1e-6) builder.triangle(a, a + 1, b);
      if (rows[row + 1]!.scale > 1e-6) builder.triangle(a + 1, b + 1, b);
    }
  }
  return builder.build();
}

export interface TorusOptions {
  readonly radius?: number;
  readonly tubeRadius?: number;
  readonly segments?: number;
  readonly tubeSegments?: number;
}

export function torus(options: TorusOptions = {}): MeshData {
  const radius = requirePositive(options.radius ?? 0.5, "Torus radius");
  const tubeRadius = requirePositive(options.tubeRadius ?? 0.15, "Torus tube radius");
  const segments = requireSegments(options.segments ?? 32, 3, "Torus segments");
  const tubeSegments = requireSegments(options.tubeSegments ?? 12, 3, "Torus tube segments");
  const builder = new MeshBuilder();

  for (let ring = 0; ring <= segments; ring += 1) {
    const u = ring / segments;
    const theta = u * Math.PI * 2;
    const [cosT, sinT] = [Math.cos(theta), Math.sin(theta)];
    for (let tube = 0; tube <= tubeSegments; tube += 1) {
      const v = tube / tubeSegments;
      const phi = v * Math.PI * 2;
      const [cosP, sinP] = [Math.cos(phi), Math.sin(phi)];
      const normal: [number, number, number] = [cosT * cosP, sinP, sinT * cosP];
      builder.vertex(
        [cosT * (radius + tubeRadius * cosP), tubeRadius * sinP, sinT * (radius + tubeRadius * cosP)],
        { normal, uv: [u, v] },
      );
    }
  }
  for (let ring = 0; ring < segments; ring += 1) {
    for (let tube = 0; tube < tubeSegments; tube += 1) {
      const a = ring * (tubeSegments + 1) + tube;
      const b = a + tubeSegments + 1;
      builder.quad(a, a + 1, b + 1, b);
    }
  }
  return builder.build();
}

/** A cone, expressed as a cylinder with a zero top radius. */
export function cone(options: { radius?: number; height?: number; segments?: number } = {}): MeshData {
  return cylinder({ ...options, topRadius: 0 });
}

/** Re-derives smooth normals; a convenience for generators that build raw
 * geometry and want shading without tracking normals themselves. */
export function smoothed(mesh: MeshData): MeshData {
  return computeNormals(mesh, { smooth: true });
}
