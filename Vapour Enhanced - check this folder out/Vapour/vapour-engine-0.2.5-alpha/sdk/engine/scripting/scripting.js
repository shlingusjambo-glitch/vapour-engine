export class ScriptExecutionError extends Error {
    entityId;
    phase;
    cause;
    constructor(entityId, phase, cause) {
        super(`Script on entity '${entityId}' failed during ${phase}: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = "ScriptExecutionError";
        this.entityId = entityId;
        this.phase = phase;
        this.cause = cause;
    }
}
export class Behaviour {
    #context;
    get context() {
        if (this.#context === undefined)
            throw new Error("Behaviour is not attached to a runtime.");
        return this.#context;
    }
    /** @internal */
    attach(context) {
        if (this.#context !== undefined)
            throw new Error("Behaviour is already attached.");
        this.#context = context;
        this.initialize();
    }
    initialize() { }
    start() { }
    update(_deltaSeconds) { }
    fixedUpdate(_fixedDeltaSeconds) { }
    lateUpdate(_deltaSeconds) { }
    destroy() { }
    collisionEnter(_otherEntityId) { }
    collisionExit(_otherEntityId) { }
    triggerEnter(_otherEntityId) { }
    triggerExit(_otherEntityId) { }
}
export class ScriptScheduler {
    #scripts = [];
    #pendingRemoval = new Set();
    add(behaviour, context) {
        invoke(context, "initialize", () => behaviour.attach(context));
        this.#scripts.push({ behaviour, context, started: false });
    }
    /** Adds an ESM script module compiled from either VS or TypeScript. */
    addModule(module, context) {
        const behaviour = new ModuleBehaviour(module);
        this.add(behaviour, context);
        return behaviour;
    }
    remove(behaviour) {
        this.#pendingRemoval.add(behaviour);
    }
    update(deltaSeconds) {
        this.#flushRemovals();
        for (const entry of this.#scripts) {
            if (!entry.started) {
                entry.started = true;
                invoke(entry.context, "start", () => entry.behaviour.start());
            }
            invoke(entry.context, "update", () => entry.behaviour.update(deltaSeconds));
        }
    }
    fixedUpdate(fixedDeltaSeconds) {
        for (const entry of this.#scripts)
            invoke(entry.context, "fixedUpdate", () => entry.behaviour.fixedUpdate(fixedDeltaSeconds));
    }
    lateUpdate(deltaSeconds) {
        for (const entry of this.#scripts)
            invoke(entry.context, "lateUpdate", () => entry.behaviour.lateUpdate(deltaSeconds));
    }
    collisionEnter(entityId, otherEntityId) { this.#dispatch(entityId, "collisionEnter", (script) => script.collisionEnter(otherEntityId)); }
    collisionExit(entityId, otherEntityId) { this.#dispatch(entityId, "collisionExit", (script) => script.collisionExit(otherEntityId)); }
    triggerEnter(entityId, otherEntityId) { this.#dispatch(entityId, "triggerEnter", (script) => script.triggerEnter(otherEntityId)); }
    triggerExit(entityId, otherEntityId) { this.#dispatch(entityId, "triggerExit", (script) => script.triggerExit(otherEntityId)); }
    #dispatch(entityId, phase, callback) {
        let found = false;
        for (const entry of this.#scripts)
            if (entry.context.entityId === entityId && !this.#pendingRemoval.has(entry.behaviour)) {
                found = true;
                invoke(entry.context, phase, () => callback(entry.behaviour));
            }
        if (!found)
            throw new Error(`Cannot dispatch ${phase}: entity '${entityId}' has no active scripts.`);
    }
    #flushRemovals() {
        if (this.#pendingRemoval.size === 0)
            return;
        for (let index = this.#scripts.length - 1; index >= 0; index -= 1) {
            const entry = this.#scripts[index];
            if (entry !== undefined && this.#pendingRemoval.has(entry.behaviour)) {
                invoke(entry.context, "destroy", () => entry.behaviour.destroy());
                this.#scripts.splice(index, 1);
            }
        }
        this.#pendingRemoval.clear();
    }
}
class ModuleBehaviour extends Behaviour {
    #module;
    constructor(module) { super(); this.#module = module; }
    initialize() { this.#module.initialize?.(this.context); }
    start() { this.#module.start?.(this.context); }
    update(delta) { this.#module.update?.(this.context, delta); }
    fixedUpdate(delta) { this.#module.fixedUpdate?.(this.context, delta); }
    lateUpdate(delta) { this.#module.lateUpdate?.(this.context, delta); }
    destroy() { this.#module.destroy?.(this.context); }
    collisionEnter(other) { this.#module.collisionEnter?.(this.context, other); }
    collisionExit(other) { this.#module.collisionExit?.(this.context, other); }
    triggerEnter(other) { this.#module.triggerEnter?.(this.context, other); }
    triggerExit(other) { this.#module.triggerExit?.(this.context, other); }
}
function invoke(context, phase, callback) {
    try {
        callback();
    }
    catch (error) {
        if (error instanceof ScriptExecutionError)
            throw error;
        throw new ScriptExecutionError(context.entityId, phase, error);
    }
}
//# sourceMappingURL=scripting.js.map