import { describe, expect, it, vi } from "vitest";
import { FloatingOrigin, WorldPartition, selectTerrainLod, terrainSeams, type TerrainLodLevel } from "./large-world.js";

describe("FloatingOrigin", () => {
  it("does nothing while the viewer is near the origin", () => {
    const origin = new FloatingOrigin({ threshold: 1000 });
    expect(origin.update([500, 0, 0])).toBeUndefined();
    expect(origin.origin).toEqual([0, 0, 0]);
  });

  it("rebases once the viewer strays past the threshold", () => {
    const origin = new FloatingOrigin({ threshold: 1000 });
    const shift = origin.update([1500, 0, 0]);
    expect(shift).toBeDefined();
    expect(shift!.delta[0]).toBe(-1500);
    expect(origin.origin).toEqual([1500, 0, 0]);
    expect(origin.shiftCount).toBe(1);
  });

  it("keeps absolute and local coordinates consistent", () => {
    const origin = new FloatingOrigin({ threshold: 100 });
    origin.update([500, 0, 300]);
    const absolute: [number, number, number] = [1234.5, 20, -87];
    expect(origin.toWorld(origin.toLocal(absolute))).toEqual(absolute);
    // The local coordinate is small, which is the entire point.
    expect(Math.abs(origin.toLocal(absolute)[0])).toBeLessThan(Math.abs(absolute[0]));
  });

  it("snaps the shift, so procedural content does not crawl", () => {
    // An unsnapped shift changes the fractional part of every coordinate and
    // makes noise-based terrain visibly crawl.
    const origin = new FloatingOrigin({ threshold: 100, snap: 64 });
    const shift = origin.update([333.7, 0, 0])!;
    // Math.abs, because a negative multiple yields -0 and Object.is distinguishes it.
    expect(Math.abs(shift.delta[0] % 64)).toBe(0);
  });

  it("emits a shift so systems can move cached positions", () => {
    const origin = new FloatingOrigin({ threshold: 100 });
    const seen: number[] = [];
    origin.shifted.on((shift) => seen.push(shift.delta[0]));
    origin.update([200, 0, 0]);
    expect(seen).toEqual([-200]);
  });

  it("applies a shift to a position and to a packed buffer", () => {
    const origin = new FloatingOrigin({ threshold: 10 });
    const shift = origin.update([100, 0, 50])!;
    expect(FloatingOrigin.apply([1, 2, 3], shift)).toEqual([-99, 2, -47]);

    const positions = new Float32Array([0, 0, 0, 10, 0, 10]);
    FloatingOrigin.applyToBuffer(positions, shift);
    expect([...positions]).toEqual([-100, 0, -50, -90, 0, -40]);
    expect(() => FloatingOrigin.applyToBuffer(positions, shift, 2)).toThrow(/at least 3/);
  });

  it("shifts interleaved buffers by stride", () => {
    const origin = new FloatingOrigin({ threshold: 1 });
    const shift = origin.update([10, 0, 0])!;
    // Position plus a normal, six floats per vertex.
    const data = new Float32Array([0, 0, 0, 1, 1, 1, 5, 0, 0, 1, 1, 1]);
    FloatingOrigin.applyToBuffer(data, shift, 6);
    expect(data[0]).toBe(-10);
    expect(data[3]).toBe(1);
    expect(data[6]).toBe(-5);
  });

  it("accumulates across many rebases without drift", () => {
    const origin = new FloatingOrigin({ threshold: 100, snap: 1 });
    let local: [number, number, number] = [0, 0, 0];
    for (let step = 0; step < 50; step += 1) {
      local = [local[0] + 40, 0, 0];
      const shift = origin.update(local);
      if (shift) local = FloatingOrigin.apply(local, shift) as [number, number, number];
    }
    // The viewer travelled 2000 units; the origin followed and the local
    // coordinate stayed small.
    expect(origin.origin[0]).toBeGreaterThan(1800);
    expect(Math.abs(local[0])).toBeLessThan(120);
  });

  it("reports f32 precision, so a threshold can be justified", () => {
    // Roughly a millimetre at 10 km, a centimetre at 100 km.
    expect(FloatingOrigin.precisionAt(0)).toBe(0);
    expect(FloatingOrigin.precisionAt(10_000)).toBeLessThan(0.002);
    expect(FloatingOrigin.precisionAt(10_000)).toBeGreaterThan(0.0002);
    expect(FloatingOrigin.precisionAt(100_000)).toBeGreaterThan(FloatingOrigin.precisionAt(10_000));
    expect(() => FloatingOrigin.precisionAt(-1)).toThrow(/must not be negative/);
  });

  it("resets for a level change", () => {
    const origin = new FloatingOrigin({ threshold: 10 });
    origin.update([100, 0, 0]);
    origin.reset();
    expect(origin.origin).toEqual([0, 0, 0]);
    origin.reset([5, 0, 5]);
    expect(origin.toLocal([5, 0, 5])).toEqual([0, 0, 0]);
  });

  it("validates its options", () => {
    expect(() => new FloatingOrigin({ threshold: 0 })).toThrow(/must be positive/);
    expect(() => new FloatingOrigin({ snap: 0 })).toThrow(/must be positive/);
  });
});

