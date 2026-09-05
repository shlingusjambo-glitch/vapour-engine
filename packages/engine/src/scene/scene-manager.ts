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
import { SceneDocument, validateScene, type SceneData, type SceneEntityData } from "../core/scene-document.js";
import type { ResourceHandle } from "../resources/handle.js";
import type { LoadOptions, ResourceManager } from "../resources/resource-manager.js";

/** The resource type scenes are loaded under. */
export const SCENE_RESOURCE_TYPE = "scene";

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

interface Entry {
  readonly scene: LoadedScene;
  readonly handle: ResourceHandle<SceneData>;
}

/**
 * Owns which scenes are loaded and composes them into one world view.
 *
 * Emits `scenewillload`, `sceneloaded`, `scenewillunload`, `sceneunloaded`, and
 * `activescenechanged`. Every event's `detail` carries the scene id, so
 * gameplay, diagnostics, and the editor can react without polling.
 */
export class SceneManager extends EventTarget {
  readonly #resources: ResourceManager;
  readonly #entries = new Map<string, Entry>();
  readonly #persistent: SceneDocument;
  readonly #pending = new Map<string, Promise<LoadedScene>>();
  #activeId: string | undefined;

  constructor(resources: ResourceManager) {
    super();
    this.#resources = resources;
    this.#persistent = new SceneDocument(SceneDocument.empty("Persistent"));
  }

  /**
   * Entities that survive every scene change: the player, managers, audio
   * listeners, anything a `single` load must not destroy.
   */
  get persistent(): SceneDocument {
    return this.#persistent;
  }

  get loaded(): readonly LoadedScene[] {
    return [...this.#entries.values()].map((entry) => entry.scene);
  }

  get active(): LoadedScene | undefined {
    return this.#activeId === undefined ? undefined : this.#entries.get(this.#activeId)?.scene;
  }

  isLoaded(sceneId: string): boolean {
    return this.#entries.has(sceneId);
  }

  isLoading(sceneId: string): boolean {
    return this.#pending.has(sceneId);
  }

  scene(sceneId: string): LoadedScene | undefined {
    return this.#entries.get(sceneId)?.scene;
  }

  /**
   * The scene the game logic treats as current — where new entities go and
   * which one gameplay queries default to.
   */
  setActive(sceneId: string): void {
    if (!this.#entries.has(sceneId)) {
      throw new Error(`Cannot activate scene "${sceneId}" because it is not loaded.`);
    }
    if (this.#activeId === sceneId) return;
    this.#activeId = sceneId;
    this.dispatchEvent(new CustomEvent("activescenechanged", { detail: sceneId }));
  }

  /**
   * Loads a scene.
   *
   * Concurrent calls for the same scene share one load. Loading an
   * already-loaded scene is a no-op that returns the existing entry, so a
   * streaming system may call this whenever a region becomes relevant.
   */
  async load(sceneId: string, options: SceneLoadOptions = {}): Promise<LoadedScene> {
    const id = sceneId.trim();
    if (!id) throw new Error("A scene id must not be empty.");
    const existing = this.#entries.get(id);
    if (existing) {
      if (options.setActive ?? false) this.setActive(id);
      return existing.scene;
    }
    const inFlight = this.#pending.get(id);
    if (inFlight) return inFlight;

    const mode = options.mode ?? "single";
    const promise = this.#load(id, mode, options);
    this.#pending.set(id, promise);
    try {
      return await promise;
    } finally {
      this.#pending.delete(id);
    }
  }

  /**
   * Runs a full transition: `out`, then a `single` load of the target scene,
   * then `in`. The ordering is the point — see {@link SceneTransition}.
   */
  async transitionTo(sceneId: string, options: SceneLoadOptions & { readonly transition?: SceneTransition } = {}): Promise<LoadedScene> {
    await options.transition?.out?.();
    const scene = await this.load(sceneId, { ...options, mode: "single" });
    await options.transition?.in?.();
    return scene;
  }

  /** Unloads one scene and releases its resource handle. Unloading the active
   * scene promotes the most recently loaded remaining scene. */
  unload(sceneId: string): void {
    const entry = this.#entries.get(sceneId);
    if (!entry) return;
    this.dispatchEvent(new CustomEvent("scenewillunload", { detail: sceneId }));
    this.#entries.delete(sceneId);
    entry.handle.release();
    if (this.#activeId === sceneId) {
      const remaining = [...this.#entries.keys()];
      this.#activeId = remaining[remaining.length - 1];
      this.dispatchEvent(new CustomEvent("activescenechanged", { detail: this.#activeId ?? null }));
    }
    this.dispatchEvent(new CustomEvent("sceneunloaded", { detail: sceneId }));
  }

  /** Unloads every scene. Persistent entities are untouched. */
  unloadAll(): void {
    for (const sceneId of [...this.#entries.keys()]) this.unload(sceneId);
  }

  /**
   * Composes the persistent layer and every loaded scene into one scene
   * document for the renderer, physics, and navigation.
   *
   * Entity ids must be unique across loaded scenes. A collision is an
   * authoring error — two scenes claiming the same entity — and is reported
   * with both scene names rather than silently dropping one.
   */
  compose(name = "World"): SceneData {
    const entities: SceneEntityData[] = [];
    const owners = new Map<string, string>();
    const append = (source: string, list: readonly SceneEntityData[]): void => {
      for (const entity of list) {
        const previous = owners.get(entity.id);
        if (previous !== undefined) {
          throw new Error(`Entity id "${entity.id}" appears in both "${previous}" and "${source}". Entity ids must be unique across loaded scenes.`);
        }
        owners.set(entity.id, source);
        entities.push(entity);
      }
    };
    append("Persistent", this.#persistent.data.entities);
    for (const entry of this.#entries.values()) append(entry.scene.name, entry.scene.document.data.entities);
    const composed: SceneData = {
      formatVersion: 1,
      id: this.#activeId ?? "composite",
      name,
      entities: structuredClone(entities),
    };
    validateScene(composed);
    return composed;
  }

  stats(): SceneManagerStats {
    const scenes = [...this.#entries.values()];
    return {
      loaded: scenes.length,
      additive: scenes.filter((entry) => entry.scene.mode === "additive").length,
      persistentEntities: this.#persistent.data.entities.length,
      totalEntities: this.#persistent.data.entities.length + scenes.reduce((sum, entry) => sum + entry.scene.document.data.entities.length, 0),
    };
  }

  async #load(id: string, mode: SceneLoadMode, options: SceneLoadOptions): Promise<LoadedScene> {
    this.dispatchEvent(new CustomEvent("scenewillload", { detail: id }));
    const handle = await this.#resources.load<SceneData>(SCENE_RESOURCE_TYPE, id, options);
    let document: SceneDocument;
    try {
      // Clone through SceneDocument so the cached resource value stays pristine:
      // gameplay mutating a loaded scene must not corrupt the next load of it.
      document = new SceneDocument(handle.value);
    } catch (error) {
      handle.release();
      throw new Error(`Scene "${id}" is not a valid scene document: ${messageOf(error)}`, { cause: error });
    }

    // Unload others only after the new scene is in hand, so a failed load
    // leaves the player looking at the world they already had.
    if (mode === "single") {
      for (const other of [...this.#entries.keys()]) this.unload(other);
    }

    const scene: LoadedScene = { id, name: document.data.name, document, mode };
    this.#entries.set(id, { scene, handle });
    if (options.setActive ?? mode === "single") this.setActive(id);
    this.dispatchEvent(new CustomEvent("sceneloaded", { detail: id }));
    return scene;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
