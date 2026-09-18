import { InputSystem, XR_GRIP_SPACE } from "./input.js";
/**
 * Action maps, contexts, and composites over an {@link InputSystem}.
 *
 * Owns the `InputSystem` rather than extending it, so the existing lower-level
 * API stays available and unchanged for games that want it.
 */
export class InputActions {
    system;
    #maps = new Map();
    #actionOwner = new Map();
    #composites = new Map();
    #defaults = new Map();
    #contexts = [];
    #options;
    #lastDevice;
    constructor(maps = [], options = {}) {
        this.system = new InputSystem([]);
        this.#options = {
            lookSensitivity: options.lookSensitivity ?? 1,
            deadZone: options.deadZone ?? 0.15,
        };
        if (!(this.#options.lookSensitivity > 0))
            throw new Error("Look sensitivity must be positive.");
        if (!(this.#options.deadZone >= 0 && this.#options.deadZone < 1))
            throw new Error("A dead zone must lie in [0, 1).");
        for (const map of maps)
            this.addMap(map);
    }
    addMap(definition) {
        const name = definition.name.trim();
        if (!name)
            throw new Error("An action map requires a non-empty name.");
        if (this.#maps.has(name))
            throw new Error(`An action map named "${name}" is already registered.`);
        for (const action of definition.actions) {
            const owner = this.#actionOwner.get(action.name);
            if (owner !== undefined) {
                throw new Error(`Action "${action.name}" is defined in both "${owner}" and "${name}". Action names must be unique across maps.`);
            }
            this.#actionOwner.set(action.name, name);
            this.system.defineAction(action);
            this.#defaults.set(action.name, action.bindings);
        }
        for (const composite of definition.composites ?? []) {
            if (this.#composites.has(composite.name))
                throw new Error(`A composite named "${composite.name}" is already registered.`);
            for (const part of [composite.positiveX, composite.negativeX, composite.positiveY, composite.negativeY]) {
                if (part === undefined)
                    continue;
                if (!this.#actionOwner.has(part) && !definition.actions.some((action) => action.name === part)) {
                    throw new Error(`Composite "${composite.name}" references action "${part}", which no map defines.`);
                }
            }
            this.#composites.set(composite.name, composite);
        }
        this.#maps.set(name, { definition, enabled: definition.enabled ?? true });
    }
    get maps() {
        return [...this.#maps.keys()].sort();
    }
    hasMap(name) {
        return this.#maps.has(name);
    }
    setMapEnabled(name, enabled) {
        const map = this.#maps.get(name);
        if (!map)
            throw new Error(`No action map named "${name}". Maps: ${this.maps.join(", ")}.`);
        map.enabled = enabled;
    }
    isMapEnabled(name) {
        const map = this.#maps.get(name);
        if (!map)
            throw new Error(`No action map named "${name}". Maps: ${this.maps.join(", ")}.`);
        if (this.#contexts.length === 0)
            return map.enabled;
        // The top context decides which maps are live, so a menu suspends gameplay
        // without every gameplay system having to check whether a menu is open.
        return map.enabled && this.#contexts[this.#contexts.length - 1].includes(name);
    }
    /** Pushes a context: only the named maps resolve until it is popped. */
    pushContext(mapNames) {
        for (const name of mapNames) {
            if (!this.#maps.has(name))
                throw new Error(`Context references unknown action map "${name}".`);
        }
        this.#contexts.push([...mapNames]);
    }
    popContext() {
        return this.#contexts.pop();
    }
    clearContexts() {
        this.#contexts.length = 0;
    }
    get contextDepth() {
        return this.#contexts.length;
    }
    /**
     * Resolves every action for this frame. Call once, early.
     *
     * Pass `navigator.getGamepads()` and the current `XrFrameSnapshot.inputs` to
     * resolve gamepad and XR bindings; keyboard, pointer, and virtual bindings
     * need neither.
     */
    update(gamepads = [], xrInputs = []) {
        this.system.update(gamepads, xrInputs);
        this.#trackDevice();
    }
    /** An action's analog value, or zero when its map is not live. */
    value(action) {
        if (!this.#isLive(action))
            return 0;
        return this.system.action(action).value;
    }
    /** A `delta` action scaled by look sensitivity — mouse and stick look. */
    look(action) {
        return this.value(action) * this.#options.lookSensitivity;
    }
    pressed(action) {
        return this.#isLive(action) && this.system.action(action).pressed;
    }
    justPressed(action) {
        return this.#isLive(action) && this.system.action(action).justPressed;
    }
    justReleased(action) {
        return this.#isLive(action) && this.system.action(action).justReleased;
    }
    /**
     * A composite's 2D value.
     *
     * Normalizing is on by default because the alternative — moving faster
     * diagonally than straight — is a bug players notice immediately and
     * developers rarely think to prevent.
     */
    vector(name) {
        const composite = this.#composites.get(name);
        if (!composite) {
            throw new Error(`No composite named "${name}". Composites: ${[...this.#composites.keys()].sort().join(", ")}.`);
        }
        const x = this.value(composite.positiveX) - (composite.negativeX === undefined ? 0 : this.value(composite.negativeX));
        const y = this.value(composite.positiveY) - (composite.negativeY === undefined ? 0 : this.value(composite.negativeY));
        const deadZone = composite.deadZone ?? this.#options.deadZone;
        const magnitude = Math.hypot(x, y);
        if (magnitude <= deadZone)
            return { x: 0, y: 0 };
        // Rescale from the dead zone edge, so the stick's usable range still spans
        // zero to one rather than jumping to the dead-zone value.
        const scaled = (magnitude - deadZone) / (1 - deadZone);
        const clamped = Math.min(1, scaled);
        if (composite.normalize === false) {
            return { x: (x / magnitude) * Math.min(magnitude, 1), y: (y / magnitude) * Math.min(magnitude, 1) };
        }
        return { x: (x / magnitude) * clamped, y: (y / magnitude) * clamped };
    }
    /** The device that most recently produced input, for showing the right prompts. */
    get lastDevice() {
        return this.#lastDevice;
    }
    // --- rebinding -----------------------------------------------------------
    /** Replaces an action's bindings. */
    rebind(action, bindings) {
        if (!this.#actionOwner.has(action)) {
            throw new Error(`Cannot rebind unknown action "${action}".`);
        }
        if (bindings.length === 0)
            throw new Error(`Rebinding "${action}" to no bindings would make it unusable; use an empty map instead.`);
        this.system.setBindings(action, bindings);
    }
    /** Restores one action, or all of them, to the bindings it was defined with. */
    resetBindings(action) {
        const names = action === undefined ? [...this.#defaults.keys()] : [action];
        for (const name of names) {
            const defaults = this.#defaults.get(name);
            if (!defaults)
                throw new Error(`Cannot reset unknown action "${name}".`);
            this.system.setBindings(name, defaults);
        }
    }
    /**
     * Bindings that differ from their defaults.
     *
     * Only overrides are serialized, so a later build changing a default binding
     * still reaches players who never remapped that action.
     */
    overrides() {
        const out = {};
        for (const [name, defaults] of this.#defaults) {
            const current = this.system.bindings(name);
            if (JSON.stringify(current) !== JSON.stringify(defaults))
                out[name] = current;
        }
        return out;
    }
    /** Applies serialized overrides, ignoring actions this build no longer has. */
    applyOverrides(overrides) {
        const skipped = [];
        for (const [name, bindings] of Object.entries(overrides)) {
            if (!this.#actionOwner.has(name) || bindings.length === 0) {
                skipped.push(name);
                continue;
            }
            this.system.setBindings(name, bindings);
        }
        return skipped;
    }
    stats() {
        return {
            maps: this.#maps.size,
            enabledMaps: [...this.#maps.keys()].filter((name) => this.isMapEnabled(name)).length,
            actions: this.#actionOwner.size,
            lastDevice: this.#lastDevice,
            contextDepth: this.#contexts.length,
        };
    }
    #isLive(action) {
        const owner = this.#actionOwner.get(action);
        if (owner === undefined) {
            throw new Error(`No action named "${action}". Define it in an action map first.`);
        }
        return this.isMapEnabled(owner);
    }
    /** Notes which device last moved, so UI can show matching prompts. The
     * resolver tracks this per contributing binding, so an action bound to both
     * a key and an XR trigger reports whichever the player actually used. */
    #trackDevice() {
        const device = this.system.lastDevice;
        if (device !== undefined)
            this.#lastDevice = device;
    }
}
/**
 * Routes devices to players for local multiplayer.
 *
 * Each player gets its own {@link InputActions} built from the same maps, with
 * gamepad bindings rewritten to that player's pad. Local multiplayer is then a
 * routing question rather than a parallel input stack, and gameplay code reads
 * `players.get(1).vector("Move")` without knowing which pad that is.
 */
export class PlayerInput {
    #players = new Map();
    #maps;
    #options;
    constructor(maps, options = {}) {
        this.#maps = maps;
        this.#options = options;
    }
    addPlayer(slot) {
        if (!Number.isInteger(slot.id) || slot.id < 0)
            throw new Error("A player id must be a non-negative whole number.");
        if (this.#players.has(slot.id))
            throw new Error(`Player ${slot.id} is already registered.`);
        const maps = this.#maps.map((map) => ({
            ...map,
            actions: map.actions.map((action) => ({
                ...action,
                bindings: action.bindings
                    .filter((binding) => binding.device === "gamepad" ? slot.gamepad !== undefined : binding.device === "xr" ? slot.xr === true : slot.keyboard !== false)
                    .map((binding) => (binding.device === "gamepad" && slot.gamepad !== undefined ? { ...binding, gamepad: slot.gamepad } : binding)),
            })),
        }));
        const actions = new InputActions(maps, this.#options);
        this.#players.set(slot.id, actions);
        return actions;
    }
    get(id) {
        const actions = this.#players.get(id);
        if (!actions)
            throw new Error(`No player ${id}. Players: ${[...this.#players.keys()].sort().join(", ")}.`);
        return actions;
    }
    get playerIds() {
        return [...this.#players.keys()].sort((a, b) => a - b);
    }
    removePlayer(id) {
        return this.#players.delete(id);
    }
    /** Updates every player's actions. */
    update() {
        for (const actions of this.#players.values())
            actions.update();
    }
}
/** Standard action names, so gameplay, UI, and XR agree on spelling. */
export const STANDARD_ACTIONS = {
    moveX: "MoveX",
    moveY: "MoveY",
    move: "Move",
    lookX: "LookX",
    lookY: "LookY",
    jump: "Jump",
    interact: "Interact",
    fire: "Fire",
    aim: "Aim",
    sprint: "Sprint",
    crouch: "Crouch",
    reload: "Reload",
    pause: "Pause",
    submit: "Submit",
    cancel: "Cancel",
    navigateX: "NavigateX",
    navigateY: "NavigateY",
};
/**
 * The action map most games start from: WASD or stick movement, mouse or stick
 * look, and the usual verbs, bound to both keyboard and gamepad.
 *
 * Provided because the first hour of every project is otherwise spent retyping
 * it, and because a shared default means examples and documentation agree.
 */
export function defaultGameplayMap() {
    const key = (code, scale = 1) => ({ device: "keyboard", code, scale });
    const pad = (index, control = "button", scale = 1) => ({
        device: "gamepad",
        gamepad: 0,
        control,
        index,
        scale,
        deadZone: 0.15,
    });
    return {
        name: "gameplay",
        actions: [
            { name: STANDARD_ACTIONS.moveX, kind: "axis", bindings: [key("KeyD"), key("KeyA", -1), key("ArrowRight"), key("ArrowLeft", -1), pad(0, "axis")] },
            { name: STANDARD_ACTIONS.moveY, kind: "axis", bindings: [key("KeyW"), key("KeyS", -1), key("ArrowUp"), key("ArrowDown", -1), pad(1, "axis", -1)] },
            { name: STANDARD_ACTIONS.lookX, kind: "delta", bindings: [{ device: "pointer", axis: "x" }, pad(2, "axis")] },
            { name: STANDARD_ACTIONS.lookY, kind: "delta", bindings: [{ device: "pointer", axis: "y" }, pad(3, "axis")] },
            { name: STANDARD_ACTIONS.jump, kind: "button", bindings: [key("Space"), pad(0)] },
            { name: STANDARD_ACTIONS.interact, kind: "button", bindings: [key("KeyE"), pad(2)] },
            { name: STANDARD_ACTIONS.fire, kind: "button", bindings: [{ device: "pointer", button: 0 }, pad(7)] },
            { name: STANDARD_ACTIONS.aim, kind: "button", bindings: [{ device: "pointer", button: 2 }, pad(6)] },
            { name: STANDARD_ACTIONS.sprint, kind: "button", bindings: [key("ShiftLeft"), pad(10)] },
            { name: STANDARD_ACTIONS.crouch, kind: "button", bindings: [key("ControlLeft"), pad(1)] },
            { name: STANDARD_ACTIONS.pause, kind: "button", bindings: [key("Escape"), pad(9)] },
        ],
        composites: [
            // MoveX and MoveY are already signed, so the composite needs only their
            // positive halves.
            { name: STANDARD_ACTIONS.move, kind: "vector2", positiveX: STANDARD_ACTIONS.moveX, positiveY: STANDARD_ACTIONS.moveY },
        ],
    };
}
//# sourceMappingURL=actions.js.map