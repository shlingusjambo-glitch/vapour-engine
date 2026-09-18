/** Asset libraries: named components and materials, bundled to be reused.
 *
 * A description names its components inline, which is right for one asset and
 * wrong for a project: a street of forty buildings should not restate the
 * lamppost forty times, and a team (or an agent across sessions) needs a
 * "kit" it can draw from by name. A library is that kit — a versioned JSON
 * document of components and material graphs plus the metadata that makes it
 * findable: tags, an author, a description.
 *
 * Libraries are pure data, validated with the same structured issues as
 * descriptions, and merge by an explicit collision policy — because two kits
 * that both define `door` is the normal case, and silently picking one is how
 * a build changes when a dependency does.
 */
import {
  AssetDescriptionError,
  ASSET_DESCRIPTION_VERSION,
  buildAsset,
  validateComponentMap,
  validateHeader,
  validateMaterialList,
  type AssetIssue,
  type AssetNode,
  type AssetPlacement,
  type BuiltAsset,
} from "./describe.js";
import type { CompileOptions } from "./compile.js";
import type { MaterialGraph } from "./material.js";

/** The library format version this build speaks. */
export const ASSET_LIBRARY_VERSION = 1;

export interface AssetLibrary {
  readonly version: number;
  readonly id: string;
  readonly description?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
  /** Named nodes. A component may `ref` another in the same library. */
  readonly components: Readonly<Record<string, AssetNode>>;
  readonly materials?: readonly MaterialGraph[];
}

export type MergePolicy = "error" | "prefer-left" | "prefer-right";

/** Checks a library, returning every problem with a path into it. */
export function validateAssetLibrary(library: unknown, basePath = ""): readonly AssetIssue[] {
  const prefix = basePath === "" ? "" : `${basePath}.`;
  if (!isRecord(library)) return [{ path: basePath, code: "not-an-object", message: "An asset library must be a JSON object." }];
  const issues: AssetIssue[] = [];
  validateHeader(library, ASSET_LIBRARY_VERSION, "An asset library", issues, prefix);
  for (const field of ["description", "author"] as const) {
    if (library[field] !== undefined && typeof library[field] !== "string") {
      issues.push({ path: `${prefix}${field}`, code: "invalid-type", message: `A library ${field} must be a string.` });
    }
  }
  const tags = library["tags"];
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || tag === ""))) {
    issues.push({ path: `${prefix}tags`, code: "invalid-type", message: "Library tags must be an array of non-empty strings." });
  }
  if (library["components"] === undefined) {
    issues.push({ path: `${prefix}components`, code: "missing-field", message: "A library needs a components object, even an empty one." });
  } else {
    validateComponentMap(library["components"], `${prefix}components`, issues);
  }
  validateMaterialList(library["materials"], `${prefix}materials`, issues);
  return issues;
}

/** Validates and returns a library, from JSON text or an already-parsed value. */
export function parseAssetLibrary(source: string | unknown): AssetLibrary {
  let value: unknown = source;
  if (typeof source === "string") {
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new AssetDescriptionError([{ path: "", code: "invalid-json", message: `The library is not valid JSON: ${error instanceof Error ? error.message : String(error)}.` }]);
    }
  }
  const issues = validateAssetLibrary(value);
  if (issues.length > 0) throw new AssetDescriptionError(issues);
  return value as AssetLibrary;
}

/**
 * Serializes a library to stable JSON.
 *
 * Keys are emitted in the order they were declared, so serialize → parse →
 * serialize is byte-identical and a library diffs cleanly in review.
 */
export function serializeAssetLibrary(library: AssetLibrary): string {
  const issues = validateAssetLibrary(library);
  if (issues.length > 0) throw new AssetDescriptionError(issues);
  return JSON.stringify(library, null, 2);
}

/**
 * Merges two libraries under a collision policy.
 *
 * Components collide by name and materials by id. With `error`, every
 * collision is reported at its path in one exception, so a merge that fails
 * says everything that is wrong with it at once.
 */
export function mergeLibraries(left: AssetLibrary, right: AssetLibrary, policy: MergePolicy = "error", id = `${left.id}+${right.id}`): AssetLibrary {
  const issues: AssetIssue[] = [];
  const components: Record<string, AssetNode> = { ...left.components };
  for (const [name, node] of Object.entries(right.components)) {
    if (name in components) {
      if (policy === "error") issues.push({ path: `components.${name}`, code: "component-collision", message: `Both libraries define component ${JSON.stringify(name)}.` });
      if (policy !== "prefer-right") continue;
    }
    components[name] = node;
  }
  const materials: MaterialGraph[] = [...(left.materials ?? [])];
  for (const graph of right.materials ?? []) {
    const index = materials.findIndex((existing) => existing.id === graph.id);
    if (index === -1) {
      materials.push(graph);
      continue;
    }
    if (policy === "error") issues.push({ path: `materials.${graph.id}`, code: "material-collision", message: `Both libraries define material ${JSON.stringify(graph.id)}.` });
    if (policy === "prefer-right") materials[index] = graph;
  }
  if (issues.length > 0) throw new AssetDescriptionError(issues);
  const tags = [...new Set([...(left.tags ?? []), ...(right.tags ?? [])])];
  return {
    version: ASSET_LIBRARY_VERSION,
    id,
    ...(left.description === undefined && right.description === undefined ? {} : { description: [left.description, right.description].filter((entry) => entry !== undefined).join(" / ") }),
    ...(left.author === undefined && right.author === undefined ? {} : { author: [left.author, right.author].filter((entry) => entry !== undefined).join(", ") }),
    ...(tags.length === 0 ? {} : { tags }),
    components,
    ...(materials.length === 0 ? {} : { materials }),
  };
}

export interface BuildFromLibraryOptions {
  /** Id of the built asset. Defaults to `<library id>/<component>`. */
  readonly id?: string;
  readonly placement?: AssetPlacement;
  readonly compile?: CompileOptions;
}

/** Builds one of a library's components as a complete asset. */
export function buildFromLibrary(library: AssetLibrary, rootRef: string, options: BuildFromLibraryOptions = {}): BuiltAsset {
  if (!(rootRef in library.components)) {
    throw new AssetDescriptionError([{ path: "root.component", code: "unknown-component", message: `No component named ${JSON.stringify(rootRef)} in library "${library.id}". Components: ${Object.keys(library.components).join(", ") || "none"}.` }]);
  }
  return buildAsset({
    version: ASSET_DESCRIPTION_VERSION,
    id: options.id ?? `${library.id}/${rootRef}`,
    root: { kind: "ref", component: rootRef, ...(options.placement === undefined ? {} : { placement: options.placement }) },
    libraries: [library],
    ...(options.compile === undefined ? {} : { compile: options.compile }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
