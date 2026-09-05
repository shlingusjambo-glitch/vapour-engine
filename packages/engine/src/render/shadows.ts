/** Cascaded shadow map setup.
 *
 * A single shadow map covering a whole view either has no resolution near the
 * camera or covers nothing far from it. Cascades split the view's depth range
 * into slices and give each its own map, so the near slice gets the texel
 * density it needs and the far slice still reaches the horizon.
 *
 * Vapour's split of labour puts this computation in TypeScript and the drawing
 * in Rust: the matrices are pure maths, they change every frame with the
 * camera, and getting them wrong produces the two classic artefacts — peter
 * panning and shimmering edges — that are far easier to debug against unit
 * tests than against a screenshot. The renderer receives finished matrices and
 * simply renders depth into each cascade.
 *
 * Two details here are what separate a working cascade setup from a broken one:
 *
 * - **Texel snapping.** The light's projection is quantized to whole shadow-map
 *   texels, so a camera moving smoothly does not make shadow edges crawl. This
 *   is the single most visible difference between a real implementation and a
 *   naive one.
 * - **A sphere-based bound per cascade.** Fitting the light's box to the
 *   cascade's bounding *sphere* rather than its corners keeps the shadow map's
 *   extent constant as the camera rotates, which is the other half of stopping
 *   shimmer.
 */
import {
  invert,
  lookAt,
  multiplyMat4,
  orthographic,
  transformPoint,
  type Mat4,
  type Vec3,
} from "@vapour/math";
import { viewProjectionMatrix } from "./projection.js";
import type { RenderCameraSnapshot } from "./render-world.js";

export interface ShadowCascade {
  /** Index from the camera outward; 0 is nearest. */
  readonly index: number;
  /** Depth range this cascade covers, in view-space units from the camera. */
  readonly near: number;
  readonly far: number;
  /** Light-space view-projection the depth pass renders with. */
  readonly viewProjection: Mat4;
  /** Radius of the cascade's bounding sphere, in world units. */
  readonly radius: number;
  /** World-space centre of that sphere. */
  readonly center: Vec3;
  /** World units per shadow-map texel. Useful for choosing a depth bias. */
  readonly texelWorldSize: number;
}

export interface ShadowSettings {
  /** Number of cascades. Three or four is the usual range. */
  readonly cascadeCount?: number;
  /** Shadow map resolution per cascade, in texels. */
  readonly resolution?: number;
  /**
   * Blend between a uniform and a logarithmic split.
   *
   * `0` splits the range evenly, wasting near-camera resolution. `1` is fully
   * logarithmic, which is theoretically ideal but puts almost nothing in the
   * far cascades. The default of 0.75 is the practical compromise most engines
   * settle on.
   */
  readonly splitLambda?: number;
  /** Farthest distance shadows are cast to. Defaults to the camera's far plane,
   * which is usually far too generous — shadows rarely need the whole view. */
  readonly maxDistance?: number;
  /** Pushes the light's near plane back so casters behind the cascade still
   * appear in its map. */
  readonly casterDistance?: number;
}

export const DEFAULT_SHADOW_SETTINGS: Required<
  Omit<ShadowSettings, "maxDistance">
> = {
  cascadeCount: 3,
  resolution: 2048,
  splitLambda: 0.75,
  casterDistance: 50,
};

/**
 * Distances at which the view's depth range is split.
 *
 * Returns `cascadeCount + 1` boundaries, starting at `near` and ending at
 * `far`, using the practical split scheme: a blend of a uniform split (equal
 * world distance) and a logarithmic one (equal perspective foreshortening).
 */
export function cascadeSplits(
  near: number,
  far: number,
  cascadeCount: number,
  lambda = DEFAULT_SHADOW_SETTINGS.splitLambda,
): number[] {
  if (!(near > 0 && far > near))
    throw new Error("Cascade splits require 0 < near < far.");
  if (!Number.isInteger(cascadeCount) || cascadeCount < 1)
    throw new Error("Cascade splits require at least one cascade.");
  if (!(lambda >= 0 && lambda <= 1))
    throw new Error("The cascade split lambda must lie in [0, 1].");

  const splits: number[] = [near];
  for (let index = 1; index < cascadeCount; index += 1) {
    const fraction = index / cascadeCount;
    const logarithmic = near * (far / near) ** fraction;
    const uniform = near + (far - near) * fraction;
    splits.push(logarithmic * lambda + uniform * (1 - lambda));
  }
  splits.push(far);
  return splits;
}

