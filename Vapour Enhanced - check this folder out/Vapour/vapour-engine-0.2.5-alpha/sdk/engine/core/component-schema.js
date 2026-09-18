import { DEFAULT_MESH_ID, meshLibrary } from "../assets/mesh-library.js";
/** Builds a fully populated component payload from a schema's defaults. */
export function createComponentData(schema) {
    const data = {};
    for (const field of schema.fields)
        data[field.key] = cloneDefault(field);
    return data;
}
export function createComponentRecord(schema) {
    return { typeName: schema.typeName, version: schema.version, data: createComponentData(schema) };
}
/**
 * Normalizes stored component data against its schema.
 *
 * Missing fields fall back to schema defaults so older scenes keep loading, but
 * a field that is present with the wrong shape is an authoring error and throws
 * with the component and field named. Unknown keys are preserved untouched so a
 * scene authored with a plugin installed survives a round trip without it.
 */
export function normalizeComponentData(schema, data) {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error(`Component '${schema.typeName}' data must be an object.`);
    }
    const source = data;
    const normalized = { ...structuredClone(source) };
    for (const field of schema.fields) {
        const value = source[field.key];
        normalized[field.key] = value === undefined ? cloneDefault(field) : coerceField(schema, field, value);
    }
    return normalized;
}
/** Applies one edited field, returning new data without mutating the input. */
export function setComponentField(schema, data, key, value) {
    const field = schema.fields.find((candidate) => candidate.key === key);
    if (field === undefined)
        throw new Error(`Component '${schema.typeName}' has no field '${key}'.`);
    const normalized = normalizeComponentData(schema, data);
    normalized[key] = coerceField(schema, field, value);
    return normalized;
}
function cloneDefault(field) {
    return Array.isArray(field.default) ? [...field.default] : field.default;
}
function coerceField(schema, field, value) {
    const where = `${schema.typeName}.${field.key}`;
    switch (field.kind) {
        case "number":
            return clampNumber(finiteNumber(value, where), field.min, field.max);
        case "text":
            if (typeof value !== "string")
                throw new Error(`${where} must be text.`);
            return value;
        case "vector2":
            return numberTuple(value, 2, where);
        case "vector3":
            return numberTuple(value, 3, where);
        case "color":
            return numberTuple(value, 3, where).map((channel) => clampNumber(channel, 0, undefined));
        case "colorAlpha": {
            const channels = numberTuple(value, 4, where);
            return [
                clampNumber(channels[0], 0, undefined),
                clampNumber(channels[1], 0, undefined),
                clampNumber(channels[2], 0, undefined),
                clampNumber(channels[3], 0, 1),
            ];
        }
        case "boolean":
            if (typeof value !== "boolean")
                throw new Error(`${where} must be a boolean.`);
            return value;
        case "enum":
            if (typeof value !== "string" || !field.options.some((option) => option.value === value)) {
                throw new Error(`${where} must be one of ${field.options.map((option) => option.value).join(", ")}.`);
            }
            return value;
    }
}
function finiteNumber(value, where) {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`${where} must be a finite number.`);
    return value;
}
function numberTuple(value, length, where) {
    if (!Array.isArray(value) || value.length !== length)
        throw new Error(`${where} must contain ${String(length)} numbers.`);
    return value.map((channel) => finiteNumber(channel, where));
}
function clampNumber(value, min, max) {
    const lower = min === undefined ? value : Math.max(min, value);
    return max === undefined ? lower : Math.min(max, lower);
}
/** Registry of authorable component schemas. The editor owns one instance and
 * plugins extend it; lookups are by stable `typeName`. */
