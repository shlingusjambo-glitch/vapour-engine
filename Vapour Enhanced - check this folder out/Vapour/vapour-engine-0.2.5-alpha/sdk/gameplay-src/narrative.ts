export type NarrativeValue = string | number | boolean | null;

export type NarrativeCondition =
  | { readonly variable: string; readonly operator: "equals" | "not-equals" | "greater" | "greater-or-equal" | "less" | "less-or-equal"; readonly value: NarrativeValue }
  | { readonly all: readonly NarrativeCondition[] }
  | { readonly any: readonly NarrativeCondition[] }
  | { readonly not: NarrativeCondition };

export interface LocalizedText {
  readonly text: string;
  readonly key?: string;
}

export type NarrativeNode =
  | { readonly id: string; readonly type: "line"; readonly speaker?: string; readonly portrait?: string; readonly text: LocalizedText; readonly next?: string }
  | { readonly id: string; readonly type: "choice"; readonly prompt?: LocalizedText; readonly options: readonly { readonly id: string; readonly text: LocalizedText; readonly next: string; readonly when?: NarrativeCondition }[] }
  | { readonly id: string; readonly type: "set"; readonly variable: string; readonly value: NarrativeValue; readonly next: string }
  | { readonly id: string; readonly type: "branch"; readonly condition: NarrativeCondition; readonly then: string; readonly otherwise: string }
  | { readonly id: string; readonly type: "jump"; readonly next: string }
  | { readonly id: string; readonly type: "command"; readonly command: string; readonly arguments?: Readonly<Record<string, NarrativeValue>>; readonly next?: string }
  | { readonly id: string; readonly type: "end"; readonly ending?: string };

export interface NarrativeProgram {
  readonly id: string;
  readonly version: number;
  readonly start: string;
  readonly nodes: readonly NarrativeNode[];
}

export interface NarrativeLineView {
  readonly type: "line";
  readonly nodeId: string;
  readonly speaker?: string;
  readonly portrait?: string;
  readonly text: string;
}
export interface NarrativeChoiceView {
  readonly type: "choice";
  readonly nodeId: string;
  readonly prompt?: string;
  readonly options: readonly { readonly id: string; readonly text: string }[];
}
export interface NarrativeCommandView {
  readonly type: "command";
  readonly nodeId: string;
  readonly command: string;
  readonly arguments: Readonly<Record<string, NarrativeValue>>;
}
export interface NarrativeEndView { readonly type: "end"; readonly nodeId: string; readonly ending?: string }
export type NarrativeView = NarrativeLineView | NarrativeChoiceView | NarrativeCommandView | NarrativeEndView;

export interface NarrativeSnapshot {
  readonly formatVersion: 1;
  readonly programId: string;
  readonly programVersion: number;
  readonly nodeId: string;
  readonly variables: Readonly<Record<string, NarrativeValue>>;
  readonly history: readonly { readonly nodeId: string; readonly variables: Readonly<Record<string, NarrativeValue>> }[];
}

export interface NarrativeRunnerOptions {
  readonly variables?: Readonly<Record<string, NarrativeValue>>;
  readonly localize?: (key: string, fallback: string, variables: Readonly<Record<string, NarrativeValue>>) => string;
  readonly historyLimit?: number;
}

/** Deterministic visual-novel/dialogue state machine. Programs and snapshots
 * are plain JSON; rendering, audio, and character animation consume views. */
export class NarrativeRunner {
  readonly #program: NarrativeProgram;
  readonly #nodes: ReadonlyMap<string, NarrativeNode>;
  readonly #variables = new Map<string, NarrativeValue>();
  readonly #localize: NonNullable<NarrativeRunnerOptions["localize"]>;
  readonly #history: Array<{ nodeId: string; variables: Record<string, NarrativeValue> }> = [];
  readonly #historyLimit: number;
  #nodeId: string;
  #view: NarrativeView;

  constructor(program: NarrativeProgram, options: NarrativeRunnerOptions = {}) {
    validateNarrativeProgram(program);
    this.#program = structuredClone(program);
    this.#nodes = new Map(this.#program.nodes.map((node) => [node.id, node]));
    for (const [key, value] of Object.entries(options.variables ?? {})) this.#variables.set(validVariable(key), value);
    this.#localize = options.localize ?? ((_key, fallback) => fallback);
    this.#historyLimit = nonnegativeInteger(options.historyLimit ?? 100, "Narrative history limit");
    this.#nodeId = program.start;
    this.#view = this.#resolve();
  }

