/** The WebGPU render host.
 *
 * Owns the lifecycle of the Rust renderer instance: module loading, canvas
 * surface configuration, resource upload, frame submission, and teardown.
 */
import type { MaterialUpload, MeshUpload, TextureUpload } from "./uploads.js";
import { validateMaterialUpload, validateTextureUpload } from "./uploads.js";
import type {
  PackedFrame,
  PostProcessSettings,
  RenderHost,
  RenderStats,
} from "./frame.js";
import type {
  RustRenderer,
  RustRendererConstructor,
  VapourWasmModule,
  WasmModuleLoader,
  RustRenderCapabilities,
  RustFrameStats,
} from "./wasm-contract.js";
import { defaultModuleLoader } from "./wasm-contract.js";

/** Browser presentation host for Vapour's Rust renderer. The DOM owns sizing
 * and animation scheduling; WebGPU objects, shaders, resources, and command
 * encoding remain inside the WASM runtime. */
export class WebGpuRenderHost extends EventTarget implements RenderHost {
  readonly #canvas: HTMLCanvasElement;
  readonly #moduleUrl: string;
  readonly #loadModule: WasmModuleLoader;
  readonly #initializationTimeoutMs: number;
  #renderer: RustRenderer | undefined;
  #observer: ResizeObserver | undefined;
  #animationFrame = 0;
  #lastFrame = 0;
  #smoothedDelta = 1 / 60;
  #destroyed = false;
  #renderWorldJson: string | undefined;
  #snapshot: RenderWorldSnapshot | undefined;
  #viewer: RenderCameraSnapshot | undefined;
  #poisoned = false;
  /** Uploads are replayed if the renderer is rebuilt, so a game never has to
   * notice that a device was lost and re-created. */
  readonly #meshes = new Map<string, MeshUpload>();
  readonly #textures = new Map<string, TextureUpload>();
  readonly #materials = new Map<string, MaterialUpload>();
  #postProcess: PostProcessSettings = { exposure: 1, toneMapping: "aces" };

