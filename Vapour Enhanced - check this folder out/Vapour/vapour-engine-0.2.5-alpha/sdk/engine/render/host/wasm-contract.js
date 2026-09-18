/** The TypeScript side of the Rust renderer's FFI contract.
 *
 * These declarations describe exactly what `vapour-wasm` exports. They are the
 * only place in the engine that knows the shape of the WASM boundary, so a
 * change on the Rust side surfaces here as a type error rather than as a
 * runtime failure somewhere inside the host.
 */
export const defaultModuleLoader = async (moduleUrl) => (await import(/* @vite-ignore */ moduleUrl));
//# sourceMappingURL=wasm-contract.js.map