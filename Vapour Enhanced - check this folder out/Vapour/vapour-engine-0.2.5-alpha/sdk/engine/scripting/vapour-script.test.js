import { describe, expect, it } from "vitest";
import { compileVapourScript, VapourScriptCompileError } from "./vapour-script.js";
describe("Vapour Script compiler", () => {
    it("compiles lifecycle functions and Python-style control flow to ESM", () => {
        const source = `from "@vapour/engine" import GameRuntime

var speed: number = 4
export func update(context, delta):
    if context.input.held("Move") and speed > 0:
        for step in range(3):
            context.move(step * delta)
    elif not context.enabled:
        return None
    else:
        pass
`;
        const result = compileVapourScript(source, "Scripts/player.vs");
        expect(result.code).toContain('import { GameRuntime } from "@vapour/engine";');
        expect(result.code).toContain("export function update(context, delta) {");
        expect(result.code).toContain('context.input.held("Move") && speed > 0');
        expect(result.code).toContain("for (const step of __vs_range(3)) {");
        expect(result.code).toContain("else if (! context.enabled)");
        expect(result.sourceMap.sources).toEqual(["Scripts/player.vs"]);
    });
    it("supports classes, methods, self, literals, comments, and string hashes", () => {
        const result = compileVapourScript(`export class Counter:\n    func constructor():\n        self.value = 0 # state\n    func ready():\n        return "#not-comment"\n    func tick():\n        self.value = self.value + 1\n        return True\n`);
        expect(result.code).toContain("export class Counter {");
        expect(result.code).toContain("constructor() {");
        expect(result.code).toContain("this.value = 0;");
        expect(result.code).toContain('return "#not-comment";');
        expect(result.code).toContain("return true;");
    });
    it("emits actionable indentation diagnostics", () => {
        expect(() => compileVapourScript("func start():\n  pass\n", "Scripts/main.vs")).toThrow(VapourScriptCompileError);
        try {
            compileVapourScript("func start():\npass\n", "Scripts/main.vs");
        }
        catch (error) {
            expect(error).toBeInstanceOf(VapourScriptCompileError);
            expect(error.diagnostics[0]).toMatchObject({ file: "Scripts/main.vs", line: 2, message: expect.stringContaining("Expected an indented block") });
        }
    });
});
//# sourceMappingURL=vapour-script.test.js.map