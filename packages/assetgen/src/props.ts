/** Props, vehicles, and weapons: the objects a scene is furnished with.
 *
 * Architecture gives a level its shell and vegetation gives it a landscape, but
 * a world is only inhabited once there are crates to hide behind, a car parked
 * at the kerb, and something in the player's hands. Those are exactly the assets
 * a small team never has time to author and an agent cannot draw.
 *
 * Every generator here returns geometry *plus the metadata that makes it
 * usable*, which is the part that distinguishes an asset from a mesh:
 *
 * - a prop reports the collision shape that suits it, so a crate becomes a box
 *   collider and a bench a convex hull without anyone deciding per instance,
 * - a vehicle reports its wheel positions, radii, and which pair steers, which
 *   is precisely the input a raycast vehicle controller needs,
 * - a weapon reports its grip and its tip, so it attaches to a hand socket and
 *   spawns its muzzle flash or traces its swing arc without hand-placed markers.
 *
 * All of it is deterministic under a seed: the same description produces the
 * same object on every machine, so a networked game replicates the seed.
 */
import type { CollisionKind } from "./compile.js";
import { subtract } from "./csg.js";
import { computeNormals, mergeMeshes, type MeshData } from "./mesh.js";
import { seededRandom } from "./nature.js";
import { box, cylinder, sphere, torus } from "./primitives.js";
import { extrudeProfile, profile, revolveProfile, type ProfilePoint } from "./profile.js";
import { meshBounds, placeMesh, translateMesh } from "./transform.js";

/** Material slots these generators assign, so a caller can bind real materials. */
export const PROP_SLOTS = { metal: 0, wood: 1, glass: 2, fabric: 3, stone: 4, light: 5, rubber: 6 } as const;

export type PropKind = "crate" | "barrel" | "bench" | "table" | "lamppost" | "fence" | "sign" | "planter";

export const PROP_KINDS: readonly PropKind[] = ["crate", "barrel", "bench", "table", "lamppost", "fence", "sign", "planter"];

export interface PropSpec {
  readonly kind: PropKind;
  /** Overall size in metres. Each prop interprets it sensibly for its shape. */
  readonly size?: number;
  /** Length of a run, for the props that repeat: `fence`. */
  readonly length?: number;
  readonly seed?: number;
  readonly segments?: number;
}

export interface GeneratedProp {
  readonly kind: PropKind;
  readonly mesh: MeshData;
  /** The collision shape this prop should use. A crate is a box; a bench is not. */
  readonly collision: CollisionKind;
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
  readonly stats: { readonly triangles: number; readonly parts: number };
}

/**
 * Builds a prop from its kind and a size.
 *
 * Every prop sits on `y = 0` with its footprint centred on the origin, because
 * a placement operator that also has to know where inside its own bounds an
 * asset sits is a placement operator nobody can compose.
 */
