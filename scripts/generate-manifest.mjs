#!/usr/bin/env node
/**
 * Generates `docs/mirage/manifest.json`, the machine-readable description of
 * the engine that an AI agent reads before writing any game code.
 *
 * It is generated rather than hand-written so it cannot drift: the package list
 * comes from the workspace, the subsystem list from the engine's directory
 * layout, the capability list from `docs/status.md`, and the documentation
 * index from `docs/`. Run with `--check` to fail when the committed manifest is
 * stale, which is how CI keeps it honest.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "docs", "mirage", "manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Workspace packages, each with its published entry point. */
function collectPackages() {
  const packagesDir = join(root, "packages");
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, "package.json")))
    .map((entry) => {
      const manifest = readJson(join(packagesDir, entry.name, "package.json"));
      return {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? "",
        path: `packages/${entry.name}`,
        source: `packages/${entry.name}/src/index.ts`,
        dependsOn: Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith("@vapour/")),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Engine subsystems, read from the directory layout and their barrel files. */
function collectSubsystems() {
  const engineSrc = join(root, "packages", "engine", "src");
  return readdirSync(engineSrc, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(engineSrc, entry.name);
      const barrel = join(dir, "index.ts");
      const summary = existsSync(barrel)
        ? (readFileSync(barrel, "utf8").match(/^\/\*\* (.+)$/m)?.[1] ?? "").trim()
        : "";
      const modules = readdirSync(dir)
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "index.ts")
        .map((file) => file.replace(/\.ts$/, ""))
        .sort();
      return { name: entry.name, summary, path: relative(root, dir), modules };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The capability matrix from `docs/status.md`, which is the release gate. */
function collectCapabilities() {
  const text = readFileSync(join(root, "docs", "status.md"), "utf8");
  const rows = [...text.matchAll(/^\|\s*(.+?)\s*\|\s*(Working|Experimental|Planned)\s*\|\s*$/gm)];
  return rows.map(([, capability, status]) => ({ capability, status: status.toLowerCase() }));
}

function collectDocs() {
  const docsDir = join(root, "docs");
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith(".md") ? [relative(root, path)] : [];
    });
  return walk(docsDir).sort();
}

const capabilities = collectCapabilities();
const manifest = {
  $schema: "https://vapour.dev/schema/engine-manifest-1.json",
  manifestVersion: 1,
  engine: {
    name: "Vapour Engine",
    version: readJson(join(root, "package.json")).version,
    release: { version: "0.2.5-alpha", codename: "Mirage" },
    runtime: "Rust/WebAssembly core with a TypeScript host",
    renderer: "WebGPU",
    targets: ["2d", "3d", "webxr"],
    scriptingLanguages: ["typescript", "vapour-script"],
  },
  conventions: {
    coordinateSystem: "right-handed, +Y up, -Z forward",
    matrixLayout: "column-major, flat 16-element arrays",
    rotationFormat: "[x, y, z, w] unit quaternion",
    eulerOrder: "intrinsic Y-X-Z in degrees",
    clipDepthRange: "[0, 1]",
    colorSpace: "sRGB authored, linear for lighting",
    sceneFormat: "deterministic JSON with stable UUID asset references",
    errorPolicy: "invalid input throws with an actionable message rather than propagating NaN",
  },
  entryPoints: {
    engine: "packages/engine/src/index.ts",
    math: "packages/math/src/index.ts",
    gameplay: "packages/gameplay/src/index.ts",
    cli: "packages/cli/src/index.ts",
    editor: "packages/editor/src",
  },
  packages: collectPackages(),
  subsystems: collectSubsystems(),
  capabilities: {
    counts: {
      working: capabilities.filter((entry) => entry.status === "working").length,
      experimental: capabilities.filter((entry) => entry.status === "experimental").length,
      planned: capabilities.filter((entry) => entry.status === "planned").length,
    },
    source: "docs/status.md",
    entries: capabilities,
  },
  documentation: {
    index: "docs/",
    agentGuide: "docs/agent-game-building.md",
    architecture: "docs/architecture/overview.md",
    mirageAudit: "docs/mirage/audit.md",
    miragePlan: "docs/mirage/plan.md",
    mirageTasks: "docs/mirage/tasks.md",
    files: collectDocs(),
  },
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "";
  if (current !== serialized) {
    console.error("docs/mirage/manifest.json is out of date. Run: node scripts/generate-manifest.mjs");
    process.exit(1);
  }
  console.log("manifest up to date");
} else {
  writeFileSync(manifestPath, serialized);
  console.log(`wrote ${relative(root, manifestPath)}`);
}
