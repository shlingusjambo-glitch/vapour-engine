import { describe, expect, it } from "vitest";
import { EditorCamera } from "./editor-camera.js";
import { rayThroughViewport } from "./picking.js";
import {
  distanceToSegment,
  dragAlongAxis,
  projectToViewport,
  sweptAngle,
  viewProjectionMatrix,
  worldUnitsPerPixel,
} from "./projection.js";

const camera = {
  entityId: "camera",
  worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1],
  fieldOfView: 60,
  near: 0.1,
  far: 1000,
};

describe("projectToViewport", () => {
  it("puts the pivot the camera faces at the viewport centre", () => {
    const point = projectToViewport(
      viewProjectionMatrix(camera, 16 / 9),
      [0, 0, 0],
      1600,
      900,
    );
    expect(point.x).toBeCloseTo(800, 4);
    expect(point.y).toBeCloseTo(450, 4);
    expect(point.visible).toBe(true);
  });

  it("maps +X right and +Y up on screen", () => {
    const matrix = viewProjectionMatrix(camera, 1);
    const right = projectToViewport(matrix, [1, 0, 0], 800, 800);
    const above = projectToViewport(matrix, [0, 1, 0], 800, 800);
    expect(right.x).toBeGreaterThan(400);
    expect(above.y).toBeLessThan(400);
  });

  it("marks geometry behind the camera as not visible", () => {
    const behind = projectToViewport(
      viewProjectionMatrix(camera, 1),
      [0, 0, 40],
      800,
      800,
    );
    expect(behind.visible).toBe(false);
  });

  it("agrees with the pick ray it must stay consistent with", () => {
    const editorCamera = new EditorCamera({ target: [1, 2, -3], distance: 9 });
    editorCamera.orbit(60, 25);
    const snapshot = editorCamera.snapshot();
    const world: [number, number, number] = [1, 2, -3];
    const projected = projectToViewport(
      viewProjectionMatrix(snapshot, 4 / 3),
      world,
      800,
      600,
    );
    // Shooting a ray back through the projected pixel must return to the point.
    const ray = rayThroughViewport(
      { version: 1, camera: snapshot, instances: [] },
      (projected.x / 800) * 2 - 1,
      1 - (projected.y / 600) * 2,
      4 / 3,
    );
    const toPoint = [
      world[0] - ray.origin[0],
      world[1] - ray.origin[1],
      world[2] - ray.origin[2],
    ];
    const length = Math.hypot(...toPoint);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(ray.direction[axis]).toBeCloseTo(toPoint[axis]! / length, 5);
    }
  });

  it("reports a non-visible point instead of dividing by a zero w", () => {
    const degenerate = projectToViewport(
      new Array(16).fill(0),
      [1, 1, 1],
      100,
      100,
    );
    expect(degenerate.visible).toBe(false);
    expect(Number.isNaN(degenerate.x)).toBe(true);
  });
});

describe("worldUnitsPerPixel", () => {
  it("scales linearly with distance so handles keep a constant pixel size", () => {
    const near = worldUnitsPerPixel(camera, [0, 0, 5], 600);
    const far = worldUnitsPerPixel(camera, [0, 0, -5], 600);
    expect(far / near).toBeCloseTo(3, 5);
  });

  it("never returns zero or negative scale at the camera plane", () => {
    expect(worldUnitsPerPixel(camera, [0, 0, 10], 600)).toBeGreaterThan(0);
  });
});

describe("gizmo interaction maths", () => {
  it("measures pixel distance to an axis handle", () => {
    expect(distanceToSegment([50, 10], [0, 0], [100, 0]).distance).toBeCloseTo(
      10,
      6,
    );
    expect(distanceToSegment([50, 10], [0, 0], [100, 0]).t).toBeCloseTo(0.5, 6);
    // Past the tip, the closest point clamps to the segment end.
    expect(distanceToSegment([160, 0], [0, 0], [100, 0]).distance).toBeCloseTo(
      60,
      6,
    );
  });

  it("converts a pointer drag into movement along the projected axis", () => {
    const origin = { x: 100, y: 100, depth: 0.5, visible: true };
    const tip = { x: 200, y: 100, depth: 0.5, visible: true };
    // Dragging one axis-length to the right moves exactly one world unit.
    expect(dragAlongAxis(origin, tip, 1, [100, 0])).toBeCloseTo(1, 6);
    expect(dragAlongAxis(origin, tip, 1, [-50, 0])).toBeCloseTo(-0.5, 6);
    // Movement perpendicular to the axis contributes nothing.
    expect(dragAlongAxis(origin, tip, 1, [0, 80])).toBeCloseTo(0, 6);
  });

  it("returns no movement for an off-screen or degenerate axis", () => {
    const origin = { x: 100, y: 100, depth: 0.5, visible: true };
    expect(
      dragAlongAxis(
        origin,
        { x: 100, y: 100, depth: 0.5, visible: true },
        1,
        [50, 0],
      ),
    ).toBe(0);
    expect(
      dragAlongAxis(
        origin,
        { x: 200, y: 100, depth: -1, visible: false },
        1,
        [50, 0],
      ),
    ).toBe(0);
  });

  it("measures the angle swept around a pivot and wraps at ±180°", () => {
    expect(sweptAngle([0, 0], [1, 0], [0, 1])).toBeCloseTo(Math.PI / 2, 6);
    expect(sweptAngle([0, 0], [0, 1], [1, 0])).toBeCloseTo(-Math.PI / 2, 6);
    // Crossing the -X seam takes the short way round rather than jumping 2π.
    expect(Math.abs(sweptAngle([0, 0], [-1, 0.01], [-1, -0.01]))).toBeLessThan(
      0.1,
    );
  });
});
