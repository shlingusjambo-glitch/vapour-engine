export interface BrowserCapabilities {
  readonly secureContext: boolean;
  readonly webgpu: boolean;
  readonly webxr: boolean;
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly wasmSimd: boolean;
}

export type CapabilitySeverity = "error" | "warning";

export interface CapabilityDiagnostic {
  readonly code: string;
  readonly severity: CapabilitySeverity;
  readonly message: string;
  readonly remediation: string;
}

const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
  0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00,
  0x41, 0x00, 0xfd, 0x0f, 0x0b,
]);

export function detectBrowserCapabilities(scope: typeof globalThis = globalThis): BrowserCapabilities {
  const navigatorValue = "navigator" in scope ? scope.navigator : undefined;
  return {
    secureContext: "isSecureContext" in scope ? scope.isSecureContext : false,
    webgpu: navigatorValue !== undefined && "gpu" in navigatorValue,
    webxr: navigatorValue !== undefined && "xr" in navigatorValue,
    crossOriginIsolated:
      "crossOriginIsolated" in scope ? scope.crossOriginIsolated : false,
    sharedArrayBuffer: "SharedArrayBuffer" in scope,
    wasmSimd: typeof WebAssembly !== "undefined" && WebAssembly.validate(SIMD_PROBE),
  };
}

export function diagnoseCapabilities(capabilities: BrowserCapabilities): CapabilityDiagnostic[] {
  const diagnostics: CapabilityDiagnostic[] = [];
  if (!capabilities.secureContext) {
    diagnostics.push({
      code: "browser.insecure-context",
      severity: "error",
      message: "Vapour needs a secure context for WebGPU and WebXR.",
      remediation: "Use HTTPS, or localhost during development.",
    });
  }
  if (!capabilities.webgpu) {
    diagnostics.push({
      code: "renderer.webgpu-unavailable",
      severity: "error",
      message: "This browser does not expose WebGPU.",
      remediation: "Update the browser and verify that WebGPU is enabled for this device.",
    });
  }
  if (!capabilities.crossOriginIsolated || !capabilities.sharedArrayBuffer) {
    diagnostics.push({
      code: "runtime.single-threaded",
      severity: "warning",
      message: "Cross-origin isolation is disabled; worker-shared simulation is unavailable.",
      remediation:
        "Serve with COOP: same-origin and COEP: require-corp. Vapour's dev server does this automatically.",
    });
  }
  if (!capabilities.webxr) {
    diagnostics.push({
      code: "xr.unavailable",
      severity: "warning",
      message: "WebXR is unavailable; non-XR play remains supported.",
      remediation: "Use a WebXR-capable browser and headset for XR preview.",
    });
  }
  return diagnostics;
}

