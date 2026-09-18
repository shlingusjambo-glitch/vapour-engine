import { describe, expect, it } from "vitest";
import { GameRuntime } from "./core/game-runtime.js";
import { HeadlessRenderHost } from "./render/headless-render-host.js";
import { TerrainHeightfield } from "./world/terrain.js";
import { UiDocument } from "./ui/ui.js";
import { composeUi2D } from "./render/ui-renderer-2d.js";
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
describe("Alpha 0.2 integrated engine path", () => {
    it("renders generated terrain and retained 2D UI through world and overlay layers", async () => {
        const originalRaf = globalThis.requestAnimationFrame;
        const originalCaf = globalThis.cancelAnimationFrame;
        Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: () => 1 });
        Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: () => undefined });
        const host = new HeadlessRenderHost();
        await host.initialize();
        const terrain = TerrainHeightfield.generate(5, 5, [8, 2, 8], (x, z) => x * z);
        const ui = new UiDocument({ id: "root", role: "panel", children: [{ id: "card", role: "panel", style: { width: "content", height: "content", padding: 4 }, children: [{ id: "icon", role: "image", intrinsicSize: [32, 20] }] }] });
        ui.layout(320, 180);
        const sprite = { id: "card", material: "ui", textureSize: [1, 1], rect: [0, 0, 1, 1] };
        const batches = composeUi2D(ui, { card: { background: sprite } }, [320, 180], 100, "acceptance");
        const canvas = { clientWidth: 320, clientHeight: 180 };
        const runtime = new GameRuntime(canvas, { start(game) { game.uploadMesh("terrain", terrain.mesh()); for (const batch of batches)
                game.uploadMesh(batch.id, batch.mesh); }, update(game) { game.frame.setCamera(IDENTITY, 60, 0.1, 100); game.frame.draw("terrain", IDENTITY); game.overlay.setOrthographicCamera(IDENTITY, 1.8, 0.1, 100); for (const batch of batches)
                game.overlay.draw(batch.id, IDENTITY); } }, { host, audio: false });
        await runtime.start();
        runtime.step(performance.now() + 16);
        expect(host.snapshot()).toMatchObject({ instances: 2, drawCalls: 2 });
        expect(host.snapshot().meshIds).toEqual(["terrain", "acceptance:0"]);
        runtime.destroy();
        Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: originalRaf });
        Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: originalCaf });
    });
});
//# sourceMappingURL=alpha-0.2.integration.test.js.map