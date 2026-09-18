/** Executes Vapour Script against the live engine, for tests and tooling.
 *
 * Vapour Script needs no per-subsystem binding layer: it compiles to ESM and
 * shares JavaScript's object model, so `from "@vapour/engine" import X` hands a
 * script the same object TypeScript gets. What that guarantee lacks is *proof*
 * — a subsystem could ship an export shape VS's syntax cannot reach (a
 * TypeScript-only overload, a symbol that needs `new` where VS has no keyword)
 * and nothing would notice until a player's script failed.
 *
 * `runVapourScript` closes that gap. It compiles a script, resolves its
 * `@vapour/engine` imports from a provided module object, and runs the result
 * as a real function — no bundler, no `eval` of untrusted input, just the
 * compiler's own output executed against the engine. The bindings test uses it
 * to drive every Mirage subsystem from VS source and assert on what the engine
 * did, which is the only binding contract worth having.
 */
import { compileVapourScript } from "./vapour-script.js";
const ENGINE_IMPORT = /^import \{ ([^}]+) \} from "@vapour\/engine";$/gm;
/**
 * Compiles and runs a script whose only imports come from `@vapour/engine`.
 *
 * Relative imports are refused rather than resolved: this runner exists to
 * prove the engine surface, and pretending to be a module loader would let a
 * test pass against files the real build never sees.
 */
export function runVapourScript(source, engine, file = "script.vs") {
    const compiled = compileVapourScript(source, file);
    const imported = [];
    let body = compiled.code.replace(ENGINE_IMPORT, (_match, names) => {
        for (const name of names.split(",")) {
            const symbol = name.trim();
            if (symbol === "")
                continue;
            if (!(symbol in engine))
                throw new Error(`${file} imports "${symbol}" from @vapour/engine, but the engine does not export it.`);
            imported.push(symbol);
        }
        return "";
    });
    if (/^import /m.test(body))
        throw new Error(`${file} uses a non-engine import; runVapourScript only resolves "@vapour/engine".`);
    body = body.replace(/\/\/# sourceURL=.*$/m, "");
    // `export function f` / `export class C` / `export const x` become plain
    // declarations collected onto the exports object by name.
    const exported = [];
    body = body.replace(/^export (?:async )?(?:function|class|const|let) ([A-Za-z_$][\w$]*)/gm, (match, name) => {
        exported.push(name);
        return match.replace(/^export /, "");
    });
    const wrapped = `${body}\nreturn { ${exported.join(", ")} };`;
    const run = new Function(...imported, wrapped);
    const exportsValue = run(...imported.map((name) => engine[name]));
    return { exports: exportsValue, imported };
}
//# sourceMappingURL=vs-bindings.js.map