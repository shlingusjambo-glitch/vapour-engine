/** Binary resources remain encoded until a renderer/worker chooses a decoder. */
export interface ImportedGltfImage {
    readonly name: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
}
export interface ImportedGltfSampler {
    readonly magFilter: number;
    readonly minFilter: number;
    readonly wrapS: number;
    readonly wrapT: number;
}
export interface ImportedGltfTexture {
    readonly source: number;
    readonly sampler: ImportedGltfSampler;
}
export interface GltfResourceJson {
    images?: {
        name?: string;
        mimeType?: string;
        uri?: string;
        bufferView?: number;
    }[];
    textures?: {
        source?: number;
        sampler?: number;
    }[];
    samplers?: {
        magFilter?: number;
        minFilter?: number;
        wrapS?: number;
        wrapT?: number;
    }[];
    bufferViews?: {
        buffer: number;
        byteOffset?: number;
        byteLength: number;
    }[];
}
export declare function importGltfResources(json: GltfResourceJson, buffers: readonly ArrayBuffer[], name: string, resolve?: (uri: string) => Promise<ArrayBuffer>): Promise<{
    images: ImportedGltfImage[];
    textures: ImportedGltfTexture[];
}>;
//# sourceMappingURL=gltf-resources.d.ts.map