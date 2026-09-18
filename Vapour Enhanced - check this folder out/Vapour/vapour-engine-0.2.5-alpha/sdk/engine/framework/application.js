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
/**
 * Tracks whether the game should be running and when it is about to be closed.
 *
 * Emits `paused`, `resumed`, `focusChanged`, and `willClose`. A game pauses its
 * {@link Scheduler} and {@link TweenRunner} on `paused` and resumes on
 * `resumed`, which is all that is needed for timers to stop with the game.
 */
export class Application {
    paused = new Signal();
    resumed = new Signal();
    focusChanged = new Signal();
    /** Last chance to persist. Handlers must be synchronous — the browser will
     * not wait for a promise here. */
    willClose = new Signal();
    #host;
    #visibility;
    #runWhileHidden;
    #listeners = [];
    #focused = true;
    #running = true;
    #disposed = false;
    constructor(options = {}) {
        this.#host = options.host;
        this.#visibility = options.visibility;
        this.#runWhileHidden = options.runWhileHidden ?? false;
        if (this.#visibility) {
            const onVisibility = () => this.#evaluate();
            this.#visibility.addEventListener("visibilitychange", onVisibility);
            this.#listeners.push(() => this.#visibility?.removeEventListener("visibilitychange", onVisibility));
        }
        if (this.#host) {
            const onFocus = () => this.#setFocused(true);
            const onBlur = () => this.#setFocused(false);
            // `pagehide` fires in cases `beforeunload` does not, notably on mobile
            // Safari, which is where an unsaved game is most likely to be lost.
            const onClose = () => this.willClose.emit();
            this.#host.addEventListener("focus", onFocus);
            this.#host.addEventListener("blur", onBlur);
            this.#host.addEventListener("pagehide", onClose);
            this.#listeners.push(() => {
                this.#host?.removeEventListener("focus", onFocus);
                this.#host?.removeEventListener("blur", onBlur);
                this.#host?.removeEventListener("pagehide", onClose);
            });
        }
        this.#running = this.#shouldRun();
    }
    /** True while the game should be simulating. */
    get running() {
        return this.#running;
    }
    get focused() {
        return this.#focused;
    }
    get visible() {
        return this.#visibility?.visibilityState !== "hidden";
    }
    /** Pauses regardless of visibility — a pause menu, a lost connection. */
    pause() {
        if (!this.#running)
            return;
        this.#running = false;
        this.paused.emit();
    }
    /** Resumes, unless the page is hidden and `runWhileHidden` is off. */
    resume() {
        if (this.#running || !this.#shouldRun())
            return;
        this.#running = true;
        this.resumed.emit();
    }
    dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        for (const remove of this.#listeners)
            remove();
        this.#listeners.length = 0;
    }
    #setFocused(focused) {
        if (this.#focused === focused)
            return;
        this.#focused = focused;
        this.focusChanged.emit(focused);
    }
    #shouldRun() {
        return this.#runWhileHidden || this.visible;
    }
    #evaluate() {
        if (this.#shouldRun())
            this.resume();
        else
            this.pause();
    }
}
/**
 * Copies text, reporting failure rather than throwing an opaque DOM error.
 *
 * Clipboard access is gated on a user gesture and on permission, and both
 * refusals surface as rejected promises with unhelpful messages, so the result
 * is returned as data.
 */
export async function copyText(text, clipboard) {
    const target = clipboard ?? globalThis.navigator?.clipboard;
    if (!target)
        return { ok: false, reason: "This environment has no clipboard API." };
    try {
        await target.writeText(text);
        return { ok: true };
    }
    catch (error) {
        return { ok: false, reason: `The browser refused clipboard access: ${messageOf(error)}. Copying must happen during a user gesture.` };
    }
}
export async function readText(clipboard) {
    const target = clipboard ?? globalThis.navigator?.clipboard;
    if (!target)
        return { ok: false, reason: "This environment has no clipboard API." };
    try {
        return { ok: true, text: await target.readText() };
    }
    catch (error) {
        return { ok: false, reason: `The browser refused clipboard access: ${messageOf(error)}.` };
    }
}
/**
 * Captures a canvas as an image blob.
 *
 * A WebGPU canvas only retains its contents when configured with
 * `preserveDrawingBuffer`-equivalent behaviour, so capture immediately after
 * rendering and before the next frame begins. A blank result almost always
 * means the capture happened a frame too late.
 */
export async function captureScreenshot(canvas, options = {}) {
    const quality = options.quality;
    if (quality !== undefined && (quality < 0 || quality > 1)) {
        throw new Error("Screenshot quality must lie in [0, 1].");
    }
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob)
                resolve(blob);
            else
                reject(new Error("The canvas produced no image. Capture immediately after rendering, before the next frame clears it."));
        }, options.type ?? "image/png", quality);
    });
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=application.js.map