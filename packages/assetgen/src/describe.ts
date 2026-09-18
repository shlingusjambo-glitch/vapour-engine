/** The asset description language: one JSON document, one runtime asset.
 *
 * Every generator in this package is a TypeScript function taking a spec
 * object. That is the right shape for a program and the wrong shape for an
 * agent: a function call cannot be stored in a scene file, diffed in a review,
 * sent over a network, or written by something that only emits text. This
 * module is the data form of the same capability — a versioned, validated
 * document that names a generator and its arguments, and compiles to the exact
 * same geometry the direct call would produce.
 *
 * Three decisions shape it:
 *
 * - **Validation returns every problem, not the first.** An agent that gets one
 *   error per round trip needs as many round trips as it has mistakes. Issues
 *   carry a `path` into the document, a stable `code`, and a sentence a model
 *   can act on, matching the structured-issue convention the engine uses
 *   elsewhere.
 * - **The version is checked, not assumed.** A document says which language it
 *   was written against; a newer runtime can then reject or migrate it rather
 *   than silently misreading a field that changed meaning.
 * - **Composition lives in the document.** `group` nodes place and repeat their
 *   children, and `ref` nodes instantiate a named component, so a description
 *   can build a street out of one building rather than restating it.
 *
 * Nothing here re-implements generation. Every node dispatches to the generator
 * module that already owns that shape, which is what keeps the document form
 * and the direct-call form from ever drifting apart.
 */
import type { MeshData } from "./mesh.js";
import { mergeMeshes } from "./mesh.js";
import { box, cone, cylinder, sphere } from "./primitives.js";
import { centerMesh, meshBounds, placeMesh } from "./transform.js";
import { compileAsset, compileBuilding, type CompileOptions, type CompiledAsset } from "./compile.js";
import { generateBuilding, type BuildingSpec, type GeneratedBuilding } from "./architecture.js";
import { generateCharacter, generateCrowd, type CharacterSpec, type GeneratedCharacter } from "./character.js";
import {
  generateTree,
  generateRock,
  generateGrassClump,
  generateTerrain,
  type TreeSpec,
  type RockSpec,
  type GrassSpec,
  type TerrainSpec,
} from "./nature.js";
import {
  generateProp,
  generateVehicle,
  generateWeapon,
  PROP_KINDS,
  VEHICLE_KINDS,
  WEAPON_KINDS,
  type PropSpec,
  type VehicleSpec,
  type WeaponSpec,
} from "./props.js";
import { generateMaterial, validateMaterialGraph, type GeneratedMaterial, type MaterialGraph } from "./material.js";
import { evaluateGrammar, validateShapeGrammar, type PlacedTerminal, type ShapeGrammar } from "./grammar.js";
import { validateAssetLibrary, type AssetLibrary } from "./library.js";

/** The language version this build of `@vapour/assetgen` speaks. */
export const ASSET_DESCRIPTION_VERSION = 1;

/** One problem with a document, located by a path into it. */
export interface AssetIssue {
  /** Dotted path to the offending value, e.g. `root.children[2].spec.height`. */
  readonly path: string;
  /** Stable machine-readable reason. Safe to branch on; the message is not. */
  readonly code: string;
  /** A sentence saying what is wrong and, where useful, what would be right. */
  readonly message: string;
}

/** Thrown by {@link parseAssetDescription} when a document does not validate. */
export class AssetDescriptionError extends Error {
  readonly issues: readonly AssetIssue[];
  constructor(issues: readonly AssetIssue[]) {
    const first = issues[0];
    super(
      first === undefined
        ? "The asset description is invalid."
        : `${first.path}: ${first.message}${issues.length > 1 ? ` (and ${String(issues.length - 1)} more)` : ""}`,
    );
    this.name = "AssetDescriptionError";
    this.issues = Object.freeze([...issues]);
  }
}

/** Placement applied to a node's geometry after it is generated. */
export interface AssetPlacement {
  readonly position?: readonly [number, number, number];
  /** Euler degrees, XYZ order, matching {@link placeMesh}. */
  readonly rotation?: readonly [number, number, number];
  readonly scale?: readonly [number, number, number] | number;
}

/** Repetition of a `group`'s children along a step vector. */
export interface AssetRepeat {
  readonly count: number;
  readonly step: readonly [number, number, number];
}

/** The generator node kinds a document may use. */
export const ASSET_NODE_KINDS = [
  "building",
  "character",
  "crowd",
  "tree",
  "rock",
  "grass",
  "terrain",
  "prop",
  "vehicle",
  "weapon",
  "grammar",
  "group",
  "ref",
] as const;

