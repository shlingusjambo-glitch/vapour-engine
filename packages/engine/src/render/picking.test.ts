import { describe, expect, it } from "vitest";
import { EditorCamera } from "./editor-camera.js";
import { pickAtPixel, pickInstance, rayThroughViewport } from "./picking.js";
import {
  RENDER_WORLD_VERSION,
  type RenderWorldSnapshot,
} from "./render-world.js";

/** A camera at +Z looking back toward the origin down -Z. */
function cameraAt(z: number) {
  return {
    entityId: "camera",
    worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1],
    fieldOfView: 60,
    near: 0.1,
    far: 1000,
  };
}

function snapshot(
  instances: RenderWorldSnapshot["instances"],
  z = 10,
): RenderWorldSnapshot {
  return { version: RENDER_WORLD_VERSION, camera: cameraAt(z), instances };
}

function cubeAt(
  entityId: string,
  x: number,
  y: number,
  z: number,
  scale = 1,
  mesh = "builtin:cube",
): RenderWorldSnapshot["instances"][number] {
  return {
    entityId,
    mesh,
    material: "builtin:default",
    modelMatrix: [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, x, y, z, 1],
    baseColor: [1, 1, 1, 1],
    materialParams: [0, 0.6, 0, 0.01],
  };
}

describe("rayThroughViewport", () => {
  it("shoots a centre ray straight down the view direction", () => {
    const ray = rayThroughViewport(snapshot([]), 0, 0, 16 / 9);
    expect(ray.origin).toEqual([0, 0, 10]);
    expect(ray.direction[0]).toBeCloseTo(0, 6);
    expect(ray.direction[1]).toBeCloseTo(0, 6);
    expect(ray.direction[2]).toBeCloseTo(-1, 6);
  });

  it("spreads rays horizontally by the aspect ratio", () => {
    const narrow = rayThroughViewport(snapshot([]), 1, 0, 1);
    const wide = rayThroughViewport(snapshot([]), 1, 0, 2);
    expect(Math.abs(wide.direction[0])).toBeGreaterThan(
      Math.abs(narrow.direction[0]),
    );
  });

  it("returns unit-length directions across the frustum", () => {
    for (const [x, y] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [0.3, -0.7],
    ] as const) {
      const ray = rayThroughViewport(snapshot([]), x, y, 16 / 9);
      expect(Math.hypot(...ray.direction)).toBeCloseTo(1, 6);
    }
  });

  it("refuses to pick without a camera or with invalid inputs", () => {
    expect(() =>
      rayThroughViewport(
        { version: RENDER_WORLD_VERSION, instances: [] },
        0,
        0,
        1,
      ),
    ).toThrow(/without a camera/);
    expect(() => rayThroughViewport(snapshot([]), Number.NaN, 0, 1)).toThrow(
      /finite/,
    );
    expect(() => rayThroughViewport(snapshot([]), 0, 0, 0)).toThrow(
      /aspect ratio/,
    );
  });
});

