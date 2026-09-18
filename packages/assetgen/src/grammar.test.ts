import { describe, expect, it } from "vitest";
import { evaluateGrammar, validateShapeGrammar, type ShapeGrammar } from "./grammar.js";
import { buildAsset, validateAssetDescription } from "./describe.js";
import { meshBounds } from "./transform.js";

/** A 10 m × 9 m facade: three 3 m floors, five 2 m bays, one window per bay. */
const facade: ShapeGrammar = {
  axiom: "facade",
  scope: { size: [10, 9, 0.3] },
  rules: {
    facade: [{ op: "insert", primitive: "box", slot: 0 }, { op: "comp", thickness: 0.05, faces: { front: "floors" } }],
    floors: [{ op: "repeat", axis: "y", size: 3, then: "floor" }],
    floor: [{ op: "repeat", axis: "x", size: 2, then: "bay" }],
    bay: [
      {
        op: "split",
        axis: "x",
        parts: [{ fill: 1, then: [] }, { size: 1.2, then: "window" }, { fill: 1, then: [] }],
      },
    ],
    window: [{ op: "split", axis: "y", parts: [{ size: 0.9, then: [] }, { size: 1.4, then: [{ op: "insert", primitive: "box", slot: 2 }] }, { fill: 1, then: [] }] }],
  },
};

describe("evaluateGrammar", () => {
  it("derives a facade into one wall and fifteen windows", () => {
    const { terminals, stats } = evaluateGrammar(facade);
    expect(terminals).toHaveLength(16);
    expect(terminals.filter((terminal) => terminal.kind === "primitive" && terminal.slot === 2)).toHaveLength(15);
    expect(stats.truncated).toBe(0);
    const window = terminals[1]!;
    // First window: bay 0 of floor 0, centred in its 2 m bay, sill at 0.9 m.
    expect(window.scope.size.map((v) => +v.toFixed(6))).toEqual([1.2, 1.4, 0.05]);
    expect(window.scope.position.map((v) => +v.toFixed(6))).toEqual([0.4, 0.9, 0.25]);
    expect(window.rule).toBe("window");
    const last = terminals[15]!;
    expect(last.scope.position.map((v) => +v.toFixed(6))).toEqual([8.4, 6.9, 0.25]);
  });

  it("is identical for the same seed and differs for another when a rule is stochastic", () => {
    const grammar: ShapeGrammar = {
      axiom: "row",
      scope: { size: [12, 3, 3] },
      seed: 7,
      rules: {
        row: [{ op: "repeat", axis: "x", size: 1, then: "cell" }],
        cell: [{ op: "choose", options: [{ weight: 1, then: [{ op: "insert", primitive: "box" }] }, { weight: 1, then: [{ op: "insert", primitive: "cylinder" }] }] }],
      },
    };
    const shapes = (seed: number): string => evaluateGrammar({ ...grammar, seed }).terminals.map((t) => (t.kind === "primitive" ? t.primitive[0] : "?")).join("");
    expect(shapes(7)).toBe(shapes(7));
    expect(shapes(7)).not.toBe(shapes(8));
    expect(shapes(7)).toHaveLength(12);
    expect(shapes(7)).toMatch(/b/);
    expect(shapes(7)).toMatch(/c/);
  });

  it("stops a recursive rule at maxDepth and reports it", () => {
    const grammar: ShapeGrammar = {
      axiom: "tower",
      scope: { size: [2, 1, 2] },
      maxDepth: 5,
      rules: { tower: [{ op: "insert", primitive: "box" }, { op: "translate", offset: [0, 1, 0] }, { op: "scale", factor: [0.8, 1, 0.8] }, { op: "split", axis: "y", parts: [{ fill: 1, then: "tower" }] }] },
    };
    const { terminals, stats } = evaluateGrammar(grammar);
    expect(terminals).toHaveLength(6);
    expect(stats.truncated).toBe(1);
    expect(stats.derivations).toBe(6);
    // Each level is lifted and narrowed about its base centre.
    expect(terminals[1]!.scope.position.map((v) => +v.toFixed(6))).toEqual([0.2, 1, 0.2]);
    expect(terminals[1]!.scope.size.map((v) => +v.toFixed(6))).toEqual([1.6, 1, 1.6]);
  });

  it("peels faces with comp, insets with offset, and drops collapsed scopes", () => {
    const grammar: ShapeGrammar = {
      axiom: "block",
      scope: { size: [4, 3, 2], position: [1, 0, 1] },
      rules: {
        block: [{ op: "comp", thickness: 0.2, faces: { sides: [{ op: "insert", primitive: "box" }], top: [{ op: "offset", distance: -0.5, axes: ["x", "z"] }, { op: "insert", primitive: "cylinder" }], bottom: [{ op: "offset", distance: -5 }, { op: "insert", primitive: "box" }] } }],
      },
    };
    const { terminals } = evaluateGrammar(grammar);
    expect(terminals.map((t) => t.kind === "primitive" && t.primitive)).toEqual(["box", "box", "box", "box", "cylinder"]);
    const [front, back, left, right, top] = terminals.map((t) => t.scope);
    expect(front!.position).toEqual([1, 0, 2.8]);
    expect(front!.size).toEqual([4, 3, 0.2]);
    expect(back!.position).toEqual([1, 0, 1]);
    expect(left!.size).toEqual([0.2, 3, 2]);
    expect(right!.position[0]).toBeCloseTo(4.8);
    expect(top!.position).toEqual([1.5, 2.8, 1.5]);
    expect(top!.size).toEqual([3, 0.2, 1]);
  });

  it("squeezes oversized fixed parts to fit instead of overrunning", () => {
    const { terminals } = evaluateGrammar({
      axiom: "a",
      scope: { size: [2, 1, 1] },
      rules: { a: [{ op: "split", axis: "x", parts: [{ size: 3, then: [{ op: "insert", primitive: "box" }] }, { size: 1, then: [{ op: "insert", primitive: "box" }] }] }] },
    });
    expect(terminals.map((t) => t.scope.size[0])).toEqual([1.5, 0.5]);
    expect(terminals[1]!.scope.position[0]).toBe(1.5);
  });

  it("throws on an invalid grammar naming every issue", () => {
    expect(() => evaluateGrammar({ axiom: "x", scope: { size: [1, 1, 1] }, rules: {} })).toThrow(/grammar\.axiom/);
  });
});

