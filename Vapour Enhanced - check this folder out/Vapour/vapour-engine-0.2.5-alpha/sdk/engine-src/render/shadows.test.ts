import { describe, expect, it } from "vitest";
import { transformPoint } from "@vapour/math";
import {
  boundingSphere,
  cascadeDepthBias,
  cascadeSplits,
  computeCascade,
  computeCascades,
  frustumCorners,
  packCascadeMatrices,
  packCascadeSplits,
  selectCascade,
} from "./shadows.js";
import type { RenderCameraSnapshot } from "./render-world.js";

const camera: RenderCameraSnapshot = {
  entityId: "cam",
  worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  fieldOfView: 60,
  projection: "perspective",
  near: 0.1,
  far: 200,
};

const sun = [-0.4, -1, -0.3];

describe("cascadeSplits", () => {
  it("spans the range with one boundary per cascade plus the ends", () => {
    const splits = cascadeSplits(1, 100, 3);
    expect(splits).toHaveLength(4);
    expect(splits[0]).toBe(1);
    expect(splits[3]).toBe(100);
    expect(splits).toEqual([...splits].sort((a, b) => a - b));
  });

  it("splits evenly at lambda 0 and logarithmically at lambda 1", () => {
    const uniform = cascadeSplits(1, 101, 2, 0);
    expect(uniform[1]).toBeCloseTo(51);
    const logarithmic = cascadeSplits(1, 100, 2, 1);
    expect(logarithmic[1]).toBeCloseTo(10);
  });

  it("puts more resolution near the camera than a uniform split would", () => {
    const practical = cascadeSplits(1, 100, 3, 0.75);
    const uniform = cascadeSplits(1, 100, 3, 0);
    expect(practical[1]).toBeLessThan(uniform[1]!);
  });

  it("validates its inputs", () => {
    expect(() => cascadeSplits(0, 100, 3)).toThrow(/0 < near < far/);
    expect(() => cascadeSplits(10, 5, 3)).toThrow(/0 < near < far/);
    expect(() => cascadeSplits(1, 100, 0)).toThrow(/at least one cascade/);
    expect(() => cascadeSplits(1, 100, 3, 2)).toThrow(/\[0, 1\]/);
  });
});

describe("frustumCorners", () => {
  it("returns eight corners spanning the requested depth range", () => {
    const corners = frustumCorners(camera, 16 / 9, 1, 10);
    expect(corners).toHaveLength(8);
    const z = corners.map((corner) => corner[2]);
    // The camera looks down -Z, so the slice sits between -1 and -10.
    expect(Math.max(...z)).toBeCloseTo(-1, 4);
    expect(Math.min(...z)).toBeCloseTo(-10, 4);
  });

  it("widens with distance under perspective", () => {
    const near = frustumCorners(camera, 1, 1, 2);
    const far = frustumCorners(camera, 1, 10, 20);
    const width = (corners: readonly (readonly number[])[]) =>
      Math.max(...corners.map((corner) => Math.abs(corner[0]!)));
    expect(width(far)).toBeGreaterThan(width(near));
  });

  it("validates its inputs", () => {
    expect(() => frustumCorners(camera, 0, 1, 10)).toThrow(
      /positive aspect ratio/,
    );
    expect(() => frustumCorners(camera, 1, 10, 1)).toThrow(/0 < near < far/);
  });
});

describe("boundingSphere", () => {
  it("contains every point", () => {
    const points: [number, number, number][] = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ];
    const { center, radius } = boundingSphere(points);
    for (const point of points) {
      expect(
        Math.hypot(
          point[0] - center[0],
          point[1] - center[1],
          point[2] - center[2],
        ),
      ).toBeLessThanOrEqual(radius + 1e-9);
    }
  });

  it("requires at least one point", () => {
    expect(() => boundingSphere([])).toThrow(/at least one point/);
  });
});

