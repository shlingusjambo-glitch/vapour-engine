/** Allocation-conscious vision query with range, cone, tags, and pluggable LOS. */
export function perceiveVision(targets, options, requiredTag) {
    requirePositive(options.range, "Vision range");
    if (!Number.isFinite(options.fieldOfView) || options.fieldOfView <= 0 || options.fieldOfView > 360)
        throw new Error("Vision field of view must be finite and in (0, 360].");
    const eye = options.eye ?? ZERO;
    const forward = normalize(options.forward ?? FORWARD, "Vision forward vector");
    const threshold = options.fieldOfView >= 360 ? -1 : Math.cos(options.fieldOfView * Math.PI / 360);
    const visible = [];
    for (const target of targets) {
        requireId(target.id, "Perception target");
        if (requiredTag !== undefined && !target.tags?.includes(requiredTag))
            continue;
        const dx = target.position.x - eye.x, dy = target.position.y - eye.y, dz = target.position.z - eye.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance > options.range || distance <= Number.EPSILON)
            continue;
        if ((dx * forward.x + dy * forward.y + dz * forward.z) / distance < threshold)
            continue;
        if (options.occluded?.(eye, target.position, target))
            continue;
        const threat = target.threat ?? 0;
        if (!Number.isFinite(threat))
            throw new Error(`Perception target '${target.id}' has a non-finite threat.`);
        visible.push({ ...target, distance, score: threat + 1 - distance / options.range });
    }
    return visible.sort((a, b) => b.score - a.score || a.distance - b.distance || a.id.localeCompare(b.id));
}
/** Distance-attenuated hearing; an optional obstruction callback can model walls. */
export function perceiveHearing(listener, range, sounds, obstruction) {
    requirePositive(range, "Hearing range");
    const heard = [];
    for (const sound of sounds) {
        requireId(sound.id, "Sound stimulus");
        if (!Number.isFinite(sound.loudness) || sound.loudness < 0)
            throw new Error(`Sound stimulus '${sound.id}' loudness must be finite and non-negative.`);
        const distance = Math.hypot(sound.position.x - listener.x, sound.position.y - listener.y, sound.position.z - listener.z);
        const blocked = obstruction?.(listener, sound.position, sound) ?? 0;
        if (!Number.isFinite(blocked) || blocked < 0 || blocked > 1)
            throw new Error("Hearing obstruction must return a finite value in [0, 1].");
        const strength = sound.loudness * Math.max(0, 1 - distance / range) * (1 - blocked);
        if (strength > 0)
            heard.push({ ...sound, distance, strength });
    }
    return heard.sort((a, b) => b.strength - a.strength || a.distance - b.distance || a.id.localeCompare(b.id));
}
export function blackboardKey(name, defaultValue) {
    requireId(name, "Blackboard key");
    return defaultValue === undefined ? { name } : { name, defaultValue };
}
/** Typed shared memory for behavior trees and controllers. */
export class Blackboard {
    #values = new Map();
    #listeners = new Map();
    has(key) { return this.#values.has(key.name); }
    get(key) { return (this.#values.has(key.name) ? this.#values.get(key.name) : key.defaultValue); }
    require(key) {
        const value = this.get(key);
        if (value === undefined)
            throw new Error(`Blackboard key '${key.name}' has no value and no default.`);
        return value;
    }
    set(key, value) {
        const previous = this.get(key);
        this.#values.set(key.name, value);
        for (const listener of this.#listeners.get(key.name) ?? [])
            listener(value, previous);
    }
    delete(key) { return this.#values.delete(key.name); }
    clear() { this.#values.clear(); }
    observe(key, listener) {
        const listeners = this.#listeners.get(key.name) ?? new Set();
        this.#listeners.set(key.name, listeners);
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
    snapshot() { return Object.freeze(Object.fromEntries([...this.#values].sort(([a], [b]) => a.localeCompare(b)))); }
}
export function selectTarget(targets, policy = "highest-score") {
    let best;
    for (const target of targets) {
        if (!best || compareTarget(target, best, policy) < 0)
            best = target;
    }
    return best;
}
/** Small orchestration primitive. Games supply sensors and decisions; the engine owns cadence and memory. */
export class AiController {
    blackboard = new Blackboard();
    #sense;
    #decide;
    #interval;
    #elapsed = 0;
    #enabled = true;
    constructor(options) {
        this.#interval = options.sensingInterval ?? 0.1;
        requirePositive(this.#interval, "AI sensing interval");
        this.#elapsed = this.#interval;
        this.#sense = options.sense;
        this.#decide = options.decide;
    }
    get enabled() { return this.#enabled; }
    set enabled(value) { this.#enabled = value; }
    update(context, deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("AI controller delta time must be finite and non-negative.");
        if (!this.#enabled)
            return;
        this.#elapsed += deltaSeconds;
        if (this.#elapsed >= this.#interval) {
            this.#elapsed %= this.#interval;
            this.#sense(context, this.blackboard);
        }
        this.#decide(context, this.blackboard, deltaSeconds);
    }
}
const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
const FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });
function requirePositive(value, label) { if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be finite and positive.`); }
function requireId(value, label) { if (value.trim() === "")
    throw new Error(`${label} ID cannot be empty.`); }
function normalize(value, label) { const length = Math.hypot(value.x, value.y, value.z); if (!(length > 1e-8))
    throw new Error(`${label} cannot be zero.`); return { x: value.x / length, y: value.y / length, z: value.z / length }; }
function compareTarget(a, b, policy) {
    const primary = policy === "nearest" ? a.distance - b.distance : policy === "highest-threat" ? (b.threat ?? 0) - (a.threat ?? 0) : b.score - a.score;
    return primary || a.id.localeCompare(b.id);
}
//# sourceMappingURL=perception.js.map