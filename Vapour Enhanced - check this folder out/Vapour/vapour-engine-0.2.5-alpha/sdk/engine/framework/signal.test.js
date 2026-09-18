import { describe, expect, it, vi } from "vitest";
import { EventBus, Signal } from "./signal.js";
describe("Signal", () => {
    it("calls listeners with the payload in subscription order", () => {
        const signal = new Signal();
        const order = [];
        signal.on((value) => order.push(`a${value}`));
        signal.on((value) => order.push(`b${value}`));
        signal.emit(1);
        expect(order).toEqual(["a1", "b1"]);
    });
    it("honours an explicit order, keeping insertion order within a tier", () => {
        const signal = new Signal();
        const order = [];
        signal.on(() => order.push("late"), 10);
        signal.on(() => order.push("early"), -10);
        signal.on(() => order.push("mid-a"));
        signal.on(() => order.push("mid-b"));
        signal.emit();
        expect(order).toEqual(["early", "mid-a", "mid-b", "late"]);
    });
    it("unsubscribes through the returned function and through off()", () => {
        const signal = new Signal();
        const listener = vi.fn();
        const unsubscribe = signal.on(listener);
        unsubscribe();
        signal.emit();
        expect(listener).not.toHaveBeenCalled();
        signal.on(listener);
        signal.off(listener);
        signal.emit();
        expect(listener).not.toHaveBeenCalled();
        expect(signal.listenerCount).toBe(0);
    });
    it("is safe to unsubscribe during emission without skipping a neighbour", () => {
        const signal = new Signal();
        const seen = [];
        const unsubscribeSelf = signal.on(() => {
            seen.push("first");
            unsubscribeSelf();
        });
        signal.on(() => seen.push("second"));
        signal.emit();
        expect(seen).toEqual(["first", "second"]);
        signal.emit();
        expect(seen).toEqual(["first", "second", "second"]);
    });
    it("does not call a listener added during emission until the next emit", () => {
        const signal = new Signal();
        const seen = [];
        signal.on(() => {
            seen.push("outer");
            signal.on(() => seen.push("inner"));
        });
        signal.emit();
        expect(seen).toEqual(["outer"]);
        signal.emit();
        expect(seen).toEqual(["outer", "outer", "inner"]);
    });
    it("removes a once listener after one call, even when it throws nothing", () => {
        const signal = new Signal();
        const listener = vi.fn();
        signal.once(listener);
        signal.emit("a");
        signal.emit("b");
        expect(listener).toHaveBeenCalledExactlyOnceWith("a");
        expect(signal.listenerCount).toBe(0);
    });
    it("clears every listener", () => {
        const signal = new Signal();
        signal.on(vi.fn());
        signal.once(vi.fn());
        signal.clear();
        expect(signal.listenerCount).toBe(0);
    });
    it("rejects a non-function listener and a non-finite order", () => {
        const signal = new Signal();
        expect(() => signal.on(undefined)).toThrow(/must be a function/);
        expect(() => signal.on(() => { }, Number.NaN)).toThrow(/finite number/);
    });
    it("awaits the next emission and honours cancellation", async () => {
        const signal = new Signal();
        const pending = signal.next();
        signal.emit(7);
        await expect(pending).resolves.toBe(7);
        const controller = new AbortController();
        const cancelled = signal.next({ signal: controller.signal });
        controller.abort(new Error("gave up"));
        await expect(cancelled).rejects.toThrow(/gave up/);
        expect(signal.listenerCount).toBe(0);
    });
});
describe("EventBus", () => {
    it("routes typed payloads per channel", () => {
        const bus = new EventBus();
        const died = vi.fn();
        const picked = vi.fn();
        bus.on("player.died", died);
        bus.on("item.picked", picked);
        bus.emit("player.died", { cause: "fall" });
        expect(died).toHaveBeenCalledExactlyOnceWith({ cause: "fall" });
        expect(picked).not.toHaveBeenCalled();
    });
    it("emitting a channel nobody listens to is a no-op", () => {
        const bus = new EventBus();
        expect(() => bus.emit("player.died", { cause: "none" })).not.toThrow();
    });
    it("reuses one signal per channel", () => {
        const bus = new EventBus();
        expect(bus.channel("player.died")).toBe(bus.channel("player.died"));
    });
    it("reports channels that have listeners", () => {
        const bus = new EventBus();
        const off = bus.on("player.died", vi.fn());
        bus.once("item.picked", vi.fn());
        expect(bus.activeChannels()).toEqual(["item.picked", "player.died"]);
        off();
        expect(bus.activeChannels()).toEqual(["item.picked"]);
    });
    it("clears every channel", () => {
        const bus = new EventBus();
        const listener = vi.fn();
        bus.on("player.died", listener);
        bus.clear();
        bus.emit("player.died", { cause: "fall" });
        expect(listener).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=signal.test.js.map