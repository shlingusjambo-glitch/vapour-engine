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
/** Builds textured XY meshes grouped by material and sorting layer. Sprite
 * transforms and nine-slices are baked into one upload, eliminating one draw
 * call per visual while preserving deterministic transparent order. */
export declare class SpriteBatch2D {
    #private;
    constructor(id?: string);
    get count(): number;
    clear(): void;
    add(draw: SpriteDraw): void;
    build(): readonly SpriteMeshBatch[];
}
export type PixelPerfectMode = "fixed-height" | "expand" | "crop";
export interface OrthographicCamera2DOptions {
    readonly referenceResolution: readonly [number, number];
    readonly pixelsPerUnit?: number;
    readonly mode?: PixelPerfectMode;
}
/** Resolution-independent 2D camera calculations shared by runtime, editor,
 * pointer hit testing, and the eventual WebGPU orthographic camera path. */
export declare class OrthographicCamera2D {
    readonly referenceResolution: readonly [number, number];
    readonly pixelsPerUnit: number;
    readonly mode: PixelPerfectMode;
    constructor(options: OrthographicCamera2DOptions);
    bounds(viewportPixels: readonly [number, number]): {
        left: number;
        right: number;
        bottom: number;
        top: number;
        width: number;
        height: number;
        scale: number;
    };
    snap(position: readonly [number, number], viewportPixels: readonly [number, number]): [number, number];
    screenToWorld(point: readonly [number, number], viewportPixels: readonly [number, number], cameraPosition?: readonly [number, number]): [number, number];
}
//# sourceMappingURL=sprite-2d.d.ts.map