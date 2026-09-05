import { describe, expect, it } from "vitest";
import {
  SceneDocument,
  type SceneData,
  type SceneEntityData,
} from "../core/scene-document.js";
import { extractRenderWorld } from "./render-world.js";
import { IncrementalRenderWorld } from "./incremental-render-world.js";
import { cullRenderWorld } from "./culling.js";
import { LodRegistry } from "./lod.js";

/**
 * Scale tests for the extraction and submission path.
 *
 * These are deliberately *not* microbenchmarks. The claim Mirage makes is that
 * a large scene stops paying full extraction cost every frame and stops
 * submitting geometry the camera cannot see, so the assertions are about work
 * avoided — entities recomputed, instances submitted — which is stable across
 * machines. Wall-clock is asserted only with a generous ceiling, enough to
 * catch an order-of-magnitude regression without failing on a loaded CI box.
 */

const OBJECT_COUNT = 10_000;

function buildScene(count: number): SceneData {
  const entities: SceneEntityData[] = [
    {
      id: "camera",
      name: "Camera",
      enabled: true,
      components: [
        {
          typeName: "vapour.Transform",
          version: 1,
          data: {
            position: [0, 5, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
        },
        {
          typeName: "vapour.Camera",
          version: 1,
          data: { fieldOfView: 60, near: 0.1, far: 200 },
        },
      ],
    },
  ];
  // A grid centred on the origin, so roughly half the world is behind the
  // camera and most of the rest is beyond the far plane — the shape of an
  // actual open world, not a scene arranged to flatter the culler.
  const side = Math.ceil(Math.sqrt(count));
  const spacing = 6;
  for (let index = 0; index < count; index += 1) {
    const x = ((index % side) - side / 2) * spacing;
    const z = (Math.floor(index / side) - side / 2) * spacing;
    entities.push({
      id: `e${index}`,
      name: `Object ${index}`,
      enabled: true,
      components: [
        {
          typeName: "vapour.Transform",
          version: 1,
          data: {
            position: [x, 0, z],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
        },
        {
          typeName: "vapour.MeshRenderer",
          version: 1,
          data: {
            mesh: "builtin:cube",
            material: "m",
            baseColor: [1, 1, 1, 1],
          },
        },
      ],
    });
  }
  return { formatVersion: 1, id: "scale", name: "Scale", entities };
}

function milliseconds(body: () => void): number {
  const start = performance.now();
  body();
  return performance.now() - start;
}

describe(`render scale (${OBJECT_COUNT} objects)`, () => {
  const scene = buildScene(OBJECT_COUNT);

  it("extracts a large scene at all", () => {
    const world = extractRenderWorld(scene);
    expect(world.instances).toHaveLength(OBJECT_COUNT);
    expect(world.camera).toBeDefined();
  });

  it("recomputes a vanishing fraction of a mostly-static scene", () => {
    const incremental = new IncrementalRenderWorld();
    incremental.extract(scene);

    // A typical frame: a handful of things move.
    for (const index of [0, 1, 2, 3, 4]) {
      const entity = scene.entities[index + 1]!;
      const position = (entity.components[0]!.data as { position: number[] })
        .position;
      position[1] = (position[1] ?? 0) + 0.1;
    }
    incremental.extract(scene);

    expect(incremental.stats.recomputed).toBe(5);
    expect(incremental.stats.reused).toBe(OBJECT_COUNT - 4);
    expect(
      incremental.stats.recomputed / incremental.stats.entities,
    ).toBeLessThan(0.001);
  });

  it("produces the same snapshot as the full extractor at scale", () => {
    const incremental = new IncrementalRenderWorld();
    incremental.extract(scene);
    expect(incremental.extract(scene)).toEqual(extractRenderWorld(scene));
  });

  it("beats full extraction on a steady-state frame", () => {
    const incremental = new IncrementalRenderWorld();
    incremental.extract(scene);
    incremental.extract(scene);

    const full = milliseconds(() => {
      extractRenderWorld(scene);
    });
    const steady = milliseconds(() => {
      incremental.extract(scene);
    });

    // The incremental path still walks every entity to detect changes, so the
    // win is the avoided matrix chain, allocation, and revalidation — not a
    // constant factor. Requiring only "faster" keeps this stable on any machine.
    expect(steady).toBeLessThan(full);
  });

  it("submits only what the camera can see", () => {
    const world = extractRenderWorld(scene);
    const { world: culled, stats } = cullRenderWorld(world, 16 / 9);

    expect(stats.total).toBe(OBJECT_COUNT);
    expect(culled.instances.length).toBe(stats.visible);
    // Most of a world this size is behind the camera or past the far plane.
    expect(stats.visible).toBeLessThan(OBJECT_COUNT * 0.25);
    expect(stats.visible).toBeGreaterThan(0);
  });

  it("culls further with a distance limit", () => {
    const world = extractRenderWorld(scene);
    const wide = cullRenderWorld(world, 16 / 9).stats.visible;
    const near = cullRenderWorld(world, 16 / 9, { maxDistance: 50 }).stats
      .visible;
    expect(near).toBeLessThan(wide);
  });

  it("drops distant detail through LOD after culling", () => {
    const world = extractRenderWorld(scene);
    const { world: culled } = cullRenderWorld(world, 16 / 9);
    const registry = new LodRegistry();
    registry.define("builtin:cube", {
      levels: [
        { mesh: "builtin:cube", minScreenHeight: 0.05 },
        { mesh: "builtin:quad", minScreenHeight: 0.01 },
      ],
      cullScreenHeight: 0.004,
    });
    const result = registry.apply(culled.instances, world.camera!);
    expect(result.stats.total).toBe(culled.instances.length);
    expect(result.stats.drawn).toBeLessThanOrEqual(result.stats.total);
    // Something was simplified or dropped; a flat grid at this range cannot be
    // entirely full detail.
    expect(
      result.stats.culled + (result.stats.perLevel[1] ?? 0),
    ).toBeGreaterThan(0);
  });

  it("recomputes nothing at all for an untouched observed document", () => {
    const document = new SceneDocument(SceneDocument.empty("Scale"));
    for (let index = 0; index < 2_000; index += 1) {
      const created = document.addEntity(`O${index}`);
      document.addComponent(created.id, {
        typeName: "vapour.MeshRenderer",
        version: 1,
        data: { mesh: "builtin:cube", material: "m" },
      });
    }
    const incremental = new IncrementalRenderWorld();
    incremental.observe(document);
    incremental.extract(document.data as SceneData);
    incremental.extract(document.data as SceneData);

    // A document that reports its own edits removes the comparison walk
    // entirely, which is the case a static open world is in most frames.
    expect(incremental.stats).toMatchObject({
      observed: true,
      recomputed: 0,
      fullRebuild: false,
    });
  });

  it("keeps the whole submission path within a generous frame budget", () => {
    const incremental = new IncrementalRenderWorld();
    incremental.extract(scene);
    const registry = new LodRegistry();
    registry.define("builtin:cube", {
      levels: [{ mesh: "builtin:cube", minScreenHeight: 0 }],
    });

    const elapsed = milliseconds(() => {
      const world = incremental.extract(scene);
      const { world: culled } = cullRenderWorld(world, 16 / 9);
      registry.apply(culled.instances, world.camera!);
    });

    // Ten thousand objects through extract, cull, and LOD. The ceiling is loose
    // on purpose: it catches an order-of-magnitude regression, not jitter.
    expect(elapsed).toBeLessThan(250);
  });
});
