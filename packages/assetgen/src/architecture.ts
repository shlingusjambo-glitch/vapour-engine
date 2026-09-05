/** Architecture generation from a structured description.
 *
 * This is the layer the whole asset system exists to enable. A building is
 * described the way a person would describe one — floors, walls between points,
 * doors and windows at offsets, a roof of a named kind — and becomes real
 * geometry with materials, collision, and the metadata navigation needs.
 *
 * The description is deliberately close to how buildings are actually talked
 * about, because that is what makes it writable by an agent that has never seen
 * the result. A wall is two points, a height, and a thickness; an opening is an
 * offset along that wall and a size. Nothing here requires knowing where a
 * vertex goes.
 *
 * What the generator produces beyond triangles matters as much as the geometry:
 * every opening is reported back as an **aperture** with its world position and
 * width, which is what lets navigation place a link through a doorway instead of
 * treating the wall as solid.
 */
import { box } from "./primitives.js";
import { subtractAll, unionAll } from "./csg.js";
import { mergeMeshes, type MeshData } from "./mesh.js";
import { placeMesh, translateMesh } from "./transform.js";

/** Material slots the generator assigns, so a caller can bind real materials. */
export const ARCHITECTURE_SLOTS = {
  wall: 0,
  floor: 1,
  ceiling: 2,
  roof: 3,
  trim: 4,
  stairs: 5,
} as const;

export type OpeningKind = "door" | "window" | "passage";

export interface OpeningSpec {
  readonly kind?: OpeningKind;
  /** Distance along the wall from its start point, to the opening's centre. */
  readonly offset: number;
  readonly width: number;
  readonly height: number;
  /** Height of the opening's base above the floor. Doors use 0. */
  readonly sill?: number;
}

export interface WallSpec {
  /** `[x, z]` in the building's local space. */
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
  readonly height?: number;
  readonly thickness?: number;
  readonly openings?: readonly OpeningSpec[];
  /** Overrides the floor's wall material slot. */
  readonly materialSlot?: number;
}

export interface RoomSpec {
  readonly name: string;
  /** Convex or concave footprint in `[x, z]`, used for navigation and volume. */
  readonly footprint: readonly (readonly [number, number])[];
}

export interface StairSpec {
  /** Bottom-centre of the flight, in `[x, z]`. */
  readonly position: readonly [number, number];
  /** Direction the flight climbs, in degrees about Y. 0 climbs toward -Z. */
  readonly rotation?: number;
  readonly width?: number;
  readonly steps?: number;
  /** Total rise. Defaults to the floor height. */
  readonly rise?: number;
  readonly run?: number;
}

export interface FloorSpec {
  /** Height of this floor's slab above the building's base. */
  readonly level: number;
  /** Wall height on this floor. */
  readonly height: number;
  readonly walls: readonly WallSpec[];
  readonly rooms?: readonly RoomSpec[];
  readonly stairs?: readonly StairSpec[];
  /** Slab thickness. Set 0 for an open floor such as a mezzanine. */
  readonly slabThickness?: number;
  /** Footprint of the slab, in `[x, z]`. Defaults to the walls' bounds. */
  readonly slab?: readonly (readonly [number, number])[];
}

export type RoofKind = "none" | "flat" | "gable" | "hip";

export interface RoofSpec {
  readonly kind: RoofKind;
  /** Height from the top floor's wall top to the ridge. */
  readonly pitchHeight?: number;
  /** How far the roof extends past the walls. */
  readonly overhang?: number;
  readonly thickness?: number;
}

export interface BuildingSpec {
  readonly name?: string;
  readonly floors: readonly FloorSpec[];
  readonly roof?: RoofSpec;
  /** Default wall thickness, overridable per wall. */
  readonly wallThickness?: number;
}

/** A doorway or window, reported in world space for navigation and gameplay. */
export interface Aperture {
  readonly kind: OpeningKind;
  /** Centre of the opening, in the building's local space. */
  readonly position: readonly [number, number, number];
  /** Unit vector along the wall the opening sits in. */
  readonly along: readonly [number, number, number];
  readonly width: number;
  readonly height: number;
  readonly floorIndex: number;
  /** True when an agent can walk through it — the test navigation cares about. */
  readonly walkable: boolean;
}

