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
export interface ScrollViewOptions {
    /** Height of the visible area. */
    readonly viewportHeight: number;
    /** Total height of the content. */
    readonly contentHeight: number;
    /** Units scrolled per wheel notch or per key press. */
    readonly step?: number;
    /**
     * Let the view scroll a little past its ends and spring back.
     *
     * Off by default: overscroll is a touch idiom, and on a mouse it reads as the
     * view being broken.
     */
    readonly overscroll?: number;
}
/** A scrollable viewport over taller content. */
export declare class ScrollView {
    #private;
    constructor(options: ScrollViewOptions);
    /** How far the content is scrolled, in units from the top. */
    get offset(): number;
    /** The furthest the view can scroll. Zero when content fits. */
    get maxOffset(): number;
    get viewportHeight(): number;
    get contentHeight(): number;
    /** Whether scrolling is possible at all, for hiding the scrollbar. */
    get scrollable(): boolean;
    /** Scrollbar thumb as `[start, size]` fractions of the track. */
    get thumb(): readonly [number, number];
    scrollTo(offset: number): void;
    scrollBy(delta: number): void;
    /** One wheel notch or arrow press. */
    scrollSteps(steps: number): void;
    scrollPage(pages: number): void;
    /**
     * Scrolls the smallest amount that brings a range into view.
     *
     * This is what keyboard and gamepad navigation needs: focusing an item below
     * the fold must reveal it, and scrolling further than necessary loses the
     * reader's place.
     */
    revealRange(top: number, height: number, margin?: number): void;
    /** Springs back after overscroll. Returns whether it is still settling. */
    settle(deltaSeconds: number): boolean;
    /** Content changed size; keeps the view in range rather than stranded. */
    resize(viewportHeight: number, contentHeight: number): void;
}
export interface VirtualRange {
    readonly firstIndex: number;
    readonly lastIndex: number;
    /** Offset of the first visible item from the top of the content. */
    readonly offsetY: number;
}
/**
 * The item range a scroll position exposes, for a uniform-height list.
 *
 * Virtualization is not optional for a list of any size: an inventory of two
 * thousand items laid out as two thousand nodes costs more to lay out than to
 * draw, every frame, no matter how few are on screen.
 */
export declare function virtualRange(scroll: ScrollView, itemHeight: number, itemCount: number, overscan?: number): VirtualRange;
export interface TextFieldOptions {
    readonly value?: string;
    readonly maxLength?: number;
    /** Reject characters that do not match. */
    readonly filter?: (character: string) => boolean;
    readonly multiline?: boolean;
}
export interface TextSelection {
    readonly start: number;
    readonly end: number;
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
export declare class TextField {
    #private;
    readonly multiline: boolean;
    constructor(options?: TextFieldOptions);
    get value(): string;
    /** Length in code points, which is what the caret indexes. */
    get length(): number;
    get caret(): number;
    get selection(): TextSelection;
    get hasSelection(): boolean;
    get selectedText(): string;
    setValue(value: string): void;
    setCaret(index: number, extendSelection?: boolean): void;
    selectAll(): void;
    moveCaret(offset: number, extendSelection?: boolean): void;
    /** Inserts text, replacing any selection. Returns what was accepted. */
    insert(text: string): string;
    /** Backspace, or delete forward with a positive direction. */
    deleteCharacter(direction?: -1 | 1): void;
    /** Deletes the word beside the caret, as Ctrl+Backspace does. */
    deleteWord(direction?: -1 | 1): void;
}
export interface TooltipOptions {
    /** Seconds of hover before a tooltip appears. */
    readonly delaySeconds?: number;
    /** Seconds it stays after the pointer leaves. */
    readonly graceSeconds?: number;
}
export type TooltipState = "hidden" | "pending" | "visible";
/**
 * Hover-delay logic for tooltips.
 *
 * The delay is the entire feature. A tooltip that appears instantly fires
 * constantly while the pointer crosses a toolbar, and one with no grace period
 * flickers when the pointer passes over a one-pixel gap between controls.
 */
export declare class TooltipController {
    #private;
    constructor(options?: TooltipOptions);
    get state(): TooltipState;
    /** The tooltip currently shown, if any. */
    get visibleTarget(): string | undefined;
    hover(id: string | undefined): void;
    update(deltaSeconds: number): void;
    hide(): void;
}
export interface DragPayload {
    readonly source: string;
    readonly data: unknown;
}
export interface DropResult {
    readonly source: string;
    readonly target: string;
    readonly data: unknown;
}
/**
 * Drag-and-drop state.
 *
 * A drag is not complete until it is dropped somewhere that accepts it, so the
 * controller tracks whether the current target *would* accept — that is what a
 * cursor change or a highlight needs, and computing it at drop time is too
 * late to show the user anything.
 */
export declare class DragController {
    #private;
    constructor(accepts?: (payload: DragPayload, target: string) => boolean);
    get dragging(): boolean;
    get payload(): DragPayload | undefined;
    get target(): string | undefined;
    /** Whether the current target would accept a drop right now. */
    get willAccept(): boolean;
    begin(source: string, data: unknown): void;
    over(target: string | undefined): void;
    /** Completes the drag, returning the drop when it was accepted. */
    drop(): DropResult | undefined;
    cancel(): void;
}
//# sourceMappingURL=widgets.d.ts.map