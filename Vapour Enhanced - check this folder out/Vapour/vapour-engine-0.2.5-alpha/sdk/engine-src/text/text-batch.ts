/** Text batching, cached layout, and world/screen placement.
 *
 * `layoutText2D` builds one mesh per string. A HUD has dozens of strings and a
 * dialogue scene has more, and each as its own draw call is what makes text
 * the surprising line at the top of a frame profile. Every label sharing an
 * atlas can be one draw: the glyph quads are already in the same texture and
 * the same material, so all that is needed is to offset each label's vertices
 * to its position and concatenate.
 *
 * Caching sits in front of layout for the same reason: an unchanged label
 * costs a map lookup, not a mesh build. The cache reports hits and misses into
 * the engine's counter registry so the diagnostics overlay can show whether
 * text is actually being reused.
 *
 * Screen and world placement differ only in the transform applied to the
 * batched mesh — a screen batch is in pixels, a world batch is in
 * metres on a plane — so they share one batch type and differ in one matrix.
 */
import { compose, multiplyMat4, transformPoint, type Mat4, type Quat, type Vec3Like } from "@vapour/math";
import type { Diagnostics } from "../diagnostics/counters.js";
import type { MeshUpload } from "../render/host/index.js";
import { TextLayoutCache } from "./rich-text.js";
import { layoutText2D, type FontAtlas, type TextLayoutOptions, type TextLayoutResult } from "./text-2d.js";

export const TEXT_COUNTERS = {
  cacheHits: "text.cacheHits",
  cacheMisses: "text.cacheMisses",
  cacheEntries: "text.cacheEntries",
  batches: "text.batches",
  batchedGlyphs: "text.batchedGlyphs",
} as const;

/** A laid-out label and where it sits in its batch's space. */
export interface TextBatchItem {
  readonly layout: TextLayoutResult;
  /** Offset of the label origin in batch space (pixels for screen, metres for world). */
  readonly position: readonly [number, number];
  /** Uniform scale applied to the label's mesh; world batches use `1 / pixelsPerUnit`. */
  readonly scale?: number;
}

/** One draw call's worth of text. */
export interface TextBatch {
  readonly material: string;
  readonly mesh: MeshUpload;
  readonly labelCount: number;
  readonly glyphCount: number;
}

/**
 * Lays out text through a cache, keyed on everything that changes the result.
 *
 * `bytes` is the glyph vertex data size, so the cache's byte total in the
 * overlay is an honest number rather than a count of entries.
 */
export class CachedTextLayout {
  readonly #cache: TextLayoutCache<TextLayoutResult>;
  readonly #diagnostics: Diagnostics | undefined;

  constructor(options: { readonly maxEntries?: number; readonly diagnostics?: Diagnostics } = {}) {
    this.#cache = new TextLayoutCache(options.maxEntries ?? 256);
    this.#diagnostics = options.diagnostics;
  }

  layout(font: FontAtlas, text: string, options: TextLayoutOptions): TextLayoutResult {
    const key = TextLayoutCache.key(text, { font: font.id, ...options });
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      this.#diagnostics?.add(TEXT_COUNTERS.cacheHits, 1);
      return cached;
    }
    const result = layoutText2D(font, text, options);
    this.#cache.set(key, result, result.mesh.positions.byteLength + (result.mesh.uvs?.byteLength ?? 0) + (result.mesh.colors?.byteLength ?? 0));
    this.#diagnostics?.add(TEXT_COUNTERS.cacheMisses, 1);
    this.#diagnostics?.set(TEXT_COUNTERS.cacheEntries, this.#cache.stats().entries);
    return result;
  }

  stats(): ReturnType<TextLayoutCache<TextLayoutResult>["stats"]> {
    return this.#cache.stats();
  }

  clear(): void {
    this.#cache.clear();
    this.#diagnostics?.set(TEXT_COUNTERS.cacheEntries, 0);
  }
}

/**
 * Merges labels that share a material into one mesh per material.
 *
 * Labels are grouped by material rather than by font id because two fonts
 * packed into one atlas can and should share a draw. Draw order within a batch
 * is input order, which is what a caller laying out a HUD top-to-bottom wants.
 */
