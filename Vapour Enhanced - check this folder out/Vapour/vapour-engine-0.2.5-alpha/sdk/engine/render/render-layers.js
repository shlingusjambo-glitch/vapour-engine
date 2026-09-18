import { LIGHT_STRIDE, normalizeLightRig } from "./lights.js";
import { ENVIRONMENT_STRIDE } from "./environment.js";
import { CAMERA_STRIDE } from "../core/frame-builder.js";
export const RENDER_LAYER_CLEAR_COLOR = 1;
export const RENDER_LAYER_CLEAR_DEPTH = 2;
export const RENDER_LAYER_HAS_CAMERA = 4;
export const RENDER_LAYER_HAS_LIGHT = 8;
export const RENDER_LAYER_HAS_ENVIRONMENT = 16;
export const RENDER_LAYER_HAS_PROJECTION = 32;
/** Packs a small number of camera layers into one WASM call. This function is
 * intentionally allocation-oriented: callers with a steady multi-view layout
 * should reuse the returned arrays through a future RenderLayerBuilder, while
 * migration bridges value a simple, fully validated boundary today. */
export function packRenderLayers(layers) {
    if (layers.length === 0)
        throw new Error("A render submission needs at least one layer.");
    const meshTable = [];
    const meshLookup = new Map();
    const materialTable = [];
    const materialLookup = new Map();
    let instanceCount = 0;
    for (const layer of layers)
        instanceCount += layer.frame.meshIndices.length;
    const meshIndices = new Uint32Array(instanceCount);
    const materialIndices = new Uint32Array(instanceCount);
    const matrices = new Float32Array(instanceCount * 16);
    const baseColors = new Float32Array(instanceCount * 4);
    const materialParams = new Float32Array(instanceCount * 4);
    const layerInstanceCounts = new Uint32Array(layers.length);
    const layerFlags = new Uint32Array(layers.length);
    const cameras = new Float32Array(layers.length * CAMERA_STRIDE);
    const environments = new Float32Array(layers.length * ENVIRONMENT_STRIDE);
    // A layer's rig is variable length, so the normalized records are collected
    // first and the shared buffer sized from the total.
    const layerLightCounts = new Uint32Array(layers.length);
    const anyTarget = layers.some((layer) => layer.target !== undefined);
    const anyViewport = layers.some((layer) => layer.viewport !== undefined);
    const layerTargets = anyTarget
        ? layers.map((layer) => layer.target ?? "")
        : [];
    const viewports = new Float32Array(anyViewport ? layers.length * 4 : 0);
    const anyProjection = layers.some((layer) => layer.projection !== undefined);
    const projections = new Float32Array(anyProjection ? layers.length * 16 : 0);
    const perLayerLights = layers.map((layer) => normalizeLightRig(layer.frame.light));
    let totalLightFloats = 0;
    for (const rig of perLayerLights)
        totalLightFloats += rig.length;
    const lights = new Float32Array(totalLightFloats);
    let lightOffset = 0;
    // Bone matrices are frame-global: each layer may contribute its own
    // skinned instances, so their palettes are concatenated in layer order and
    // each layer's per-instance offsets are rebased into that shared buffer.
    let totalBones = 0;
    for (const layer of layers)
        totalBones += (layer.frame.boneMatrices ?? EMPTY).length / 16;
    const boneOffsets = new Float32Array(instanceCount).fill(-1);
    const boneMatrices = new Float32Array(totalBones * 16);
    let boneFloatOffset = 0;
    let instanceOffset = 0;
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
        const layer = layers[layerIndex];
        const frame = layer.frame;
        validatePackedFrameForLayer(frame, layerIndex);
        if (layer.target !== undefined && layer.target.trim() === "")
            throw new Error(`Render layer ${String(layerIndex)} names an empty render target.`);
        if (anyViewport) {
            const rect = layer.viewport ?? { x: 0, y: 0, width: 1, height: 1 };
            const values = [rect.x, rect.y, rect.width, rect.height];
            if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
                rect.width <= 0 ||
                rect.height <= 0 ||
                rect.x + rect.width > 1.0001 ||
                rect.y + rect.height > 1.0001)
                throw new Error(`Render layer ${String(layerIndex)} viewport must be a non-empty rectangle inside [0, 1].`);
            viewports.set(values, layerIndex * 4);
        }
        if (layer.projection !== undefined) {
            if (layer.projection.length !== 16 || !Array.from(layer.projection).every(Number.isFinite))
                throw new Error(`Render layer ${String(layerIndex)} projection needs 16 finite values.`);
            projections.set(layer.projection, layerIndex * 16);
        }
        const count = frame.meshIndices.length;
        layerInstanceCounts[layerIndex] = count;
        let flags = 0;
        if (layer.projection !== undefined)
            flags |= RENDER_LAYER_HAS_PROJECTION;
        if (layer.clearColor ?? layerIndex === 0)
            flags |= RENDER_LAYER_CLEAR_COLOR;
        if (layer.clearDepth ?? layerIndex === 0)
            flags |= RENDER_LAYER_CLEAR_DEPTH;
        if (frame.camera.length !== 0) {
            flags |= RENDER_LAYER_HAS_CAMERA;
            cameras.set(frame.camera, layerIndex * CAMERA_STRIDE);
        }
        const rig = perLayerLights[layerIndex];
        if (rig.length !== 0) {
            flags |= RENDER_LAYER_HAS_LIGHT;
            lights.set(rig, lightOffset);
            layerLightCounts[layerIndex] = rig.length / LIGHT_STRIDE;
            lightOffset += rig.length;
        }
        const environment = frame.environment ?? EMPTY;
        if (environment.length !== 0) {
            flags |= RENDER_LAYER_HAS_ENVIRONMENT;
            environments.set(environment, layerIndex * ENVIRONMENT_STRIDE);
        }
        layerFlags[layerIndex] = flags;
        const meshRemap = frame.meshTable.map((id) => intern(id, meshTable, meshLookup));
        const materialRemap = frame.materialTable.map((id) => intern(id, materialTable, materialLookup));
        for (let index = 0; index < count; index += 1) {
            meshIndices[instanceOffset + index] =
                meshRemap[frame.meshIndices[index]];
            materialIndices[instanceOffset + index] =
                materialRemap[frame.materialIndices[index]];
        }
        matrices.set(frame.matrices, instanceOffset * 16);
        if (frame.baseColors.length === 0) {
            for (let index = 0; index < count; index += 1) {
                const offset = (instanceOffset + index) * 4;
                baseColors[offset] = 1;
                baseColors[offset + 1] = 1;
                baseColors[offset + 2] = 1;
                baseColors[offset + 3] = 1;
            }
        }
        else {
            baseColors.set(frame.baseColors, instanceOffset * 4);
        }
        if (frame.materialParams.length === 0) {
            for (let index = 0; index < count; index += 1) {
                const offset = (instanceOffset + index) * 4;
                materialParams[offset] = 0;
                materialParams[offset + 1] = 0.6;
                materialParams[offset + 2] = 0;
                materialParams[offset + 3] = 0.01;
            }
        }
        else {
            materialParams.set(frame.materialParams, instanceOffset * 4);
        }
        const layerBoneOffsets = frame.boneOffsets ?? EMPTY;
        const layerBoneMatrices = frame.boneMatrices ?? EMPTY;
        const layerBoneRebase = boneFloatOffset / 16;
        for (let index = 0; index < count; index += 1) {
            const offset = layerBoneOffsets[index];
            boneOffsets[instanceOffset + index] =
                offset === undefined || offset < 0 ? -1 : offset + layerBoneRebase;
        }
        boneMatrices.set(layerBoneMatrices, boneFloatOffset);
        boneFloatOffset += layerBoneMatrices.length;
        instanceOffset += count;
    }
    if ((layerFlags[0] & (RENDER_LAYER_CLEAR_COLOR | RENDER_LAYER_CLEAR_DEPTH)) !==
        (RENDER_LAYER_CLEAR_COLOR | RENDER_LAYER_CLEAR_DEPTH)) {
        throw new Error("The first presentation layer must clear both colour and depth.");
    }
    return {
        meshTable,
        meshIndices,
        materialTable,
        materialIndices,
        matrices,
        baseColors,
        materialParams,
        layerInstanceCounts,
        layerFlags,
        cameras,
        lights,
        layerLightCounts,
        environments,
        // Nothing skinned this frame is the overwhelmingly common case; an
        // all-(-1) offsets array carries no information, so it collapses to
        // empty rather than shipping `instanceCount` floats for nothing.
        boneOffsets: boneMatrices.length === 0 ? EMPTY : boneOffsets,
        boneMatrices,
        layerTargets,
        viewports,
        projections,
    };
}
/** Refuses a submission in which a layer samples the render target it draws
 * into, directly or through other targets rendered the same frame. Mirrors
 * `detect_render_target_cycle` in Rust, which the WebGPU host relies on; the
 * headless host runs this so CI sees the same error without a GPU.
 *
 * `layers` gives each layer's destination (undefined for the surface) and
 * the render targets its materials sample. Throws naming the target and the
 * chain that closes the loop. */
