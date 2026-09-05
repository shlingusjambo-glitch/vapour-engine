import type { MeshUpload } from "./host/index.js";

export interface SpriteAsset {
  readonly id: string;
  readonly material: string;
  readonly textureSize: readonly [number, number];
  /** Source rectangle in pixels: x, y, width, height; texture origin is top-left. */
  readonly rect: readonly [number, number, number, number];
  readonly pixelsPerUnit?: number;
  /** Normalized origin measured from bottom-left. */
  readonly pivot?: readonly [number, number];
  /** Left, top, right, bottom border pixels for nine-slicing. */
  readonly border?: readonly [number, number, number, number];
}

export interface SpriteDraw {
  readonly sprite: SpriteAsset;
  readonly position: readonly [number, number];
  readonly size?: readonly [number, number];
  readonly rotation?: number;
  readonly color?: readonly [number, number, number, number];
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly sortingLayer?: number;
  readonly order?: number;
}

export interface SpriteMeshBatch {
  readonly id: string;
  readonly material: string;
  readonly sortingLayer: number;
  readonly mesh: MeshUpload;
  readonly spriteCount: number;
}

interface ValidatedDraw extends SpriteDraw {
  readonly insertion: number;
  readonly sortingLayer: number;
  readonly order: number;
}

/** Builds textured XY meshes grouped by material and sorting layer. Sprite
 * transforms and nine-slices are baked into one upload, eliminating one draw
 * call per visual while preserving deterministic transparent order. */
export class SpriteBatch2D {
  readonly #draws: ValidatedDraw[] = [];
  readonly #id: string;

  constructor(id = "sprites") {
    if (!id.trim()) throw new Error("Sprite batch ID must not be empty.");
    this.#id = id;
  }

  get count(): number {
    return this.#draws.length;
  }
  clear(): void {
    this.#draws.length = 0;
  }

  add(draw: SpriteDraw): void {
    validateDraw(draw);
    this.#draws.push({
      ...draw,
      insertion: this.#draws.length,
      sortingLayer: integer(draw.sortingLayer ?? 0, "Sprite sortingLayer"),
      order: integer(draw.order ?? 0, "Sprite order"),
    });
  }

  build(): readonly SpriteMeshBatch[] {
    const sorted = [...this.#draws].sort(
      (a, b) =>
        a.sortingLayer - b.sortingLayer ||
        a.order - b.order ||
        a.insertion - b.insertion,
    );
    const groups = new Map<
      string,
      { material: string; sortingLayer: number; draws: ValidatedDraw[] }
    >();
    for (const draw of sorted) {
      const key = `${draw.sortingLayer}\0${draw.sprite.material}`;
      const group = groups.get(key) ?? {
        material: draw.sprite.material,
        sortingLayer: draw.sortingLayer,
        draws: [],
      };
      group.draws.push(draw);
      groups.set(key, group);
    }
    return Object.freeze(
      [...groups.values()].map((group, index) =>
        buildGroup(`${this.#id}:${index}`, group),
      ),
    );
  }
}

export type PixelPerfectMode = "fixed-height" | "expand" | "crop";

export interface OrthographicCamera2DOptions {
  readonly referenceResolution: readonly [number, number];
  readonly pixelsPerUnit?: number;
  readonly mode?: PixelPerfectMode;
}

/** Resolution-independent 2D camera calculations shared by runtime, editor,
 * pointer hit testing, and the eventual WebGPU orthographic camera path. */
export class OrthographicCamera2D {
  readonly referenceResolution: readonly [number, number];
  readonly pixelsPerUnit: number;
  readonly mode: PixelPerfectMode;

  constructor(options: OrthographicCamera2DOptions) {
    this.referenceResolution = positivePair(
      options.referenceResolution,
      "2D camera reference resolution",
    );
    this.pixelsPerUnit = positive(
      options.pixelsPerUnit ?? 100,
      "2D camera pixelsPerUnit",
    );
    this.mode = options.mode ?? "fixed-height";
  }

