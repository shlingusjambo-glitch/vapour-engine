/** Scroll views, lists, text input, tooltips, and drag-and-drop.
 *
 * These are the widgets a game UI cannot do without and that a layout engine
 * alone does not provide, because each one is a small **state machine** rather
 * than a rectangle. A scroll view remembers where it is scrolled; a text field
 * remembers a caret and a selection; a drag remembers what was picked up and
 * from where.
 *
 * Keeping that state here — as plain objects, separate from layout and from
 * rendering — is what lets it be tested, serialized into a save, and driven
 * from a pointer, a gamepad, or an XR ray without three implementations.
 */
/** A scrollable viewport over taller content. */
export class ScrollView {
    #offset = 0;
    #viewportHeight;
    #contentHeight;
    #step;
    #overscroll;
    constructor(options) {
        this.#viewportHeight = requirePositive(options.viewportHeight, "A scroll view's viewport height");
        this.#contentHeight = requireNonNegative(options.contentHeight, "A scroll view's content height");
        this.#step = options.step ?? 48;
        this.#overscroll = options.overscroll ?? 0;
        if (!(this.#step > 0))
            throw new Error("A scroll step must be positive.");
        if (!(this.#overscroll >= 0))
            throw new Error("Overscroll must not be negative.");
    }
    /** How far the content is scrolled, in units from the top. */
    get offset() {
        return this.#offset;
    }
    /** The furthest the view can scroll. Zero when content fits. */
    get maxOffset() {
        return Math.max(0, this.#contentHeight - this.#viewportHeight);
    }
    get viewportHeight() {
        return this.#viewportHeight;
    }
    get contentHeight() {
        return this.#contentHeight;
    }
    /** Whether scrolling is possible at all, for hiding the scrollbar. */
    get scrollable() {
        return this.maxOffset > 0;
    }
    /** Scrollbar thumb as `[start, size]` fractions of the track. */
    get thumb() {
        if (!this.scrollable)
            return [0, 1];
        const size = Math.max(0.05, this.#viewportHeight / this.#contentHeight);
        const start = (this.#offset / this.maxOffset) * (1 - size);
        return [Math.min(1 - size, Math.max(0, start)), size];
    }
    scrollTo(offset) {
        if (!Number.isFinite(offset))
            throw new Error("A scroll offset must be finite.");
        const clamped = clamp(offset, -this.#overscroll, this.maxOffset + this.#overscroll);
        // Normalize -0, which clamping against a zero lower bound produces and which
        // compares unequal to 0 under Object.is — surprising in a saved value.
        this.#offset = clamped === 0 ? 0 : clamped;
    }
    scrollBy(delta) {
        this.scrollTo(this.#offset + delta);
    }
    /** One wheel notch or arrow press. */
    scrollSteps(steps) {
        this.scrollBy(steps * this.#step);
    }
    scrollPage(pages) {
        this.scrollBy(pages * this.#viewportHeight);
    }
    /**
     * Scrolls the smallest amount that brings a range into view.
     *
     * This is what keyboard and gamepad navigation needs: focusing an item below
     * the fold must reveal it, and scrolling further than necessary loses the
     * reader's place.
     */
    revealRange(top, height, margin = 0) {
        const bottom = top + height;
        if (top - margin < this.#offset)
            this.scrollTo(top - margin);
        else if (bottom + margin > this.#offset + this.#viewportHeight)
            this.scrollTo(bottom + margin - this.#viewportHeight);
    }
    /** Springs back after overscroll. Returns whether it is still settling. */
    settle(deltaSeconds) {
        if (this.#offset >= 0 && this.#offset <= this.maxOffset)
            return false;
        const target = clamp(this.#offset, 0, this.maxOffset);
        const t = Math.min(1, deltaSeconds * 12);
        this.#offset += (target - this.#offset) * t;
        if (Math.abs(this.#offset - target) < 0.5)
            this.#offset = target;
        return this.#offset !== target;
    }
    /** Content changed size; keeps the view in range rather than stranded. */
    resize(viewportHeight, contentHeight) {
        this.#viewportHeight = requirePositive(viewportHeight, "A scroll view's viewport height");
        this.#contentHeight = requireNonNegative(contentHeight, "A scroll view's content height");
        this.#offset = clamp(this.#offset, 0, this.maxOffset);
    }
}
/**
 * The item range a scroll position exposes, for a uniform-height list.
 *
 * Virtualization is not optional for a list of any size: an inventory of two
 * thousand items laid out as two thousand nodes costs more to lay out than to
 * draw, every frame, no matter how few are on screen.
 */
export function virtualRange(scroll, itemHeight, itemCount, overscan = 2) {
    if (!(itemHeight > 0))
        throw new Error("A list item height must be positive.");
    if (!Number.isInteger(itemCount) || itemCount < 0)
        throw new Error("A list item count must be a non-negative whole number.");
    if (itemCount === 0)
        return { firstIndex: 0, lastIndex: -1, offsetY: 0 };
    const first = Math.max(0, Math.floor(scroll.offset / itemHeight) - overscan);
    const visible = Math.ceil(scroll.viewportHeight / itemHeight) + overscan * 2;
    const last = Math.min(itemCount - 1, first + visible);
    return { firstIndex: first, lastIndex: last, offsetY: first * itemHeight };
}
/**
 * A text field's editing state.
 *
 * Caret and selection are held as indices into the string rather than as
 * pixels, so the same state drives a DOM input, a canvas field, and a
 * world-space XR keyboard.
 *
 * Indices count **code points, not UTF-16 units**. Treating them as units puts
 * the caret inside an emoji or a non-BMP character and produces mojibake when
 * the user backspaces — a bug that never appears in English testing.
 */
export class TextField {
    #characters;
    #caret;
    #anchor;
    #maxLength;
    #filter;
    multiline;
    constructor(options = {}) {
        this.#characters = [...(options.value ?? "")];
        this.#caret = this.#characters.length;
        this.#anchor = this.#caret;
        this.#maxLength = options.maxLength ?? Number.POSITIVE_INFINITY;
        if (!(this.#maxLength > 0))
            throw new Error("A text field's maximum length must be positive.");
        this.#filter = options.filter;
        this.multiline = options.multiline ?? false;
    }
    get value() {
        return this.#characters.join("");
    }
    /** Length in code points, which is what the caret indexes. */
    get length() {
        return this.#characters.length;
    }
    get caret() {
        return this.#caret;
    }
    get selection() {
        return { start: Math.min(this.#caret, this.#anchor), end: Math.max(this.#caret, this.#anchor) };
    }
    get hasSelection() {
        return this.#caret !== this.#anchor;
    }
    get selectedText() {
        const { start, end } = this.selection;
        return this.#characters.slice(start, end).join("");
    }
    setValue(value) {
        this.#characters = [...value].slice(0, this.#maxLength);
        this.#caret = this.#characters.length;
        this.#anchor = this.#caret;
    }
    setCaret(index, extendSelection = false) {
        this.#caret = clamp(Math.round(index), 0, this.#characters.length);
        if (!extendSelection)
            this.#anchor = this.#caret;
    }
    selectAll() {
        this.#anchor = 0;
        this.#caret = this.#characters.length;
    }
    moveCaret(offset, extendSelection = false) {
        // A plain arrow with a selection collapses to its edge rather than moving
        // from the caret, which is what every text editor does.
        if (!extendSelection && this.hasSelection) {
            const { start, end } = this.selection;
            this.setCaret(offset < 0 ? start : end);
            return;
        }
        this.setCaret(this.#caret + offset, extendSelection);
    }
    /** Inserts text, replacing any selection. Returns what was accepted. */
    insert(text) {
        const incoming = [...text].filter((character) => {
            if (!this.multiline && (character === "\n" || character === "\r"))
                return false;
            return this.#filter?.(character) ?? true;
        });
        if (incoming.length === 0 && !this.hasSelection)
            return "";
        const { start, end } = this.selection;
        const room = this.#maxLength - (this.#characters.length - (end - start));
        const accepted = incoming.slice(0, Math.max(0, room));
        this.#characters = [...this.#characters.slice(0, start), ...accepted, ...this.#characters.slice(end)];
        this.#caret = start + accepted.length;
        this.#anchor = this.#caret;
        return accepted.join("");
    }
    /** Backspace, or delete forward with a positive direction. */
    deleteCharacter(direction = -1) {
        if (this.hasSelection) {
            this.insert("");
            return;
        }
        const index = direction < 0 ? this.#caret - 1 : this.#caret;
        if (index < 0 || index >= this.#characters.length)
            return;
        this.#characters.splice(index, 1);
        this.#caret = index;
        this.#anchor = this.#caret;
    }
    /** Deletes the word beside the caret, as Ctrl+Backspace does. */
    deleteWord(direction = -1) {
        if (this.hasSelection) {
            this.insert("");
            return;
        }
        const target = direction < 0 ? this.#wordStart() : this.#wordEnd();
        this.#anchor = target;
        this.insert("");
    }
    #wordStart() {
        let index = this.#caret;
        while (index > 0 && this.#characters[index - 1] === " ")
            index -= 1;
        while (index > 0 && this.#characters[index - 1] !== " ")
            index -= 1;
        return index;
    }
    #wordEnd() {
        let index = this.#caret;
        while (index < this.#characters.length && this.#characters[index] === " ")
            index += 1;
        while (index < this.#characters.length && this.#characters[index] !== " ")
            index += 1;
        // Take the whitespace after the word too, matching Ctrl+Delete: leaving a
        // stray leading space is what makes repeated forward-deletes feel wrong.
        while (index < this.#characters.length && this.#characters[index] === " ")
            index += 1;
        return index;
    }
}
/**
 * Hover-delay logic for tooltips.
 *
 * The delay is the entire feature. A tooltip that appears instantly fires
 * constantly while the pointer crosses a toolbar, and one with no grace period
 * flickers when the pointer passes over a one-pixel gap between controls.
 */
export class TooltipController {
    #delay;
    #grace;
    #target;
    #hovering;
    #elapsed = 0;
    #state = "hidden";
    constructor(options = {}) {
        this.#delay = options.delaySeconds ?? 0.6;
        this.#grace = options.graceSeconds ?? 0.15;
        if (!(this.#delay >= 0))
            throw new Error("A tooltip delay must not be negative.");
        if (!(this.#grace >= 0))
            throw new Error("A tooltip grace period must not be negative.");
    }
    get state() {
        return this.#state;
    }
    /** The tooltip currently shown, if any. */
    get visibleTarget() {
        return this.#state === "visible" ? this.#target : undefined;
    }
    hover(id) {
        if (id === this.#hovering)
            return;
        this.#hovering = id;
        this.#elapsed = 0;
        if (id === undefined)
            return;
        // Moving between controls while a tooltip is up shows the new one at once,
        // which is what makes a toolbar feel responsive after the first hover.
        if (this.#state === "visible") {
            this.#target = id;
            return;
        }
        this.#state = "pending";
        this.#target = id;
    }
    update(deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("A tooltip update requires a finite, non-negative delta.");
        this.#elapsed += deltaSeconds;
        if (this.#hovering === undefined) {
            if (this.#state !== "hidden" && this.#elapsed >= this.#grace) {
                this.#state = "hidden";
                this.#target = undefined;
            }
            return;
        }
        if (this.#state === "pending" && this.#elapsed >= this.#delay)
            this.#state = "visible";
    }
    hide() {
        this.#state = "hidden";
        this.#target = undefined;
        this.#hovering = undefined;
        this.#elapsed = 0;
    }
}
/**
 * Drag-and-drop state.
 *
 * A drag is not complete until it is dropped somewhere that accepts it, so the
 * controller tracks whether the current target *would* accept — that is what a
 * cursor change or a highlight needs, and computing it at drop time is too
 * late to show the user anything.
 */
export class DragController {
    #payload;
    #target;
    #accepts;
    constructor(accepts) {
        this.#accepts = accepts;
    }
    get dragging() {
        return this.#payload !== undefined;
    }
    get payload() {
        return this.#payload;
    }
    get target() {
        return this.#target;
    }
    /** Whether the current target would accept a drop right now. */
    get willAccept() {
        if (!this.#payload || this.#target === undefined)
            return false;
        if (this.#target === this.#payload.source)
            return false;
        return this.#accepts?.(this.#payload, this.#target) ?? true;
    }
    begin(source, data) {
        if (!source.trim())
            throw new Error("A drag source must not be empty.");
        if (this.#payload)
            throw new Error(`A drag from "${this.#payload.source}" is already in progress.`);
        this.#payload = { source, data };
        this.#target = undefined;
    }
    over(target) {
        if (!this.#payload)
            return;
        this.#target = target;
    }
    /** Completes the drag, returning the drop when it was accepted. */
    drop() {
        if (!this.#payload)
            return undefined;
        const accepted = this.willAccept;
        const result = accepted ? { source: this.#payload.source, target: this.#target, data: this.#payload.data } : undefined;
        this.cancel();
        return result;
    }
    cancel() {
        this.#payload = undefined;
        this.#target = undefined;
    }
}
function clamp(value, minimum, maximum) {
    return value < minimum ? minimum : value > maximum ? maximum : value;
}
function requirePositive(value, label) {
    if (!(value > 0) || !Number.isFinite(value))
        throw new Error(`${label} must be a positive, finite number (got ${value}).`);
    return value;
}
function requireNonNegative(value, label) {
    if (!(value >= 0) || !Number.isFinite(value))
        throw new Error(`${label} must be a finite, non-negative number (got ${value}).`);
    return value;
}
//# sourceMappingURL=widgets.js.map