import { FrameBuilder } from "./frame-builder.js";
import { AudioEngine } from "../audio/audio.js";
import { InputSystem, type InputActionDefinition } from "../input/input.js";
import type { ScenePhysicsRuntime } from "../physics/scene-physics.js";
import {
  WebGpuRenderHost,
  type MaterialUpload,
  type MeshUpload,
  type RenderHost,
  type RenderStats,
  type TextureUpload,
} from "../render/host/index.js";

export interface GameTime {
  /** Seconds since the previous frame, clamped so a background tab does not
   * resume with a huge step that tunnels every moving object through walls. */
  readonly deltaSeconds: number;
  /** Seconds since `start`, excluding paused time. */
  readonly elapsedSeconds: number;
  /** Frames rendered since `start`. */
  readonly frame: number;
  /** Fixed steps taken this frame. */
  readonly fixedSteps: number;
}

/** What a game is handed every frame. */
export interface GameContext {
  readonly canvas: HTMLCanvasElement;
  readonly input: InputSystem;
  /** Engine audio mixer. Undefined only in headless environments or when
   * explicitly disabled in runtime options. */
  readonly audio: AudioEngine | undefined;
  /** Engine-owned scene physics service when a serialized scene is running. */
  readonly physics: ScenePhysicsRuntime | undefined;
  readonly time: GameTime;
  /** Record this frame's draws, camera, and light here. */
  readonly frame: FrameBuilder;
  /** Screen-space/overlay render layer drawn after `frame`. Give it an
   * orthographic camera; colour and depth from the world are preserved. */
  readonly overlay: FrameBuilder;
  /** Statistics from the previous frame; undefined before the first. */
  readonly stats: RenderStats | undefined;
  /** Uploads or replaces runtime geometry under `id`. */
  uploadMesh(id: string, mesh: MeshUpload): void;
  releaseMesh(id: string): boolean;
  /** Uploads or replaces procedural/imported RGBA8 texture pixels. */
  uploadTexture(id: string, texture: TextureUpload): void;
  releaseTexture(id: string): boolean;
  /** Defines or replaces a standard PBR material asset. */
  defineMaterial(id: string, material: MaterialUpload): void;
  releaseMaterial(id: string): boolean;
  /** Viewport size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Requests pointer lock, the usual first-person capture. Resolves false
   * when the browser refuses — commonly outside a user gesture. */
  lockPointer(): Promise<boolean>;
  readonly pointerLocked: boolean;
  /** Stops the loop from inside the game. */
  quit(): void;
}

/**
 * A game's lifecycle. Every hook is optional; a game that only draws needs
 * `update`.
 */
export interface GameHooks {
  /** Runs once, after the GPU is ready and before the first frame. Load and
   * upload here; the loop does not start until the returned promise settles. */
  start?(game: GameContext): void | Promise<void>;
  /** Runs at a fixed rate, zero or more times per frame. Simulation that must
   * be deterministic and frame-rate independent — physics, movement — belongs
   * here. */
  fixedUpdate?(game: GameContext, fixedDeltaSeconds: number): void;
  /** Runs once per frame. Record draws, camera, and light here. */
  update?(game: GameContext, deltaSeconds: number): void;
  /** Runs after every script's update and before the frame is submitted. */
  lateUpdate?(game: GameContext, deltaSeconds: number): void;
  /** Runs when the loop stops, including on error. Release resources here. */
  stop?(game: GameContext): void;
}

export interface GameScriptModule extends GameHooks {
  /** Optional editor hot-reload state. Return structured-cloneable data when
   * scripts must preserve authored runtime state across module replacement. */
  captureState?(game: GameContext): unknown;
  restoreState?(game: GameContext, state: unknown): void | Promise<void>;
  collisionEnter?(game: GameContext, selfEntityId: string, otherEntityId: string): void;
  collisionExit?(game: GameContext, selfEntityId: string, otherEntityId: string): void;
  triggerEnter?(game: GameContext, selfEntityId: string, otherEntityId: string): void;
  triggerExit?(game: GameContext, selfEntityId: string, otherEntityId: string): void;
}