export interface GeneratedBuilding {
  readonly mesh: MeshData;
  /** Openings, for navigation links and for placing doors and glass. */
  readonly apertures: readonly Aperture[];
  /** Room footprints per floor, for navigation regions and gameplay volumes. */
  readonly rooms: readonly { readonly name: string; readonly floorIndex: number; readonly level: number; readonly footprint: readonly (readonly [number, number])[] }[];
  /** Walkable slab heights, the simplest input a navmesh baker needs. */
  readonly floorLevels: readonly number[];
  readonly stats: { readonly floors: number; readonly walls: number; readonly openings: number; readonly triangles: number };
}

function requirePositive(value: number, label: string): number {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`${label} must be a positive, finite number (got ${value}).`);
  return value;
}

/**
 * Builds one wall, with its openings cut out.
 *
 * The wall is generated along its own axis and then rotated into place, so an
 * opening's `offset` is a plain distance along the wall rather than something
 * the caller has to resolve into world coordinates.
 */
export function generateWall(wall: WallSpec, defaults: { height: number; thickness: number }): { mesh: MeshData; apertures: Omit<Aperture, "floorIndex">[] } {
  const height = requirePositive(wall.height ?? defaults.height, "Wall height");
  const thickness = requirePositive(wall.thickness ?? defaults.thickness, "Wall thickness");
  const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) {
    throw new Error(`A wall from (${wall.start.join(", ")}) to (${wall.end.join(", ")}) has no length.`);
  }
  const angle = Math.atan2(dx, dz);
  const along: [number, number, number] = [dx / length, 0, dz / length];

  // Built centred on the origin running along +Z, then rotated and translated.
  let mesh = box({ width: thickness, height, depth: length });
  const cutters: MeshData[] = [];
  const apertures: Omit<Aperture, "floorIndex">[] = [];

  for (const opening of wall.openings ?? []) {
    const width = requirePositive(opening.width, "Opening width");
    const openingHeight = requirePositive(opening.height, "Opening height");
    const sill = opening.sill ?? 0;
    if (sill < 0) throw new Error("An opening's sill must not be negative.");
    if (sill + openingHeight > height) {
      throw new Error(`An opening of height ${openingHeight} at sill ${sill} does not fit in a wall ${height} high.`);
    }
    const half = width / 2;
    if (opening.offset - half < -1e-9 || opening.offset + half > length + 1e-9) {
      throw new Error(`An opening ${width} wide at offset ${opening.offset} does not fit in a wall ${length} long.`);
    }
    // Centre of the opening in wall-local space: +Z runs from start to end.
    const localZ = opening.offset - length / 2;
    const localY = sill + openingHeight / 2 - height / 2;
    // The cutter is deeper than the wall so it cuts cleanly through both faces.
    cutters.push(translateMesh(box({ width: thickness * 3, height: openingHeight, depth: width }), [0, localY, localZ]));

    const kind = opening.kind ?? (sill === 0 ? "door" : "window");
    apertures.push({
      kind,
      position: [
        wall.start[0] + along[0] * opening.offset,
        sill + openingHeight / 2,
        wall.start[1] + along[2] * opening.offset,
      ],
      along,
      width,
      height: openingHeight,
      // A window with a sill is not a route; a door or passage is.
      walkable: kind !== "window" && sill <= 0.35,
    });
  }

  if (cutters.length > 0) mesh = subtractAll(mesh, cutters);
  const placed = placeMesh(mesh, {
    position: [(wall.start[0] + wall.end[0]) / 2, height / 2, (wall.start[1] + wall.end[1]) / 2],
    rotation: [0, (angle * 180) / Math.PI, 0],
  });
  return { mesh: withSlot(placed, wall.materialSlot ?? ARCHITECTURE_SLOTS.wall), apertures };
}

