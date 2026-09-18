import { describe, expect, it } from "vitest";
import { UiDocument, type UiNodeDefinition } from "./ui.js";

/**
 * Mirage M93: large UI trees.
 *
 * Asserts against a generous absolute budget and a linear-ish growth ratio
 * rather than a tight wall-clock number, because a perf test that fails when
 * the CI box is busy teaches everyone to ignore it.
 */
function tree(depth: number, breadth: number, prefix = "n"): UiNodeDefinition {
  const children: UiNodeDefinition[] = [];
  for (let index = 0; index < breadth; index += 1) {
    const id = `${prefix}.${String(index)}`;
    children.push(
      depth === 0
        ? { id, role: index % 3 === 0 ? "button" : "text", style: { height: 12, width: "fill" } }
        : tree(depth - 1, breadth, id),
    );
  }
  return { id: prefix, role: "panel", style: { direction: depth % 2 === 0 ? "column" : "row", gap: 1, padding: 1 }, children };
}

function countNodes(node: UiNodeDefinition): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}

function time(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe("ui scale", () => {
  it("lays out and hit-tests a tree of thousands of nodes inside budget", () => {
    const small = tree(3, 6); // 1 + 6 + 36 + 216 + 1296 = 1555 nodes
    const large = tree(4, 6); // 9331 nodes
    expect(countNodes(large)).toBeGreaterThan(9000);

    const smallDoc = new UiDocument(small);
    const largeDoc = new UiDocument(large);
    // Warm up so JIT and allocation noise land outside the measured runs.
    smallDoc.layout(1920, 1080);
    largeDoc.layout(1920, 1080);

    const smallLayout = Math.min(...Array.from({ length: 3 }, () => time(() => smallDoc.layout(1920, 1080))));
    const largeLayout = Math.min(...Array.from({ length: 3 }, () => time(() => largeDoc.layout(1920, 1080))));
    const hitTests = time(() => {
      for (let index = 0; index < 1000; index += 1) largeDoc.hitTest((index * 37) % 1920, (index * 53) % 1080);
    });

    console.log(`ui scale: ${String(countNodes(small))} nodes ${smallLayout.toFixed(2)} ms, ${String(countNodes(large))} nodes ${largeLayout.toFixed(2)} ms, 1000 hit tests ${hitTests.toFixed(2)} ms`);

    // 9k nodes must lay out well inside a frame even on a loaded machine. The
    // bound is generous (not a frame budget) because this suite runs alongside
    // other concurrent test/build processes in CI and must not flake from
    // scheduler noise; the growth-ratio assertion below is what actually
    // catches an algorithmic regression.
    expect(largeLayout).toBeLessThan(800);
    expect(hitTests).toBeLessThan(800);
    // Six times the nodes should not cost more than ~25x the time: layout is
    // linear in nodes, and the slack covers cache effects, not algorithmic
    // regressions to quadratic.
    expect(largeLayout).toBeLessThan(Math.max(5, smallLayout * 25));
  });
});
