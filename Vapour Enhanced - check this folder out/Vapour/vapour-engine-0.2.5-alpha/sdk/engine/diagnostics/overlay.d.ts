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
export declare function formatCounterValue(sample: CounterSample, value: number): string;
export declare function formatBytes(bytes: number): string;
/** Turns the counter registry into a formatted, grouped model. */
export declare function buildOverlayModel(diagnostics: Diagnostics, options?: OverlayOptions): OverlayModel;
/** Renders an {@link OverlayModel} as plain text, for logs and headless runs. */
export declare function formatOverlayText(model: OverlayModel): string;
/** Minimal DOM surface the overlay needs, so it can be driven in a test. */
export interface OverlayElement {
    textContent: string | null;
    readonly style: {
        setProperty(name: string, value: string): void;
    };
    setAttribute(name: string, value: string): void;
}
export interface OverlayDocument {
    createElement(tagName: string): OverlayElement & {
        appendChild(child: unknown): unknown;
    };
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
export declare class DiagnosticsOverlay {
    #private;
    constructor(diagnostics: Diagnostics, options?: DiagnosticsOverlayOptions);
    get model(): OverlayModel;
    get visible(): boolean;
    set visible(value: boolean);
    /** Binds a host element that receives the rendered text. */
    attach(element: OverlayElement): void;
    detach(): void;
    /** Advances the refresh timer; rebuilds the model when the interval elapses. */
    advance(deltaSeconds: number): void;
    /** Rebuilds immediately, regardless of the refresh interval. */
    refresh(): void;
}
//# sourceMappingURL=overlay.d.ts.map