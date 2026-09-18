import { describe, expect, it } from "vitest";
import { createSceneSync } from "./scene-sync.js";

function fakes() {
  const reports: [number, boolean, number | undefined][] = [];
  const loads: { scene: string; mode: string | undefined; resolve: () => void; reject: (error: Error) => void; progress: (p: number) => void }[] = [];
  const sceneManager = {
    load: (scene: string, options: { mode?: "single" | "additive"; onProgress?: (p: number) => void }) =>
      new Promise<void>((resolve, reject) => {
        loads.push({ scene, mode: options.mode, resolve, reject, progress: (p) => options.onProgress?.(p) });
      }),
  };
  const client = { reportSceneProgress: (p: number, ready: boolean, generation?: number) => { reports.push([p, ready, generation]); } };
  return { reports, loads, sceneManager, client };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("scene sync", () => {
  it("loads the requested scene, relays progress, and reports ready with the generation", async () => {
    const { reports, loads, sceneManager, client } = fakes();
    const sync = createSceneSync(sceneManager, client);
    sync.onSceneLoad("arena", 3);
    expect(loads.map((load) => [load.scene, load.mode])).toEqual([["arena", undefined]]);
    expect(sync.generation).toBe(3);
    expect(sync.ready).toBe(false);
    loads[0]!.progress(0.4);
    loads[0]!.resolve();
    await flush();
    expect(reports).toEqual([[0, false, 3], [0.4, false, 3], [1, true, 3]]);
    expect(sync.ready).toBe(true);
  });

  it("reports a superseded load under its own, stale generation and stays not-ready", async () => {
    const { reports, loads, sceneManager, client } = fakes();
    const sync = createSceneSync(sceneManager, client, { mode: "additive" });
    sync.onSceneLoad("lobby", 1);
    sync.onSceneLoad("arena", 2);
    expect(loads[1]!.mode).toBe("additive");
    loads[0]!.resolve();
    await flush();
    // The server ignores generation 1 now; this client must not think it is ready.
    expect(reports.at(-1)).toEqual([1, true, 1]);
    expect(sync.ready).toBe(false);
    loads[1]!.resolve();
    await flush();
    expect(reports.at(-1)).toEqual([1, true, 2]);
    expect(sync.ready).toBe(true);
  });

  it("never reports ready when the load fails", async () => {
    const { reports, loads, sceneManager, client } = fakes();
    const errors: string[] = [];
    const sync = createSceneSync(sceneManager, client, { onError: (scene, generation, error) => errors.push(`${scene}@${String(generation)}: ${(error as Error).message}`) });
    sync.onSceneLoad("arena", 1);
    loads[0]!.reject(new Error("404"));
    await flush();
    expect(errors).toEqual(["arena@1: 404"]);
    expect(reports.some(([, ready]) => ready)).toBe(false);
    expect(sync.ready).toBe(false);
  });
});
