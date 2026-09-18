import { SpriteBatch2D, type SpriteAsset } from "./sprite-2d.js";
import {
  layoutText2D,
  type FontAtlas,
  type TextAlignment,
} from "../text/text-2d.js";
import type { MeshUpload } from "./host/index.js";
import type { UiDocument } from "../ui/ui.js";

export interface UiNodeVisual {
  readonly background?: SpriteAsset;
  readonly backgroundColor?: readonly [number, number, number, number];
  readonly text?: string;
  readonly font?: FontAtlas;
  readonly fontSize?: number;
  readonly textColor?: readonly [number, number, number, number];
  readonly textAlign?: TextAlignment;
  readonly textPadding?: number;
}

export interface UiRenderBatch2D {
  readonly id: string;
  readonly material: string;
  readonly mesh: MeshUpload;
  readonly elementCount: number;
}

/** Converts a laid-out UiDocument into material-batched sprite/text meshes.
 * Screen pixels become world units using pixelsPerUnit and the viewport center
 * becomes world origin, matching an orthographic overlay camera. */
export function composeUi2D(
  document: UiDocument,
  visuals: Readonly<Record<string, UiNodeVisual>>,
  viewport: readonly [number, number],
  pixelsPerUnit = 100,
  id = "ui",
): readonly UiRenderBatch2D[] {
  positive(viewport[0], "UI render viewport width");
  positive(viewport[1], "UI render viewport height");
  positive(pixelsPerUnit, "UI render pixelsPerUnit");
  const sprites = new SpriteBatch2D(`${id}:sprites`);
  const pieces: Array<{ material: string; mesh: MeshUpload; count: number }> =
    [];
  for (const node of document.nodes()) {
    if (!node.visible || node.rect.width <= 0 || node.rect.height <= 0)
      continue;
    const visual = visuals[node.id];
    if (visual === undefined) continue;
    if (visual.background !== undefined) {
      const center = pixelToWorld(
        node.rect.x + node.rect.width / 2,
        node.rect.y + node.rect.height / 2,
        viewport,
        pixelsPerUnit,
      );
      sprites.add({
        sprite: visual.background,
        position: center,
        size: [
          node.rect.width / pixelsPerUnit,
          node.rect.height / pixelsPerUnit,
        ],
        ...(visual.backgroundColor === undefined
          ? {}
          : { color: visual.backgroundColor }),
        sortingLayer: node.depth,
      });
    }
    if (visual.text !== undefined) {
      if (visual.font === undefined)
        throw new Error(
          `UI visual '${node.id}' declares text but no font atlas.`,
        );
      const padding = nonNegative(
        visual.textPadding ?? 0,
        `UI visual '${node.id}' textPadding`,
      );
      const available =
        Math.max(0, node.rect.width - padding * 2) / pixelsPerUnit;
      if (available === 0) continue;
      const layout = layoutText2D(visual.font, visual.text, {
        fontSize: (visual.fontSize ?? visual.font.designSize) / pixelsPerUnit,
        maxWidth: available,
        ...(visual.textAlign === undefined
          ? {}
          : { alignment: visual.textAlign }),
        ...(visual.textColor === undefined ? {} : { color: visual.textColor }),
      });
      const origin = pixelToWorld(
        node.rect.x + padding,
        node.rect.y + padding + (visual.fontSize ?? visual.font.designSize),
        viewport,
        pixelsPerUnit,
      );
      pieces.push({
        material: layout.material,
        mesh: translate(layout.mesh, origin[0], origin[1], node.depth * 1e-4),
        count: 1,
      });
    }
  }
  for (const batch of sprites.build())
    pieces.push({
      material: batch.material,
      mesh: batch.mesh,
      count: batch.spriteCount,
    });
  const groups = new Map<string, Array<{ mesh: MeshUpload; count: number }>>();
  for (const piece of pieces) {
    const group = groups.get(piece.material) ?? [];
    group.push(piece);
    groups.set(piece.material, group);
  }
  return Object.freeze(
    [...groups].map(([material, group], index) =>
      Object.freeze({
        id: `${id}:${index}`,
        material,
        mesh: combine(group.map((piece) => piece.mesh)),
        elementCount: group.reduce((sum, piece) => sum + piece.count, 0),
      }),
    ),
  );
}

function combine(meshes: readonly MeshUpload[]): MeshUpload {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const mesh of meshes) {
    const base = positions.length / 3;
    positions.push(...mesh.positions);
    normals.push(
      ...(mesh.normals ?? defaultNormals(mesh.positions.length / 3)),
    );
    uvs.push(
      ...(mesh.uvs ?? new Array((mesh.positions.length / 3) * 2).fill(0)),
    );
    colors.push(
      ...(mesh.colors ?? new Array((mesh.positions.length / 3) * 4).fill(1)),
    );
    for (const index of mesh.indices) indices.push(base + index);
  }
  return Object.freeze({
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  });
}

function translate(
  mesh: MeshUpload,
  x: number,
  y: number,
  z: number,
): MeshUpload {
  const positions = Float32Array.from(mesh.positions);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = positions[index]! + x;
    positions[index + 1] = positions[index + 1]! + y;
    positions[index + 2] = positions[index + 2]! + z;
  }
  return { ...mesh, positions };
}
function pixelToWorld(
  x: number,
  y: number,
  viewport: readonly [number, number],
  pixelsPerUnit: number,
): [number, number] {
  return [
    (x - viewport[0] / 2) / pixelsPerUnit,
    (viewport[1] / 2 - y) / pixelsPerUnit,
  ];
}
function defaultNormals(count: number): number[] {
  const output: number[] = [];
  for (let index = 0; index < count; index += 1) output.push(0, 0, 1);
  return output;
}
function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be finite and positive.`);
  return value;
}
function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be finite and non-negative.`);
  return value;
}