export function batchText(items: readonly TextBatchItem[], diagnostics?: Diagnostics): readonly TextBatch[] {
  const groups = new Map<string, TextBatchItem[]>();
  for (const item of items) {
    const group = groups.get(item.layout.material);
    if (group) group.push(item);
    else groups.set(item.layout.material, [item]);
  }
  const batches: TextBatch[] = [];
  let glyphTotal = 0;
  for (const [material, group] of groups) {
    let vertexCount = 0;
    let indexCount = 0;
    for (const item of group) {
      vertexCount += item.layout.mesh.positions.length / 3;
      indexCount += item.layout.mesh.indices.length;
    }
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 4);
    const indices = new Uint32Array(indexCount);
    let vertexOffset = 0;
    let indexOffset = 0;
    let glyphCount = 0;
    for (const item of group) {
      const mesh = item.layout.mesh;
      const count = mesh.positions.length / 3;
      const scale = item.scale ?? 1;
      for (let vertex = 0; vertex < count; vertex += 1) {
        const source = vertex * 3;
        const target = (vertexOffset + vertex) * 3;
        positions[target] = mesh.positions[source]! * scale + item.position[0];
        positions[target + 1] = mesh.positions[source + 1]! * scale + item.position[1];
        positions[target + 2] = mesh.positions[source + 2]! * scale;
      }
      if (mesh.normals) normals.set(mesh.normals, vertexOffset * 3);
      else for (let vertex = 0; vertex < count; vertex += 1) normals[(vertexOffset + vertex) * 3 + 2] = 1;
      if (mesh.uvs) uvs.set(mesh.uvs, vertexOffset * 2);
      if (mesh.colors) colors.set(mesh.colors, vertexOffset * 4);
      else colors.fill(1, vertexOffset * 4, (vertexOffset + count) * 4);
      for (let index = 0; index < mesh.indices.length; index += 1) indices[indexOffset + index] = mesh.indices[index]! + vertexOffset;
      vertexOffset += count;
      indexOffset += mesh.indices.length;
      glyphCount += item.layout.glyphCount;
    }
    glyphTotal += glyphCount;
    batches.push({ material, mesh: { positions, normals, uvs, colors, indices }, labelCount: group.length, glyphCount });
  }
  diagnostics?.set(TEXT_COUNTERS.batches, batches.length);
  diagnostics?.set(TEXT_COUNTERS.batchedGlyphs, glyphTotal);
  return batches;
}

/**
 * The transform placing a screen-space text batch.
 *
 * Batches are authored in layout pixels (baseline at 0, +Y up), the same
 * space as every other 2D mesh, so this matrix only has to translate by the
 * label's screen offset; scale stays 1 pixel per unit.
 */
export function screenTextTransform(x: number, y: number): Mat4 {
  return compose([x, y, 0], [0, 0, 0, 1], [1, 1, 1]);
}

/**
 * The transform placing a world-space text batch on a plane.
 *
 * Text layout is in design pixels with the baseline at y = 0 and +Y up (lines
 * descend to negative Y); a world label needs metres, so the scale is
 * `1 / pixelsPerUnit`. The batch itself stays in pixels — the same cached
 * layout serves a HUD and a sign.
 */
export function worldTextTransform(position: Vec3Like, rotation: Quat, pixelsPerUnit: number): Mat4 {
  if (!(pixelsPerUnit > 0)) throw new Error("World text pixelsPerUnit must be positive.");
  const unit = 1 / pixelsPerUnit;
  return compose(position, rotation, [unit, unit, unit]);
}

/** A batched text mesh's corners in world space, for culling or debug draw. */
export function textBatchBounds(batch: TextBatch, transform: Mat4): { readonly min: [number, number, number]; readonly max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const positions = batch.mesh.positions;
  for (let index = 0; index < positions.length; index += 3) {
    const point = transformPoint(transform, [positions[index]!, positions[index + 1]!, positions[index + 2]!]);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, point[axis]!);
      max[axis] = Math.max(max[axis]!, point[axis]!);
    }
  }
  return { min, max };
}

/** Attaches a text batch to a parent transform (a name tag over a head, a dial on a dash). */
export function attachedTextTransform(parentWorld: Mat4, local: Mat4): Mat4 {
  return multiplyMat4(parentWorld, local);
}
