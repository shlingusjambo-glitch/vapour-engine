import { type Mat4 } from '@vapour/math';
import type { DrawOptions, FrameBuilder } from '../core/frame-builder.js';
import type { RenderHost, TextureUpload } from '../render/host/index.js';
import type { ImportedGltf, ImportedGltfImage } from './gltf-import.js';
export type GltfUploadHost = Pick<RenderHost, 'uploadMesh' | 'releaseMesh' | 'uploadTexture' | 'releaseTexture' | 'defineMaterial' | 'releaseMaterial'>;
export type GltfImageDecoder = (image: ImportedGltfImage) => Promise<Pick<TextureUpload, 'width' | 'height' | 'pixels'>>;
export interface GltfDraw {
    readonly node: number;
    readonly name: string;
    readonly mesh: string;
    readonly matrix: Mat4;
    readonly options: DrawOptions;
}
export interface GltfUploadOptions {
    /** Unique asset namespace; instances share one upload, not one upload per draw. */
    readonly id: string;
    readonly decodeImage?: GltfImageDecoder;
    readonly signal?: AbortSignal;
    readonly maxTextureSize?: number;
}
/** Owns the complete uploaded dependency graph, with rollback on failed import.
 * A material owns its texture bindings; disposal always releases it first. */
export declare class GltfAsset {
    #private;
    readonly host: GltfUploadHost;
    readonly model: ImportedGltf;
    readonly meshIds: readonly string[];
    readonly materialIds: readonly string[];
    readonly textureIds: readonly string[];
    readonly draws: readonly GltfDraw[];
    readonly warnings: readonly string[];
    readonly estimatedGpuBytes: number;
    readonly triangleCount: number;
    constructor(host: GltfUploadHost, model: ImportedGltf, meshIds: readonly string[], materialIds: readonly string[], textureIds: readonly string[], draws: readonly GltfDraw[], bytes: number, warnings: readonly string[]);
    /** Resolve immutable instance draws once for stationary streamed cells. */
    instantiate(root?: readonly number[]): readonly GltfDraw[];
    /** Animated node overrides are local transforms, so children follow pivots. */
    draw(frame: FrameBuilder, root: readonly number[], overrides?: ReadonlyMap<number, readonly number[]>, tint?: readonly [number, number, number, number]): void;
    dispose(): void;
}
export declare function gltfWorldMatrices(model: ImportedGltf, overrides?: ReadonlyMap<number, readonly number[]>): Mat4[];
export declare function uploadGltfAsset(host: GltfUploadHost, model: ImportedGltf, options: GltfUploadOptions): Promise<GltfAsset>;
/** Browser decoder preserves glTF's upper-left UV image convention and keeps
 * alpha unpremultiplied. Workers may inject their own decoder instead. */
export declare function decodeGltfImage(image: ImportedGltfImage): Promise<Pick<TextureUpload, 'width' | 'height' | 'pixels'>>;
//# sourceMappingURL=gltf-runtime.d.ts.map