  bounds(viewportPixels: readonly [number, number]): {
    left: number;
    right: number;
    bottom: number;
    top: number;
    width: number;
    height: number;
    scale: number;
  } {
    const viewport = positivePair(viewportPixels, "2D camera viewport");
    const referenceAspect =
      this.referenceResolution[0] / this.referenceResolution[1];
    const viewportAspect = viewport[0] / viewport[1];
    let widthPixels = this.referenceResolution[0];
    let heightPixels = this.referenceResolution[1];
    if (this.mode === "fixed-height")
      widthPixels = heightPixels * viewportAspect;
    else if (this.mode === "expand") {
      if (viewportAspect > referenceAspect)
        widthPixels = heightPixels * viewportAspect;
      else heightPixels = widthPixels / viewportAspect;
    } else if (viewportAspect > referenceAspect)
      heightPixels = widthPixels / viewportAspect;
    else widthPixels = heightPixels * viewportAspect;
    const width = widthPixels / this.pixelsPerUnit;
    const height = heightPixels / this.pixelsPerUnit;
    return {
      left: -width / 2,
      right: width / 2,
      bottom: -height / 2,
      top: height / 2,
      width,
      height,
      scale: viewport[1] / heightPixels,
    };
  }

  snap(
    position: readonly [number, number],
    viewportPixels: readonly [number, number],
  ): [number, number] {
    const scale = this.bounds(viewportPixels).scale;
    const unitsPerPhysicalPixel = 1 / (this.pixelsPerUnit * scale);
    return [
      Math.round(position[0] / unitsPerPhysicalPixel) * unitsPerPhysicalPixel,
      Math.round(position[1] / unitsPerPhysicalPixel) * unitsPerPhysicalPixel,
    ];
  }

  screenToWorld(
    point: readonly [number, number],
    viewportPixels: readonly [number, number],
    cameraPosition: readonly [number, number] = [0, 0],
  ): [number, number] {
    const viewport = positivePair(viewportPixels, "2D camera viewport");
    const bounds = this.bounds(viewport);
    return [
      cameraPosition[0] + bounds.left + (point[0] / viewport[0]) * bounds.width,
      cameraPosition[1] + bounds.top - (point[1] / viewport[1]) * bounds.height,
    ];
  }
}

function buildGroup(
  id: string,
  group: { material: string; sortingLayer: number; draws: ValidatedDraw[] },
): SpriteMeshBatch {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const draw of group.draws)
    appendSprite(draw, positions, normals, uvs, colors, indices);
  return Object.freeze({
    id,
    material: group.material,
    sortingLayer: group.sortingLayer,
    spriteCount: group.draws.length,
    mesh: Object.freeze({
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices),
    }),
  });
}

