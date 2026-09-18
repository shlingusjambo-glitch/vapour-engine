/** Drives a `SceneManager` from a network client's scene requests.
 *
 * `@vapour/net` holds replication for a client until it reports its scene
 * loaded; `SceneManager.load` reports progress and resolves when done. This is
 * the glue, typed structurally so that `@vapour/engine` depends on nothing in
 * `@vapour/net`: hand it `sceneManager` and `client` and wire
 * `client.onSceneLoad` to `sync.onSceneLoad`.
 *
 * ```ts
 * const sync = createSceneSync(sceneManager, client);
 * const client = new NetworkClient(transport, { onSceneLoad: (scene, generation) => sync.onSceneLoad(scene, generation) });
 * ```
 */

/** What this needs from `SceneManager`: exactly `load`'s shape. */
export interface SceneSyncLoader {
  load(sceneId: string, options: { readonly mode?: "single" | "additive"; readonly onProgress?: (progress: number) => void }): Promise<unknown>;
}

/** What this needs from `NetworkClient`. */
export interface SceneSyncReporter {
  reportSceneProgress(progress: number, ready: boolean, generation?: number): void;
}

export interface SceneSyncOptions {
  /** How to load the requested scene. Default `single`: the server's scene *is* the level. */
  readonly mode?: "single" | "additive";
  /** Called when a load fails; the server is never told ready. */
  readonly onError?: (scene: string, generation: number, error: unknown) => void;
}

export interface SceneSync {
  /** Wire to `ClientOptions.onSceneLoad`. */
  onSceneLoad(scene: string, generation: number): void;
  /** The generation most recently requested, or 0 before any. */
  readonly generation: number;
  /** Whether the most recently requested scene has finished loading. */
  readonly ready: boolean;
}

export function createSceneSync(sceneManager: SceneSyncLoader, client: SceneSyncReporter, options: SceneSyncOptions = {}): SceneSync {
  let generation = 0;
  let ready = false;
  return {
    get generation() { return generation; },
    get ready() { return ready; },
    onSceneLoad(scene, requested) {
      generation = requested;
      ready = false;
      client.reportSceneProgress(0, false, requested);
      // Every report names the generation it is for. If the server moves on to
      // another scene while this one loads, its reports are stale by
      // construction and the server drops them; nothing here needs to race.
      const loadOptions = {
        ...(options.mode === undefined ? {} : { mode: options.mode }),
        onProgress: (progress: number) => client.reportSceneProgress(Math.min(1, Math.max(0, progress)), false, requested),
      };
      sceneManager.load(scene, loadOptions).then(
        () => {
          if (requested === generation) ready = true;
          client.reportSceneProgress(1, true, requested);
        },
        (error: unknown) => options.onError?.(scene, requested, error),
      );
    },
  };
}