export class ComponentSchemaRegistry {
    #schemas = new Map();
    constructor(schemas = []) {
        for (const schema of schemas)
            this.register(schema);
    }
    register(schema) {
        if (this.#schemas.has(schema.typeName))
            throw new Error(`Component schema '${schema.typeName}' is already registered.`);
        if (new Set(schema.fields.map((field) => field.key)).size !== schema.fields.length) {
            throw new Error(`Component schema '${schema.typeName}' declares duplicate field keys.`);
        }
        this.#schemas.set(schema.typeName, schema);
    }
    get(typeName) {
        return this.#schemas.get(typeName);
    }
    require(typeName) {
        const schema = this.get(typeName);
        if (schema === undefined)
            throw new Error(`No component schema is registered for '${typeName}'.`);
        return schema;
    }
    /** Addable components, alphabetical, optionally filtered by a menu query. */
    list(query = "") {
        const needle = query.trim().toLocaleLowerCase();
        return [...this.#schemas.values()]
            .filter((schema) => needle === "" || schema.label.toLocaleLowerCase().includes(needle) || schema.typeName.toLocaleLowerCase().includes(needle))
            .sort((a, b) => a.label.localeCompare(b.label));
    }
}
export const TRANSFORM_TYPE_NAME = "vapour.Transform";
/** Components implemented end to end by the current runtime. Anything the
 * renderer or a runtime system does not yet consume stays out of this list so
 * the editor never presents a control that changes nothing. */
export function builtinComponentSchemas() {
    return [
        {
            typeName: "vapour.MeshRenderer",
            label: "Mesh Renderer",
            icon: "⬡",
            version: 1,
            summary: "Draws a built-in mesh with the standard PBR material.",
            removable: true,
            fields: [
                {
                    kind: "enum",
                    key: "mesh",
                    label: "Mesh",
                    default: DEFAULT_MESH_ID,
                    options: meshLibrary().map((mesh) => ({ value: mesh.id, label: mesh.label })),
                },
                { kind: "text", key: "material", label: "Material", default: "builtin:default", placeholder: "material:asset-id" },
                { kind: "colorAlpha", key: "baseColor", label: "Base Color", default: [0.24, 0.48, 1, 1] },
                { kind: "number", key: "metallic", label: "Metallic", default: 0, min: 0, max: 1, step: 0.05 },
                { kind: "number", key: "roughness", label: "Roughness", default: 0.6, min: 0.045, max: 1, step: 0.05 },
                { kind: "number", key: "emissive", label: "Emissive", default: 0, min: 0, step: 0.1 },
                { kind: "number", key: "alphaCutoff", label: "Alpha Cutoff", default: 0.01, min: 0, max: 1, step: 0.05 },
            ],
        },
        {
            typeName: "vapour.SpriteRenderer",
            label: "Sprite Renderer",
            icon: "▧",
            version: 1,
            summary: "Draws an XY sprite quad through a stable material asset.",
            removable: true,
            fields: [
                { kind: "text", key: "material", label: "Material", default: "builtin:default", placeholder: "material:sprite" },
                { kind: "colorAlpha", key: "color", label: "Tint", default: [1, 1, 1, 1] },
                { kind: "number", key: "sortingLayer", label: "Sorting Layer", default: 0, step: 1 },
                { kind: "number", key: "order", label: "Order in Layer", default: 0, step: 1 },
            ],
        },
        {
            typeName: "vapour.Camera",
            label: "Camera",
            icon: "▣",
            version: 1,
            summary: "Perspective or orthographic camera used by the Game view.",
            removable: true,
            fields: [
                { kind: "enum", key: "projection", label: "Projection", default: "perspective", options: [{ value: "perspective", label: "Perspective" }, { value: "orthographic", label: "Orthographic" }] },
                { kind: "number", key: "fieldOfView", label: "Field of View", default: 60, min: 1, max: 179, step: 1 },
                { kind: "number", key: "orthographicSize", label: "Orthographic Size", default: 10, min: 0.001, step: 0.1 },
                { kind: "number", key: "near", label: "Near", default: 0.1, min: 0.001, step: 0.01 },
                { kind: "number", key: "far", label: "Far", default: 1000, min: 0.01, step: 10 },
            ],
        },
        {
            typeName: "vapour.Rigidbody2D",
            label: "Rigidbody 2D",
            icon: "◉",
            version: 1,
            summary: "Drives this entity through Vapour's Rust/WASM 2D physics world.",
            removable: true,
            fields: [
                { kind: "enum", key: "bodyType", label: "Body Type", default: "dynamic", options: [{ value: "static", label: "Static" }, { value: "dynamic", label: "Dynamic" }, { value: "kinematicPosition", label: "Kinematic Position" }, { value: "kinematicVelocity", label: "Kinematic Velocity" }] },
                { kind: "number", key: "gravityScale", label: "Gravity Scale", default: 1, min: 0, step: 0.1 },
                { kind: "number", key: "linearDamping", label: "Linear Damping", default: 0, min: 0, step: 0.05 },
                { kind: "number", key: "angularDamping", label: "Angular Damping", default: 0, min: 0, step: 0.05 },
                { kind: "boolean", key: "continuousCollisionDetection", label: "Continuous Collision", default: false },
            ],
        },
        {
            typeName: "vapour.Collider2D",
            label: "Collider 2D",
            icon: "□",
            version: 1,
            summary: "Rectangle, circle, or capsule collision geometry for the native 2D solver.",
            removable: true,
            fields: [
                { kind: "enum", key: "shape", label: "Shape", default: "rectangle", options: [{ value: "rectangle", label: "Rectangle" }, { value: "circle", label: "Circle" }, { value: "capsule", label: "Capsule" }] },
                { kind: "vector2", key: "size", label: "Size", default: [1, 1], step: 0.1 },
                { kind: "number", key: "radius", label: "Radius", default: 0.5, min: 0.001, step: 0.05 },
                { kind: "number", key: "density", label: "Density", default: 1, min: 0.001, step: 0.1 },
                { kind: "number", key: "friction", label: "Friction", default: 0.5, min: 0, step: 0.05 },
                { kind: "number", key: "restitution", label: "Restitution", default: 0, min: 0, step: 0.05 },
                { kind: "boolean", key: "sensor", label: "Trigger", default: false },
                { kind: "number", key: "layer", label: "Layer Bits", default: 1, min: 1, step: 1 },
                { kind: "number", key: "mask", label: "Mask Bits", default: 4294967295, min: 0, step: 1 },
            ],
        },
        {
            typeName: "vapour.Rigidbody3D",
            label: "Rigidbody 3D",
            icon: "⬢",
            version: 1,
            summary: "Drives this entity through Vapour's Rust/WASM 3D physics world.",
            removable: true,
            fields: [
                { kind: "enum", key: "bodyType", label: "Body Type", default: "dynamic", options: [{ value: "static", label: "Static" }, { value: "dynamic", label: "Dynamic" }, { value: "kinematicPosition", label: "Kinematic Position" }, { value: "kinematicVelocity", label: "Kinematic Velocity" }] },
                { kind: "number", key: "gravityScale", label: "Gravity Scale", default: 1, min: 0, step: 0.1 },
                { kind: "number", key: "linearDamping", label: "Linear Damping", default: 0, min: 0, step: 0.05 },
                { kind: "number", key: "angularDamping", label: "Angular Damping", default: 0, min: 0, step: 0.05 },
                { kind: "boolean", key: "continuousCollisionDetection", label: "Continuous Collision", default: false },
            ],
        },
        {
            typeName: "vapour.Collider3D",
            label: "Collider 3D",
            icon: "◇",
            version: 1,
            summary: "Box, sphere, capsule, or cylinder geometry for the native 3D solver.",
            removable: true,
            fields: [
                { kind: "enum", key: "shape", label: "Shape", default: "box", options: [{ value: "box", label: "Box" }, { value: "sphere", label: "Sphere" }, { value: "capsule", label: "Capsule" }, { value: "cylinder", label: "Cylinder" }] },
                { kind: "vector3", key: "size", label: "Size", default: [1, 1, 1], step: 0.1 },
                { kind: "number", key: "radius", label: "Radius", default: 0.5, min: 0.001, step: 0.05 },
                { kind: "number", key: "height", label: "Height", default: 1, min: 0.001, step: 0.1 },
                { kind: "number", key: "density", label: "Density", default: 1, min: 0.001, step: 0.1 },
                { kind: "number", key: "friction", label: "Friction", default: 0.5, min: 0, step: 0.05 },
                { kind: "number", key: "restitution", label: "Restitution", default: 0, min: 0, step: 0.05 },
                { kind: "boolean", key: "sensor", label: "Trigger", default: false },
                { kind: "number", key: "layer", label: "Layer Bits", default: 1, min: 1, step: 1 },
                { kind: "number", key: "mask", label: "Mask Bits", default: 4294967295, min: 0, step: 1 },
            ],
        },
        {
            typeName: "vapour.CharacterController2D",
            label: "Character Controller 2D",
            icon: "♟",
            version: 1,
            summary: "Rust-backed 2D movement with ground, slope, sliding, and stair handling.",
            removable: true,
            fields: [
                { kind: "enum", key: "shape", label: "Shape", default: "capsule", options: [{ value: "capsule", label: "Capsule" }, { value: "circle", label: "Circle" }, { value: "rectangle", label: "Rectangle" }] },
                { kind: "vector2", key: "size", label: "Size", default: [0.6, 1.8], step: 0.05 },
                { kind: "number", key: "radius", label: "Radius", default: 0.3, min: 0.001, step: 0.05 },
                { kind: "number", key: "offset", label: "Contact Offset", default: 0.01, min: 0.0001, step: 0.005 },
                { kind: "boolean", key: "slide", label: "Slide", default: true },
                { kind: "boolean", key: "autostep", label: "Autostep", default: true },
                { kind: "number", key: "stepHeight", label: "Step Height", default: 0.3, min: 0.001, step: 0.05 },
                { kind: "number", key: "stepWidth", label: "Step Width", default: 0.2, min: 0.001, step: 0.05 },
                { kind: "number", key: "maxSlope", label: "Max Slope", default: 45, min: 0, max: 90, step: 1 },
                { kind: "number", key: "slideSlope", label: "Slide Slope", default: 50, min: 0, max: 90, step: 1 },
                { kind: "number", key: "groundSnap", label: "Ground Snap", default: 0.2, min: 0, step: 0.05 },
                { kind: "number", key: "layer", label: "Layer Bits", default: 1, min: 1, step: 1 },
                { kind: "number", key: "mask", label: "Mask Bits", default: 4294967295, min: 0, step: 1 },
            ],
        },
        {
            typeName: "vapour.CharacterController3D",
            label: "Character Controller 3D",
            icon: "♙",
            version: 1,
            summary: "Rust-backed 3D movement for first-person, third-person, and platforming games.",
            removable: true,
            fields: [
                { kind: "enum", key: "shape", label: "Shape", default: "capsule", options: [{ value: "capsule", label: "Capsule" }, { value: "sphere", label: "Sphere" }, { value: "box", label: "Box" }] },
                { kind: "vector3", key: "size", label: "Size", default: [0.6, 1.8, 0.6], step: 0.05 },
                { kind: "number", key: "radius", label: "Radius", default: 0.3, min: 0.001, step: 0.05 },
                { kind: "number", key: "offset", label: "Contact Offset", default: 0.01, min: 0.0001, step: 0.005 },
                { kind: "boolean", key: "slide", label: "Slide", default: true },
                { kind: "boolean", key: "autostep", label: "Autostep", default: true },
                { kind: "number", key: "stepHeight", label: "Step Height", default: 0.3, min: 0.001, step: 0.05 },
                { kind: "number", key: "stepWidth", label: "Step Width", default: 0.2, min: 0.001, step: 0.05 },
                { kind: "number", key: "maxSlope", label: "Max Slope", default: 45, min: 0, max: 90, step: 1 },
                { kind: "number", key: "slideSlope", label: "Slide Slope", default: 50, min: 0, max: 90, step: 1 },
                { kind: "number", key: "groundSnap", label: "Ground Snap", default: 0.2, min: 0, step: 0.05 },
                { kind: "number", key: "layer", label: "Layer Bits", default: 1, min: 1, step: 1 },
                { kind: "number", key: "mask", label: "Mask Bits", default: 4294967295, min: 0, step: 1 },
            ],
        },
        {
            typeName: "vapour.DirectionalLight",
            label: "Directional Light",
            icon: "☀",
            version: 1,
            summary: "Infinite parallel light aimed down the entity's -Z axis.",
            removable: true,
            fields: [
                { kind: "color", key: "color", label: "Color", default: [1, 0.96, 0.88] },
                { kind: "number", key: "intensity", label: "Intensity", default: 3, min: 0, step: 0.1 },
            ],
        },
    ];
}
//# sourceMappingURL=component-schema.js.map