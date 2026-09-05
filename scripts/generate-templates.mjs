#!/usr/bin/env node
// Regenerates the checked-in templates/ directory from the engine's shared
// template registry. A test asserts the committed files match this output, so
// the templates in Git can never drift from what the Hub and CLI produce.
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectTemplates } from "../packages/engine/dist/index.js";
import { writeProjectTemplate } from "../packages/cli/dist/project.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const template of projectTemplates()) {
  const directory = path.join(root, "templates", template.id);
  await rm(directory, { recursive: true, force: true });
  await writeProjectTemplate(directory, {
    // Stable placeholders: `vapour create` replaces them with fresh values.
    id: "00000000-0000-4000-8000-000000000000",
    name: "{{PROJECT_NAME}}",
    templateId: template.id,
  });
  console.log(`generated templates/${template.id}`);
}