function appendSprite(
  draw: ValidatedDraw,
  positions: number[],
  normals: number[],
  uvs: number[],
  colors: number[],
  indices: number[],
): void {
  const asset = draw.sprite;
  const ppu = asset.pixelsPerUnit ?? 100;
  const size: readonly [number, number] = draw.size ?? [
    asset.rect[2] / ppu,
    asset.rect[3] / ppu,
  ];
  const pivot = asset.pivot ?? [0.5, 0.5];
  const border = asset.border ?? [0, 0, 0, 0];
  const xCuts = cuts(size[0], pivot[0], border[0] / ppu, border[2] / ppu);
  const yCuts = cuts(size[1], pivot[1], border[3] / ppu, border[1] / ppu);
  const [tx, ty, tw, th] = asset.rect;
  const uCuts = [
    tx / asset.textureSize[0],
    (tx + border[0]) / asset.textureSize[0],
    (tx + tw - border[2]) / asset.textureSize[0],
    (tx + tw) / asset.textureSize[0],
  ];
  const vCuts = [
    1 - (ty + th) / asset.textureSize[1],
    1 - (ty + th - border[3]) / asset.textureSize[1],
    1 - (ty + border[1]) / asset.textureSize[1],
    1 - ty / asset.textureSize[1],
  ];
  if (draw.flipX) uCuts.reverse();
  if (draw.flipY) vCuts.reverse();
  const color = draw.color ?? [1, 1, 1, 1];
  const cosine = Math.cos(draw.rotation ?? 0);
  const sine = Math.sin(draw.rotation ?? 0);
  const sortKey = draw.sortingLayer * 1_000_000 + draw.order;
  // Orthographic cameras look down -Z, so larger sorting keys move toward the
  // camera. This lets an opaque parent/background write depth without hiding
  // its higher-layer children.
  const z = sortKey === 0 ? 0 : sortKey * 1e-7;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      if (xCuts[column] === xCuts[column + 1] || yCuts[row] === yCuts[row + 1])
        continue;
      const base = positions.length / 3;
      const vertices: Array<readonly [number, number, number, number]> = [
        [xCuts[column]!, yCuts[row]!, uCuts[column]!, vCuts[row]!],
        [xCuts[column + 1]!, yCuts[row]!, uCuts[column + 1]!, vCuts[row]!],
        [
          xCuts[column + 1]!,
          yCuts[row + 1]!,
          uCuts[column + 1]!,
          vCuts[row + 1]!,
        ],
        [xCuts[column]!, yCuts[row + 1]!, uCuts[column]!, vCuts[row + 1]!],
      ];
      for (const [x, y, u, v] of vertices) {
        positions.push(
          draw.position[0] + x * cosine - y * sine,
          draw.position[1] + x * sine + y * cosine,
          z,
        );
        normals.push(0, 0, 1);
        uvs.push(u, v);
        colors.push(...color);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

function cuts(
  size: number,
  pivot: number,
  startBorder: number,
  endBorder: number,
): [number, number, number, number] {
  const minimum = -size * pivot;
  const scale =
    startBorder + endBorder > size && startBorder + endBorder > 0
      ? size / (startBorder + endBorder)
      : 1;
  return [
    minimum,
    minimum + startBorder * scale,
    minimum + size - endBorder * scale,
    minimum + size,
  ];
}

function validateDraw(draw: SpriteDraw): void {
  const asset = draw.sprite;
  if (!asset.id.trim() || !asset.material.trim())
    throw new Error("Sprite asset ID and material must not be empty.");
  const texture = positivePair(
    asset.textureSize,
    `Sprite '${asset.id}' textureSize`,
  );
  const rect = asset.rect;
  if (
    rect.length !== 4 ||
    rect.some((value) => !Number.isFinite(value)) ||
    rect[0] < 0 ||
    rect[1] < 0 ||
    rect[2] <= 0 ||
    rect[3] <= 0 ||
    rect[0] + rect[2] > texture[0] ||
    rect[1] + rect[3] > texture[1]
  ) {
    throw new Error(
      `Sprite '${asset.id}' rect must be positive and contained within its texture.`,
    );
  }
  positive(asset.pixelsPerUnit ?? 100, `Sprite '${asset.id}' pixelsPerUnit`);
  const pivot = asset.pivot ?? [0.5, 0.5];
  if (pivot.some((value) => !Number.isFinite(value) || value < 0 || value > 1))
    throw new Error(`Sprite '${asset.id}' pivot values must be within 0..1.`);
  const border = asset.border ?? [0, 0, 0, 0];
  if (
    border.some((value) => !Number.isFinite(value) || value < 0) ||
    border[0] + border[2] > rect[2] ||
    border[1] + border[3] > rect[3]
  )
    throw new Error(
      `Sprite '${asset.id}' borders must be non-negative and fit inside its rect.`,
    );
  finitePair(draw.position, "Sprite position");
  if (draw.size) positivePair(draw.size, "Sprite size");
  if (draw.rotation !== undefined && !Number.isFinite(draw.rotation))
    throw new Error("Sprite rotation must be finite.");
  if (
    draw.color &&
    (draw.color.length !== 4 ||
      draw.color.some((value) => !Number.isFinite(value)))
  )
    throw new Error("Sprite color must contain four finite values.");
}

function finitePair(
  value: readonly number[],
  label: string,
): readonly [number, number] {
  if (value.length !== 2 || value.some((item) => !Number.isFinite(item)))
    throw new Error(`${label} must contain two finite values.`);
  return value as readonly [number, number];
}
function positivePair(
  value: readonly number[],
  label: string,
): readonly [number, number] {
  finitePair(value, label);
  if (value[0]! <= 0 || value[1]! <= 0)
    throw new Error(`${label} values must be positive.`);
  return value as readonly [number, number];
}
function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be finite and positive.`);
  return value;
}
function integer(value: number, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  return value;
}
