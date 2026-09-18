import { type ImportedGltfImage, type ImportedGltfTexture } from "./gltf-resources.js";
export type { ImportedGltfImage, ImportedGltfTexture, ImportedGltfSampler } from "./gltf-resources.js";
import type { MeshUpload } from "../render/host/index.js";
export interface GltfImportOptions {
    readonly sourceName?: string;
    readonly resolveUri?: (uri: string) => Promise<ArrayBuffer>;
}
export interface ImportedGltfPrimitive {
    readonly id: string;
    readonly mesh: MeshUpload;
    readonly material?: number;
}
export interface ImportedGltfMaterial {
    readonly name: string;
    readonly baseColor: readonly [number, number, number, number];
    readonly metallic: number;
    readonly roughness: number;
    readonly baseColorTexture?: number;
    readonly normalTexture?: number;
    readonly normalScale: number;
    readonly metallicRoughnessTexture?: number;
    readonly occlusionTexture?: number;
    readonly occlusionStrength: number;
    readonly emissiveTexture?: number;
    readonly emissive: readonly [number, number, number];
    readonly alphaMode: "OPAQUE" | "MASK" | "BLEND";
    readonly alphaCutoff: number;
    readonly doubleSided: boolean;
}
export interface ImportedGltfNode {
    readonly name: string;
    readonly mesh?: number;
    readonly children: readonly number[];
    readonly translation: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly scale: readonly [number, number, number];
    readonly matrix?: readonly number[];
}
export interface ImportedGltf {
    readonly images: readonly ImportedGltfImage[];
    readonly textures: readonly ImportedGltfTexture[];
    readonly warnings: readonly string[];
    readonly primitives: readonly ImportedGltfPrimitive[];
    readonly meshPrimitives: readonly (readonly number[])[];
    readonly materials: readonly ImportedGltfMaterial[];
    readonly nodes: readonly ImportedGltfNode[];
    readonly scenes: readonly (readonly number[])[];
    readonly defaultScene: number;
}
/** Imports glTF 2.0 JSON or GLB into renderer-ready typed arrays. External
 * resources go through an injected resolver, so the same importer works in the
 * browser editor, CLI, workers, and tests without hidden filesystem access. */
export declare function importGltf(source: string | ArrayBuffer | Uint8Array, options?: GltfImportOptions): Promise<ImportedGltf>;
//# sourceMappingURL=gltf-import.d.ts.map