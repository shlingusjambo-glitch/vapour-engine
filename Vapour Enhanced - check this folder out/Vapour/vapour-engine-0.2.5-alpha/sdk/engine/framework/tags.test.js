import { describe, expect, it } from "vitest";
import { GroupRegistry, LAYER_COUNT, LAYER_MASK_ALL, LAYER_MASK_NONE, LayerRegistry, TagIndex, layerMask, layersInMask, maskHasLayer, maskWithLayer, maskWithoutLayer, masksOverlap, } from "./tags.js";
describe("layers", () => {
    it("builds and queries masks", () => {
        const mask = layerMask(0, 3);
        expect(maskHasLayer(mask, 0)).toBe(true);
        expect(maskHasLayer(mask, 1)).toBe(false);
        expect(layersInMask(mask)).toEqual([0, 3]);
        expect(layersInMask(LAYER_MASK_NONE)).toEqual([]);
        expect(layersInMask(LAYER_MASK_ALL)).toHaveLength(LAYER_COUNT);
    });
    it("adds and removes layers without sign trouble at the top bit", () => {
        const mask = maskWithLayer(LAYER_MASK_NONE, 31);
        expect(mask).toBeGreaterThan(0);
        expect(maskHasLayer(mask, 31)).toBe(true);
        expect(maskWithoutLayer(mask, 31)).toBe(0);
        expect(maskWithoutLayer(LAYER_MASK_ALL, 0)).toBeGreaterThan(0);
    });
    it("answers the interaction question with an overlap test", () => {
        expect(masksOverlap(layerMask(1, 2), layerMask(2, 3))).toBe(true);
        expect(masksOverlap(layerMask(1), layerMask(2))).toBe(false);
        expect(masksOverlap(LAYER_MASK_ALL, layerMask(31))).toBe(true);
    });
    it("rejects out-of-range layers", () => {
        expect(() => layerMask(32)).toThrow(/out of range/);
        expect(() => layerMask(-1)).toThrow(/out of range/);
        expect(() => maskHasLayer(0, 1.5)).toThrow(/out of range/);
    });
    it("names layers so gameplay never carries magic numbers", () => {
        const layers = new LayerRegistry();
        layers.define("default", 0);
        layers.define("player", 1);
        layers.define("enemy", 2);
        expect(layers.index("player")).toBe(1);
        expect(layers.name(2)).toBe("enemy");
        expect(layers.mask("player", "enemy")).toBe(layerMask(1, 2));
        expect(layers.describe(layers.mask("player", "enemy"))).toBe("player, enemy");
        expect(layers.describe(LAYER_MASK_NONE)).toBe("(none)");
        expect(layers.defined).toEqual([
            { name: "default", layer: 0 },
            { name: "player", layer: 1 },
            { name: "enemy", layer: 2 },
        ]);
    });
    it("refuses conflicting definitions and unknown names", () => {
        const layers = new LayerRegistry();
        layers.define("player", 1);
        layers.define("player", 1); // idempotent
        expect(() => layers.define("player", 2)).toThrow(/already defined as 1/);
        expect(() => layers.define("hero", 1)).toThrow(/already named "player"/);
        expect(() => layers.define("  ", 3)).toThrow(/must not be empty/);
        expect(() => layers.index("ghost")).toThrow(/not defined.*Defined layers: player/s);
    });
});
describe("TagIndex", () => {
    it("indexes both directions", () => {
        const tags = new TagIndex();
        tags.add("e1", "enemy", "flammable");
        tags.add("e2", "enemy");
        expect(tags.tagsOf("e1")).toEqual(["enemy", "flammable"]);
        expect([...tags.entitiesWith("enemy")].sort()).toEqual(["e1", "e2"]);
        expect(tags.tags).toEqual(["enemy", "flammable"]);
    });
    it("answers membership questions", () => {
        const tags = new TagIndex();
        tags.add("e1", "enemy", "flammable");
        expect(tags.has("e1", "enemy")).toBe(true);
        expect(tags.has("e1", "friendly")).toBe(false);
        expect(tags.hasAll("e1", "enemy", "flammable")).toBe(true);
        expect(tags.hasAll("e1", "enemy", "armoured")).toBe(false);
        expect(tags.hasAny("e1", "armoured", "flammable")).toBe(true);
    });
    it("intersects tags starting from the rarest", () => {
        const tags = new TagIndex();
        for (let index = 0; index < 50; index += 1)
            tags.add(`e${index}`, "enemy");
        tags.add("e7", "boss");
        expect(tags.entitiesWithAll("enemy", "boss")).toEqual(["e7"]);
        expect(tags.entitiesWithAll()).toEqual([]);
        expect(tags.entitiesWithAll("enemy", "missing")).toEqual([]);
    });
    it("removes tags and drops empty entries from both directions", () => {
        const tags = new TagIndex();
        tags.add("e1", "enemy");
        tags.remove("e1", "enemy");
        expect(tags.tagsOf("e1")).toEqual([]);
        expect(tags.entitiesWith("enemy")).toEqual([]);
        expect(tags.tags).toEqual([]);
    });
    it("forgets a destroyed entity everywhere", () => {
        const tags = new TagIndex();
        tags.add("e1", "enemy", "flammable");
        tags.add("e2", "enemy");
        tags.forget("e1");
        expect(tags.entitiesWith("enemy")).toEqual(["e2"]);
        expect(tags.entitiesWith("flammable")).toEqual([]);
        expect(tags.tagsOf("e1")).toEqual([]);
        // Forgetting an unknown entity is harmless.
        expect(() => tags.forget("ghost")).not.toThrow();
    });
    it("rejects empty tags and clears", () => {
        const tags = new TagIndex();
        expect(() => tags.add("e1", "  ")).toThrow(/must not be empty/);
        tags.add("e1", "enemy");
        tags.clear();
        expect(tags.tags).toEqual([]);
    });
});
describe("GroupRegistry", () => {
    it("maintains named collections", () => {
        const groups = new GroupRegistry();
        groups.add("squad-a", "e1", "e2");
        expect([...groups.members("squad-a")].sort()).toEqual(["e1", "e2"]);
        expect(groups.contains("squad-a", "e1")).toBe(true);
        expect(groups.names).toEqual(["squad-a"]);
    });
    it("removes members and prunes empty groups", () => {
        const groups = new GroupRegistry();
        groups.add("squad-a", "e1");
        groups.remove("squad-a", "e1");
        expect(groups.names).toEqual([]);
        expect(groups.members("squad-a")).toEqual([]);
    });
    it("reports which groups an entity belongs to and forgets it", () => {
        const groups = new GroupRegistry();
        groups.add("squad-a", "e1");
        groups.add("levers", "e1", "e2");
        expect(groups.groupsOf("e1")).toEqual(["levers", "squad-a"]);
        groups.forget("e1");
        expect(groups.groupsOf("e1")).toEqual([]);
        expect(groups.members("levers")).toEqual(["e2"]);
    });
    it("rejects empty group names and clears", () => {
        const groups = new GroupRegistry();
        expect(() => groups.add(" ", "e1")).toThrow(/must not be empty/);
        groups.add("a", "e1");
        groups.clear();
        expect(groups.names).toEqual([]);
    });
});
//# sourceMappingURL=tags.test.js.map