  constructor(
    canvas: HTMLCanvasElement,
    options: {
      readonly moduleUrl?: string;
      readonly loadModule?: WasmModuleLoader;
      /** Upper bound for browser adapter/device creation. Some browser/driver
       * combinations expose `navigator.gpu` but never settle the request. */
      readonly initializationTimeoutMs?: number;
    } = {},
  ) {
    super();
    this.#canvas = canvas;
    this.#moduleUrl = options.moduleUrl ?? "/vapour_runtime.js";
    this.#loadModule = options.loadModule ?? defaultModuleLoader;
    this.#initializationTimeoutMs = options.initializationTimeoutMs ?? 15_000;
    if (
      !Number.isFinite(this.#initializationTimeoutMs) ||
      this.#initializationTimeoutMs <= 0
    ) {
      throw new Error(
        "WebGPU initialization timeout must be a positive number of milliseconds.",
      );
    }
  }

  async initialize(): Promise<void> {
    if (this.#destroyed)
      throw new Error("Cannot initialize a destroyed render host.");
    if (this.#poisoned)
      throw new Error(
        "This render host failed and cannot be reinitialized; create a new one.",
      );
    if (this.#renderer !== undefined) return;
    if (navigator.gpu === undefined) {
      throw new Error(
        "WebGPU is unavailable. Update your browser or graphics drivers.",
      );
    }
    this.#resizeCanvas();
    let module: VapourWasmModule;
    try {
      module = await this.#loadModule(this.#moduleUrl);
      await module.default();
    } catch (error) {
      throw new Error(
        `Vapour's Rust WebAssembly renderer could not load: ${messageOf(error)}`,
        { cause: error },
      );
    }
    try {
      this.#renderer = await settleWithin(
        module.WebGpuRenderer.create(
          this.#canvas,
          this.#canvas.width,
          this.#canvas.height,
        ),
        this.#initializationTimeoutMs,
        `WebGPU adapter/device creation did not finish within ${String(this.#initializationTimeoutMs)} ms. Check browser WebGPU support, GPU drivers, and hardware acceleration.`,
      );
    } catch (error) {
      throw new Error(
        `Vapour's Rust WebGPU renderer could not initialize: ${messageOf(error)}`,
        { cause: error },
      );
    }
    try {
      // Dependency order matters: materials may reference textures and frames
      // may reference both materials and meshes.
      for (const [id, texture] of this.#textures)
        this.#submitTexture(id, texture);
      for (const [id, material] of this.#materials)
        this.#submitMaterial(id, material);
      for (const [id, mesh] of this.#meshes) this.#submitMesh(id, mesh);
      if (this.#renderWorldJson !== undefined)
        this.#renderer.set_render_world_json(this.#renderWorldJson);
      this.#submitPostProcess();
    } catch (error) {
      this.#renderer.free();
      this.#renderer = undefined;
      throw new Error(
        `Vapour's Rust renderer rejected the authored scene: ${messageOf(error)}`,
        { cause: error },
      );
    }
    this.#observer = new ResizeObserver(() => {
      this.#resizeCanvas();
      this.#renderer?.resize(this.#canvas.width, this.#canvas.height);
    });
    this.#observer.observe(this.#canvas);
    const capabilities = this.capabilities();
    this.dispatchEvent(
      new CustomEvent<RustRenderCapabilities>("capabilities", {
        detail: capabilities,
      }),
    );
  }

  /**
   * Uploads or replaces a runtime mesh under `id`.
   *
   * Safe to call before the renderer initializes: the upload is remembered and
   * replayed once the GPU is ready. Replacing an identifier keeps instances
   * that reference it pointing at the new geometry, which is how a remeshed
   * voxel chunk updates.
   */
  uploadMesh(id: string, mesh: MeshUpload): void {
    if (id.trim() === "")
      throw new Error("A runtime mesh needs a non-empty identifier.");
    if (mesh.positions.length % 3 !== 0) {
      throw new Error(
        `Mesh '${id}' has ${String(mesh.positions.length)} position floats, which is not a whole number of vertices.`,
      );
    }
    if (mesh.indices.length % 3 !== 0) {
      throw new Error(
        `Mesh '${id}' has ${String(mesh.indices.length)} indices, which is not a whole number of triangles.`,
      );
    }
    const vertexCount = mesh.positions.length / 3;
    for (const [name, values, components] of [
      ["normals", mesh.normals, 3],
      ["uvs", mesh.uvs, 2],
      ["colors", mesh.colors, 4],
      ["tangents", mesh.tangents, 4],
      ["textureLayers", mesh.textureLayers, 1],
    ] as const) {
      if (values !== undefined && values.length !== vertexCount * components) {
        throw new Error(
          `Mesh '${id}' ${name} length does not match its ${String(vertexCount)} vertices.`,
        );
      }
    }
    this.#meshes.set(id, mesh);
    if (this.#renderer === undefined || this.#poisoned) return;
    this.#submitMesh(id, mesh);
  }

  /** Frees a runtime mesh. Returns whether it was known here. */
  releaseMesh(id: string): boolean {
    const known = this.#meshes.delete(id);
    if (this.#renderer !== undefined && !this.#poisoned) {
      try {
        this.#renderer.release_mesh(id);
      } catch (error) {
        throw new Error(`Releasing mesh '${id}' failed: ${messageOf(error)}`, {
          cause: error,
        });
      }
    }
    return known;
  }

  /** Runtime meshes this host has uploaded, in insertion order. */
  meshIds(): readonly string[] {
    return [...this.#meshes.keys()];
  }

  uploadTexture(id: string, texture: TextureUpload): void {
    validateTextureUpload(id, texture);
    this.#textures.set(id, texture);
    if (this.#renderer !== undefined && !this.#poisoned)
      this.#submitTexture(id, texture);
  }

  releaseTexture(id: string): boolean {
    const known = this.#textures.has(id);
    if (this.#renderer !== undefined && !this.#poisoned) {
      try {
        this.#renderer.release_texture(id);
      } catch (error) {
        throw new Error(
          `Releasing texture '${id}' failed: ${messageOf(error)}`,
          { cause: error },
        );
      }
    }
    this.#textures.delete(id);
    return known;
  }

  defineMaterial(id: string, material: MaterialUpload): void {
    validateMaterialUpload(id, material, (textureId) =>
      this.#textures.has(textureId),
    );
    this.#materials.set(id, material);
    if (this.#renderer !== undefined && !this.#poisoned)
      this.#submitMaterial(id, material);
  }

  releaseMaterial(id: string): boolean {
    const known = this.#materials.has(id);
    if (this.#renderer !== undefined && !this.#poisoned) {
      try {
        this.#renderer.release_material(id);
      } catch (error) {
        throw new Error(
          `Releasing material '${id}' failed: ${messageOf(error)}`,
          { cause: error },
        );
      }
    }
    this.#materials.delete(id);
    return known;
  }

  #submitTexture(id: string, texture: TextureUpload): void {
    try {
      this.#renderer!.upload_texture_rgba8(
        id,
        texture.width,
        texture.height,
        texture.pixels,
        texture.colorSpace !== "linear",
      );
    } catch (error) {
      throw new Error(
        `Vapour's renderer rejected texture '${id}': ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  #submitMaterial(id: string, material: MaterialUpload): void {
    try {
      this.#renderer!.define_material_json(id, JSON.stringify(material));
    } catch (error) {
      throw new Error(
        `Vapour's renderer rejected material '${id}': ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  #submitMesh(id: string, mesh: MeshUpload): void {
    const empty = new Float32Array(0);
    try {
      this.#renderer!.upload_mesh(
        id,
        mesh.positions,
        mesh.normals ?? empty,
        mesh.uvs ?? empty,
        mesh.colors ?? empty,
        mesh.tangents ?? empty,
        mesh.textureLayers ?? empty,
        mesh.indices,
      );
    } catch (error) {
      throw new Error(
        `Vapour's renderer rejected mesh '${id}': ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  capabilities(): RustRenderCapabilities {
    if (this.#renderer === undefined)
      throw new Error("Render host is not initialized.");
    try {
      const capabilities = JSON.parse(
        this.#renderer.capabilities_json(),
      ) as RustRenderCapabilities;
      if (
        typeof capabilities.adapterName !== "string" ||
        typeof capabilities.tier !== "string"
      ) {
        throw new Error("capability data is incomplete");
      }
      return capabilities;
    } catch (error) {
      throw new Error(
        `Rust renderer returned invalid capability data: ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  /** Starts a self-driven animation loop. The editor uses this; a running game
   * drives frames itself so simulation happens before rendering. */
  start(): void {
    if (this.#renderer === undefined)
      throw new Error("Render host is not initialized.");
    if (this.#animationFrame !== 0) return;
    this.#lastFrame = performance.now();
    this.#animationFrame = requestAnimationFrame(this.#render);
  }

  get initialized(): boolean {
    return this.#renderer !== undefined && !this.#poisoned;
  }

  /** Configures final HDR exposure and tone mapping. Safe before initialize. */
  setPostProcess(settings: PostProcessSettings): void {
    if (
      !Number.isFinite(settings.exposure) ||
      settings.exposure < 0 ||
      settings.exposure > 64
    )
      throw new Error("HDR exposure must be finite and in [0, 64].");
    validatePostEffects(settings);
    this.#postProcess = { ...settings };
    if (this.#renderer !== undefined && !this.#poisoned)
      this.#submitPostProcess();
  }

  postProcess(): Readonly<PostProcessSettings> {
    return this.#postProcess;
  }

  #submitPostProcess(): void {
    const mode = { none: 0, reinhard: 1, aces: 2 }[
      this.#postProcess.toneMapping
    ];
    if (mode === undefined)
      throw new Error(
        `Unknown tone mapping mode '${String(this.#postProcess.toneMapping)}'.`,
      );
    if (this.#renderer?.set_post_process === undefined) return;
    const bloom = this.#postProcess.bloom;
    try {
      this.#renderer.set_post_process(
        this.#postProcess.exposure,
        mode,
        bloom?.intensity ?? 0,
        bloom?.threshold ?? 1,
        bloom?.scatter ?? 0.5,
        this.#postProcess.saturation ?? 1,
        this.#postProcess.contrast ?? 1,
        this.#postProcess.vignette ?? 0,
        this.#postProcess.chromaticAberration ?? 0,
      );
    } catch (error) {
      throw new Error(
        `Vapour's HDR post-processing settings were rejected: ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Submits one frame as packed arrays, bypassing the authored-scene path.
   *
   * This is what a running game uses: nothing but the small mesh table is
   * serialized, so a scene of thousands of instances costs a few buffer copies
   * rather than restating every matrix as JSON.
   */
  submitFrame(frame: PackedFrame): void {
    if (this.#renderer === undefined || this.#poisoned) return;
    try {
      this.#renderer.set_render_frame(
        JSON.stringify(frame.meshTable),
        frame.meshIndices,
        JSON.stringify(frame.materialTable),
        frame.materialIndices,
        frame.matrices,
        frame.baseColors,
        frame.materialParams,
        frame.camera,
        frame.light,
        frame.environment ?? EMPTY_FLOAT32,
      );
    } catch (error) {
      throw new Error(
        `Vapour's renderer rejected the frame: ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  /** Submits several camera layers atomically for one acquire/present cycle. */
  submitLayers(layers: readonly RenderLayerSubmission[]): void {
    if (this.#renderer === undefined || this.#poisoned) return;
    const packed = packRenderLayers(layers);
    try {
      this.#renderer.set_render_layers(
        JSON.stringify(packed.meshTable),
        packed.meshIndices,
        JSON.stringify(packed.materialTable),
        packed.materialIndices,
        packed.matrices,
        packed.baseColors,
        packed.materialParams,
        packed.layerInstanceCounts,
        packed.layerFlags,
        packed.cameras,
        packed.lights,
        packed.layerLightCounts,
        packed.environments,
      );
    } catch (error) {
      throw new Error(
        `Vapour's renderer rejected the layered frame: ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Renders one frame under external control and returns its statistics.
   *
   * Returns `undefined` once the renderer has failed, so a game loop can stop
   * cleanly instead of throwing every frame.
   */
  renderFrame(nowMilliseconds: number): RenderStats | undefined {
    const renderer = this.#renderer;
    if (renderer === undefined || this.#destroyed || this.#poisoned)
      return undefined;
    const stats = this.#drawOnce(renderer, nowMilliseconds);
    if (stats === undefined) return undefined;
    this.dispatchEvent(
      new CustomEvent<RenderStats>("stats", { detail: stats }),
    );
    return stats;
  }

  setScene(scene: SceneData): void {
    this.#snapshot = extractRenderWorld(scene);
    this.#submit();
  }

  /** Overrides the snapshot camera with an editor-owned viewpoint.
   *
   * The Scene view navigates with the editor camera while the Game view falls
   * back to the authored `vapour.Camera`, and neither path mutates the other:
   * pass `undefined` to return to the scene's own camera. */
  setViewer(camera: RenderCameraSnapshot | undefined): void {
    this.#viewer = camera;
    if (this.#snapshot !== undefined) this.#submit();
  }

  /** The snapshot most recently submitted to the renderer, camera override
   * applied. Editor tooling reads this to frame or pick against exactly what
   * is on screen. */
  snapshot(): RenderWorldSnapshot | undefined {
    return this.#snapshot === undefined
      ? undefined
      : this.#composed(this.#snapshot);
  }

  #composed(snapshot: RenderWorldSnapshot): RenderWorldSnapshot {
    if (this.#viewer === undefined) return snapshot;
    return { ...snapshot, camera: this.#viewer };
  }

  #submit(): void {
    if (this.#snapshot === undefined || this.#poisoned) return;
    this.#renderWorldJson = JSON.stringify(this.#composed(this.#snapshot));
    try {
      this.#renderer?.set_render_world_json(this.#renderWorldJson);
    } catch (error) {
      throw new Error(
        `Vapour's Rust renderer rejected the authored scene: ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  stop(): void {
    if (this.#animationFrame !== 0) cancelAnimationFrame(this.#animationFrame);
    this.#animationFrame = 0;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.stop();
    this.#observer?.disconnect();
    if (!this.#poisoned) this.#renderer?.free();
    this.#renderer = undefined;
  }

  /** True once the Rust renderer has thrown and can no longer be called. */
  get failed(): boolean {
    return this.#poisoned;
  }

  readonly #render = (now: number): void => {
    const renderer = this.#renderer;
    if (renderer === undefined || this.#destroyed) return;
    const stats = this.#drawOnce(renderer, now);
    if (stats === undefined) return;
    this.dispatchEvent(
      new CustomEvent<RenderStats>("stats", { detail: stats }),
    );
    this.#animationFrame = requestAnimationFrame(this.#render);
  };

  #drawOnce(renderer: RustRenderer, now: number): RenderStats | undefined {
    const delta = Math.min(0.25, (now - this.#lastFrame) / 1000);
    this.#lastFrame = now;
    this.#smoothedDelta = this.#smoothedDelta * 0.9 + delta * 0.1;
    try {
      const rustStats = JSON.parse(
        renderer.render(now / 1000),
      ) as RustFrameStats;
      if (
        !Number.isFinite(rustStats.drawCalls) ||
        !Number.isFinite(rustStats.triangles)
      ) {
        throw new Error("frame statistics are incomplete");
      }
      return {
        fps: Math.round(1 / this.#smoothedDelta),
        frameTimeMs: delta * 1000,
        cpuEncodeMs: rustStats.cpuEncodeMs,
        drawCalls: rustStats.drawCalls,
        triangles: rustStats.triangles,
      };
    } catch (error) {
      // A throw from the Rust renderer usually means it panicked, which leaves
      // its interior borrow poisoned: every later call, `free()` included,
      // fails with "recursive use of an object". Drop the handle instead of
      // freeing it. That leaks one WASM object on a path that has already
      // failed, which is far better than throwing again during cleanup and
      // hiding the original cause.
      this.stop();
      this.#renderer = undefined;
      this.#poisoned = true;
      this.dispatchEvent(
        new CustomEvent("device-lost", { detail: messageOf(error) }),
      );
      return undefined;
    }
  }

  #resizeCanvas(): void {
    const scale = Math.min(devicePixelRatio, 2);
    const width = Math.max(1, Math.floor(this.#canvas.clientWidth * scale));
    const height = Math.max(1, Math.floor(this.#canvas.clientHeight * scale));
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
  }
}

function validatePostEffects(settings: PostProcessSettings): void {
  for (const [name, value, maximum] of [
    ["Bloom intensity", settings.bloom?.intensity ?? 0, 10],
    ["Bloom threshold", settings.bloom?.threshold ?? 1, 64],
    ["Bloom scatter", settings.bloom?.scatter ?? 0.5, 1],
    ["Saturation", settings.saturation ?? 1, 4],
    ["Contrast", settings.contrast ?? 1, 4],
    ["Vignette", settings.vignette ?? 0, 1],
    ["Chromatic aberration", settings.chromaticAberration ?? 0, 1],
  ] as const)
    if (!Number.isFinite(value) || value < 0 || value > maximum)
      throw new Error(`${name} must be finite and in [0, ${String(maximum)}].`);
}

const EMPTY_FLOAT32 = new Float32Array(0);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function settleWithin<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
import {
  extractRenderWorld,
  type RenderCameraSnapshot,
  type RenderWorldSnapshot,
} from "../render-world.js";
import type { SceneData } from "../../core/scene-document.js";
import {
  packRenderLayers,
  type RenderLayerSubmission,
} from "../render-layers.js";
