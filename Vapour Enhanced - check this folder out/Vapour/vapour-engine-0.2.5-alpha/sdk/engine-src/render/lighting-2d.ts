/** 2D point/spot/global lights and normal-map-free light accumulation.
 *
 * No shaders, no GPU: this is the pure-computation half a sprite renderer
 * needs — given a list of lights and a sample point (or a grid of them),
 * produce the colour to multiply a sprite's texel by. A 2D game rarely has
 * normal maps, so lighting here is the honest simplification that implies:
 * intensity falls off with distance and (for spot lights) angle, but a
 * sprite's own surface orientation plays no part, unlike 3D lighting.
 */

export interface Light2D {
  readonly kind: "point" | "spot" | "global";
  readonly position?: readonly [number, number];
  /** Distance at which intensity reaches 0. Ignored for `global`. */
  readonly radius?: number;
  /** How the fall-off curves from full intensity at the light to zero at
   * `radius`: `linear` ramps evenly, `quadratic` (the default, physically
   * closer to a real point light) falls off faster near the edge. */
  readonly falloff?: "linear" | "quadratic";
  readonly color?: readonly [number, number, number];
  readonly intensity?: number;
  /** Spot direction in radians (0 = +X) and half-angle in radians. */
  readonly direction?: number;
  readonly coneAngle?: number;
}

/** Intensity multiplier `[0, 1]` a single light contributes at `point`,
 * ignoring colour. */
export function lightAttenuation(
  light: Light2D,
  point: readonly [number, number],
): number {
  if (light.kind === "global") return 1;
  const position = light.position ?? [0, 0];
  const radius = light.radius ?? 1;
  if (!(radius > 0)) throw new Error("A 2D light radius must be positive.");
  const dx = point[0] - position[0];
  const dy = point[1] - position[1];
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) return 0;
  const linear = 1 - distance / radius;
  const falloff = light.falloff ?? "quadratic";
  const distanceFactor = falloff === "linear" ? linear : linear * linear;

  if (light.kind === "point") return distanceFactor;

  // Spot: also fall off (to zero, at the cone's edge) by angle from `direction`.
  const direction = light.direction ?? 0;
  const coneAngle = light.coneAngle ?? Math.PI / 6;
  if (distance < 1e-9) return distanceFactor; // exactly at the light: angle is undefined
  const toPoint = Math.atan2(dy, dx);
  const delta = Math.abs(angleDifference(toPoint, direction));
  if (delta >= coneAngle) return 0;
  return distanceFactor * (1 - delta / coneAngle);
}

/** This light's contribution at `point`: colour times intensity times
 * attenuation. Additive — combine several with {@link accumulateLighting2D}. */
export function lightContribution(
  light: Light2D,
  point: readonly [number, number],
): [number, number, number] {
  const attenuation = lightAttenuation(light, point);
  const intensity = (light.intensity ?? 1) * attenuation;
  const color = light.color ?? [1, 1, 1];
  return [color[0] * intensity, color[1] * intensity, color[2] * intensity];
}

/** Sums every light's contribution at one point. This is the per-pixel (or
 * per-tile, if `point` is a tile centre) operation a sprite/tile renderer
 * multiplies its texel by. */
export function accumulateLighting2D(
  lights: readonly Light2D[],
  point: readonly [number, number],
  ambient: readonly [number, number, number] = [0, 0, 0],
): [number, number, number] {
  let [r, g, b] = ambient;
  for (const light of lights) {
    const [lr, lg, lb] = lightContribution(light, point);
    r += lr;
    g += lg;
    b += lb;
  }
  return [r, g, b];
}

export interface LightGrid2D {
  readonly width: number;
  readonly height: number;
  /** `rgb` per cell, row-major: `[r0,g0,b0, r1,g1,b1, ...]`. */
  readonly colors: Float32Array;
}

/** Bakes a per-cell light-colour buffer over a `width x height` grid of
 * cells sized `cellSize` world units, with `origin` as the world position of
 * cell (0, 0)'s corner — exactly the shape a tilemap or a 2D light-map
 * texture wants to sample once per frame (or once, for static lights)
 * instead of walking the light list per sprite. */
export function accumulateLightGrid(
  lights: readonly Light2D[],
  options: {
    readonly width: number;
    readonly height: number;
    readonly cellSize?: number;
    readonly origin?: readonly [number, number];
    readonly ambient?: readonly [number, number, number];
  },
): LightGrid2D {
  const { width, height } = options;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0)
    throw new Error("A light grid needs positive integer dimensions.");
  const cellSize = options.cellSize ?? 1;
  const origin = options.origin ?? [0, 0];
  const colors = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point: [number, number] = [
        origin[0] + (x + 0.5) * cellSize,
        origin[1] + (y + 0.5) * cellSize,
      ];
      const [r, g, b] = accumulateLighting2D(lights, point, options.ambient);
      const index = (y * width + x) * 3;
      colors[index] = r;
      colors[index + 1] = g;
      colors[index + 2] = b;
    }
  }
  return { width, height, colors };
}

function angleDifference(a: number, b: number): number {
  const twoPi = Math.PI * 2;
  let delta = (a - b) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return delta;
}
