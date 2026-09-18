import { describe, expect, it } from "vitest";
import { FONT_ASSET_VERSION, fontAtlasFromAsset, parseFontAsset, resolveFallback, sdfThresholds, serializeFontAsset, validateFontAsset, } from "./font-asset.js";
import { measureText, parseRichText, resolveGlyphs, missingCharacters, wrapText, TextLayoutCache } from "./rich-text.js";
/** Mirage M91: font assets, fallback chains, rich text with outlines and shadows. */
const latin = {
    version: FONT_ASSET_VERSION,
    id: "font:latin",
    family: "Test Sans",
    style: "normal",
    designSize: 10,
    lineHeight: 12,
    ascent: 9,
    textureSize: [16, 16],
    glyphs: [
        { character: "A", rect: [0, 0, 8, 10], advance: 8, bearing: [0, 8] },
        { character: "B", rect: [8, 0, 7, 10], advance: 7, bearing: [0, 8] },
        { character: " ", rect: [0, 0, 0, 0], advance: 4, bearing: [0, 0] },
        { character: "?", rect: [0, 10, 6, 6], advance: 6, bearing: [0, 8] },
    ],
    fallbackCharacter: "?",
    sdf: { radius: 4, threshold: 0.5 },
    source: { kind: "inline", pixels: new Uint8Array(16 * 16 * 4) },
};
const cjk = {
    id: "font:cjk", material: "material:cjk", textureSize: [32, 32], designSize: 10, lineHeight: 12,
    glyphs: [{ character: "漢", rect: [0, 0, 10, 10], advance: 10, bearing: [0, 8] }],
};
describe("font assets", () => {
    it("validates a well-formed asset and converts it to a runtime atlas", () => {
        expect(validateFontAsset(latin)).toEqual([]);
        const atlas = fontAtlasFromAsset(latin, "material:latin");
        expect(atlas.material).toBe("material:latin");
        expect(atlas.glyphs).toHaveLength(4);
        expect(atlas.fallbackCharacter).toBe("?");
    });
    it("reports every problem with a path", () => {
        const issues = validateFontAsset({
            ...latin,
            version: 99,
            family: "",
            glyphs: [{ character: "A", rect: [10, 10, 8, 10], advance: 8, bearing: [0, 0] }, { character: "A", rect: [0, 0, 1, 1], advance: NaN, bearing: [0, 0] }],
            fallbackCharacter: "Z",
            source: { kind: "inline", pixels: new Uint8Array(3) },
        });
        const codes = new Map(issues.map((issue) => [issue.path, issue.code]));
        expect(codes.get("version")).toBe("unsupported-version");
        expect(codes.get("family")).toBe("missing-field");
        expect(codes.get("glyphs[0].rect")).toBe("outside-atlas");
        expect(codes.get("glyphs[1].character")).toBe("duplicate");
        expect(codes.get("glyphs[1].advance")).toBe("invalid-advance");
        expect(codes.get("fallbackCharacter")).toBe("missing-glyph");
        expect(codes.get("source.pixels")).toBe("wrong-length");
    });
    it("round-trips through JSON, rejoining pixels on parse", () => {
        const json = serializeFontAsset(latin, "latin.rgba");
        expect(JSON.parse(json).source).toEqual({ kind: "path", path: "latin.rgba" });
        const parsed = parseFontAsset(json, latin.source.pixels);
        expect(parsed.source.kind).toBe("inline");
        expect(parsed.glyphs).toEqual(latin.glyphs);
        expect(() => parseFontAsset(JSON.stringify({ ...JSON.parse(json), designSize: -1 }))).toThrow(/designSize/);
    });
});
describe("fallback chains", () => {
    it("resolves each code point to the first font that has it and reports the gaps", () => {
        const chain = { name: "ui", fonts: [fontAtlasFromAsset(latin, "m"), cjk] };
        const resolution = resolveFallback(chain, "A漢B€");
        expect(resolution.indices).toEqual([0, 1, 0, -1]);
        expect(resolution.missing).toEqual(["€"]);
        expect(resolution.usage).toEqual([2, 1]);
        // The existing per-character resolver agrees.
        expect(resolveGlyphs(chain, "A漢").map((entry) => entry.font.id)).toEqual(["font:latin", "font:cjk"]);
        expect(missingCharacters(chain, "A€")).toEqual(["€"]);
    });
});
describe("rich text effects", () => {
    const outline = { width: 1, color: [0, 0, 0, 1] };
    const shadow = { offset: [1, 1], color: [0, 0, 0, 0.5], softness: 2 };
    it("applies named outlines and shadows through markup and nests them", () => {
        const runs = parseRichText("plain [outline=ink]out [shadow=soft]both[/shadow] out[/outline] plain", { outlines: { ink: outline }, shadows: { soft: shadow } });
        expect(runs.map((run) => run.text)).toEqual(["plain ", "out ", "both", " out", " plain"]);
        expect(runs[1]?.style.outline).toBe(outline);
        expect(runs[2]?.style).toMatchObject({ outline, shadow });
        expect(runs[3]?.style.shadow).toBeUndefined();
        expect(runs[4]?.style.outline).toBeUndefined();
    });
    it("reports an unknown effect name and keeps the text", () => {
        const unknown = [];
        const runs = parseRichText("[shadow=nope]x[/shadow]", { onUnknownTag: (tag) => unknown.push(tag) });
        expect(runs.map((run) => run.text).join("")).toBe("x");
        expect(unknown).toEqual(["shadow=nope"]);
    });
    it("derives SDF thresholds for fill, outline, and shadow from the atlas radius", () => {
        const thresholds = sdfThresholds({ radius: 4, threshold: 0.5 }, { outline, shadow });
        expect(thresholds.fill).toBe(0.5);
        // One design pixel of outline is 1 / (2 * 4) of the field.
        expect(thresholds.outline).toBeCloseTo(0.375);
        expect(thresholds.shadow).toBeCloseTo(0.25);
        expect(sdfThresholds({ radius: 4, threshold: 0.5 }, {}).outline).toBeUndefined();
    });
});
describe("rich text parsing and measurement (previously untested)", () => {
    const atlas = fontAtlasFromAsset(latin, "m");
    it("parses bold, colour, and size with a closed palette", () => {
        const runs = parseRichText("a[b]b[color=red]c[/color][/b]d", { palette: { red: [1, 0, 0, 1] } });
        expect(runs.map((run) => [run.text, run.style.bold ?? false, run.style.color?.[0] ?? 0])).toEqual([["a", false, 0], ["b", true, 0], ["c", true, 1], ["d", false, 0]]);
        expect(parseRichText("[size=2]x[/size]")[0]?.style.scale).toBe(2);
    });
    it("measures without building a mesh and wraps at word boundaries", () => {
        const metrics = measureText(atlas, "AB AB", { fontSize: 10, maxWidth: 16 });
        expect(metrics.lineCount).toBe(2);
        expect(metrics.width).toBe(15);
        expect(metrics.height).toBe(24);
        expect(wrapText("AB AB", 16, (c) => (c === " " ? 4 : c === "A" ? 8 : 7), false)).toEqual(["AB", "AB"]);
    });
    it("caches by content and options with LRU eviction and stats", () => {
        const cache = new TextLayoutCache(2);
        const key = TextLayoutCache.key("hi", { fontSize: 10, maxWidth: undefined });
        expect(TextLayoutCache.key("hi", { maxWidth: undefined, fontSize: 10 })).toBe(key);
        expect(cache.get(key)).toBeUndefined();
        cache.set(key, 1, 8);
        cache.set("b", 2);
        cache.set("c", 3);
        expect(cache.get(key)).toBeUndefined();
        expect(cache.stats()).toMatchObject({ entries: 2, hits: 0, misses: 2 });
    });
});
//# sourceMappingURL=font-asset.test.js.map