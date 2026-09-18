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
import type { PackedFrame, RenderStats } from "./host/frame.js";
import { type RenderLayerSubmission } from "./render-layers.js";
export interface XrTextureRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
/** The subset of `XRGPUSubImage` presentation needs. */
export interface XrGpuSubImageLike {
    readonly colorTexture: {
        readonly width: number;
        readonly height: number;
    };
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
    updateRenderState(state: {
        layers: readonly unknown[];
    }): void;
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
    readonly canvasSize: {
        readonly width: number;
        readonly height: number;
    };
}
/** Asks the binding whether it takes a `texture-array` projection layer.
 * Bindings that do not throw from `createProjectionLayer`. */
export declare function probeXrPresentation<Layer, View>(binding: XrGpuBindingLike<Layer, View>, depthStencilFormat?: GPUTextureFormat): XrPresentationCapabilities;
/** The default copier for a real device: the canvas is the copy source. */
export declare function canvasSubImageCopier(device: {
    readonly queue: {
        copyExternalImageToTexture(source: object, destination: object, size: object): void;
    };
}, canvas: HTMLCanvasElement): XrSubImageCopier;
/**
 * Presents rig frames to a WebXR/WebGPU projection layer through a render
 * host. Create it once per session; call {@link present} every XR frame.
 */
export declare class XrPresentation<Layer = unknown, View extends XrPresentationViewLike = XrPresentationViewLike> {
    #private;
    readonly mode: "multiview" | "two-pass";
    constructor(options: XrPresentationOptions<Layer, View>);
    /**
     * Renders `frame` once per eye and copies each eye into its sub-image.
     * `views` are the XR frame's views (matched to `rig.eyes` by eye label);
     * `frame` is the scene without a camera, which each eye supplies.
     */
    present(views: readonly View[], rig: XrRigFrame, frame: PackedFrame, timeMilliseconds: number): XrPresentationResult;
}
/** One eye as a render layer: the eye's world transform in the camera
 * record with the frustum extent its projection encodes, the projection
 * itself rewritten to WebGPU depth, and the eye's rectangle of the canvas. */
export declare function eyeLayer(camera: XrEyeCamera, frame: PackedFrame, rect: XrTextureRect, canvasWidth: number, canvasHeight: number): RenderLayerSubmission & {
    readonly projection: Float32Array;
};
//# sourceMappingURL=xr-presentation.d.ts.map