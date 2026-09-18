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
export type UiTrack = number | "auto" | { readonly fraction: number };

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

export interface UiRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface UiLayoutNode { readonly id: string; readonly role: UiRole; readonly rect: UiRect; readonly depth: number; readonly visible: boolean; readonly enabled: boolean }
export interface UiAction { readonly type: "click" | "change" | "focus" | "open" | "close"; readonly id: string; readonly value?: number | boolean | string }

interface MutableNode {
  definition: UiNodeDefinition;
  /** `definition.style` with the active breakpoints folded in. */
  style: UiStyle;
  parent?: MutableNode;
  children: MutableNode[];
  rect: UiRect;
  depth: number;
}

interface FlexItem { readonly node: MutableNode; readonly basis: number; readonly grow: number; readonly shrink: number; readonly cross: number }
interface GridCell { readonly node: MutableNode; readonly column: number; readonly row: number; readonly columnSpan: number; readonly rowSpan: number }
interface GridPlan { readonly columns: readonly number[]; readonly rows: readonly number[]; readonly columnGap: number; readonly rowGap: number; readonly cells: readonly GridCell[]; readonly width: number; readonly height: number }

/** Retained, renderer-independent game UI. Layout results can be rendered with
 * sprites/text, while hit testing and focus use those exact same rectangles. */
export class UiDocument {
  readonly #root: MutableNode;
  readonly #nodes = new Map<string, MutableNode>();
  /** Insertion-ordered view of `#nodes`, so hit testing does not copy the map per call. */
  #ordered: readonly MutableNode[] = [];
  readonly #actions: UiAction[] = [];
  readonly #dropdowns = new Map<string, DropdownState>();
  #focused: string | undefined;
  #pressed: string | undefined;
  #viewport: readonly [number, number] = [0, 0];

  constructor(root: UiNodeDefinition) {
    this.#root = this.#build(root, undefined, 0);
    this.#ordered = [...this.#nodes.values()];
  }

