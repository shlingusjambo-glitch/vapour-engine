export interface VapourScriptDiagnostic {
    readonly file: string;
    readonly line: number;
    readonly column: number;
    readonly severity: "error";
    readonly message: string;
    readonly sourceLine: string;
}
export declare class VapourScriptCompileError extends Error {
    readonly diagnostics: readonly VapourScriptDiagnostic[];
    constructor(diagnostics: readonly VapourScriptDiagnostic[]);
}
export interface VapourScriptCompileResult {
    readonly code: string;
    readonly sourceMap: {
        readonly version: 3;
        readonly sources: readonly string[];
        readonly names: readonly string[];
        readonly mappings: string;
    };
}
/** Compiles indentation-sensitive Vapour Script into browser ESM. VS deliberately
 * shares JavaScript's runtime object model, so VS and TypeScript modules can
 * import each other and receive identical Vapour engine objects. */
export declare function compileVapourScript(source: string, file?: string): VapourScriptCompileResult;
//# sourceMappingURL=vapour-script.d.ts.map