import { HeadlessRenderHost } from '@vapour/engine';
import { ThreeSceneBridge, type ThreeRenderLayer } from '@vapour/three-bridge';
import * as THREE from 'three';

/**
 * Transitional presentation surface for applications migrating a Three scene
 * graph to Vapour. It deliberately implements only window/canvas controls;
 * every frame and GPU resource is owned by ThreeSceneBridge/WebGpuRenderHost.
 */
export class VapourRendererControls {
  readonly domElement: HTMLCanvasElement;
  readonly shadowMap = { enabled: true, type: THREE.PCFShadowMap };
  readonly capabilities = { getMaxAnisotropy: () => 8 };
  outputColorSpace: THREE.ColorSpace = THREE.SRGBColorSpace;
  toneMapping = THREE.NoToneMapping;
  toneMappingExposure = 1;
  sortObjects = true;
  autoClear = true;
  readonly #bridge: ThreeSceneBridge;
  #pixelRatio = 1;

  constructor() {
    this.domElement = document.createElement('canvas');
    this.domElement.id = 'vapour-game';
    this.domElement.setAttribute('aria-label', 'CubeGame WebGPU viewport');
    const headless = new URLSearchParams(window.location.search).get('vapour-headless') === '1';
    this.#bridge = new ThreeSceneBridge(this.domElement, {
      ...(headless ? { host: new HeadlessRenderHost() } : {}),
      wasmModuleUrl: new URL('vapour_runtime.js', document.baseURI).href,
      onDiagnostic: (message: string) => console.warn(`[CubeGame migration] ${message}`),
    });
  }

  async initialize(): Promise<void> {
    this.domElement.dataset.vapourGpuState = 'initializing';
    try {
      await this.#bridge.initialize();
      this.domElement.dataset.vapourGpuState = 'ready';
      delete this.domElement.dataset.vapourGpuError;
    } catch (error) {
      this.domElement.dataset.vapourGpuState = 'failed';
      this.domElement.dataset.vapourGpuError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  setPixelRatio(value: number): void {
    if (Number.isFinite(value) && value > 0) this.#pixelRatio = value;
  }

  setSize(width: number, height: number, updateStyle = true): void {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    this.domElement.width = Math.max(1, Math.floor(safeWidth * this.#pixelRatio));
    this.domElement.height = Math.max(1, Math.floor(safeHeight * this.#pixelRatio));
    if (updateStyle) {
      this.domElement.style.width = `${String(safeWidth)}px`;
      this.domElement.style.height = `${String(safeHeight)}px`;
    }
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.renderLayers([{ scene, camera }]);
  }

  renderLayers(layers: readonly ThreeRenderLayer[]): void {
    this.#bridge.renderLayers(layers);
    const resources = this.#bridge.resourceStats();
    this.domElement.dataset.vapourGeometries = String(resources.geometries);
    this.domElement.dataset.vapourTextures = String(resources.textures);
    this.domElement.dataset.vapourMaterials = String(resources.materials);
    this.domElement.dataset.vapourLayers = String(layers.length);
  }

  /** @deprecated Layer clear policy belongs in `renderLayers`. Retained so
   * unported call sites fail harmlessly while they migrate. */
  clearDepth(): void {}

  dispose(): void {
    this.#bridge.destroy();
  }
}