  get focusedId(): string | undefined { return this.#focused; }

  /** The viewport the last {@link layout} ran against. */
  get viewport(): readonly [number, number] { return this.#viewport; }

  layout(width: number, height: number): readonly UiLayoutNode[] {
    positive(width, "UI viewport width"); positive(height, "UI viewport height");
    this.#viewport = [width, height];
    // Breakpoints resolve once per layout: every measure and placement below
    // then reads one already-merged style rather than re-deciding per node.
    for (const node of this.#nodes.values()) node.style = resolveBreakpoints(node.definition.style ?? {}, width);
    this.#layoutNode(this.#root, { x: 0, y: 0, width, height });
    return this.nodes();
  }

  nodes(): readonly UiLayoutNode[] {
    return [...this.#nodes.values()].map((node) => Object.freeze({ id: node.definition.id, role: node.definition.role, rect: Object.freeze({ ...node.rect }), depth: node.depth, visible: visible(node), enabled: enabled(node) }));
  }

  rect(id: string): UiRect { return Object.freeze({ ...this.#require(id).rect }); }

  /** The style actually in force after breakpoint resolution. */
  style(id: string): UiStyle { return this.#require(id).style; }

  hitTest(x: number, y: number): string | undefined {
    finite(x, "UI pointer x"); finite(y, "UI pointer y");
    // Last-declared wins, so scan in reverse. The rect test runs first because
    // it is one comparison; `interactive` walks the ancestor chain and only
    // needs to run for the handful of nodes actually under the pointer.
    const nodes = this.#ordered;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index]!;
      if (contains(node.rect, x, y) && interactive(node)) return node.definition.id;
    }
    return undefined;
  }

  pointerDown(x: number, y: number): string | undefined {
    const id = this.hitTest(x, y); this.#pressed = id;
    if (id !== undefined) this.focus(id);
    return id;
  }

  pointerUp(x: number, y: number): void {
    const id = this.hitTest(x, y);
    if (id !== undefined && id === this.#pressed) this.activate(id, x);
    this.#pressed = undefined;
  }

  focus(id: string): void {
    const node = this.#require(id);
    if (!interactive(node)) throw new Error(`UI node '${id}' cannot receive focus because it is hidden, disabled, or not interactive.`);
    if (this.#focused !== id) { this.#focused = id; this.#actions.push({ type: "focus", id }); }
  }

  focusNext(direction: 1 | -1 = 1): string | undefined {
    const candidates = [...this.#nodes.values()].filter(interactive);
    if (candidates.length === 0) { this.#focused = undefined; return undefined; }
    const current = candidates.findIndex((node) => node.definition.id === this.#focused);
    const next = current < 0 ? (direction > 0 ? 0 : candidates.length - 1) : (current + direction + candidates.length) % candidates.length;
    this.focus(candidates[next]!.definition.id);
    return this.#focused;
  }

  activateFocused(): void { if (this.#focused !== undefined) this.activate(this.#focused); }

  activate(id: string, pointerX?: number): void {
    const node = this.#require(id); if (!interactive(node)) throw new Error(`UI node '${id}' cannot be activated.`);
    const definition = node.definition;
    if (definition.role === "toggle") {
      const value = !(definition.value === true); node.definition = { ...definition, value };
      this.#actions.push({ type: "change", id, value });
    } else if (definition.role === "slider") {
      const { minimum, maximum, step } = sliderRange(node);
      const fraction = pointerX === undefined ? 1 : Math.max(0, Math.min(1, (pointerX - node.rect.x) / node.rect.width));
      this.#setSlider(node, minimum + fraction * (maximum - minimum), minimum, maximum, step);
    } else if (definition.role === "dropdown") {
      const state = this.#dropdown(node);
      if (state.open) this.#commitDropdown(node, state);
      else { state.open = true; state.highlighted = state.selected; this.#actions.push({ type: "open", id }); }
    } else this.#actions.push({ type: "click", id });
  }

  /**
   * Keyboard and controller value changes: `delta` is in steps, not pixels.
   *
   * Sliders move one step, dropdowns move one option, and a closed dropdown
   * changes its selection directly — which is what a left/right press on a
   * settings row does everywhere else.
   */
  adjust(id: string, delta: number): void {
    const node = this.#require(id);
    if (!Number.isFinite(delta)) throw new Error(`UI adjust delta for '${id}' must be finite.`);
    if (!interactive(node)) throw new Error(`UI node '${id}' cannot be adjusted.`);
    if (node.definition.role === "slider") {
      const { minimum, maximum, step } = sliderRange(node);
      this.#setSlider(node, numberValue(node.definition.value, minimum) + delta * step, minimum, maximum, step);
      return;
    }
    if (node.definition.role === "dropdown") {
      const state = this.#dropdown(node);
      const count = state.options.length;
      if (count === 0) return;
      const step = Math.trunc(delta);
      if (state.open) { state.highlighted = wrapIndex(state.highlighted + step, count); return; }
      const next = wrapIndex(state.selected + step, count);
      if (next === state.selected) return;
      state.selected = next; state.highlighted = next;
      node.definition = { ...node.definition, value: state.options[next]! };
      this.#actions.push({ type: "change", id, value: state.options[next]! });
      return;
    }
    throw new Error(`UI node '${id}' has role '${node.definition.role}', which has no adjustable value.`);
  }

  /** Whether a dropdown's option list is showing. */
  isOpen(id: string): boolean { return this.#dropdown(this.#require(id)).open; }

  /** The option a dropdown's list is highlighting, which commit will select. */
  highlightedIndex(id: string): number { return this.#dropdown(this.#require(id)).highlighted; }

  selectedIndex(id: string): number { return this.#dropdown(this.#require(id)).selected; }

  options(id: string): readonly string[] { return this.#dropdown(this.#require(id)).options; }

  /** Closes a dropdown, keeping the selection it had before it opened. */
  cancel(id: string): void {
    const node = this.#require(id);
    const state = this.#dropdown(node);
    if (!state.open) return;
    state.open = false; state.highlighted = state.selected;
    this.#actions.push({ type: "close", id });
  }

  /**
   * The rectangles a dropdown's open list occupies, below the control.
   *
   * Returned rather than laid out as child nodes because a popup escapes its
   * parent's clip and its parent's flow; putting it in the tree makes every
   * container above it reserve space it does not use.
   */
  optionRects(id: string, itemHeight: number): readonly UiRect[] {
    const node = this.#require(id);
    positive(itemHeight, `UI dropdown '${id}' item height`);
    const state = this.#dropdown(node);
    if (!state.open) return [];
    return state.options.map((_, index) => Object.freeze({ x: node.rect.x, y: node.rect.y + node.rect.height + index * itemHeight, width: node.rect.width, height: itemHeight }));
  }

  /** The option under a pointer while a dropdown is open, if any. */
  optionAt(id: string, x: number, y: number, itemHeight: number): number | undefined {
    finite(x, "UI pointer x"); finite(y, "UI pointer y");
    const index = this.optionRects(id, itemHeight).findIndex((rect) => contains(rect, x, y));
    return index < 0 ? undefined : index;
  }

  /** Selects a dropdown option by index and closes the list. */
  select(id: string, index: number): void {
    const node = this.#require(id);
    const state = this.#dropdown(node);
    if (!Number.isInteger(index) || index < 0 || index >= state.options.length) throw new Error(`UI dropdown '${id}' has no option at index ${String(index)}.`);
    state.highlighted = index;
    this.#commitDropdown(node, state);
  }

  /** A slider's or progress bar's value as a 0..1 fraction, for drawing a fill. */
  fraction(id: string): number {
    const node = this.#require(id);
    if (node.definition.role !== "slider" && node.definition.role !== "progress") throw new Error(`UI node '${id}' has role '${node.definition.role}', which has no fill fraction.`);
    const minimum = node.definition.minimum ?? 0;
    const maximum = node.definition.maximum ?? 1;
    if (!(maximum > minimum)) throw new Error(`UI node '${id}' maximum must be greater than minimum.`);
    return Math.max(0, Math.min(1, (numberValue(node.definition.value, minimum) - minimum) / (maximum - minimum)));
  }

  setValue(id: string, value: number | boolean | string): void {
    const node = this.#require(id); node.definition = { ...node.definition, value };
    const state = node.definition.role === "dropdown" ? this.#dropdown(node) : undefined;
    if (state !== undefined && typeof value === "string") {
      const index = state.options.indexOf(value);
      if (index < 0) throw new Error(`UI dropdown '${id}' has no option ${JSON.stringify(value)}.`);
      state.selected = index; state.highlighted = index;
    }
  }

  value(id: string): number | boolean | string | undefined { return this.#require(id).definition.value; }
  drainActions(): readonly UiAction[] { return this.#actions.splice(0); }

  #setSlider(node: MutableNode, raw: number, minimum: number, maximum: number, step: number): void {
    const value = Math.min(maximum, Math.max(minimum, minimum + Math.round((raw - minimum) / step) * step));
    if (value === node.definition.value) return;
    node.definition = { ...node.definition, value };
    this.#actions.push({ type: "change", id: node.definition.id, value });
  }

  #commitDropdown(node: MutableNode, state: DropdownState): void {
    state.open = false;
    const id = node.definition.id;
    this.#actions.push({ type: "close", id });
    if (state.options.length === 0 || state.highlighted === state.selected) return;
    state.selected = state.highlighted;
    const value = state.options[state.selected]!;
    node.definition = { ...node.definition, value };
    this.#actions.push({ type: "change", id, value });
  }

  #dropdown(node: MutableNode): DropdownState {
    if (node.definition.role !== "dropdown") throw new Error(`UI node '${node.definition.id}' has role '${node.definition.role}', not 'dropdown'.`);
    let state = this.#dropdowns.get(node.definition.id);
    if (state === undefined) {
      const options = node.definition.options ?? [];
      const initial = typeof node.definition.value === "string" ? options.indexOf(node.definition.value) : -1;
      state = { options, open: false, selected: Math.max(0, initial), highlighted: Math.max(0, initial) };
      this.#dropdowns.set(node.definition.id, state);
    }
    return state;
  }

  #build(definition: UiNodeDefinition, parent: MutableNode | undefined, depth: number): MutableNode {
    if (!definition.id.trim()) throw new Error("UI node ID must not be empty.");
    if (this.#nodes.has(definition.id)) throw new Error(`UI node ID '${definition.id}' is duplicated.`);
    const style = definition.style ?? {};
    validateStyle(definition.id, style);
    if (definition.role === "dropdown") {
      const options = definition.options ?? [];
      if (new Set(options).size !== options.length) throw new Error(`UI dropdown '${definition.id}' declares duplicate options.`);
    }
    const node: MutableNode = { definition, style, ...(parent === undefined ? {} : { parent }), children: [], rect: { x: 0, y: 0, width: 0, height: 0 }, depth };
    this.#nodes.set(definition.id, node);
    node.children = (definition.children ?? []).map((child) => this.#build(child, node, depth + 1));
    return node;
  }

  #require(id: string): MutableNode { const node = this.#nodes.get(id); if (node === undefined) throw new Error(`Unknown UI node '${id}'.`); return node; }

  #layoutNode(node: MutableNode, available: UiRect): void {
    const style = node.style;
    const measured = this.#measureNode(node, available.width, available.height);
    this.#place(node, { x: available.x, y: available.y, width: resolveSize(style.width, measured[0], available.width), height: resolveSize(style.height, measured[1], available.height) });
  }

  /** Assigns a node's own rect, then arranges its children inside it. */
  #place(node: MutableNode, rect: UiRect): void {
    const style = node.style;
    node.rect = { x: rect.x, y: rect.y, width: constrain(rect.width, style.minWidth, style.maxWidth), height: constrain(rect.height, style.minHeight, style.maxHeight) };
    if (!visible(node) || node.children.length === 0) return;
    const [top, right, bottom, left] = padding(style.padding);
    const inner: UiRect = { x: node.rect.x + left, y: node.rect.y + top, width: Math.max(0, node.rect.width - left - right), height: Math.max(0, node.rect.height - top - bottom) };
    const children = node.children.filter(visible);
    const flow = children.filter((child) => child.style.anchor === undefined);
    if (style.grid !== undefined) this.#layoutGrid(node, inner, flow);
    else this.#layoutFlex(node, inner, flow);
    for (const child of children) {
      const anchor = child.style.anchor;
      if (anchor !== undefined) this.#place(child, anchorRect(anchor, inner));
    }
  }

  #layoutFlex(node: MutableNode, inner: UiRect, children: readonly MutableNode[]): void {
    if (children.length === 0) return;
    const style = node.style;
    const row = (style.direction ?? "column") === "row";
    const mainSize = row ? inner.width : inner.height;
    const crossSize = row ? inner.height : inner.width;
    const gap = style.gap ?? 0;
    const items = children.map((child) => this.#flexItem(child, inner, row));

    // Wrapping is greedy on basis sizes, before grow and shrink: growing first
    // would fill the first line and never wrap.
    const lines: FlexItem[][] = [];
    if (style.wrap !== true) lines.push([...items]);
    else {
      let line: FlexItem[] = []; let used = 0;
      for (const item of items) {
        if (line.length > 0 && used + gap + item.basis > mainSize) { lines.push(line); line = []; used = 0; }
        used = line.length === 0 ? item.basis : used + gap + item.basis;
        line.push(item);
      }
      if (line.length > 0) lines.push(line);
    }
    const lineCross = lines.map((line) => line.reduce((largest, item) => Math.max(largest, item.cross), 0));
    const wrapped = style.wrap === true && lines.length > 1;
    let crossCursor = 0;

    for (const [index, line] of lines.entries()) {
      const lineSize = wrapped ? lineCross[index]! : crossSize;
      const totalGap = Math.max(0, line.length - 1) * gap;
      const mains = line.map((item) => item.basis);
      let free = mainSize - mains.reduce((sum, value) => sum + value, 0) - totalGap;
      const growTotal = line.reduce((sum, item) => sum + item.grow, 0);
      const shrinkTotal = line.reduce((sum, item) => sum + item.shrink * item.basis, 0);
      if (free > 0 && growTotal > 0) { for (const [k, item] of line.entries()) mains[k] = mains[k]! + (free * item.grow) / growTotal; free = 0; }
      // Shrinking is weighted by basis, so a wide child gives up more than a
      // narrow one — otherwise a 20px icon vanishes before a 400px panel moves.
      else if (free < 0 && shrinkTotal > 0) { for (const [k, item] of line.entries()) mains[k] = Math.max(0, mains[k]! + (free * item.shrink * item.basis) / shrinkTotal); free = 0; }
      const [leading, between] = distribute(style.justify ?? "start", Math.max(0, free), line.length);

      let cursor = leading;
      for (const [k, item] of line.entries()) {
        const child = item.node;
        const align = child.style.alignSelf ?? style.align ?? "stretch";
        const crossRequested = row ? child.style.height : child.style.width;
        const cross = crossRequested === undefined && align === "stretch" ? lineSize : resolveSize(crossRequested, item.cross, lineSize);
        const crossOffset = crossCursor + (align === "center" ? (lineSize - cross) / 2 : align === "end" ? lineSize - cross : 0);
        const main = mains[k]!;
        this.#place(child, row ? { x: inner.x + cursor, y: inner.y + crossOffset, width: main, height: cross } : { x: inner.x + crossOffset, y: inner.y + cursor, width: cross, height: main });
        cursor += main + gap + between;
      }
      crossCursor += lineSize + gap;
    }
  }

  #flexItem(child: MutableNode, inner: UiRect, row: boolean): FlexItem {
    const style = child.style;
    const requested = row ? style.width : style.height;
    const measured = this.#measureNode(child, inner.width, inner.height);
    const natural = requested === "fill" ? 0 : typeof requested === "number" ? requested : row ? measured[0] : measured[1];
    return {
      node: child,
      basis: style.flexBasis ?? natural,
      grow: style.flexGrow ?? (requested === "fill" ? 1 : 0),
      shrink: style.flexShrink ?? 0,
      cross: row ? measured[1] : measured[0],
    };
  }

  #layoutGrid(node: MutableNode, inner: UiRect, children: readonly MutableNode[]): void {
    if (children.length === 0) return;
    const plan = this.#gridPlan(node, children, inner.width, inner.height);
    for (const cell of plan.cells) {
      const x = inner.x + offsetOf(plan.columns, cell.column, plan.columnGap);
      const y = inner.y + offsetOf(plan.rows, cell.row, plan.rowGap);
      const width = spanOf(plan.columns, cell.column, cell.columnSpan, plan.columnGap);
      const height = spanOf(plan.rows, cell.row, cell.rowSpan, plan.rowGap);
      this.#layoutNode(cell.node, { x, y, width, height });
    }
  }

  /** Placement and track sizes, shared by measurement and layout so a
   * content-sized grid reports exactly the size it will later occupy. */
  #gridPlan(node: MutableNode, children: readonly MutableNode[], availableWidth: number, availableHeight: number): GridPlan {
    const grid = node.style.grid!;
    const columnCount = grid.columns.length;
    const columnGap = grid.columnGap ?? node.style.gap ?? 0;
    const rowGap = grid.rowGap ?? node.style.gap ?? 0;
    const occupied = new Set<string>();
    const cells: GridCell[] = [];
    let cursorRow = 0; let cursorColumn = 0;

    for (const child of children) {
      const area = child.style.gridArea ?? {};
      const columnSpan = Math.max(1, Math.min(columnCount, Math.trunc(area.columnSpan ?? 1)));
      const rowSpan = Math.max(1, Math.trunc(area.rowSpan ?? 1));
      let column: number; let row: number;
      if (area.column !== undefined || area.row !== undefined) {
        column = Math.max(0, Math.min(columnCount - columnSpan, Math.trunc(area.column ?? 0)));
        row = Math.max(0, Math.trunc(area.row ?? cursorRow));
      } else {
        [row, column] = nextFreeCell(occupied, columnCount, columnSpan, rowSpan, cursorRow, cursorColumn);
        cursorRow = row; cursorColumn = column + columnSpan;
        if (cursorColumn >= columnCount) { cursorRow += 1; cursorColumn = 0; }
      }
      for (let r = row; r < row + rowSpan; r += 1) for (let c = column; c < column + columnSpan; c += 1) occupied.add(`${String(r)},${String(c)}`);
      cells.push({ node: child, column, row, columnSpan, rowSpan });
    }

    const rowCount = grid.rows?.length ?? cells.reduce((largest, cell) => Math.max(largest, cell.row + cell.rowSpan), 0);
    const measured = new Map<MutableNode, readonly [number, number]>();
    for (const cell of cells) measured.set(cell.node, this.#measureNode(cell.node, availableWidth, availableHeight));
    // `auto` tracks size to their largest single-cell occupant. Spanning cells
    // are ignored there deliberately: distributing a span across auto tracks is
    // ambiguous, and the ambiguity is what makes CSS grid's version surprising.
    const autoAlong = (index: number, axis: 0 | 1): number => cells.reduce((largest, cell) => {
      const start = axis === 0 ? cell.column : cell.row;
      const span = axis === 0 ? cell.columnSpan : cell.rowSpan;
      return start === index && span === 1 ? Math.max(largest, measured.get(cell.node)![axis]) : largest;
    }, 0);

    const columns = resolveTracks(grid.columns, availableWidth, columnGap, (index) => autoAlong(index, 0));
    const rowTracks = grid.rows ?? (Array.from({ length: rowCount }, () => "auto") as readonly UiTrack[]);
    const rows = resolveTracks(rowTracks, availableHeight, rowGap, (index) => autoAlong(index, 1));
    return { columns, rows, columnGap, rowGap, cells, width: total(columns, columnGap), height: total(rows, rowGap) };
  }

  /** Measures intrinsic content without mutating layout. Fill dimensions do not
   * create a circular dependency: inside a content-sized parent they collapse
   * to the child's own content/intrinsic minimum. */
  #measureNode(node: MutableNode, availableWidth: number, availableHeight: number): readonly [number, number] {
    const style = node.style;
    const intrinsicWidth = node.definition.intrinsicSize?.[0] ?? 0;
    const intrinsicHeight = node.definition.intrinsicSize?.[1] ?? 0;
    const flow = node.children.filter((child) => visible(child) && child.style.anchor === undefined);
    if (!visible(node) || flow.length === 0) return [
      constrain(typeof style.width === "number" ? style.width : intrinsicWidth, style.minWidth, style.maxWidth),
      constrain(typeof style.height === "number" ? style.height : intrinsicHeight, style.minHeight, style.maxHeight),
    ];
    const [top, right, bottom, left] = padding(style.padding);
    const innerWidth = Math.max(0, availableWidth - left - right);
    const innerHeight = Math.max(0, availableHeight - top - bottom);
    let contentWidth: number; let contentHeight: number;
    if (style.grid !== undefined) {
      const plan = this.#gridPlan(node, flow, innerWidth, innerHeight);
      contentWidth = plan.width + left + right;
      contentHeight = plan.height + top + bottom;
    } else {
      const direction = style.direction ?? "column";
      let main = 0; let cross = 0;
      for (const child of flow) {
        const measured = this.#measureNode(child, innerWidth, innerHeight);
        const childStyle = child.style;
        const width = typeof childStyle.width === "number" ? childStyle.width : measured[0];
        const height = typeof childStyle.height === "number" ? childStyle.height : measured[1];
        main += direction === "row" ? width : height;
        cross = Math.max(cross, direction === "row" ? height : width);
      }
      main += Math.max(0, flow.length - 1) * (style.gap ?? 0);
      contentWidth = (direction === "row" ? main : cross) + left + right;
      contentHeight = (direction === "row" ? cross : main) + top + bottom;
    }
    const measuredWidth = style.width === "content" ? Math.max(intrinsicWidth, contentWidth) : typeof style.width === "number" ? style.width : intrinsicWidth;
    const measuredHeight = style.height === "content" ? Math.max(intrinsicHeight, contentHeight) : typeof style.height === "number" ? style.height : intrinsicHeight;
    return [constrain(measuredWidth, style.minWidth, style.maxWidth), constrain(measuredHeight, style.minHeight, style.maxHeight)];
  }
}

interface DropdownState { readonly options: readonly string[]; open: boolean; selected: number; highlighted: number }

/** Merges every breakpoint whose `minWidth` the viewport meets, narrowest first,
 * so a wider rule wins over a narrower one exactly as CSS media queries do. */
export function resolveBreakpoints(style: UiStyle, viewportWidth: number): UiStyle {
  const breakpoints = style.breakpoints;
  if (breakpoints === undefined || breakpoints.length === 0) return style;
  let merged = style;
  for (const breakpoint of [...breakpoints].sort((a, b) => a.minWidth - b.minWidth)) {
    if (viewportWidth >= breakpoint.minWidth) merged = { ...merged, ...breakpoint.style };
  }
  return merged;
}

/** The rect a Unity-style anchor produces inside a parent's content box. */
export function anchorRect(anchor: UiAnchor, inner: UiRect): UiRect {
  const [left, top, right, bottom] = anchor.offsets ?? [0, 0, 0, 0];
  const x0 = inner.x + anchor.min[0] * inner.width + left;
  const y0 = inner.y + anchor.min[1] * inner.height + top;
  const x1 = inner.x + anchor.max[0] * inner.width + right;
  const y1 = inner.y + anchor.max[1] * inner.height + bottom;
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

function resolveTracks(tracks: readonly UiTrack[], available: number, gap: number, autoSize: (index: number) => number): readonly number[] {
  const sizes = tracks.map((track, index) => (typeof track === "number" ? track : track === "auto" ? autoSize(index) : 0));
  const fractionTotal = tracks.reduce<number>((sum, track) => sum + (typeof track === "object" ? track.fraction : 0), 0);
  if (fractionTotal > 0) {
    const free = Math.max(0, available - Math.max(0, tracks.length - 1) * gap - sizes.reduce((sum, size) => sum + size, 0));
    for (const [index, track] of tracks.entries()) if (typeof track === "object") sizes[index] = (free * track.fraction) / fractionTotal;
  }
  return sizes;
}

function nextFreeCell(occupied: ReadonlySet<string>, columnCount: number, columnSpan: number, rowSpan: number, fromRow: number, fromColumn: number): [number, number] {
  for (let row = fromRow; row < fromRow + occupied.size + 2; row += 1) {
    for (let column = row === fromRow ? fromColumn : 0; column + columnSpan <= columnCount; column += 1) {
      let free = true;
      for (let r = row; r < row + rowSpan && free; r += 1) for (let c = column; c < column + columnSpan; c += 1) if (occupied.has(`${String(r)},${String(c)}`)) { free = false; break; }
      if (free) return [row, column];
    }
  }
  return [fromRow, 0];
}

function offsetOf(sizes: readonly number[], index: number, gap: number): number {
  let offset = 0;
  for (let i = 0; i < index && i < sizes.length; i += 1) offset += sizes[i]! + gap;
  return offset;
}

function spanOf(sizes: readonly number[], index: number, span: number, gap: number): number {
  let size = 0;
  for (let i = index; i < index + span && i < sizes.length; i += 1) size += sizes[i]! + (i > index ? gap : 0);
  return size;
}

function total(sizes: readonly number[], gap: number): number {
  return sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, sizes.length - 1) * gap;
}

/** Leading offset and per-gap extra for a justification mode. */
function distribute(justify: UiJustify, free: number, count: number): [number, number] {
  if (free <= 0 || count === 0) return [0, 0];
  if (justify === "center") return [free / 2, 0];
  if (justify === "end") return [free, 0];
  if (justify === "space-between") return count > 1 ? [0, free / (count - 1)] : [0, 0];
  if (justify === "space-around") { const unit = free / count; return [unit / 2, unit]; }
  if (justify === "space-evenly") { const unit = free / (count + 1); return [unit, unit]; }
  return [0, 0];
}

function sliderRange(node: MutableNode): { minimum: number; maximum: number; step: number } {
  const minimum = node.definition.minimum ?? 0;
  const maximum = node.definition.maximum ?? 1;
  if (!(maximum > minimum)) throw new Error(`UI slider '${node.definition.id}' maximum must be greater than minimum.`);
  return { minimum, maximum, step: positive(node.definition.step ?? (maximum - minimum) / 100, `UI slider '${node.definition.id}' step`) };
}

function numberValue(value: number | boolean | string | undefined, fallback: number): number { return typeof value === "number" ? value : fallback; }
function wrapIndex(index: number, count: number): number { return ((index % count) + count) % count; }
function visible(node: MutableNode): boolean { return node.style.visible !== false && (node.parent === undefined || visible(node.parent)); }
function enabled(node: MutableNode): boolean { return node.style.enabled !== false && (node.parent === undefined || enabled(node.parent)); }
function interactive(node: MutableNode): boolean { return visible(node) && enabled(node) && INTERACTIVE_ROLES.has(node.definition.role); }
const INTERACTIVE_ROLES: ReadonlySet<UiRole> = new Set<UiRole>(["button", "toggle", "slider", "dropdown"]);
function contains(rect: UiRect, x: number, y: number): boolean { return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height; }
function resolveSize(value: number | "fill" | "content" | undefined, intrinsic: number | undefined, available: number): number { if (typeof value === "number") return value; if (value === "content") return intrinsic ?? 0; return available; }
function constrain(value: number, minimum = 0, maximum = Number.POSITIVE_INFINITY): number { return Math.min(maximum, Math.max(minimum, value)); }
function padding(value: UiStyle["padding"]): [number, number, number, number] { return typeof value === "number" ? [value, value, value, value] : value === undefined ? [0, 0, 0, 0] : [...value]; }
function validateStyle(id: string, style: UiStyle): void {
  for (const [key, value] of Object.entries(style)) if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) throw new Error(`UI node '${id}' style.${key} must be finite and non-negative.`);
  if (Array.isArray(style.padding) && (style.padding.length !== 4 || style.padding.some((value) => !Number.isFinite(value) || value < 0))) throw new Error(`UI node '${id}' padding must contain four non-negative numbers.`);
  if (style.anchor !== undefined) validateAnchor(id, style.anchor);
  if (style.grid !== undefined) validateGrid(id, style.grid);
  for (const breakpoint of style.breakpoints ?? []) {
    if (!Number.isFinite(breakpoint.minWidth) || breakpoint.minWidth < 0) throw new Error(`UI node '${id}' breakpoint minWidth must be finite and non-negative.`);
    validateStyle(id, breakpoint.style);
  }
}
function validateAnchor(id: string, anchor: UiAnchor): void {
  for (const [name, pair] of [["min", anchor.min], ["max", anchor.max]] as const) {
    if (pair.length !== 2 || pair.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error(`UI node '${id}' anchor.${name} must be two fractions between 0 and 1.`);
  }
  if (anchor.min[0] > anchor.max[0] || anchor.min[1] > anchor.max[1]) throw new Error(`UI node '${id}' anchor.min must not exceed anchor.max.`);
  // Offsets are signed on purpose: pinning to the right edge needs a negative
  // left offset, and forbidding that is what makes anchor APIs unusable.
  if (anchor.offsets !== undefined && (anchor.offsets.length !== 4 || anchor.offsets.some((value) => !Number.isFinite(value)))) throw new Error(`UI node '${id}' anchor.offsets must contain four finite numbers.`);
}
function validateGrid(id: string, grid: UiGrid): void {
  if (grid.columns.length === 0) throw new Error(`UI node '${id}' grid needs at least one column track.`);
  for (const track of [...grid.columns, ...(grid.rows ?? [])]) {
    if (typeof track === "number" && (!Number.isFinite(track) || track < 0)) throw new Error(`UI node '${id}' grid tracks must be finite and non-negative.`);
    if (typeof track === "object" && (!Number.isFinite(track.fraction) || track.fraction <= 0)) throw new Error(`UI node '${id}' grid fractional tracks need a positive fraction.`);
  }
  for (const gap of [grid.columnGap, grid.rowGap]) if (gap !== undefined && (!Number.isFinite(gap) || gap < 0)) throw new Error(`UI node '${id}' grid gaps must be finite and non-negative.`);
}
function finite(value: number, label: string): number { if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`); return value; }
function positive(value: number, label: string): number { if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive.`); return value; }
