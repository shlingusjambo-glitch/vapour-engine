import { describe, expect, it } from "vitest";
import { MAX_LIGHT_LEVEL, VoxelLightField } from "./voxel-lighting.js";
import { meshVoxelChunk } from "./voxel-mesher.js";
import { VoxelPalette, VoxelWorld } from "./voxel-world.js";

const palette = new VoxelPalette([
  { id: 1, name: "Stone", solid: true, opaque: true, color: [0.8, 0.8, 0.8, 1] },
  { id: 2, name: "Torch", solid: false, opaque: false, color: [1, 1, 1, 1], emission: 14 },
]);

/** Fills the surface of an axis-aligned box with opaque blocks, leaving its
 * interior air — a fully sealed room with no gap for light to detour
 * through, unlike a single wall/roof block. */
function sealBox(world: VoxelWorld, box: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number; readonly minZ: number; readonly maxZ: number }): void {
  for (let y = box.minY; y <= box.maxY; y += 1) {
    for (let z = box.minZ; z <= box.maxZ; z += 1) {
      for (let x = box.minX; x <= box.maxX; x += 1) {
        const onSurface = x === box.minX || x === box.maxX || y === box.minY || y === box.maxY || z === box.minZ || z === box.maxZ;
        if (onSurface) world.setBlock(x, y, z, 1);
      }
    }
  }
}

describe("VoxelLightField skylight", () => {
  it("lights an open column to full skylight and stops below the roof of a fully sealed room", () => {
    const world = new VoxelWorld({ chunkSize: 8, height: 8 });
    world.ensureChunk(0, 0);
    sealBox(world, { minX: 0, maxX: 3, minY: 0, maxY: 3, minZ: 0, maxZ: 3 });
    const light = new VoxelLightField(world, palette);
    light.recomputeAll();
    expect(light.get(4, 7, 4).sky).toBe(MAX_LIGHT_LEVEL);
    expect(light.get(4, 4, 4).sky).toBe(MAX_LIGHT_LEVEL);
    // Interior of the sealed room: no path in for skylight at any level.
    expect(light.get(1, 1, 1).sky).toBe(0);
    expect(light.get(2, 2, 2).sky).toBe(0);
  });

  it("spreads skylight horizontally under an overhang", () => {
    const world = new VoxelWorld({ chunkSize: 8, height: 8 });
    world.ensureChunk(0, 0);
    // A roof over x in [3,4], leaving a lit gap the light must creep into
    // sideways from open columns at x=0..2 and x=5..7.
    for (let x = 3; x <= 4; x += 1) world.setBlock(x, 5, 3, 1);
    const light = new VoxelLightField(world, palette);
    light.recomputeAll();
    const underRoof = light.get(3, 3, 3).sky;
    expect(underRoof).toBeGreaterThan(0);
    expect(underRoof).toBeLessThan(MAX_LIGHT_LEVEL);
  });
});

describe("VoxelLightField block light", () => {
  it("propagates from an emissive block and attenuates with distance", () => {
    const world = new VoxelWorld({ chunkSize: 8, height: 4 });
    world.ensureChunk(0, 0);
    world.setBlock(4, 0, 4, 2); // torch
    const light = new VoxelLightField(world, palette);
    light.recomputeAll();
    expect(light.get(4, 0, 4).block).toBe(14);
    expect(light.get(5, 0, 4).block).toBe(13);
    expect(light.get(6, 0, 4).block).toBe(12);
    expect(light.get(4, 0, 4 + 14).block).toBe(0);
  });

  it("does not leak a sealed room's torch out through the wall", () => {
    const world = new VoxelWorld({ chunkSize: 8, height: 8 });
    world.ensureChunk(0, 0);
    sealBox(world, { minX: 0, maxX: 3, minY: 0, maxY: 3, minZ: 0, maxZ: 3 });
    world.setBlock(1, 1, 1, 2); // torch sealed inside
    const light = new VoxelLightField(world, palette);
    light.recomputeAll();
    expect(light.get(1, 1, 1).block).toBe(14);
    expect(light.get(4, 1, 1).block).toBe(0);
  });

  it("does not leak an outside torch in through a sealed room's wall", () => {
    const world = new VoxelWorld({ chunkSize: 8, height: 8 });
    world.ensureChunk(0, 0);
    sealBox(world, { minX: 0, maxX: 3, minY: 0, maxY: 3, minZ: 0, maxZ: 3 });
    world.setBlock(6, 1, 1, 2); // torch outside, well clear of the room
    const light = new VoxelLightField(world, palette);
    light.recomputeAll();
    expect(light.get(6, 1, 1).block).toBe(14);
    expect(light.get(2, 1, 1).block).toBe(0);
  });
});

describe("VoxelLightField.relight", () => {
  it("matches a full recompute after adding a torch, within the relit radius", () => {
    const world = new VoxelWorld({ chunkSize: 16, height: 4 });
    world.ensureChunk(0, 0);
    const incremental = new VoxelLightField(world, palette);
    incremental.recomputeAll(); // baseline: no sources yet

    world.setBlock(8, 0, 8, 2);
    incremental.relight(8, 0, 8);

    const reference = new VoxelLightField(world, palette);
    reference.recomputeAll();

    for (let dz = -5; dz <= 5; dz += 1) {
      for (let dx = -5; dx <= 5; dx += 1) {
        expect(incremental.get(8 + dx, 0, 8 + dz)).toEqual(reference.get(8 + dx, 0, 8 + dz));
      }
    }
  });

  it("removing a light source darkens the region back down", () => {
    const world = new VoxelWorld({ chunkSize: 16, height: 4 });
    world.ensureChunk(0, 0);
    world.setBlock(8, 0, 8, 2);
    const light = new VoxelLightField(world, palette);
    light.recomputeAll();
    expect(light.get(9, 0, 8).block).toBeGreaterThan(0);

    world.setBlock(8, 0, 8, 0);
    light.relight(8, 0, 8);
    expect(light.get(8, 0, 8).block).toBe(0);
    expect(light.get(9, 0, 8).block).toBe(0);
  });
});

describe("meshVoxelChunk with a light field", () => {
  it("darkens a face lit by a distant, low block-light sample", () => {
    const world = new VoxelWorld({ chunkSize: 8, height: 4 });
    world.setBlock(2, 0, 2, 1);
    const light = new VoxelLightField(world, palette);
    light.recomputeAll(); // no sources: everywhere is dark except sky
    const mesh = meshVoxelChunk(world, palette, 0, 0, { light });
    // Top face is skylit; a side face facing another dark air cell should be
    // dimmer than the unlit-default mesh (which always reads 1).
    const unlit = meshVoxelChunk(world, palette, 0, 0);
    expect(mesh.light.length).toBe(unlit.positions.length / 3);
    expect(Math.min(...mesh.light)).toBeLessThan(1);
  });

  it("without a light field every vertex reads fully lit, matching prior behaviour", () => {
    const world = new VoxelWorld({ chunkSize: 4, height: 4 });
    world.setBlock(1, 1, 1, 1);
    const mesh = meshVoxelChunk(world, palette, 0, 0);
    expect(Array.from(mesh.light)).toEqual(new Array(mesh.light.length).fill(1));
  });
});
