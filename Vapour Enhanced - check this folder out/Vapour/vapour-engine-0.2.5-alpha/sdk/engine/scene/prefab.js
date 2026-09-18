/** Prefabs: reusable entity sub-trees, nestable, with per-instance overrides.
 *
 * A prefab is authored once and instantiated many times — a streetlight, an
 * enemy, a door, a whole building produced by the asset system. Without them a
 * scene file is the only unit of reuse, which means a city of a thousand
 * identical lamps is a thousand hand-maintained copies.
 *
 * Two properties make prefabs usable for real games rather than just a copy
 * button:
 *
 * - **Nesting.** A prefab may contain instances of other prefabs, so a building
 *   is composed of rooms which are composed of furniture. Cycles are rejected
 *   with the full path.
 * - **Overrides.** An instance may change specific component fields without
 *   forking the prefab, so a hundred doors share one definition and differ in
 *   the one field that matters.
 *
 * Instantiation is deterministic given an id factory. That matters for
 * networking: a server and its clients that instantiate the same prefab with
 * the same seed produce the same entity ids, so replication has stable targets.
 */
import { defaultTransform } from "../core/scene-document.js";
export const PREFAB_FORMAT_VERSION = 1;
export function validatePrefab(data) {
    if (data.formatVersion !== PREFAB_FORMAT_VERSION) {
        throw new Error(`Unsupported prefab version ${String(data.formatVersion)}. This build reads version ${PREFAB_FORMAT_VERSION}.`);
    }
    const id = data.id.trim();
    const name = data.name.trim();
    if (!id)
        throw new Error("A prefab requires a non-empty id.");
    if (!name)
        throw new Error(`Prefab "${id}" requires a non-empty name.`);
    if (data.entities.length === 0)
        throw new Error(`Prefab "${id}" requires at least one entity.`);
    const localIds = new Set();
    for (const entity of data.entities) {
        if (localIds.has(entity.id))
            throw new Error(`Prefab "${id}" defines entity "${entity.id}" more than once.`);
        localIds.add(entity.id);
    }
    if (!localIds.has(data.root)) {
        throw new Error(`Prefab "${id}" names root "${data.root}", which is not one of its entities.`);
    }
    for (const entity of data.entities) {
        if (entity.parent !== undefined && !localIds.has(entity.parent)) {
            throw new Error(`Prefab "${id}" parents entity "${entity.id}" to "${entity.parent}", which it does not define.`);
        }
    }
    for (const child of data.children ?? []) {
        if (localIds.has(child.id))
            throw new Error(`Prefab "${id}" reuses local id "${child.id}" for a nested prefab.`);
        localIds.add(child.id);
        if (child.parent !== undefined && !localIds.has(child.parent)) {
            throw new Error(`Prefab "${id}" attaches nested prefab "${child.id}" to unknown entity "${child.parent}".`);
        }
    }
    return data;
}
/**
 * A registry of prefab definitions.
 *
 * Instantiation resolves nested prefabs through the library, so a prefab may be
 * registered in any order relative to the ones it references.
 */