export function generateProp(spec: PropSpec): GeneratedProp {
  const size = requirePositive(spec.size ?? 1, "Prop size");
  const segments = spec.segments ?? 12;
  if (!Number.isInteger(segments) || segments < 3) throw new Error("A prop needs at least three segments.");
  const random = seededRandom(spec.seed ?? 1);
  const parts: MeshData[] = [];
  let collision: CollisionKind = "convex";

  switch (spec.kind) {
    case "crate": {
      collision = "box";
      parts.push(withSlot(translateMesh(box({ width: size, height: size, depth: size }), [0, size / 2, 0]), PROP_SLOTS.wood));
      // Corner battens: four uprights and eight rails. Cheap, and they are what
      // makes a cube read as a crate instead of a placeholder. Both sit half
      // proud of the panel: flush battens share their corner vertices with the
      // box, and welding those fuses the shells into an open mesh.
      const batten = size * 0.09;
      for (const x of [-1, 1]) {
        for (const z of [-1, 1]) {
          parts.push(
            withSlot(
              translateMesh(box({ width: batten, height: size, depth: batten }), [(x * size) / 2, size / 2, (z * size) / 2]),
              PROP_SLOTS.wood,
            ),
          );
        }
      }
      for (const y of [batten, size - batten]) {
        for (const [w, d] of [[size, batten], [batten, size]] as const) {
          for (const side of [-1, 1]) {
            parts.push(
              withSlot(
                translateMesh(box({ width: w, height: batten, depth: d }), [
                  w === batten ? (side * size) / 2 : 0,
                  y,
                  d === batten ? (side * size) / 2 : 0,
                ]),
                PROP_SLOTS.wood,
              ),
            );
          }
        }
      }
      break;
    }
    case "barrel": {
      // A revolved silhouette: barrels bulge, and a plain cylinder never reads
      // as one no matter what texture is on it.
      const radius = size * 0.32;
      const height = size;
      const outline: ProfilePoint[] = [
        [0, 0], [radius * 0.86, 0], [radius, height * 0.3], [radius, height * 0.7],
        [radius * 0.86, height], [0, height],
      ];
      parts.push(withSlot(revolveProfile(outline, { segments: segments * 2 }), PROP_SLOTS.wood));
      for (const y of [height * 0.25, height * 0.75]) {
        parts.push(withSlot(translateMesh(torus({ radius: radius * 1.02, tubeRadius: size * 0.022, segments: segments * 2, tubeSegments: 6 }), [0, y, 0]), PROP_SLOTS.metal));
      }
      break;
    }
    case "bench": {
      const width = size * 1.6;
      const seatHeight = size * 0.45;
      parts.push(withSlot(translateMesh(box({ width, height: size * 0.06, depth: size * 0.45 }), [0, seatHeight, 0]), PROP_SLOTS.wood));
      parts.push(
        withSlot(
          placeMesh(box({ width, height: size * 0.05, depth: size * 0.4 }), { position: [0, seatHeight + size * 0.32, -size * 0.19], rotation: [-15, 0, 0] }),
          PROP_SLOTS.wood,
        ),
      );
      for (const x of [-1, 1]) {
        parts.push(withSlot(translateMesh(box({ width: size * 0.06, height: seatHeight, depth: size * 0.4 }), [(x * width) / 2.4, seatHeight / 2, 0]), PROP_SLOTS.metal));
      }
      break;
    }
    case "table": {
      const width = size * 1.4;
      const depth = size * 0.8;
      const top = size * 0.75;
      parts.push(withSlot(translateMesh(box({ width, height: size * 0.05, depth }), [0, top, 0]), PROP_SLOTS.wood));
      for (const x of [-1, 1]) {
        for (const z of [-1, 1]) {
          parts.push(
            withSlot(translateMesh(box({ width: size * 0.07, height: top, depth: size * 0.07 }), [(x * (width - size * 0.2)) / 2, top / 2, (z * (depth - size * 0.2)) / 2]), PROP_SLOTS.wood),
          );
        }
      }
      break;
    }
    case "lamppost": {
      collision = "mesh";
      const height = size * 4;
      parts.push(withSlot(translateMesh(cylinder({ radius: size * 0.06, topRadius: size * 0.045, height, segments }), [0, height / 2, 0]), PROP_SLOTS.metal));
      parts.push(withSlot(translateMesh(cylinder({ radius: size * 0.24, height: size * 0.1, segments }), [0, size * 0.05, 0]), PROP_SLOTS.metal));
      parts.push(withSlot(placeMesh(cylinder({ radius: size * 0.035, height: size * 0.7, segments }), { position: [size * 0.3, height - size * 0.1, 0], rotation: [0, 0, 90] }), PROP_SLOTS.metal));
      parts.push(withSlot(translateMesh(sphere({ radius: size * 0.16, segments, rings: Math.max(3, segments / 2) }), [size * 0.62, height - size * 0.18, 0]), PROP_SLOTS.light));
      break;
    }
    case "fence": {
      collision = "mesh";
      const length = requirePositive(spec.length ?? size * 6, "Fence length");
      const postSpacing = size * 1.5;
      const posts = Math.max(2, Math.round(length / postSpacing) + 1);
      const step = length / (posts - 1);
      for (let index = 0; index < posts; index += 1) {
        const x = -length / 2 + step * index;
        // A little seeded lean per post: a perfectly straight fence is the most
        // obvious tell that geometry was generated.
        parts.push(
          withSlot(
            placeMesh(box({ width: size * 0.1, height: size, depth: size * 0.1 }), { position: [x, size / 2, 0], rotation: [0, 0, (random() - 0.5) * 4] }),
            PROP_SLOTS.wood,
          ),
        );
      }
      for (const y of [size * 0.3, size * 0.75]) {
        parts.push(withSlot(translateMesh(box({ width: length, height: size * 0.08, depth: size * 0.05 }), [0, y, 0]), PROP_SLOTS.wood));
      }
      break;
    }
    case "sign": {
      collision = "mesh";
      const height = size * 2.2;
      parts.push(withSlot(translateMesh(cylinder({ radius: size * 0.045, height, segments }), [0, height / 2, 0]), PROP_SLOTS.metal));
      parts.push(withSlot(translateMesh(box({ width: size * 1.2, height: size * 0.7, depth: size * 0.05 }), [0, height - size * 0.4, 0]), PROP_SLOTS.metal));
      break;
    }
    case "planter": {
      // Hollow, so a camera looking down into it sees a container rather than a
      // solid block. This is the one prop worth a boolean.
      const shell = translateMesh(box({ width: size, height: size * 0.6, depth: size }), [0, size * 0.3, 0]);
      const cavity = translateMesh(box({ width: size * 0.84, height: size * 0.5, depth: size * 0.84 }), [0, size * 0.4, 0]);
      parts.push(withSlot(subtract(shell, cavity), PROP_SLOTS.stone));
      break;
    }
  }

  if (parts.length === 0) throw new Error(`Unknown prop kind "${String(spec.kind)}". Kinds are ${PROP_KINDS.join(", ")}.`);
  const mesh = mergeMeshes(parts);
  const bounds = meshBounds(mesh);
  return {
    kind: spec.kind,
    mesh,
    collision,
    bounds: { min: bounds.min as [number, number, number], max: bounds.max as [number, number, number] },
    stats: { triangles: mesh.indices.length / 3, parts: parts.length },
  };
}

