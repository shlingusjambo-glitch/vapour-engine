import { describe, expect, it, vi } from "vitest";
import { LoadingSession } from "./loading-progress.js";

describe("LoadingSession", () => {
  it("aggregates weighted tasks and emits immutable snapshots", () => {
    const loading = new LoadingSession([
      { id: "metadata", label: "Metadata", weight: 1 },
      { id: "world", label: "World", weight: 3 },
    ]);
    const listener = vi.fn();
    loading.subscribe(listener);
    loading.complete("metadata");
    loading.report("world", 0.5, "Generating spawn");
    expect(loading.progress).toBeCloseTo(0.625);
    expect(loading.snapshot().activeTask?.detail).toBe("Generating spawn");
    expect(listener).toHaveBeenCalledTimes(3);
    loading.complete("world");
    expect(loading.snapshot().state).toBe("complete");
  });

  it("aggregates nested task groups", () => {
    const loading = new LoadingSession([
      { id: "bootstrap", label: "Bootstrap", weight: 1 },
      { id: "stream", label: "Stream", weight: 3 },
      { id: "terrain", label: "Terrain", parent: "stream", weight: 3 },
      { id: "navigation", label: "Navigation", parent: "stream", weight: 1 },
    ]);
    loading.complete("bootstrap");
    loading.complete("terrain");
    expect(loading.progress).toBeCloseTo(0.8125);
    expect(loading.snapshot().tasks.find((task) => task.id === "stream")?.progress).toBe(0.75);
  });

  it("runs work with reporting and captures failures", async () => {
    const loading = new LoadingSession([{ id: "asset", label: "Asset" }]);
    await expect(loading.run("asset", ({ report }) => {
      report(0.4, "Decoding");
      throw new Error("invalid texture");
    })).rejects.toThrow("invalid texture");
    expect(loading.state).toBe("failed");
    expect(loading.signal.aborted).toBe(true);
    expect(loading.snapshot().tasks[0]?.state).toBe("failed");
  });

  it("supports explicit cancellation", () => {
    const loading = new LoadingSession([{ id: "world", label: "World" }]);
    loading.start("world");
    loading.cancel("left session");
    expect(loading.state).toBe("cancelled");
    expect(loading.snapshot().tasks[0]?.state).toBe("cancelled");
    expect(() => loading.report("world", 0.5)).toThrow(/already cancelled/);
  });

  it("attributes orchestration failures to the active task", () => {
    const loading = new LoadingSession([
      { id: "metadata", label: "Metadata" },
      { id: "world", label: "World" },
    ]);
    loading.complete("metadata");
    loading.start("world");
    loading.failActive(new Error("generation failed"));
    expect(loading.snapshot().tasks.find((task) => task.id === "world")?.state).toBe("failed");
    expect(loading.state).toBe("failed");
  });

  it("rejects invalid hierarchies and backwards progress", () => {
    expect(() => new LoadingSession([{ id: "child", label: "Child", parent: "missing" }])).toThrow(/missing parent/);
    const loading = new LoadingSession([{ id: "world", label: "World" }]);
    loading.report("world", 0.5);
    expect(() => loading.report("world", 0.4)).toThrow(/backwards/);
  });
});
