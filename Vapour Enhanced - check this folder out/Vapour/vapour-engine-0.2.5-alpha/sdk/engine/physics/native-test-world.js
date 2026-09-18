/** Loads the real Rust/WASM physics world under Node for tests and proofs.
 *
 * The web-targeted `vapour_runtime.js` fetches its `.wasm` by URL, which Node
 * cannot do for `file:` URLs, so the bytes are read and handed to the
 * initializer directly. Returns `undefined` when the artifact has not been
 * built, so callers can skip rather than fail.
 */
import { createPhysicsWorld3d } from "./physics-3d.js";
export async function loadNativePhysics3d(gravity = [0, -9.81, 0]) {
    const directory = new URL("../../wasm/", import.meta.url);
    // A computed specifier keeps `node:fs` out of the browser type-check; this
    // helper only ever runs under vitest or a Node script.
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":")));
    let bytes;
    try {
        bytes = fs.readFileSync(new URL("vapour_runtime_bg.wasm", directory));
    }
    catch {
        return undefined;
    }
    return createPhysicsWorld3d({
        gravity,
        moduleUrl: new URL("vapour_runtime.js", directory).href,
        loadModule: async (url) => {
            const module = (await import(/* @vite-ignore */ url));
            return { default: () => module.default({ module_or_path: bytes }), PhysicsEngine3d: module.PhysicsEngine3d };
        },
    });
}
//# sourceMappingURL=native-test-world.js.map