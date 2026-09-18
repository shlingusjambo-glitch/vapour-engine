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

export const XR_COUNTERS = {
  views: "xr.views",
  inputs: "xr.inputs",
  trackedHands: "xr.trackedHands",
  frameTime: "xr.frameTime",
} as const;

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

interface XrSystemProbe {
  isSessionSupported(mode: XrSessionMode): Promise<boolean>;
}

/** Probes the browser without starting a session. */
export async function detectXrCapabilities(scope: typeof globalThis = globalThis): Promise<XrDeviceCapabilities> {
  const navigatorValue = "navigator" in scope ? (scope.navigator as Navigator & { xr?: XrSystemProbe }) : undefined;
  const xr = navigatorValue?.xr;
  const modes: Record<XrSessionMode, boolean> = { inline: false, "immersive-vr": false, "immersive-ar": false };
  if (xr !== undefined) {
    for (const mode of Object.keys(modes) as XrSessionMode[]) {
      try {
        modes[mode] = await xr.isSessionSupported(mode);
      } catch {
        modes[mode] = false;
      }
    }
  }
  return {
    webxr: xr !== undefined,
    modes,
    webgpuBinding: "XRGPUBinding" in scope,
    webglLayer: "XRWebGLLayer" in scope,
  };
}

/** Diagnostics in the engine's standard shape, for the overlay or a startup check. */
export function diagnoseXrCapabilities(capabilities: XrDeviceCapabilities): CapabilityDiagnostic[] {
  const diagnostics: CapabilityDiagnostic[] = [];
  if (!capabilities.webxr) {
    diagnostics.push({ code: "xr.unavailable", severity: "error", message: "WebXR is not available in this browser.", remediation: "Use a WebXR-capable browser in a secure context with a headset connected." });
    return diagnostics;
  }
  if (!capabilities.modes["immersive-vr"] && !capabilities.modes["immersive-ar"]) {
    diagnostics.push({ code: "xr.no-immersive-mode", severity: "error", message: "No immersive XR mode is supported.", remediation: "Connect a headset, or use inline mode for a non-immersive preview." });
  }
  if (!capabilities.webgpuBinding) {
    diagnostics.push({
      code: "xr.webgpu-binding-unavailable",
      severity: capabilities.webglLayer ? "warning" : "error",
      message: "The WebXR/WebGPU projection-layer binding is unavailable.",
      remediation: capabilities.webglLayer ? "Vapour will present through the WebGL compatibility layer. Enable the WebXR/WebGPU binding for native performance." : "Enable the browser's WebXR/WebGPU binding feature and restart.",
    });
  }
  return diagnostics;
}

/** The minimum a live session must expose for {@link inspectSession}. */
export interface XrSessionInspectable {
  readonly enabledFeatures?: readonly string[];
  readonly inputSources: readonly { readonly hand?: unknown }[];
  readonly renderState?: { readonly layers?: readonly unknown[]; readonly baseLayer?: unknown };
}

interface FoveatedLayer {
  fixedFoveation?: number;
}

/**
 * Requests fixed foveation on a projection layer and reports what happened.
 *
 * Levels follow the WebXR layers spec: 0 none … 3 maximum. A layer without
 * the property is reported as unsupported rather than throwing, because a
 * game asks for this as an optimisation, never a requirement.
 */
export function setFoveation(layer: unknown, level: XrFoveationLevel): XrFoveationReport {
  if (![0, 1, 2, 3].includes(level)) throw new Error("Foveation level must be 0, 1, 2, or 3.");
  const target = layer as FoveatedLayer | null | undefined;
  if (target === null || target === undefined || !("fixedFoveation" in target)) return { supported: false, requested: level, applied: undefined };
  // The spec maps the integer level onto [0, 1].
  target.fixedFoveation = level / 3;
  return { supported: true, requested: level, applied: target.fixedFoveation };
}

/** What a granted session actually supports. */
export function inspectSession(session: XrSessionInspectable, mode: XrSessionMode, referenceSpace: XrReferenceSpaceType, foveation?: XrFoveationReport): XrSessionCapabilities {
  const features = [...(session.enabledFeatures ?? [])];
  const layer = session.renderState?.layers?.[0] ?? session.renderState?.baseLayer;
  return {
    mode,
    referenceSpace,
    features,
    handTracking: features.includes("hand-tracking") || session.inputSources.some((source) => source.hand !== undefined),
    layers: features.includes("layers") || (session.renderState?.layers !== undefined),
    foveation: foveation ?? { supported: layer !== undefined && typeof layer === "object" && layer !== null && "fixedFoveation" in layer, requested: undefined, applied: undefined },
  };
}

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
export function debugXrFrame(frame: XrFrameSnapshot, diagnostics?: Diagnostics, previousTime?: number): XrDebugSnapshot {
  const snapshot: XrDebugSnapshot = {
    time: frame.time,
    visibility: frame.visibilityState,
    views: frame.views.length,
    headPosition: [frame.viewerTransform[12]!, frame.viewerTransform[13]!, frame.viewerTransform[14]!],
    inputs: frame.inputs.map((input) => ({
      hand: input.handedness,
      mode: input.targetRayMode,
      buttonsPressed: input.buttons.filter((button) => button.pressed).length,
      axes: Array.from(input.axes).map((axis) => Math.round(axis * 100) / 100),
      joints: input.joints.length,
      hasGrip: input.gripTransform !== undefined,
    })),
  };
  if (diagnostics !== undefined) {
    diagnostics.set(XR_COUNTERS.views, snapshot.views);
    diagnostics.set(XR_COUNTERS.inputs, snapshot.inputs.length);
    diagnostics.set(XR_COUNTERS.trackedHands, snapshot.inputs.filter((input) => input.joints > 0).length);
    if (previousTime !== undefined) diagnostics.set(XR_COUNTERS.frameTime, frame.time - previousTime);
  }
  return snapshot;
}

/** One-line form for a console or overlay. */
export function formatXrDebug(snapshot: XrDebugSnapshot): string {
  const head = snapshot.headPosition.map((value) => value.toFixed(2)).join(", ");
  const inputs = snapshot.inputs.map((input) => `${input.hand}:${input.mode}${input.joints > 0 ? `(${String(input.joints)}j)` : ""} b${String(input.buttonsPressed)}`).join(" ");
  return `xr t=${snapshot.time.toFixed(0)} ${snapshot.visibility} views=${String(snapshot.views)} head=[${head}] ${inputs}`.trimEnd();
}
