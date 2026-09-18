/** Loads the real Rust/WASM physics world under Node for tests and proofs.
 *
 * The web-targeted `vapour_runtime.js` fetches its `.wasm` by URL, which Node
 * cannot do for `file:` URLs, so the bytes are read and handed to the
 * initializer directly. Returns `undefined` when the artifact has not been
 * built, so callers can skip rather than fail.
 */
import { type PhysicsWorld3dBridge } from "./physics-3d.js";
export declare function loadNativePhysics3d(gravity?: readonly [number, number, number]): Promise<PhysicsWorld3dBridge | undefined>;
//# sourceMappingURL=native-test-world.d.ts.map