import { importGltfResources } from "./gltf-resources.js";
/** Imports glTF 2.0 JSON or GLB into renderer-ready typed arrays. External
 * resources go through an injected resolver, so the same importer works in the
 * browser editor, CLI, workers, and tests without hidden filesystem access. */
export async function importGltf(source, options = {}) {
    const name = options.sourceName ?? "glTF asset";
    let json;
    let binaryChunk;
    try {
        if (typeof source === "string")
            json = JSON.parse(source);
        else {
            const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
            ({ json, binary: binaryChunk } = parseBinaryOrJson(bytes));
        }
    }
    catch (error) {
        throw new Error(`${name} could not be parsed as glTF 2.0 or GLB: ${message(error)}`, { cause: error });
    }
    if (json.asset?.version !== "2.0")
        throw new Error(`${name} uses unsupported glTF version '${String(json.asset?.version)}'; Vapour requires glTF 2.0.`);
    if (json.extensionsRequired?.length)
        throw new Error(`${name} requires unsupported extensions: ${json.extensionsRequired.join(', ')}.`);
    const warnings = (json.extensionsUsed ?? []).map(extension => `${name}: optional extension '${extension}' is not interpreted; core glTF fallback is used.`);
    const buffers = await loadBuffers(json, binaryChunk, options, name);
    const { images, textures } = await importGltfResources(json, buffers, name, options.resolveUri);
    const primitives = [];
    const meshPrimitives = [];
    for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
        const child = [];
        for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
            if ((primitive.mode ?? 4) !== 4)
                throw new Error(`${name} mesh ${String(meshIndex)} primitive ${String(primitiveIndex)} uses mode ${String(primitive.mode)}; only TRIANGLES (4) can be imported as a render mesh.`);
            const positionAccessor = primitive.attributes.POSITION;
            if (positionAccessor === undefined)
                throw new Error(`${name} mesh ${String(meshIndex)} primitive ${String(primitiveIndex)} has no POSITION attribute.`);
            const positions = floatAttribute(json, buffers, positionAccessor, 3, "POSITION", name);
            const count = positions.length / 3;
            const normals = primitive.attributes.NORMAL === undefined
                ? undefined
                : floatAttribute(json, buffers, primitive.attributes.NORMAL, 3, "NORMAL", name, count);
            const uvs = primitive.attributes.TEXCOORD_0 === undefined
                ? undefined
                : floatAttribute(json, buffers, primitive.attributes.TEXCOORD_0, 2, "TEXCOORD_0", name, count);
            const tangents = primitive.attributes.TANGENT === undefined
                ? undefined
                : floatAttribute(json, buffers, primitive.attributes.TANGENT, 4, "TANGENT", name, count);
            let colors;
            if (primitive.attributes.COLOR_0 !== undefined) {
                const accessor = requireAccessor(json, primitive.attributes.COLOR_0, name);
                const components = componentCount(accessor.type, name);
                const raw = floatAttribute(json, buffers, primitive.attributes.COLOR_0, components, "COLOR_0", name, count);
                colors = components === 4 ? raw : expandRgb(raw);
            }
            const indices = primitive.indices === undefined
                ? sequentialIndices(count)
                : indexAttribute(json, buffers, primitive.indices, name);
            if (indices.length % 3 !== 0)
                throw new Error(`${name} mesh ${String(meshIndex)} primitive ${String(primitiveIndex)} index count is not divisible by three.`);
            if (indices.some((index) => index >= count))
                throw new Error(`${name} mesh ${String(meshIndex)} primitive ${String(primitiveIndex)} contains an index outside its ${String(count)} vertices.`);
            if (primitive.material !== undefined)
                integerIndex(primitive.material, json.materials?.length ?? 0, `${name} primitive material`);
            child.push(primitives.length);
            primitives.push(Object.freeze({
                id: `${mesh.name?.trim() || `mesh-${String(meshIndex)}`}:${String(primitiveIndex)}`,
                mesh: Object.freeze({
                    positions,
                    indices,
                    ...(normals === undefined ? {} : { normals }),
                    ...(uvs === undefined ? {} : { uvs }),
                    ...(tangents === undefined ? {} : { tangents }),
                    ...(colors === undefined ? {} : { colors }),
                }),
                ...(primitive.material === undefined
                    ? {}
                    : { material: primitive.material }),
            }));
        }
        meshPrimitives.push(child);
    }
    const materials = (json.materials ?? []).map((material, index) => parseMaterial(material, index, textures.length, name));
    const nodes = (json.nodes ?? []).map((node, index) => parseNode(node, index, json.meshes?.length ?? 0));
    for (const [index, node] of nodes.entries())
        for (const child of node.children)
            integerIndex(child, nodes.length, `${name} node ${String(index)} child`);
    const parents = new Int32Array(nodes.length).fill(-1);
    for (const [index, node] of nodes.entries())
        for (const child of node.children) {
            if (parents[child] !== -1)
                throw new Error(`${name} node ${child} has multiple parents.`);
            parents[child] = index;
        }
    const visited = new Uint8Array(nodes.length);
    const visit = (index) => {
        if (visited[index] === 1)
            throw new Error(`${name} node hierarchy contains a cycle at ${index}.`);
        if (visited[index] === 2)
            return;
        visited[index] = 1;
        for (const child of nodes[index].children)
            visit(child);
        visited[index] = 2;
    };
    nodes.forEach((_, index) => visit(index));
    const scenes = (json.scenes ?? [{ nodes: nodes.map((_, index) => index).filter(index => parents[index] === -1) }]).map((scene, index) => {
        const roots = scene.nodes ?? [];
        for (const node of roots) {
            integerIndex(node, nodes.length, `${name} scene ${String(index)} node`);
            if (parents[node] !== -1)
                throw new Error(`${name} scene ${index} root ${node} has a parent.`);
        }
        if (new Set(roots).size !== roots.length)
            throw new Error(`${name} scene ${index} has duplicate roots.`);
        return Object.freeze([...roots]);
    });
    const defaultScene = json.scene ?? 0;
    if (scenes.length > 0)
        integerIndex(defaultScene, scenes.length, `${name} default scene`);
    const frozenMeshPrimitives = meshPrimitives.map((value) => Object.freeze([...value]));
    return Object.freeze({
        images, textures, warnings,
        primitives,
        meshPrimitives: frozenMeshPrimitives,
        materials,
        nodes,
        scenes,
        defaultScene,
    });
}
function parseBinaryOrJson(bytes) {
    if (bytes.byteLength >= 4 &&
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === 0x46546c67)
        return parseGlb(bytes);
    return { json: JSON.parse(new TextDecoder().decode(bytes)) };
}
function parseGlb(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 20)
        throw new Error("GLB header is truncated.");
    const version = view.getUint32(4, true);
    const length = view.getUint32(8, true);
    if (version !== 2)
        throw new Error(`GLB version ${String(version)} is unsupported.`);
    if (length !== bytes.byteLength)
        throw new Error(`GLB header declares ${String(length)} bytes but received ${String(bytes.byteLength)}.`);
    let offset = 12;
    let json;
    let binary;
    while (offset < length) {
        if (offset + 8 > length)
            throw new Error("GLB chunk header is truncated.");
        const size = view.getUint32(offset, true);
        const type = view.getUint32(offset + 4, true);
        offset += 8;
        if (offset + size > length)
            throw new Error("GLB chunk exceeds the declared file length.");
        const chunk = bytes.slice(offset, offset + size);
        offset += size;
        if (type === 0x4e4f534a) {
            if (json !== undefined)
                throw new Error("GLB contains multiple JSON chunks.");
            json = JSON.parse(new TextDecoder().decode(chunk).trimEnd());
        }
        else if (type === 0x004e4942 && binary === undefined)
            binary = chunk.buffer;
    }
    if (json === undefined)
        throw new Error("GLB has no JSON chunk.");
    return { json, ...(binary === undefined ? {} : { binary }) };
}
async function loadBuffers(json, binary, options, name) {
    return await Promise.all((json.buffers ?? []).map(async (buffer, index) => {
        let data;
        if (buffer.uri === undefined) {
            if (index !== 0 || binary === undefined)
                throw new Error(`${name} buffer ${String(index)} has no URI and no matching GLB binary chunk.`);
            data = binary;
        }
        else if (buffer.uri.startsWith("data:"))
            data = decodeDataUri(buffer.uri, `${name} buffer ${String(index)}`);
        else {
            if (options.resolveUri === undefined)
                throw new Error(`${name} needs external buffer '${buffer.uri}'. Supply resolveUri to the glTF importer.`);
            data = await options.resolveUri(buffer.uri);
        }
        if (data.byteLength < buffer.byteLength)
            throw new Error(`${name} buffer ${String(index)} declares ${String(buffer.byteLength)} bytes but only ${String(data.byteLength)} loaded.`);
        return data;
    }));
}
function floatAttribute(json, buffers, accessorIndex, expectedComponents, semantic, name, expectedCount) {
    const accessor = requireAccessor(json, accessorIndex, name);
    if (componentCount(accessor.type, name) !== expectedComponents)
        throw new Error(`${name} ${semantic} accessor must have ${String(expectedComponents)} components.`);
    if (expectedCount !== undefined && accessor.count !== expectedCount)
        throw new Error(`${name} ${semantic} accessor has ${String(accessor.count)} vertices; expected ${String(expectedCount)}.`);
    return readAccessor(json, buffers, accessorIndex, name);
}
function indexAttribute(json, buffers, index, name) {
    const accessor = requireAccessor(json, index, name);
    if (accessor.type !== "SCALAR" ||
        ![5121, 5123, 5125].includes(accessor.componentType))
        throw new Error(`${name} index accessor must be unsigned SCALAR data.`);
    return Uint32Array.from(readAccessor(json, buffers, index, name));
}
function readAccessor(json, buffers, index, name) {
    const accessor = requireAccessor(json, index, name);
    if (accessor.sparse !== undefined)
        throw new Error(`${name} accessor ${String(index)} uses sparse storage, which is not supported by this importer version.`);
    if (accessor.bufferView === undefined)
        throw new Error(`${name} accessor ${String(index)} has no bufferView.`);
    const bufferView = json.bufferViews?.[accessor.bufferView];
    if (bufferView === undefined)
        throw new Error(`${name} accessor ${String(index)} references missing bufferView ${String(accessor.bufferView)}.`);
    const buffer = buffers[bufferView.buffer];
    if (buffer === undefined)
        throw new Error(`${name} bufferView references missing buffer ${String(bufferView.buffer)}.`);
    const components = componentCount(accessor.type, name);
    const size = componentSize(accessor.componentType, name);
    const stride = bufferView.byteStride ?? components * size;
    if (stride < components * size)
        throw new Error(`${name} accessor ${String(index)} byteStride is too small.`);
    const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const end = start + Math.max(0, accessor.count - 1) * stride + components * size;
    if (start < 0 ||
        end >
            Math.min(buffer.byteLength, (bufferView.byteOffset ?? 0) + bufferView.byteLength))
        throw new Error(`${name} accessor ${String(index)} exceeds its bufferView.`);
    const view = new DataView(buffer);
    const output = new Float32Array(accessor.count * components);
    for (let item = 0; item < accessor.count; item += 1)
        for (let component = 0; component < components; component += 1)
            output[item * components + component] = readComponent(view, start + item * stride + component * size, accessor.componentType, accessor.normalized ?? false);
    return output;
}
function requireAccessor(json, index, name) {
    const accessor = json.accessors?.[index];
    if (accessor === undefined)
        throw new Error(`${name} references missing accessor ${String(index)}.`);
    if (!Number.isSafeInteger(accessor.count) || accessor.count < 0)
        throw new Error(`${name} accessor ${String(index)} has an invalid count.`);
    return accessor;
}
function componentCount(type, name) {
    const count = {
        SCALAR: 1,
        VEC2: 2,
        VEC3: 3,
        VEC4: 4,
        MAT2: 4,
        MAT3: 9,
        MAT4: 16,
    }[type];
    if (count === undefined)
        throw new Error(`${name} uses unknown accessor type '${type}'.`);
    return count;
}
function componentSize(type, name) {
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[type];
    if (size === undefined)
        throw new Error(`${name} uses unsupported componentType ${String(type)}.`);
    return size;
}
function readComponent(view, offset, type, normalized) {
    let value;
    if (type === 5120)
        value = view.getInt8(offset);
    else if (type === 5121)
        value = view.getUint8(offset);
    else if (type === 5122)
        value = view.getInt16(offset, true);
    else if (type === 5123)
        value = view.getUint16(offset, true);
    else if (type === 5125)
        value = view.getUint32(offset, true);
    else
        value = view.getFloat32(offset, true);
    if (!normalized || type === 5126 || type === 5125)
        return value;
    if (type === 5120)
        return Math.max(-1, value / 127);
    if (type === 5122)
        return Math.max(-1, value / 32767);
    return value / (type === 5121 ? 255 : 65535);
}
function parseMaterial(value, index, textureCount, name) {
    for (const [slot, info] of Object.entries({ baseColor: value?.pbrMetallicRoughness?.baseColorTexture, metallicRoughness: value?.pbrMetallicRoughness?.metallicRoughnessTexture, normal: value?.normalTexture, occlusion: value?.occlusionTexture, emissive: value?.emissiveTexture })) {
        if (info === undefined)
            continue;
        integerIndex(info.index, textureCount, `${name} material ${index} ${slot} texture`);
        if ((info.texCoord ?? 0) !== 0)
            throw new Error(`${name} material ${index} ${slot} requires TEXCOORD_${info.texCoord}; only UV0 is currently supported.`);
        if (info.extensions?.KHR_texture_transform)
            throw new Error(`${name} material ${index} ${slot} uses KHR_texture_transform; bake UV transforms before exporting.`);
    }
    const pbr = value?.pbrMetallicRoughness ?? {};
    const color = pbr.baseColorFactor ?? [1, 1, 1, 1];
    tuple(color, 4, `glTF material ${String(index)} baseColorFactor`);
    const emissive = value?.emissiveFactor ?? [0, 0, 0];
    tuple(emissive, 3, `glTF material ${String(index)} emissiveFactor`);
    const alphaMode = value?.alphaMode ?? "OPAQUE";
    if (!["OPAQUE", "MASK", "BLEND"].includes(alphaMode))
        throw new Error(`glTF material ${String(index)} has invalid alphaMode '${String(alphaMode)}'.`);
    const baseColor = [
        color[0],
        color[1],
        color[2],
        color[3],
    ];
    const emitted = [
        emissive[0],
        emissive[1],
        emissive[2],
    ];
    const material = {
        name: typeof value?.name === "string"
            ? value.name
            : `material-${String(index)}`,
        baseColor,
        metallic: finiteDefault(pbr.metallicFactor, 1, "metallicFactor"),
        roughness: finiteDefault(pbr.roughnessFactor, 1, "roughnessFactor"),
        ...(pbr.baseColorTexture?.index === undefined
            ? {}
            : { baseColorTexture: pbr.baseColorTexture.index }),
        ...(value?.normalTexture?.index === undefined
            ? {}
            : { normalTexture: value.normalTexture.index }),
        ...(pbr.metallicRoughnessTexture?.index === undefined ? {} : { metallicRoughnessTexture: pbr.metallicRoughnessTexture.index }),
        ...(value?.occlusionTexture?.index === undefined ? {} : { occlusionTexture: value.occlusionTexture.index }),
        ...(value?.emissiveTexture?.index === undefined ? {} : { emissiveTexture: value.emissiveTexture.index }),
        occlusionStrength: finiteDefault(value?.occlusionTexture?.strength, 1, "occlusionTexture.strength"),
        normalScale: finiteDefault(value?.normalTexture?.scale, 1, "normalTexture.scale"),
        emissive: emitted,
        alphaMode,
        alphaCutoff: finiteDefault(value?.alphaCutoff, 0.5, "alphaCutoff"),
        doubleSided: value?.doubleSided === true,
    };
    return Object.freeze(material);
}
function parseNode(value, index, meshCount) {
    if (value?.mesh !== undefined)
        integerIndex(value.mesh, meshCount, `glTF node ${String(index)} mesh`);
    const children = value?.children ?? [];
    if (!Array.isArray(children) || !children.every(Number.isSafeInteger))
        throw new Error(`glTF node ${String(index)} children must be integer indices.`);
    const translation = value?.translation ?? [0, 0, 0];
    const rotation = value?.rotation ?? [0, 0, 0, 1];
    const scale = value?.scale ?? [1, 1, 1];
    tuple(translation, 3, `glTF node ${String(index)} translation`);
    tuple(rotation, 4, `glTF node ${String(index)} rotation`);
    tuple(scale, 3, `glTF node ${String(index)} scale`);
    if (value?.matrix !== undefined)
        tuple(value.matrix, 16, `glTF node ${String(index)} matrix`);
    const position = [
        translation[0],
        translation[1],
        translation[2],
    ];
    const orientation = [
        rotation[0],
        rotation[1],
        rotation[2],
        rotation[3],
    ];
    const size = [scale[0], scale[1], scale[2]];
    const node = {
        name: typeof value?.name === "string" ? value.name : `node-${String(index)}`,
        ...(value?.mesh === undefined ? {} : { mesh: value.mesh }),
        children: Object.freeze([...children]),
        translation: position,
        rotation: orientation,
        scale: size,
        ...(value?.matrix === undefined
            ? {}
            : { matrix: Object.freeze([...value.matrix]) }),
    };
    return Object.freeze(node);
}
function decodeDataUri(uri, label) {
    const comma = uri.indexOf(",");
    if (comma < 0)
        throw new Error(`${label} has a malformed data URI.`);
    const metadata = uri.slice(0, comma);
    const body = uri.slice(comma + 1);
    try {
        if (metadata.endsWith(";base64")) {
            const binary = atob(body);
            return Uint8Array.from(binary, (character) => character.charCodeAt(0))
                .buffer;
        }
        return new TextEncoder().encode(decodeURIComponent(body)).buffer;
    }
    catch (error) {
        throw new Error(`${label} data URI could not be decoded: ${message(error)}`, { cause: error });
    }
}
function sequentialIndices(count) {
    if (count % 3 !== 0)
        throw new Error(`Unindexed triangle primitive has ${String(count)} vertices, which is not divisible by three.`);
    return Uint32Array.from({ length: count }, (_, index) => index);
}
function expandRgb(input) {
    const output = new Float32Array((input.length / 3) * 4);
    for (let source = 0, target = 0; source < input.length; source += 3, target += 4)
        output.set([input[source], input[source + 1], input[source + 2], 1], target);
    return output;
}
function tuple(value, length, label) {
    if (!Array.isArray(value) ||
        value.length !== length ||
        !value.every(Number.isFinite))
        throw new Error(`${label} must contain ${String(length)} finite numbers.`);
}
function integerIndex(value, length, label) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= length)
        throw new Error(`${label} index ${String(value)} is out of range.`);
}
function finiteDefault(value, fallback, label) {
    if (value === undefined)
        return fallback;
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`glTF ${label} must be finite.`);
    return value;
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=gltf-import.js.map