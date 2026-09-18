import { describe, expect, it } from "vitest";
import { AssetDatabase } from "./asset-database.js";
describe("AssetDatabase", () => {
    it("preserves stable identity across moves", () => {
        const database = new AssetDatabase();
        const asset = database.register({ path: "Assets/brick.png", type: "texture", contentHash: "abc", dependencies: [], importSettings: {} });
        database.move(asset.id, "Assets/Textures/brick.png");
        expect(database.get(asset.id)?.path).toBe("Assets/Textures/brick.png");
        expect(database.getByPath("Assets/brick.png")).toBeUndefined();
    });
    it("prevents dangling references", () => {
        const database = new AssetDatabase();
        const texture = database.register({ path: "Assets/a.png", type: "texture", contentHash: "a", dependencies: [], importSettings: {} });
        database.register({ path: "Assets/a.material", type: "material", contentHash: "b", dependencies: [texture.id], importSettings: {} });
        expect(() => database.remove(texture.id)).toThrow("referenced by");
    });
});
//# sourceMappingURL=asset-database.test.js.map