export function detectRenderTargetCycle(layers) {
    const edges = new Map();
    for (const layer of layers) {
        if (layer.target === undefined)
            continue;
        const sampled = edges.get(layer.target) ?? new Set();
        for (const sample of layer.samples)
            sampled.add(sample);
        edges.set(layer.target, sampled);
    }
    const walk = (start, current, path, visited) => {
        for (const next of [...(edges.get(current) ?? [])].sort()) {
            if (next === start)
                return [...path, next];
            if (visited.has(next))
                continue;
            visited.add(next);
            const cycle = walk(start, next, [...path, next], visited);
            if (cycle !== undefined)
                return cycle;
        }
        return undefined;
    };
    for (const start of [...edges.keys()].sort()) {
        const cycle = walk(start, start, [start], new Set());
        if (cycle !== undefined)
            throw new Error(`Render target '${start}' is sampled by a layer that renders into it (${cycle.join(" -> ")}); a camera cannot read the texture it writes.`);
    }
}
function intern(id, table, lookup) {
    const existing = lookup.get(id);
    if (existing !== undefined)
        return existing;
    const index = table.length;
    table.push(id);
    lookup.set(id, index);
    return index;
}
function validatePackedFrameForLayer(frame, layer) {
    const count = frame.meshIndices.length;
    if (frame.materialIndices.length !== count ||
        frame.matrices.length !== count * 16 ||
        (frame.baseColors.length !== 0 && frame.baseColors.length !== count * 4) ||
        (frame.materialParams.length !== 0 &&
            frame.materialParams.length !== count * 4)) {
        throw new Error(`Render layer ${String(layer)} has inconsistent instance-array lengths.`);
    }
    const environment = frame.environment;
    if (environment !== undefined &&
        environment.length !== 0 &&
        environment.length !== ENVIRONMENT_STRIDE) {
        throw new Error(`Render layer ${String(layer)} environment needs ${String(ENVIRONMENT_STRIDE)} values.`);
    }
    if (frame.camera.length !== 0 && frame.camera.length !== CAMERA_STRIDE)
        throw new Error(`Render layer ${String(layer)} camera needs ${String(CAMERA_STRIDE)} values.`);
    if (frame.light.length !== 0 &&
        frame.light.length !== 7 &&
        frame.light.length % LIGHT_STRIDE !== 0) {
        throw new Error(`Render layer ${String(layer)} light needs 7 values or a whole number of ${String(LIGHT_STRIDE)}-float lights.`);
    }
    for (const index of frame.meshIndices)
        if (index >= frame.meshTable.length)
            throw new Error(`Render layer ${String(layer)} has an invalid mesh-table index.`);
    for (const index of frame.materialIndices)
        if (index >= frame.materialTable.length)
            throw new Error(`Render layer ${String(layer)} has an invalid material-table index.`);
}
const EMPTY = new Float32Array(0);
/** Rewrites a [-1, 1]-depth projection (WebXR, OpenGL) into the [0, 1]
 * depth range the renderer expects: z' = 0.5 z + 0.5 w. */
