/** Resource upload descriptions and their validation.
 *
 * Meshes, textures, and materials cross into Rust as flat typed arrays plus a
 * JSON descriptor. Validating here — before the boundary — means a malformed
 * upload reports which field was wrong in TypeScript, where the call site is,
 * instead of surfacing as an opaque error from the renderer.
 */
export const MAX_ENVIRONMENT_FACE_SIZE = 2048;
export function validateRenderTargetSize(id, size) {
    if (id.trim() === "" || id.startsWith("builtin:"))
        throw new Error("A render target needs a non-empty, non-reserved identifier.");
    if ("scale" in size) {
        if (!Number.isFinite(size.scale) || size.scale <= 0 || size.scale > 4)
            throw new Error(`Render target '${id}' scale must be finite and in (0, 4].`);
        return;
    }
    if (!Number.isInteger(size.width) ||
        size.width < 1 ||
        !Number.isInteger(size.height) ||
        size.height < 1)
        throw new Error(`Render target '${id}' needs positive integer dimensions.`);
}
export function validateEnvironmentUpload(environment) {
    if (!Number.isInteger(environment.faceSize) ||
        environment.faceSize < 1 ||
        environment.faceSize > MAX_ENVIRONMENT_FACE_SIZE) {
        throw new Error(`An environment map needs an integer face size in [1, ${String(MAX_ENVIRONMENT_FACE_SIZE)}].`);
    }
    const expected = environment.faceSize * environment.faceSize * 4 * 6;
    if (environment.faces.length !== expected)
        throw new Error(`An environment map of face size ${String(environment.faceSize)} needs ${String(expected)} RGBA8 bytes, received ${String(environment.faces.length)}.`);
    validateEnvironmentIntensity(environment.intensity ?? 1);
}
export function validateEnvironmentIntensity(intensity) {
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 64)
        throw new Error("Environment intensity must be finite and in [0, 64].");
}
export function validateTextureUpload(id, texture) {
    if (id.trim() === "" || id.startsWith("builtin:"))
        throw new Error("A texture needs a non-empty, non-reserved identifier.");
    if (!Number.isInteger(texture.width) ||
        texture.width < 1 ||
        !Number.isInteger(texture.height) ||
        texture.height < 1) {
        throw new Error(`Texture '${id}' needs positive integer dimensions.`);
    }
    const expected = texture.width * texture.height * 4;
    if (!Number.isSafeInteger(expected) || texture.pixels.length !== expected) {
        throw new Error(`Texture '${id}' needs ${String(expected)} RGBA8 bytes, received ${String(texture.pixels.length)}.`);
    }
}
export function validateMaterialUpload(id, material, hasTexture) {
    if (id.trim() === "" || id.startsWith("builtin:"))
        throw new Error("A material needs a non-empty, non-reserved identifier.");
    if (![1, 2, 4, 8, 16].includes(material.anisotropy ?? 1) || ((material.anisotropy ?? 1) > 1 && material.filter === "nearest"))
        throw new Error(`Material '${id}' anisotropy must be 1, 2, 4, 8 or 16 and requires linear filtering.`);
    const numbers = [
        ...(material.baseColor ?? [1, 1, 1, 1]),
        ...(material.emission ?? [1, 1, 1]),
        ...(material.uvScale ?? [1, 1]),
        ...(material.uvOffset ?? [0, 0]),
        material.normalScale ?? 1,
        material.occlusionStrength ?? 1,
        material.atlas?.columns ?? 1,
        material.atlas?.rows ?? 1,
        material.atlas?.inset ?? 0,
    ];
    if (numbers.some((value) => !Number.isFinite(value)))
        throw new Error(`Material '${id}' contains a non-finite number.`);
    if (material.atlas !== undefined) {
        if (!Number.isInteger(material.atlas.columns) ||
            material.atlas.columns < 1 ||
            !Number.isInteger(material.atlas.rows) ||
            material.atlas.rows < 1) {
            throw new Error(`Material '${id}' atlas needs positive integer columns and rows.`);
        }
        const inset = material.atlas.inset ?? 0;
        if (inset < 0 || inset >= 0.5)
            throw new Error(`Material '${id}' atlas inset must be in [0, 0.5).`);
    }
    if (material.coverageMode !== undefined &&
        material.coverageMode !== "alpha" &&
        material.coverageMode !== "sdf") {
        throw new Error(`Material '${id}' coverageMode must be alpha or sdf.`);
    }
    for (const textureId of Object.values(material.textures ?? {})) {
        if (!hasTexture(textureId))
            throw new Error(`Material '${id}' references missing texture '${textureId}'.`);
    }
}
//# sourceMappingURL=uploads.js.map