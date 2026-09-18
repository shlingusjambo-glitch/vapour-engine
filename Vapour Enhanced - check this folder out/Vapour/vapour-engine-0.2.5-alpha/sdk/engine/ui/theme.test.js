import { describe, expect, it } from "vitest";
import { STANDARD_TOKENS, ThemeRegistry, defaultTheme, highContrastTheme } from "./theme.js";
describe("ThemeRegistry", () => {
    it("ships a default and a high-contrast theme", () => {
        const themes = new ThemeRegistry();
        expect(themes.names).toEqual(["default", "high-contrast"]);
        expect(themes.active).toBe("default");
    });
    it("inherits, so a variant is a dozen tokens rather than a full copy", () => {
        // A full copy silently drifts from the base as the base changes.
        const themes = new ThemeRegistry();
        const base = themes.resolve("default");
        const contrast = themes.resolve("high-contrast");
        expect(Object.keys(contrast).length).toBe(Object.keys(base).length);
        // Overridden.
        expect(contrast[STANDARD_TOKENS.text]).toEqual([1, 1, 1, 1]);
        // Inherited untouched.
        expect(contrast[STANDARD_TOKENS.radius]).toBe(base[STANDARD_TOKENS.radius]);
    });
    it("switches the active theme", () => {
        const themes = new ThemeRegistry();
        themes.setActive("high-contrast");
        expect(themes.color(STANDARD_TOKENS.background)).toEqual([0, 0, 0, 1]);
        expect(() => themes.setActive("nope")).toThrow(/No theme named "nope".*Themes: default/s);
    });
    it("reads typed tokens", () => {
        const themes = new ThemeRegistry();
        expect(themes.number(STANDARD_TOKENS.spacing)).toBe(8);
        expect(themes.color(STANDARD_TOKENS.accent)).toHaveLength(4);
        expect(() => themes.number(STANDARD_TOKENS.accent)).toThrow(/is not a number/);
        expect(() => themes.color(STANDARD_TOKENS.spacing)).toThrow(/is not a colour/);
    });
    it("throws on a missing token rather than guessing", () => {
        // A widget silently rendering the wrong colour is harder to notice than a
        // failure at startup.
        const themes = new ThemeRegistry();
        expect(() => themes.token("color.nonexistent")).toThrow(/has no token "color.nonexistent"/);
    });
    it("registers a custom theme extending the default", () => {
        const themes = new ThemeRegistry();
        themes.register({ name: "faction-red", extends: "default", tokens: { [STANDARD_TOKENS.accent]: [1, 0, 0, 1] } });
        themes.setActive("faction-red");
        expect(themes.color(STANDARD_TOKENS.accent)).toEqual([1, 0, 0, 1]);
        expect(themes.number(STANDARD_TOKENS.fontSize)).toBe(16);
    });
    it("invalidates its cache when a base theme is replaced", () => {
        const themes = new ThemeRegistry();
        themes.register({ name: "child", extends: "base", tokens: {} });
        themes.register({ name: "base", tokens: { "a.token": 1 } });
        expect(themes.resolve("child")["a.token"]).toBe(1);
        themes.register({ name: "base", tokens: { "a.token": 2 } });
        expect(themes.resolve("child")["a.token"]).toBe(2);
    });
    it("detects an inheritance cycle", () => {
        const themes = new ThemeRegistry([]);
        themes.register({ name: "a", extends: "b", tokens: {} });
        themes.register({ name: "b", extends: "a", tokens: {} });
        expect(() => themes.resolve("a")).toThrow(/inheritance cycle: a -> b -> a/);
    });
    it("ignores a missing parent rather than failing to resolve", () => {
        const themes = new ThemeRegistry([]);
        themes.register({ name: "orphan", extends: "gone", tokens: { "x": 1 } });
        expect(themes.resolve("orphan")).toEqual({ x: 1 });
    });
    it("validates names and reports statistics", () => {
        const themes = new ThemeRegistry();
        expect(() => themes.register({ name: " ", tokens: {} })).toThrow(/non-empty name/);
        expect(() => themes.resolve("ghost")).toThrow(/No theme named "ghost"/);
        expect(themes.stats()).toMatchObject({ themes: 2, active: "default" });
        expect(themes.stats().tokens).toBeGreaterThan(10);
    });
    it("exposes the standard themes as plain data", () => {
        expect(defaultTheme().name).toBe("default");
        expect(highContrastTheme().extends).toBe("default");
    });
});
//# sourceMappingURL=theme.test.js.map