/** Deterministic gameplay state machine. Transitions requested during update
 * are applied atomically after the state's update callback returns. */
export class StateMachine {
    #states;
    #current;
    #started = false;
    #transitionCount = 0;
    constructor(initial, states) {
        const entries = Object.entries(states);
        if (entries.length === 0)
            throw new Error("An AI state machine requires at least one state.");
        this.#states = new Map(entries);
        this.#require(initial);
        this.#current = initial;
    }
    get state() { return this.#current; }
    get started() { return this.#started; }
    get transitionCount() { return this.#transitionCount; }
    start(context) {
        if (this.#started)
            throw new Error(`AI state machine is already running in state '${this.#current}'.`);
        this.#started = true;
        this.#require(this.#current).enter?.(context, undefined);
    }
    update(context, deltaSeconds) {
        requireDelta(deltaSeconds);
        if (!this.#started)
            this.start(context);
        const next = this.#require(this.#current).update(context, deltaSeconds);
        if (next !== undefined && next !== this.#current)
            this.transition(next, context);
    }
    transition(next, context) {
        if (!this.#started)
            throw new Error("AI state machine must be started before an explicit transition.");
        const target = this.#require(next);
        if (next === this.#current)
            return;
        const previous = this.#current;
        this.#require(previous).exit?.(context, next);
        this.#current = next;
        this.#transitionCount += 1;
        target.enter?.(context, previous);
    }
    reset(initial, context) {
        this.#require(initial);
        if (this.#started && context === undefined)
            throw new Error("Resetting a running AI state machine requires its context so exit hooks can run.");
        if (this.#started)
            this.#require(this.#current).exit?.(context, initial);
        const previous = this.#current;
        this.#current = initial;
        this.#started = false;
        this.#transitionCount = 0;
        if (context !== undefined) {
            this.#started = true;
            this.#require(initial).enter?.(context, previous);
        }
    }
    #require(id) {
        const state = this.#states.get(id);
        if (state === undefined)
            throw new Error(`Unknown AI state '${id}'. Available states: ${[...this.#states.keys()].join(", ")}.`);
        return state;
    }
}
/** Resumable behavior-tree runner. Running sequence/selector cursors, repeat
 * counts, and cooldowns live in the runner rather than mutable node assets, so
 * one immutable tree definition can be shared by thousands of agents. */
export class BehaviorTree {
    #root;
    #memory = new Map();
    constructor(root) { validateNode(root, new Set(), new Set()); this.#root = root; }
    tick(context, deltaSeconds) {
        requireDelta(deltaSeconds);
        return this.#run(this.#root, context, deltaSeconds);
    }
    reset() { this.#memory.clear(); }
    resetNode(id) { this.#memory.delete(id); }
    #run(node, context, delta) {
        if (node.type === "action")
            return requireStatus(node.id, node.run(context, delta));
        if (node.type === "condition")
            return node.test(context) ? "success" : "failure";
        if (node.type === "inverter") {
            const result = this.#run(node.child, context, delta);
            return result === "success" ? "failure" : result === "failure" ? "success" : "running";
        }
        const memory = this.#memory.get(node.id) ?? {};
        this.#memory.set(node.id, memory);
        if (node.type === "cooldown") {
            memory.remaining = Math.max(0, (memory.remaining ?? 0) - delta);
            if (memory.remaining > 0)
                return "failure";
            const result = this.#run(node.child, context, delta);
            if (result === "success")
                memory.remaining = node.seconds;
            return result;
        }
        if (node.type === "repeat") {
            const result = this.#run(node.child, context, delta);
            if (result === "running")
                return result;
            if (result === "failure") {
                memory.completed = 0;
                return result;
            }
            memory.completed = (memory.completed ?? 0) + 1;
            this.#clearBranch(node.child);
            if (node.count === undefined || memory.completed < node.count)
                return "running";
            memory.completed = 0;
            return "success";
        }
        let cursor = memory.cursor ?? 0;
        while (cursor < node.children.length) {
            const result = this.#run(node.children[cursor], context, delta);
            if (result === "running") {
                memory.cursor = cursor;
                return result;
            }
            const continues = node.type === "sequence" ? result === "success" : result === "failure";
            if (!continues) {
                memory.cursor = 0;
                this.#clearChildren(node);
                return result;
            }
            cursor += 1;
        }
        memory.cursor = 0;
        this.#clearChildren(node);
        return node.type === "sequence" ? "success" : "failure";
    }
    #clearChildren(node) {
        for (const child of node.children)
            this.#clearBranch(child);
    }
    #clearBranch(node) {
        // Cooldowns are durable agent state. A parent completing or selecting a
        // fallback resets traversal cursors, but must not make rate-limited actions
        // immediately eligible again.
        if (node.type !== "cooldown")
            this.#memory.delete(node.id);
        if (node.type === "sequence" || node.type === "selector")
            for (const child of node.children)
                this.#clearBranch(child);
        else if (node.type === "inverter" || node.type === "repeat" || node.type === "cooldown")
            this.#clearBranch(node.child);
    }
}
/** Writes a velocity that seeks a target without allocating a vector. */
export function steerSeek(out, position, target, maxSpeed) {
    requireNonNegative(maxSpeed, "Steering max speed");
    const x = target.x - position.x, y = target.y - position.y, z = target.z - position.z;
    const length = Math.hypot(x, y, z);
    if (length <= Number.EPSILON)
        return setVector(out, 0, 0, 0);
    const scale = maxSpeed / length;
    return setVector(out, x * scale, y * scale, z * scale);
}
/** Seek with linear deceleration inside slowRadius and a full stop inside
 * stopRadius. Useful for characters, flying agents, and camera followers. */
export function steerArrive(out, position, target, maxSpeed, slowRadius, stopRadius = 0) {
    requireNonNegative(maxSpeed, "Steering max speed");
    requirePositive(slowRadius, "Arrival slow radius");
    requireNonNegative(stopRadius, "Arrival stop radius");
    if (stopRadius > slowRadius)
        throw new Error("Arrival stop radius cannot exceed its slow radius.");
    const x = target.x - position.x, y = target.y - position.y, z = target.z - position.z;
    const distance = Math.hypot(x, y, z);
    if (distance <= stopRadius || distance <= Number.EPSILON)
        return setVector(out, 0, 0, 0);
    const speed = maxSpeed * Math.min(1, (distance - stopRadius) / (slowRadius - stopRadius || 1));
    return setVector(out, x / distance * speed, y / distance * speed, z / distance * speed);
}
/** Accumulates inverse-distance separation from nearby positions. */
export function steerSeparation(out, position, neighbours, radius, maxSpeed) {
    requirePositive(radius, "Separation radius");
    requireNonNegative(maxSpeed, "Steering max speed");
    let x = 0, y = 0, z = 0;
    for (const neighbour of neighbours) {
        const dx = position.x - neighbour.x, dy = position.y - neighbour.y, dz = position.z - neighbour.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance > Number.EPSILON && distance < radius) {
            const weight = 1 - distance / radius;
            x += dx / distance * weight;
            y += dy / distance * weight;
            z += dz / distance * weight;
        }
    }
    const length = Math.hypot(x, y, z);
    return length <= Number.EPSILON ? setVector(out, 0, 0, 0) : setVector(out, x / length * maxSpeed, y / length * maxSpeed, z / length * maxSpeed);
}
function validateNode(node, ids, ancestors) {
    if (node.id.trim() === "")
        throw new Error("Behavior tree node IDs cannot be empty.");
    if (ids.has(node.id))
        throw new Error(`Behavior tree contains duplicate node ID '${node.id}'.`);
    if (ancestors.has(node))
        throw new Error(`Behavior tree contains a cycle at '${node.id}'.`);
    ids.add(node.id);
    ancestors.add(node);
    if ((node.type === "sequence" || node.type === "selector") && node.children.length === 0)
        throw new Error(`Behavior ${node.type} '${node.id}' requires at least one child.`);
    if (node.type === "sequence" || node.type === "selector")
        for (const child of node.children)
            validateNode(child, ids, ancestors);
    else if (node.type === "inverter" || node.type === "repeat" || node.type === "cooldown")
        validateNode(node.child, ids, ancestors);
    if (node.type === "repeat" && node.count !== undefined && (!Number.isInteger(node.count) || node.count <= 0))
        throw new Error(`Behavior repeat '${node.id}' count must be a positive integer.`);
    if (node.type === "cooldown")
        requireNonNegative(node.seconds, `Behavior cooldown '${node.id}' duration`);
    ancestors.delete(node);
}
function requireStatus(id, status) { if (status !== "running" && status !== "success" && status !== "failure")
    throw new Error(`Behavior action '${id}' returned invalid status '${String(status)}'.`); return status; }
function requireDelta(value) { requireNonNegative(value, "AI delta time"); }
function requireNonNegative(value, label) { if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be finite and non-negative.`); }
function requirePositive(value, label) { if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be finite and positive.`); }
function setVector(out, x, y, z) { out.x = x; out.y = y; out.z = z; return out; }
//# sourceMappingURL=ai.js.map