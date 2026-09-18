/** Tracks a real loading operation without coupling it to a particular UI.
 * Tasks may be nested; a parent's progress is the weighted aggregate of its
 * children and root task weights determine overall session progress. */
export class LoadingSession {
    #tasks = new Map();
    #ordered = [];
    #roots = [];
    #listeners = new Set();
    #abort = new AbortController();
    #state = "idle";
    #error;
    constructor(definitions) {
        if (definitions.length === 0)
            throw new Error("A loading session requires at least one task.");
        for (const definition of definitions) {
            const id = definition.id.trim();
            const label = definition.label.trim();
            if (!id || !label)
                throw new Error("Loading task IDs and labels must not be empty.");
            if (this.#tasks.has(id))
                throw new Error(`Loading task ID '${id}' is not unique.`);
            const weight = definition.weight ?? 1;
            if (!Number.isFinite(weight) || weight <= 0)
                throw new Error(`Loading task '${id}' must have a positive weight.`);
            const task = { id, label, parent: definition.parent, weight, children: [], progress: 0, state: "pending", detail: undefined, error: undefined };
            this.#tasks.set(id, task);
            this.#ordered.push(task);
        }
        for (const task of this.#ordered) {
            if (!task.parent) {
                this.#roots.push(task);
                continue;
            }
            const parent = this.#tasks.get(task.parent);
            if (!parent)
                throw new Error(`Loading task '${task.id}' references missing parent '${task.parent}'.`);
            parent.children.push(task);
        }
        if (this.#roots.length === 0)
            throw new Error("Loading task hierarchy contains a cycle.");
        this.#assertAcyclic();
    }
    get signal() { return this.#abort.signal; }
    get state() { return this.#state; }
    get progress() { return this.#aggregate(this.#roots); }
    subscribe(listener, emitImmediately = true) {
        this.#listeners.add(listener);
        if (emitImmediately)
            listener(this.snapshot());
        return () => this.#listeners.delete(listener);
    }
    start(id, detail) {
        this.#ensureMutable();
        const task = this.#leaf(id);
        if (task.state === "complete")
            throw new Error(`Loading task '${id}' is already complete.`);
        task.state = "running";
        task.detail = detail;
        this.#state = "running";
        this.#emit();
    }
    report(id, progress, detail) {
        this.#ensureMutable();
        const task = this.#leaf(id);
        if (!Number.isFinite(progress))
            throw new Error(`Loading task '${id}' progress must be finite.`);
        const next = Math.max(0, Math.min(1, progress));
        if (next < task.progress)
            throw new Error(`Loading task '${id}' progress cannot move backwards.`);
        task.progress = next;
        task.state = next === 1 ? "complete" : "running";
        if (detail !== undefined)
            task.detail = detail;
        this.#state = "running";
        this.#finishIfComplete();
        this.#emit();
    }
    complete(id, detail) { this.report(id, 1, detail); }
    fail(id, error) {
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
    failActive(error) {
        const task = [...this.#ordered].reverse().find((candidate) => candidate.children.length === 0 && candidate.state === "running")
            ?? this.#ordered.find((candidate) => candidate.children.length === 0 && candidate.state === "pending");
        if (!task)
            throw new Error("Loading session has no active or pending task to fail.");
        this.fail(task.id, error);
    }
    cancel(reason = new Error("Loading cancelled.")) {
        if (this.#state === "complete" || this.#state === "failed" || this.#state === "cancelled")
            return;
        this.#state = "cancelled";
        this.#error = reason;
        for (const task of this.#ordered) {
            if (task.state === "pending" || task.state === "running")
                task.state = "cancelled";
        }
        this.#abort.abort(reason);
        this.#emit();
    }
    async run(id, operation) {
        this.start(id);
        try {
            const result = await operation({ signal: this.signal, report: (progress, detail) => this.report(id, progress, detail) });
            if (this.signal.aborted)
                throw this.signal.reason;
            this.complete(id);
            return result;
        }
        catch (error) {
            if (this.#state !== "cancelled" && this.#state !== "failed")
                this.fail(id, error);
            throw error;
        }
    }
    snapshot() {
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
    #leaf(id) {
        const task = this.#tasks.get(id);
        if (!task)
            throw new Error(`Unknown loading task '${id}'.`);
        if (task.children.length > 0)
            throw new Error(`Loading task '${id}' is a group; update one of its child tasks.`);
        return task;
    }
    #ensureMutable() {
        if (this.#state === "complete" || this.#state === "failed" || this.#state === "cancelled") {
            throw new Error(`Loading session is already ${this.#state}.`);
        }
    }
    #taskProgress(task) {
        return task.children.length > 0 ? this.#aggregate(task.children) : task.progress;
    }
    #aggregate(tasks) {
        const total = tasks.reduce((sum, task) => sum + task.weight, 0);
        return total === 0 ? 0 : tasks.reduce((sum, task) => sum + this.#taskProgress(task) * task.weight, 0) / total;
    }
    #taskState(task) {
        if (task.children.length === 0)
            return task.state;
        if (task.children.some((child) => this.#taskState(child) === "failed"))
            return "failed";
        if (task.children.some((child) => this.#taskState(child) === "running"))
            return "running";
        if (task.children.every((child) => this.#taskState(child) === "complete"))
            return "complete";
        if (task.children.every((child) => ["complete", "cancelled"].includes(this.#taskState(child))))
            return "cancelled";
        return "pending";
    }
    #snapshotTask(task) {
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
    #finishIfComplete() {
        if (this.#roots.every((task) => this.#taskProgress(task) === 1))
            this.#state = "complete";
    }
    #emit() {
        const snapshot = this.snapshot();
        for (const listener of this.#listeners)
            listener(snapshot);
    }
    #assertAcyclic() {
        const visited = new Set();
        const visiting = new Set();
        const visit = (task) => {
            if (visiting.has(task.id))
                throw new Error("Loading task hierarchy contains a cycle.");
            if (visited.has(task.id))
                return;
            visiting.add(task.id);
            for (const child of task.children)
                visit(child);
            visiting.delete(task.id);
            visited.add(task.id);
        };
        for (const task of this.#ordered)
            visit(task);
    }
}
//# sourceMappingURL=loading-progress.js.map