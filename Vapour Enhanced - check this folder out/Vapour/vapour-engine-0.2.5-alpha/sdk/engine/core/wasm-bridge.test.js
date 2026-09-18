import { describe, expect, it } from "vitest";
import { SceneDocument } from "./scene-document.js";
import { WasmRuntimeBridge } from "./wasm-bridge.js";
class FakeEngine {
    batches = [];
    apply_commands(json) { this.batches.push(json); }
    tick() { return 1; }
    snapshot_json() { return JSON.stringify({ entityCount: 1, entities: [] }); }
}
describe("WasmRuntimeBridge", () => {
    it("crosses the WASM boundary once for a scene batch", () => {
        const scene = new SceneDocument();
        const parent = scene.addEntity("Parent");
        scene.addEntity("Child", parent.id);
        const engine = new FakeEngine();
        const bridge = new WasmRuntimeBridge(engine);
        bridge.loadScene(scene.data);
        const frame = bridge.step(1 / 60);
        expect(engine.batches).toHaveLength(1);
        expect(JSON.parse(engine.batches[0])).toHaveLength(3);
        expect(frame.fixedSteps).toBe(1);
    });
});
//# sourceMappingURL=wasm-bridge.test.js.map