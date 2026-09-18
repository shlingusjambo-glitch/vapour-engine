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
import { type SceneEntityData, type SceneData, type TransformData } from "../core/scene-document.js";
export declare const PREFAB_FORMAT_VERSION: 1;
/** A change applied to one component field of one entity in an instance. */
export interface PrefabOverride {
    /** Local id of the entity within the prefab. */
    readonly entity: string;
    /** Component type name, e.g. `vapour.Transform`. */
    readonly component: string;
    /** Dot path within the component's data, e.g. `position` or `material.tint`. */
    readonly field: string;
    readonly value: unknown;
}
/** A nested prefab reference inside a prefab definition. */
export interface PrefabChild {
    /** Local id this nested instance is known by inside the parent prefab. */
    readonly id: string;
    readonly prefabId: string;
    /** Local id of the entity in the parent prefab to attach beneath. */
    readonly parent?: string;
    readonly overrides?: readonly PrefabOverride[];
}
export interface PrefabData {
    readonly formatVersion: typeof PREFAB_FORMAT_VERSION;
    readonly id: string;
    readonly name: string;
    /** Local id of the prefab's root entity. */
    readonly root: string;
    /** Entities using prefab-local ids. `parent` refers to another local id. */
    readonly entities: readonly SceneEntityData[];
    readonly children?: readonly PrefabChild[];
}
export interface InstantiateOptions {
    /** Scene entity id to attach the instance root beneath. */
    readonly parent?: string;
    readonly overrides?: readonly PrefabOverride[];
    /** Applied to the instance root after overrides. */
    readonly transform?: Partial<TransformData>;
    /** Name for the instance root; defaults to the prefab's name. */
    readonly name?: string;
    /**
     * Produces entity ids. Supply a deterministic factory when instance ids must
     * match across a network or between runs; the default is `crypto.randomUUID`.
     */
    readonly idFactory?: (prefabId: string, localId: string, index: number) => string;
}
export interface PrefabInstance {
    readonly prefabId: string;
    /** Scene id of the instantiated root entity. */
    readonly rootId: string;
    /** Every entity the instantiation produced, ready to add to a scene. */
    readonly entities: readonly SceneEntityData[];
    /** Prefab-local id to scene entity id, for addressing parts afterwards. */
    readonly idMap: ReadonlyMap<string, string>;
}
export declare function validatePrefab(data: PrefabData): PrefabData;
/**
 * A registry of prefab definitions.
 *
 * Instantiation resolves nested prefabs through the library, so a prefab may be
 * registered in any order relative to the ones it references.
 */
export declare class PrefabLibrary {
    #private;
    register(data: PrefabData): void;
    has(prefabId: string): boolean;
    get(prefabId: string): PrefabData | undefined;
    get ids(): readonly string[];
    require(prefabId: string): PrefabData;
    /** Produces entities for one instance. The caller adds them to a scene. */
    instantiate(prefabId: string, options?: InstantiateOptions): PrefabInstance;
}
/** Adds an instance's entities to a scene document. */
export declare function addInstanceToScene(scene: SceneData, instance: PrefabInstance): SceneData;
//# sourceMappingURL=prefab.d.ts.map