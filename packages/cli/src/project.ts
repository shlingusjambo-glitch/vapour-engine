import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild, type Plugin } from "esbuild";
import ts from "typescript";
import { compileVapourScript, projectTemplate, serializeScene, validateScene, VapourScriptCompileError, type SceneData } from "@vapour/engine";

export interface VapourProject {
  readonly formatVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly editorVersion: string;
  readonly startupScene: string;
  readonly scriptEntry: string;
  readonly rendering: { readonly preferredCanvasFormat: "auto"; readonly powerPreference: "high-performance" | "low-power" };
}

export interface ValidationResult {
  readonly project: VapourProject;
  readonly scenes: readonly string[];
}

export async function loadAndValidateProject(root: string): Promise<ValidationResult> {
  const manifestPath = path.join(root, ".vapourproject");
  const project = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<VapourProject>;
  if (project.formatVersion !== 1) throw new Error(`Unsupported project format '${String(project.formatVersion)}'.`);
  if (typeof project.id !== "string" || typeof project.name !== "string") throw new Error("Project requires string id and name fields.");
  if (typeof project.editorVersion !== "string") throw new Error("Project requires an editorVersion field.");
  if (typeof project.startupScene !== "string" || typeof project.scriptEntry !== "string") throw new Error("Project requires startupScene and scriptEntry paths.");
  if (project.rendering?.preferredCanvasFormat !== "auto") throw new Error("Project rendering.preferredCanvasFormat must be 'auto'.");
  const resolved = project as VapourProject;
  const sceneFiles = await findFiles(path.join(root, "Assets"), (file) => file.endsWith(".scene.json"));
  if (sceneFiles.length === 0) throw new Error("Project contains no .scene.json assets.");
  for (const sceneFile of sceneFiles) {
    const scene = JSON.parse(await readFile(sceneFile, "utf8")) as SceneData;
    try { validateScene(scene); } catch (error) { throw new Error(`${path.relative(root, sceneFile)}: ${messageOf(error)}`); }
  }
  await stat(path.join(root, resolved.startupScene));
  await stat(path.join(root, resolved.scriptEntry));
  if (!/\.(?:ts|js|vs)$/.test(resolved.scriptEntry)) throw new Error(`Project scriptEntry '${resolved.scriptEntry}' must end in .ts, .js, or .vs.`);
  const vapourScripts = await findFiles(path.join(root, "Scripts"), (file) => file.endsWith(".vs"));
  for (const script of vapourScripts) {
    try { compileVapourScript(await readFile(script, "utf8"), path.relative(root, script)); }
    catch (error) { if (error instanceof VapourScriptCompileError) throw error; throw new Error(`${path.relative(root, script)}: ${messageOf(error)}`); }
  }
  await typeCheckProject(root);
  return { project: resolved, scenes: sceneFiles.map((file) => path.relative(root, file)) };
}

export async function buildProject(root: string, output = path.join(root, "dist")): Promise<void> {
  const { project } = await loadAndValidateProject(root);
  await mkdir(output, { recursive: true });
  const aliases = await resolveEngineAliases();
  const buildResult = await esbuild({
    entryPoints: [path.join(root, project.scriptEntry)],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2023"],
    alias: aliases,
    plugins: [vapourScriptPlugin()],
    minify: true,
    treeShaking: true,
    sourcemap: true,
    write: false,
    outfile: "game.js",
  });
  const jsOutput = buildResult.outputFiles.find((file) => file.path.endsWith(".js"));
  if (jsOutput === undefined) throw new Error("Script build produced no JavaScript output.");
  const hash = createHash("sha256").update(jsOutput.contents).digest("hex").slice(0, 12);
  const scriptName = `game.${hash}.js`;
  const script = jsOutput.text.replace("//# sourceMappingURL=game.js.map", `//# sourceMappingURL=${scriptName}.map`);
  await writeFile(path.join(output, scriptName), script);
  const sourceMap = buildResult.outputFiles.find((file) => file.path.endsWith(".js.map"));
  if (sourceMap !== undefined) await writeFile(path.join(output, `${scriptName}.map`), sourceMap.contents);
  await cp(path.join(root, "Assets"), path.join(output, "assets"), { recursive: true });
  const wasmRoot = process.env.VAPOUR_WASM_ROOT === undefined
    ? fileURLToPath(new URL("../../engine/wasm", import.meta.url))
    : path.resolve(process.env.VAPOUR_WASM_ROOT);
  await cp(path.join(wasmRoot, "vapour_runtime.js"), path.join(output, "vapour_runtime.js"));
  await cp(path.join(wasmRoot, "vapour_runtime_bg.wasm"), path.join(output, "vapour_runtime_bg.wasm"));
  await writeFile(path.join(output, "index.html"), gameHtml(project.name, scriptName));
  await writeFile(path.join(output, "service-worker.js"), serviceWorker(["./", `./${scriptName}`, "./vapour_runtime.js", "./vapour_runtime_bg.wasm", `./assets/${project.startupScene.replace(/^Assets\//, "")}`]));
  await writeFile(path.join(output, "headers.txt"), "Cross-Origin-Opener-Policy: same-origin\nCross-Origin-Embedder-Policy: require-corp\n");
  await writeFile(path.join(output, "THIRD-PARTY-NOTICES.txt"), thirdPartyNotices(project.name));
}

