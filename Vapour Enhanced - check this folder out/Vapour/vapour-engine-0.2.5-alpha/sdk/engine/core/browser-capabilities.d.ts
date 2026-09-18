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
export declare function detectBrowserCapabilities(scope?: typeof globalThis): BrowserCapabilities;
export declare function diagnoseCapabilities(capabilities: BrowserCapabilities): CapabilityDiagnostic[];
//# sourceMappingURL=browser-capabilities.d.ts.map