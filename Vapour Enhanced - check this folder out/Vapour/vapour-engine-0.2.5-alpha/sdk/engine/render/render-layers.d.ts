import type { PackedFrame } from "./host/index.js";
export interface RenderLayerOptions {
    /** Clear the presentation colour before this layer. Defaults to true only
     * for the first layer. */
    readonly clearColor?: boolean;
    /** Clear depth before this layer. Defaults to true only for the first layer. */
    readonly clearDepth?: boolean;
    /** Render target (see `RenderHost.createRenderTarget`) this layer draws
     * into instead of the presentation surface. A layer must not draw into a
     * target its own materials sample; the renderer rejects that cycle. */
    readonly target?: string;
    /** Rectangle of the destination this layer occupies, as fractions in
     * [0, 1]. Viewport and scissor are set together, so clears and skies stay
     * inside it. Defaults to the whole destination. */
    readonly viewport?: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
    };
    /** An explicit column-major projection matrix that replaces the symmetric
     * perspective the frame's camera record describes — an XR eye's
     * asymmetric frustum. The camera record's field of view, near, and far
     * still describe the frustum's extent for shadow cascades, so set them
     * to match (see `projectionExtent`). */
    readonly projection?: Float32Array | readonly number[];
}
export interface RenderLayerSubmission extends RenderLayerOptions {
    readonly frame: PackedFrame;
}
/** One atomic multi-camera submission. Tables and instance arrays are shared
 * across layers; layer counts and flags divide them without per-draw objects. */
export interface PackedRenderLayers {
    readonly meshTable: readonly string[];
    readonly meshIndices: Uint32Array;
    readonly materialTable: readonly string[];
    readonly materialIndices: Uint32Array;
    readonly matrices: Float32Array;
    readonly baseColors: Float32Array;
    readonly materialParams: Float32Array;
    readonly layerInstanceCounts: Uint32Array;
    /** bit 0 clear colour, bit 1 clear depth, bit 2 camera present, bit 3 light present */
    readonly layerFlags: Uint32Array;
    readonly cameras: Float32Array;
    /** Every layer's rig, concatenated; `LIGHT_STRIDE` floats per light. */
    readonly lights: Float32Array;
    /** Lights belonging to each layer, dividing `lights`. */
    readonly layerLightCounts: Uint32Array;
    /** Exactly `ENVIRONMENT_STRIDE` values per layer. */
    readonly environments: Float32Array;
    /** One entry per instance: its offset into `boneMatrices`, or negative if
     * unskinned. Empty if nothing across every layer is skinned. */
    readonly boneOffsets: Float32Array;
    /** Every layer's bone palettes, concatenated in layer order; 16 floats per
     * bone. Each layer's `boneOffsets` are rebased so they index into this
     * shared buffer directly. */
    readonly boneMatrices: Float32Array;
    /** One render-target id per layer, "" for the surface; empty when every
     * layer presents to the surface. */
    readonly layerTargets: readonly string[];
    /** Four values (x, y, width, height) per layer, or empty when every layer
     * fills its destination. */
    readonly viewports: Float32Array;
    /** Sixteen values per layer, or empty when no layer supplies a matrix. */
    readonly projections: Float32Array;
}
export declare const RENDER_LAYER_CLEAR_COLOR = 1;
export declare const RENDER_LAYER_CLEAR_DEPTH = 2;
export declare const RENDER_LAYER_HAS_CAMERA = 4;
export declare const RENDER_LAYER_HAS_LIGHT = 8;
export declare const RENDER_LAYER_HAS_ENVIRONMENT = 16;
export declare const RENDER_LAYER_HAS_PROJECTION = 32;
/** Packs a small number of camera layers into one WASM call. This function is
 * intentionally allocation-oriented: callers with a steady multi-view layout
 * should reuse the returned arrays through a future RenderLayerBuilder, while
 * migration bridges value a simple, fully validated boundary today. */
export declare function packRenderLayers(layers: readonly RenderLayerSubmission[]): PackedRenderLayers;
/** Refuses a submission in which a layer samples the render target it draws
 * into, directly or through other targets rendered the same frame. Mirrors
 * `detect_render_target_cycle` in Rust, which the WebGPU host relies on; the
 * headless host runs this so CI sees the same error without a GPU.
 *
 * `layers` gives each layer's destination (undefined for the surface) and
 * the render targets its materials sample. Throws naming the target and the
 * chain that closes the loop. */
export declare function detectRenderTargetCycle(layers: readonly {
    readonly target?: string | undefined;
    readonly samples: readonly string[];
}[]): void;
/** Which clip-space depth range a projection matrix targets. WebGPU (and
 * the Rust renderer) map depth to [0, 1]; OpenGL and WebXR's
 * `XRView.projectionMatrix` map it to [-1, 1]. The two are not
 * distinguishable from the matrix alone, so callers say which they have. */
export type ProjectionDepthRange = "zero-to-one" | "negative-one-to-one";
/** Rewrites a [-1, 1]-depth projection (WebXR, OpenGL) into the [0, 1]
 * depth range the renderer expects: z' = 0.5 z + 0.5 w. */
export declare function projectionToWebGpuDepth(projection: ArrayLike<number>): Float32Array;
/** The vertical field of view (degrees), near, and far a perspective
 * projection encodes, for the camera record that accompanies an explicit
 * projection. An infinite far plane reports `Infinity`. */
export declare function projectionExtent(projection: ArrayLike<number>, depthRange: ProjectionDepthRange): {
    fieldOfViewDegrees: number;
    near: number;
    far: number;
};
//# sourceMappingURL=render-layers.d.ts.map