describe("pickInstance", () => {
  it("hits a cube under the cursor and misses empty space", () => {
    const world = snapshot([cubeAt("cube", 0, 0, 0)]);
    expect(
      pickInstance(world, rayThroughViewport(world, 0, 0, 1))?.entityId,
    ).toBe("cube");
    expect(
      pickInstance(world, { origin: [0, 20, 10], direction: [0, 0, -1] }),
    ).toBeUndefined();
  });

  it("reports the distance to the near face, not the centre", () => {
    const world = snapshot([cubeAt("cube", 0, 0, 0)]);
    const hit = pickInstance(world, rayThroughViewport(world, 0, 0, 1));
    // Camera sits at z=10; the unit cube's near face is at z=0.5.
    expect(hit?.distance).toBeCloseTo(9.5, 5);
  });

  it("returns the nearest of several overlapping instances", () => {
    const world = snapshot([
      cubeAt("far", 0, 0, -5),
      cubeAt("near", 0, 0, 2),
      cubeAt("middle", 0, 0, 0),
    ]);
    expect(
      pickInstance(world, rayThroughViewport(world, 0, 0, 1))?.entityId,
    ).toBe("near");
  });

  it("respects instance scale when sizing the box", () => {
    const world = snapshot([cubeAt("big", 3, 0, 0, 10)]);
    // A ray 3 units off-axis misses a unit cube but hits a ten-unit one.
    expect(
      pickInstance(world, { origin: [3, 4, 10], direction: [0, 0, -1] })
        ?.entityId,
    ).toBe("big");
    const small = snapshot([cubeAt("small", 3, 0, 0, 1)]);
    expect(
      pickInstance(small, { origin: [3, 4, 10], direction: [0, 0, -1] }),
    ).toBeUndefined();
  });

  it("skips degenerate zero-scale instances instead of dividing by zero", () => {
    const world = snapshot([
      {
        entityId: "flat",
        mesh: "builtin:cube",
        material: "builtin:default",
        modelMatrix: new Array(16).fill(0),
        baseColor: [1, 1, 1, 1],
        materialParams: [0, 0.6, 0, 0.01],
      },
    ]);
    expect(
      pickInstance(world, rayThroughViewport(world, 0, 0, 1)),
    ).toBeUndefined();
  });

  it("ignores geometry behind the camera", () => {
    const world = snapshot([cubeAt("behind", 0, 0, 20)]);
    expect(
      pickInstance(world, rayThroughViewport(world, 0, 0, 1)),
    ).toBeUndefined();
  });
});

describe("pickAtPixel", () => {
  it("maps the viewport centre to the cube under it", () => {
    const world = snapshot([cubeAt("cube", 0, 0, 0)]);
    expect(pickAtPixel(world, 320, 180, 640, 360)?.entityId).toBe("cube");
    expect(pickAtPixel(world, 4, 4, 640, 360)).toBeUndefined();
  });

  it("agrees with the editor camera after it has been navigated", () => {
    const camera = new EditorCamera({ target: [0, 0, 0], distance: 12 });
    camera.orbit(140, -35);
    camera.dolly(-1);
    const world: RenderWorldSnapshot = {
      version: RENDER_WORLD_VERSION,
      camera: camera.snapshot(),
      instances: [cubeAt("cube", 0, 0, 0, 2)],
    };
    // The pivot is the cube, so the viewport centre must always hit it.
    expect(pickAtPixel(world, 400, 300, 800, 600)?.entityId).toBe("cube");
  });

  it("rejects a zero-sized viewport", () => {
    expect(() => pickAtPixel(snapshot([]), 0, 0, 0, 0)).toThrow(
      /Viewport size/,
    );
  });
});

describe("mesh-aware selection", () => {
  it("sizes the hit box from the mesh, not a fixed unit cube", () => {
    // A capsule is only 0.25 wide, so a ray 0.4 units off-centre passes it but
    // still strikes a cube of the same scale.
    const ray = {
      origin: [0.4, 0, 10] as const,
      direction: [0, 0, -1] as const,
    };
    expect(
      pickInstance(snapshot([cubeAt("cube", 0, 0, 0)]), ray)?.entityId,
    ).toBe("cube");
    expect(
      pickInstance(
        snapshot([cubeAt("capsule", 0, 0, 0, 1, "builtin:capsule")]),
        ray,
      ),
    ).toBeUndefined();
  });

  it("selects a plane despite its zero-height geometry", () => {
    const world = snapshot([cubeAt("ground", 0, 0, 0, 1, "builtin:plane")]);
    expect(pickAtPixel(world, 400, 300, 800, 600)?.entityId).toBe("ground");
  });

  it("still selects an instance whose mesh has no library entry", () => {
    const world = snapshot([cubeAt("mystery", 0, 0, 0, 1, "plugin:unknown")]);
    expect(pickAtPixel(world, 400, 300, 800, 600)?.entityId).toBe("mystery");
  });
});
