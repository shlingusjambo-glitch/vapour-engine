import { FrameBuilder } from "./frame-builder.js";
import { AudioEngine } from "../audio/audio.js";
import { InputSystem, type InputActionDefinition } from "../input/input.js";
import type { ScenePhysicsRuntime } from "../physics/scene-physics.js";
import { type MaterialUpload, type MeshUpload, type RenderHost, type RenderStats, type TextureUpload } from "../render/host/index.js";
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
    /** Runs immediately after the GPU frame is submitted. Canvas capture and
     * frame-dependent telemetry belong here, while the presented image is live. */
    afterRender?(game: GameContext, stats: RenderStats): void;
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
export declare class GameRuntime extends EventTarget {
    #private;
    constructor(canvas: HTMLCanvasElement, hooks: GameHooks, options?: GameRuntimeOptions);
    get running(): boolean;
    get host(): RenderHost;
    get stats(): RenderStats | undefined;
    /** Runtime-owned mixer, exposed so fullscreen/XR entry gestures can unlock
     * browser audio before the next game frame. */
    get audio(): AudioEngine | undefined;
    get scriptIds(): readonly string[];
    /** Registers a module before start. Runtime hot replacement is provided by
     * `replaceScript`, which preserves ordering and runs stop/start boundaries. */
    addScript(registration: GameScriptRegistration): void;
    /** Atomically replaces a VS or TypeScript module. If restoration/startup of
     * the replacement fails, the previous module is restored and restarted. */
    replaceScript(id: string, module: GameScriptModule): Promise<void>;
    /** Initializes the GPU, runs `start`, then begins the loop. */
    start(): Promise<void>;
    /** Stops the loop and runs `stop`. Safe to call more than once. */
    stop(): void;
    /** Stops the loop and releases the renderer if this runtime created it. */
    destroy(): void;
    /** Advances one frame. Exposed so tests can step the loop deterministically
     * without a browser animation clock. */
    step(nowMilliseconds: number): void;
    collisionEnter(selfEntityId: string, otherEntityId: string): void;
    collisionExit(selfEntityId: string, otherEntityId: string): void;
    triggerEnter(selfEntityId: string, otherEntityId: string): void;
    triggerExit(selfEntityId: string, otherEntityId: string): void;
}
//# sourceMappingURL=game-runtime.d.ts.map