/** A straight flight of stairs as a stack of boxes. */
export function generateStairs(spec: StairSpec, floorHeight: number): MeshData {
  const steps = spec.steps ?? Math.max(2, Math.round(floorHeight / 0.18));
  if (!Number.isInteger(steps) || steps < 2) throw new Error("A flight of stairs needs at least two steps.");
  const width = requirePositive(spec.width ?? 1.2, "Stair width");
  const rise = requirePositive(spec.rise ?? floorHeight, "Stair rise");
  const run = requirePositive(spec.run ?? 0.28, "Stair run");
  const stepRise = rise / steps;

  const parts: MeshData[] = [];
  for (let step = 0; step < steps; step += 1) {
    // Each tread is a solid block from the ground up, so the flight reads as a
    // staircase from the side and is a valid solid for collision.
    const blockHeight = stepRise * (step + 1);
    parts.push(translateMesh(box({ width, height: blockHeight, depth: run }), [0, blockHeight / 2, -run * (step + 0.5)]));
  }
  const flight = mergeMeshes(parts);
  return withSlot(
    placeMesh(flight, { position: [spec.position[0], 0, spec.position[1]], rotation: [0, spec.rotation ?? 0, 0] }),
    ARCHITECTURE_SLOTS.stairs,
  );
}

/** Axis-aligned bounds of a set of `[x, z]` points. */
function footprintBounds(points: readonly (readonly [number, number])[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (points.length === 0) throw new Error("A footprint needs at least one point.");
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

function withSlot(mesh: MeshData, slot: number): MeshData {
  return { ...mesh, materialSlots: new Uint16Array(mesh.indices.length / 3).fill(slot) };
}

/** Roof geometry over a rectangular footprint. */
export function generateRoof(spec: RoofSpec, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, baseHeight: number): MeshData {
  const overhang = spec.overhang ?? 0.3;
  const thickness = requirePositive(spec.thickness ?? 0.2, "Roof thickness");
  const width = bounds.maxX - bounds.minX + overhang * 2;
  const depth = bounds.maxZ - bounds.minZ + overhang * 2;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  if (spec.kind === "flat") {
    return withSlot(translateMesh(box({ width, height: thickness, depth }), [centerX, baseHeight + thickness / 2, centerZ]), ARCHITECTURE_SLOTS.roof);
  }

  const pitch = requirePositive(spec.pitchHeight ?? 1.5, "Roof pitch height");
  if (spec.kind === "gable") {
    // Two slabs leaning against each other along the ridge, which runs on Z.
    const slope = Math.hypot(width / 2, pitch);
    const angle = (Math.atan2(pitch, width / 2) * 180) / Math.PI;
    const panels: MeshData[] = [];
    for (const side of [-1, 1]) {
      panels.push(
        placeMesh(box({ width: slope, height: thickness, depth }), {
          position: [centerX + (side * width) / 4, baseHeight + pitch / 2, centerZ],
          rotation: [0, 0, side * angle],
        }),
      );
    }
    return withSlot(mergeMeshes(panels), ARCHITECTURE_SLOTS.roof);
  }

  // Hip: four panels meeting at a ridge, approximated by two long and two short.
  const panels: MeshData[] = [];
  const longSlope = Math.hypot(depth / 2, pitch);
  const longAngle = (Math.atan2(pitch, depth / 2) * 180) / Math.PI;
  for (const side of [-1, 1]) {
    panels.push(
      placeMesh(box({ width, height: thickness, depth: longSlope }), {
        position: [centerX, baseHeight + pitch / 2, centerZ + (side * depth) / 4],
        rotation: [-side * longAngle, 0, 0],
      }),
    );
  }
  const shortSlope = Math.hypot(width / 2, pitch);
  const shortAngle = (Math.atan2(pitch, width / 2) * 180) / Math.PI;
  for (const side of [-1, 1]) {
    panels.push(
      placeMesh(box({ width: shortSlope, height: thickness, depth }), {
        position: [centerX + (side * width) / 4, baseHeight + pitch / 2, centerZ],
        rotation: [0, 0, side * shortAngle],
      }),
    );
  }
  return withSlot(mergeMeshes(panels), ARCHITECTURE_SLOTS.roof);
}

/**
 * Generates a whole building from its description.
 *
 * Returns geometry plus the metadata the rest of the engine needs: apertures
 * for navigation links, room footprints for regions, and floor levels for
 * navmesh baking. That coupling is the point — a generated building that
 * physics and navigation cannot use is only half an asset.
 */
export function generateBuilding(spec: BuildingSpec): GeneratedBuilding {
  if (spec.floors.length === 0) throw new Error("A building needs at least one floor.");
  const defaultThickness = spec.wallThickness ?? 0.2;

  const parts: MeshData[] = [];
  const apertures: Aperture[] = [];
  const rooms: { name: string; floorIndex: number; level: number; footprint: readonly (readonly [number, number])[] }[] = [];
  const floorLevels: number[] = [];
  let wallCount = 0;
  let allPoints: [number, number][] = [];
  let topOfWalls = 0;

  for (const [floorIndex, floor] of spec.floors.entries()) {
    const height = requirePositive(floor.height, `Floor ${floorIndex} height`);
    if (!Number.isFinite(floor.level)) throw new Error(`Floor ${floorIndex} needs a finite level.`);
    floorLevels.push(floor.level);

    const wallPoints: [number, number][] = [];
    for (const wall of floor.walls) {
      const built = generateWall(wall, { height, thickness: defaultThickness });
      parts.push(translateMesh(built.mesh, [0, floor.level, 0]));
      wallCount += 1;
      wallPoints.push([wall.start[0], wall.start[1]], [wall.end[0], wall.end[1]]);
      for (const aperture of built.apertures) {
        apertures.push({
          ...aperture,
          position: [aperture.position[0], aperture.position[1] + floor.level, aperture.position[2]],
          floorIndex,
        });
      }
    }
    allPoints = [...allPoints, ...wallPoints];

    const slabThickness = floor.slabThickness ?? 0.2;
    if (slabThickness > 0) {
      const footprint = floor.slab ?? wallPoints;
      if (footprint.length > 0) {
        const bounds = footprintBounds(footprint);
        parts.push(
          withSlot(
            translateMesh(
              box({ width: Math.max(bounds.maxX - bounds.minX, 0.01), height: slabThickness, depth: Math.max(bounds.maxZ - bounds.minZ, 0.01) }),
              [(bounds.minX + bounds.maxX) / 2, floor.level - slabThickness / 2, (bounds.minZ + bounds.maxZ) / 2],
            ),
            ARCHITECTURE_SLOTS.floor,
          ),
        );
      }
    }

    for (const stair of floor.stairs ?? []) {
      parts.push(translateMesh(generateStairs(stair, height), [0, floor.level, 0]));
    }
    for (const room of floor.rooms ?? []) {
      if (room.footprint.length < 3) throw new Error(`Room "${room.name}" needs a footprint of at least three points.`);
      rooms.push({ name: room.name, floorIndex, level: floor.level, footprint: room.footprint });
    }
    topOfWalls = Math.max(topOfWalls, floor.level + height);
  }

  if (spec.roof && spec.roof.kind !== "none" && allPoints.length > 0) {
    parts.push(generateRoof(spec.roof, footprintBounds(allPoints), topOfWalls));
  }

  const mesh = mergeMeshes(parts);
  return {
    mesh,
    apertures,
    rooms,
    floorLevels,
    stats: {
      floors: spec.floors.length,
      walls: wallCount,
      openings: apertures.length,
      triangles: mesh.indices.length / 3,
    },
  };
}

/**
 * A rectangular room's four walls, as a convenience over writing them out.
 *
 * Most generated interiors are boxes, and having to spell out four wall
 * segments for each one is exactly the kind of friction that makes a text
 * format unpleasant to write.
 */
export function rectangularWalls(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  options: { height?: number; thickness?: number; openings?: Partial<Record<"north" | "south" | "east" | "west", readonly OpeningSpec[]>> } = {},
): WallSpec[] {
  if (!(maxX > minX) || !(maxZ > minZ)) throw new Error("A rectangular room needs max greater than min on both axes.");
  const common = {
    ...(options.height === undefined ? {} : { height: options.height }),
    ...(options.thickness === undefined ? {} : { thickness: options.thickness }),
  };
  const openings = options.openings ?? {};
  return [
    { start: [minX, minZ], end: [maxX, minZ], ...common, ...(openings.north ? { openings: openings.north } : {}) },
    { start: [maxX, minZ], end: [maxX, maxZ], ...common, ...(openings.east ? { openings: openings.east } : {}) },
    { start: [maxX, maxZ], end: [minX, maxZ], ...common, ...(openings.south ? { openings: openings.south } : {}) },
    { start: [minX, maxZ], end: [minX, minZ], ...common, ...(openings.west ? { openings: openings.west } : {}) },
  ];
}
