import { LIGHT_STRIDE } from "./lights.js";
import { ENVIRONMENT_STRIDE } from "./environment.js";
import { CAMERA_STRIDE } from "../core/frame-builder.js";
import { validateEnvironmentIntensity, validateEnvironmentUpload, validateMaterialUpload, validateTextureUpload, validateRenderTargetSize, } from "./host/index.js";
import { detectRenderTargetCycle, } from "./render-layers.js";
import { DECAL_STRIDE } from "./decals.js";
/**
 * Explicit no-GPU render host for automated gameplay tests, dedicated servers,
 * import validation, and CI. It validates the same public mesh/frame contract
 * and computes workload statistics but never creates a graphics context.
 *
 * This is not selected automatically when WebGPU fails. Shipping games still
 * receive the actionable WebGPU error instead of a misleading blank fallback.
 */
export class HeadlessRenderHost extends EventTarget {
    #meshes = new Map();
    #textures = new Map();
    #materials = new Map();
    #renderTargets = new Map();
    #initialized = false;
    #destroyed = false;
    #lastTime = 0;
    #postProcess = { exposure: 1, toneMapping: "aces" };
    #environment;
    #decalCount = 0;
    #snapshot = {
        drawCalls: 0,
        triangles: 0,
        instances: 0,
        meshIds: [],
    };
    get initialized() {
        return this.#initialized && !this.#destroyed;
    }
    async initialize() {
        if (this.#destroyed)
            throw new Error("Cannot initialize a destroyed headless render host.");
        this.#initialized = true;
    }
    uploadMesh(id, mesh) {
        this.#requireAlive();
        validateMesh(id, mesh);
        this.#meshes.set(id, mesh);
    }
    releaseMesh(id) {
        this.#requireAlive();
        return this.#meshes.delete(id);
    }
    meshIds() {
        return [...this.#meshes.keys()];
    }
    uploadTexture(id, texture) {
        this.#requireAlive();
        validateTextureUpload(id, texture);
        this.#textures.set(id, texture);
    }
    releaseTexture(id) {
        this.#requireAlive();
        for (const [materialId, material] of this.#materials) {
            if (Object.values(material.textures ?? {}).includes(id))
                throw new Error(`Texture '${id}' is still used by material '${materialId}'.`);
        }
        return this.#textures.delete(id);
    }
    createRenderTarget(id, size) {
        this.#requireAlive();
        validateRenderTargetSize(id, size);
        if (this.#textures.has(id))
            throw new Error(`Render target '${id}' collides with an uploaded texture.`);
        this.#renderTargets.set(id, size);
    }
    releaseRenderTarget(id) {
        this.#requireAlive();
        for (const [materialId, material] of this.#materials)
            if (Object.values(material.textures ?? {}).includes(id))
                throw new Error(`Render target '${id}' is still used by material '${materialId}'.`);
        return this.#renderTargets.delete(id);
    }
    renderTargetIds() {
        return [...this.#renderTargets.keys()];
    }
    defineMaterial(id, material) {
        this.#requireAlive();
        validateMaterialUpload(id, material, (textureId) => this.#textures.has(textureId) || this.#renderTargets.has(textureId));
        this.#materials.set(id, material);
    }
    releaseMaterial(id) {
        this.#requireAlive();
        return this.#materials.delete(id);
    }
    uploadEnvironment(environment) {
        this.#requireAlive();
        validateEnvironmentUpload(environment);
        this.#environment = environment;
    }
    deriveEnvironmentFromSky(intensity = 1) {
        this.#requireAlive();
        validateEnvironmentIntensity(intensity);
        this.#environment = "sky";
    }
    clearEnvironment() {
        this.#requireAlive();
        this.#environment = undefined;
    }
    submitDecals(decals, atlasTexture) {
        this.#requireAlive();
        if (decals.length % DECAL_STRIDE !== 0)
            throw new Error(`Decals need ${String(DECAL_STRIDE)} values each; received ${String(decals.length)}.`);
        if (atlasTexture !== undefined && !this.#textures.has(atlasTexture))
            throw new Error(`Decal atlas texture '${atlasTexture}' has not been uploaded.`);
        this.#decalCount = decals.length / DECAL_STRIDE;
    }
    decalCount() {
        return this.#decalCount;
    }
    /** What lights the scene's ambient term: an uploaded map, the captured
     * sky, or nothing (the analytic gradient). */
    environment() {
        return this.#environment;
    }
    setPostProcess(settings) {
        this.#requireAlive();
        if (!Number.isFinite(settings.exposure) ||
            settings.exposure < 0 ||
            settings.exposure > 64)
            throw new Error("HDR exposure must be finite and in [0, 64].");
        if (!["none", "reinhard", "aces"].includes(settings.toneMapping))
            throw new Error(`Unknown tone mapping mode '${String(settings.toneMapping)}'.`);
        for (const [name, value, maximum] of [
            ["Bloom intensity", settings.bloom?.intensity ?? 0, 10],
            ["Bloom threshold", settings.bloom?.threshold ?? 1, 64],
            ["Bloom scatter", settings.bloom?.scatter ?? 0.5, 1],
            ["Saturation", settings.saturation ?? 1, 4],
            ["Contrast", settings.contrast ?? 1, 4],
            ["Vignette", settings.vignette ?? 0, 1],
            ["Chromatic aberration", settings.chromaticAberration ?? 0, 1],
        ])
            if (!Number.isFinite(value) || value < 0 || value > maximum)
                throw new Error(`${name} must be finite and in [0, ${String(maximum)}].`);
        this.#postProcess = { ...settings };
    }
    postProcess() {
        return this.#postProcess;
    }
    submitFrame(frame) {
        this.#requireReady();
        this.#snapshot = this.#measureFrames([frame]);
    }
    submitLayers(layers) {
        this.#requireReady();
        if (layers.length === 0)
            throw new Error("A render submission needs at least one layer.");
        for (const [index, layer] of layers.entries())
            if (layer.target !== undefined && !this.#renderTargets.has(layer.target))
                throw new Error(`Render layer ${String(index)} renders into '${layer.target}', which is not a render target.`);
        detectRenderTargetCycle(layers.map((layer) => ({
            target: layer.target,
            samples: layer.frame.materialTable.flatMap((materialId) => Object.values(this.#materials.get(materialId)?.textures ?? {}).filter((textureId) => this.#renderTargets.has(textureId))),
        })));
        this.#snapshot = this.#measureFrames(layers.map((layer) => layer.frame));
    }
    #measureFrames(frames) {
        let drawCalls = 0;
        let triangles = 0;
        let instances = 0;
        const meshIds = new Set();
        for (const frame of frames) {
            validateFrame(frame);
            const distinct = new Set();
            for (const meshIndex of frame.meshIndices) {
                if (meshIndex >= frame.meshTable.length) {
                    throw new Error(`Frame mesh index ${String(meshIndex)} is outside table length ${String(frame.meshTable.length)}.`);
                }
                const id = frame.meshTable[meshIndex];
                const mesh = this.#meshes.get(id);
                if (mesh === undefined && !id.startsWith("builtin:"))
                    throw new Error(`Frame references missing mesh '${id}'.`);
                distinct.add(meshIndex);
                meshIds.add(id);
                if (mesh !== undefined)
                    triangles += mesh.indices.length / 3;
            }
            for (let index = 0; index < frame.materialIndices.length; index += 1) {
                const materialIndex = frame.materialIndices[index];
                if (materialIndex >= frame.materialTable.length)
                    throw new Error(`Frame material index ${String(materialIndex)} is outside table length ${String(frame.materialTable.length)}.`);
                const id = frame.materialTable[materialIndex];
                if (id !== "builtin:default" && !this.#materials.has(id))
                    throw new Error(`Frame references missing material '${id}'.`);
            }
            drawCalls += distinct.size;
            instances += frame.meshIndices.length;
        }
        return { drawCalls, triangles, instances, meshIds: [...meshIds] };
    }
    renderFrame(timeMilliseconds) {
        this.#requireReady();
        const delta = this.#lastTime === 0
            ? 1000 / 60
            : Math.max(0.001, timeMilliseconds - this.#lastTime);
        this.#lastTime = timeMilliseconds;
        return {
            fps: 1000 / delta,
            frameTimeMs: delta,
            cpuEncodeMs: 0,
            drawCalls: this.#snapshot.drawCalls,
            triangles: this.#snapshot.triangles,
            culling: "cpu",
        };
    }
    snapshot() {
        return this.#snapshot;
    }
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        this.#initialized = false;
        this.#meshes.clear();
        this.#materials.clear();
        this.#textures.clear();
    }
    #requireAlive() {
        if (this.#destroyed)
            throw new Error("Headless render host is destroyed.");
    }
    #requireReady() {
        this.#requireAlive();
        if (!this.#initialized)
            throw new Error("Headless render host is not initialized.");
    }
}
function validateMesh(id, mesh) {
    if (id.trim() === "")
        throw new Error("A headless mesh needs a non-empty identifier.");
    if (mesh.positions.length === 0 || mesh.positions.length % 3 !== 0)
        throw new Error(`Mesh '${id}' has invalid positions.`);
    if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0)
        throw new Error(`Mesh '${id}' has invalid triangle indices.`);
    const vertexCount = mesh.positions.length / 3;
    const attributes = [
        ["normals", mesh.normals, 3],
        ["uvs", mesh.uvs, 2],
        ["colors", mesh.colors, 4],
        ["tangents", mesh.tangents, 4],
        ["textureLayers", mesh.textureLayers, 1],
    ];
    for (const [name, values, stride] of attributes) {
        if (values !== undefined && values.length !== vertexCount * stride) {
            throw new Error(`Mesh '${id}' ${name} length does not match its ${String(vertexCount)} vertices.`);
        }
    }
    for (const index of mesh.indices)
        if (index >= vertexCount)
            throw new Error(`Mesh '${id}' index ${String(index)} is out of range.`);
}
function validateFrame(frame) {
    const count = frame.meshIndices.length;
    if (frame.materialIndices.length !== count)
        throw new Error("Frame material index array length does not match its instances.");
    if (frame.matrices.length !== count * 16)
        throw new Error("Frame matrix array length does not match its instances.");
    if (frame.baseColors.length !== 0 && frame.baseColors.length !== count * 4)
        throw new Error("Frame color array length does not match its instances.");
    if (frame.materialParams.length !== 0 &&
        frame.materialParams.length !== count * 4)
        throw new Error("Frame material array length does not match its instances.");
    if (frame.camera.length !== 0 && frame.camera.length !== CAMERA_STRIDE)
        throw new Error(`Frame camera requires ${String(CAMERA_STRIDE)} values.`);
    if (frame.light.length !== 0 &&
        frame.light.length !== 7 &&
        frame.light.length % LIGHT_STRIDE !== 0) {
        throw new Error(`Frame light requires 7 values or a whole number of ${String(LIGHT_STRIDE)}-float lights.`);
    }
    if (frame.environment !== undefined &&
        frame.environment.length !== 0 &&
        frame.environment.length !== ENVIRONMENT_STRIDE) {
        throw new Error(`Frame environment requires ${String(ENVIRONMENT_STRIDE)} values.`);
    }
    for (const value of [
        frame.matrices,
        frame.baseColors,
        frame.materialParams,
        frame.camera,
        frame.light,
        frame.environment ?? EMPTY,
    ]) {
        for (const number of value)
            if (!Number.isFinite(number))
                throw new Error("Frame contains a non-finite number.");
    }
}
const EMPTY = new Float32Array(0);
//# sourceMappingURL=headless-render-host.js.map