  get view(): NarrativeView { return structuredClone(this.#view); }
  get variables(): Readonly<Record<string, NarrativeValue>> { return Object.freeze(Object.fromEntries(this.#variables)); }
  get canRollback(): boolean { return this.#history.length > 0; }

  getVariable(name: string): NarrativeValue | undefined { return this.#variables.get(name); }
  setVariable(name: string, value: NarrativeValue): void { this.#variables.set(validVariable(name), value); this.#view = this.#resolve(false); }

  advance(): NarrativeView {
    if (this.#view.type === "choice") throw new Error(`Narrative node '${this.#nodeId}' requires choose(optionId), not advance().`);
    if (this.#view.type === "end") return this.view;
    this.#remember();
    const node = this.#requireNode(this.#nodeId);
    const next = node.type === "line" || node.type === "command" ? node.next : undefined;
    if (!next) {
      this.#view = { type: "end", nodeId: this.#nodeId };
      return this.view;
    }
    this.#nodeId = next;
    this.#view = this.#resolve();
    return this.view;
  }

  choose(optionId: string): NarrativeView {
    if (this.#view.type !== "choice") throw new Error(`Narrative node '${this.#nodeId}' is not a choice.`);
    const node = this.#requireNode(this.#nodeId);
    if (node.type !== "choice") throw new Error("Narrative view and node are inconsistent.");
    const visible = node.options.filter((option) => option.when === undefined || evaluateNarrativeCondition(option.when, this.#variables));
    const option = visible.find((candidate) => candidate.id === optionId);
    if (!option) throw new Error(`Choice '${optionId}' is not available at narrative node '${node.id}'. Available choices: ${visible.map((item) => item.id).join(", ") || "none"}.`);
    this.#remember();
    this.#nodeId = option.next;
    this.#view = this.#resolve();
    return this.view;
  }

  rollback(): NarrativeView {
    const previous = this.#history.pop();
    if (!previous) throw new Error("Narrative history is empty; rollback is unavailable.");
    this.#variables.clear();
    for (const [key, value] of Object.entries(previous.variables)) this.#variables.set(key, value);
    this.#nodeId = previous.nodeId;
    this.#view = this.#resolve(false);
    return this.view;
  }

  snapshot(): NarrativeSnapshot {
    return structuredClone({ formatVersion: 1 as const, programId: this.#program.id, programVersion: this.#program.version, nodeId: this.#nodeId, variables: Object.fromEntries(this.#variables), history: this.#history });
  }

  restore(snapshot: NarrativeSnapshot): NarrativeView {
    if (snapshot.formatVersion !== 1) throw new Error(`Unsupported narrative save format ${String(snapshot.formatVersion)}.`);
    if (snapshot.programId !== this.#program.id || snapshot.programVersion !== this.#program.version) {
      throw new Error(`Narrative save targets '${snapshot.programId}' v${snapshot.programVersion}, but the loaded program is '${this.#program.id}' v${this.#program.version}. A migration is required.`);
    }
    this.#requireNode(snapshot.nodeId);
    this.#variables.clear();
    for (const [key, value] of Object.entries(snapshot.variables)) this.#variables.set(validVariable(key), value);
    this.#history.length = 0;
    for (const entry of snapshot.history.slice(-this.#historyLimit)) {
      this.#requireNode(entry.nodeId);
      this.#history.push({ nodeId: entry.nodeId, variables: { ...entry.variables } });
    }
    this.#nodeId = snapshot.nodeId;
    this.#view = this.#resolve(false);
    return this.view;
  }

  #resolve(allowMutations = true): NarrativeView {
    const visited = new Set<string>();
    while (true) {
      if (visited.has(this.#nodeId)) throw new Error(`Narrative control flow loops without presenting content at node '${this.#nodeId}'.`);
      visited.add(this.#nodeId);
      const node = this.#requireNode(this.#nodeId);
      if (node.type === "set") {
        if (allowMutations) this.#variables.set(node.variable, node.value);
        this.#nodeId = node.next;
        continue;
      }
      if (node.type === "branch") { this.#nodeId = evaluateNarrativeCondition(node.condition, this.#variables) ? node.then : node.otherwise; continue; }
      if (node.type === "jump") { this.#nodeId = node.next; continue; }
      if (node.type === "line") return Object.freeze({ type: "line", nodeId: node.id, ...(node.speaker ? { speaker: node.speaker } : {}), ...(node.portrait ? { portrait: node.portrait } : {}), text: this.#text(node.text) });
      if (node.type === "command") return Object.freeze({ type: "command", nodeId: node.id, command: node.command, arguments: Object.freeze({ ...(node.arguments ?? {}) }) });
      if (node.type === "end") return Object.freeze({ type: "end", nodeId: node.id, ...(node.ending ? { ending: node.ending } : {}) });
      const options = node.options.filter((option) => option.when === undefined || evaluateNarrativeCondition(option.when, this.#variables)).map((option) => Object.freeze({ id: option.id, text: this.#text(option.text) }));
      if (options.length === 0) throw new Error(`Narrative choice node '${node.id}' has no currently available options.`);
      return Object.freeze({ type: "choice", nodeId: node.id, ...(node.prompt ? { prompt: this.#text(node.prompt) } : {}), options: Object.freeze(options) });
    }
  }

  #text(value: LocalizedText): string {
    const template = value.key ? this.#localize(value.key, value.text, this.variables) : value.text;
    return template.replace(/\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g, (_match, key: string) => String(this.#variables.get(key) ?? `{${key}}`));
  }

  #remember(): void {
    if (this.#historyLimit === 0) return;
    this.#history.push({ nodeId: this.#nodeId, variables: Object.fromEntries(this.#variables) });
    if (this.#history.length > this.#historyLimit) this.#history.shift();
  }

  #requireNode(id: string): NarrativeNode {
    const node = this.#nodes.get(id);
    if (!node) throw new Error(`Narrative program '${this.#program.id}' references missing node '${id}'.`);
    return node;
  }
}

export class TypewriterText {
  readonly #graphemes: readonly string[];
  readonly #charactersPerSecond: number;
  #visible = 0;
  #fraction = 0;

  constructor(text: string, charactersPerSecond = 30, locale?: string) {
    this.#charactersPerSecond = positive(charactersPerSecond, "Typewriter charactersPerSecond");
    const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
    this.#graphemes = Object.freeze(Segmenter ? [...new Segmenter(locale, { granularity: "grapheme" }).segment(text)].map((part) => part.segment) : Array.from(text));
  }
  get text(): string { return this.#graphemes.slice(0, this.#visible).join(""); }
  get complete(): boolean { return this.#visible === this.#graphemes.length; }
  update(deltaSeconds: number): string {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("Typewriter delta must be finite and non-negative.");
    this.#fraction += deltaSeconds * this.#charactersPerSecond;
    const reveal = Math.floor(this.#fraction);
    this.#fraction -= reveal;
    this.#visible = Math.min(this.#graphemes.length, this.#visible + reveal);
    return this.text;
  }
  completeNow(): string { this.#visible = this.#graphemes.length; this.#fraction = 0; return this.text; }
}

export function evaluateNarrativeCondition(condition: NarrativeCondition, variables: ReadonlyMap<string, NarrativeValue>): boolean {
  if ("all" in condition) return condition.all.every((item) => evaluateNarrativeCondition(item, variables));
  if ("any" in condition) return condition.any.some((item) => evaluateNarrativeCondition(item, variables));
  if ("not" in condition) return !evaluateNarrativeCondition(condition.not, variables);
  const actual = variables.get(condition.variable) ?? null;
  switch (condition.operator) {
    case "equals": return actual === condition.value;
    case "not-equals": return actual !== condition.value;
    case "greater": return comparable(actual, condition.value, (a, b) => a > b);
    case "greater-or-equal": return comparable(actual, condition.value, (a, b) => a >= b);
    case "less": return comparable(actual, condition.value, (a, b) => a < b);
    case "less-or-equal": return comparable(actual, condition.value, (a, b) => a <= b);
  }
}

export function validateNarrativeProgram(program: NarrativeProgram): void {
  if (!program.id.trim()) throw new Error("Narrative program ID must not be empty.");
  if (!Number.isInteger(program.version) || program.version < 1) throw new Error(`Narrative program '${program.id}' version must be a positive integer.`);
  if (program.nodes.length === 0) throw new Error(`Narrative program '${program.id}' has no nodes.`);
  const ids = new Set<string>();
  for (const node of program.nodes) {
    if (!node.id.trim()) throw new Error(`Narrative program '${program.id}' has a node with an empty ID.`);
    if (ids.has(node.id)) throw new Error(`Narrative program '${program.id}' has duplicate node '${node.id}'.`);
    ids.add(node.id);
    if (node.type === "choice") {
      if (node.options.length === 0) throw new Error(`Narrative choice '${node.id}' has no options.`);
      const optionIds = new Set<string>();
      for (const option of node.options) {
        if (!option.id.trim() || optionIds.has(option.id)) throw new Error(`Narrative choice '${node.id}' has an empty or duplicate option ID '${option.id}'.`);
        optionIds.add(option.id);
      }
    }
    if (node.type === "set") validVariable(node.variable);
    if (node.type === "command" && !node.command.trim()) throw new Error(`Narrative command node '${node.id}' has an empty command.`);
  }
  const references: Array<[string, string]> = [["program start", program.start]];
  for (const node of program.nodes) {
    if ((node.type === "line" || node.type === "command") && node.next) references.push([node.id, node.next]);
    else if (node.type === "choice") for (const option of node.options) references.push([`${node.id}.${option.id}`, option.next]);
    else if (node.type === "set" || node.type === "jump") references.push([node.id, node.next]);
    else if (node.type === "branch") references.push([`${node.id}.then`, node.then], [`${node.id}.otherwise`, node.otherwise]);
  }
  for (const [source, target] of references) if (!ids.has(target)) throw new Error(`Narrative ${source} references missing node '${target}'.`);
}

function comparable(a: NarrativeValue, b: NarrativeValue, compare: (left: number | string, right: number | string) => boolean): boolean {
  if (typeof a === "number" && typeof b === "number") return compare(a, b);
  if (typeof a === "string" && typeof b === "string") return compare(a, b);
  return false;
}
function validVariable(name: string): string { if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) throw new Error(`Narrative variable '${name}' has an invalid name.`); return name; }
function positive(value: number, label: string): number { if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive.`); return value; }
function nonnegativeInteger(value: number, label: string): number { if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`); return value; }
