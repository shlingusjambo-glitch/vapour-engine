export declare const ENVIRONMENT_STRIDE = 24;
export declare const FOG_NONE = 0;
export declare const FOG_LINEAR = 1;
export declare const FOG_EXPONENTIAL = 2;
export type LinearColor = readonly [number, number, number];
export type LinearColorAlpha = readonly [number, number, number, number];
export type FogSettings = {
    readonly mode: "linear";
    readonly color: LinearColor;
    readonly near: number;
    readonly far: number;
} | {
    readonly mode: "exponential";
    readonly color: LinearColor;
    readonly density: number;
};
export interface EnvironmentSettings {
    readonly clearColor: LinearColorAlpha;
    readonly fog?: FogSettings;
    /** Camera-centred procedural sky rendered at infinite distance. */
    readonly sky?: ProceduralSkySettings;
}
export interface ProceduralSkySettings {
    readonly mode: "procedural";
    /** Linear HDR colours; values above one are allowed. */
    readonly zenithColor: LinearColor;
    readonly horizonColor: LinearColor;
    readonly groundColor: LinearColor;
    /** Gradient exponent. One is linear; larger values tighten the horizon. */
    readonly horizonCurve?: number;
    /** Visible directional-light disc radius in radians. */
    readonly sunAngularRadius?: number;
}
/** Packs clear and fog state into three aligned vec4 lanes shared with WGSL. */
export declare function packEnvironment(settings: EnvironmentSettings, target?: Float32Array<ArrayBuffer>): Float32Array;
//# sourceMappingURL=environment.d.ts.map