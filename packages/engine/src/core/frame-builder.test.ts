import { describe, expect, it } from "vitest";
import { FrameBuilder, composeMatrix, composeTranslation } from "./frame-builder.js";

/** Float32 storage rounds, so packed values are compared with tolerance. */
function expectClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) {
    expect(actual[index]!).toBeCloseTo(value, 6);
  }
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

describe("FrameBuilder", () => {
  it("interns mesh identifiers so the table holds one entry per mesh", () => {
    const builder = new FrameBuilder();
    for (let index = 0; index < 100; index += 1) {
      builder.draw(index % 2 === 0 ? "builtin:cube" : "chunk:0", IDENTITY);
    }
    const frame = builder.pack();
    // The text crossing into WebAssembly must not scale with instance count.
    expect(frame.meshTable).toEqual(["builtin:cube", "chunk:0"]);
    expect(frame.meshIndices).toHaveLength(100);
    expect(frame.meshIndices[0]).toBe(0);
    expect(frame.meshIndices[1]).toBe(1);
  });

  it("packs matrices contiguously in submission order", () => {
    const builder = new FrameBuilder();
    builder.draw("a", composeTranslation(new Float32Array(16), 1, 2, 3));
    builder.draw("a", composeTranslation(new Float32Array(16), 4, 5, 6));
    const frame = builder.pack();
    expect(frame.matrices).toHaveLength(32);
    expect([frame.matrices[12], frame.matrices[13], frame.matrices[14]]).toEqual([1, 2, 3]);
    expect([frame.matrices[28], frame.matrices[29], frame.matrices[30]]).toEqual([4, 5, 6]);
  });

  it("copies the matrix so callers can reuse one scratch buffer", () => {
    const builder = new FrameBuilder();
    const scratch = composeTranslation(new Float32Array(16), 1, 0, 0);
    builder.draw("a", scratch);
    composeTranslation(scratch, 9, 9, 9);
    builder.draw("a", scratch);
    const frame = builder.pack();
    expect(frame.matrices[12]).toBe(1);
    expect(frame.matrices[28]).toBe(9);
  });

  it("applies per-instance defaults that match the renderer's", () => {
    const builder = new FrameBuilder();
    builder.draw("a", IDENTITY);
    const frame = builder.pack();
    expect([...frame.baseColors]).toEqual([1, 1, 1, 1]);
    // Values round-trip through Float32, so compare with tolerance.
    expectClose([...frame.materialParams], [0, 0.6, 0, 0.01]);
  });

  it("records supplied material options", () => {
    const builder = new FrameBuilder();
    builder.draw("a", IDENTITY, { color: [0.2, 0.4, 0.6, 0.8], metallic: 1, roughness: 0.2, emissive: 3, alphaCutoff: 0.5 });
    const frame = builder.pack();
    expectClose([...frame.baseColors], [0.2, 0.4, 0.6, 0.8]);
    expectClose([...frame.materialParams], [1, 0.2, 3, 0.5]);
  });

  it("interns stable material assets independently from meshes", () => {
    const builder = new FrameBuilder();
    builder.draw("chunk:0", IDENTITY, { material: "terrain:grass" });
    builder.draw("chunk:1", IDENTITY, { material: "terrain:grass" });
    builder.draw("chunk:1", IDENTITY, { material: "terrain:water" });
    const frame = builder.pack();
    expect(frame.materialTable).toEqual(["builtin:default", "terrain:grass", "terrain:water"]);
    expect([...frame.materialIndices]).toEqual([1, 1, 2]);
  });

  it("grows past its initial capacity without losing earlier draws", () => {
    const builder = new FrameBuilder(2);
    for (let index = 0; index < 9; index += 1) {
      builder.draw("a", composeTranslation(new Float32Array(16), index, 0, 0));
    }
    expect(builder.capacity).toBeGreaterThanOrEqual(9);
    const frame = builder.pack();
    expect(frame.meshIndices).toHaveLength(9);
    for (let index = 0; index < 9; index += 1) {
      expect(frame.matrices[index * 16 + 12]).toBe(index);
    }
  });

  it("reuses its buffers across frames instead of reallocating", () => {
    // A garbage collection pause mid-gameplay is a visible stutter, so the
    // steady state must allocate nothing.
    const builder = new FrameBuilder(64);
    for (let index = 0; index < 64; index += 1) builder.draw("a", IDENTITY);
    const capacity = builder.capacity;
    const buffer = builder.pack().matrices.buffer;
    builder.reset();
    for (let index = 0; index < 64; index += 1) builder.draw("a", IDENTITY);
    expect(builder.capacity).toBe(capacity);
    expect(builder.pack().matrices.buffer).toBe(buffer);
  });

  it("clears the mesh table on reset so a stale mesh is not resubmitted", () => {
    const builder = new FrameBuilder();
    builder.draw("chunk:0", IDENTITY);
    builder.reset();
    builder.draw("chunk:1", IDENTITY);
    expect(builder.pack().meshTable).toEqual(["chunk:1"]);
    expect(builder.drawCount).toBe(1);
  });

  it("omits camera and light until they are set", () => {
    const builder = new FrameBuilder();
    expect(builder.pack().camera).toHaveLength(0);
    expect(builder.pack().light).toHaveLength(0);
    builder.setCamera(IDENTITY, 70, 0.1, 500);
    builder.setLight([0, -1, 0], [1, 1, 1], 4);
    const frame = builder.pack();
    expect(frame.camera).toHaveLength(20);
    expectClose(
      [frame.camera[16]!, frame.camera[17]!, frame.camera[18]!, frame.camera[19]!],
      [0, 70, 0.1, 500],
    );
    expect([...frame.light]).toEqual([0, -1, 0, 1, 1, 1, 4]);
  });

  it("packs an orthographic camera without approximating it as perspective", () => {
    const builder = new FrameBuilder();
    builder.setOrthographicCamera(IDENTITY, 12, 0.01, 250);
    const camera = builder.pack().camera;
    expect(camera).toHaveLength(20);
    expectClose([camera[16]!, camera[17]!, camera[18]!, camera[19]!], [1, 12, 0.01, 250]);
  });

  it("rejects malformed input rather than corrupting the packed frame", () => {
    const builder = new FrameBuilder();
    expect(() => builder.draw("", IDENTITY)).toThrow(/mesh identifier/);
    expect(() => builder.draw("a", IDENTITY, { material: "" })).toThrow(/material/);
    expect(() => builder.draw("a", [1, 2, 3])).toThrow(/16 values/);
    expect(() => builder.setCamera([1, 2], 60, 0.1, 100)).toThrow(/16 values/);
    expect(() => builder.setCamera(IDENTITY, 60, 0, 100)).toThrow(/near < far/);
    expect(() => builder.setCamera(IDENTITY, 60, 10, 1)).toThrow(/near < far/);
    expect(() => new FrameBuilder(0)).toThrow(/positive integer/);
  });
});

