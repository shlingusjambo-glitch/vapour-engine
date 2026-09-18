/** Scene loading, unloading, additive composition, and lifecycle.
 *
 * A large game never has one scene. It has a persistent layer that survives
 * every transition, a primary scene that swaps as the player moves, and a
 * variable number of additive scenes streamed in around them. The manager owns
 * that arrangement so the rest of the engine can ask a single question — "what
 * is in the world right now?" — and get one answer.
 *
 * Scenes are loaded through the {@link ResourceManager} as the `scene` resource
 * type. That is deliberate: a scene loader can declare its meshes, textures,
 * and audio with `context.require`, and those dependencies are then reference
 * counted and released with the scene automatically. Unloading a level frees
 * exactly what nothing else is still using, with no bookkeeping in game code.
 */
import { SceneDocument, type SceneData } from "../core/scene-document.js";
import type { LoadOptions, ResourceManager } from "../resources/resource-manager.js";
/** The resource type scenes are loaded under. */
export declare const SCENE_RESOURCE_TYPE = "scene";
/**
 * `single` unloads every other non-persistent scene first, the way a level
 * change works. `additive` layers a scene alongside what is already loaded,
 * the way streaming regions and sub-levels work.
 */
export type SceneLoadMode = "single" | "additive";
export interface LoadedScene {
    readonly id: string;
    readonly name: string;
    readonly document: SceneDocument;
    readonly mode: SceneLoadMode;
}
export interface SceneLoadOptions extends LoadOptions {
    readonly mode?: SceneLoadMode;
    /** Make this the active scene once loaded. Defaults to true for `single`. */
    readonly setActive?: boolean;
}
/**
 * Hooks run around a transition, for a fade, a loading screen, or a wipe.
 *
 * The engine does not own transition visuals — a game's loading screen is a
 * game's business — but it does own the ordering, which is the part that is
 * easy to get wrong: `out` completes before anything is unloaded, and `in`
 * starts only once the new scene is fully loaded and active.
 */
export interface SceneTransition {
    out?(): Promise<void> | void;
    in?(): Promise<void> | void;
}
export interface SceneManagerStats {
    readonly loaded: number;
    readonly additive: number;
    readonly persistentEntities: number;
    readonly totalEntities: number;
}
/**
 * Owns which scenes are loaded and composes them into one world view.
 *
 * Emits `scenewillload`, `sceneloaded`, `scenewillunload`, `sceneunloaded`, and
 * `activescenechanged`. Every event's `detail` carries the scene id, so
 * gameplay, diagnostics, and the editor can react without polling.
 */
export declare class SceneManager extends EventTarget {
    #private;
    constructor(resources: ResourceManager);
    /**
     * Entities that survive every scene change: the player, managers, audio
     * listeners, anything a `single` load must not destroy.
     */
    get persistent(): SceneDocument;
    get loaded(): readonly LoadedScene[];
    get active(): LoadedScene | undefined;
    isLoaded(sceneId: string): boolean;
    isLoading(sceneId: string): boolean;
    scene(sceneId: string): LoadedScene | undefined;
    /**
     * The scene the game logic treats as current — where new entities go and
     * which one gameplay queries default to.
     */
    setActive(sceneId: string): void;
    /**
     * Loads a scene.
     *
     * Concurrent calls for the same scene share one load. Loading an
     * already-loaded scene is a no-op that returns the existing entry, so a
     * streaming system may call this whenever a region becomes relevant.
     */
    load(sceneId: string, options?: SceneLoadOptions): Promise<LoadedScene>;
    /**
     * Runs a full transition: `out`, then a `single` load of the target scene,
     * then `in`. The ordering is the point — see {@link SceneTransition}.
     */
    transitionTo(sceneId: string, options?: SceneLoadOptions & {
        readonly transition?: SceneTransition;
    }): Promise<LoadedScene>;
    /** Unloads one scene and releases its resource handle. Unloading the active
     * scene promotes the most recently loaded remaining scene. */
    unload(sceneId: string): void;
    /** Unloads every scene. Persistent entities are untouched. */
    unloadAll(): void;
    /**
     * Composes the persistent layer and every loaded scene into one scene
     * document for the renderer, physics, and navigation.
     *
     * Entity ids must be unique across loaded scenes. A collision is an
     * authoring error — two scenes claiming the same entity — and is reported
     * with both scene names rather than silently dropping one.
     */
    compose(name?: string): SceneData;
    stats(): SceneManagerStats;
}
//# sourceMappingURL=scene-manager.d.ts.map