/** The eight world-space corners of a camera's frustum between two depths. */
export function frustumCorners(
  camera: RenderCameraSnapshot,
  aspectRatio: number,
  near: number,
  far: number,
): Vec3[] {
  if (!(aspectRatio > 0))
    throw new Error("Frustum corners require a positive aspect ratio.");
  if (!(near > 0 && far > near))
    throw new Error("Frustum corners require 0 < near < far.");
  // Unproject the clip-space cube through the inverse view-projection. Depth 0
  // is the near plane and 1 the far plane, matching WebGPU's range.
  const inverse = invert(
    viewProjectionMatrix({ ...camera, near, far }, aspectRatio),
  );
  const corners: Vec3[] = [];
  for (const z of [0, 1]) {
    for (const y of [-1, 1]) {
      for (const x of [-1, 1]) corners.push(transformPoint(inverse, [x, y, z]));
    }
  }
  return corners;
}

/**
 * The bounding sphere of a set of points.
 *
 * Cascades are fitted to a sphere rather than to the corner box because a
 * sphere is rotation invariant: the shadow map's extent then stays constant as
 * the camera turns, which is half of what stops shadow edges from shimmering.
 */
export function boundingSphere(points: readonly Vec3[]): {
  center: Vec3;
  radius: number;
} {
  if (points.length === 0)
    throw new Error("A bounding sphere requires at least one point.");
  const center: Vec3 = [0, 0, 0];
  for (const point of points) {
    center[0] += point[0];
    center[1] += point[1];
    center[2] += point[2];
  }
  center[0] /= points.length;
  center[1] /= points.length;
  center[2] /= points.length;
  let radius = 0;
  for (const point of points) {
    radius = Math.max(
      radius,
      Math.hypot(
        point[0] - center[0],
        point[1] - center[1],
        point[2] - center[2],
      ),
    );
  }
  return { center, radius };
}

/** Builds one cascade's light-space view-projection. */
export function computeCascade(
  camera: RenderCameraSnapshot,
  aspectRatio: number,
  lightDirection: readonly number[],
  near: number,
  far: number,
  index: number,
  settings: ShadowSettings = {},
): ShadowCascade {
  const resolution = settings.resolution ?? DEFAULT_SHADOW_SETTINGS.resolution;
  if (!Number.isInteger(resolution) || resolution < 1)
    throw new Error(
      "Shadow map resolution must be a positive whole number of texels.",
    );
  const casterDistance =
    settings.casterDistance ?? DEFAULT_SHADOW_SETTINGS.casterDistance;
  if (!(casterDistance >= 0))
    throw new Error("The shadow caster distance must not be negative.");

  const length = Math.hypot(
    lightDirection[0] ?? 0,
    lightDirection[1] ?? 0,
    lightDirection[2] ?? 0,
  );
  if (length < 1e-6)
    throw new Error("A shadow-casting light needs a non-zero direction.");
  const direction: Vec3 = [
    (lightDirection[0] ?? 0) / length,
    (lightDirection[1] ?? 0) / length,
    (lightDirection[2] ?? 0) / length,
  ];

  const { center, radius } = boundingSphere(
    frustumCorners(camera, aspectRatio, near, far),
  );
  const diameter = radius * 2;
  const texelWorldSize = diameter / resolution;

  // Build the light basis from a *fixed* origin, not from the cascade centre.
  // This is the subtlety that makes snapping work at all: a light space built
  // around the moving centre puts that centre at its own origin every frame, so
  // there is no stable grid to snap against and the snap is a no-op.
  const lightBasis = lookAt([0, 0, 0], direction, pickUpVector(direction));
  const centerInLight = transformPoint(lightBasis, center);

  // Quantize the light-space origin to whole shadow-map texels. The cascade
  // centre then wobbles by at most half a texel inside a grid that does not
  // move, instead of the whole map sliding sub-texel every frame — which is
  // what makes shadow edges crawl.
  const snappedX =
    Math.round(centerInLight[0] / texelWorldSize) * texelWorldSize;
  const snappedY =
    Math.round(centerInLight[1] / texelWorldSize) * texelWorldSize;

  // Pull the light's eye back past the sphere so geometry between the light and
  // the cascade still casts into it.
  const view = lightBasis.slice();
  view[12] = -snappedX;
  view[13] = -snappedY;
  view[14] = -(centerInLight[2] + radius + casterDistance);

  const projection = orthographic(diameter, 1, 0.01, diameter + casterDistance);

  return {
    index,
    near,
    far,
    viewProjection: multiplyMat4(projection, view),
    radius,
    center,
    texelWorldSize,
  };
}