describe("computeCascades", () => {
  it("produces cascades ordered near to far, covering the whole range", () => {
    const cascades = computeCascades(camera, 16 / 9, sun, { cascadeCount: 3 });
    expect(cascades).toHaveLength(3);
    expect(cascades.map((cascade) => cascade.index)).toEqual([0, 1, 2]);
    expect(cascades[0]!.near).toBe(camera.near);
    expect(cascades[2]!.far).toBe(camera.far);
    for (let index = 1; index < cascades.length; index += 1) {
      expect(cascades[index]!.near).toBe(cascades[index - 1]!.far);
      expect(cascades[index]!.radius).toBeGreaterThan(
        cascades[index - 1]!.radius,
      );
    }
  });

  it("honours a max distance shorter than the camera's far plane", () => {
    const cascades = computeCascades(camera, 1, sun, { maxDistance: 50 });
    expect(cascades[cascades.length - 1]!.far).toBe(50);
  });

  it("projects the cascade's centre into the middle of its shadow map", () => {
    const [cascade] = computeCascades(camera, 1, sun, { cascadeCount: 1 });
    const projected = transformPoint(cascade!.viewProjection, cascade!.center);
    // Texel snapping offsets the centre by at most half a texel of clip space.
    expect(Math.abs(projected[0])).toBeLessThan(0.05);
    expect(Math.abs(projected[1])).toBeLessThan(0.05);
    expect(projected[2]).toBeGreaterThan(0);
    expect(projected[2]).toBeLessThan(1);
  });

  it("keeps every frustum corner inside its cascade's shadow map", () => {
    const cascades = computeCascades(camera, 16 / 9, sun, { cascadeCount: 3 });
    for (const cascade of cascades) {
      for (const corner of frustumCorners(
        camera,
        16 / 9,
        cascade.near,
        cascade.far,
      )) {
        const projected = transformPoint(cascade.viewProjection, corner);
        expect(Math.abs(projected[0])).toBeLessThanOrEqual(1.001);
        expect(Math.abs(projected[1])).toBeLessThanOrEqual(1.001);
        expect(projected[2]).toBeGreaterThanOrEqual(-0.001);
        expect(projected[2]).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it("keeps a constant extent as the camera rotates, which is what stops shimmer", () => {
    const yaw = Math.PI / 6;
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const rotated: RenderCameraSnapshot = {
      ...camera,
      worldMatrix: [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1],
    };
    const a = computeCascades(camera, 16 / 9, sun, { cascadeCount: 1 })[0]!;
    const b = computeCascades(rotated, 16 / 9, sun, { cascadeCount: 1 })[0]!;
    expect(b.radius).toBeCloseTo(a.radius, 6);
    expect(b.texelWorldSize).toBeCloseTo(a.texelWorldSize, 6);
  });

  it("quantizes the shadow map's origin to whole texels as the camera moves", () => {
    const settings = { cascadeCount: 1, resolution: 1024 } as const;
    const base = computeCascades(camera, 1, sun, settings)[0]!;
    // In clip space one texel is this wide, because the ortho box spans the
    // cascade's diameter and the map is `resolution` texels across.
    const texelInClip = base.texelWorldSize / base.radius;

    const offsets: number[] = [];
    for (let step = 0; step <= 40; step += 1) {
      const moved: RenderCameraSnapshot = {
        ...camera,
        worldMatrix: [
          ...camera.worldMatrix.slice(0, 12),
          base.texelWorldSize * 0.1 * step,
          0,
          0,
          1,
        ],
      };
      offsets.push(
        computeCascades(moved, 1, sun, settings)[0]!.viewProjection[12]!,
      );
    }

    // Every position must land exactly on the texel grid. An unsnapped
    // implementation slides smoothly and fails this immediately.
    for (const offset of offsets) {
      const texels = offset / texelInClip;
      expect(Math.abs(texels - Math.round(texels))).toBeLessThan(1e-6);
    }
    // The camera really did move far enough to shift the grid, so this is not
    // passing by never changing at all.
    expect(
      new Set(offsets.map((offset) => Math.round(offset / texelInClip))).size,
    ).toBeGreaterThan(1);
  });

  it("handles a light pointing straight down without a degenerate basis", () => {
    expect(() => computeCascades(camera, 1, [0, -1, 0])).not.toThrow();
    expect(() => computeCascades(camera, 1, [0, 1, 0])).not.toThrow();
  });

  it("validates its settings", () => {
    expect(() => computeCascades(camera, 1, sun, { cascadeCount: 0 })).toThrow(
      /one to four/,
    );
    expect(() => computeCascades(camera, 1, sun, { cascadeCount: 5 })).toThrow(
      /one to four/,
    );
    expect(() =>
      computeCascades(camera, 1, sun, { maxDistance: 0.05 }),
    ).toThrow(/greater than the camera's near plane/);
    expect(() => computeCascades(camera, 1, [0, 0, 0])).toThrow(
      /non-zero direction/,
    );
    expect(() =>
      computeCascade(camera, 1, sun, 1, 10, 0, { resolution: 0 }),
    ).toThrow(/positive whole number of texels/);
    expect(() =>
      computeCascade(camera, 1, sun, 1, 10, 0, { casterDistance: -1 }),
    ).toThrow(/must not be negative/);
  });
});

describe("cascade packing and selection", () => {
  const cascades = computeCascades(camera, 16 / 9, sun, { cascadeCount: 3 });

  it("scales the depth bias with texel size, so far cascades get more", () => {
    const near = cascadeDepthBias(cascades[0]!);
    const far = cascadeDepthBias(cascades[2]!);
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(0);
    expect(() => cascadeDepthBias(cascades[0]!, -1)).toThrow(
      /must not be negative/,
    );
  });

  it("packs splits with infinity past the last cascade", () => {
    const packed = packCascadeSplits(cascades);
    expect(packed).toHaveLength(4);
    expect(packed[2]).toBe(cascades[2]!.far);
    expect(packed[3]).toBe(Number.POSITIVE_INFINITY);
  });

  it("packs matrices contiguously", () => {
    const packed = packCascadeMatrices(cascades);
    expect(packed).toHaveLength(64);
    // Packed as f32 for upload, so compare within single-precision tolerance.
    for (const [index, value] of [...packed.slice(16, 32)].entries()) {
      expect(value).toBeCloseTo(cascades[1]!.viewProjection[index]!, 5);
    }
    // Unused slots stay zeroed.
    expect([...packed.slice(48, 64)].every((value) => value === 0)).toBe(true);
  });

  it("selects the first cascade whose range contains the depth", () => {
    expect(selectCascade(cascades, camera.near)).toBe(0);
    expect(selectCascade(cascades, cascades[0]!.far + 0.01)).toBe(1);
    expect(selectCascade(cascades, cascades[2]!.far)).toBe(2);
    // Beyond the last cascade there is no shadow map to sample.
    expect(selectCascade(cascades, cascades[2]!.far + 1)).toBeUndefined();
  });
});
