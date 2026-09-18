export const ENVIRONMENT_STRIDE = 24;
export const FOG_NONE = 0;
export const FOG_LINEAR = 1;
export const FOG_EXPONENTIAL = 2;
/** Packs clear and fog state into three aligned vec4 lanes shared with WGSL. */
export function packEnvironment(settings, target = new Float32Array(ENVIRONMENT_STRIDE)) {
    if (target.length !== ENVIRONMENT_STRIDE)
        throw new Error(`An environment target needs ${String(ENVIRONMENT_STRIDE)} values.`);
    const clear = settings.clearColor;
    for (const value of clear)
        if (!Number.isFinite(value))
            throw new Error("Environment clear color must be finite.");
    target.fill(0);
    target.set(clear, 0);
    const fog = settings.fog;
    if (fog !== undefined) {
        for (const value of fog.color)
            if (!Number.isFinite(value))
                throw new Error("Fog color must be finite.");
        target.set(fog.color, 4);
    }
    if (fog?.mode === "linear") {
        if (!Number.isFinite(fog.near) ||
            !Number.isFinite(fog.far) ||
            fog.near < 0 ||
            fog.far <= fog.near) {
            throw new Error("Linear fog must satisfy 0 <= near < far.");
        }
        target[7] = FOG_LINEAR;
        target[8] = fog.near;
        target[9] = fog.far;
    }
    else if (fog?.mode === "exponential") {
        if (!Number.isFinite(fog.density) || fog.density < 0)
            throw new Error("Exponential fog density must be finite and non-negative.");
        target[7] = FOG_EXPONENTIAL;
        target[10] = fog.density;
    }
    const sky = settings.sky;
    if (sky === undefined)
        return target;
    for (const [name, color] of [
        ["zenith", sky.zenithColor],
        ["horizon", sky.horizonColor],
        ["ground", sky.groundColor],
    ]) {
        for (const value of color)
            if (!Number.isFinite(value) || value < 0)
                throw new Error(`Procedural sky ${name} color must be finite and non-negative.`);
    }
    const curve = sky.horizonCurve ?? 0.65;
    const sunRadius = sky.sunAngularRadius ?? 0.00465;
    if (!Number.isFinite(curve) || curve <= 0)
        throw new Error("Procedural sky horizonCurve must be finite and positive.");
    if (!Number.isFinite(sunRadius) || sunRadius <= 0 || sunRadius > Math.PI / 2)
        throw new Error("Procedural sky sunAngularRadius must be finite and in (0, pi/2].");
    target.set(sky.zenithColor, 12);
    target[15] = 1;
    target.set(sky.horizonColor, 16);
    target[19] = curve;
    target.set(sky.groundColor, 20);
    target[23] = sunRadius;
    return target;
}
//# sourceMappingURL=environment.js.map