export type AssetNodeKind = (typeof ASSET_NODE_KINDS)[number];

interface AssetNodeBase {
  readonly placement?: AssetPlacement;
}

export type AssetNode =
  | (AssetNodeBase & { readonly kind: "building"; readonly spec: BuildingSpec })
  | (AssetNodeBase & { readonly kind: "character"; readonly spec?: CharacterSpec })
  | (AssetNodeBase & { readonly kind: "crowd"; readonly count: number; readonly spec?: CharacterSpec; readonly seed?: number })
  | (AssetNodeBase & { readonly kind: "tree"; readonly spec?: TreeSpec })
  | (AssetNodeBase & { readonly kind: "rock"; readonly spec?: RockSpec })
  | (AssetNodeBase & { readonly kind: "grass"; readonly spec?: GrassSpec })
  | (AssetNodeBase & { readonly kind: "terrain"; readonly spec?: TerrainSpec })
  | (AssetNodeBase & { readonly kind: "prop"; readonly spec: PropSpec })
  | (AssetNodeBase & { readonly kind: "vehicle"; readonly spec?: VehicleSpec })
  | (AssetNodeBase & { readonly kind: "weapon"; readonly spec?: WeaponSpec })
  | (AssetNodeBase & { readonly kind: "grammar"; readonly grammar: ShapeGrammar })
  | (AssetNodeBase & { readonly kind: "group"; readonly children: readonly AssetNode[]; readonly repeat?: AssetRepeat })
  | (AssetNodeBase & { readonly kind: "ref"; readonly component: string });

/** A complete, self-contained asset document. */
export interface AssetDescription {
  readonly version: number;
  readonly id: string;
  readonly root: AssetNode;
  /** Named nodes a `ref` may instantiate. Components may reference components. */
  readonly components?: Readonly<Record<string, AssetNode>>;
  /** Libraries carried inline, so a document travels with what it references.
   * Their components and materials are available as if declared here; a name
   * declared twice is an error rather than a silent override. */
  readonly libraries?: readonly AssetLibrary[];
  readonly materials?: readonly MaterialGraph[];
  readonly compile?: CompileOptions;
}

/** What {@link buildAsset} produces: runtime geometry plus what generation knew. */
export interface BuiltAsset {
  readonly id: string;
  readonly compiled: CompiledAsset;
  readonly materials: readonly GeneratedMaterial[];
  /** Present when the document's root was a single `building`. */
  readonly building?: GeneratedBuilding;
  /** Every character the document generated, in document order. */
  readonly characters: readonly GeneratedCharacter[];
}

/** Deepest node nesting a document may use, so a cyclic `ref` cannot hang. */
const MAX_DEPTH = 32;
/** Most instances one `group` may repeat to, so a typo cannot exhaust memory. */
const MAX_REPEAT = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkFiniteTuple(value: unknown, length: number, path: string, issues: AssetIssue[]): void {
  if (!Array.isArray(value) || value.length !== length || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    issues.push({ path, code: "invalid-vector", message: `Expected ${String(length)} finite numbers.` });
  }
}

function validatePlacement(value: unknown, path: string, issues: AssetIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path, code: "not-an-object", message: "A placement must be an object." });
    return;
  }
  if (value["position"] !== undefined) checkFiniteTuple(value["position"], 3, `${path}.position`, issues);
  if (value["rotation"] !== undefined) checkFiniteTuple(value["rotation"], 3, `${path}.rotation`, issues);
  const scale = value["scale"];
  if (scale !== undefined && !(typeof scale === "number" && Number.isFinite(scale))) {
    checkFiniteTuple(scale, 3, `${path}.scale`, issues);
  }
}

