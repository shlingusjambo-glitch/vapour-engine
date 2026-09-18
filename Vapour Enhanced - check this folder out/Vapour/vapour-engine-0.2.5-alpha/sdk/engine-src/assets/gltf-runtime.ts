import { compose, identity, multiplyMat4, type Mat4 } from '@vapour/math';
import type { DrawOptions, FrameBuilder } from '../core/frame-builder.js';
import type { RenderHost, TextureUpload } from '../render/host/index.js';
import type { ImportedGltf, ImportedGltfImage } from './gltf-import.js';

export type GltfUploadHost = Pick<RenderHost, 'uploadMesh'|'releaseMesh'|'uploadTexture'|'releaseTexture'|'defineMaterial'|'releaseMaterial'>;
export type GltfImageDecoder = (image: ImportedGltfImage) => Promise<Pick<TextureUpload, 'width'|'height'|'pixels'>>;
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
export class GltfAsset {
  readonly draws: readonly GltfDraw[];
  readonly warnings: readonly string[];
  readonly estimatedGpuBytes: number;
  readonly triangleCount: number;
  #disposed = false;
  constructor(readonly host: GltfUploadHost, readonly model: ImportedGltf, readonly meshIds: readonly string[], readonly materialIds: readonly string[], readonly textureIds: readonly string[], draws: readonly GltfDraw[], bytes: number, warnings: readonly string[]) {
    this.draws = draws; this.estimatedGpuBytes = bytes; this.warnings = warnings;
    this.triangleCount = draws.reduce((sum, draw) => sum + model.primitives[meshIds.indexOf(draw.mesh)]!.mesh.indices.length / 3, 0);
  }
  /** Resolve immutable instance draws once for stationary streamed cells. */
  instantiate(root: readonly number[] = identity()): readonly GltfDraw[] {
    if (this.#disposed) throw new Error('Cannot instantiate a released glTF asset.');
    return this.draws.map(draw => ({ ...draw, matrix: multiplyMat4(root, draw.matrix) }));
  }
  /** Animated node overrides are local transforms, so children follow pivots. */
  draw(frame: FrameBuilder, root: readonly number[], overrides?: ReadonlyMap<number, readonly number[]>, tint?: readonly [number,number,number,number]): void {
    if (this.#disposed) throw new Error('Cannot draw a released glTF asset.');
    const matrices = overrides?.size ? gltfWorldMatrices(this.model, overrides) : undefined;
    for (const draw of this.draws) frame.draw(draw.mesh, multiplyMat4(root, matrices?.[draw.node] ?? draw.matrix), tint ? { ...draw.options, color: tint } : draw.options);
  }
  dispose(): void {
    if (this.#disposed) return;
    // Release dependants before their bindings. This matters for hosts that
    // defer GPU destruction and validate live material texture references.
    for (const id of this.materialIds) this.host.releaseMaterial(id);
    for (const id of this.meshIds) this.host.releaseMesh(id);
    for (const id of this.textureIds) this.host.releaseTexture(id);
    this.#disposed = true;
  }
}

export function gltfWorldMatrices(model: ImportedGltf, overrides?: ReadonlyMap<number, readonly number[]>): Mat4[] {
  const result: Mat4[] = [];
  const visit = (nodeIndex: number, parent: Mat4): void => {
    const node = model.nodes[nodeIndex]!;
    const local = overrides?.get(nodeIndex) ?? node.matrix ?? compose(node.translation, node.rotation, node.scale);
    const world = multiplyMat4(parent, local);
    result[nodeIndex] = world;
    for (const child of node.children) visit(child, world);
  };
  for (const root of model.scenes[model.defaultScene] ?? []) visit(root, identity());
  return result;
}

export async function uploadGltfAsset(host: GltfUploadHost, model: ImportedGltf, options: GltfUploadOptions): Promise<GltfAsset> {
  if (!options.id.trim() || options.id.startsWith('builtin:')) throw new Error('glTF asset needs a unique non-reserved namespace.');
  const meshIds: string[] = [], materialIds: string[] = [], textureIds: string[] = [];
  const imageCache = new Map<number, Awaited<ReturnType<GltfImageDecoder>>>();
  const textureCache = new Map<string, string>();
  const warnings = [...model.warnings];
  const checkAbort = (): void => { options.signal?.throwIfAborted(); };
  let bytes = 0;
  const maxSize = options.maxTextureSize ?? 8192;
  if (!Number.isSafeInteger(maxSize) || maxSize < 1) throw new Error('maxTextureSize must be a positive integer.');
  const texture = async (index: number | undefined, srgb: boolean): Promise<string | undefined> => {
    if (index === undefined) return undefined;
    const source = model.textures[index]!;
    const mipmaps = source.sampler.minFilter >= 9984;
    const key = `${source.source}:${srgb}:${mipmaps}`;
    const cached = textureCache.get(key); if (cached) return cached;
    checkAbort();
    let decoded = imageCache.get(source.source);
    if (!decoded) {
      decoded = await (options.decodeImage ?? decodeGltfImage)(model.images[source.source]!);
      checkAbort();
      if (!Number.isSafeInteger(decoded.width) || decoded.width < 1 || !Number.isSafeInteger(decoded.height) || decoded.height < 1 || decoded.width > maxSize || decoded.height > maxSize || decoded.pixels.length !== decoded.width * decoded.height * 4) throw new Error(`glTF '${options.id}' image ${source.source} is not valid RGBA8 within the ${maxSize}px texture budget.`);
      imageCache.set(source.source, decoded);
    }
    const id = `${options.id}:texture:${key}`;
    host.uploadTexture(id, { ...decoded, colorSpace: srgb ? 'srgb' : 'linear', mipmaps });
    textureIds.push(id); textureCache.set(key, id); bytes += Math.ceil(decoded.pixels.length * 4 / 3);
    return id;
  };
  try {
    for (const [index, material] of model.materials.entries()) {
      checkAbort();
      const bindings: Record<string,string> = {};
      for (const [slot, source, srgb] of [ ['baseColor',material.baseColorTexture,true], ['normal',material.normalTexture,false], ['metallicRoughness',material.metallicRoughnessTexture,false], ['occlusion',material.occlusionTexture,false], ['emission',material.emissiveTexture,true] ] as const) {
        const id = await texture(source, srgb); if (id) bindings[slot] = id;
      }
      const textureIndices = [material.baseColorTexture, material.normalTexture, material.metallicRoughnessTexture, material.occlusionTexture, material.emissiveTexture].filter((x): x is number => x !== undefined);
      const samplers = textureIndices.map(index => model.textures[index]!.sampler);
      const sampler = samplers[0];
      if (sampler && (sampler.wrapS !== sampler.wrapT || samplers.some(value => JSON.stringify(value) !== JSON.stringify(sampler)))) warnings.push(`${options.id} material ${index}: renderer uses one sampler; first texture's S wrap/filter policy is applied to all slots.`);
      const linear = sampler?.magFilter !== 9728 && ![9728, 9984, 9986].includes(sampler?.minFilter ?? 9987);
      if (sampler && ((sampler.magFilter === 9729) !== linear || [9984, 9985, 9986].includes(sampler.minFilter))) warnings.push(`${options.id} material ${index}: glTF sampler has mixed min/mag or mip filtering; Vapour uses the closest shared ${linear ? 'linear' : 'nearest'} sampler.`);
      const id = `${options.id}:material:${index}`;
      host.defineMaterial(id, { baseColor: material.baseColor, emission: material.emissive, normalScale: material.normalScale, occlusionStrength: material.occlusionStrength, textures: bindings, alphaMode: material.alphaMode.toLowerCase() as 'opaque'|'mask'|'blend', doubleSided: material.doubleSided, filter: linear ? 'linear' : 'nearest', anisotropy: linear && sampler?.minFilter === 9987 ? 8 : 1, addressMode: sampler?.wrapS === 33071 ? 'clamp' : sampler?.wrapS === 33648 ? 'mirror' : 'repeat' });
      materialIds.push(id);
    }
    for (const [index, primitive] of model.primitives.entries()) {
      checkAbort();
      const id = `${options.id}:mesh:${index}`;
      host.uploadMesh(id, primitive.mesh); meshIds.push(id);
      bytes += primitive.mesh.positions.length / 3 * 68 + primitive.mesh.indices.byteLength;
    }
    const matrices = gltfWorldMatrices(model);
    const draws: GltfDraw[] = [];
    for (const [index, node] of model.nodes.entries()) {
      if (node.mesh === undefined || !matrices[index]) continue;
      for (const primitiveIndex of model.meshPrimitives[node.mesh]!) {
        const primitive = model.primitives[primitiveIndex]!;
        const material = primitive.material === undefined ? undefined : model.materials[primitive.material];
        draws.push({ node: index, name: node.name, mesh: meshIds[primitiveIndex]!, matrix: matrices[index]!, options: { ...(primitive.material === undefined ? {} : { material: materialIds[primitive.material]! }), metallic: material?.metallic ?? 1, roughness: material?.roughness ?? 1, emissive: material && (material.emissive.some(x => x > 0)) ? 1 : 0, alphaCutoff: material?.alphaMode === 'MASK' ? material.alphaCutoff : 0 } });
      }
    }
    checkAbort();
    return new GltfAsset(host, model, meshIds, materialIds, textureIds, draws, bytes, warnings);
  } catch (cause) {
    const cleanupErrors: unknown[] = [];
    for (const [ids, release] of [[meshIds,host.releaseMesh.bind(host)], [materialIds,host.releaseMaterial.bind(host)], [textureIds,host.releaseTexture.bind(host)]] as const) for (const id of ids) { try { release(id); } catch (error) { cleanupErrors.push(error); } }
    if (cleanupErrors.length) throw new AggregateError([cause,...cleanupErrors], `glTF '${options.id}' upload and rollback failed.`);
    throw new Error(`glTF '${options.id}' could not upload: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** Browser decoder preserves glTF's upper-left UV image convention and keeps
 * alpha unpremultiplied. Workers may inject their own decoder instead. */
export async function decodeGltfImage(image: ImportedGltfImage): Promise<Pick<TextureUpload,'width'|'height'|'pixels'>> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }), { colorSpaceConversion:'none', premultiplyAlpha:'none', imageOrientation:'none' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently:true });
    if (!context) throw new Error(`Cannot decode ${image.name}: a 2D image context is unavailable.`);
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0,0,bitmap.width,bitmap.height);
    return { width:bitmap.width, height:bitmap.height, pixels:new Uint8Array(data.data.buffer) };
  } finally { bitmap.close(); }
}
