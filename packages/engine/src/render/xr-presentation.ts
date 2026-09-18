/** XR stereo presentation through the WebXR/WebGPU binding.
 *
 * A headset frame is two cameras that must land in two regions of the
 * compositor's texture. The renderer draws into its own canvas, so
 * presenting is: lay the eyes out side by side in that canvas, submit each
 * eye as a render layer with its world transform, its *asymmetric*
 * projection, and its rectangle, render, and copy each rectangle into the
 * eye's `XRGPUSubImage`.
 *
 * Two modes, chosen by {@link probeXrPresentation}:
 *
 * - **multiview** — the binding accepts a `texture-array` projection layer,
 *   so both eyes go to the renderer in *one* submission of two layers and
 *   one frame, and each eye is copied into its array slice.
 * - **two-pass** — a `texture` projection layer: each eye is its own
 *   submission and frame, copied into its viewport of the shared texture.
 *
 * The renderer draws both eyes' geometry with per-eye culling and uniforms
 * either way; multiview here means one submission and one command stream,
 * not a WGSL view-index extension (browsers expose none yet).
 *
 * WebXR projection matrices use the OpenGL depth range; the renderer expects
 * WebGPU's, so every eye's projection is rewritten on the way through and
 * its field of view, near, and far are recovered for the camera record that
 * shadow cascades read. Nothing here depends on a real session: the binding,
 * the sub-images, and the copy are all interfaces a test can fake.
 */
import type { XrEyeCamera, XrRigFrame } from "../xr/xr-rig.js";
import { CAMERA_STRIDE } from "../core/frame-builder.js";
import type { PackedFrame, RenderStats } from "./host/frame.js";
import {
  projectionExtent,
  projectionToWebGpuDepth,
  type RenderLayerSubmission,
} from "./render-layers.js";

export interface XrTextureRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The subset of `XRGPUSubImage` presentation needs. */
export interface XrGpuSubImageLike {
  readonly colorTexture: { readonly width: number; readonly height: number };
  /** The eye's rectangle in `colorTexture`; the whole texture when absent. */
  readonly viewport?: XrTextureRect;
  /** Array slice for `texture-array` layers; 0 when absent. */
  readonly imageIndex?: number;
}

export interface XrGpuProjectionLayerInit {
  readonly colorFormat: GPUTextureFormat;
  readonly depthStencilFormat?: GPUTextureFormat;
  readonly textureType?: "texture" | "texture-array";
  readonly scaleFactor?: number;
}

/** The subset of `XRGPUBinding` presentation needs. */
export interface XrGpuBindingLike<Layer = unknown, View = unknown> {
  createProjectionLayer(init: XrGpuProjectionLayerInit): Layer;
  getViewSubImage(layer: Layer, view: View): XrGpuSubImageLike;
  getPreferredColorFormat(): GPUTextureFormat;
}

/** What a session exposes to attach the layer. */
export interface XrPresentationSessionLike {
  updateRenderState(state: { layers: readonly unknown[] }): void;
}

/** An `XRView`: presentation matches views to rig eyes by this label. */
export interface XrPresentationViewLike {
  readonly eye: "none" | "left" | "right";
}

/** The render host slice presentation drives. `WebGpuRenderHost` and
 * `HeadlessRenderHost` both satisfy it. */
export interface XrPresentationHost {
  submitLayers(layers: readonly RenderLayerSubmission[]): void;
  renderFrame(timeMilliseconds: number): RenderStats | undefined;
  /** Pins the canvas to the eye layout so copies are pixel for pixel. A
   * host without it (headless) is assumed to be sized by its owner. */
  setFixedSize?(width: number, height: number): void;
}

/** Copies one eye's rectangle of the rendered canvas into its sub-image.
 * The default uses `GPUQueue.copyExternalImageToTexture`; tests inject a
 * recorder. */
export type XrSubImageCopier = (copy: {
  readonly subImage: XrGpuSubImageLike;
  readonly sourceRect: XrTextureRect;
  readonly destinationRect: XrTextureRect;
  readonly imageIndex: number;
}) => void;

export interface XrPresentationCapabilities {
  /** The binding accepted a `texture-array` projection layer. */
  readonly multiview: boolean;
  readonly colorFormat: GPUTextureFormat;
}