function validateNode(
  node: unknown,
  path: string,
  issues: AssetIssue[],
  components: ReadonlySet<string>,
  depth: number,
): void {
  if (depth > MAX_DEPTH) {
    issues.push({ path, code: "too-deep", message: `Nodes may nest at most ${String(MAX_DEPTH)} deep; a 'ref' cycle looks like this too.` });
    return;
  }
  if (!isRecord(node)) {
    issues.push({ path, code: "not-an-object", message: "A node must be an object." });
    return;
  }
  const kind = node["kind"];
  if (typeof kind !== "string" || !(ASSET_NODE_KINDS as readonly string[]).includes(kind)) {
    issues.push({
      path: `${path}.kind`,
      code: "unknown-node",
      message: `Unknown node kind ${JSON.stringify(kind)}. Kinds are ${ASSET_NODE_KINDS.join(", ")}.`,
    });
    return;
  }
  validatePlacement(node["placement"], `${path}.placement`, issues);

  if (kind === "group") {
    const children = node["children"];
    if (!Array.isArray(children) || children.length === 0) {
      issues.push({ path: `${path}.children`, code: "empty-group", message: "A group needs at least one child." });
    } else {
      children.forEach((child, index) => {
        validateNode(child, `${path}.children[${String(index)}]`, issues, components, depth + 1);
      });
    }
    const repeat = node["repeat"];
    if (repeat !== undefined) {
      if (!isRecord(repeat) || !Number.isInteger(repeat["count"]) || (repeat["count"] as number) < 1 || (repeat["count"] as number) > MAX_REPEAT) {
        issues.push({
          path: `${path}.repeat.count`,
          code: "out-of-range",
          message: `A repeat count must be a whole number in [1, ${String(MAX_REPEAT)}].`,
        });
      }
      if (isRecord(repeat)) checkFiniteTuple(repeat["step"], 3, `${path}.repeat.step`, issues);
    }
    return;
  }

  if (kind === "grammar") {
    issues.push(...validateShapeGrammar(node["grammar"], `${path}.grammar`, components));
    return;
  }

  if (kind === "ref") {
    const component = node["component"];
    if (typeof component !== "string" || component === "") {
      issues.push({ path: `${path}.component`, code: "invalid-ref", message: "A ref needs the name of a component." });
    } else if (!components.has(component)) {
      issues.push({
        path: `${path}.component`,
        code: "unknown-component",
        message: `No component named ${JSON.stringify(component)}. Declared components: ${[...components].join(", ") || "none"}.`,
      });
    }
    return;
  }

  const spec = node["spec"];
  if (spec !== undefined && !isRecord(spec)) {
    issues.push({ path: `${path}.spec`, code: "not-an-object", message: "A spec must be an object." });
    return;
  }
  const specPath = `${path}.spec`;
  const record = isRecord(spec) ? spec : {};

  if (kind === "building") {
    if (spec === undefined) {
      issues.push({ path: specPath, code: "missing-field", message: "A building node needs a spec with floors." });
    } else if (!Array.isArray(record["floors"]) || (record["floors"] as unknown[]).length === 0) {
      issues.push({ path: `${specPath}.floors`, code: "missing-field", message: "A building needs at least one floor." });
    }
  }
  if (kind === "prop") {
    const propKind = record["kind"];
    if (typeof propKind !== "string" || !(PROP_KINDS as readonly string[]).includes(propKind)) {
      issues.push({ path: `${specPath}.kind`, code: "unknown-kind", message: `Prop kinds are ${PROP_KINDS.join(", ")}.` });
    }
  }
  if (kind === "vehicle" && record["kind"] !== undefined && !(VEHICLE_KINDS as readonly string[]).includes(record["kind"] as string)) {
    issues.push({ path: `${specPath}.kind`, code: "unknown-kind", message: `Vehicle kinds are ${VEHICLE_KINDS.join(", ")}.` });
  }
  if (kind === "weapon" && record["kind"] !== undefined && !(WEAPON_KINDS as readonly string[]).includes(record["kind"] as string)) {
    issues.push({ path: `${specPath}.kind`, code: "unknown-kind", message: `Weapon kinds are ${WEAPON_KINDS.join(", ")}.` });
  }
  if (kind === "crowd") {
    const count = node["count"];
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 1024) {
      issues.push({ path: `${path}.count`, code: "out-of-range", message: "A crowd count must be a whole number in [1, 1024]." });
    }
  }
}

/** Checks the `version` and `id` a description or a library must carry. */
export function validateHeader(document: Record<string, unknown>, supported: number, label: string, issues: AssetIssue[], prefix = ""): void {
  const version = document["version"];
  if (version === undefined) {
    issues.push({ path: `${prefix}version`, code: "missing-version", message: `${label} must declare "version": ${String(supported)}.` });
  } else if (!Number.isInteger(version) || (version as number) < 1) {
    issues.push({ path: `${prefix}version`, code: "invalid-version", message: "The version must be a positive whole number." });
  } else if ((version as number) > supported) {
    issues.push({ path: `${prefix}version`, code: "unsupported-version", message: `This build speaks ${label.toLowerCase()} version ${String(supported)}; the document declares ${String(version)}.` });
  }
  if (typeof document["id"] !== "string" || (document["id"] as string).trim() === "") {
    issues.push({ path: `${prefix}id`, code: "invalid-id", message: `${label} needs a non-empty id.` });
  }
}

/**
 * Validates a `components` map, whose refs may name anything in `known` plus
 * the map's own entries. Returns the names it declared.
 */
