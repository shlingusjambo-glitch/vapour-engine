export type UiDirection = "row" | "column";
export type UiAlign = "start" | "center" | "end" | "stretch";
export type UiJustify = "start" | "center" | "end" | "space-between";
export type UiRole = "panel" | "image" | "text" | "button" | "toggle" | "slider";

export interface UiStyle {
  readonly direction?: UiDirection;
  readonly width?: number | "fill" | "content";
  readonly height?: number | "fill" | "content";
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly flexGrow?: number;
  readonly gap?: number;
  readonly padding?: number | readonly [number, number, number, number];
  readonly align?: UiAlign;
  readonly justify?: UiJustify;
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
  readonly children?: readonly UiNodeDefinition[];
}

export interface UiRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface UiLayoutNode { readonly id: string; readonly role: UiRole; readonly rect: UiRect; readonly depth: number; readonly visible: boolean; readonly enabled: boolean }
export interface UiAction { readonly type: "click" | "change" | "focus"; readonly id: string; readonly value?: number | boolean | string }

interface MutableNode {
  definition: UiNodeDefinition;
  parent?: MutableNode;
  children: MutableNode[];
  rect: UiRect;
  depth: number;
}

/** Retained, renderer-independent game UI. Layout results can be rendered with
 * sprites/text, while hit testing and focus use those exact same rectangles. */
export class UiDocument {
  readonly #root: MutableNode;
  readonly #nodes = new Map<string, MutableNode>();
  readonly #actions: UiAction[] = [];
  #focused: string | undefined;
  #pressed: string | undefined;

  constructor(root: UiNodeDefinition) {
    this.#root = this.#build(root, undefined, 0);
  }