export interface XrPresentationOptions<Layer, View> {
  readonly host: XrPresentationHost;
  readonly binding: XrGpuBindingLike<Layer, View>;
  readonly session: XrPresentationSessionLike;
  readonly copy: XrSubImageCopier;
  /** Force two-pass even when multiview is available. */
  readonly multiview?: boolean;
  readonly depthStencilFormat?: GPUTextureFormat;
  readonly scaleFactor?: number;
}

export interface XrPresentedEye {
  readonly eye: XrEyeCamera["eye"];
  /** Where the eye was rendered in the canvas. */
  readonly canvasRect: XrTextureRect;
  /** Where it was copied in the compositor texture. */
  readonly textureRect: XrTextureRect;
  readonly imageIndex: number;
  /** The camera record and WebGPU-depth projection submitted. */
  readonly camera: Float32Array;
  readonly projection: Float32Array;
}

export interface XrPresentationResult {
  readonly mode: "multiview" | "two-pass";
  readonly eyes: readonly XrPresentedEye[];
  readonly submissions: number;
  readonly frames: readonly RenderStats[];
  readonly canvasSize: { readonly width: number; readonly height: number };
}

/** Asks the binding whether it takes a `texture-array` projection layer.
 * Bindings that do not throw from `createProjectionLayer`. */
export function probeXrPresentation<Layer, View>(
  binding: XrGpuBindingLike<Layer, View>,
  depthStencilFormat: GPUTextureFormat = "depth24plus",
): XrPresentationCapabilities {
  const colorFormat = binding.getPreferredColorFormat();
  let multiview = false;
  try {
    binding.createProjectionLayer({ colorFormat, depthStencilFormat, textureType: "texture-array" });
    multiview = true;
  } catch {
    multiview = false;
  }
  return { multiview, colorFormat };
}

/** The default copier for a real device: the canvas is the copy source. */
export function canvasSubImageCopier(
  device: { readonly queue: { copyExternalImageToTexture(source: object, destination: object, size: object): void } },
  canvas: HTMLCanvasElement,
): XrSubImageCopier {
  return ({ subImage, sourceRect, destinationRect, imageIndex }) => {
    device.queue.copyExternalImageToTexture(
      { source: canvas, origin: { x: sourceRect.x, y: sourceRect.y } },
      { texture: subImage.colorTexture, origin: { x: destinationRect.x, y: destinationRect.y, z: imageIndex } },
      { width: destinationRect.width, height: destinationRect.height },
    );
  };
}

/**
 * Presents rig frames to a WebXR/WebGPU projection layer through a render
 * host. Create it once per session; call {@link present} every XR frame.
 */
export class XrPresentation<Layer = unknown, View extends XrPresentationViewLike = XrPresentationViewLike> {
  readonly mode: "multiview" | "two-pass";
  readonly #host: XrPresentationHost;
  readonly #binding: XrGpuBindingLike<Layer, View>;
  readonly #layer: Layer;
  readonly #copy: XrSubImageCopier;
  #canvasSize = { width: 0, height: 0 };

