import { describe, expect, it, vi } from "vitest";
import { Application, captureScreenshot, copyText, readText } from "./application.js";
function fakeHost() {
    const listeners = new Map();
    return {
        addEventListener(type, listener) {
            if (!listeners.has(type))
                listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        fire(type) {
            for (const listener of [...(listeners.get(type) ?? [])])
                listener();
        },
        count(type) {
            return listeners.get(type)?.size ?? 0;
        },
    };
}
function fakeVisibility() {
    const host = fakeHost();
    return Object.assign(host, {
        visibilityState: "visible",
        hide() {
            this.visibilityState = "hidden";
            host.fire("visibilitychange");
        },
        show() {
            this.visibilityState = "visible";
            host.fire("visibilitychange");
        },
    });
}
describe("Application", () => {
    it("runs by default", () => {
        const app = new Application();
        expect(app.running).toBe(true);
        expect(app.visible).toBe(true);
    });
    it("pauses when the page is hidden and resumes when shown", () => {
        const visibility = fakeVisibility();
        const app = new Application({ visibility });
        const paused = vi.fn();
        const resumed = vi.fn();
        app.paused.on(paused);
        app.resumed.on(resumed);
        visibility.hide();
        expect(app.running).toBe(false);
        expect(app.visible).toBe(false);
        expect(paused).toHaveBeenCalledOnce();
        visibility.show();
        expect(app.running).toBe(true);
        expect(resumed).toHaveBeenCalledOnce();
    });
    it("keeps running while hidden when asked to", () => {
        const visibility = fakeVisibility();
        const app = new Application({ visibility, runWhileHidden: true });
        visibility.hide();
        expect(app.running).toBe(true);
    });
    it("refuses to resume while hidden", () => {
        const visibility = fakeVisibility();
        const app = new Application({ visibility });
        visibility.hide();
        app.resume();
        expect(app.running).toBe(false);
    });
    it("pauses and resumes explicitly, emitting only on a real change", () => {
        const app = new Application();
        const paused = vi.fn();
        app.paused.on(paused);
        app.pause();
        app.pause();
        expect(paused).toHaveBeenCalledOnce();
        expect(app.running).toBe(false);
        app.resume();
        expect(app.running).toBe(true);
    });
    it("tracks focus separately from visibility", () => {
        const host = fakeHost();
        const app = new Application({ host });
        const focusChanged = vi.fn();
        app.focusChanged.on(focusChanged);
        host.fire("blur");
        expect(app.focused).toBe(false);
        // Losing focus alone does not stop the simulation.
        expect(app.running).toBe(true);
        host.fire("focus");
        expect(app.focused).toBe(true);
        expect(focusChanged).toHaveBeenCalledTimes(2);
    });
    it("emits willClose on pagehide", () => {
        const host = fakeHost();
        const app = new Application({ host });
        const willClose = vi.fn();
        app.willClose.on(willClose);
        host.fire("pagehide");
        expect(willClose).toHaveBeenCalledOnce();
    });
    it("removes its listeners on dispose", () => {
        const host = fakeHost();
        const visibility = fakeVisibility();
        const app = new Application({ host, visibility });
        expect(host.count("focus")).toBe(1);
        app.dispose();
        app.dispose();
        expect(host.count("focus")).toBe(0);
        expect(visibility.count("visibilitychange")).toBe(0);
    });
});
describe("clipboard", () => {
    it("reports success and refusal as data", async () => {
        await expect(copyText("hi", { writeText: async () => { }, readText: async () => "" })).resolves.toEqual({ ok: true });
        const refusing = { writeText: async () => { throw new Error("not allowed"); }, readText: async () => { throw new Error("denied"); } };
        await expect(copyText("hi", refusing)).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("not allowed") });
        await expect(readText(refusing)).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("denied") });
    });
    it("reads text back", async () => {
        await expect(readText({ writeText: async () => { }, readText: async () => "copied" })).resolves.toEqual({ ok: true, text: "copied" });
    });
});
describe("captureScreenshot", () => {
    it("resolves with the blob the canvas produces", async () => {
        const blob = new Blob(["png"]);
        const canvas = { toBlob: (callback) => callback(blob) };
        await expect(captureScreenshot(canvas)).resolves.toBe(blob);
    });
    it("passes the requested type and quality through", async () => {
        const toBlob = vi.fn((callback) => callback(new Blob([])));
        await captureScreenshot({ toBlob }, { type: "image/jpeg", quality: 0.5 });
        expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.5);
    });
    it("explains a blank capture rather than resolving with nothing", async () => {
        const canvas = { toBlob: (callback) => callback(null) };
        await expect(captureScreenshot(canvas)).rejects.toThrow(/Capture immediately after rendering/);
    });
    it("rejects an out-of-range quality", async () => {
        const canvas = { toBlob: (callback) => callback(new Blob([])) };
        await expect(captureScreenshot(canvas, { quality: 2 })).rejects.toThrow(/\[0, 1\]/);
    });
});
//# sourceMappingURL=application.test.js.map