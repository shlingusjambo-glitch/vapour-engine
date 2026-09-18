import { type SpriteAsset } from "./sprite-2d.js";
import { type FontAtlas, type TextAlignment } from "../text/text-2d.js";
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
export declare function composeUi2D(document: UiDocument, visuals: Readonly<Record<string, UiNodeVisual>>, viewport: readonly [number, number], pixelsPerUnit?: number, id?: string): readonly UiRenderBatch2D[];
//# sourceMappingURL=ui-renderer-2d.d.ts.map