export type VehicleKind = "car" | "van" | "truck" | "bus";

export const VEHICLE_KINDS: readonly VehicleKind[] = ["car", "van", "truck", "bus"];

export interface VehicleSpec {
  readonly kind?: VehicleKind;
  /** Overrides the kind's default length in metres. */
  readonly length?: number;
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
  readonly segments?: number;
}

/** Where a wheel goes, and whether it turns. Exactly what a raycast vehicle wants. */
export interface WheelPlacement {
  readonly position: readonly [number, number, number];
  readonly radius: number;
  readonly width: number;
  readonly steering: boolean;
  readonly driven: boolean;
}

export interface GeneratedVehicle {
  readonly kind: VehicleKind;
  /** Chassis and cabin, with the wheels *excluded* so they can rotate. */
  readonly body: MeshData;
  /** One wheel, centred on the origin, its axle along X. */
  readonly wheel: MeshData;
  readonly wheels: readonly WheelPlacement[];
  /** Body and wheels merged, for a static or distant instance. */
  readonly mesh: MeshData;
  readonly size: readonly [number, number, number];
  readonly stats: { readonly triangles: number; readonly wheels: number };
}

const VEHICLE_DEFAULTS: Readonly<Record<VehicleKind, { length: number; width: number; height: number; axles: number; cabinFraction: number }>> = {
  car: { length: 4.3, width: 1.8, height: 1.45, axles: 2, cabinFraction: 0.45 },
  van: { length: 5.2, width: 2, height: 2.2, axles: 2, cabinFraction: 0.8 },
  truck: { length: 8.5, width: 2.5, height: 3.2, axles: 3, cabinFraction: 0.3 },
  bus: { length: 11, width: 2.5, height: 3.1, axles: 3, cabinFraction: 0.95 },
};

/**
 * A vehicle as a body plus separately-returned wheels.
 *
 * Keeping the wheels out of the body mesh is the whole design: a wheel welded
 * into the chassis cannot spin or steer, so a "vehicle" that ships as one mesh
 * is a prop. The placements carry the radius and the steering flag, which means
 * a physics vehicle can be configured from the asset instead of from constants
 * a human copied out of it.
 */