export function validateComponentMap(value: unknown, basePath: string, issues: AssetIssue[], known: ReadonlySet<string> = new Set()): ReadonlySet<string> {
  if (value === undefined) return known;
  if (!isRecord(value)) {
    issues.push({ path: basePath, code: "not-an-object", message: "Components must be an object keyed by name." });
    return known;
  }
  const names = new Set([...known, ...Object.keys(value)]);
  for (const [name, node] of Object.entries(value)) validateNode(node, `${basePath}.${name}`, issues, names, 0);
  return names;
}

/** Validates a `materials` array in place. */
export function validateMaterialList(value: unknown, basePath: string, issues: AssetIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path: basePath, code: "not-an-array", message: "Materials must be an array of material graphs." });
    return;
  }
  value.forEach((graph, index) => issues.push(...validateMaterialGraph(graph, `${basePath}[${String(index)}]`)));
}

/**
 * Checks a document against the language, returning every problem it has.
 *
 * Callers that want an exception instead should use {@link parseAssetDescription};
 * this form exists because an authoring tool wants the whole list at once.
 */
export function validateAssetDescription(document: unknown): readonly AssetIssue[] {
  const issues: AssetIssue[] = [];
  if (!isRecord(document)) {
    return [{ path: "", code: "not-an-object", message: "An asset description must be a JSON object." }];
  }
  validateHeader(document, ASSET_DESCRIPTION_VERSION, "An asset description", issues);

  // Library components are visible to the document and to each other, so they
  // are gathered first; a name declared twice anywhere is reported, not merged.
  let known: ReadonlySet<string> = new Set();
  const libraries = document["libraries"];
  if (libraries !== undefined && !Array.isArray(libraries)) {
    issues.push({ path: "libraries", code: "not-an-array", message: "Libraries must be an array of asset libraries." });
  } else if (Array.isArray(libraries)) {
    libraries.forEach((library, index) => {
      const path = `libraries[${String(index)}]`;
      issues.push(...validateAssetLibrary(library, path));
      if (!isRecord(library) || !isRecord(library["components"])) return;
      for (const name of Object.keys(library["components"])) {
        if (known.has(name)) issues.push({ path: `${path}.components.${name}`, code: "component-collision", message: `Component ${JSON.stringify(name)} is already declared by an earlier library.` });
      }
      known = new Set([...known, ...Object.keys(library["components"])]);
    });
  }
  if (isRecord(document["components"])) {
    for (const name of Object.keys(document["components"])) {
      if (known.has(name)) issues.push({ path: `components.${name}`, code: "component-collision", message: `Component ${JSON.stringify(name)} is already declared by a library.` });
    }
  }
  const componentNames = validateComponentMap(document["components"], "components", issues, known);

  if (document["root"] === undefined) {
    issues.push({ path: "root", code: "missing-field", message: "An asset description needs a root node." });
  } else {
    validateNode(document["root"], "root", issues, componentNames, 0);
  }
  validateMaterialList(document["materials"], "materials", issues);
  return issues;
}

/**
 * Validates and returns a document, throwing {@link AssetDescriptionError} with
 * every issue when it does not conform.
 */
export function parseAssetDescription(document: unknown): AssetDescription {
  const issues = validateAssetDescription(document);
  if (issues.length > 0) throw new AssetDescriptionError(issues);
  return document as AssetDescription;
}

interface BuildAccumulator {
  readonly characters: GeneratedCharacter[];
  building?: GeneratedBuilding;
}

