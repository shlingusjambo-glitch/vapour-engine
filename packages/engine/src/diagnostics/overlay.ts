/** The diagnostics overlay: a readable view of the counter registry.
 *
 * Split into two halves on purpose. {@link buildOverlayModel} turns the counter
 * registry into a plain, formatted data structure; {@link DiagnosticsOverlay}
 * renders that model into DOM. Keeping the formatting separate means the same
 * model can drive a DOM panel, a world-space XR panel, a canvas overlay, or a
 * test assertion — and the interesting logic stays testable without a browser.
 *
 * The overlay shows mean and p95 rather than an instantaneous value, because a
 * number that changes sixty times a second is unreadable, and because the
 * spikes that make a game feel bad do not show up in a mean.
 */
import type { CounterSample, Diagnostics } from "./counters.js";

export interface OverlayRow {
  readonly label: string;
  /** Formatted for display, unit included. */
  readonly value: string;
  readonly detail: string;
  /** Set when the value crosses a configured budget. */
  readonly overBudget: boolean;
}

export interface OverlaySection {
  readonly title: string;
  readonly rows: readonly OverlayRow[];
}

export interface OverlayModel {
  readonly sections: readonly OverlaySection[];
  readonly capturedAt: number;
}

export interface OverlayOptions {
  /**
   * Per-counter thresholds. A counter whose p95 exceeds its budget is flagged,
   * which turns the overlay from a wall of numbers into an answer.
   */
  readonly budgets?: Readonly<Record<string, number>>;
  /** Only show these subsystem groups, in this order. */
  readonly sections?: readonly string[];
  readonly now?: () => number;
}

/** Formats a counter value for display, choosing units by magnitude. */
export function formatCounterValue(sample: CounterSample, value: number): string {
  switch (sample.unit) {
    case "milliseconds":
      return value < 1 ? `${(value * 1000).toFixed(0)}µs` : `${value.toFixed(2)}ms`;
    case "bytes":
      return formatBytes(value);
    case "ratio":
      return `${(value * 100).toFixed(1)}%`;
    default:
      return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1);
  }
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const sign = bytes < 0 ? "-" : "";
  return `${sign}${unit === 0 ? value.toFixed(0) : value.toFixed(1)}${units[unit]}`;
}

/** Turns the counter registry into a formatted, grouped model. */
export function buildOverlayModel(diagnostics: Diagnostics, options: OverlayOptions = {}): OverlayModel {
  const budgets = options.budgets ?? {};
  const grouped = diagnostics.grouped();
  const order = options.sections ?? [...grouped.keys()].sort();
  const sections: OverlaySection[] = [];

  for (const title of order) {
    const samples = grouped.get(title);
    if (!samples || samples.length === 0) continue;
    sections.push({
      title,
      rows: samples.map((sample) => {
        const budget = budgets[sample.name];
        // Judge against p95, not the mean: a budget is about the bad frames.
        const overBudget = budget !== undefined && sample.p95 > budget;
        const label = sample.name.includes(".") ? sample.name.slice(sample.name.indexOf(".") + 1) : sample.name;
        return {
          label,
          value: formatCounterValue(sample, sample.samples > 0 ? sample.mean : sample.value),
          detail: sample.samples > 0 ? `p95 ${formatCounterValue(sample, sample.p95)} · max ${formatCounterValue(sample, sample.max)}` : "no samples",
          overBudget,
        };
      }),
    });
  }

  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  return { sections, capturedAt: now() };
}

/** Renders an {@link OverlayModel} as plain text, for logs and headless runs. */
export function formatOverlayText(model: OverlayModel): string {
  const lines: string[] = [];
  for (const section of model.sections) {
    lines.push(section.title);
    for (const row of section.rows) {
      lines.push(`  ${row.overBudget ? "!" : " "} ${row.label.padEnd(16)} ${row.value.padStart(10)}  ${row.detail}`);
    }
  }
  return lines.join("\n");
}

/** Minimal DOM surface the overlay needs, so it can be driven in a test. */
export interface OverlayElement {
  textContent: string | null;
  readonly style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
}

export interface OverlayDocument {
  createElement(tagName: string): OverlayElement & { appendChild(child: unknown): unknown };
}

export interface DiagnosticsOverlayOptions extends OverlayOptions {
  /** Rebuild interval in seconds. The default of ~4Hz is fast enough to watch
   * and slow enough to read. */
  readonly refreshSeconds?: number;
}

/**
 * A self-refreshing overlay bound to a host element.
 *
 * Advanced by the caller like the rest of the framework, so it stops with the
 * game and cannot itself become a source of per-frame work when paused.
 */
export class DiagnosticsOverlay {
  readonly #diagnostics: Diagnostics;
  readonly #options: DiagnosticsOverlayOptions;
  readonly #refreshSeconds: number;
  #element: OverlayElement | undefined;
  #accumulated = 0;
  #model: OverlayModel;
  #visible = true;

  constructor(diagnostics: Diagnostics, options: DiagnosticsOverlayOptions = {}) {
    const refresh = options.refreshSeconds ?? 0.25;
    if (!(refresh > 0)) throw new Error("A diagnostics overlay requires a positive refresh interval.");
    this.#diagnostics = diagnostics;
    this.#options = options;
    this.#refreshSeconds = refresh;
    this.#model = buildOverlayModel(diagnostics, options);
  }

  get model(): OverlayModel {
    return this.#model;
  }

  get visible(): boolean {
    return this.#visible;
  }

  set visible(value: boolean) {
    this.#visible = value;
    this.#element?.style.setProperty("display", value ? "block" : "none");
  }

  /** Binds a host element that receives the rendered text. */
  attach(element: OverlayElement): void {
    this.#element = element;
    element.setAttribute("data-vapour-overlay", "true");
    element.style.setProperty("white-space", "pre");
    element.style.setProperty("font-family", "ui-monospace, monospace");
    this.#paint();
  }

  detach(): void {
    this.#element = undefined;
  }

  /** Advances the refresh timer; rebuilds the model when the interval elapses. */
  advance(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new Error("DiagnosticsOverlay.advance requires a finite, non-negative delta.");
    }
    this.#accumulated += deltaSeconds;
    if (this.#accumulated < this.#refreshSeconds) return;
    this.#accumulated = 0;
    this.refresh();
  }

  /** Rebuilds immediately, regardless of the refresh interval. */
  refresh(): void {
    this.#model = buildOverlayModel(this.#diagnostics, this.#options);
    this.#paint();
  }

  #paint(): void {
    if (!this.#element || !this.#visible) return;
    this.#element.textContent = formatOverlayText(this.#model);
  }
}
