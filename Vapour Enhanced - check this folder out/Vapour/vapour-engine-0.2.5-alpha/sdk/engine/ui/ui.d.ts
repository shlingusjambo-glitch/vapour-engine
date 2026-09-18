/** Retained UI tree: layout, hit testing, focus, and control values.
 *
 * Layout is a **pure function from tree plus viewport to rectangles**. Nothing
 * here reads a GPU, a DOM node, or a clock, which is what lets the same
 * document drive a screen overlay, a world-space quad, and a headless test that
 * asserts exact pixel positions.
 *
 * Four placement models coexist because games need all four and emulating one
 * with another is how UI code rots:
 *
 * - **Flex** for rows and columns that share space (`direction`, `wrap`,
 *   `flexGrow`/`flexShrink`/`flexBasis`, `justify`, `align`, `gap`).
 * - **Grid** for aligned tables of controls, with fixed, `auto`, and fractional
 *   tracks and cells that span.
 * - **Anchors** for the HUD case — "16px from the top-right corner, whatever the
 *   resolution is" — using Unity's min/max anchor rect with signed offsets.
 * - **Breakpoints** for the responsive case, where a style is replaced wholesale
 *   above a viewport width rather than every value being a formula.
 */
export type UiDirection = "row" | "column";
export type UiAlign = "start" | "center" | "end" | "stretch";
export type UiJustify = "start" | "center" | "end" | "space-between" | "space-around" | "space-evenly";
export type UiRole = "panel" | "image" | "text" | "button" | "toggle" | "slider" | "progress" | "dropdown";
/**
 * A Unity-style anchor rectangle.
 *
 * `min` and `max` are fractions of the parent's content box; `offsets` are
 * signed pixels added to `[left, top, right, bottom]` in that order. A stretched
 * child is `min [0,0]`, `max [1,1]` with inset offsets; a corner-pinned child is
 * `min === max` with offsets giving its position and size. Anchored children are
 * removed from the flex/grid flow, because a HUD element pinned to a corner is
 * not participating in a row.
 */
export interface UiAnchor {
    readonly min: readonly [number, number];
    readonly max: readonly [number, number];
    readonly offsets?: readonly [number, number, number, number];
}
/** A grid track: fixed pixels, `"auto"` (largest child), or a share of what is left. */
export type UiTrack = number | "auto" | {
    readonly fraction: number;
};
export interface UiGrid {
    readonly columns: readonly UiTrack[];
    /** Omitted means rows are added as needed and sized to their content. */
    readonly rows?: readonly UiTrack[];
    readonly columnGap?: number;
    readonly rowGap?: number;
}
/** Where a child sits in its parent's grid. Omit both indices to auto-flow. */
export interface UiGridArea {
    readonly column?: number;
    readonly row?: number;
    readonly columnSpan?: number;
    readonly rowSpan?: number;
}
/**
 * A style that replaces parts of the base style at or above a viewport width.
 *
 * Wholesale replacement rather than interpolation: a phone layout is usually a
 * different arrangement, not the same arrangement scaled, and pretending
 * otherwise produces a tablet layout that is wrong on both.
 */
