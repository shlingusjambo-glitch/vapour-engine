import { builtinComponentSchemas, ComponentSchemaRegistry, createComponentRecord } from "../core/component-schema.js";
import { quaternionFromEuler } from "../core/rotation.js";
import { SCENE_FORMAT_VERSION, defaultTransform, validateScene } from "../core/scene-document.js";
const registry = new ComponentSchemaRegistry(builtinComponentSchemas());
/**
 * Starter content for new projects.
 *
 * The Hub, the CLI's `create` command, and the checked-in `templates/`
 * directory all build from these definitions, so a project created in the
 * browser and one created from a terminal are identical. Templates use ordinary
 * engine APIs — components, transforms, scripts — rather than hidden engine
 * behaviour, which is also what makes them useful as worked examples.
 */
export function projectTemplates() {
    return [empty3d, empty2d, webxr];
}
export function projectTemplate(id) {
    const template = projectTemplates().find((candidate) => candidate.id === id);
    if (template === undefined) {
        throw new Error(`Unknown project template '${id}'. Available: ${projectTemplates().map((value) => value.id).join(", ")}.`);
    }
    return template;
}
const empty3d = {
    id: "empty-3d",
    label: "Empty 3D",
    description: "A lit 3D scene: ground plane, a cube and a sphere resting on it, a camera, and a sun.",
    sceneName: "Main",
    buildScene() {
        const builder = new SceneBuilder("Main");
        builder.add("Main Camera", { position: [0, 2, 6], euler: [-12, 0, 0] }, ["vapour.Camera"]);
        builder.add("Directional Light", { position: [0, 4, 2], euler: [50, -30, 0] }, ["vapour.DirectionalLight"]);
        builder.add("Ground", { position: [0, 0, 0], scale: [12, 1, 12] }, [
            { type: "vapour.MeshRenderer", data: { mesh: "builtin:plane", baseColor: [0.18, 0.19, 0.2, 1], roughness: 0.9 } },
        ]);
        // Both objects sit on the ground because every built-in is a one-unit mesh
        // centred on its origin: half its height above y=0 puts it exactly on top.
        builder.add("Cube", { position: [-0.9, 0.5, 0] }, ["vapour.MeshRenderer"]);
        builder.add("Sphere", { position: [0.9, 0.5, 0] }, [
            { type: "vapour.MeshRenderer", data: { mesh: "builtin:sphere", baseColor: [0.85, 0.45, 0.25, 1], metallic: 0.9, roughness: 0.25 } },
        ]);
        return builder.build();
    },
    script: () => script3d(),
};
const empty2d = {
    id: "empty-2d",
    label: "Empty 2D",
    description: "A camera looking down -Z at a flat playfield, ready for sprite work.",
    sceneName: "Main 2D",
    buildScene() {
        const builder = new SceneBuilder("Main 2D");
        builder.add("Main Camera", { position: [0, 0, 10] }, [
            { type: "vapour.Camera", data: { projection: "orthographic", orthographicSize: 10, near: 0.1, far: 100 } },
        ]);
        builder.add("Directional Light", { position: [0, 3, 4], euler: [35, 0, 0] }, ["vapour.DirectionalLight"]);
        builder.add("Player", { position: [0, 0, 0] }, [
            { type: "vapour.SpriteRenderer", data: { color: [0.85, 0.45, 0.25, 1], sortingLayer: 1 } },
        ]);
        builder.add("Ground", { position: [0, -2, 0], scale: [12, 1, 1] }, [
            { type: "vapour.SpriteRenderer", data: { color: [0.2, 0.22, 0.24, 1], sortingLayer: 0 } },
        ]);
        return builder.build();
    },
    script: () => script2d(),
};
const webxr = {
    id: "webxr",
    label: "WebXR",
    description: "A room-scale layout with a camera rig, a light, and a reachable object.",
    sceneName: "Main XR",
    buildScene() {
        const builder = new SceneBuilder("Main XR");
        // XR components are not implemented yet. Rather than shipping a fake
        // XR rig, this template lays out the room the rig will occupy and the
        // camera is an ordinary one, so the scene runs correctly today.
        const rig = builder.add("XR Rig", { position: [0, 0, 0] }, []);
        builder.add("Head Camera", { position: [0, 1.6, 0] }, ["vapour.Camera"], rig);
        builder.add("Directional Light", { position: [0, 3, 1], euler: [55, -25, 0] }, ["vapour.DirectionalLight"]);
        builder.add("Floor", { position: [0, 0, 0], scale: [6, 1, 6] }, [
            { type: "vapour.MeshRenderer", data: { mesh: "builtin:plane", baseColor: [0.16, 0.17, 0.19, 1], roughness: 0.9 } },
        ]);
        builder.add("Table", { position: [0, 0.4, -0.9], scale: [1.2, 0.08, 0.7] }, ["vapour.MeshRenderer"]);
        builder.add("Grabbable Sphere", { position: [0, 0.53, -0.9], scale: [0.12, 0.12, 0.12] }, [
            { type: "vapour.MeshRenderer", data: { mesh: "builtin:sphere", baseColor: [0.9, 0.55, 0.3, 1], emissive: 0.4 } },
        ]);
        return builder.build();
    },
    script: () => scriptXr(),
};
class SceneBuilder {
    #scene;
    constructor(name) {
        this.#scene = { formatVersion: SCENE_FORMAT_VERSION, id: crypto.randomUUID(), name, entities: [] };
    }
    add(name, placement, components, parent) {
        const transform = defaultTransform();
        if (placement.position !== undefined)
            transform.position = [...placement.position];
        if (placement.scale !== undefined)
            transform.scale = [...placement.scale];
        if (placement.euler !== undefined)
            transform.rotation = quaternionFromEuler([...placement.euler]);
        const entity = {
            id: crypto.randomUUID(),
            name,
            ...(parent === undefined ? {} : { parent }),
            enabled: true,
            components: [
                { typeName: "vapour.Transform", version: 1, data: transform },
                ...components.map((component) => {
                    const spec = typeof component === "string" ? { type: component } : component;
                    const record = createComponentRecord(registry.require(spec.type));
                    Object.assign(record.data, spec.data ?? {});
                    return record;
                }),
            ],
        };
        this.#scene.entities.push(entity);
        return entity.id;
    }
    build() {
        validateScene(this.#scene);
        return this.#scene;
    }
}
/** Serializes a scene the same way the editor does, so template output and
 * editor saves produce byte-identical, diff-friendly files. */
export function serializeScene(scene) {
    const copy = structuredClone(scene);
    copy.entities.sort((a, b) => a.id.localeCompare(b.id));
    for (const entity of copy.entities)
        entity.components.sort((a, b) => a.typeName.localeCompare(b.typeName));
    return `${JSON.stringify(copy, null, 2)}\n`;
}
function script3d() {
    return `import type { ScriptContext } from "@vapour/engine";

/** Runs once when the scene finishes loading. */
export function start(context: ScriptContext): void {
  console.info("Vapour 3D project ready", context);
}

/** Runs every frame. \`deltaSeconds\` is the time since the previous frame. */
export function update(context: ScriptContext, deltaSeconds: number): void {
  void context;
  void deltaSeconds;
}
`;
}
function script2d() {
    return `import type { ScriptContext } from "@vapour/engine";

export function start(context: ScriptContext): void {
  console.info("Vapour 2D project ready", context);
}

export function update(context: ScriptContext, deltaSeconds: number): void {
  void context;
  void deltaSeconds;
}
`;
}
function scriptXr() {
    return `import type { ScriptContext } from "@vapour/engine";

export function start(context: ScriptContext): void {
  console.info("Vapour XR project ready", context);
}

export function update(context: ScriptContext, deltaSeconds: number): void {
  void context;
  void deltaSeconds;
}
`;
}
//# sourceMappingURL=project-templates.js.map