describe("validateShapeGrammar", () => {
  it("reports every issue with a path", () => {
    const issues = validateShapeGrammar(
      {
        axiom: "nope",
        scope: { size: [1, 0, 1] },
        maxDepth: 0,
        rules: {
          a: [
            { op: "split", axis: "w", parts: [{ size: 1, fill: 1, then: "missing" }] },
            { op: "repeat", axis: "x", size: -1, then: [{ op: "warp" }] },
            { op: "comp", faces: { diagonal: [] } },
            { op: "scale" },
            { op: "insert", primitive: "torus", slot: -1 },
            { op: "ref", component: "ghost" },
            { op: "choose", options: [{ weight: -1, then: [] }] },
          ],
        },
      },
      "root.grammar",
      new Set(["tree"]),
    );
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ["root.grammar.axiom", "unknown-rule"],
      ["root.grammar.scope.size", "invalid-vector"],
      ["root.grammar.maxDepth", "out-of-range"],
      ["root.grammar.rules.a[0].axis", "invalid-axis"],
      ["root.grammar.rules.a[0].parts[0]", "invalid-part"],
      ["root.grammar.rules.a[0].parts[0].then", "unknown-rule"],
      ["root.grammar.rules.a[1].size", "out-of-range"],
      ["root.grammar.rules.a[1].then[0].op", "unknown-op"],
      ["root.grammar.rules.a[2].faces.diagonal", "unknown-face"],
      ["root.grammar.rules.a[3]", "missing-field"],
      ["root.grammar.rules.a[4].primitive", "unknown-kind"],
      ["root.grammar.rules.a[4].slot", "out-of-range"],
      ["root.grammar.rules.a[5].component", "unknown-component"],
      ["root.grammar.rules.a[6].options[0].weight", "out-of-range"],
    ]);
  });

  it("accepts the facade", () => {
    expect(validateShapeGrammar(facade)).toEqual([]);
  });
});

describe("grammar nodes in a description", () => {
  it("validates refs against the document's components", () => {
    const issues = validateAssetDescription({
      version: 1,
      id: "street",
      root: { kind: "grammar", grammar: { axiom: "a", scope: { size: [1, 1, 1] }, rules: { a: [{ op: "ref", component: "lamp" }] } } },
    });
    expect(issues).toEqual([{ path: "root.grammar.rules.a[0].component", code: "unknown-component", message: expect.any(String) }]);
  });

  it("builds fitted primitives and placed components from terminals", () => {
    const built = buildAsset({
      version: 1,
      id: "street",
      components: { lamp: { kind: "prop", spec: { kind: "lamppost", size: 1 } } },
      root: {
        kind: "grammar",
        grammar: {
          axiom: "street",
          scope: { size: [20, 4, 6], position: [-10, 0, -3] },
          rules: {
            street: [
              { op: "split", axis: "y", parts: [{ size: 0.2, then: [{ op: "insert", primitive: "box", slot: 4 }] }, { fill: 1, then: "lamps" }] },
            ],
            lamps: [{ op: "repeat", axis: "x", size: 5, then: [{ op: "scale", size: [0.5, 4, 0.5] }, { op: "ref", component: "lamp" }] }],
          },
        },
      },
    });
    const bounds = meshBounds(built.compiled.mesh);
    expect(bounds.min[0]).toBeCloseTo(-10, 1);
    expect(bounds.max[0]).toBeCloseTo(10, 1);
    expect(bounds.min[1]).toBeCloseTo(0, 2);
    expect(bounds.max[1]).toBeCloseTo(4.2, 1);
    expect(new Set(built.compiled.mesh.materialSlots)).toContain(4);
  });
});