export interface UiBreakpoint {
    readonly minWidth: number;
    readonly style: UiStyle;
}
export interface UiStyle {
    readonly direction?: UiDirection;
    readonly width?: number | "fill" | "content";
    readonly height?: number | "fill" | "content";
    readonly minWidth?: number;
    readonly minHeight?: number;
    readonly maxWidth?: number;
    readonly maxHeight?: number;
    readonly flexGrow?: number;
    /** How much this child gives up when a line overflows. Zero never shrinks. */
    readonly flexShrink?: number;
    /** Starting main-axis size before growing or shrinking. */
    readonly flexBasis?: number;
    /** Break children onto further lines instead of overflowing. */
    readonly wrap?: boolean;
    readonly gap?: number;
    readonly padding?: number | readonly [number, number, number, number];
    readonly align?: UiAlign;
    /** Overrides the parent's `align` for this child alone. */
    readonly alignSelf?: UiAlign;
    readonly justify?: UiJustify;
    readonly anchor?: UiAnchor;
    readonly grid?: UiGrid;
    readonly gridArea?: UiGridArea;
    readonly breakpoints?: readonly UiBreakpoint[];
    readonly visible?: boolean;
    readonly enabled?: boolean;
}
export interface UiNodeDefinition {
    readonly id: string;
    readonly role: UiRole;
    readonly style?: UiStyle;
    readonly intrinsicSize?: readonly [number, number];
    readonly value?: number | boolean | string;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly step?: number;
    /** Choices for a `dropdown` node. */
    readonly options?: readonly string[];
    readonly children?: readonly UiNodeDefinition[];
}
export interface UiRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export interface UiLayoutNode {
    readonly id: string;
    readonly role: UiRole;
    readonly rect: UiRect;
    readonly depth: number;
    readonly visible: boolean;
    readonly enabled: boolean;
}
export interface UiAction {
    readonly type: "click" | "change" | "focus" | "open" | "close";
    readonly id: string;
    readonly value?: number | boolean | string;
}
/** Retained, renderer-independent game UI. Layout results can be rendered with
 * sprites/text, while hit testing and focus use those exact same rectangles. */
export declare class UiDocument {
    #private;
    constructor(root: UiNodeDefinition);
    get focusedId(): string | undefined;
    /** The viewport the last {@link layout} ran against. */
    get viewport(): readonly [number, number];
    layout(width: number, height: number): readonly UiLayoutNode[];
    nodes(): readonly UiLayoutNode[];
    rect(id: string): UiRect;
    /** The style actually in force after breakpoint resolution. */
    style(id: string): UiStyle;
    hitTest(x: number, y: number): string | undefined;
    pointerDown(x: number, y: number): string | undefined;
    pointerUp(x: number, y: number): void;
    focus(id: string): void;
    focusNext(direction?: 1 | -1): string | undefined;
    activateFocused(): void;
    activate(id: string, pointerX?: number): void;
    /**
     * Keyboard and controller value changes: `delta` is in steps, not pixels.
     *
     * Sliders move one step, dropdowns move one option, and a closed dropdown
     * changes its selection directly — which is what a left/right press on a
     * settings row does everywhere else.
     */
    adjust(id: string, delta: number): void;
    /** Whether a dropdown's option list is showing. */
    isOpen(id: string): boolean;
    /** The option a dropdown's list is highlighting, which commit will select. */
    highlightedIndex(id: string): number;
    selectedIndex(id: string): number;
    options(id: string): readonly string[];
    /** Closes a dropdown, keeping the selection it had before it opened. */
    cancel(id: string): void;
    /**
     * The rectangles a dropdown's open list occupies, below the control.
     *
     * Returned rather than laid out as child nodes because a popup escapes its
     * parent's clip and its parent's flow; putting it in the tree makes every
     * container above it reserve space it does not use.
     */
    optionRects(id: string, itemHeight: number): readonly UiRect[];
    /** The option under a pointer while a dropdown is open, if any. */
    optionAt(id: string, x: number, y: number, itemHeight: number): number | undefined;
    /** Selects a dropdown option by index and closes the list. */
    select(id: string, index: number): void;
    /** A slider's or progress bar's value as a 0..1 fraction, for drawing a fill. */
    fraction(id: string): number;
    setValue(id: string, value: number | boolean | string): void;
    value(id: string): number | boolean | string | undefined;
    drainActions(): readonly UiAction[];
}
/** Merges every breakpoint whose `minWidth` the viewport meets, narrowest first,
 * so a wider rule wins over a narrower one exactly as CSS media queries do. */
export declare function resolveBreakpoints(style: UiStyle, viewportWidth: number): UiStyle;
/** The rect a Unity-style anchor produces inside a parent's content box. */
export declare function anchorRect(anchor: UiAnchor, inner: UiRect): UiRect;
//# sourceMappingURL=ui.d.ts.map