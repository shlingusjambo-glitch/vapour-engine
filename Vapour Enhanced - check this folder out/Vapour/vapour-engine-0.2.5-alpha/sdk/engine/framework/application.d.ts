/** Application lifecycle, clipboard, and screenshots.
 *
 * The browser is not a console: the page can be hidden, throttled, restored
 * from the back/forward cache, or discarded outright, and a game that ignores
 * that will keep simulating in a background tab, burn battery, and come back
 * from a five-minute hide with a five-minute delta.
 *
 * `Application` normalizes those browser events into the two questions a game
 * actually asks — *should I be simulating?* and *am I about to be closed?* —
 * and does so behind injectable dependencies so the behaviour is testable
 * without a browser.
 */
import { Signal } from "./signal.js";
export interface ApplicationHost {
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}
export interface VisibilitySource {
    readonly visibilityState: "visible" | "hidden";
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}
export interface ApplicationOptions {
    /** Usually `window`. */
    readonly host?: ApplicationHost;
    /** Usually `document`. */
    readonly visibility?: VisibilitySource;
    /**
     * Keep simulating while the page is hidden. Off by default: a hidden tab is
     * throttled to roughly one frame a second, so continuing to simulate wastes
     * battery and produces enormous deltas on return.
     */
    readonly runWhileHidden?: boolean;
}
/**
 * Tracks whether the game should be running and when it is about to be closed.
 *
 * Emits `paused`, `resumed`, `focusChanged`, and `willClose`. A game pauses its
 * {@link Scheduler} and {@link TweenRunner} on `paused` and resumes on
 * `resumed`, which is all that is needed for timers to stop with the game.
 */
export declare class Application {
    #private;
    readonly paused: Signal<void>;
    readonly resumed: Signal<void>;
    readonly focusChanged: Signal<boolean>;
    /** Last chance to persist. Handlers must be synchronous — the browser will
     * not wait for a promise here. */
    readonly willClose: Signal<void>;
    constructor(options?: ApplicationOptions);
    /** True while the game should be simulating. */
    get running(): boolean;
    get focused(): boolean;
    get visible(): boolean;
    /** Pauses regardless of visibility — a pause menu, a lost connection. */
    pause(): void;
    /** Resumes, unless the page is hidden and `runWhileHidden` is off. */
    resume(): void;
    dispose(): void;
}
export interface ClipboardLike {
    writeText(text: string): Promise<void>;
    readText(): Promise<string>;
}
/**
 * Copies text, reporting failure rather than throwing an opaque DOM error.
 *
 * Clipboard access is gated on a user gesture and on permission, and both
 * refusals surface as rejected promises with unhelpful messages, so the result
 * is returned as data.
 */
export declare function copyText(text: string, clipboard?: ClipboardLike): Promise<{
    ok: true;
} | {
    ok: false;
    reason: string;
}>;
export declare function readText(clipboard?: ClipboardLike): Promise<{
    ok: true;
    text: string;
} | {
    ok: false;
    reason: string;
}>;
export interface ScreenshotSource {
    toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}
export interface ScreenshotOptions {
    /** `image/png` (default) or `image/jpeg`/`image/webp` for smaller files. */
    readonly type?: string;
    /** Quality in `[0, 1]` for lossy formats. */
    readonly quality?: number;
}
/**
 * Captures a canvas as an image blob.
 *
 * A WebGPU canvas only retains its contents when configured with
 * `preserveDrawingBuffer`-equivalent behaviour, so capture immediately after
 * rendering and before the next frame begins. A blank result almost always
 * means the capture happened a frame too late.
 */
export declare function captureScreenshot(canvas: ScreenshotSource, options?: ScreenshotOptions): Promise<Blob>;
//# sourceMappingURL=application.d.ts.map