/** Runs the real TypeScript checker before bundling. esbuild intentionally
 * transpiles without type checking, which previously let broken gameplay APIs
 * reach a production build with no actionable diagnostic. */
async function typeCheckProject(root: string): Promise<void> {
  const scripts = await findFiles(path.join(root, "Scripts"), (file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  if (scripts.length === 0) return;
  const aliases = await resolveEngineAliases();
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: root,
    paths: Object.fromEntries(Object.entries(aliases).map(([specifier, entry]) => [specifier, [entry]])),
    strict: true,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    skipLibCheck: true,
    useDefineForClassFields: true,
  };
  const webGpuTypes = await resolveWebGpuTypes();
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([...scripts, webGpuTypes], options));
  if (diagnostics.length === 0) return;
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  };
  throw new Error(`TypeScript validation failed:\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, host)}`);
}

async function resolveEngineEntry(): Promise<string> {
  return resolveSourceEntry("VAPOUR_ENGINE_SOURCE", "../../engine/src/index.ts", "engine");
}

/**
 * `@vapour/engine`'s own source imports `@vapour/math` and `@vapour/gameplay`
 * as bare specifiers. Inside the monorepo that resolves through pnpm's
 * workspace symlinks, but a standalone SDK ships no `node_modules` next to
 * `sdk/engine-src` — so both the type checker and esbuild need an explicit
 * alias to each sibling package's source, exactly like the engine gets one.
 */
async function resolveMathEntry(): Promise<string> {
  return resolveSourceEntry("VAPOUR_MATH_SOURCE", "../../math/src/index.ts", "math");
}

async function resolveGameplayEntry(): Promise<string> {
  return resolveSourceEntry("VAPOUR_GAMEPLAY_SOURCE", "../../gameplay/src/index.ts", "gameplay");
}

async function resolveSourceEntry(envVar: string, devRelativePath: string, label: string): Promise<string> {
  const entry = process.env[envVar] === undefined
    ? fileURLToPath(new URL(devRelativePath, import.meta.url))
    : path.resolve(process.env[envVar]!);
  await stat(entry).catch(() => { throw new Error(`Vapour ${label} source entry was not found at '${entry}'. Reinstall the SDK or set ${envVar}.`); });
  return entry;
}

async function resolveEngineAliases(): Promise<Record<string, string>> {
  const [engineEntry, mathEntry, gameplayEntry] = await Promise.all([resolveEngineEntry(), resolveMathEntry(), resolveGameplayEntry()]);
  return { "@vapour/engine": engineEntry, "@vapour/math": mathEntry, "@vapour/gameplay": gameplayEntry };
}

async function resolveWebGpuTypes(): Promise<string> {
  const configured = process.env.VAPOUR_WEBGPU_TYPES;
  const candidates = configured === undefined
    ? [
        fileURLToPath(new URL("../../engine/node_modules/@webgpu/types/dist/index.d.ts", import.meta.url)),
        fileURLToPath(new URL("../sdk/webgpu-types.d.ts", import.meta.url)),
      ]
    : [path.resolve(configured)];
  for (const candidate of candidates) {
    try { await stat(candidate); return candidate; } catch { /* try the packaged location */ }
  }
  throw new Error(`Vapour's WebGPU TypeScript declarations were not found. Reinstall the SDK or set VAPOUR_WEBGPU_TYPES. Checked: ${candidates.join(", ")}.`);
}

function vapourScriptPlugin(): Plugin {
  return {
    name: "vapour-script",
    setup(build) {
      build.onLoad({ filter: /\.vs$/ }, async ({ path: scriptPath }) => {
        const source = await readFile(scriptPath, "utf8");
        try {
          return { contents: compileVapourScript(source, scriptPath).code, loader: "js", resolveDir: path.dirname(scriptPath) };
        } catch (error) {
          if (!(error instanceof VapourScriptCompileError)) throw error;
          return { errors: error.diagnostics.map((diagnostic) => ({ text: diagnostic.message, location: { file: diagnostic.file, line: diagnostic.line, column: diagnostic.column - 1, lineText: diagnostic.sourceLine } })) };
        }
      });
    },
  };
}

/**
 * Licence notice shipped with every build.
 *
 * Vapour is LGPL-3.0-or-later, which asks a distributed work to name the
 * library and say where its source lives. Emitting this file means a default
 * build is already compliant without the developer having to research it, and
 * it records that the engine is a replaceable artifact — the condition that
 * keeps the game itself free of any licence obligation.
 */
