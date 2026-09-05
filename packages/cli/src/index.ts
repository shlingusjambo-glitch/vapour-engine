#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileVapourScript } from "@vapour/engine";
import { EDITOR_VERSION, buildProject, loadAndValidateProject, writeProjectTemplate } from "./project.js";

const rawArguments = process.argv.slice(2);
const jsonOutput = rawArguments.includes("--json");
const argumentsWithoutGlobals = rawArguments.filter((argument) => argument !== "--json");
const [command = "help", projectArg = ".", ...rest] = argumentsWithoutGlobals;
const invocationRoot = process.env.INIT_CWD ?? process.cwd();
const projectRoot = path.resolve(invocationRoot, projectArg);

try {
  if (command === "create") {
    const result = await createProject(projectRoot, option(rest, "--name") ?? path.basename(projectRoot), option(rest, "--template") ?? "empty-3d", option(rest, "--language") ?? "typescript");
    respond("create", result, `Created Vapour project '${result.name}' from the ${result.template} template at ${result.root}`);
  } else if (command === "validate") {
    const result = await loadAndValidateProject(projectRoot);
    respond("validate", result, `Valid ${result.project.name}: ${String(result.scenes.length)} scene(s).`);
  } else if (command === "inspect") {
    const result = await loadAndValidateProject(projectRoot);
    respond("inspect", { root: projectRoot, ...result }, `${result.project.name} · Vapour ${result.project.editorVersion} · ${String(result.scenes.length)} scene(s)`);
  } else if (command === "build") {
    const outputArgument = option(rest, "--out");
    const output = await build(projectRoot, outputArgument === undefined ? undefined : path.resolve(invocationRoot, outputArgument));
    respond("build", { root: projectRoot, output }, `Built deployable game at ${output}`);
  } else if (command === "dev") {
    await dev(projectRoot, Number(option(rest, "--port") ?? "4173"));
  } else if (command === "schema") {
    respond("schema", schemas(), "Vapour project and scene schema summaries emitted.");
  } else if (command === "compile-vs") {
    const sourceFile = path.resolve(invocationRoot, projectArg);
    const outputArgument = option(rest, "--out");
    const result = compileVapourScript(await readFile(sourceFile, "utf8"), path.relative(invocationRoot, sourceFile));
    if (outputArgument === undefined) process.stdout.write(result.code);
    else {
      const outputFile = path.resolve(invocationRoot, outputArgument);
      await mkdir(path.dirname(outputFile), { recursive: true });
      await writeFile(outputFile, result.code);
      respond("compile-vs", { input: sourceFile, output: outputFile }, `Compiled ${sourceFile} to ${outputFile}`);
    }
  } else {
    printHelp();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (jsonOutput) process.stderr.write(`${JSON.stringify({ ok: false, command, error: { code: "VAPOUR_COMMAND_FAILED", message } })}\n`);
  else process.stderr.write(`Vapour: ${message}\n`);
  process.exitCode = 1;
}

async function createProject(
  root: string,
  name: string,
  templateId = "empty-3d",
  language = "typescript",
): Promise<{ root: string; name: string; id: string; editorVersion: string; template: string }> {
  if (language !== "typescript" && language !== "vs") throw new Error("--language must be 'typescript' or 'vs'.");
  await mkdir(root, { recursive: true });
  const id = crypto.randomUUID();
  // The Hub and the CLI build from the same template registry, so a project
  // created here and one created in the browser are byte-for-byte identical.
  await writeProjectTemplate(root, { id, name, templateId, language });
  return { root, name, id, editorVersion: EDITOR_VERSION, template: templateId };
}

async function build(root: string, output?: string): Promise<string> {
  const resolved = output === undefined ? path.join(root, "dist") : path.resolve(output);
  await buildProject(root, resolved);
  return resolved;
}

async function dev(root: string, port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer from 1 to 65535.");
  const output = path.join(root, ".vapour", "build", "dev");
  await buildProject(root, output);
  const server = createServer(async (request, response) => {
    try {
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      response.setHeader("Cache-Control", "no-store");
      const requestPath = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
      const relative = requestPath === "/" ? "index.html" : decodeURIComponent(requestPath.slice(1));
      const file = path.resolve(output, relative);
      if (!file.startsWith(`${path.resolve(output)}${path.sep}`)) throw new Error("Invalid request path.");
      const body = await readFile(file);
      response.setHeader("Content-Type", contentType(file));
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end("Not found");
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${String(port)}`;
    if (jsonOutput) process.stdout.write(`${JSON.stringify({ ok: true, command: "dev", event: "ready", data: { root, output, url } })}\n`);
    else process.stdout.write(`Vapour game server: ${url}\n`);
  });
}

function respond(commandName: string, data: unknown, human: string): void {
  process.stdout.write(jsonOutput ? `${JSON.stringify({ ok: true, command: commandName, data })}\n` : `${human}\n`);
}

function schemas(): object {
  return {
    project: { formatVersion: 1, required: ["id", "name", "editorVersion", "startupScene", "scriptEntry", "rendering"] },
    scene: { formatVersion: 1, required: ["id", "name", "entities"], entityRequired: ["id", "name", "enabled", "components"] },
    component: { required: ["typeName", "version", "data"] },
  };
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json") || file.endsWith(".map")) return "application/json; charset=utf-8";
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function printHelp(): void {
  process.stdout.write("Vapour Engine CLI\n\n  vapour create <directory> [--name Name] [--template empty-3d|empty-2d|webxr] [--language typescript|vs] [--json]\n  vapour validate <project> [--json]\n  vapour inspect <project> [--json]\n  vapour schema [--json]\n  vapour compile-vs <file.vs> [--out file.js] [--json]\n  vapour build <project> [--out directory] [--json]\n  vapour dev <project> [--port 4173] [--json]\n");
}
