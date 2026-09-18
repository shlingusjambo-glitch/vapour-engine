import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileVapourScript } from "./vapour-script.js";
import * as engine from "../index.js";
/**
 * Mirage M131: every Vapour Script example in `docs/` compiles, and every
 * `@vapour/engine` symbol it imports exists. Documentation that cannot
 * compile is worse than none, because a reader trusts it more than code.
 */
const docsDir = join(import.meta.dirname, "..", "..", "..", "..", "docs");
const files = readdirSync(docsDir).filter((name) => name.endsWith(".md"));
const blocks = [];
for (const file of files) {
    const text = readFileSync(join(docsDir, file), "utf8");
    for (const match of text.matchAll(/```py\n([\s\S]*?)```/g))
        blocks.push({ file, source: match[1] });
}
describe("docs Vapour Script examples", () => {
    it("found examples to check", () => {
        expect(blocks.length).toBeGreaterThan(15);
    });
    it.each(blocks.map((block, index) => [`${block.file}#${String(index)}`, block]))("%s compiles and imports real engine symbols", (_name, block) => {
        const compiled = compileVapourScript(block.source, block.file);
        for (const match of compiled.code.matchAll(/^import \{ ([^}]+) \} from "@vapour\/engine";$/gm)) {
            for (const name of match[1].split(",").map((entry) => entry.trim()).filter(Boolean)) {
                expect(engine, `${block.file} imports ${name}`).toHaveProperty(name);
            }
        }
    });
});
//# sourceMappingURL=docs-examples.test.js.map