/** Formats a counter value for display, choosing units by magnitude. */
export function formatCounterValue(sample, value) {
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
export function formatBytes(bytes) {
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
export function buildOverlayModel(diagnostics, options = {}) {
    const budgets = options.budgets ?? {};
    const grouped = diagnostics.grouped();
    const order = options.sections ?? [...grouped.keys()].sort();
    const sections = [];
    for (const title of order) {
        const samples = grouped.get(title);
        if (!samples || samples.length === 0)
            continue;
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
export function formatOverlayText(model) {
    const lines = [];
    for (const section of model.sections) {
        lines.push(section.title);
        for (const row of section.rows) {
            lines.push(`  ${row.overBudget ? "!" : " "} ${row.label.padEnd(16)} ${row.value.padStart(10)}  ${row.detail}`);
        }
    }
    return lines.join("\n");
}
/**
 * A self-refreshing overlay bound to a host element.
 *
 * Advanced by the caller like the rest of the framework, so it stops with the
 * game and cannot itself become a source of per-frame work when paused.
 */
export class DiagnosticsOverlay {
    #diagnostics;
    #options;
    #refreshSeconds;
    #element;
    #accumulated = 0;
    #model;
    #visible = true;
    constructor(diagnostics, options = {}) {
        const refresh = options.refreshSeconds ?? 0.25;
        if (!(refresh > 0))
            throw new Error("A diagnostics overlay requires a positive refresh interval.");
        this.#diagnostics = diagnostics;
        this.#options = options;
        this.#refreshSeconds = refresh;
        this.#model = buildOverlayModel(diagnostics, options);
    }
    get model() {
        return this.#model;
    }
    get visible() {
        return this.#visible;
    }
    set visible(value) {
        this.#visible = value;
        this.#element?.style.setProperty("display", value ? "block" : "none");
    }
    /** Binds a host element that receives the rendered text. */
    attach(element) {
        this.#element = element;
        element.setAttribute("data-vapour-overlay", "true");
        element.style.setProperty("white-space", "pre");
        element.style.setProperty("font-family", "ui-monospace, monospace");
        this.#paint();
    }
    detach() {
        this.#element = undefined;
    }
    /** Advances the refresh timer; rebuilds the model when the interval elapses. */
    advance(deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
            throw new Error("DiagnosticsOverlay.advance requires a finite, non-negative delta.");
        }
        this.#accumulated += deltaSeconds;
        if (this.#accumulated < this.#refreshSeconds)
            return;
        this.#accumulated = 0;
        this.refresh();
    }
    /** Rebuilds immediately, regardless of the refresh interval. */
    refresh() {
        this.#model = buildOverlayModel(this.#diagnostics, this.#options);
        this.#paint();
    }
    #paint() {
        if (!this.#element || !this.#visible)
            return;
        this.#element.textContent = formatOverlayText(this.#model);
    }
}
//# sourceMappingURL=overlay.js.map