describe("matrix helpers", () => {
  it("composes translation, rotation and scale in the renderer's layout", () => {
    const matrix = composeMatrix(new Float32Array(16), [1, 2, 3], [0, 0, 0, 1], [2, 2, 2]);
    expect([matrix[0], matrix[5], matrix[10]]).toEqual([2, 2, 2]);
    expect([matrix[12], matrix[13], matrix[14], matrix[15]]).toEqual([1, 2, 3, 1]);
  });

  it("rotates the basis, not the translation", () => {
    // A 90-degree yaw sends local +X to world -Z.
    const half = Math.SQRT1_2;
    const matrix = composeMatrix(new Float32Array(16), [5, 0, 0], [0, half, 0, half], [1, 1, 1]);
    expect(matrix[0]).toBeCloseTo(0, 5);
    expect(matrix[2]).toBeCloseTo(-1, 5);
    expect(matrix[12]).toBe(5);
  });

  it("writes a clean matrix into a reused buffer", () => {
    // Voxel chunks compose thousands of matrices per frame into scratch space;
    // stale values from a previous use must not survive.
    const scratch = new Float32Array(16).fill(7);
    composeTranslation(scratch, 1, 2, 3);
    expect([...scratch]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
  });

  it("applies uniform scale to a translation", () => {
    const matrix = composeTranslation(new Float32Array(16), 0, 0, 0, 4);
    expect([matrix[0], matrix[5], matrix[10]]).toEqual([4, 4, 4]);
  });

  it("refuses an undersized target", () => {
    expect(() => composeTranslation(new Float32Array(4), 0, 0, 0)).toThrow(/16 elements/);
    expect(() => composeMatrix(new Float32Array(4), [0, 0, 0], [0, 0, 0, 1], [1, 1, 1])).toThrow(/16 elements/);
  });
});
