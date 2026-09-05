export interface VapourScriptDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly severity: "error";
  readonly message: string;
  readonly sourceLine: string;
}

export class VapourScriptCompileError extends Error {
  readonly diagnostics: readonly VapourScriptDiagnostic[];
  constructor(diagnostics: readonly VapourScriptDiagnostic[]) {
    const first = diagnostics[0]!;
    super(`${first.file}:${String(first.line)}:${String(first.column)}: ${first.message}\n  ${first.sourceLine}`);
    this.name = "VapourScriptCompileError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

export interface VapourScriptCompileResult {
  readonly code: string;
  readonly sourceMap: { readonly version: 3; readonly sources: readonly string[]; readonly names: readonly string[]; readonly mappings: string };
}

interface OpenBlock { readonly indent: number; readonly kind: string; }

/** Compiles indentation-sensitive Vapour Script into browser ESM. VS deliberately
 * shares JavaScript's runtime object model, so VS and TypeScript modules can
 * import each other and receive identical Vapour engine objects. */
export function compileVapourScript(source: string, file = "script.vs"): VapourScriptCompileResult {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const output: string[] = [`// Compiled from ${file} by Vapour Script`, `const __vs_range=(a,b,s=1)=>{const r=[];if(b===undefined){b=a;a=0}if(s===0)throw new Error("VS range step cannot be zero");for(let i=a;s>0?i<b:i>b;i+=s)r.push(i);return r};`];
  const blocks: OpenBlock[] = [];
  let previousIndent = 0;
  let expectsIndent = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!;
    if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) continue;
    if (raw.includes("\t")) fail(file, index + 1, raw.indexOf("\t") + 1, "Tabs are not allowed for indentation; use spaces.", raw);
    const indent = raw.length - raw.trimStart().length;
    if (indent % 4 !== 0) fail(file, index + 1, 1, `Indentation must use multiples of four spaces; found ${String(indent)}.`, raw);
    const text = stripComment(raw.trimEnd()).trim();
    if (text === "") continue;
    if (expectsIndent && indent <= previousIndent) fail(file, index + 1, indent + 1, "Expected an indented block after a statement ending in ':'.", raw);
    if (!expectsIndent && indent > previousIndent) fail(file, index + 1, indent + 1, "Unexpected indentation; only block statements ending in ':' may indent.", raw);
    const continuationHint = /^(?:elif\s|else\s*:)/.test(text);
    while (blocks.length > 0 && (continuationHint ? indent < blocks[blocks.length - 1]!.indent : indent <= blocks[blocks.length - 1]!.indent)) { output.push(`${spaces(blocks.length - 1)}}`); blocks.pop(); }

    const compiled = compileLine(text, file, index + 1, raw);
    const depth = blocks.length;
    if (compiled.continuation) {
      if (blocks.length === 0) fail(file, index + 1, indent + 1, `'${compiled.kind}' has no matching block.`, raw);
      blocks.pop();
      output.push(`${spaces(depth - 1)}} ${compiled.code} {`);
      blocks.push({ indent, kind: compiled.kind });
    } else if (compiled.block) {
      output.push(`${spaces(depth)}${compiled.code} {`);
      blocks.push({ indent, kind: compiled.kind });
    } else output.push(`${spaces(depth)}${compiled.code}`);
    expectsIndent = compiled.block || compiled.continuation;
    previousIndent = indent;
  }
  if (expectsIndent) fail(file, lines.length, 1, "File ended while an indented block was expected.", lines.at(-1) ?? "");
  while (blocks.length > 0) { output.push(`${spaces(blocks.length - 1)}}`); blocks.pop(); }
  return Object.freeze({
    code: `${output.join("\n")}\n//# sourceURL=${file}\n`,
    sourceMap: Object.freeze({ version: 3 as const, sources: Object.freeze([file]), names: Object.freeze([]), mappings: "" }),
  });
}

