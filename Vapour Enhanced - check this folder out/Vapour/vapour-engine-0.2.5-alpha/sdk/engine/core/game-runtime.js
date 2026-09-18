import { FrameBuilder } from "./frame-builder.js";
import { AudioEngine } from "../audio/audio.js";
import { InputSystem } from "../input/input.js";
import { WebGpuRenderHost, } from "../render/host/index.js";
/**
 * Runs a game against the WebGPU renderer.
 *
 * The runtime owns the loop so that simulation always happens before the frame
 * it produces is submitted, and it deliberately does **not** go through the
 * editor's scene document: a game builds its frame directly through
 * [`FrameBuilder`], which is the only path fast enough for a world that streams
 * geometry.
 *
 * Timing uses a fixed-step accumulator. `fixedUpdate` runs a whole number of
 * times per frame at a constant rate, so physics is reproducible and does not
 * change behaviour with frame rate, while `update` sees the real elapsed time
 * for rendering and input.
 */
export class GameRuntime extends EventTarget {
    #canvas;
    #hooks;
    #host;
    #ownsHost;
    #input;
    #audio;
    #ownsAudio;
    #frame = new FrameBuilder();
    #overlay = new FrameBuilder(64);
    #fixedDelta;
    #maxDelta;
    #onError;
    #scripts = new Map();
    #scenePhysics;
    #running = false;
    #animationFrame = 0;
    #lastFrameMs = 0;
    #accumulator = 0;
    #elapsed = 0;
    #frameIndex = 0;
    #fixedSteps = 0;
    #deltaSeconds = 0;
    #stats;
    #context;
    #detachAudioUnlock;
    constructor(canvas, hooks, options = {}) {
        super();
        const fixedHz = options.fixedHz ?? 60;
        if (!(fixedHz > 0) || !Number.isFinite(fixedHz))
            throw new Error("fixedHz must be a positive number.");
        this.#canvas = canvas;
        this.#hooks = hooks;
        this.#fixedDelta = 1 / fixedHz;
        this.#maxDelta = options.maxDeltaSeconds ?? 0.1;
        this.#onError = options.onError;
        this.#scenePhysics = options.scenePhysics;
        this.#input = new InputSystem(options.actions ?? []);
        this.#ownsAudio = options.audio === undefined && typeof globalThis.AudioContext !== "undefined";
        this.#audio = options.audio === false
            ? undefined
            : options.audio ?? (this.#ownsAudio ? new AudioEngine() : undefined);
        this.#ownsHost = options.host === undefined;
        this.#host = options.host ?? new WebGpuRenderHost(canvas, options.moduleUrl === undefined ? {} : { moduleUrl: options.moduleUrl });
        for (const script of options.scripts ?? [])
            this.#registerScript(script);
    }
    get running() {
        return this.#running;
    }
    get host() {
        return this.#host;
    }
    get stats() {
        return this.#stats;
    }
    /** Runtime-owned mixer, exposed so fullscreen/XR entry gestures can unlock
     * browser audio before the next game frame. */
    get audio() { return this.#audio; }
    get scriptIds() { return Object.freeze(this.#orderedScripts().map(([id]) => id)); }
    /** Registers a module before start. Runtime hot replacement is provided by
     * `replaceScript`, which preserves ordering and runs stop/start boundaries. */
    addScript(registration) {
        if (this.#running)
            throw new Error("Use replaceScript for a running GameRuntime; addScript is a pre-start operation.");
        this.#registerScript(registration);
    }
    /** Atomically replaces a VS or TypeScript module. If restoration/startup of
     * the replacement fails, the previous module is restored and restarted. */
    async replaceScript(id, module) {
        const entry = this.#scripts.get(id);
        if (entry === undefined)
            throw new Error(`Cannot replace unknown game script '${id}'.`);
        const context = this.#context;
        if (!this.#running || context === undefined) {
            entry.module = module;
            entry.started = false;
            return;
        }
        let state;
        state = await this.#invokeScriptValue(id, "captureState", () => entry.module.captureState?.(context));
        const previous = entry.module;
        await this.#invokeScript(id, "stop", () => previous.stop?.(context));
        entry.started = false;
        entry.module = module;
        try {
            await this.#invokeScript(id, "restoreState", () => module.restoreState?.(context, state));
            await this.#invokeScript(id, "start", () => module.start?.(context));
            entry.started = true;
        }
        catch (replacementError) {
            entry.module = previous;
            try {
                await this.#invokeScript(id, "restoreState rollback", () => previous.restoreState?.(context, state));
                await this.#invokeScript(id, "start rollback", () => previous.start?.(context));
                entry.started = true;
            }
            catch (rollbackError) {
                throw new AggregateError([replacementError, rollbackError], `Game script '${id}' replacement and rollback both failed.`);
            }
            throw replacementError;
        }
    }
    /** Initializes the GPU, runs `start`, then begins the loop. */
    async start() {
        if (this.#running)
            return;
        if (!this.#host.initialized)
            await this.#host.initialize();
        // A runtime driven from a test or a worker has no window to listen on;
        // input is simply inert there rather than the whole loop failing.
        if (typeof window !== "undefined") {
            this.#input.attach(window);
            this.#armAudioUnlock(window);
        }
        this.#context = this.#createContext();
        await this.#hooks.start?.(this.#context);
        for (const [id, script] of this.#orderedScripts()) {
            await this.#invokeScript(id, "start", () => script.module.start?.(this.#context));
            script.started = true;
        }
        this.#running = true;
        this.#lastFrameMs = performance.now();
        this.#accumulator = 0;
        this.#animationFrame = requestAnimationFrame(this.#tick);
    }
    /** Stops the loop and runs `stop`. Safe to call more than once. */
    stop() {
        if (!this.#running)
            return;
        this.#running = false;
        if (this.#animationFrame !== 0)
            cancelAnimationFrame(this.#animationFrame);
        this.#animationFrame = 0;
        this.#input.detach();
        this.#detachAudioUnlock?.();
        this.#detachAudioUnlock = undefined;
        try {
            if (this.#context !== undefined)
                this.#hooks.stop?.(this.#context);
            if (this.#context !== undefined)
                for (const [id, script] of this.#orderedScripts().reverse()) {
                    if (script.started)
                        this.#invokeScriptSync(id, "stop", () => script.module.stop?.(this.#context));
                    script.started = false;
                }
        }
        catch (error) {
            this.#report(error);
        }
        this.dispatchEvent(new Event("stopped"));
    }
    /** Stops the loop and releases the renderer if this runtime created it. */
    destroy() {
        this.stop();
        this.#scenePhysics?.destroy();
        if (this.#ownsAudio && this.#audio !== undefined)
            void this.#audio.close();
        if (this.#ownsHost)
            this.#host.destroy();
    }
    /** Advances one frame. Exposed so tests can step the loop deterministically
     * without a browser animation clock. */
    step(nowMilliseconds) {
        const context = this.#context;
        if (context === undefined)
            throw new Error("The runtime has not started.");
        const rawDelta = (nowMilliseconds - this.#lastFrameMs) / 1000;
        this.#lastFrameMs = nowMilliseconds;
        const delta = Math.min(Math.max(rawDelta, 0), this.#maxDelta);
        this.#deltaSeconds = delta;
        this.#elapsed += delta;
        const gamepads = typeof navigator !== "undefined" && typeof navigator.getGamepads === "function"
            ? navigator.getGamepads()
            : [];
        this.#input.update(gamepads);
        // Fixed steps are capped so a long stall cannot spiral: catching up on a
        // hundred steps would take longer than the frame that follows, stalling
        // further. Dropping the surplus keeps the loop responsive.
        this.#accumulator = Math.min(this.#accumulator + delta, this.#fixedDelta * 8);
        this.#fixedSteps = 0;
        while (this.#accumulator >= this.#fixedDelta) {
            this.#accumulator -= this.#fixedDelta;
            this.#fixedSteps += 1;
            this.#scenePhysics?.prepare();
            this.#hooks.fixedUpdate?.(context, this.#fixedDelta);
            for (const [id, script] of this.#orderedScripts())
                this.#invokeScriptSync(id, "fixedUpdate", () => script.module.fixedUpdate?.(context, this.#fixedDelta));
            for (const contact of this.#scenePhysics?.fixedUpdate(this.#fixedDelta) ?? []) {
                this.#dispatchContact(contact.kind, contact.entityA, contact.entityB);
                this.#dispatchContact(contact.kind, contact.entityB, contact.entityA);
            }
        }
        this.#frame.reset();
        this.#overlay.reset();
        this.#hooks.update?.(context, delta);
        for (const [id, script] of this.#orderedScripts())
            this.#invokeScriptSync(id, "update", () => script.module.update?.(context, delta));
        this.#hooks.lateUpdate?.(context, delta);
        for (const [id, script] of this.#orderedScripts())
            this.#invokeScriptSync(id, "lateUpdate", () => script.module.lateUpdate?.(context, delta));
        if (this.#overlay.drawCount === 0)
            this.#host.submitFrame(this.#frame.pack());
        else
            this.#host.submitLayers([
                { frame: this.#frame.pack(), clearColor: true, clearDepth: true },
                { frame: this.#overlay.pack(), clearColor: false, clearDepth: false },
            ]);
        const rendered = this.#host.renderFrame(nowMilliseconds);
        this.#stats = rendered;
        if (rendered !== undefined) {
            this.#hooks.afterRender?.(context, rendered);
            for (const [id, script] of this.#orderedScripts())
                this.#invokeScriptSync(id, "afterRender", () => script.module.afterRender?.(context, rendered));
        }
        this.#frameIndex += 1;
    }
    #tick = (now) => {
        if (!this.#running)
            return;
        try {
            this.step(now);
        }
        catch (error) {
            this.#report(error);
            this.stop();
            return;
        }
        if (this.#running)
            this.#animationFrame = requestAnimationFrame(this.#tick);
    };
    collisionEnter(selfEntityId, otherEntityId) { this.#dispatchContact("collisionEnter", selfEntityId, otherEntityId); }
    collisionExit(selfEntityId, otherEntityId) { this.#dispatchContact("collisionExit", selfEntityId, otherEntityId); }
    triggerEnter(selfEntityId, otherEntityId) { this.#dispatchContact("triggerEnter", selfEntityId, otherEntityId); }
    triggerExit(selfEntityId, otherEntityId) { this.#dispatchContact("triggerExit", selfEntityId, otherEntityId); }
    #dispatchContact(phase, selfId, otherId) {
        const context = this.#context;
        if (context === undefined)
            throw new Error(`Cannot dispatch ${phase} before GameRuntime starts.`);
        for (const [id, script] of this.#orderedScripts())
            this.#invokeScriptSync(id, phase, () => script.module[phase]?.(context, selfId, otherId));
    }
    #registerScript(registration) {
        const id = registration.id.trim();
        if (id === "")
            throw new Error("Game script IDs cannot be empty.");
        if (this.#scripts.has(id))
            throw new Error(`Duplicate game script ID '${id}'.`);
        const order = registration.order ?? 0;
        if (!Number.isFinite(order))
            throw new Error(`Game script '${id}' order must be finite.`);
        this.#scripts.set(id, { module: registration.module, order, started: false });
    }
    #orderedScripts() {
        return [...this.#scripts.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]));
    }
    async #invokeScript(id, phase, callback) {
        try {
            await callback();
        }
        catch (error) {
            throw new Error(`Game script '${id}' failed during ${phase}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
    }
    async #invokeScriptValue(id, phase, callback) {
        try {
            return await callback();
        }
        catch (error) {
            throw new Error(`Game script '${id}' failed during ${phase}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
    }
    #invokeScriptSync(id, phase, callback) {
        try {
            callback();
        }
        catch (error) {
            throw new Error(`Game script '${id}' failed during ${phase}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
    }
    #createContext() {
        const runtime = this;
        const time = {
            get deltaSeconds() {
                return runtime.#deltaSeconds;
            },
            get elapsedSeconds() {
                return runtime.#elapsed;
            },
            get frame() {
                return runtime.#frameIndex;
            },
            get fixedSteps() {
                return runtime.#fixedSteps;
            },
        };
        return {
            canvas: this.#canvas,
            input: this.#input,
            audio: this.#audio,
            physics: this.#scenePhysics,
            time,
            frame: this.#frame,
            overlay: this.#overlay,
            get stats() {
                return runtime.#stats;
            },
            uploadMesh: (id, mesh) => {
                this.#host.uploadMesh(id, mesh);
            },
            releaseMesh: (id) => this.#host.releaseMesh(id),
            uploadTexture: (id, texture) => this.#host.uploadTexture(id, texture),
            releaseTexture: (id) => this.#host.releaseTexture(id),
            defineMaterial: (id, material) => this.#host.defineMaterial(id, material),
            releaseMaterial: (id) => this.#host.releaseMaterial(id),
            get width() {
                return runtime.#canvas.clientWidth;
            },
            get height() {
                return runtime.#canvas.clientHeight;
            },
            lockPointer: async () => {
                try {
                    await this.#canvas.requestPointerLock();
                    return typeof document !== "undefined" && document.pointerLockElement === this.#canvas;
                }
                catch {
                    // Browsers refuse outside a user gesture, and after an unlock they
                    // impose a short cooldown. Neither is an error worth throwing over.
                    return false;
                }
            },
            get pointerLocked() {
                return typeof document !== "undefined" && document.pointerLockElement === runtime.#canvas;
            },
            quit: () => this.stop(),
        };
    }
    #report(error) {
        if (this.#onError !== undefined)
            this.#onError(error);
        else
            console.error("Vapour game loop error:", error);
        this.dispatchEvent(new CustomEvent("error", { detail: error }));
    }
    #armAudioUnlock(target) {
        if (this.#audio === undefined || this.#audio.state === "running")
            return;
        const unlock = () => {
            void this.#audio.unlock().then(() => {
                this.#detachAudioUnlock?.();
                this.#detachAudioUnlock = undefined;
            }).catch((error) => this.#report(error));
        };
        target.addEventListener("pointerdown", unlock, { passive: true });
        target.addEventListener("keydown", unlock, { passive: true });
        target.addEventListener("touchstart", unlock, { passive: true });
        this.#detachAudioUnlock = () => {
            target.removeEventListener("pointerdown", unlock);
            target.removeEventListener("keydown", unlock);
            target.removeEventListener("touchstart", unlock);
        };
    }
}
//# sourceMappingURL=game-runtime.js.map