import { describe, it, expect, vi } from 'vitest';
import { importGltf } from './gltf-import.js';
import { uploadGltfAsset, gltfWorldMatrices } from './gltf-runtime.js';
import { HeadlessRenderHost } from '../render/headless-render-host.js';
import { FrameBuilder } from '../core/frame-builder.js';
import { identity } from '@vapour/math';
function fixture() {
    const bytes = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    return {
        asset: { version: '2.0' },
        buffers: [{ byteLength: 36, uri: 'data:application/octet-stream;base64,' + btoa(String.fromCharCode(...new Uint8Array(bytes.buffer))) }],
        bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
        images: [{ uri: 'data:image/png;base64,iVBORw==' }], textures: [{ source: 0 }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 0 } }, emissiveTexture: { index: 0 }, emissiveFactor: [1, .2, 0], occlusionTexture: { index: 0, strength: .7 } }],
        nodes: [{ translation: [3, 0, 0], children: [1] }, { translation: [0, 2, 0], mesh: 0 }],
    };
}
const decoder = async () => ({ width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255]) });
describe('owned glTF runtime resources', () => {
    it('decodes each image once, separates colour/data textures, draws hierarchical instances and disposes in dependency order', async () => {
        const model = await importGltf(JSON.stringify(fixture()));
        expect(model.scenes).toEqual([[0]]);
        const host = new HeadlessRenderHost();
        await host.initialize();
        const decode = vi.fn(decoder);
        const upload = vi.spyOn(host, 'uploadTexture');
        const asset = await uploadGltfAsset(host, model, { id: 'test', decodeImage: decode });
        expect(decode).toHaveBeenCalledTimes(1);
        expect(upload).toHaveBeenCalledTimes(2);
        expect(upload.mock.calls.map(x => x[1].colorSpace).sort()).toEqual(['linear', 'srgb']);
        expect(upload.mock.calls.every(x => x[1].mipmaps)).toBe(true);
        expect(asset.draws[0].matrix.slice(12, 15)).toEqual([3, 2, 0]);
        const frame = new FrameBuilder();
        asset.draw(frame, identity());
        host.submitFrame(frame.pack());
        expect(asset.triangleCount).toBe(1);
        const release = vi.spyOn(host, 'releaseTexture');
        asset.dispose();
        asset.dispose();
        expect(host.meshIds()).toEqual([]);
        expect(release).toHaveBeenCalledTimes(2);
        expect(() => asset.instantiate()).toThrow(/released/);
    });
    it('rolls back an interrupted material upload and reports contextual failures', async () => {
        const model = await importGltf(JSON.stringify(fixture()));
        const host = new HeadlessRenderHost();
        await host.initialize();
        vi.spyOn(host, 'defineMaterial').mockImplementation(() => { throw new Error('GPU rejected material'); });
        const release = vi.spyOn(host, 'releaseTexture');
        await expect(uploadGltfAsset(host, model, { id: 'broken', decodeImage: decoder })).rejects.toThrow(/broken.*GPU rejected material/);
        expect(release).toHaveBeenCalledTimes(2);
    });
    it('rejects cycles, missing material textures and unsupported UVs before uploading', async () => {
        const cycle = fixture();
        cycle.nodes[1].children = [0];
        await expect(importGltf(JSON.stringify(cycle), { sourceName: 'cycle.glb' })).rejects.toThrow(/cycle.glb.*cycle/);
        const missing = fixture();
        missing.textures = [];
        await expect(importGltf(JSON.stringify(missing))).rejects.toThrow(/texture.*out of range/);
        const uv = fixture();
        Object.assign(uv.materials[0].pbrMetallicRoughness.baseColorTexture, { texCoord: 1 });
        await expect(importGltf(JSON.stringify(uv))).rejects.toThrow(/UV0/);
    });
    it('applies local node animation overrides before children', async () => {
        const model = await importGltf(JSON.stringify(fixture()));
        const transform = identity();
        transform[12] = 10;
        expect(gltfWorldMatrices(model, new Map([[0, transform]]))[1].slice(12, 15)).toEqual([10, 2, 0]);
    });
    it('rejects oversized decoded images and observes cancellation before upload', async () => {
        const model = await importGltf(JSON.stringify(fixture()));
        const host = new HeadlessRenderHost();
        await host.initialize();
        await expect(uploadGltfAsset(host, model, { id: 'budget', maxTextureSize: 1, decodeImage: async () => ({ width: 2, height: 1, pixels: new Uint8Array(8) }) })).rejects.toThrow(/texture budget/);
        const abort = new AbortController();
        abort.abort();
        await expect(uploadGltfAsset(host, model, { id: 'cancel', signal: abort.signal, decodeImage: decoder })).rejects.toThrow(/cancel/);
        expect(host.meshIds()).toEqual([]);
    });
});
//# sourceMappingURL=gltf-runtime.test.js.map