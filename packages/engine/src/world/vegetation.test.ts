import { describe, expect, it } from "vitest";
import { LodRegistry } from "../render/lod.js";
import type { RenderCameraSnapshot } from "../render/render-world.js";
import { TerrainHeightfield } from "./terrain.js";
import {
  scatterVegetation,
  vegetationInstances,
  vegetationLodRegistry,
  type VegetationPrototype,
} from "./vegetation.js";

function flatField(): TerrainHeightfield {
  return TerrainHeightfield.generate(33, 33, [200, 20, 200], () => 0.5);
}

const tree: VegetationPrototype = {
  id: "pine",
  meshId: "mesh:pine",
  impostorMeshId: "mesh:pine-impostor",
  impostorScreenHeight: 0.1,
  material: "mat:foliage",
  footprintRadius: 1.5,
};

describe("scatterVegetation", () => {
  it("is deterministic for a fixed seed", () => {
    const field = flatField();
    const options = { seed: "forest-1", rules: [{ prototype: tree, density: 0.01 }] };
    const a = scatterVegetation(field, options);
    const b = scatterVegetation(field, options);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("different seeds produce different placement", () => {
    const field = flatField();
    const a = scatterVegetation(field, { seed: "seed-a", rules: [{ prototype: tree, density: 0.02 }] });
    const b = scatterVegetation(field, { seed: "seed-b", rules: [{ prototype: tree, density: 0.02 }] });
    expect(a).not.toEqual(b);
  });

  it("rejects placements outside a height range", () => {
    const field = flatField();
    const instances = scatterVegetation(field, {
      seed: "s",
      rules: [{ prototype: tree, density: 0.05, minHeight: 100 }],
    });
    expect(instances).toHaveLength(0);
  });

  it("rejects placements steeper than the max slope on a sloped field", () => {
    const field = TerrainHeightfield.generate(33, 33, [200, 60, 200], (x) => x); // steep uniform ramp
    const gentle = scatterVegetation(field, { seed: "s", rules: [{ prototype: tree, density: 0.05, maxSlopeDegrees: 1 }] });
    const any = scatterVegetation(field, { seed: "s", rules: [{ prototype: tree, density: 0.05 }] });
    expect(gentle.length).toBeLessThan(any.length);
  });

  it("adding a second prototype does not reshuffle the first's placement", () => {
    const field = flatField();
    const onlyTree = scatterVegetation(field, { seed: "s", rules: [{ prototype: tree, density: 0.01 }] });
    const rock: VegetationPrototype = { id: "rock", meshId: "mesh:rock", material: "mat:rock", footprintRadius: 0.5 };
    const treeAndRock = scatterVegetation(field, {
      seed: "s",
      rules: [{ prototype: tree, density: 0.01 }, { prototype: rock, density: 0.02 }],
    });
    const treesOnly = treeAndRock.filter((instance) => instance.prototypeId === "pine");
    expect(treesOnly).toEqual(onlyTree);
  });
});

describe("vegetationInstances", () => {
  it("produces one renderer-ready instance per placement with a finite model matrix", () => {
    const field = flatField();
    const placements = scatterVegetation(field, { seed: "s", rules: [{ prototype: tree, density: 0.01 }] });
    const instances = vegetationInstances(placements, [tree]);
    expect(instances).toHaveLength(placements.length);
    for (const instance of instances) {
      expect(instance.mesh).toBe("mesh:pine");
      expect(instance.modelMatrix).toHaveLength(16);
      expect(instance.modelMatrix.every(Number.isFinite)).toBe(true);
    }
  });

  it("throws for a placement referencing an unregistered prototype", () => {
    const field = flatField();
    const placements = scatterVegetation(field, { seed: "s", rules: [{ prototype: tree, density: 0.02 }] });
    expect(() => vegetationInstances(placements, [])).toThrow();
  });
});

describe("vegetationLodRegistry", () => {
  it("switches a distant instance to its impostor mesh", () => {
    const registry: LodRegistry = vegetationLodRegistry([tree]);
    const camera: RenderCameraSnapshot = {
      entityId: "cam",
      worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      fieldOfView: 60,
      near: 0.1,
      far: 1000,
    };
    const near = { entityId: "a", mesh: "mesh:pine", material: "m", modelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 3, 1], baseColor: [1, 1, 1, 1] as const, materialParams: [0, 1, 0, 0.5] as const };
    const far = { ...near, entityId: "b", modelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5000, 1] };
    const result = registry.apply([near, far], camera);
    expect(result.instances.find((i) => i.entityId === "a")?.mesh).toBe("mesh:pine");
    expect(result.instances.find((i) => i.entityId === "b")?.mesh).toBe("mesh:pine-impostor");
  });

  it("leaves a prototype with no impostor undefined in the registry", () => {
    const rock: VegetationPrototype = { id: "rock", meshId: "mesh:rock", material: "m", footprintRadius: 0.5 };
    const registry = vegetationLodRegistry([rock]);
    expect(registry.has("mesh:rock")).toBe(false);
  });
});
