import { describe, expect, it } from "vitest";
import { DragController, ScrollView, TextField, TooltipController, virtualRange } from "./widgets.js";
describe("ScrollView", () => {
    it("clamps to its scrollable range", () => {
        const view = new ScrollView({ viewportHeight: 100, contentHeight: 400 });
        expect(view.maxOffset).toBe(300);
        view.scrollTo(-50);
        expect(view.offset).toBe(0);
        view.scrollTo(9999);
        expect(view.offset).toBe(300);
    });
    it("does not scroll when the content fits", () => {
        const view = new ScrollView({ viewportHeight: 400, contentHeight: 100 });
        expect(view.scrollable).toBe(false);
        view.scrollSteps(5);
        expect(view.offset).toBe(0);
        expect(view.thumb).toEqual([0, 1]);
    });
    it("sizes the scrollbar thumb by the visible fraction", () => {
        const view = new ScrollView({ viewportHeight: 100, contentHeight: 400 });
        const [startTop, size] = view.thumb;
        expect(size).toBeCloseTo(0.25, 5);
        expect(startTop).toBe(0);
        view.scrollTo(view.maxOffset);
        expect(view.thumb[0]).toBeCloseTo(0.75, 5);
    });
    it("scrolls by steps and pages", () => {
        const view = new ScrollView({ viewportHeight: 100, contentHeight: 1000, step: 20 });
        view.scrollSteps(3);
        expect(view.offset).toBe(60);
        view.scrollPage(1);
        expect(view.offset).toBe(160);
    });
    it("reveals a range with the smallest scroll that works", () => {
        // Scrolling further than necessary loses the reader's place.
        const view = new ScrollView({ viewportHeight: 100, contentHeight: 1000 });
        view.revealRange(250, 20);
        expect(view.offset).toBe(170);
        // Already visible: no movement.
        const settled = view.offset;
        view.revealRange(200, 20);
        expect(view.offset).toBe(settled);
        // Above the fold: scrolls up to it.
        view.revealRange(50, 20);
        expect(view.offset).toBe(50);
    });
    it("springs back from overscroll and reports while settling", () => {
        const view = new ScrollView({ viewportHeight: 100, contentHeight: 400, overscroll: 40 });
        view.scrollTo(-30);
        expect(view.offset).toBe(-30);
        let settling = true;
        for (let step = 0; step < 100 && settling; step += 1)
            settling = view.settle(1 / 60);
        expect(view.offset).toBe(0);
        expect(view.settle(1 / 60)).toBe(false);
    });
    it("refuses overscroll by default, because on a mouse it reads as broken", () => {
        const view = new ScrollView({ viewportHeight: 100, contentHeight: 400 });
        view.scrollTo(-30);
        expect(view.offset).toBe(0);
    });
    it("keeps the offset in range when content resizes", () => {
        const view = new ScrollView({ viewportHeight: 100, contentHeight: 1000 });
        view.scrollTo(800);
        view.resize(100, 300);
        expect(view.offset).toBe(200);
    });
    it("validates its dimensions", () => {
        expect(() => new ScrollView({ viewportHeight: 0, contentHeight: 10 })).toThrow(/positive, finite/);
        expect(() => new ScrollView({ viewportHeight: 10, contentHeight: -1 })).toThrow(/non-negative/);
        expect(() => new ScrollView({ viewportHeight: 10, contentHeight: 10, step: 0 })).toThrow(/step must be positive/);
        expect(() => new ScrollView({ viewportHeight: 10, contentHeight: 10 }).scrollTo(Number.NaN)).toThrow(/must be finite/);
    });
});
describe("virtualRange", () => {
    it("exposes only the visible slice of a long list", () => {
        // Two thousand nodes cost more to lay out than to draw, every frame.
        const view = new ScrollView({ viewportHeight: 200, contentHeight: 2000 * 40 });
        const range = virtualRange(view, 40, 2000, 0);
        expect(range.firstIndex).toBe(0);
        expect(range.lastIndex).toBeLessThan(10);
        expect(range.offsetY).toBe(0);
    });
    it("tracks the scroll position", () => {
        const view = new ScrollView({ viewportHeight: 200, contentHeight: 2000 * 40 });
        view.scrollTo(4000);
        const range = virtualRange(view, 40, 2000, 0);
        expect(range.firstIndex).toBe(100);
        expect(range.offsetY).toBe(4000);
    });
    it("overscans so items do not pop in at the edges", () => {
        const view = new ScrollView({ viewportHeight: 200, contentHeight: 80_000 });
        view.scrollTo(4000);
        const tight = virtualRange(view, 40, 2000, 0);
        const padded = virtualRange(view, 40, 2000, 3);
        expect(padded.firstIndex).toBeLessThan(tight.firstIndex);
        expect(padded.lastIndex).toBeGreaterThan(tight.lastIndex);
    });
    it("handles an empty list and validates its arguments", () => {
        const view = new ScrollView({ viewportHeight: 100, contentHeight: 0 });
        expect(virtualRange(view, 40, 0)).toEqual({ firstIndex: 0, lastIndex: -1, offsetY: 0 });
        expect(() => virtualRange(view, 0, 5)).toThrow(/must be positive/);
        expect(() => virtualRange(view, 40, -1)).toThrow(/non-negative whole number/);
    });
});
describe("TextField", () => {
    it("inserts and deletes at the caret", () => {
        const field = new TextField({ value: "abc" });
        field.setCaret(1);
        field.insert("X");
        expect(field.value).toBe("aXbc");
        expect(field.caret).toBe(2);
        field.deleteCharacter(-1);
        expect(field.value).toBe("abc");
        field.deleteCharacter(1);
        expect(field.value).toBe("ac");
    });
    it("counts code points, not UTF-16 units", () => {
        // Indexing by units puts the caret inside an emoji and produces mojibake on
        // backspace — a bug that never appears in English testing.
        const field = new TextField({ value: "a👍b" });
        expect(field.length).toBe(3);
        field.setCaret(2);
        field.deleteCharacter(-1);
        expect(field.value).toBe("ab");
    });
    it("replaces a selection on insert", () => {
        const field = new TextField({ value: "hello world" });
        field.setCaret(0);
        field.setCaret(5, true);
        expect(field.selectedText).toBe("hello");
        field.insert("goodbye");
        expect(field.value).toBe("goodbye world");
        expect(field.hasSelection).toBe(false);
    });
    it("collapses a selection to its edge on a plain arrow", () => {
        const field = new TextField({ value: "abcdef" });
        field.setCaret(1);
        field.setCaret(4, true);
        field.moveCaret(1);
        expect(field.caret).toBe(4);
        field.setCaret(1);
        field.setCaret(4, true);
        field.moveCaret(-1);
        expect(field.caret).toBe(1);
    });
    it("extends a selection when asked", () => {
        const field = new TextField({ value: "abcdef" });
        field.setCaret(2);
        field.moveCaret(2, true);
        expect(field.selection).toEqual({ start: 2, end: 4 });
        field.selectAll();
        expect(field.selectedText).toBe("abcdef");
    });
    it("deletes whole words", () => {
        const field = new TextField({ value: "one two three" });
        field.setCaret(field.length);
        field.deleteWord(-1);
        expect(field.value).toBe("one two ");
        field.setCaret(0);
        field.deleteWord(1);
        // Forward word-delete takes the trailing space too, as Ctrl+Delete does.
        expect(field.value).toBe("two ");
    });
    it("enforces a maximum length, accepting what fits", () => {
        const field = new TextField({ value: "abc", maxLength: 5 });
        expect(field.insert("defgh")).toBe("de");
        expect(field.value).toBe("abcde");
    });
    it("filters characters and strips newlines unless multiline", () => {
        const digits = new TextField({ filter: (character) => /\d/.test(character) });
        digits.insert("a1b2");
        expect(digits.value).toBe("12");
        const single = new TextField();
        single.insert("a\nb");
        expect(single.value).toBe("ab");
        const multi = new TextField({ multiline: true });
        multi.insert("a\nb");
        expect(multi.value).toBe("a\nb");
    });
    it("clamps the caret and validates options", () => {
        const field = new TextField({ value: "abc" });
        field.setCaret(99);
        expect(field.caret).toBe(3);
        field.setCaret(-5);
        expect(field.caret).toBe(0);
        field.deleteCharacter(-1);
        expect(field.value).toBe("abc");
        expect(() => new TextField({ maxLength: 0 })).toThrow(/must be positive/);
    });
    it("replaces its whole value", () => {
        const field = new TextField({ value: "old", maxLength: 4 });
        field.setValue("brand new");
        expect(field.value).toBe("bran");
        expect(field.caret).toBe(4);
    });
});
describe("TooltipController", () => {
    it("waits before showing, which is the entire feature", () => {
        // Appearing instantly fires constantly as the pointer crosses a toolbar.
        const tooltips = new TooltipController({ delaySeconds: 0.5 });
        tooltips.hover("save");
        expect(tooltips.state).toBe("pending");
        tooltips.update(0.3);
        expect(tooltips.visibleTarget).toBeUndefined();
        tooltips.update(0.3);
        expect(tooltips.visibleTarget).toBe("save");
    });
    it("keeps a grace period, so a one-pixel gap does not flicker", () => {
        const tooltips = new TooltipController({ delaySeconds: 0, graceSeconds: 0.2 });
        tooltips.hover("save");
        tooltips.update(0.1);
        expect(tooltips.state).toBe("visible");
        tooltips.hover(undefined);
        tooltips.update(0.1);
        expect(tooltips.state).toBe("visible");
        tooltips.update(0.2);
        expect(tooltips.state).toBe("hidden");
    });
    it("switches instantly between controls once one is showing", () => {
        const tooltips = new TooltipController({ delaySeconds: 0.5 });
        tooltips.hover("save");
        tooltips.update(0.6);
        tooltips.hover("open");
        expect(tooltips.visibleTarget).toBe("open");
    });
    it("hides on demand and validates its options", () => {
        const tooltips = new TooltipController({ delaySeconds: 0 });
        tooltips.hover("save");
        tooltips.update(0.1);
        tooltips.hide();
        expect(tooltips.state).toBe("hidden");
        expect(() => new TooltipController({ delaySeconds: -1 })).toThrow(/must not be negative/);
        expect(() => new TooltipController().update(-1)).toThrow(/non-negative delta/);
    });
});
describe("DragController", () => {
    it("carries a payload from source to target", () => {
        const drag = new DragController();
        drag.begin("slot-1", { item: "sword" });
        expect(drag.dragging).toBe(true);
        drag.over("slot-4");
        expect(drag.willAccept).toBe(true);
        expect(drag.drop()).toEqual({ source: "slot-1", target: "slot-4", data: { item: "sword" } });
        expect(drag.dragging).toBe(false);
    });
    it("reports acceptance before the drop, which is what a highlight needs", () => {
        const drag = new DragController((payload, target) => target.startsWith("equip") && payload.data === "sword");
        drag.begin("slot-1", "sword");
        drag.over("bin");
        expect(drag.willAccept).toBe(false);
        drag.over("equip-hand");
        expect(drag.willAccept).toBe(true);
    });
    it("refuses a drop back onto its own source", () => {
        const drag = new DragController();
        drag.begin("slot-1", 1);
        drag.over("slot-1");
        expect(drag.willAccept).toBe(false);
        expect(drag.drop()).toBeUndefined();
    });
    it("drops nowhere when over nothing", () => {
        const drag = new DragController();
        drag.begin("slot-1", 1);
        expect(drag.drop()).toBeUndefined();
    });
    it("cancels, and refuses a second concurrent drag", () => {
        const drag = new DragController();
        drag.begin("slot-1", 1);
        expect(() => drag.begin("slot-2", 2)).toThrow(/already in progress/);
        drag.cancel();
        expect(drag.dragging).toBe(false);
        expect(() => drag.begin("slot-2", 2)).not.toThrow();
        drag.cancel();
        expect(() => drag.begin("", 1)).toThrow(/must not be empty/);
    });
    it("ignores hover and drop when nothing is being dragged", () => {
        const drag = new DragController();
        drag.over("anywhere");
        expect(drag.target).toBeUndefined();
        expect(drag.drop()).toBeUndefined();
    });
});
//# sourceMappingURL=widgets.test.js.map