  constructor(options: XrPresentationOptions<Layer, View>) {
    const capabilities = probeXrPresentation(options.binding, options.depthStencilFormat);
    const multiview = (options.multiview ?? true) && capabilities.multiview;
    const init: XrGpuProjectionLayerInit = {
      colorFormat: capabilities.colorFormat,
      depthStencilFormat: options.depthStencilFormat ?? "depth24plus",
      textureType: multiview ? "texture-array" : "texture",
      ...(options.scaleFactor === undefined ? {} : { scaleFactor: options.scaleFactor }),
    };
    if (init.scaleFactor !== undefined && !(init.scaleFactor > 0 && init.scaleFactor <= 2))
      throw new Error("XR projection scaleFactor must be greater than 0 and at most 2.");
    this.mode = multiview ? "multiview" : "two-pass";
    this.#host = options.host;
    this.#binding = options.binding;
    this.#copy = options.copy;
    this.#layer = options.binding.createProjectionLayer(init);
    options.session.updateRenderState({ layers: [this.#layer] });
  }

  /**
   * Renders `frame` once per eye and copies each eye into its sub-image.
   * `views` are the XR frame's views (matched to `rig.eyes` by eye label);
   * `frame` is the scene without a camera, which each eye supplies.
   */
  present(views: readonly View[], rig: XrRigFrame, frame: PackedFrame, timeMilliseconds: number): XrPresentationResult {
    if (rig.eyes.length === 0) throw new Error("An XR rig frame needs at least one eye to present.");
    const eyes = rig.eyes.map((camera) => {
      const view = views.find((candidate) => candidate.eye === camera.eye);
      if (view === undefined) throw new Error(`The XR frame has no '${camera.eye}' view for the rig's eye.`);
      const subImage = this.#binding.getViewSubImage(this.#layer, view);
      const textureRect = subImage.viewport ?? { x: 0, y: 0, width: subImage.colorTexture.width, height: subImage.colorTexture.height };
      if (!(textureRect.width > 0 && textureRect.height > 0)) throw new Error(`The XR '${camera.eye}' sub-image has an empty viewport.`);
      return { camera, subImage, textureRect, imageIndex: subImage.imageIndex ?? 0 };
    });

    // Eyes sit side by side in the canvas at their compositor sizes, so
    // every copy is pixel for pixel.
    let width = 0;
    let height = 0;
    const canvasRects = eyes.map(({ textureRect }) => {
      const rect = { x: width, y: 0, width: textureRect.width, height: textureRect.height };
      width += textureRect.width;
      height = Math.max(height, textureRect.height);
      return rect;
    });
    if (width !== this.#canvasSize.width || height !== this.#canvasSize.height) {
      this.#canvasSize = { width, height };
      this.#host.setFixedSize?.(width, height);
    }

    const layers = eyes.map(({ camera }, index) => eyeLayer(camera, frame, canvasRects[index]!, width, height));
    const presented: XrPresentedEye[] = [];
    const frames: RenderStats[] = [];
    let submissions = 0;
    const copyEye = (index: number): void => {
      const { camera, subImage, textureRect, imageIndex } = eyes[index]!;
      this.#copy({ subImage, sourceRect: canvasRects[index]!, destinationRect: textureRect, imageIndex });
      presented.push({ eye: camera.eye, canvasRect: canvasRects[index]!, textureRect, imageIndex, camera: layers[index]!.frame.camera, projection: layers[index]!.projection as Float32Array });
    };
    if (this.mode === "multiview") {
      this.#host.submitLayers(layers);
      submissions = 1;
      const stats = this.#host.renderFrame(timeMilliseconds);
      if (stats !== undefined) frames.push(stats);
      for (let index = 0; index < eyes.length; index += 1) copyEye(index);
    } else {
      for (let index = 0; index < eyes.length; index += 1) {
        this.#host.submitLayers([layers[index]!]);
        submissions += 1;
        const stats = this.#host.renderFrame(timeMilliseconds);
        if (stats !== undefined) frames.push(stats);
        copyEye(index);
      }
    }
    return { mode: this.mode, eyes: presented, submissions, frames, canvasSize: this.#canvasSize };
  }
}

/** One eye as a render layer: the eye's world transform in the camera
 * record with the frustum extent its projection encodes, the projection
 * itself rewritten to WebGPU depth, and the eye's rectangle of the canvas. */
export function eyeLayer(camera: XrEyeCamera, frame: PackedFrame, rect: XrTextureRect, canvasWidth: number, canvasHeight: number): RenderLayerSubmission & { readonly projection: Float32Array } {
  const extent = projectionExtent(camera.projection, "negative-one-to-one");
  const record = new Float32Array(CAMERA_STRIDE);
  record.set(camera.world, 0);
  record[16] = 0;
  record[17] = extent.fieldOfViewDegrees;
  record[18] = extent.near;
  record[19] = Number.isFinite(extent.far) ? extent.far : 1e4;
  return {
    frame: { ...frame, camera: record },
    projection: projectionToWebGpuDepth(camera.projection),
    clearColor: true,
    clearDepth: true,
    viewport: { x: rect.x / canvasWidth, y: rect.y / canvasHeight, width: rect.width / canvasWidth, height: rect.height / canvasHeight },
  };
}