function thirdPartyNotices(gameName: string): string {
  return [
    `${gameName} — third-party notices`,
    "",
    "Vapour Engine",
    "  Copyright the Vapour Engine contributors.",
    "  Licensed under the GNU Lesser General Public License, version 3.0 or later.",
    "  Source: https://github.com/vapour-engine/vapour",
    "  Licence text: https://www.gnu.org/licenses/lgpl-3.0.html",
    "",
    "  This game links the engine as a separate WebAssembly module",
    "  (vapour_runtime_bg.wasm and vapour_runtime.js). Replacing those files with a",
    "  modified build of Vapour runs this game against the modified engine, which",
    "  satisfies LGPL section 4 without requiring any part of this game's own source.",
    "",
    "  The engine bundles Rust and npm dependencies distributed under the MIT and",
    "  Apache-2.0 licences. Those licences require attribution only and place no",
    "  obligation on this game.",
    "",
  ].join("\n");
}

async function findFiles(root: string, predicate: (file: string) => boolean): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await findFiles(absolute, predicate)));
    else if (predicate(absolute)) found.push(absolute);
  }
  return found.sort();
}

function gameHtml(name: string, scriptName: string): string {
  const title = escapeHtml(name);
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#080a0f"><title>${title}</title><style>html,body,canvas{width:100%;height:100%;margin:0;overflow:hidden;background:#080a0f}#vapour-game{display:block}</style></head><body><canvas id="vapour-game"></canvas><script type="module" src="./${scriptName}"></script><script>if("serviceWorker" in navigator)addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js"))</script></body></html>\n`;
}

function serviceWorker(files: readonly string[]): string {
  return `const CACHE="vapour-v1";const FILES=${JSON.stringify(files)};self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x))))));self.addEventListener("fetch",e=>{if(e.request.method==="GET")e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))})\n`;
}

function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export const EDITOR_VERSION = "0.2.0-alpha";

export interface TemplateOptions {
  readonly id: string;
  readonly name: string;
  readonly templateId: string;
  readonly language?: "typescript" | "vs";
}

/**
 * Writes a complete Vapour project from a shared template definition.
 *
 * The Hub writes the same files through the File System Access API. Keeping the
 * scene, script, and manifest content in one place is what stops a
 * browser-created project and a CLI-created one from drifting apart.
 */
export async function writeProjectTemplate(root: string, options: TemplateOptions): Promise<VapourProject> {
  const template = projectTemplate(options.templateId);
  const language = options.language ?? "typescript";
  const manifest: VapourProject = {
    formatVersion: 1,
    id: options.id,
    name: options.name,
    editorVersion: EDITOR_VERSION,
    startupScene: "Assets/Scenes/Main.scene.json",
    scriptEntry: language === "vs" ? "Scripts/main.vs" : "Scripts/main.ts",
    rendering: { preferredCanvasFormat: "auto", powerPreference: "high-performance" },
  };
  await mkdir(path.join(root, "Assets", "Scenes"), { recursive: true });
  await mkdir(path.join(root, "Scripts"), { recursive: true });
  await mkdir(path.join(root, "Settings"), { recursive: true });
  await mkdir(path.join(root, "Plugins"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, ".vapourproject"), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(path.join(root, ".gitignore"), PROJECT_GITIGNORE),
    writeFile(path.join(root, "AGENTS.md"), AGENT_GUIDE),
    writeFile(path.join(root, "Assets", "Scenes", "Main.scene.json"), serializeScene(template.buildScene())),
    writeFile(path.join(root, "Scripts", language === "vs" ? "main.vs" : "main.ts"), language === "vs" ? vapourScriptStarter(options.templateId) : template.script()),
    writeFile(path.join(root, "Settings", "input.json"), `${JSON.stringify({ formatVersion: 1, actions: [] }, null, 2)}\n`),
  ]);
  return manifest;
}

const PROJECT_GITIGNORE = [
  "# Generated by the Vapour editor and CLI; never source.",
  ".vapour/",
  "dist/",
  "node_modules/",
  "",
].join("\n");

const AGENT_GUIDE = `# Vapour project guidance

Gameplay code is Vapour Script (\`.vs\`) and/or TypeScript in \`Scripts/\`. Both
languages use the same engine APIs. Keep scenes and settings deterministic JSON,
preserve stable UUID references, and never edit \`.vapour/\`, \`dist/\`, or
generated WebAssembly bindings.

Before handing work back, run:

\`\`\`sh
pnpm vapour validate . --json
pnpm vapour build . --json
\`\`\`

Use Vapour engine APIs instead of sample-only browser code. Do not add a WebGL
primary path.
`;

function vapourScriptStarter(templateId: string): string {
  const label = templateId === "empty-2d" ? "2D" : templateId === "webxr" ? "XR" : "3D";
  return `# Vapour Script entry point. VS and TypeScript modules may import each other.\n\nexport func start(context):\n    console.info("Vapour ${label} project ready", context)\n\nexport func update(context, delta_seconds):\n    pass\n`;
}
