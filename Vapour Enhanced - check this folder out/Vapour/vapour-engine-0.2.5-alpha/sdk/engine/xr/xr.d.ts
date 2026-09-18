export type XrSessionMode = "inline" | "immersive-vr" | "immersive-ar";
export type XrReferenceSpaceType = "viewer" | "local" | "local-floor" | "bounded-floor" | "unbounded";
export type XrHandedness = "none" | "left" | "right";
interface XrRigidTransformLike {
    readonly matrix: ArrayLike<number>;
}
interface XrPoseLike {
    readonly transform: XrRigidTransformLike;
}
interface XrViewLike extends XrPoseLike {
    readonly eye: "none" | "left" | "right";
    readonly projectionMatrix: ArrayLike<number>;
}
interface XrViewerPoseLike extends XrPoseLike {
    readonly views: readonly XrViewLike[];
}
interface XrReferenceSpaceLike {
    readonly boundsGeometry?: readonly {
        readonly x: number;
        readonly y: number;
        readonly z: number;
        readonly w: number;
    }[];
}
interface XrInputSourceLike {
    readonly handedness: XrHandedness;
    readonly targetRayMode: string;
    readonly profiles?: readonly string[];
    readonly targetRaySpace: unknown;
    readonly gripSpace?: unknown;
    readonly gamepad?: {
        readonly buttons: readonly {
            readonly value: number;
            readonly pressed: boolean;
            readonly touched: boolean;
        }[];
        readonly axes: readonly number[];
        readonly hapticActuators?: readonly {
            pulse(value: number, duration: number): Promise<boolean>;
        }[];
        readonly vibrationActuator?: {
            playEffect(type: string, parameters: {
                duration: number;
                strongMagnitude: number;
                weakMagnitude: number;
            }): Promise<string>;
        };
    };
    readonly hand?: Iterable<[string, unknown]>;
}
interface XrFrameLike {
    getViewerPose(space: XrReferenceSpaceLike): XrViewerPoseLike | null;
    getPose(space: unknown, baseSpace: XrReferenceSpaceLike): XrPoseLike | null;
    getJointPose?(joint: unknown, baseSpace: XrReferenceSpaceLike): (XrPoseLike & {
        readonly radius?: number;
    }) | null;
}
interface XrSessionLike {
    readonly inputSources: readonly XrInputSourceLike[];
    readonly visibilityState?: string;
    requestReferenceSpace(type: XrReferenceSpaceType): Promise<XrReferenceSpaceLike>;
    updateRenderState?(state: {
        layers?: readonly unknown[];
        baseLayer?: unknown;
    }): void;
    requestAnimationFrame(callback: (time: number, frame: XrFrameLike) => void): number;
    cancelAnimationFrame(handle: number): void;
    end(): Promise<void>;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}
interface XrSystemLike {
    isSessionSupported(mode: XrSessionMode): Promise<boolean>;
    requestSession(mode: XrSessionMode, options?: {
        requiredFeatures?: readonly string[];
        optionalFeatures?: readonly string[];
    }): Promise<XrSessionLike>;
}
export interface XrSystemProvider {
    readonly xr?: XrSystemLike;
}
export interface XrSessionOptions {
    readonly mode?: XrSessionMode;
    readonly referenceSpace?: XrReferenceSpaceType;
    /** Ordered alternatives when the preferred space is unavailable. Immersive
     * sessions default to local then viewer after local-floor. */
    readonly referenceSpaceFallbacks?: readonly XrReferenceSpaceType[];
    readonly requiredFeatures?: readonly string[];
    readonly optionalFeatures?: readonly string[];
    /** Creates and installs an XRGPUBinding projection layer. This requires the
     * browser's experimental WebXR/WebGPU binding, not merely WebGPU support. */
    readonly webGpuPresentation?: {
        readonly clearColor?: readonly [number, number, number, number];
        readonly scaleFactor?: number;
        readonly fallbackToWebGl?: boolean;
        /** Canvas produced by Vapour's WebGPU renderer. Older XR runtimes can
         * mirror it through the XR-only compatibility compositor. */
        readonly compatibilitySourceCanvas?: HTMLCanvasElement;
    };
}
export interface XrViewSnapshot {
    readonly eye: "none" | "left" | "right";
    readonly transform: Float32Array;
    readonly projection: Float32Array;
}
export interface XrButtonSnapshot {
    readonly value: number;
    readonly pressed: boolean;
    readonly touched: boolean;
}
export interface XrJointSnapshot {
    readonly name: string;
    readonly transform: Float32Array;
    readonly radius: number | undefined;
}
export interface XrInputSnapshot {
    readonly handedness: XrHandedness;
    readonly targetRayMode: string;
    readonly profiles: readonly string[];
    readonly targetRayTransform: Float32Array | undefined;
    readonly gripTransform: Float32Array | undefined;
    readonly buttons: readonly XrButtonSnapshot[];
    readonly axes: Float32Array;
    readonly joints: readonly XrJointSnapshot[];
}
export interface XrFrameSnapshot {
    readonly time: number;
    readonly viewerTransform: Float32Array;
    readonly views: readonly XrViewSnapshot[];
    readonly inputs: readonly XrInputSnapshot[];
    readonly visibilityState: string;
}
/** WebXR session owner. WebXR remains on the main/browser thread; each frame is
 * converted into immutable typed snapshots suitable for one batched WebGPU or
 * WASM submission. Session start must be called from a user gesture for
 * immersive modes, as required by browsers. */
export declare class XrSessionManager {
    #private;
    constructor(provider?: XrSystemProvider);
    get active(): boolean;
    get mode(): XrSessionMode | undefined;
    get referenceSpaceType(): XrReferenceSpaceType | undefined;
    supported(mode: XrSessionMode): Promise<boolean>;
    start(options?: XrSessionOptions): Promise<void>;
    startFrameLoop(callback: (frame: XrFrameSnapshot) => void): void;
    stopFrameLoop(): void;
    end(): Promise<void>;
    onEnd(listener: () => void): () => void;
    /** Pulses every matching controller. Unsupported actuators return false
     * instead of failing the frame; invalid values remain programmer errors. */
    pulse(handedness: Exclude<XrHandedness, "none">, intensity?: number, durationMs?: number): Promise<boolean>;
}
export {};
//# sourceMappingURL=xr.d.ts.map