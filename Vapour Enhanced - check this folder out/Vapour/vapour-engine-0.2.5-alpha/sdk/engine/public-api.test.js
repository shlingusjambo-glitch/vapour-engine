import { describe, expect, it } from "vitest";
import * as engine from "./index.js";
/**
 * Mirage reorganised `@vapour/engine` from 55 flat modules into subsystem
 * directories and moved the gameplay framework into `@vapour/gameplay`. None of
 * that is allowed to change what a project sees when it imports the engine, so
 * this test pins the public barrel: every symbol below was reachable from
 * `@vapour/engine` before the reorganisation and must stay reachable.
 */
describe("public API compatibility", () => {
    const required = [
        // core
        "validateScene", "SceneDocument", "SCENE_FORMAT_VERSION", "quaternionFromEuler",
        "normalizeQuaternion", "detectBrowserCapabilities", "diagnoseCapabilities",
        "ComponentSchemaRegistry", "builtinComponentSchemas", "TRANSFORM_TYPE_NAME",
        // render
        "extractRenderWorld", "viewProjectionMatrix", "perspective", "orthographic",
        "WebGpuRenderHost", "HeadlessRenderHost", "validateTextureUpload", "validateMaterialUpload",
        // assets
        "meshLibrary", "requireMesh", "meshDescriptor", "DEFAULT_MESH_ID", "pickingHalfExtents",
        // gameplay, now re-exported from @vapour/gameplay
        "InventoryContainer", "CraftingRegistry", "Combatant", "StatusEffectSet",
        "NarrativeRunner", "TypewriterText", "validateNarrativeProgram",
    ];
    it.each(required)("still exports %s", (name) => {
        expect(engine).toHaveProperty(name);
    });
    it("re-exports the gameplay framework so pre-Mirage imports keep working", async () => {
        const gameplay = await import("@vapour/gameplay");
        for (const name of Object.keys(gameplay)) {
            expect(engine, `@vapour/engine must re-export ${name}`).toHaveProperty(name);
        }
    });
});
//# sourceMappingURL=public-api.test.js.map