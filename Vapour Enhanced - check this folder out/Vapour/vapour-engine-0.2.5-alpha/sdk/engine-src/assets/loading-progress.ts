export type LoadingTaskState = "pending" | "running" | "complete" | "failed" | "cancelled";
export type LoadingSessionState = "idle" | "running" | "complete" | "failed" | "cancelled";

export interface LoadingTaskDefinition {
  readonly id: string;
  readonly label: string;
  readonly weight?: number;
  readonly parent?: string;
}

export interface LoadingTaskSnapshot {
  readonly id: string;
  readonly label: string;
  readonly parent?: string;
  readonly weight: number;
  readonly progress: number;
  readonly state: LoadingTaskState;
  readonly detail?: string;
  readonly error?: unknown;
}

export interface LoadingSnapshot {
  readonly state: LoadingSessionState;
  readonly progress: number;
  readonly activeTask?: LoadingTaskSnapshot;
  readonly tasks: readonly LoadingTaskSnapshot[];
  readonly error?: unknown;
}

export interface LoadingTaskContext {
  readonly signal: AbortSignal;
  report(progress: number, detail?: string): void;
}

interface MutableTask {
  readonly id: string;
  readonly parent: string | undefined;
  readonly weight: number;
  readonly children: MutableTask[];
  label: string;
  progress: number;
  state: LoadingTaskState;
  detail: string | undefined;
  error: unknown;
}

/** Tracks a real loading operation without coupling it to a particular UI.
 * Tasks may be nested; a parent's progress is the weighted aggregate of its
 * children and root task weights determine overall session progress. */
export class LoadingSession {
  readonly #tasks = new Map<string, MutableTask>();
  readonly #ordered: MutableTask[] = [];
  readonly #roots: MutableTask[] = [];
  readonly #listeners = new Set<(snapshot: LoadingSnapshot) => void>();
  #abort = new AbortController();
  #state: LoadingSessionState = "idle";
  #error?: unknown;

