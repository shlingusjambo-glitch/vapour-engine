import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractRenderWorld, projectTemplate, projectTemplates, type SceneData } from "@vapour/engine";
import { buildProject, loadAndValidateProject, writeProjectTemplate } from "./project.js";

const template = path.resolve(import.meta.dirname, "../../../templates/empty-3d");

describe("project pipeline", () => {
  it("validates and builds a static-hostable game", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vapour-build-"));
    const { cp } = await import("node:fs/promises");
    await cp(template, root, { recursive: true });
    const validation = await loadAndValidateProject(root);
    expect(validation.scenes).toEqual(["Assets/Scenes/Main.scene.json"]);
    const output = path.join(root, "release");
    await buildProject(root, output);
    expect(await readFile(path.join(output, "index.html"), "utf8")).toContain("vapour-game");
    expect(await readFile(path.join(output, "headers.txt"), "utf8")).toContain("Cross-Origin-Opener-Policy");
  });

  it("ships the engine as a replaceable artifact with its licence notice", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vapour-licence-"));
    const { cp } = await import("node:fs/promises");
    await cp(template, root, { recursive: true });
    const output = path.join(root, "release");
    await buildProject(root, output);

    const notices = await readFile(path.join(output, "THIRD-PARTY-NOTICES.txt"), "utf8");
    expect(notices).toContain("Lesser General Public License");
    expect(notices).toContain("vapour_runtime_bg.wasm");

    // LGPL section 4 compliance depends on the engine staying a separate file a
    // user can swap, so the build must never inline it into the game bundle.
    const files = await readdir(output);
    expect(files).toContain("vapour_runtime_bg.wasm");
    expect(files).toContain("vapour_runtime.js");
    const scriptName = files.find((file) => file.startsWith("game.") && file.endsWith(".js"));
    expect(scriptName).toBeDefined();
    const script = await readFile(path.join(output, scriptName!), "utf8");
    expect(script).not.toContain("asm.js");
    expect(script.length).toBeLessThan((await stat(path.join(output, "vapour_runtime_bg.wasm"))).size);
  });

  it("keeps the committed templates identical to the shared registry", async () => {
    // The Hub writes projects from the same registry, so drift here means a
    // browser-created project and a CLI-created one would differ.
    for (const template of projectTemplates()) {
      const committed = path.resolve(import.meta.dirname, "../../../templates", template.id);
      const generated = await mkdtemp(path.join(tmpdir(), `vapour-template-${template.id}-`));
      await writeProjectTemplate(generated, {
        id: "00000000-0000-4000-8000-000000000000",
        name: "{{PROJECT_NAME}}",
        templateId: template.id,
      });
      for (const file of [".vapourproject", ".gitignore", "AGENTS.md", "Scripts/main.ts", "Settings/input.json"]) {
        expect(await readFile(path.join(committed, file), "utf8"), `${template.id}/${file}`)
          .toBe(await readFile(path.join(generated, file), "utf8"));
      }
      // Scenes carry fresh UUIDs by design — two projects must never share
      // entity identities — so compare everything else about their structure.
      expect(sceneShape(JSON.parse(await readFile(path.join(committed, SCENE_PATH), "utf8")) as SceneData), template.id)
        .toEqual(sceneShape(JSON.parse(await readFile(path.join(generated, SCENE_PATH), "utf8")) as SceneData));
    }
  });

  it("creates a validatable project from every template", async () => {
    for (const template of projectTemplates()) {
      const root = await mkdtemp(path.join(tmpdir(), `vapour-create-${template.id}-`));
      await writeProjectTemplate(root, { id: crypto.randomUUID(), name: "Test Game", templateId: template.id });
      const validation = await loadAndValidateProject(root);
      expect(validation.project.name).toBe("Test Game");
      expect(validation.scenes).toEqual(["Assets/Scenes/Main.scene.json"]);

      // Every starter scene must actually draw something through the renderer.
      const scene = JSON.parse(await readFile(path.join(root, "Assets/Scenes/Main.scene.json"), "utf8")) as SceneData;
      const world = extractRenderWorld(scene);
      expect(world.camera, `${template.id} needs a camera`).toBeDefined();
      expect(world.directionalLight, `${template.id} needs a light`).toBeDefined();
      expect(world.instances.length, `${template.id} needs visible geometry`).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown template by name", () => {
    expect(() => projectTemplate("empty-4d")).toThrow(/Unknown project template/);
  });

  it("validates and builds a Vapour Script entry that imports TypeScript", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vapour-vs-build-"));
    const { cp, writeFile } = await import("node:fs/promises");
    await cp(template, root, { recursive: true });
    const manifestPath = path.join(root, ".vapourproject");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.scriptEntry = "Scripts/main.vs";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(root, "Scripts", "helper.ts"), "export const message = 'VS and TS';\n");
    await writeFile(path.join(root, "Scripts", "main.vs"), `from "./helper.ts" import message\nexport func start(context):\n    console.log(message, context.entityId)\n`);
    await loadAndValidateProject(root);
    const output = path.join(root, "dist"); await buildProject(root, output);
    const scriptName = (await readdir(output)).find((file) => file.startsWith("game.") && file.endsWith(".js"));
    expect(scriptName).toBeDefined();
    expect(await readFile(path.join(output, scriptName!), "utf8")).toContain("VS and TS");
  });

  it("creates a buildable VS-first project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vapour-vs-template-"));
    const project = await writeProjectTemplate(root, { id: crypto.randomUUID(), name: "VS Game", templateId: "empty-2d", language: "vs" });
    expect(project.scriptEntry).toBe("Scripts/main.vs");
    expect(await readFile(path.join(root, "Scripts", "main.vs"), "utf8")).toContain("export func update");
    await buildProject(root, path.join(root, "dist"));
  });

  it("rejects TypeScript gameplay errors before producing a build", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vapour-ts-error-"));
    await writeProjectTemplate(root, { id: crypto.randomUUID(), name: "Broken Game", templateId: "empty-3d" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(root, "Scripts", "main.ts"), "import type { ScriptContext } from '@vapour/engine';\nexport function update(context: ScriptContext): void { context.missingEngineApi(); }\n");
    await expect(loadAndValidateProject(root)).rejects.toThrow(/TypeScript validation failed[\s\S]*missingEngineApi/);
  });
});

const SCENE_PATH = "Assets/Scenes/Main.scene.json";

/**
 * A scene's content with volatile identities removed.
 *
 * Serialization sorts entities by UUID, so both the IDs and the resulting row
 * order differ between runs. Keying on entity name — which templates keep
 * unique — makes the comparison order independent while still catching any
 * change to hierarchy, components, or transforms.
 */
function sceneShape(scene: SceneData): unknown {
  const nameOf = new Map(scene.entities.map((entity) => [entity.id, entity.name]));
  return {
    formatVersion: scene.formatVersion,
    name: scene.name,
    entities: Object.fromEntries(
      scene.entities.map((entity) => [
        entity.name,
        {
          parent: entity.parent === undefined ? null : nameOf.get(entity.parent),
          enabled: entity.enabled,
          components: entity.components,
        },
      ]),
    ),
  };
}
