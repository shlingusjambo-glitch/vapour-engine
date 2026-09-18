import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./plugins.js";
describe("PluginRegistry", () => {
    it("loads namespaced extensions in deterministic order", async () => {
        const registry = new PluginRegistry();
        await registry.load({ id: "studio.gameplay", version: "1.0.0", engineRange: "^0.2.0-alpha", register(context) {
                context.registerSystem({ id: "studio.late", order: 20, update() { } });
                context.registerSystem({ id: "studio.early", order: 10, update() { } });
            } });
        expect(registry.orderedSystems().map((system) => system.id)).toEqual(["studio.early", "studio.late"]);
    });
    it("rejects registration outside plugin loading", () => {
        const registry = new PluginRegistry();
        expect(() => registry.registerSystem({ id: "studio.system", order: 0, update() { } })).toThrow("while a plugin is loading");
    });
});
//# sourceMappingURL=plugins.test.js.map