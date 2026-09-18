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
  images?: { name?: string; mimeType?: string; uri?: string; bufferView?: number }[];
  textures?: { source?: number; sampler?: number }[];
  samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
}
export async function importGltfResources(json: GltfResourceJson, buffers: readonly ArrayBuffer[], name: string, resolve?: (uri: string) => Promise<ArrayBuffer>): Promise<{ images: ImportedGltfImage[]; textures: ImportedGltfTexture[] }> {
  const images = await Promise.all((json.images ?? []).map(async (image, index): Promise<ImportedGltfImage> => {
    const label = `${name} image ${index}`;
    let bytes: Uint8Array;
    if (image.uri !== undefined && image.bufferView !== undefined) throw new Error(`${label} has both URI and bufferView.`);
    if (image.uri !== undefined) {
      if (image.uri.startsWith('data:')) {
        const match = /^data:([^;,]+);base64,(.*)$/s.exec(image.uri);
        if (!match) throw new Error(`${label} requires a base64 image data URI.`);
        try { bytes = Uint8Array.from(atob(match[2]!), x => x.charCodeAt(0)); }
        catch (cause) { throw new Error(`${label} contains invalid base64.`, { cause }); }
      } else {
        if (!resolve) throw new Error(`${label} needs external image '${image.uri}'; supply resolveUri.`);
        try { bytes = new Uint8Array(await resolve(image.uri)); }
        catch (cause) { throw new Error(`${label} failed to load '${image.uri}'.`, { cause }); }
      }
    } else if (image.bufferView !== undefined) {
      const view = json.bufferViews?.[image.bufferView];
      const buffer = view && buffers[view.buffer];
      const start = view?.byteOffset ?? 0;
      if (!view || !buffer || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(view.byteLength) || view.byteLength < 1 || start + view.byteLength > buffer.byteLength) throw new Error(`${label} bufferView is missing or exceeds its buffer.`);
      bytes = new Uint8Array(buffer.slice(start, start + view.byteLength));
    } else throw new Error(`${label} needs a URI or bufferView.`);
    const mimeType = image.mimeType ?? (/^data:([^;,]+)/.exec(image.uri ?? '')?.[1]) ?? sniffImage(bytes);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error(`${label} has unsupported image type '${mimeType}'. Export PNG/JPEG or provide WebP-capable decoding.`);
    if (bytes.length === 0) throw new Error(`${label} is empty.`);
    return { name: image.name ?? `image-${index}`, mimeType, bytes };
  }));
  const textures = (json.textures ?? []).map((texture, index): ImportedGltfTexture => {
    if (!Number.isSafeInteger(texture.source) || texture.source! < 0 || texture.source! >= images.length) throw new Error(`${name} texture ${index} references missing image ${texture.source}.`);
    if (texture.sampler !== undefined && (!Number.isSafeInteger(texture.sampler) || !json.samplers?.[texture.sampler])) throw new Error(`${name} texture ${index} references missing sampler.`);
    const sampler = texture.sampler === undefined ? {} : json.samplers![texture.sampler]!;
    const parsed = { magFilter: sampler.magFilter ?? 9729, minFilter: sampler.minFilter ?? 9987, wrapS: sampler.wrapS ?? 10497, wrapT: sampler.wrapT ?? 10497 };
    if (![9728,9729].includes(parsed.magFilter) || ![9728,9729,9984,9985,9986,9987].includes(parsed.minFilter) || ![33071,33648,10497].includes(parsed.wrapS) || ![33071,33648,10497].includes(parsed.wrapT)) throw new Error(`${name} texture ${index} has an invalid sampler.`);
    return { source: texture.source!, sampler: parsed };
  });
  return { images, textures };
}
function sniffImage(bytes: Uint8Array): string {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216) return 'image/jpeg';
  if (new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return 'unknown';
}