  get focusedId(): string | undefined { return this.#focused; }

  layout(width: number, height: number): readonly UiLayoutNode[] {
    positive(width, "UI viewport width"); positive(height, "UI viewport height");
    this.#layoutNode(this.#root, { x: 0, y: 0, width, height });
    return this.nodes();
  }

  nodes(): readonly UiLayoutNode[] {
    return [...this.#nodes.values()].map((node) => Object.freeze({ id: node.definition.id, role: node.definition.role, rect: Object.freeze({ ...node.rect }), depth: node.depth, visible: visible(node), enabled: enabled(node) }));
  }

  rect(id: string): UiRect { return Object.freeze({ ...this.#require(id).rect }); }

  hitTest(x: number, y: number): string | undefined {
    finite(x, "UI pointer x"); finite(y, "UI pointer y");
    return [...this.#nodes.values()].reverse().find((node) => interactive(node) && contains(node.rect, x, y))?.definition.id;
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
      const minimum = definition.minimum ?? 0; const maximum = definition.maximum ?? 1;
      if (!(maximum > minimum)) throw new Error(`UI slider '${id}' maximum must be greater than minimum.`);
      const fraction = pointerX === undefined ? 1 : Math.max(0, Math.min(1, (pointerX - node.rect.x) / node.rect.width));
      const step = positive(definition.step ?? (maximum - minimum) / 100, `UI slider '${id}' step`);
      const value = Math.min(maximum, Math.max(minimum, minimum + Math.round(((minimum + fraction * (maximum - minimum)) - minimum) / step) * step));
      node.definition = { ...definition, value };
      this.#actions.push({ type: "change", id, value });
    } else this.#actions.push({ type: "click", id });
  }

  setValue(id: string, value: number | boolean | string): void {
    const node = this.#require(id); node.definition = { ...node.definition, value };
  }

  value(id: string): number | boolean | string | undefined { return this.#require(id).definition.value; }
  drainActions(): readonly UiAction[] { return this.#actions.splice(0); }

  #build(definition: UiNodeDefinition, parent: MutableNode | undefined, depth: number): MutableNode {
    if (!definition.id.trim()) throw new Error("UI node ID must not be empty.");
    if (this.#nodes.has(definition.id)) throw new Error(`UI node ID '${definition.id}' is duplicated.`);
    validateStyle(definition.id, definition.style ?? {});
    const node: MutableNode = { definition, ...(parent === undefined ? {} : { parent }), children: [], rect: { x: 0, y: 0, width: 0, height: 0 }, depth };
    this.#nodes.set(definition.id, node);
    node.children = (definition.children ?? []).map((child) => this.#build(child, node, depth + 1));
    return node;
  }

  #require(id: string): MutableNode { const node = this.#nodes.get(id); if (node === undefined) throw new Error(`Unknown UI node '${id}'.`); return node; }

  #layoutNode(node: MutableNode, available: UiRect): void {
    const style = node.definition.style ?? {};
    const measured = this.#measureNode(node, available.width, available.height);
    node.rect = { x: available.x, y: available.y, width: constrain(resolveSize(style.width, measured[0], available.width), style.minWidth, style.maxWidth), height: constrain(resolveSize(style.height, measured[1], available.height), style.minHeight, style.maxHeight) };
    if (!visible(node) || node.children.length === 0) return;
    const [top, right, bottom, left] = padding(style.padding);
    const inner: UiRect = { x: node.rect.x + left, y: node.rect.y + top, width: Math.max(0, node.rect.width - left - right), height: Math.max(0, node.rect.height - top - bottom) };
    const direction = style.direction ?? "column"; const mainSize = direction === "row" ? inner.width : inner.height; const crossSize = direction === "row" ? inner.height : inner.width;
    const gap = style.gap ?? 0; const children = node.children.filter(visible); const totalGap = Math.max(0, children.length - 1) * gap;
    let fixed = 0; let grow = 0;
    for (const child of children) { const childStyle = child.definition.style ?? {}; const requested = direction === "row" ? childStyle.width : childStyle.height; if (requested === "fill") grow += childStyle.flexGrow ?? 1; else { const measuredChild = this.#measureNode(child, inner.width, inner.height); fixed += typeof requested === "number" ? requested : direction === "row" ? measuredChild[0] : measuredChild[1]; } }
    const remaining = Math.max(0, mainSize - fixed - totalGap); let distributable = 0; let leading = 0;
    if (grow === 0) { const spare = remaining; if (style.justify === "center") leading = spare / 2; else if (style.justify === "end") leading = spare; else if (style.justify === "space-between" && children.length > 1) distributable = spare / (children.length - 1); }
    let cursor = leading;
    for (const child of children) {
      const childStyle = child.definition.style ?? {}; const mainRequested = direction === "row" ? childStyle.width : childStyle.height;
      const measuredChild = this.#measureNode(child, inner.width, inner.height);
      const main = mainRequested === "fill" ? remaining * ((childStyle.flexGrow ?? 1) / grow) : typeof mainRequested === "number" ? mainRequested : direction === "row" ? measuredChild[0] : measuredChild[1];
      const crossRequested = direction === "row" ? childStyle.height : childStyle.width; const align = style.align ?? "stretch";
      const cross = crossRequested === undefined && align === "stretch" ? crossSize : resolveSize(crossRequested, direction === "row" ? measuredChild[1] : measuredChild[0], crossSize);
      const crossOffset = align === "center" ? (crossSize - cross) / 2 : align === "end" ? crossSize - cross : 0;
      this.#layoutNode(child, direction === "row" ? { x: inner.x + cursor, y: inner.y + crossOffset, width: main, height: cross } : { x: inner.x + crossOffset, y: inner.y + cursor, width: cross, height: main });
      cursor += main + gap + distributable;
    }
  }

  /** Measures intrinsic content without mutating layout. Fill dimensions do not
   * create a circular dependency: inside a content-sized parent they collapse
   * to the child's own content/intrinsic minimum. */
  #measureNode(node: MutableNode, availableWidth: number, availableHeight: number): readonly [number, number] {
    const style = node.definition.style ?? {};
    const intrinsicWidth = node.definition.intrinsicSize?.[0] ?? 0;
    const intrinsicHeight = node.definition.intrinsicSize?.[1] ?? 0;
    if (!visible(node) || node.children.length === 0) return [
      constrain(typeof style.width === "number" ? style.width : intrinsicWidth, style.minWidth, style.maxWidth),
      constrain(typeof style.height === "number" ? style.height : intrinsicHeight, style.minHeight, style.maxHeight),
    ];
    const [top, right, bottom, left] = padding(style.padding);
    const direction = style.direction ?? "column";
    const children = node.children.filter(visible);
    let main = 0; let cross = 0;
    for (const child of children) {
      const measured = this.#measureNode(child, Math.max(0, availableWidth - left - right), Math.max(0, availableHeight - top - bottom));
      const childStyle = child.definition.style ?? {};
      const width = typeof childStyle.width === "number" ? childStyle.width : measured[0];
      const height = typeof childStyle.height === "number" ? childStyle.height : measured[1];
      main += direction === "row" ? width : height;
      cross = Math.max(cross, direction === "row" ? height : width);
    }
    main += Math.max(0, children.length - 1) * (style.gap ?? 0);
    const contentWidth = direction === "row" ? main + left + right : cross + left + right;
    const contentHeight = direction === "row" ? cross + top + bottom : main + top + bottom;
    const measuredWidth = style.width === "content" ? Math.max(intrinsicWidth, contentWidth) : typeof style.width === "number" ? style.width : intrinsicWidth;
    const measuredHeight = style.height === "content" ? Math.max(intrinsicHeight, contentHeight) : typeof style.height === "number" ? style.height : intrinsicHeight;
    return [constrain(measuredWidth, style.minWidth, style.maxWidth), constrain(measuredHeight, style.minHeight, style.maxHeight)];
  }
}

function visible(node: MutableNode): boolean { return node.definition.style?.visible !== false && (node.parent === undefined || visible(node.parent)); }
function enabled(node: MutableNode): boolean { return node.definition.style?.enabled !== false && (node.parent === undefined || enabled(node.parent)); }
function interactive(node: MutableNode): boolean { return visible(node) && enabled(node) && (node.definition.role === "button" || node.definition.role === "toggle" || node.definition.role === "slider"); }
function contains(rect: UiRect, x: number, y: number): boolean { return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height; }
function resolveSize(value: number | "fill" | "content" | undefined, intrinsic: number | undefined, available: number): number { if (typeof value === "number") return value; if (value === "content") return intrinsic ?? 0; return available; }
function constrain(value: number, minimum = 0, maximum = Number.POSITIVE_INFINITY): number { return Math.min(maximum, Math.max(minimum, value)); }
function padding(value: UiStyle["padding"]): [number, number, number, number] { return typeof value === "number" ? [value, value, value, value] : value === undefined ? [0, 0, 0, 0] : [...value]; }
function validateStyle(id: string, style: UiStyle): void { for (const [key, value] of Object.entries(style)) if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) throw new Error(`UI node '${id}' style.${key} must be finite and non-negative.`); if (Array.isArray(style.padding) && (style.padding.length !== 4 || style.padding.some((value) => !Number.isFinite(value) || value < 0))) throw new Error(`UI node '${id}' padding must contain four non-negative numbers.`); }
function finite(value: number, label: string): number { if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`); return value; }
function positive(value: number, label: string): number { if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive.`); return value; }
