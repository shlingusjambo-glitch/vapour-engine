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
export function createSceneSync(sceneManager, client, options = {}) {
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
                onProgress: (progress) => client.reportSceneProgress(Math.min(1, Math.max(0, progress)), false, requested),
            };
            sceneManager.load(scene, loadOptions).then(() => {
                if (requested === generation)
                    ready = true;
                client.reportSceneProgress(1, true, requested);
            }, (error) => options.onError?.(scene, requested, error));
        },
    };
}
//# sourceMappingURL=scene-sync.js.map