export class PrefabLibrary {
    #prefabs = new Map();
    register(data) {
        const prefab = validatePrefab(data);
        if (this.#prefabs.has(prefab.id))
            throw new Error(`Prefab "${prefab.id}" is already registered.`);
        this.#prefabs.set(prefab.id, prefab);
    }
    has(prefabId) {
        return this.#prefabs.has(prefabId);
    }
    get(prefabId) {
        return this.#prefabs.get(prefabId);
    }
    get ids() {
        return [...this.#prefabs.keys()].sort();
    }
    require(prefabId) {
        const prefab = this.#prefabs.get(prefabId);
        if (!prefab) {
            const known = this.ids;
            throw new Error(`Prefab "${prefabId}" is not registered.${known.length > 0 ? ` Registered prefabs: ${known.join(", ")}.` : ""}`);
        }
        return prefab;
    }
    /** Produces entities for one instance. The caller adds them to a scene. */
    instantiate(prefabId, options = {}) {
        const counter = { value: 0 };
        const idFactory = options.idFactory ?? (() => crypto.randomUUID());
        const result = this.#expand(prefabId, options.parent, options.overrides ?? [], idFactory, counter, []);
        const root = result.entities.find((entity) => entity.id === result.rootId);
        if (!root)
            throw new Error(`Prefab "${prefabId}" produced no root entity.`);
        if (options.name)
            root.name = options.name;
        if (options.transform)
            applyTransform(root, options.transform);
        return { prefabId, rootId: result.rootId, entities: result.entities, idMap: result.idMap };
    }
    #expand(prefabId, sceneParent, overrides, idFactory, counter, chain) {
        if (chain.includes(prefabId)) {
            throw new Error(`Prefab nesting cycle: ${[...chain, prefabId].join(" -> ")}.`);
        }
        const prefab = this.require(prefabId);
        const nextChain = [...chain, prefabId];
        const idMap = new Map();
        for (const entity of prefab.entities) {
            idMap.set(entity.id, idFactory(prefabId, entity.id, counter.value++));
        }
        const entities = prefab.entities.map((entity) => {
            const clone = structuredClone(entity);
            clone.id = idMap.get(entity.id);
            const parent = entity.id === prefab.root ? sceneParent : entity.parent === undefined ? undefined : idMap.get(entity.parent);
            if (parent === undefined)
                delete clone.parent;
            else
                clone.parent = parent;
            return clone;
        });
        // Overrides addressed by prefab-local id, applied before nesting so a
        // parent prefab can retarget what it nests.
        for (const override of overrides) {
            const target = idMap.get(override.entity);
            if (target === undefined) {
                throw new Error(`Override targets entity "${override.entity}", which prefab "${prefabId}" does not define.`);
            }
            applyOverride(entities.find((entity) => entity.id === target), override, prefabId);
        }
        for (const child of prefab.children ?? []) {
            const attachTo = child.parent === undefined ? idMap.get(prefab.root) : idMap.get(child.parent);
            const nested = this.#expand(child.prefabId, attachTo, child.overrides ?? [], idFactory, counter, nextChain);
            entities.push(...nested.entities);
            idMap.set(child.id, nested.rootId);
            // Expose nested parts as "child/local" so an outer override can reach them.
            for (const [localId, sceneId] of nested.idMap)
                idMap.set(`${child.id}/${localId}`, sceneId);
        }
        return { rootId: idMap.get(prefab.root), entities, idMap };
    }
}
/** Adds an instance's entities to a scene document. */
export function addInstanceToScene(scene, instance) {
    const existing = new Set(scene.entities.map((entity) => entity.id));
    for (const entity of instance.entities) {
        if (existing.has(entity.id)) {
            throw new Error(`Instantiating prefab "${instance.prefabId}" produced entity id "${entity.id}", which the scene already contains.`);
        }
    }
    return { ...scene, entities: [...scene.entities, ...structuredClone(instance.entities)] };
}
function applyOverride(entity, override, prefabId) {
    const component = entity.components.find((record) => record.typeName === override.component);
    if (!component) {
        throw new Error(`Override targets component "${override.component}" on entity "${override.entity}", which prefab "${prefabId}" does not have.`);
    }
    setPath(component, override.field, override.value, prefabId, override);
}
function setPath(component, field, value, prefabId, override) {
    const parts = field.split(".").filter((part) => part.length > 0);
    if (parts.length === 0)
        throw new Error(`Override on prefab "${prefabId}" has an empty field path.`);
    let cursor = component.data;
    if (cursor === null || typeof cursor !== "object") {
        throw new Error(`Cannot override "${field}" on component "${override.component}" because its data is not an object.`);
    }
    for (const part of parts.slice(0, -1)) {
        const next = cursor[part];
        if (next === null || typeof next !== "object") {
            throw new Error(`Override path "${field}" on component "${override.component}" stops at "${part}", which is not an object.`);
        }
        cursor = next;
    }
    const leaf = parts[parts.length - 1];
    if (!(leaf in cursor)) {
        throw new Error(`Override path "${field}" on component "${override.component}" names "${leaf}", which the component does not define.`);
    }
    cursor[leaf] = structuredClone(value);
}
function applyTransform(root, transform) {
    let record = root.components.find((component) => component.typeName === "vapour.Transform");
    if (!record) {
        record = { typeName: "vapour.Transform", version: 1, data: defaultTransform() };
        root.components.unshift(record);
    }
    const data = record.data;
    if (transform.position)
        data.position = [...transform.position];
    if (transform.rotation)
        data.rotation = [...transform.rotation];
    if (transform.scale)
        data.scale = [...transform.scale];
}
//# sourceMappingURL=prefab.js.map