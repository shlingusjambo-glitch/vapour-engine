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
    load(sceneId: string, options: {
        readonly mode?: "single" | "additive";
        readonly onProgress?: (progress: number) => void;
    }): Promise<unknown>;
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
export declare function createSceneSync(sceneManager: SceneSyncLoader, client: SceneSyncReporter, options?: SceneSyncOptions): SceneSync;
//# sourceMappingURL=scene-sync.d.ts.map