export function generateVehicle(spec: VehicleSpec = {}): GeneratedVehicle {
  const kind = spec.kind ?? "car";
  const defaults = VEHICLE_DEFAULTS[kind];
  if (defaults === undefined) throw new Error(`Unknown vehicle kind "${String(kind)}". Kinds are ${VEHICLE_KINDS.join(", ")}.`);
  const length = requirePositive(spec.length ?? defaults.length, "Vehicle length");
  const width = requirePositive(spec.width ?? defaults.width, "Vehicle width");
  const height = requirePositive(spec.height ?? defaults.height, "Vehicle height");
  const segments = spec.segments ?? 12;
  if (!Number.isInteger(segments) || segments < 3) throw new Error("A vehicle needs at least three wheel segments.");
  const random = seededRandom(spec.seed ?? 1);

  const wheelRadius = Math.min(height * 0.26, length * 0.09);
  const wheelWidth = width * 0.13;
  const chassisHeight = height * (kind === "car" ? 0.42 : 0.55);
  const chassisY = wheelRadius + chassisHeight / 2;

  const parts: MeshData[] = [
    withSlot(translateMesh(box({ width, height: chassisHeight, depth: length }), [0, chassisY, 0]), PROP_SLOTS.metal),
  ];
  // The cabin sits forward on a truck and covers the whole body on a bus; that
  // one fraction is most of what distinguishes the silhouettes.
  const cabinLength = length * defaults.cabinFraction;
  const cabinHeight = height - chassisHeight - wheelRadius;
  const cabinZ = kind === "truck" ? length / 2 - cabinLength / 2 : kind === "car" ? -length * 0.04 : 0;
  parts.push(
    withSlot(translateMesh(box({ width: width * 0.94, height: cabinHeight, depth: cabinLength }), [0, chassisY + chassisHeight / 2 + cabinHeight / 2, cabinZ]), PROP_SLOTS.metal),
  );
  // Glazing: a thin inset panel front and back, so the cabin reads as a cabin.
  for (const side of [-1, 1]) {
    parts.push(
      withSlot(
        translateMesh(box({ width: width * 0.8, height: cabinHeight * 0.55, depth: 0.04 }), [
          0,
          chassisY + chassisHeight / 2 + cabinHeight * 0.6,
          cabinZ + (side * cabinLength) / 2,
        ]),
        PROP_SLOTS.glass,
      ),
    );
  }
  if (kind === "truck") {
    const cargoLength = length - cabinLength - 0.3;
    parts.push(
      withSlot(
        // A hair narrower than the chassis: a full-width box shares its bottom
        // edge with the chassis top, which welds into a non-manifold seam.
        translateMesh(box({ width: width * 0.98, height: height * 0.55, depth: cargoLength }), [0, chassisY + chassisHeight / 2 + height * 0.275, -length / 2 + cargoLength / 2]),
        PROP_SLOTS.metal,
      ),
    );
  }

  const wheels: WheelPlacement[] = [];
  const axleSpan = length * 0.68;
  for (let axle = 0; axle < defaults.axles; axle += 1) {
    // Front axle forward, remaining axles clustered at the rear, which is how
    // three-axle vehicles are actually laid out.
    const z = axle === 0 ? axleSpan / 2 : -axleSpan / 2 + (axle - 1) * wheelRadius * 2.4;
    for (const side of [-1, 1]) {
      wheels.push({
        position: [(side * (width - wheelWidth)) / 2, wheelRadius, z],
        radius: wheelRadius,
        width: wheelWidth,
        steering: axle === 0,
        driven: axle > 0,
      });
    }
  }

  // Slight seeded ride-height variation, so a car park is not a clone army.
  const settle = 1 - random() * 0.03;
  const body = mergeMeshes(parts.map((part) => translateMesh(part, [0, -wheelRadius * (1 - settle), 0])));
  const wheel = withSlot(
    placeMesh(cylinder({ radius: wheelRadius, height: wheelWidth, segments: segments * 2 }), { rotation: [0, 0, 90] }),
    PROP_SLOTS.rubber,
  );
  const mesh = mergeMeshes([body, ...wheels.map((placement) => translateMesh(wheel, placement.position))]);

  return {
    kind,
    body,
    wheel,
    wheels,
    mesh,
    size: [width, height, length],
    stats: { triangles: mesh.indices.length / 3, wheels: wheels.length },
  };
}

export type WeaponKind = "sword" | "axe" | "spear" | "club" | "bow" | "rifle" | "pistol";

export const WEAPON_KINDS: readonly WeaponKind[] = ["sword", "axe", "spear", "club", "bow", "rifle", "pistol"];