  constructor(definitions: readonly LoadingTaskDefinition[]) {
    if (definitions.length === 0) throw new Error("A loading session requires at least one task.");
    for (const definition of definitions) {
      const id = definition.id.trim();
      const label = definition.label.trim();
      if (!id || !label) throw new Error("Loading task IDs and labels must not be empty.");
      if (this.#tasks.has(id)) throw new Error(`Loading task ID '${id}' is not unique.`);
      const weight = definition.weight ?? 1;
      if (!Number.isFinite(weight) || weight <= 0) throw new Error(`Loading task '${id}' must have a positive weight.`);
      const task: MutableTask = { id, label, parent: definition.parent, weight, children: [], progress: 0, state: "pending", detail: undefined, error: undefined };
      this.#tasks.set(id, task);
      this.#ordered.push(task);
    }
    for (const task of this.#ordered) {
      if (!task.parent) {
        this.#roots.push(task);
        continue;
      }
      const parent = this.#tasks.get(task.parent);
      if (!parent) throw new Error(`Loading task '${task.id}' references missing parent '${task.parent}'.`);
      parent.children.push(task);
    }
    if (this.#roots.length === 0) throw new Error("Loading task hierarchy contains a cycle.");
    this.#assertAcyclic();
  }

  get signal(): AbortSignal { return this.#abort.signal; }
  get state(): LoadingSessionState { return this.#state; }
  get progress(): number { return this.#aggregate(this.#roots); }

  subscribe(listener: (snapshot: LoadingSnapshot) => void, emitImmediately = true): () => void {
    this.#listeners.add(listener);
    if (emitImmediately) listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  start(id: string, detail?: string): void {
    this.#ensureMutable();
    const task = this.#leaf(id);
    if (task.state === "complete") throw new Error(`Loading task '${id}' is already complete.`);
    task.state = "running";
    task.detail = detail;
    this.#state = "running";
    this.#emit();
  }

  report(id: string, progress: number, detail?: string): void {
    this.#ensureMutable();
    const task = this.#leaf(id);
    if (!Number.isFinite(progress)) throw new Error(`Loading task '${id}' progress must be finite.`);
    const next = Math.max(0, Math.min(1, progress));
    if (next < task.progress) throw new Error(`Loading task '${id}' progress cannot move backwards.`);
    task.progress = next;
    task.state = next === 1 ? "complete" : "running";
    if (detail !== undefined) task.detail = detail;
    this.#state = "running";
    this.#finishIfComplete();
    this.#emit();
  }

  complete(id: string, detail?: string): void { this.report(id, 1, detail); }

  fail(id: string, error: unknown): void {
    this.#ensureMutable();
    const task = this.#leaf(id);
    task.state = "failed";
    task.error = error;
    this.#state = "failed";
    this.#error = error;
    this.#abort.abort(error);
    this.#emit();
  }

  /** Fails the most recently active leaf, or the first pending leaf when work
   * throws before a task was explicitly started. Useful at orchestration
   * boundaries that should not need to duplicate the current task ID. */
  failActive(error: unknown): void {
    const task = [...this.#ordered].reverse().find((candidate) => candidate.children.length === 0 && candidate.state === "running")
      ?? this.#ordered.find((candidate) => candidate.children.length === 0 && candidate.state === "pending");
    if (!task) throw new Error("Loading session has no active or pending task to fail.");
    this.fail(task.id, error);
  }

  cancel(reason: unknown = new Error("Loading cancelled.")): void {
    if (this.#state === "complete" || this.#state === "failed" || this.#state === "cancelled") return;
    this.#state = "cancelled";
    this.#error = reason;
    for (const task of this.#ordered) {
      if (task.state === "pending" || task.state === "running") task.state = "cancelled";
    }
    this.#abort.abort(reason);
    this.#emit();
  }

  async run<T>(id: string, operation: (context: LoadingTaskContext) => T | Promise<T>): Promise<T> {
    this.start(id);
    try {
      const result = await operation({ signal: this.signal, report: (progress, detail) => this.report(id, progress, detail) });
      if (this.signal.aborted) throw this.signal.reason;
      this.complete(id);
      return result;
    } catch (error) {
      if (this.#state !== "cancelled" && this.#state !== "failed") this.fail(id, error);
      throw error;
    }
  }

  snapshot(): LoadingSnapshot {
    const tasks = this.#ordered.map((task) => this.#snapshotTask(task));
    const activeTask = [...tasks].reverse().find((task) => task.state === "running");
    return Object.freeze({
      state: this.#state,
      progress: this.progress,
      tasks: Object.freeze(tasks),
      ...(activeTask ? { activeTask } : {}),
      ...(this.#error !== undefined ? { error: this.#error } : {}),
    });
  }

  #leaf(id: string): MutableTask {
    const task = this.#tasks.get(id);
    if (!task) throw new Error(`Unknown loading task '${id}'.`);
    if (task.children.length > 0) throw new Error(`Loading task '${id}' is a group; update one of its child tasks.`);
    return task;
  }

  #ensureMutable(): void {
    if (this.#state === "complete" || this.#state === "failed" || this.#state === "cancelled") {
      throw new Error(`Loading session is already ${this.#state}.`);
    }
  }

  #taskProgress(task: MutableTask): number {
    return task.children.length > 0 ? this.#aggregate(task.children) : task.progress;
  }

  #aggregate(tasks: readonly MutableTask[]): number {
    const total = tasks.reduce((sum, task) => sum + task.weight, 0);
    return total === 0 ? 0 : tasks.reduce((sum, task) => sum + this.#taskProgress(task) * task.weight, 0) / total;
  }

  #taskState(task: MutableTask): LoadingTaskState {
    if (task.children.length === 0) return task.state;
    if (task.children.some((child) => this.#taskState(child) === "failed")) return "failed";
    if (task.children.some((child) => this.#taskState(child) === "running")) return "running";
    if (task.children.every((child) => this.#taskState(child) === "complete")) return "complete";
    if (task.children.every((child) => ["complete", "cancelled"].includes(this.#taskState(child)))) return "cancelled";
    return "pending";
  }

  #snapshotTask(task: MutableTask): LoadingTaskSnapshot {
    return Object.freeze({
      id: task.id,
      label: task.label,
      weight: task.weight,
      progress: this.#taskProgress(task),
      state: this.#taskState(task),
      ...(task.parent ? { parent: task.parent } : {}),
      ...(task.detail !== undefined ? { detail: task.detail } : {}),
      ...(task.error !== undefined ? { error: task.error } : {}),
    });
  }

  #finishIfComplete(): void {
    if (this.#roots.every((task) => this.#taskProgress(task) === 1)) this.#state = "complete";
  }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }

  #assertAcyclic(): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (task: MutableTask): void => {
      if (visiting.has(task.id)) throw new Error("Loading task hierarchy contains a cycle.");
      if (visited.has(task.id)) return;
      visiting.add(task.id);
      for (const child of task.children) visit(child);
      visiting.delete(task.id);
      visited.add(task.id);
    };
    for (const task of this.#ordered) visit(task);
  }
}