function buildNode(
  node: AssetNode,
  components: Readonly<Record<string, AssetNode>>,
  accumulator: BuildAccumulator,
  depth: number,
): MeshData {
  if (depth > MAX_DEPTH) throw new AssetDescriptionError([{ path: "root", code: "too-deep", message: "Node nesting exceeded the limit; check for a 'ref' cycle." }]);
  const place = (mesh: MeshData): MeshData => (node.placement === undefined ? mesh : placeMesh(mesh, node.placement));

  switch (node.kind) {
    case "building": {
      const building = generateBuilding(node.spec);
      accumulator.building ??= building;
      return place(building.mesh);
    }
    case "character": {
      const character = generateCharacter(node.spec ?? {});
      accumulator.characters.push(character);
      return place(character.mesh);
    }
    case "crowd": {
      const crowd = generateCrowd(node.count, node.spec ?? {}, node.seed ?? 1);
      accumulator.characters.push(...crowd);
      return place(mergeMeshes(crowd.map((member) => member.mesh)));
    }
    case "tree":
      return place(generateTree(node.spec ?? {}).mesh);
    case "rock":
      return place(generateRock(node.spec ?? {}));
    case "grass":
      return place(generateGrassClump(node.spec ?? {}));
    case "terrain":
      return place(generateTerrain(node.spec ?? {}).mesh);
    case "prop":
      return place(generateProp(node.spec).mesh);
    case "vehicle":
      return place(generateVehicle(node.spec ?? {}).mesh);
    case "weapon":
      return place(generateWeapon(node.spec ?? {}).mesh);
    case "grammar": {
      const { terminals } = evaluateGrammar(node.grammar);
      return place(mergeMeshes(terminals.map((terminal) => placeTerminal(terminal, components, accumulator, depth))));
    }
    case "ref": {
      const target = components[node.component];
      if (target === undefined) {
        throw new AssetDescriptionError([{ path: "ref", code: "unknown-component", message: `No component named ${JSON.stringify(node.component)}.` }]);
      }
      return place(buildNode(target, components, accumulator, depth + 1));
    }
    case "group": {
      const children = node.children.map((child) => buildNode(child, components, accumulator, depth + 1));
      const merged = mergeMeshes(children);
      if (node.repeat === undefined) return place(merged);
      const copies: MeshData[] = [];
      for (let index = 0; index < node.repeat.count; index += 1) {
        copies.push(
          placeMesh(merged, {
            position: [node.repeat.step[0] * index, node.repeat.step[1] * index, node.repeat.step[2] * index],
          }),
        );
      }
      return place(mergeMeshes(copies));
    }
  }
}

/** Geometry for one grammar terminal: a primitive fitted to its scope, or a
 * component stood on the scope's floor and, with `fit`, stretched to it. */
function placeTerminal(
  terminal: PlacedTerminal,
  components: Readonly<Record<string, AssetNode>>,
  accumulator: BuildAccumulator,
  depth: number,
): MeshData {
  const { position, size } = terminal.scope;
  const baseCentre: [number, number, number] = [position[0] + size[0] / 2, position[1], position[2] + size[2] / 2];
  if (terminal.kind === "ref") {
    const mesh = centerMesh(buildNode({ kind: "ref", component: terminal.component }, components, accumulator, depth + 1), "base");
    if (!terminal.fit) return placeMesh(mesh, { position: baseCentre });
    const bounds = meshBounds(mesh);
    const scale = size.map((extent, axis) => extent / Math.max(1e-9, bounds.max[axis]! - bounds.min[axis]!)) as [number, number, number];
    return placeMesh(mesh, { position: baseCentre, scale });
  }
  const unit =
    terminal.primitive === "box"
      ? box()
      : terminal.primitive === "cylinder"
        ? cylinder({ radius: 0.5, height: 1 })
        : terminal.primitive === "cone"
          ? cone({ radius: 0.5, height: 1 })
          : sphere({ radius: 0.5 });
  const mesh = placeMesh(unit, { position: [baseCentre[0], position[1] + size[1] / 2, baseCentre[2]], scale: size });
  return terminal.slot === undefined ? mesh : { ...mesh, materialSlots: new Uint16Array(mesh.indices.length / 3).fill(terminal.slot) };
}

/**
 * Compiles a description into runtime geometry, collision, LODs, and materials.
 *
 * A document whose root is a single building is compiled through
 * {@link compileBuilding} so it keeps its navigation surfaces; anything else
 * goes through {@link compileAsset}. That asymmetry is deliberate — navigation
 * is derived from wall and floor topology, which only the architecture
 * generator knows, and inventing it for an arbitrary merged mesh would produce
 * nav data nobody should trust.
 */
export function buildAsset(document: unknown): BuiltAsset {
  const description = parseAssetDescription(document);
  const accumulator: BuildAccumulator = { characters: [] };
  const components = Object.assign({}, ...(description.libraries ?? []).map((library) => library.components), description.components ?? {}) as Record<string, AssetNode>;
  const materials = [...(description.libraries ?? []).flatMap((library) => library.materials ?? []), ...(description.materials ?? [])];
  const mesh = buildNode(description.root, components, accumulator, 0);
  const options = description.compile ?? {};
  const rootIsBuilding = description.root.kind === "building" && description.root.placement === undefined;
  const compiled =
    rootIsBuilding && accumulator.building !== undefined
      ? compileBuilding(accumulator.building, options)
      : compileAsset(mesh, options);
  return {
    id: description.id,
    compiled,
    materials: materials.map((graph) => generateMaterial(graph)),
    ...(accumulator.building === undefined ? {} : { building: accumulator.building }),
    characters: accumulator.characters,
  };
}
