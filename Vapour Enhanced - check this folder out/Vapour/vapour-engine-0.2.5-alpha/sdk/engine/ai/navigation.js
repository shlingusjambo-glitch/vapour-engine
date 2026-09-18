/** Deterministic A* over a caller-defined graph. Nodes can be voxel cells,
 * tile coordinates, waypoints, or navmesh polygons. Search budgets turn an
 * expensive/unreachable query into an explicit result instead of a frame hang. */
export function findPath(start, goal, options) {
    const keyOf = options.key ?? navigationNodeKey;
    const heuristic = options.heuristic ?? euclideanDistance;
    const costOf = options.cost ?? euclideanDistance;
    const maxVisited = options.maxVisited ?? 10_000;
    if (!Number.isInteger(maxVisited) || maxVisited <= 0)
        throw new Error("Pathfinding maxVisited must be a positive integer.");
    requireNode(start, "start");
    requireNode(goal, "goal");
    const startKey = nonEmptyKey(keyOf(start));
    const goalKey = nonEmptyKey(keyOf(goal));
    if (options.traversable !== undefined && (!options.traversable(start) || !options.traversable(goal)))
        return frozenResult("unreachable", [], 0, Infinity);
    if (startKey === goalKey)
        return frozenResult("complete", [start], 0, 0);
    const open = new MinHeap();
    const scores = new Map([[startKey, 0]]);
    const previous = new Map();
    const nodes = new Map([[startKey, start]]);
    const closed = new Set();
    open.push({ node: start, key: startKey, priority: requireMetric(heuristic(start, goal), "Pathfinding heuristic") });
    let visited = 0;
    while (open.size > 0) {
        const current = open.pop();
        if (closed.has(current.key))
            continue;
        closed.add(current.key);
        visited += 1;
        if (current.key === goalKey)
            return frozenResult("complete", reconstruct(current.key, previous, nodes), visited, scores.get(current.key));
        if (visited >= maxVisited)
            return frozenResult("budget-exceeded", [], visited, Infinity);
        for (const neighbour of options.neighbours(current.node)) {
            requireNode(neighbour, `neighbour of '${current.key}'`);
            if (options.traversable !== undefined && !options.traversable(neighbour))
                continue;
            const neighbourKey = nonEmptyKey(keyOf(neighbour));
            if (closed.has(neighbourKey))
                continue;
            const step = requireMetric(costOf(current.node, neighbour), `Pathfinding edge cost '${current.key}' -> '${neighbourKey}'`);
            const tentative = scores.get(current.key) + step;
            if (tentative >= (scores.get(neighbourKey) ?? Infinity))
                continue;
            scores.set(neighbourKey, tentative);
            previous.set(neighbourKey, current.key);
            nodes.set(neighbourKey, neighbour);
            const estimate = requireMetric(heuristic(neighbour, goal), `Pathfinding heuristic for '${neighbourKey}'`);
            open.push({ node: neighbour, key: neighbourKey, priority: tentative + estimate });
        }
    }
    return frozenResult("unreachable", [], visited, Infinity);
}
/** Four-way XZ neighbours for tile and voxel walking. Y is preserved. */
export function gridNeighbours4(node) {
    return [{ x: node.x + 1, y: node.y, z: node.z }, { x: node.x - 1, y: node.y, z: node.z }, { x: node.x, y: node.y, z: node.z + 1 }, { x: node.x, y: node.y, z: node.z - 1 }];
}
export function navigationNodeKey(node) { return `${String(node.x)},${String(node.y)},${String(node.z)}`; }
export function euclideanDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
export function manhattanDistance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z); }
class MinHeap {
    #items = [];
    get size() { return this.#items.length; }
    push(entry) { this.#items.push(entry); let child = this.#items.length - 1; while (child > 0) {
        const parent = (child - 1) >> 1;
        if (!less(this.#items[child], this.#items[parent]))
            break;
        [this.#items[child], this.#items[parent]] = [this.#items[parent], this.#items[child]];
        child = parent;
    } }
    pop() { const first = this.#items[0]; const last = this.#items.pop(); if (this.#items.length > 0 && last !== undefined) {
        this.#items[0] = last;
        let parent = 0;
        while (true) {
            const left = parent * 2 + 1, right = left + 1;
            let smallest = parent;
            if (left < this.#items.length && less(this.#items[left], this.#items[smallest]))
                smallest = left;
            if (right < this.#items.length && less(this.#items[right], this.#items[smallest]))
                smallest = right;
            if (smallest === parent)
                break;
            [this.#items[parent], this.#items[smallest]] = [this.#items[smallest], this.#items[parent]];
            parent = smallest;
        }
    } return first; }
}
function less(a, b) { return a.priority < b.priority || (a.priority === b.priority && a.key < b.key); }
function reconstruct(key, previous, nodes) { const result = []; let cursor = key; while (cursor !== undefined) {
    result.push(nodes.get(cursor));
    cursor = previous.get(cursor);
} result.reverse(); return Object.freeze(result); }
function frozenResult(status, path, visited, cost) { return Object.freeze({ status, path: Object.freeze([...path]), visited, cost }); }
function requireNode(node, label) { if (![node.x, node.y, node.z].every(Number.isFinite))
    throw new Error(`Pathfinding ${label} coordinates must be finite.`); }
function nonEmptyKey(key) { if (key === "")
    throw new Error("Pathfinding node keys cannot be empty."); return key; }
function requireMetric(value, label) { if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be finite and non-negative.`); return value; }
//# sourceMappingURL=navigation.js.map