/** Shape grammars: rules that carve a box into the parts of a building.
 *
 * The generators in this package each know one kind of thing. A grammar is how
 * an agent describes a kind of thing nobody wrote a generator for: "a facade is
 * floors; a floor is bays; a bay is wall, window, wall" — three rules, and the
 * evaluator does the arithmetic that a hand-placed description gets wrong the
 * moment a wall changes length.
 *
 * This is the CGA-style formulation on **axis-aligned scopes**. A scope is a
 * box (a minimum corner and a size); every rule rewrites the current scope
 * into smaller scopes or into terminals, which are the only output:
 *
 * - `split` divides a scope along one axis into parts with absolute sizes,
 *   fractions of the extent, or `fill` shares of whatever is left,
 * - `repeat` tiles a size along an axis as often as it fits,
 * - `comp` peels the six faces off a box as thin scopes,
 * - `scale`, `translate`, and `offset` adjust the scope in place,
 * - `choose` picks one alternative by seeded weight,
 * - `insert` and `ref` emit a terminal: a fitted primitive, or a named
 *   description-language component placed in the scope.
 *
 * Two guards make it safe to hand an untrusted document to: derivation stops at
 * `maxDepth`, so a rule that names itself cannot hang the evaluator, and every
 * stochastic choice comes from the document's own seed, so the same grammar
 * produces the same terminals on every machine.
 */
import type { AssetIssue } from "./describe.js";
import { seededRandom } from "./nature.js";

export type Axis = "x" | "y" | "z";
export type GrammarFace = "front" | "back" | "left" | "right" | "top" | "bottom";
export type GrammarPrimitive = "box" | "cylinder" | "sphere" | "cone";

export const GRAMMAR_PRIMITIVES: readonly GrammarPrimitive[] = ["box", "cylinder", "sphere", "cone"];
const FACES: readonly GrammarFace[] = ["front", "back", "left", "right", "top", "bottom"];

/** An axis-aligned box: minimum corner and extent along each axis. */
export interface Scope {
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}

/** What a branching op derives next: a rule by name, or ops inline. */
export type Successor = string | readonly GrammarOp[];

export interface SplitPart {
  /** Absolute size along the split axis. */
  readonly size?: number;
  /** Fraction of the scope's extent along the axis. */
  readonly fraction?: number;
  /** Share of the space left after absolute and fractional parts. */
  readonly fill?: number;
  readonly then: Successor;
}

export type GrammarOp =
  | { readonly op: "split"; readonly axis: Axis; readonly parts: readonly SplitPart[] }
  | { readonly op: "repeat"; readonly axis: Axis; readonly size: number; readonly then: Successor }
  | { readonly op: "comp"; readonly thickness?: number; readonly faces: Readonly<Partial<Record<GrammarFace | "sides" | "all", Successor>>> }
  | { readonly op: "scale"; readonly size?: readonly [number, number, number]; readonly factor?: readonly [number, number, number] | number }
  | { readonly op: "translate"; readonly offset: readonly [number, number, number] }
  | { readonly op: "offset"; readonly distance: number; readonly axes?: readonly Axis[] }
  | { readonly op: "choose"; readonly options: readonly { readonly weight?: number; readonly then: Successor }[] }
  | { readonly op: "insert"; readonly primitive: GrammarPrimitive; readonly slot?: number }
  | { readonly op: "ref"; readonly component: string; readonly fit?: boolean };

export const GRAMMAR_OPS = ["split", "repeat", "comp", "scale", "translate", "offset", "choose", "insert", "ref"] as const;

export interface ShapeGrammar {
  /** The rule derivation starts from. */
  readonly axiom: string;
  /** The starting scope. Position defaults to the origin. */
  readonly scope: { readonly size: readonly [number, number, number]; readonly position?: readonly [number, number, number] };
  readonly rules: Readonly<Record<string, readonly GrammarOp[]>>;
  readonly seed?: number;
  /** Deepest rule nesting before derivation stops. Defaults to 32. */
  readonly maxDepth?: number;
}

export type PlacedTerminal =
  | { readonly kind: "primitive"; readonly primitive: GrammarPrimitive; readonly slot?: number; readonly scope: Scope; readonly rule: string }
  | { readonly kind: "ref"; readonly component: string; readonly fit: boolean; readonly scope: Scope; readonly rule: string };