/**
 * Builds the full cascade set for a camera and a directional light.
 *
 * The returned cascades are ordered near to far, which is the order a shader
 * selects them in: the first cascade whose `far` exceeds the fragment's view
 * depth is the one to sample.
 */
export function computeCascades(
  camera: RenderCameraSnapshot,
  aspectRatio: number,
  lightDirection: readonly number[],
  settings: ShadowSettings = {},
): readonly ShadowCascade[] {
  const count = settings.cascadeCount ?? DEFAULT_SHADOW_SETTINGS.cascadeCount;
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new Error("Vapour supports one to four shadow cascades.");
  }
  const near = camera.near;
  const far = Math.min(camera.far, settings.maxDistance ?? camera.far);
  if (!(far > near))
    throw new Error(
      "The shadow max distance must be greater than the camera's near plane.",
    );

  const splits = cascadeSplits(
    near,
    far,
    count,
    settings.splitLambda ?? DEFAULT_SHADOW_SETTINGS.splitLambda,
  );
  const cascades: ShadowCascade[] = [];
  for (let index = 0; index < count; index += 1) {
    cascades.push(
      computeCascade(
        camera,
        aspectRatio,
        lightDirection,
        splits[index]!,
        splits[index + 1]!,
        index,
        settings,
      ),
    );
  }
  return cascades;
}

/**
 * A depth bias scaled to a cascade's texel size.
 *
 * A constant bias is wrong for cascades: the far cascade's texels cover far
 * more world space, so the bias that stops acne there causes visible peter
 * panning near the camera. Scaling with texel size gives one authored number
 * that behaves correctly at every cascade.
 */
export function cascadeDepthBias(
  cascade: ShadowCascade,
  biasTexels = 1.5,
): number {
  if (!(biasTexels >= 0))
    throw new Error("A shadow depth bias must not be negative.");
  return cascade.texelWorldSize * biasTexels;
}

/** Packs cascade split distances for upload, padded to the shader's fixed array. */
export function packCascadeSplits(
  cascades: readonly ShadowCascade[],
  maxCascades = 4,
): Float32Array {
  const packed = new Float32Array(maxCascades);
  for (let index = 0; index < maxCascades; index += 1) {
    // Beyond the last real cascade, an infinite split makes the shader's
    // "first cascade whose far exceeds this depth" search terminate correctly.
    packed[index] =
      index < cascades.length ? cascades[index]!.far : Number.POSITIVE_INFINITY;
  }
  return packed;
}

/** Packs cascade matrices contiguously for a single uniform upload. */
export function packCascadeMatrices(
  cascades: readonly ShadowCascade[],
  maxCascades = 4,
): Float32Array {
  const packed = new Float32Array(maxCascades * 16);
  for (
    let index = 0;
    index < Math.min(cascades.length, maxCascades);
    index += 1
  ) {
    packed.set(cascades[index]!.viewProjection, index * 16);
  }
  return packed;
}

/** The cascade a view-space depth falls into, matching the shader's selection. */
export function selectCascade(
  cascades: readonly ShadowCascade[],
  viewDepth: number,
): number | undefined {
  for (const cascade of cascades) {
    if (viewDepth <= cascade.far) return cascade.index;
  }
  return undefined;
}

/** An up vector that is not parallel to the light, so `lookAt` stays defined. */
function pickUpVector(direction: Vec3): Vec3 {
  return Math.abs(direction[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
}
