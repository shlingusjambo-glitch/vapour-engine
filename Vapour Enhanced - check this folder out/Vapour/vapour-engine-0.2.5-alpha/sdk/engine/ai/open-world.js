/** A mutable XZ spatial hash for broad-phase AI queries and activation. */
export class SpatialEntityIndex {
    #cellSize;
    #cells = new Map();
    #entities = new Map();
    #entityCells = new Map();
    constructor(cellSize = 32) {
        this.#cellSize = positive(cellSize, "Spatial index cell size");
    }
    get size() { return this.#entities.size; }
    upsert(entity) {
        nonEmpty(entity.id, "Spatial entity ID");
        finitePosition(entity, `Spatial entity '${entity.id}'`);
        const key = this.#key(entity.x, entity.z);
        const previous = this.#entityCells.get(entity.id);
        if (previous !== undefined && previous !== key) {
            const oldCell = this.#cells.get(previous);
            oldCell?.delete(entity.id);
            if (oldCell?.size === 0)
                this.#cells.delete(previous);
        }
        const cell = this.#cells.get(key) ?? new Map();
        cell.set(entity.id, entity);
        this.#cells.set(key, cell);
        this.#entities.set(entity.id, entity);
        this.#entityCells.set(entity.id, key);
    }
    remove(id) {
        const key = this.#entityCells.get(id);
        if (key === undefined)
            return false;
        const cell = this.#cells.get(key);
        cell?.delete(id);
        if (cell?.size === 0)
            this.#cells.delete(key);
        this.#entityCells.delete(id);
        return this.#entities.delete(id);
    }
    get(id) { return this.#entities.get(id); }
    queryRadius(center, radius, predicate) {
        finitePosition(center, "Spatial query center");
        const range = nonNegative(radius, "Spatial query radius");
        const minX = Math.floor((center.x - range) / this.#cellSize);
        const maxX = Math.floor((center.x + range) / this.#cellSize);
        const minZ = Math.floor((center.z - range) / this.#cellSize);
        const maxZ = Math.floor((center.z + range) / this.#cellSize);
        const radiusSquared = range * range;
        const found = [];
        for (let z = minZ; z <= maxZ; z += 1)
            for (let x = minX; x <= maxX; x += 1) {
                for (const entity of this.#cells.get(`${x}:${z}`)?.values() ?? []) {
                    const dx = entity.x - center.x, dz = entity.z - center.z;
                    if (dx * dx + dz * dz <= radiusSquared && (predicate?.(entity) ?? true))
                        found.push(entity);
                }
            }
        return found.sort((a, b) => distanceSquared(a, center) - distanceSquared(b, center) || a.id.localeCompare(b.id));
    }
    #key(x, z) { return `${Math.floor(x / this.#cellSize)}:${Math.floor(z / this.#cellSize)}`; }
}
/** Staggers distant AI work while keeping elapsed time correct for each agent. */
export class SimulationLodScheduler {
    #fullDistance;
    #reducedDistance;
    #reducedStep;
    #timing = new Map();
    constructor(settings = {}) {
        this.#fullDistance = positive(settings.fullDistance ?? 45, "Full simulation distance");
        this.#reducedDistance = positive(settings.reducedDistance ?? 140, "Reduced simulation distance");
        if (this.#reducedDistance <= this.#fullDistance)
            throw new Error("Reduced simulation distance must exceed full simulation distance.");
        this.#reducedStep = 1 / positive(settings.reducedHz ?? 5, "Reduced simulation frequency");
    }
    evaluate(id, position, focus, frameDelta) {
        nonEmpty(id, "Simulation entity ID");
        finitePosition(position, `Simulation entity '${id}'`);
        finitePosition(focus, "Simulation focus");
        nonNegative(frameDelta, "Simulation frame delta");
        const distance = Math.hypot(position.x - focus.x, position.y - focus.y, position.z - focus.z);
        if (distance <= this.#fullDistance) {
            this.#timing.delete(id);
            return { tier: "full", shouldTick: true, deltaSeconds: frameDelta };
        }
        if (distance > this.#reducedDistance) {
            this.#timing.delete(id);
            return { tier: "dormant", shouldTick: false, deltaSeconds: 0 };
        }
        const timing = this.#timing.get(id) ?? { elapsed: 0, untilTick: this.#reducedStep - phase(id, this.#reducedStep) };
        timing.elapsed += frameDelta;
        timing.untilTick -= frameDelta;
        this.#timing.set(id, timing);
        if (timing.untilTick > 1e-9)
            return { tier: "reduced", shouldTick: false, deltaSeconds: 0 };
        const elapsed = timing.elapsed;
        timing.elapsed = 0;
        timing.untilTick = this.#reducedStep + (timing.untilTick % this.#reducedStep);
        return { tier: "reduced", shouldTick: true, deltaSeconds: elapsed };
    }
    forget(id) { this.#timing.delete(id); }
    clear() { this.#timing.clear(); }
}
/** Deterministic multi-approach signal plan with an all-red clearance phase. */
export class TrafficSignalController {
    #plans;
    #approach = 0;
    #phase = "green";
    #remaining;
    constructor(plans) {
        if (plans.length < 2)
            throw new Error("A traffic signal requires at least two approaches.");
        this.#plans = plans.map((plan, index) => ({
            greenSeconds: positive(plan.greenSeconds, `Traffic approach ${index} green duration`),
            yellowSeconds: positive(plan.yellowSeconds ?? 3, `Traffic approach ${index} yellow duration`),
            clearanceSeconds: positive(plan.clearanceSeconds ?? 1, `Traffic approach ${index} clearance duration`),
        }));
        this.#remaining = this.#plans[0].greenSeconds;
    }
    update(deltaSeconds) {
        let delta = nonNegative(deltaSeconds, "Traffic signal delta");
        while (delta >= this.#remaining) {
            delta -= this.#remaining;
            this.#advance();
        }
        this.#remaining -= delta;
        return this.snapshot();
    }
    snapshot() { return { approach: this.#approach, phase: this.#phase, remainingSeconds: this.#remaining }; }
    permits(approach) { return Number.isInteger(approach) && approach === this.#approach && this.#phase === "green"; }
    #advance() {
        const plan = this.#plans[this.#approach];
        if (this.#phase === "green") {
            this.#phase = "yellow";
            this.#remaining = plan.yellowSeconds;
            return;
        }
        if (this.#phase === "yellow") {
            this.#phase = "all-red";
            this.#remaining = plan.clearanceSeconds;
            return;
        }
        this.#approach = (this.#approach + 1) % this.#plans.length;
        this.#phase = "green";
        this.#remaining = this.#plans[this.#approach].greenSeconds;
    }
}
function phase(id, step) { let hash = 2166136261; for (let i = 0; i < id.length; i += 1)
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619); return ((hash >>> 0) / 0xffffffff) * step; }
function distanceSquared(a, b) { const x = a.x - b.x, y = a.y - b.y, z = a.z - b.z; return x * x + y * y + z * z; }
function finitePosition(value, label) { if (![value.x, value.y, value.z].every(Number.isFinite))
    throw new Error(`${label} coordinates must be finite.`); }
function nonEmpty(value, label) { if (value.trim() === "")
    throw new Error(`${label} cannot be empty.`); return value; }
function positive(value, label) { if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be finite and positive.`); return value; }
function nonNegative(value, label) { if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be finite and non-negative.`); return value; }
//# sourceMappingURL=open-world.js.map