export interface WeaponSpec {
  readonly kind?: WeaponKind;
  /** Overall length in metres. Each kind has a sensible default. */
  readonly length?: number;
  readonly seed?: number;
  readonly segments?: number;
}

export interface GeneratedWeapon {
  readonly kind: WeaponKind;
  readonly mesh: MeshData;
  /** Where a hand socket attaches, in model space. */
  readonly grip: readonly [number, number, number];
  /** Blade point or muzzle: where a trace starts and an effect spawns. */
  readonly tip: readonly [number, number, number];
  readonly length: number;
  readonly stats: { readonly triangles: number; readonly parts: number };
}

const WEAPON_LENGTHS: Readonly<Record<WeaponKind, number>> = {
  sword: 1, axe: 0.8, spear: 2.1, club: 0.7, bow: 1.5, rifle: 1.05, pistol: 0.25,
};

/**
 * A weapon, built along +Y with its grip near the origin.
 *
 * The axis convention is not arbitrary: a hand socket on a generated character
 * points its bone up the limb, so a weapon built along +Y attaches with an
 * identity rotation. Getting that wrong is how every weapon in a project ends
 * up with a hand-tuned offset baked into gameplay code.
 */
export function generateWeapon(spec: WeaponSpec = {}): GeneratedWeapon {
  const kind = spec.kind ?? "sword";
  const defaultLength = WEAPON_LENGTHS[kind];
  if (defaultLength === undefined) throw new Error(`Unknown weapon kind "${String(kind)}". Kinds are ${WEAPON_KINDS.join(", ")}.`);
  const length = requirePositive(spec.length ?? defaultLength, "Weapon length");
  const segments = spec.segments ?? 10;
  if (!Number.isInteger(segments) || segments < 3) throw new Error("A weapon needs at least three segments.");
  const random = seededRandom(spec.seed ?? 1);

  const parts: MeshData[] = [];
  let grip: [number, number, number] = [0, 0, 0];
  let tip: [number, number, number] = [0, length, 0];

  switch (kind) {
    case "sword":
    case "spear": {
      const bladeFraction = kind === "sword" ? 0.72 : 0.2;
      const shaftLength = length * (1 - bladeFraction);
      const bladeLength = length * bladeFraction;
      const bladeWidth = kind === "sword" ? length * 0.075 : length * 0.045;
      // A lenticular blade section: an extruded diamond, tapered by scaling the
      // profile down its length would need a loft, and a diamond prism with a
      // point is both cheaper and reads correctly at gameplay distance.
      const section = profile([[-bladeWidth / 2, 0], [0, length * 0.012], [bladeWidth / 2, 0], [0, -length * 0.012]]);
      const blade = placeMesh(extrudeProfile(section, { depth: bladeLength * 0.86 }), { position: [0, shaftLength, 0], rotation: [-90, 0, 0] });
      parts.push(withSlot(blade, PROP_SLOTS.metal));
      parts.push(
        withSlot(
          placeMesh(cylinder({ radius: bladeWidth / 2, topRadius: 0, height: bladeLength * 0.14, segments: 4 }), {
            position: [0, shaftLength + bladeLength * 0.93, 0],
          }),
          PROP_SLOTS.metal,
        ),
      );
      parts.push(withSlot(translateMesh(cylinder({ radius: length * 0.018, height: shaftLength, segments }), [0, shaftLength / 2, 0]), PROP_SLOTS.wood));
      if (kind === "sword") {
        parts.push(withSlot(translateMesh(box({ width: length * 0.22, height: length * 0.03, depth: length * 0.04 }), [0, shaftLength, 0]), PROP_SLOTS.metal));
        parts.push(withSlot(translateMesh(sphere({ radius: length * 0.03, segments, rings: 6 }), [0, 0, 0]), PROP_SLOTS.metal));
      }
      grip = [0, shaftLength * 0.5, 0];
      tip = [0, length, 0];
      break;
    }
    case "axe": {
      const haft = length;
      parts.push(withSlot(translateMesh(cylinder({ radius: length * 0.025, height: haft, segments }), [0, haft / 2, 0]), PROP_SLOTS.wood));
      const head = profile([[0, 0], [length * 0.3, length * 0.09], [length * 0.32, -length * 0.09], [0, -length * 0.14]]);
      parts.push(withSlot(placeMesh(extrudeProfile(head, { depth: length * 0.05, centered: true }), { position: [0, haft * 0.92, 0] }), PROP_SLOTS.metal));
      grip = [0, haft * 0.25, 0];
      tip = [length * 0.32, haft * 0.92, 0];
      break;
    }
    case "club": {
      parts.push(withSlot(translateMesh(cylinder({ radius: length * 0.035, topRadius: length * 0.09, height: length, segments }), [0, length / 2, 0]), PROP_SLOTS.wood));
      grip = [0, length * 0.2, 0];
      break;
    }
    case "bow": {
      // The limb is a revolved-free swept arc approximated by tapered segments;
      // a bow is mostly silhouette, and the string is what sells it.
      const steps = Math.max(6, segments);
      for (let step = 0; step < steps; step += 1) {
        const t0 = step / steps;
        const t1 = (step + 1) / steps;
        const point = (t: number): [number, number, number] => [Math.sin((t - 0.5) * Math.PI) * length * 0.18 - length * 0.18, (t - 0.5) * length, 0];
        const [a, b] = [point(t0), point(t1)];
        const segmentLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const taper = 1 - Math.abs(t0 - 0.5) * 1.2;
        parts.push(
          withSlot(
            placeMesh(cylinder({ radius: length * 0.012 * Math.max(0.35, taper), height: segmentLength, segments: 6 }), {
              position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + length / 2, 0],
              rotation: [0, 0, (Math.atan2(b[0] - a[0], b[1] - a[1]) * -180) / Math.PI],
            }),
            PROP_SLOTS.wood,
          ),
        );
      }
      parts.push(withSlot(translateMesh(box({ width: length * 0.006, height: length * 0.98, depth: length * 0.006 }), [-length * 0.18, length / 2, 0]), PROP_SLOTS.fabric));
      grip = [-length * 0.18, length / 2, 0];
      tip = [-length * 0.18, length, 0];
      break;
    }
    case "rifle":
    case "pistol": {
      const barrelLength = length * (kind === "rifle" ? 0.55 : 0.55);
      const bodyLength = length * 0.45;
      parts.push(withSlot(translateMesh(box({ width: length * 0.06, height: bodyLength, depth: length * 0.12 }), [0, bodyLength / 2, 0]), PROP_SLOTS.metal));
      parts.push(withSlot(translateMesh(cylinder({ radius: length * 0.022, height: barrelLength, segments }), [0, bodyLength + barrelLength / 2, 0]), PROP_SLOTS.metal));
      // The grip is angled back, which is what makes a hand socket land in a
      // pose that does not look broken.
      parts.push(
        withSlot(
          placeMesh(box({ width: length * 0.055, height: length * 0.22, depth: length * 0.09 }), { position: [0, length * 0.06, -length * 0.09], rotation: [18, 0, 0] }),
          kind === "rifle" ? PROP_SLOTS.wood : PROP_SLOTS.metal,
        ),
      );
      if (kind === "rifle") {
        parts.push(withSlot(placeMesh(box({ width: length * 0.06, height: length * 0.3, depth: length * 0.13 }), { position: [0, -length * 0.12, -length * 0.05], rotation: [10, 0, 0] }), PROP_SLOTS.wood));
        parts.push(withSlot(translateMesh(box({ width: length * 0.05, height: length * 0.16, depth: length * 0.06 }), [0, length * 0.1, length * 0.03]), PROP_SLOTS.metal));
      }
      grip = [0, length * 0.06, -length * 0.09];
      tip = [0, bodyLength + barrelLength, 0];
      break;
    }
  }

  if (parts.length === 0) throw new Error(`Unknown weapon kind "${String(kind)}".`);
  // A seeded twist about the long axis: identical weapons in a rack look wrong,
  // and the variation costs nothing because it is a whole-asset transform.
  const mesh = computeNormals(placeMesh(mergeMeshes(parts), { rotation: [0, (random() - 0.5) * 6, 0] }), { smooth: false });
  return { kind, mesh, grip, tip, length, stats: { triangles: mesh.indices.length / 3, parts: parts.length } };
}

function withSlot(mesh: MeshData, slot: number): MeshData {
  return { ...mesh, materialSlots: new Uint16Array(mesh.indices.length / 3).fill(slot) };
}

function requirePositive(value: number, label: string): number {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`${label} must be a positive, finite number (got ${value}).`);
  return value;
}
