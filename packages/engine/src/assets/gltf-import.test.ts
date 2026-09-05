import { describe, expect, it } from "vitest";
import { importGltf } from "./gltf-import.js";

function triangle(): string {
  const binary = new ArrayBuffer(42);
  const view = new DataView(binary);
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  positions.forEach((value, index) => view.setFloat32(index * 4, value, true));
  [0, 1, 2].forEach((value, index) =>
    view.setUint16(36 + index * 2, value, true),
  );
  const encoded = btoa(String.fromCharCode(...new Uint8Array(binary)));
  return JSON.stringify({
    asset: { version: "2.0" },
    buffers: [
      {
        uri: `data:application/octet-stream;base64,${encoded}`,
        byteLength: 42,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    meshes: [
      {
        name: "Triangle",
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
    ],
    materials: [
      {
        name: "Red",
        pbrMetallicRoughness: {
          baseColorFactor: [1, 0, 0, 1],
          metallicFactor: 0.2,
        },
      },
    ],
    nodes: [{ name: "Object", mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  });
}

function tangentedTriangle(): string {
  const binary = new ArrayBuffer(90);
  const view = new DataView(binary);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) =>
    view.setFloat32(index * 4, value, true),
  );
  [1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1].forEach((value, index) =>
    view.setFloat32(36 + index * 4, value, true),
  );
  [0, 1, 2].forEach((value, index) =>
    view.setUint16(84 + index * 2, value, true),
  );
  const encoded = btoa(String.fromCharCode(...new Uint8Array(binary)));
  return JSON.stringify({
    asset: { version: "2.0" },
    buffers: [
      {
        uri: `data:application/octet-stream;base64,${encoded}`,
        byteLength: 90,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 48 },
      { buffer: 0, byteOffset: 84, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC4" },
      { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, TANGENT: 1 }, indices: 2 }] },
    ],
    materials: [{ normalTexture: { index: 0, scale: 0.4 } }],
  });
}

describe("importGltf", () => {
  it("imports glTF 2.0 accessors into renderer-ready typed geometry", async () => {
    const result = await importGltf(triangle(), {
      sourceName: "triangle.gltf",
    });
    expect(result.primitives[0]?.id).toBe("Triangle:0");
    expect(Array.from(result.primitives[0]!.mesh.positions)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    expect(Array.from(result.primitives[0]!.mesh.indices)).toEqual([0, 1, 2]);
    expect(result.materials[0]).toMatchObject({
      name: "Red",
      baseColor: [1, 0, 0, 1],
      metallic: 0.2,
      roughness: 1,
    });
    expect(result.nodes[0]).toMatchObject({
      name: "Object",
      mesh: 0,
      translation: [0, 0, 0],
    });
  });

  it("reports unsupported and corrupt assets with source context", async () => {
    await expect(
      importGltf('{"asset":{"version":"1.0"}}', { sourceName: "old.gltf" }),
    ).rejects.toThrow(/old.gltf.*2.0/);
    const invalid = JSON.parse(triangle());
    invalid.meshes[0].primitives[0].mode = 1;
    await expect(
      importGltf(JSON.stringify(invalid), { sourceName: "lines.gltf" }),
    ).rejects.toThrow(/lines.gltf.*TRIANGLES/);
  });

  it("preserves authored tangent handedness and normal-map scale", async () => {
    const result = await importGltf(tangentedTriangle());
    expect(Array.from(result.primitives[0]!.mesh.tangents!)).toEqual([
      1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1,
    ]);
    expect(result.materials[0]).toMatchObject({
      normalTexture: 0,
      normalScale: 0.4,
    });
  });
});
