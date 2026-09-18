# glTF and GLB importing

`importGltf` reads glTF 2.0 JSON and GLB into renderer-ready typed meshes,
materials, nodes, and scenes. URI loading is injected so imports work in a
browser, worker, CLI process, or custom asset server.

```ts
import { importGltf } from "@vapour/engine";

const model = await importGltf(await file.arrayBuffer(), {
  sourceName: file.name,
  resolveUri: async (uri) => await (await fetch(new URL(uri, assetBase))).arrayBuffer(),
});

for (const primitive of model.primitives) {
  renderer.uploadMesh(`model:${primitive.id}`, primitive.mesh);
}
```

The current importer supports GLB binary chunks, data URIs, external buffers,
interleaved accessors, normalized attributes, indexed/unindexed triangles,
positions, normals, UV0, RGB/RGBA vertex colors, metallic/roughness material
metadata, and hierarchical nodes. Unsupported primitive modes and sparse
accessors fail with the source asset and exact offending index instead of being
silently ignored.

