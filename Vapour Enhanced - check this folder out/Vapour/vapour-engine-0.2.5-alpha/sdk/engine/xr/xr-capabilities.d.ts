/** XR capability detection, foveation, and session debugging.
 *
 * "Does this device do hand tracking" is a question with three answers —
 * the browser has the API, the session was granted the feature, and a hand is
 * actually being tracked right now — and code that conflates them ships bugs
 * that only reproduce on one headset. This module reports all three levels
 * separately, in the same diagnostic shape as `detectBrowserCapabilities`, so
 * a game can degrade honestly ("hands unsupported on this device") rather than
 * silently.
 *
 * Foveation is a session-level setting on the projection layer; the engine
 * records the level it asked for and what the layer reports back, because a
 * runtime is free to ignore the request.
 *
 * The debug snapshot is a plain object a diagnostics overlay can print and a
 * test can assert, built from the same frame snapshot the game receives.
 */
import type { CapabilityDiagnostic } from "../core/browser-capabilities.js";
import type { Diagnostics } from "../diagnostics/counters.js";
import type { XrFrameSnapshot, XrReferenceSpaceType, XrSessionMode } from "./xr.js";
export declare const XR_COUNTERS: {
    readonly views: "xr.views";
    readonly inputs: "xr.inputs";
    readonly trackedHands: "xr.trackedHands";
    readonly frameTime: "xr.frameTime";
};
/** What the browser offers before any session exists. */
export interface XrDeviceCapabilities {
    readonly webxr: boolean;
    readonly modes: Readonly<Record<XrSessionMode, boolean>>;
    /** WebXR/WebGPU projection-layer binding is present. */
    readonly webgpuBinding: boolean;
    /** WebGL layer fallback is present. */
    readonly webglLayer: boolean;
}
/** What a live session was actually granted. */
export interface XrSessionCapabilities {
    readonly mode: XrSessionMode;
    readonly referenceSpace: XrReferenceSpaceType;
    readonly features: readonly string[];
    readonly handTracking: boolean;
    readonly layers: boolean;
    readonly foveation: XrFoveationReport;
}
export type XrFoveationLevel = 0 | 1 | 2 | 3;
export interface XrFoveationReport {
    /** Whether the layer exposes `fixedFoveation` at all. */
    readonly supported: boolean;
    readonly requested: XrFoveationLevel | undefined;
    /** The level the layer reports after the request, when it can be read back. */
    readonly applied: number | undefined;
}
/** Probes the browser without starting a session. */
export declare function detectXrCapabilities(scope?: typeof globalThis): Promise<XrDeviceCapabilities>;
/** Diagnostics in the engine's standard shape, for the overlay or a startup check. */
export declare function diagnoseXrCapabilities(capabilities: XrDeviceCapabilities): CapabilityDiagnostic[];
/** The minimum a live session must expose for {@link inspectSession}. */
export interface XrSessionInspectable {
    readonly enabledFeatures?: readonly string[];
    readonly inputSources: readonly {
        readonly hand?: unknown;
    }[];
    readonly renderState?: {
        readonly layers?: readonly unknown[];
        readonly baseLayer?: unknown;
    };
}
/**
 * Requests fixed foveation on a projection layer and reports what happened.
 *
 * Levels follow the WebXR layers spec: 0 none … 3 maximum. A layer without
 * the property is reported as unsupported rather than throwing, because a
 * game asks for this as an optimisation, never a requirement.
 */
export declare function setFoveation(layer: unknown, level: XrFoveationLevel): XrFoveationReport;
/** What a granted session actually supports. */
export declare function inspectSession(session: XrSessionInspectable, mode: XrSessionMode, referenceSpace: XrReferenceSpaceType, foveation?: XrFoveationReport): XrSessionCapabilities;
/** A printable, assertable summary of one XR frame. */
export interface XrDebugSnapshot {
    readonly time: number;
    readonly visibility: string;
    readonly views: number;
    readonly headPosition: readonly [number, number, number];
    readonly inputs: readonly {
        readonly hand: string;
        readonly mode: string;
        readonly buttonsPressed: number;
        readonly axes: readonly number[];
        readonly joints: number;
        readonly hasGrip: boolean;
    }[];
}
/** Summarises a frame and records the counts into diagnostics. */
export declare function debugXrFrame(frame: XrFrameSnapshot, diagnostics?: Diagnostics, previousTime?: number): XrDebugSnapshot;
/** One-line form for a console or overlay. */
export declare function formatXrDebug(snapshot: XrDebugSnapshot): string;
//# sourceMappingURL=xr-capabilities.d.ts.map