export interface GrammarResult {
  readonly terminals: readonly PlacedTerminal[];
  readonly stats: {
    /** Rule invocations, inline successors included. */
    readonly derivations: number;
    /** Derivations abandoned at `maxDepth`. Non-zero means a rule recursed. */
    readonly truncated: number;
  };
}

const DEFAULT_MAX_DEPTH = 32;
/** Most terminals one evaluation may emit, so a tight `repeat` cannot exhaust memory. */
const MAX_TERMINALS = 100_000;
const AXIS_INDEX: Readonly<Record<Axis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };

/**
 * Derives a grammar into placed terminals.
 *
 * Derivation is depth-first in document order, and the only randomness is the
 * seeded stream `choose` draws from, so output is a pure function of the
 * document. Scopes that collapse to a non-positive extent are dropped rather
 * than emitted: a window that no longer fits is absent, not inverted.
 */
export function evaluateGrammar(grammar: ShapeGrammar): GrammarResult {
  const issues = validateShapeGrammar(grammar);
  if (issues.length > 0) {
    throw new Error(`The shape grammar is invalid: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
  const maxDepth = grammar.maxDepth ?? DEFAULT_MAX_DEPTH;
  const random = seededRandom(grammar.seed ?? 1);
  const terminals: PlacedTerminal[] = [];
  const stats = { derivations: 0, truncated: 0 };

  const derive = (successor: Successor, scope: Scope, rule: string, depth: number): void => {
    if (scope.size.some((extent) => !(extent > 0))) return;
    if (depth > maxDepth) {
      stats.truncated += 1;
      return;
    }
    stats.derivations += 1;
    const ops = typeof successor === "string" ? grammar.rules[successor]! : successor;
    const name = typeof successor === "string" ? successor : rule;
    let current = scope;
    for (const op of ops) {
      switch (op.op) {
        case "scale": {
          const factor = typeof op.factor === "number" ? [op.factor, op.factor, op.factor] : op.factor;
          const size = current.size.map((extent, axis) => (op.size?.[axis] ?? extent) * (factor?.[axis] ?? 1)) as [number, number, number];
          // Scaling is about the scope's base centre, matching how every
          // generator anchors its output, so a narrowed wall stays put.
          current = {
            position: [current.position[0] + (current.size[0] - size[0]) / 2, current.position[1], current.position[2] + (current.size[2] - size[2]) / 2],
            size,
          };
          break;
        }
        case "translate":
          current = { position: current.position.map((value, axis) => value + op.offset[axis]!) as [number, number, number], size: current.size };
          break;
        case "offset": {
          const axes = op.axes ?? ["x", "y", "z"];
          const position = [...current.position] as [number, number, number];
          const size = [...current.size] as [number, number, number];
          for (const axis of axes) {
            position[AXIS_INDEX[axis]] -= op.distance;
            size[AXIS_INDEX[axis]] += op.distance * 2;
          }
          current = { position, size };
          break;
        }
        case "insert":
        case "ref":
          // An `offset` can collapse a scope mid-sequence; nothing is emitted
          // into a box with no volume.
          if (current.size.some((extent) => !(extent > 0))) break;
          if (terminals.length >= MAX_TERMINALS) throw new Error(`The grammar emitted more than ${String(MAX_TERMINALS)} terminals; check for a runaway repeat.`);
          terminals.push(
            op.op === "insert"
              ? { kind: "primitive", primitive: op.primitive, ...(op.slot === undefined ? {} : { slot: op.slot }), scope: current, rule: name }
              : { kind: "ref", component: op.component, fit: op.fit ?? false, scope: current, rule: name },
          );
          break;
        case "split":
          for (const piece of splitScope(current, op.axis, op.parts)) derive(piece.then, piece.scope, name, depth + 1);
          break;
        case "repeat": {
          const axis = AXIS_INDEX[op.axis];
          const extent = current.size[axis];
          const count = Math.max(1, Math.floor(extent / op.size + 1e-9));
          const step = extent / count;
          for (let index = 0; index < count; index += 1) {
            const position = [...current.position] as [number, number, number];
            const size = [...current.size] as [number, number, number];
            position[axis] += step * index;
            size[axis] = step;
            derive(op.then, { position, size }, name, depth + 1);
          }
          break;
        }
        case "comp": {
          const thickness = op.thickness ?? 0.1;
          for (const face of FACES) {
            const successor = op.faces[face] ?? (face !== "top" && face !== "bottom" ? op.faces.sides : undefined) ?? op.faces.all;
            if (successor !== undefined) derive(successor, faceScope(current, face, thickness), name, depth + 1);
          }
          break;
        }
        case "choose": {
          const total = op.options.reduce((sum, option) => sum + (option.weight ?? 1), 0);
          let pick = random() * total;
          let chosen = op.options[op.options.length - 1]!;
          for (const option of op.options) {
            pick -= option.weight ?? 1;
            if (pick < 0) {
              chosen = option;
              break;
            }
          }
          derive(chosen.then, current, name, depth + 1);
          break;
        }
      }
    }
  };

  derive(grammar.axiom, { position: grammar.scope.position ?? [0, 0, 0], size: grammar.scope.size }, grammar.axiom, 0);
  return { terminals, stats };
}

/**
 * Divides a scope along an axis. Absolute sizes are honoured first, fractions
 * next, and `fill` parts share the remainder by weight; when the fixed parts
 * overrun the extent everything is scaled down to fit, so a facade narrower
 * than its window pattern still derives rather than failing.
 */
function splitScope(scope: Scope, axisName: Axis, parts: readonly SplitPart[]): readonly { readonly scope: Scope; readonly then: Successor }[] {
  const axis = AXIS_INDEX[axisName];
  const extent = scope.size[axis];
  const fixed = parts.map((part) => (part.size ?? 0) + (part.fraction ?? 0) * extent);
  const fixedTotal = fixed.reduce((sum, value) => sum + value, 0);
  const fillTotal = parts.reduce((sum, part) => sum + (part.fill ?? 0), 0);
  const remainder = Math.max(0, extent - fixedTotal);
  const squeeze = fixedTotal > extent ? extent / fixedTotal : 1;
  let cursor = scope.position[axis];
  return parts.map((part, index) => {
    const length = part.fill === undefined ? fixed[index]! * squeeze : fillTotal > 0 ? (remainder * part.fill) / fillTotal : 0;
    const position = [...scope.position] as [number, number, number];
    const size = [...scope.size] as [number, number, number];
    position[axis] = cursor;
    size[axis] = length;
    cursor += length;
    return { scope: { position, size }, then: part.then };
  });
}

/** A face as a thin scope lying just inside the box, so inserts stay embedded. */
function faceScope(scope: Scope, face: GrammarFace, thickness: number): Scope {
  const [x, y, z] = scope.position;
  const [w, h, d] = scope.size;
  const t = Math.min(thickness, face === "top" || face === "bottom" ? h : face === "left" || face === "right" ? w : d);
  switch (face) {
    case "front":
      return { position: [x, y, z + d - t], size: [w, h, t] };
    case "back":
      return { position: [x, y, z], size: [w, h, t] };
    case "right":
      return { position: [x + w - t, y, z], size: [t, h, d] };
    case "left":
      return { position: [x, y, z], size: [t, h, d] };
    case "top":
      return { position: [x, y + h - t, z], size: [w, t, d] };
    case "bottom":
      return { position: [x, y, z], size: [w, t, d] };
  }
}

/**
 * Checks a grammar, returning every problem with a path into it.
 *
 * `componentNames` lets a document validate `ref` ops against the components it
 * actually declares; a grammar checked on its own accepts any component name.
 */
export function validateShapeGrammar(grammar: unknown, basePath = "grammar", componentNames?: ReadonlySet<string>): readonly AssetIssue[] {
  const issues: AssetIssue[] = [];
  if (!isRecord(grammar)) return [{ path: basePath, code: "not-an-object", message: "A shape grammar must be an object." }];

  const rules = grammar["rules"];
  const ruleNames = new Set<string>(isRecord(rules) ? Object.keys(rules) : []);
  if (!isRecord(rules)) {
    issues.push({ path: `${basePath}.rules`, code: "not-an-object", message: "Rules must be an object keyed by rule name." });
  }
  const axiom = grammar["axiom"];
  if (typeof axiom !== "string" || axiom === "") {
    issues.push({ path: `${basePath}.axiom`, code: "missing-field", message: "A grammar needs an axiom naming the rule to start from." });
  } else if (!ruleNames.has(axiom)) {
    issues.push({ path: `${basePath}.axiom`, code: "unknown-rule", message: `No rule named ${JSON.stringify(axiom)}. Rules: ${[...ruleNames].join(", ") || "none"}.` });
  }
  const scope = grammar["scope"];
  if (!isRecord(scope)) {
    issues.push({ path: `${basePath}.scope`, code: "missing-field", message: "A grammar needs a starting scope with a size." });
  } else {
    if (!isPositiveTuple(scope["size"])) issues.push({ path: `${basePath}.scope.size`, code: "invalid-vector", message: "A scope size is three positive finite numbers." });
    if (scope["position"] !== undefined && !isFiniteTuple(scope["position"])) {
      issues.push({ path: `${basePath}.scope.position`, code: "invalid-vector", message: "A scope position is three finite numbers." });
    }
  }
  const maxDepth = grammar["maxDepth"];
  if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || (maxDepth as number) < 1 || (maxDepth as number) > 256)) {
    issues.push({ path: `${basePath}.maxDepth`, code: "out-of-range", message: "maxDepth must be a whole number in [1, 256]." });
  }

  const successor = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (!ruleNames.has(value)) issues.push({ path, code: "unknown-rule", message: `No rule named ${JSON.stringify(value)}.` });
    } else {
      ops(value, path);
    }
  };
  const ops = (value: unknown, path: string): void => {
    if (!Array.isArray(value)) {
      issues.push({ path, code: "not-an-array", message: "A successor is a rule name or an array of ops." });
      return;
    }
    value.forEach((entry, index) => op(entry, `${path}[${String(index)}]`));
  };
  const op = (value: unknown, path: string): void => {
    if (!isRecord(value)) {
      issues.push({ path, code: "not-an-object", message: "An op must be an object." });
      return;
    }
    const kind = value["op"];
    if (typeof kind !== "string" || !(GRAMMAR_OPS as readonly string[]).includes(kind)) {
      issues.push({ path: `${path}.op`, code: "unknown-op", message: `Unknown op ${JSON.stringify(kind)}. Ops are ${GRAMMAR_OPS.join(", ")}.` });
      return;
    }
    const axis = (): void => {
      if (!["x", "y", "z"].includes(value["axis"] as string)) issues.push({ path: `${path}.axis`, code: "invalid-axis", message: "An axis is \"x\", \"y\" or \"z\"." });
    };
    switch (kind) {
      case "split": {
        axis();
        const parts = value["parts"];
        if (!Array.isArray(parts) || parts.length === 0) {
          issues.push({ path: `${path}.parts`, code: "missing-field", message: "A split needs at least one part." });
          break;
        }
        parts.forEach((part, index) => {
          const partPath = `${path}.parts[${String(index)}]`;
          if (!isRecord(part)) {
            issues.push({ path: partPath, code: "not-an-object", message: "A split part must be an object." });
            return;
          }
          const measures = (["size", "fraction", "fill"] as const).filter((field) => part[field] !== undefined);
          if (measures.length !== 1 || !(typeof part[measures[0]!] === "number" && (part[measures[0]!] as number) > 0 && Number.isFinite(part[measures[0]!]))) {
            issues.push({ path: partPath, code: "invalid-part", message: "A split part needs exactly one positive `size`, `fraction`, or `fill`." });
          }
          successor(part["then"], `${partPath}.then`);
        });
        break;
      }
      case "repeat":
        axis();
        if (!(typeof value["size"] === "number" && value["size"] > 0 && Number.isFinite(value["size"]))) {
          issues.push({ path: `${path}.size`, code: "out-of-range", message: "A repeat size must be a positive finite number." });
        }
        successor(value["then"], `${path}.then`);
        break;
      case "comp": {
        const faces = value["faces"];
        if (!isRecord(faces) || Object.keys(faces).length === 0) {
          issues.push({ path: `${path}.faces`, code: "missing-field", message: `A comp needs at least one face. Faces are ${FACES.join(", ")}, sides, all.` });
          break;
        }
        for (const [face, next] of Object.entries(faces)) {
          if (!(FACES as readonly string[]).includes(face) && face !== "sides" && face !== "all") {
            issues.push({ path: `${path}.faces.${face}`, code: "unknown-face", message: `Unknown face "${face}". Faces are ${FACES.join(", ")}, sides, all.` });
          } else {
            successor(next, `${path}.faces.${face}`);
          }
        }
        if (value["thickness"] !== undefined && !(typeof value["thickness"] === "number" && value["thickness"] > 0)) {
          issues.push({ path: `${path}.thickness`, code: "out-of-range", message: "A comp thickness must be positive." });
        }
        break;
      }
      case "scale":
        if (value["size"] === undefined && value["factor"] === undefined) {
          issues.push({ path, code: "missing-field", message: "A scale needs a `size` or a `factor`." });
        }
        if (value["size"] !== undefined && !isPositiveTuple(value["size"])) {
          issues.push({ path: `${path}.size`, code: "invalid-vector", message: "A scale size is three positive finite numbers." });
        }
        if (value["factor"] !== undefined && !(typeof value["factor"] === "number" ? value["factor"] > 0 : isPositiveTuple(value["factor"]))) {
          issues.push({ path: `${path}.factor`, code: "invalid-vector", message: "A scale factor is a positive number or three of them." });
        }
        break;
      case "translate":
        if (!isFiniteTuple(value["offset"])) issues.push({ path: `${path}.offset`, code: "invalid-vector", message: "A translate offset is three finite numbers." });
        break;
      case "offset":
        if (!Number.isFinite(value["distance"])) issues.push({ path: `${path}.distance`, code: "not-finite", message: "An offset distance must be a finite number." });
        if (value["axes"] !== undefined && (!Array.isArray(value["axes"]) || value["axes"].some((entry) => !["x", "y", "z"].includes(entry as string)))) {
          issues.push({ path: `${path}.axes`, code: "invalid-axis", message: "Offset axes are a list of \"x\", \"y\", \"z\"." });
        }
        break;
      case "choose": {
        const options = value["options"];
        if (!Array.isArray(options) || options.length === 0) {
          issues.push({ path: `${path}.options`, code: "missing-field", message: "A choose needs at least one option." });
          break;
        }
        options.forEach((option, index) => {
          const optionPath = `${path}.options[${String(index)}]`;
          if (!isRecord(option)) {
            issues.push({ path: optionPath, code: "not-an-object", message: "A choose option must be an object." });
            return;
          }
          if (option["weight"] !== undefined && !(typeof option["weight"] === "number" && option["weight"] >= 0 && Number.isFinite(option["weight"]))) {
            issues.push({ path: `${optionPath}.weight`, code: "out-of-range", message: "An option weight must be a non-negative finite number." });
          }
          successor(option["then"], `${optionPath}.then`);
        });
        break;
      }
      case "insert":
        if (!(GRAMMAR_PRIMITIVES as readonly string[]).includes(value["primitive"] as string)) {
          issues.push({ path: `${path}.primitive`, code: "unknown-kind", message: `Primitives are ${GRAMMAR_PRIMITIVES.join(", ")}.` });
        }
        if (value["slot"] !== undefined && !(Number.isInteger(value["slot"]) && (value["slot"] as number) >= 0)) {
          issues.push({ path: `${path}.slot`, code: "out-of-range", message: "A material slot is a non-negative whole number." });
        }
        break;
      case "ref": {
        const component = value["component"];
        if (typeof component !== "string" || component === "") {
          issues.push({ path: `${path}.component`, code: "invalid-ref", message: "A ref needs the name of a component." });
        } else if (componentNames !== undefined && !componentNames.has(component)) {
          issues.push({ path: `${path}.component`, code: "unknown-component", message: `No component named ${JSON.stringify(component)}.` });
        }
        break;
      }
    }
  };
  if (isRecord(rules)) {
    for (const [name, body] of Object.entries(rules)) ops(body, `${basePath}.rules.${name}`);
  }
  return issues;
}

function isFiniteTuple(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isPositiveTuple(value: unknown): value is readonly [number, number, number] {
  return isFiniteTuple(value) && value.every((entry) => entry > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
