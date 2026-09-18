import type { PackedFrame } from "../render/host/index.js";
import { LightRig } from "../render/lights.js";
import { type EnvironmentSettings } from "../render/environment.js";
export interface DrawOptions {
    /** Linear RGBA tint multiplied into the material. Defaults to opaque white. */
    readonly color?: readonly [number, number, number, number];
    readonly metallic?: number;
    readonly roughness?: number;
    /** Emission strength; the glow takes the instance's own colour. */
    readonly emissive?: number;
    readonly alphaCutoff?: number;
    /** Stable standard-material asset identifier. */
    readonly material?: string;
    /** Skinning matrices for a mesh uploaded with `boneIndices`/`boneWeights`:
     * 16 column-major floats per bone, as produced by `skinningMatrices`. */
    readonly bones?: Float32Array;
}
export declare const CAMERA_STRIDE = 20;
/**
 * Accumulates one frame's draws into packed arrays.
 *
 * A game calls `draw` once per visible object per frame, which for a streaming
 * voxel world is hundreds to thousands of calls. The builder is therefore
 * written to allocate nothing in steady state: buffers grow by doubling and are
 * then reused frame after frame, and `reset` only moves a cursor. That matters
 * because a garbage collection pause during gameplay is a visible stutter.
 *
 * Mesh identifiers are interned into a small table so the only text crossing
 * into WebAssembly is one entry per distinct mesh, not one per instance.
 */
export declare class FrameBuilder {
    #private;
    constructor(initialCapacity?: number);
    /** Instances recorded so far this frame. */
    get drawCount(): number;
    /** How many instances fit before the next growth. */
    get capacity(): number;
    /** Begins a new frame. Retains buffers; only the cursor moves. */
    reset(): void;
    /**
     * Records one instance.
     *
     * `matrix` is 16 column-major floats, the same layout the renderer uses. It
     * is copied immediately, so the caller is free to reuse a scratch matrix.
     */
    draw(meshId: string, matrix: ArrayLike<number>, options?: DrawOptions): void;
    /** Sets the view for this frame. `worldMatrix` is the camera's transform;
     * the renderer looks down its -Z. */
    setCamera(worldMatrix: ArrayLike<number>, fieldOfViewDegrees: number, near: number, far: number): void;
    /** Sets a true orthographic view. `verticalSize` is the visible world-space
     * height; horizontal size follows the render target aspect ratio. */
    setOrthographicCamera(worldMatrix: ArrayLike<number>, verticalSize: number, near: number, far: number): void;
    /**
     * This frame's light rig.
     *
     * Add as many lights as the scene needs — ambient, hemisphere, directional,
     * point, and spot. Anything added here takes precedence over [`setLight`],
     * which remains as shorthand for the single-directional case.
     */
    get lights(): LightRig;
    /** Shorthand for a scene lit by one directional light. Equivalent to
     * clearing the rig and adding a single directional entry. */
    setLight(direction: readonly [number, number, number], color: readonly [number, number, number], intensity: number): void;
    /** Sets the presentation clear colour and optional distance fog. */
    setEnvironment(settings: EnvironmentSettings): void;
    /**
     * The packed frame, as views over the builder's own buffers.
     *
     * The arrays are only valid until the next `reset`; the renderer copies them
     * during submission, so nothing outlives the call.
     */
    pack(): PackedFrame;
}
/**
 * Builds a column-major transform matrix into `target`, allocating nothing.
 *
 * Game code composes a matrix per object per frame; a helper that returns a new
 * array would allocate thousands of times a second.
 */
export declare function composeMatrix(target: Float32Array, position: readonly [number, number, number], rotation: readonly [number, number, number, number], scale: readonly [number, number, number]): Float32Array;
/** Translation-only transform: the common case for voxel chunks and tiles. */
export declare function composeTranslation(target: Float32Array, x: number, y: number, z: number, scale?: number): Float32Array;
//# sourceMappingURL=frame-builder.d.ts.map