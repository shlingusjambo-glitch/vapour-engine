export const XR_COUNTERS = {
    views: "xr.views",
    inputs: "xr.inputs",
    trackedHands: "xr.trackedHands",
    frameTime: "xr.frameTime",
};
/** Probes the browser without starting a session. */
export async function detectXrCapabilities(scope = globalThis) {
    const navigatorValue = "navigator" in scope ? scope.navigator : undefined;
    const xr = navigatorValue?.xr;
    const modes = { inline: false, "immersive-vr": false, "immersive-ar": false };
    if (xr !== undefined) {
        for (const mode of Object.keys(modes)) {
            try {
                modes[mode] = await xr.isSessionSupported(mode);
            }
            catch {
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
export function diagnoseXrCapabilities(capabilities) {
    const diagnostics = [];
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
/**
 * Requests fixed foveation on a projection layer and reports what happened.
 *
 * Levels follow the WebXR layers spec: 0 none … 3 maximum. A layer without
 * the property is reported as unsupported rather than throwing, because a
 * game asks for this as an optimisation, never a requirement.
 */
export function setFoveation(layer, level) {
    if (![0, 1, 2, 3].includes(level))
        throw new Error("Foveation level must be 0, 1, 2, or 3.");
    const target = layer;
    if (target === null || target === undefined || !("fixedFoveation" in target))
        return { supported: false, requested: level, applied: undefined };
    // The spec maps the integer level onto [0, 1].
    target.fixedFoveation = level / 3;
    return { supported: true, requested: level, applied: target.fixedFoveation };
}
/** What a granted session actually supports. */
export function inspectSession(session, mode, referenceSpace, foveation) {
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
/** Summarises a frame and records the counts into diagnostics. */
export function debugXrFrame(frame, diagnostics, previousTime) {
    const snapshot = {
        time: frame.time,
        visibility: frame.visibilityState,
        views: frame.views.length,
        headPosition: [frame.viewerTransform[12], frame.viewerTransform[13], frame.viewerTransform[14]],
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
        if (previousTime !== undefined)
            diagnostics.set(XR_COUNTERS.frameTime, frame.time - previousTime);
    }
    return snapshot;
}
/** One-line form for a console or overlay. */
export function formatXrDebug(snapshot) {
    const head = snapshot.headPosition.map((value) => value.toFixed(2)).join(", ");
    const inputs = snapshot.inputs.map((input) => `${input.hand}:${input.mode}${input.joints > 0 ? `(${String(input.joints)}j)` : ""} b${String(input.buttonsPressed)}`).join(" ");
    return `xr t=${snapshot.time.toFixed(0)} ${snapshot.visibility} views=${String(snapshot.views)} head=[${head}] ${inputs}`.trimEnd();
}
//# sourceMappingURL=xr-capabilities.js.map