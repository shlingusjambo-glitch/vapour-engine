import { describe, expect, it } from "vitest";
import {
  defaultTransform,
  type SceneData,
  type SceneEntityData,
} from "../core/scene-document.js";
import { DEFAULT_MESH_ID, meshLibrary } from "../assets/mesh-library.js";
import { extractRenderWorld } from "./render-world.js";

describe("render-world extraction", () => {
  it("resolves hierarchy transforms and extracts active render components", () => {
    const scene: SceneData = {
      formatVersion: 1,
      id: "scene",
      name: "Render test",
      entities: [
        entity("parent", "Parent", {
          ...defaultTransform(),
          position: [2, 0, 0],
        }),
        {
          ...entity("cube", "Cube", {
            ...defaultTransform(),
            position: [1, 0, 0],
          }),
          parent: "parent",
          components: [
            {
              typeName: "vapour.Transform",
              version: 1,
              data: { ...defaultTransform(), position: [1, 0, 0] },
            },
            {
              typeName: "vapour.MeshRenderer",
              version: 1,
              data: { mesh: "builtin:cube", baseColor: [1, 0.5, 0.25, 1] },
            },
          ],
        },
        {
          ...entity("camera", "Camera", {
            ...defaultTransform(),
            position: [0, 2, 5],
          }),
          components: [
            {
              typeName: "vapour.Transform",
              version: 1,
              data: { ...defaultTransform(), position: [0, 2, 5] },
            },
            {
              typeName: "vapour.Camera",
              version: 1,
              data: { fieldOfView: 70, near: 0.2, far: 500 },
            },
          ],
        },
        {
          ...entity("hidden", "Hidden", defaultTransform()),
          enabled: false,
          components: [
            {
              typeName: "vapour.Transform",
              version: 1,
              data: defaultTransform(),
            },
            {
              typeName: "vapour.MeshRenderer",
              version: 1,
              data: { mesh: "builtin:cube" },
            },
          ],
        },
      ],
    };
    const world = extractRenderWorld(scene);
    expect(world.camera?.fieldOfView).toBe(70);
    expect(world.instances).toHaveLength(1);
    expect(world.instances[0]?.modelMatrix.slice(12, 15)).toEqual([3, 0, 0]);
    expect(world.instances[0]?.baseColor).toEqual([1, 0.5, 0.25, 1]);
    expect(world.instances[0]?.material).toBe("builtin:default");
  });

  it("rejects mesh identifiers the renderer cannot draw, and names the alternatives", () => {
    const item = entity("mesh", "Mesh", defaultTransform());
    item.components.push({
      typeName: "vapour.MeshRenderer",
      version: 1,
      data: { mesh: "asset:future" },
    });
    expect(() => extractRenderWorld(sceneOf(item))).toThrow(
      /unknown mesh 'asset:future'/,
    );
    expect(() => extractRenderWorld(sceneOf(item))).toThrow(/builtin:cube/);
  });

  it("extracts every mesh in the shared library", () => {
    for (const mesh of meshLibrary()) {
      const item = entity(mesh.id, mesh.label, defaultTransform());
      item.components.push({
        typeName: "vapour.MeshRenderer",
        version: 1,
        data: { mesh: mesh.id },
      });
      expect(extractRenderWorld(sceneOf(item)).instances[0]?.mesh).toBe(
        mesh.id,
      );
    }
  });

  it("defaults an omitted mesh rather than dropping the instance", () => {
    const item = entity("mesh", "Mesh", defaultTransform());
    item.components.push({
      typeName: "vapour.MeshRenderer",
      version: 1,
      data: {},
    });
    expect(extractRenderWorld(sceneOf(item)).instances[0]?.mesh).toBe(
      DEFAULT_MESH_ID,
    );
  });

  it("packs and clamps per-instance material parameters", () => {
    const item = entity("mesh", "Mesh", defaultTransform());
    item.components.push({
      typeName: "vapour.MeshRenderer",
      version: 1,
      data: {
        mesh: "builtin:sphere",
        metallic: 4,
        roughness: 0,
        emissive: -3,
        alphaCutoff: 0.5,
      },
    });
    // Roughness is floored above zero because a perfect mirror makes the
    // specular term blow up; the others clamp to their physical range.
    expect(
      extractRenderWorld(sceneOf(item)).instances[0]?.materialParams,
    ).toEqual([1, 0.045, 0, 0.5]);
  });

  it("supplies material defaults for a scene authored before they existed", () => {
    const item = entity("mesh", "Mesh", defaultTransform());
    item.components.push({
      typeName: "vapour.MeshRenderer",
      version: 1,
      data: { mesh: "builtin:cube" },
    });
    expect(
      extractRenderWorld(sceneOf(item)).instances[0]?.materialParams,
    ).toEqual([0, 0.6, 0, 0.01]);
  });

  it("rejects a non-numeric material parameter instead of sending NaN to the GPU", () => {
    const item = entity("mesh", "Mesh", defaultTransform());
    item.components.push({
      typeName: "vapour.MeshRenderer",
      version: 1,
      data: { metallic: "shiny" },
    });
    expect(() => extractRenderWorld(sceneOf(item))).toThrow(
      /MeshRenderer.metallic must be a finite number/,
    );
  });

  it("extracts authored material IDs and sprite sorting into render instances", () => {
    const item = entity("sprite", "Portrait", {
      ...defaultTransform(),
      position: [1, 2, 0],
    });
    item.components.push({
      typeName: "vapour.SpriteRenderer",
      version: 1,
      data: {
        material: "material:portrait",
        color: [1, 0.5, 0.75, 0.8],
        sortingLayer: 3,
        order: 4,
      },
    });
    const instance = extractRenderWorld(sceneOf(item)).instances[0]!;
    expect(instance).toMatchObject({
      mesh: "builtin:quad",
      material: "material:portrait",
      baseColor: [1, 0.5, 0.75, 0.8],
    });
    expect(instance.modelMatrix[14]).toBeCloseTo(0.003004);
    item.components[1]!.data = { sortingLayer: 0.5 };
    expect(() => extractRenderWorld(sceneOf(item))).toThrow(
      /sortingLayer must be an integer/,
    );
  });
});

function sceneOf(...entities: SceneEntityData[]) {
  return { formatVersion: 1, id: "scene", name: "Scene", entities } as const;
}

function entity(
  id: string,
  name: string,
  transform: ReturnType<typeof defaultTransform>,
): SceneEntityData {
  return {
    id,
    name,
    enabled: true,
    components: [{ typeName: "vapour.Transform", version: 1, data: transform }],
  };
}
