import { describe, expect, it } from "vitest";
import { createParticleEmitter2D, planarPositions } from "./particles-2d.js";

describe("2D particle adapter", () => {
  it("emits particles that stay on the XY plane despite 3D shape sampling", () => {
    const emitter = createParticleEmitter2D({
      capacity: 64,
      burst: 32,
      shape: { kind: "sphere", size: [2, 2] }, // a shape whose 3D sampling would drift in Z
      lifetime: [10, 10],
      speed: [1, 1],
    });
    emitter.play();
    emitter.update(0); // spawn the initial burst
    const points = planarPositions(emitter.buffers());
    console.log(
      `M115 particle adapter: emitted ${points.length} particles, all z-consistent (2D)`,
    );
    expect(points.length).toBeGreaterThan(0);
    const buffers = emitter.buffers();
    for (let index = 0; index < buffers.count; index += 1) {
      expect(buffers.positions[index * 3 + 2]).toBe(0);
    }
  });

  it("applies 2D gravity along screen-down and keeps updating planar", () => {
    const emitter = createParticleEmitter2D({
      capacity: 8,
      burst: 8,
      shape: { kind: "point" },
      gravity: [0, -20],
      lifetime: [5, 5],
      speed: [0, 0],
    });
    emitter.play();
    emitter.update(0);
    const before = planarPositions(emitter.buffers())[0]!;
    emitter.update(1);
    const after = planarPositions(emitter.buffers())[0]!;
    expect(after[1]).toBeLessThan(before[1]); // fell under gravity
    const buffers = emitter.buffers();
    expect(buffers.positions[2]).toBe(0); // still on the plane
  });

  it("keeps 2D shape bounds when packing a box emitter", () => {
    const emitter = createParticleEmitter2D({
      capacity: 200,
      burst: 200,
      shape: { kind: "box", size: [3, 1] },
      lifetime: [10, 10],
      speed: [0, 0],
    });
    emitter.play();
    emitter.update(0);
    const points = planarPositions(emitter.buffers());
    for (const [x, y] of points) {
      expect(Math.abs(x)).toBeLessThanOrEqual(3);
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
    }
  });
});
