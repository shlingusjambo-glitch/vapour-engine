import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { importGltf } from "../../packages/engine/dist/assets/gltf-import.js";

const dir = resolve(process.argv[2] ?? "examples/coastal-city/public/assets");
const manifest = JSON.parse(
  await readFile(resolve(dir, "manifest.json"), "utf8"),
);
assert.equal(manifest.version, 1);
const results = [];
for (const asset of manifest.assets) {
  let high;
  for (const file of [asset.file, asset.lodFile]) {
    const bytes = await readFile(resolve(dir, file));
    const model = await importGltf(new Uint8Array(bytes), { sourceName: file });
    assert(model.primitives.length > 0, `${file}: no geometry`);
    let triangles = 0;
    for (const primitive of model.primitives) {
      const mesh = primitive.mesh;
      assert(
        mesh.positions.every(Number.isFinite),
        `${file}: invalid positions`,
      );
      assert(
        mesh.normals?.every(Number.isFinite),
        `${file}: missing/invalid normals`,
      );
      assert(mesh.uvs?.every(Number.isFinite), `${file}: missing/invalid UV0`);
      assert(
        !mesh.tangents || mesh.tangents.every(Number.isFinite),
        `${file}: invalid tangents`,
      );
      if (model.materials[primitive.material]?.normalTexture !== undefined)
        assert(
          mesh.tangents,
          `${file}: normal-mapped primitive needs tangents`,
        );
      assert(
        mesh.indices.every((i) => i < mesh.positions.length / 3),
        `${file}: index out of range`,
      );
      triangles += mesh.indices.length / 3;
    }
    if (file === asset.file) high = triangles;
    else assert(triangles <= high, `${file}: LOD increased triangle count`);
    if (asset.id === "sedan" && file === asset.file) {
      for (const name of [
        "wheel_front_left",
        "wheel_front_right",
        "wheel_rear_left",
        "wheel_rear_right",
      ]) {
        const node = model.nodes.find((n) => n.name === name);
        assert(node, `${file}: missing ${name}`);
        assert(
          Math.abs(node.translation[1] - 0.36) < 0.01,
          `${file}: wheel axle height changed`,
        );
      }
    }
    results.push({
      file,
      bytes: bytes.byteLength,
      primitives: model.primitives.length,
      triangles,
    });
  }
  assert(
    asset.bounds.min.every((v, i) => v < asset.bounds.max[i]),
    `${asset.id}: invalid bounds`,
  );
}
console.log(
  JSON.stringify({ assets: manifest.assets.length, files: results }, null, 2),
);
