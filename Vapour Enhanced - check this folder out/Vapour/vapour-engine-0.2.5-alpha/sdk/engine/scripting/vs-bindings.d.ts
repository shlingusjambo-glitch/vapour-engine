/** A compiled script's `@vapour/engine` imports, resolved and executed. */
export interface VapourScriptRun {
    /** Everything the script `export`ed, by name. */
    readonly exports: Readonly<Record<string, unknown>>;
    /** The engine symbols the script imported. */
    readonly imported: readonly string[];
}
/**
 * Compiles and runs a script whose only imports come from `@vapour/engine`.
 *
 * Relative imports are refused rather than resolved: this runner exists to
 * prove the engine surface, and pretending to be a module loader would let a
 * test pass against files the real build never sees.
 */
export declare function runVapourScript(source: string, engine: Readonly<Record<string, unknown>>, file?: string): VapourScriptRun;
//# sourceMappingURL=vs-bindings.d.ts.map