export function projectionToWebGpuDepth(projection) {
    if (projection.length !== 16)
        throw new Error("A projection matrix needs 16 values.");
    const out = Float32Array.from(projection);
    // Row 2 of the result is 0.5 × row 2 + 0.5 × row 3; column-major, row 2
    // of column c sits at c * 4 + 2 and row 3 at c * 4 + 3.
    for (let column = 0; column < 4; column += 1) {
        out[column * 4 + 2] = 0.5 * projection[column * 4 + 2] + 0.5 * projection[column * 4 + 3];
    }
    return out;
}
/** The vertical field of view (degrees), near, and far a perspective
 * projection encodes, for the camera record that accompanies an explicit
 * projection. An infinite far plane reports `Infinity`. */
export function projectionExtent(projection, depthRange) {
    if (projection.length !== 16)
        throw new Error("A projection matrix needs 16 values.");
    const m5 = projection[5];
    const m10 = projection[10];
    const m14 = projection[14];
    if (!(m5 > 0))
        throw new Error("A perspective projection needs a positive y scale.");
    const fieldOfViewDegrees = (2 * Math.atan(1 / m5) * 180) / Math.PI;
    // [0, 1]:  m10 = f / (n - f),        m14 = n f / (n - f)
    // [-1, 1]: m10 = (n + f) / (n - f),  m14 = 2 n f / (n - f)
    const near = depthRange === "zero-to-one" ? m14 / m10 : m14 / (m10 - 1);
    // Both conventions put the far plane at m14 / (m10 + 1); an infinite far
    // plane drives m10 to exactly -1.
    const far = m10 + 1 === 0 ? Number.POSITIVE_INFINITY : m14 / (m10 + 1);
    if (!(near > 0) || !(far > near))
        throw new Error("A perspective projection needs 0 < near < far.");
    return { fieldOfViewDegrees, near, far };
}
//# sourceMappingURL=render-layers.js.map