function compileLine(text: string, file: string, line: number, raw: string): { code: string; block: boolean; continuation: boolean; kind: string } {
  const block = text.endsWith(":");
  const body = block ? text.slice(0, -1).trim() : text;
  const simple = (code: string) => ({ code, block: false, continuation: false, kind: "statement" });
  const opens = (code: string, kind: string, continuation = false) => ({ code, block: true, continuation, kind });

  let match = /^from\s+(["'][^"']+["'])\s+import\s+(.+)$/.exec(body);
  if (match) return simple(`import { ${match[2]!.split(",").map((v) => v.trim()).join(", ")} } from ${match[1]!};`);
  match = /^import\s+(["'][^"']+["'])(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(body);
  if (match) return simple(match[2] === undefined ? `import ${match[1]!};` : `import * as ${match[2]} from ${match[1]!};`);
  match = /^(export\s+)?(?:async\s+)?func\s+([A-Za-z_$][\w$]*)\s*\((.*)\)$/.exec(body);
  if (match) {
    const isAsync = /^(?:export\s+)?async\s+func/.test(body);
    return opens(`${match[1] ?? ""}${isAsync ? "async " : ""}function ${match[2]!}(${stripParameterTypes(match[3]!)})`, "function");
  }
  match = /^(export\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+(.+))?$/.exec(body);
  if (match) return opens(`${match[1] ?? ""}class ${match[2]!}${match[3] === undefined ? "" : ` extends ${expression(match[3])}`}`, "class");
  match = /^(?:func\s+)?([A-Za-z_$][\w$]*)\s*\((.*)\)$/.exec(body);
  if (block && match) return opens(`${match[1]!}(${stripParameterTypes(match[2]!)})`, "method");
  match = /^if\s+(.+)$/.exec(body); if (match) return opens(`if (${expression(match[1]!)})`, "if");
  match = /^elif\s+(.+)$/.exec(body); if (match) return opens(`else if (${expression(match[1]!)})`, "elif", true);
  if (body === "else") return opens("else", "else", true);
  match = /^while\s+(.+)$/.exec(body); if (match) return opens(`while (${expression(match[1]!)})`, "while");
  match = /^for\s+([A-Za-z_$][\w$]*)\s+in\s+(.+)$/.exec(body); if (match) return opens(`for (const ${match[1]!} of ${expression(match[2]!)})`, "for");
  match = /^match\s+(.+)$/.exec(body); if (match) return opens(`switch (${expression(match[1]!)})`, "match");
  match = /^case\s+(.+)$/.exec(body); if (match) return opens(`case ${expression(match[1]!)}:`, "case");
  if (body === "default") return opens("default:", "default");
  match = /^(var|const)\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[^=]+)?(?:\s*=\s*(.+))?$/.exec(body);
  if (match) return simple(`${match[1] === "var" ? "let" : "const"} ${match[2]!}${match[3] === undefined ? "" : ` = ${expression(match[3])}`};`);
  match = /^return(?:\s+(.+))?$/.exec(body); if (match) return simple(`return${match[1] === undefined ? "" : ` ${expression(match[1])}`};`);
  if (body === "pass") return simple(";");
  if (body === "break" || body === "continue") return simple(`${body};`);
  if (block) fail(file, line, raw.indexOf(text) + 1, `Unknown block statement '${body}'.`, raw);
  return simple(`${expression(body)};`);
}

function expression(value: string): string {
  let result = "", quote = "", escaped = false;
  for (let i = 0; i < value.length;) {
    const char = value[i]!;
    if (quote !== "") { result += char; if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === quote) quote = ""; i++; continue; }
    if (char === '"' || char === "'" || char === "`") { quote = char; result += char; i++; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.slice(i))?.[0];
    if (word !== undefined) { result += ({ and: "&&", or: "||", not: "!", True: "true", False: "false", None: "null", self: "this", range: "__vs_range" } as Record<string, string>)[word] ?? word; i += word.length; continue; }
    result += char; i++;
  }
  return result;
}
function stripParameterTypes(value: string): string { return value.split(",").map((part) => part.trim().replace(/:\s*[A-Za-z_$][\w$<>,.[\] |]*/g, "")).join(", "); }
function stripComment(value: string): string { let quote = "", escaped = false; for (let i = 0; i < value.length; i++) { const c = value[i]!; if (quote !== "") { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === quote) quote = ""; } else if (c === '"' || c === "'" || c === "`") quote = c; else if (c === "#") return value.slice(0, i); } return value; }
function spaces(depth: number): string { return "  ".repeat(Math.max(0, depth)); }
function fail(file: string, line: number, column: number, message: string, sourceLine: string): never { throw new VapourScriptCompileError([{ file, line, column, severity: "error", message, sourceLine }]); }
