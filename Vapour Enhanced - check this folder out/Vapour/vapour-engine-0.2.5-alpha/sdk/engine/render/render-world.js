import { normalizeQuat as normalizeQuaternion } from "@vapour/math";
import { DEFAULT_MESH_ID, meshDescriptor, meshLibrary, } from "../assets/mesh-library.js";
import { validateScene, } from "../core/scene-document.js";
export const RENDER_WORLD_VERSION = 1;
/**
 * World matrices for every entity in the scene, keyed by entity ID.
 *
 * Editor tooling needs the world placement of entities the renderer never
 * draws — an empty group, a camera, a light — so gizmos and framing share this
 * one resolver with the render extraction rather than reimplementing it.
 */
export function computeWorldMatrices(scene) {
    validateScene(scene);
    const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
    const matrices = new Map();
    for (const entity of scene.entities)
        resolveWorldMatrix(entity, byId, matrices);
    return matrices;
}
function resolveWorldMatrix(entity, byId, matrices) {
    const cached = matrices.get(entity.id);
    if (cached !== undefined)
        return cached;
    const local = transformMatrix(readTransform(entity));
    const result = entity.parent === undefined
        ? local
        : multiplyMatrices(resolveWorldMatrix(requireEntity(byId, entity.parent), byId, matrices), local);
    matrices.set(entity.id, result);
    return result;
}
export function extractRenderWorld(scene) {
    validateScene(scene);
    const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
    const matrices = new Map();
    const active = new Map();
    const worldMatrix = (entity) => resolveWorldMatrix(entity, byId, matrices);
    const isActive = (entity) => {
        const cached = active.get(entity.id);
        if (cached !== undefined)
            return cached;
        const result = entity.enabled &&
            (entity.parent === undefined ||
                isActive(requireEntity(byId, entity.parent)));
        active.set(entity.id, result);
        return result;
    };
    let camera;
    let directionalLight;
    const instances = [];
    for (const entity of scene.entities) {
        if (!isActive(entity))
            continue;
        const contribution = extractEntityContribution(entity, worldMatrix(entity));
        if (camera === undefined && contribution.camera !== undefined)
            camera = contribution.camera;
        if (directionalLight === undefined &&
            contribution.directionalLight !== undefined)
            directionalLight = contribution.directionalLight;
        instances.push(...contribution.instances);
    }
    return {
        version: RENDER_WORLD_VERSION,
        ...(camera === undefined ? {} : { camera }),
        ...(directionalLight === undefined ? {} : { directionalLight }),
        instances,
    };
}
function readTransform(entity) {
    const transform = component(entity, "vapour.Transform");
    if (transform === undefined)
        throw new Error(`Renderable entity '${entity.name}' has no Transform component.`);
    const data = record(transform.data, `Transform on '${entity.name}'`);
    return {
        position: finiteTuple(data.position, [0, 0, 0], 3, "Transform.position"),
        rotation: finiteTuple(data.rotation, [0, 0, 0, 1], 4, "Transform.rotation"),
        scale: finiteTuple(data.scale, [1, 1, 1], 3, "Transform.scale"),
    };
}
function transformMatrix(transform) {
    const [x, y, z, w] = normalizeQuaternion(transform.rotation);
    const [sx, sy, sz] = transform.scale;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    return [
        (1 - (yy + zz)) * sx,
        (xy + wz) * sx,
        (xz - wy) * sx,
        0,
        (xy - wz) * sy,
        (1 - (xx + zz)) * sy,
        (yz + wx) * sy,
        0,
        (xz + wy) * sz,
        (yz - wx) * sz,
        (1 - (xx + yy)) * sz,
        0,
        transform.position[0],
        transform.position[1],
        transform.position[2],
        1,
    ];
}
function multiplyMatrices(left, right) {
    const output = new Array(16).fill(0);
    for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
            output[column * 4 + row] =
                left[row] * right[column * 4] +
                    left[4 + row] * right[column * 4 + 1] +
                    left[8 + row] * right[column * 4 + 2] +
                    left[12 + row] * right[column * 4 + 3];
        }
    }
    return output;
}
function component(entity, typeName) {
    return entity.components.find((value) => value.typeName === typeName);
}
function requireEntity(byId, id) {
    const entity = byId.get(id);
    if (entity === undefined)
        throw new Error(`Scene hierarchy references missing entity '${id}'.`);
    return entity;
}
function record(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error(`${label} data must be an object.`);
    return value;
}
function finiteNumber(value, fallback, field) {
    if (value === undefined)
        return fallback;
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`${field} must be a finite number.`);
    return value;
}
function positiveNumber(value, fallback, field) {
    const result = finiteNumber(value, fallback, field);
    if (result <= 0)
        throw new Error(`${field} must be positive.`);
    return result;
}
function finiteInteger(value, fallback, field) {
    const result = finiteNumber(value, fallback, field);
    if (!Number.isInteger(result))
        throw new Error(`${field} must be an integer.`);
    return result;
}
function materialId(value, owner) {
    const id = value === undefined ? "builtin:default" : String(value).trim();
    if (!id)
        throw new Error(`${owner} has an empty material identifier.`);
    return id === "builtin:standard" ? "builtin:default" : id;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
function clamp01(value) {
    return clamp(value, 0, 1);
}
function finiteTuple(value, fallback, length, field) {
    if (value === undefined)
        return fallback;
    if (!Array.isArray(value) ||
        value.length !== length ||
        value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
        throw new Error(`${field} must contain ${String(length)} finite numbers.`);
    }
    return value;
}
/**
 * Extracts what a single entity contributes to the render world, given its
 * already-resolved world matrix.
 *
 * Factored out of {@link extractRenderWorld} so that the incremental extractor
 * can recompute exactly the entities that changed and reuse the rest. Both
 * paths must produce identical output, which is only guaranteed if there is one
 * implementation of the per-entity rules.
 */
export function extractEntityContribution(entity, matrix) {
    const instances = [];
    let camera;
    let directionalLight;
    const cameraComponent = component(entity, "vapour.Camera");
    if (cameraComponent !== undefined) {
        const data = record(cameraComponent.data, `Camera on '${entity.name}'`);
        camera = {
            entityId: entity.id,
            worldMatrix: matrix,
            fieldOfView: finiteNumber(data.fieldOfView, 60, "Camera.fieldOfView"),
            projection: data.projection === "orthographic" ? "orthographic" : "perspective",
            orthographicSize: positiveNumber(data.orthographicSize, 10, "Camera.orthographicSize"),
            near: finiteNumber(data.near, 0.1, "Camera.near"),
            far: finiteNumber(data.far, 1_000, "Camera.far"),
        };
    }
    const lightComponent = component(entity, "vapour.DirectionalLight");
    if (lightComponent !== undefined) {
        const data = record(lightComponent.data, `DirectionalLight on '${entity.name}'`);
        directionalLight = {
            entityId: entity.id,
            worldMatrix: matrix,
            color: finiteTuple(data.color, [1, 0.94, 0.84], 3, "DirectionalLight.color"),
            intensity: finiteNumber(data.intensity, 5, "DirectionalLight.intensity"),
        };
    }
    const meshComponent = component(entity, "vapour.MeshRenderer");
    if (meshComponent !== undefined) {
        const data = record(meshComponent.data, `MeshRenderer on '${entity.name}'`);
        const mesh = data.mesh === undefined ? DEFAULT_MESH_ID : String(data.mesh);
        if (meshDescriptor(mesh) === undefined) {
            throw new Error(`MeshRenderer on '${entity.name}' references unknown mesh '${mesh}'. Available meshes: ${meshLibrary()
                .map((value) => value.id)
                .join(", ")}.`);
        }
        instances.push({
            entityId: entity.id,
            mesh,
            material: materialId(data.material, `MeshRenderer on '${entity.name}'`),
            modelMatrix: matrix,
            baseColor: finiteTuple(data.baseColor, [0.24, 0.48, 1, 1], 4, "MeshRenderer.baseColor"),
            materialParams: [
                clamp01(finiteNumber(data.metallic, 0, "MeshRenderer.metallic")),
                clamp(finiteNumber(data.roughness, 0.6, "MeshRenderer.roughness"), 0.045, 1),
                Math.max(0, finiteNumber(data.emissive, 0, "MeshRenderer.emissive")),
                clamp01(finiteNumber(data.alphaCutoff, 0.01, "MeshRenderer.alphaCutoff")),
            ],
        });
    }
    const spriteComponent = component(entity, "vapour.SpriteRenderer");
    if (spriteComponent !== undefined) {
        const data = record(spriteComponent.data, `SpriteRenderer on '${entity.name}'`);
        const spriteMatrix = [...matrix];
        const sortingLayer = finiteInteger(data.sortingLayer, 0, "SpriteRenderer.sortingLayer");
        const order = finiteInteger(data.order, 0, "SpriteRenderer.order");
        spriteMatrix[14] = spriteMatrix[14] + sortingLayer * 1e-3 + order * 1e-6;
        instances.push({
            entityId: entity.id,
            mesh: "builtin:quad",
            material: materialId(data.material, `SpriteRenderer on '${entity.name}'`),
            modelMatrix: spriteMatrix,
            baseColor: finiteTuple(data.color, [1, 1, 1, 1], 4, "SpriteRenderer.color"),
            materialParams: [0, 1, 0, 0.01],
        });
    }
    return {
        instances,
        ...(camera === undefined ? {} : { camera }),
        ...(directionalLight === undefined ? {} : { directionalLight }),
    };
}
//# sourceMappingURL=render-world.js.map