describe("WorldPartition", () => {
  it("loads a square of cells around the viewer, nearest first", () => {
    const partition = new WorldPartition({ cellSize: 100, loadRadius: 1 });
    const update = partition.update([50, 0, 50]);
    expect(update.toLoad).toHaveLength(9);
    expect(update.toLoad[0]!.ring).toBe(0);
    // The cell the player is about to enter matters more than one at the edge.
    expect(update.toLoad.at(-1)!.ring).toBe(1);
    expect(update.resident).toBe(9);
  });

  it("loads only what is new as the viewer moves", () => {
    const partition = new WorldPartition({ cellSize: 100, loadRadius: 1, unloadPadding: 0 });
    partition.update([50, 0, 50]);
    const moved = partition.update([150, 0, 50]);
    expect(moved.toLoad).toHaveLength(3);
    expect(moved.toUnload).toHaveLength(3);
  });

  it("does not thrash on a boundary, which is the classic streaming bug", () => {
    const partition = new WorldPartition({ cellSize: 100, loadRadius: 1, unloadPadding: 1 });
    partition.update([99, 0, 50]);
    // Stepping back and forth across the boundary must not unload anything.
    const forward = partition.update([101, 0, 50]);
    const back = partition.update([99, 0, 50]);
    expect(forward.toUnload).toEqual([]);
    expect(back.toUnload).toEqual([]);
  });

  it("eventually unloads once past the padding", () => {
    const partition = new WorldPartition({ cellSize: 100, loadRadius: 1, unloadPadding: 1 });
    partition.update([50, 0, 50]);
    const far = partition.update([950, 0, 50]);
    expect(far.toUnload.length).toBeGreaterThan(0);
  });

  it("maps positions to cells and back to centres", () => {
    const partition = new WorldPartition({ cellSize: 64 });
    expect(partition.cellOf([70, 0, -1])).toEqual({ x: 1, z: -1 });
    expect(partition.centerOf({ x: 1, z: -1 })).toEqual([96, 0, -32]);
    expect(partition.cellSize).toBe(64);
  });

  it("moves resident cells with a floating-origin rebase", () => {
    const origin = new FloatingOrigin({ threshold: 100, snap: 100 });
    const partition = new WorldPartition({ cellSize: 100, loadRadius: 1 });
    partition.update([50, 0, 50]);
    const before = partition.residentCells.map((cell) => cell.x).sort((a, b) => a - b);

    const shift = origin.update([500, 0, 0])!;
    partition.applyOriginShift(shift);
    const after = partition.residentCells.map((cell) => cell.x).sort((a, b) => a - b);
    // Cells moved by the shift measured in whole cells.
    expect(after[0]).toBe(before[0]! - 5);
  });

  it("ignores a sub-cell origin shift", () => {
    const origin = new FloatingOrigin({ threshold: 1, snap: 1 });
    const partition = new WorldPartition({ cellSize: 1000, loadRadius: 0 });
    partition.update([0, 0, 0]);
    partition.applyOriginShift(origin.update([2, 0, 0])!);
    expect(partition.residentCells[0]).toMatchObject({ x: 0, z: 0 });
  });

  it("clears and validates", () => {
    const partition = new WorldPartition({ cellSize: 10 });
    partition.update([0, 0, 0]);
    partition.clear();
    expect(partition.residentCells).toEqual([]);
    expect(() => new WorldPartition({ cellSize: 0 })).toThrow(/must be positive/);
    expect(() => new WorldPartition({ loadRadius: -1 })).toThrow(/non-negative whole number/);
    expect(() => new WorldPartition({ unloadPadding: 1.5 })).toThrow(/non-negative whole number/);
  });
});

describe("terrain LOD", () => {
  const levels: TerrainLodLevel[] = [
    { resolution: 64, ringRadius: 1 },
    { resolution: 32, ringRadius: 3 },
    { resolution: 16, ringRadius: 6 },
  ];

  it("picks resolution by ring, coarsening with distance", () => {
    expect(selectTerrainLod(levels, 0).resolution).toBe(64);
    expect(selectTerrainLod(levels, 2).resolution).toBe(32);
    expect(selectTerrainLod(levels, 5).resolution).toBe(16);
    // Beyond the last ring, the coarsest level holds.
    expect(selectTerrainLod(levels, 99).resolution).toBe(16);
  });

  it("rejects an ascending or empty chain", () => {
    expect(() => selectTerrainLod([], 0)).toThrow(/at least one level/);
    expect(() => selectTerrainLod([{ resolution: 16, ringRadius: 1 }, { resolution: 64, ringRadius: 2 }], 0))
      .toThrow(/must descend in resolution/);
    expect(() => selectTerrainLod([{ resolution: 1, ringRadius: 1 }], 0)).toThrow(/at least 2/);
  });

  it("reports exactly the edges bordering a coarser neighbour", () => {
    // Two adjacent chunks at different resolutions leave a crack along their
    // shared edge; knowing which edges need stitching is the whole point.
    const viewer = { x: 0, z: 0 };
    const inner = terrainSeams(levels, { x: 1, z: 0, ring: 1 }, viewer);
    expect(inner.east).toBe(true);
    expect(inner.west).toBe(false);
    expect(inner.north).toBe(false);
  });

  it("finds no seams in the middle of a uniform ring", () => {
    const viewer = { x: 0, z: 0 };
    expect(terrainSeams(levels, { x: 0, z: 0, ring: 0 }, viewer)).toEqual({ north: false, south: false, east: false, west: false });
  });
});