export interface GameScriptRegistration {
  /** Stable diagnostic/hot-reload identity. */
  readonly id: string;
  readonly module: GameScriptModule;
  /** Lower orders run first. Ties are resolved by ID for reproducible builds. */
  readonly order?: number;
}

export interface GameRuntimeOptions {
  /** Input actions available through `context.input`. */
  readonly actions?: readonly InputActionDefinition[];
  /** Fixed-update rate. Defaults to 60 Hz. */
  readonly fixedHz?: number;
  /** Largest frame step passed to `update`, in seconds. Defaults to 0.1: a
   * tab restored after a minute must not advance the world by a minute. */
  readonly maxDeltaSeconds?: number;
  /** Overrides the WebAssembly module URL; mainly for tests. */
  readonly moduleUrl?: string;
  /** Injects a host, so the loop can be tested without a GPU. */
  readonly host?: RenderHost;
  /** Called when a frame throws. The loop stops either way; this reports it. */
  readonly onError?: (error: unknown) => void;
  /** Inject a mixer, pass false to disable audio, or omit for an engine-owned
   * browser mixer. */
  readonly audio?: AudioEngine | false;
  /** VS and TypeScript ESM modules share this exact registration path. */
  readonly scripts?: readonly GameScriptRegistration[];
  /** Optional serialized-scene physics binding. Both VS and TypeScript see it
   * through `game.physics`; the runtime advances it at the fixed rate. */
  readonly scenePhysics?: ScenePhysicsRuntime;
}

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
  readonly #canvas: HTMLCanvasElement;
  readonly #hooks: GameHooks;
  readonly #host: RenderHost;
  readonly #ownsHost: boolean;
  readonly #input: InputSystem;
  readonly #audio: AudioEngine | undefined;
  readonly #ownsAudio: boolean;
  readonly #frame = new FrameBuilder();
  readonly #overlay = new FrameBuilder(64);
  readonly #fixedDelta: number;
  readonly #maxDelta: number;
  readonly #onError: ((error: unknown) => void) | undefined;
  readonly #scripts = new Map<string, { module: GameScriptModule; order: number; started: boolean }>();
  readonly #scenePhysics: ScenePhysicsRuntime | undefined;

  #running = false;
  #animationFrame = 0;
  #lastFrameMs = 0;
  #accumulator = 0;
  #elapsed = 0;
  #frameIndex = 0;
  #fixedSteps = 0;
  #deltaSeconds = 0;
  #stats: RenderStats | undefined;
  #context: GameContext | undefined;
  #detachAudioUnlock: (() => void) | undefined;

  constructor(canvas: HTMLCanvasElement, hooks: GameHooks, options: GameRuntimeOptions = {}) {
    super();
    const fixedHz = options.fixedHz ?? 60;
    if (!(fixedHz > 0) || !Number.isFinite(fixedHz)) throw new Error("fixedHz must be a positive number.");
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
    for (const script of options.scripts ?? []) this.#registerScript(script);
  }

  get running(): boolean {
    return this.#running;
  }

  get host(): RenderHost {
    return this.#host;
  }

  get stats(): RenderStats | undefined {
    return this.#stats;
  }

  /** Runtime-owned mixer, exposed so fullscreen/XR entry gestures can unlock
   * browser audio before the next game frame. */
  get audio(): AudioEngine | undefined { return this.#audio; }

  get scriptIds(): readonly string[] { return Object.freeze(this.#orderedScripts().map(([id]) => id)); }

  /** Registers a module before start. Runtime hot replacement is provided by
   * `replaceScript`, which preserves ordering and runs stop/start boundaries. */
  addScript(registration: GameScriptRegistration): void {
    if (this.#running) throw new Error("Use replaceScript for a running GameRuntime; addScript is a pre-start operation.");
    this.#registerScript(registration);
  }

  /** Atomically replaces a VS or TypeScript module. If restoration/startup of
   * the replacement fails, the previous module is restored and restarted. */
  async replaceScript(id: string, module: GameScriptModule): Promise<void> {
    const entry = this.#scripts.get(id);
    if (entry === undefined) throw new Error(`Cannot replace unknown game script '${id}'.`);
    const context = this.#context;
    if (!this.#running || context === undefined) { entry.module = module; entry.started = false; return; }
    let state: unknown;
    state = await this.#invokeScriptValue(id, "captureState", () => entry.module.captureState?.(context));
    const previous = entry.module;
    await this.#invokeScript(id, "stop", () => previous.stop?.(context));
    entry.started = false;
    entry.module = module;
    try {
      await this.#invokeScript(id, "restoreState", () => module.restoreState?.(context, state));
      await this.#invokeScript(id, "start", () => module.start?.(context));
      entry.started = true;
    } catch (replacementError) {
      entry.module = previous;
      try {
        await this.#invokeScript(id, "restoreState rollback", () => previous.restoreState?.(context, state));
        await this.#invokeScript(id, "start rollback", () => previous.start?.(context));
        entry.started = true;
      } catch (rollbackError) {
        throw new AggregateError([replacementError, rollbackError], `Game script '${id}' replacement and rollback both failed.`);
      }
      throw replacementError;
    }
  }

  /** Initializes the GPU, runs `start`, then begins the loop. */
  async start(): Promise<void> {
    if (this.#running) return;
    if (!this.#host.initialized) await this.#host.initialize();
    // A runtime driven from a test or a worker has no window to listen on;
    // input is simply inert there rather than the whole loop failing.
    if (typeof window !== "undefined") {
      this.#input.attach(window);
      this.#armAudioUnlock(window);
    }
    this.#context = this.#createContext();
    await this.#hooks.start?.(this.#context);
    for (const [id, script] of this.#orderedScripts()) {
      await this.#invokeScript(id, "start", () => script.module.start?.(this.#context!));
      script.started = true;
    }
    this.#running = true;
    this.#lastFrameMs = performance.now();
    this.#accumulator = 0;
    this.#animationFrame = requestAnimationFrame(this.#tick);
  }

  /** Stops the loop and runs `stop`. Safe to call more than once. */
  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#animationFrame !== 0) cancelAnimationFrame(this.#animationFrame);
    this.#animationFrame = 0;
    this.#input.detach();
    this.#detachAudioUnlock?.();
    this.#detachAudioUnlock = undefined;
    try {
      if (this.#context !== undefined) this.#hooks.stop?.(this.#context);
      if (this.#context !== undefined) for (const [id, script] of this.#orderedScripts().reverse()) {
        if (script.started) this.#invokeScriptSync(id, "stop", () => script.module.stop?.(this.#context!));
        script.started = false;
      }
    } catch (error) {
      this.#report(error);
    }
    this.dispatchEvent(new Event("stopped"));
  }

  /** Stops the loop and releases the renderer if this runtime created it. */
  destroy(): void {
    this.stop();
    this.#scenePhysics?.destroy();
    if (this.#ownsAudio && this.#audio !== undefined) void this.#audio.close();
    if (this.#ownsHost) this.#host.destroy();
  }

  /** Advances one frame. Exposed so tests can step the loop deterministically
   * without a browser animation clock. */
  step(nowMilliseconds: number): void {
    const context = this.#context;
    if (context === undefined) throw new Error("The runtime has not started.");

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
      for (const [id, script] of this.#orderedScripts()) this.#invokeScriptSync(id, "fixedUpdate", () => script.module.fixedUpdate?.(context, this.#fixedDelta));
      for (const contact of this.#scenePhysics?.fixedUpdate(this.#fixedDelta) ?? []) {
        this.#dispatchContact(contact.kind, contact.entityA, contact.entityB);
        this.#dispatchContact(contact.kind, contact.entityB, contact.entityA);
      }
    }

    this.#frame.reset();
    this.#overlay.reset();
    this.#hooks.update?.(context, delta);
    for (const [id, script] of this.#orderedScripts()) this.#invokeScriptSync(id, "update", () => script.module.update?.(context, delta));
    this.#hooks.lateUpdate?.(context, delta);
    for (const [id, script] of this.#orderedScripts()) this.#invokeScriptSync(id, "lateUpdate", () => script.module.lateUpdate?.(context, delta));
    if (this.#overlay.drawCount === 0) this.#host.submitFrame(this.#frame.pack());
    else this.#host.submitLayers([
      { frame: this.#frame.pack(), clearColor: true, clearDepth: true },
      { frame: this.#overlay.pack(), clearColor: false, clearDepth: false },
    ]);
    this.#stats = this.#host.renderFrame(nowMilliseconds);
    this.#frameIndex += 1;
  }

  readonly #tick = (now: number): void => {
    if (!this.#running) return;
    try {
      this.step(now);
    } catch (error) {
      this.#report(error);
      this.stop();
      return;
    }
    if (this.#running) this.#animationFrame = requestAnimationFrame(this.#tick);
  };

  collisionEnter(selfEntityId: string, otherEntityId: string): void { this.#dispatchContact("collisionEnter", selfEntityId, otherEntityId); }
  collisionExit(selfEntityId: string, otherEntityId: string): void { this.#dispatchContact("collisionExit", selfEntityId, otherEntityId); }
  triggerEnter(selfEntityId: string, otherEntityId: string): void { this.#dispatchContact("triggerEnter", selfEntityId, otherEntityId); }
  triggerExit(selfEntityId: string, otherEntityId: string): void { this.#dispatchContact("triggerExit", selfEntityId, otherEntityId); }

  #dispatchContact(phase: "collisionEnter" | "collisionExit" | "triggerEnter" | "triggerExit", selfId: string, otherId: string): void {
    const context = this.#context;
    if (context === undefined) throw new Error(`Cannot dispatch ${phase} before GameRuntime starts.`);
    for (const [id, script] of this.#orderedScripts()) this.#invokeScriptSync(id, phase, () => script.module[phase]?.(context, selfId, otherId));
  }

  #registerScript(registration: GameScriptRegistration): void {
    const id = registration.id.trim();
    if (id === "") throw new Error("Game script IDs cannot be empty.");
    if (this.#scripts.has(id)) throw new Error(`Duplicate game script ID '${id}'.`);
    const order = registration.order ?? 0;
    if (!Number.isFinite(order)) throw new Error(`Game script '${id}' order must be finite.`);
    this.#scripts.set(id, { module: registration.module, order, started: false });
  }

  #orderedScripts(): [string, { module: GameScriptModule; order: number; started: boolean }][] {
    return [...this.#scripts.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]));
  }

  async #invokeScript(id: string, phase: string, callback: () => void | Promise<void>): Promise<void> {
    try { await callback(); } catch (error) { throw new Error(`Game script '${id}' failed during ${phase}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }

  async #invokeScriptValue<T>(id: string, phase: string, callback: () => T | Promise<T>): Promise<T> {
    try { return await callback(); } catch (error) { throw new Error(`Game script '${id}' failed during ${phase}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }

  #invokeScriptSync(id: string, phase: string, callback: () => void): void {
    try { callback(); } catch (error) { throw new Error(`Game script '${id}' failed during ${phase}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }

  #createContext(): GameContext {
    const runtime = this;
    const time: GameTime = {
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
        } catch {
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

  #report(error: unknown): void {
    if (this.#onError !== undefined) this.#onError(error);
    else console.error("Vapour game loop error:", error);
    this.dispatchEvent(new CustomEvent("error", { detail: error }));
  }

  #armAudioUnlock(target: Window): void {
    if (this.#audio === undefined || this.#audio.state === "running") return;
    const unlock = (): void => {
      void this.#audio!.unlock().then(() => {
        this.#detachAudioUnlock?.();
        this.#detachAudioUnlock = undefined;
      }).catch((error: unknown) => this.#report(error));
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
