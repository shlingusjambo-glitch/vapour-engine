/** Playback, blending, layers, and state machines.
 *
 * The animator sits between "a clip exists" and "a character moves". Its job is
 * almost entirely about *transitions*: nobody notices a clip playing correctly,
 * and everybody notices a character snapping between two of them.
 *
 * Three decisions shape it:
 *
 * - **Time is explicit.** `update(deltaSeconds)` is called by the game, so
 *   animation pauses with the game, follows slow motion, and reproduces exactly
 *   in a replay or on a server tick.
 * - **Layers are additive in structure, not in maths.** Each layer produces a
 *   full pose and is blended over the one below by weight and mask, which is
 *   simpler to reason about than additive-difference blending and covers the
 *   cases games actually use — an aim pose over a locomotion base.
 * - **State machines drive parameters, not clips directly.** A transition fires
 *   on a condition over named parameters, so gameplay sets `speed` and `
 *   grounded` and never touches a clip name.
 */
import { blendPoses, maskPose, samplePose, validateClip, } from "./clip.js";
import { blendTreeDuration, sampleBlendTree, validateBlendTree, } from "./blend-tree.js";
/** One layer of animation: a current clip, optionally fading from a previous. */
export class AnimatorLayer {
    name;
    weight;
    #mask;
    #current;
    #previous;
    #fadeRemaining = 0;
    #fadeDuration = 0;
    constructor(options) {
        if (!options.name.trim())
            throw new Error("An animator layer requires a non-empty name.");
        const weight = options.weight ?? 1;
        if (!(weight >= 0 && weight <= 1))
            throw new Error(`Layer "${options.name}" weight must lie in [0, 1].`);
        this.name = options.name;
        this.weight = weight;
        if (options.mask)
            this.#mask = new Set(options.mask);
    }
    get currentClip() {
        return this.#current?.clip;
    }
    get isFading() {
        return this.#fadeRemaining > 0;
    }
    /** Fraction of the current clip elapsed, in `[0, 1]` for a non-looping clip. */
    get normalizedTime() {
        if (!this.#current)
            return 0;
        return this.#current.time / this.#current.clip.duration;
    }
    setMask(bones) {
        this.#mask = bones ? new Set(bones) : undefined;
    }
    /**
     * Plays a clip, optionally crossfading from the current one.
     *
     * Playing the clip already playing is a no-op rather than a restart, because
     * gameplay code calls `play("walk")` every frame while walking and restarting
     * on each call is the classic way to make a character twitch.
     */
    play(clip, options = {}) {
        validateClip(clip);
        const speed = options.speed ?? 1;
        if (!Number.isFinite(speed))
            throw new Error("An animation speed must be finite.");
        if (this.#current?.clip === clip && options.restart !== true) {
            this.#current.speed = speed;
            return;
        }
        const fade = options.fadeSeconds ?? 0;
        if (!(fade >= 0))
            throw new Error("A crossfade duration must not be negative.");
        if (fade > 0 && this.#current) {
            this.#previous = this.#current;
            this.#fadeDuration = fade;
            this.#fadeRemaining = fade;
        }
        else {
            this.#previous = undefined;
            this.#fadeRemaining = 0;
        }
        this.#current = { clip, time: 0, speed };
    }
    stop() {
        this.#current = undefined;
        this.#previous = undefined;
        this.#fadeRemaining = 0;
    }
    /** @internal Advances clip times. */
    advance(deltaSeconds) {
        if (this.#current)
            this.#current.time += deltaSeconds * this.#current.speed;
        if (this.#previous)
            this.#previous.time += deltaSeconds * this.#previous.speed;
        if (this.#fadeRemaining > 0) {
            this.#fadeRemaining = Math.max(0, this.#fadeRemaining - deltaSeconds);
            if (this.#fadeRemaining === 0)
                this.#previous = undefined;
        }
    }
    /** @internal Produces this layer's pose, masked. */
    evaluate(into, scratch) {
        if (!this.#current)
            return undefined;
        into.clear();
        samplePose(this.#current.clip, this.#current.time, into);
        if (this.#previous && this.#fadeDuration > 0) {
            // Fade *from* the previous clip: at the start of the fade the previous
            // clip dominates, and its influence falls to zero at the end.
            scratch.clear();
            samplePose(this.#previous.clip, this.#previous.time, scratch);
            const towardCurrent = 1 - this.#fadeRemaining / this.#fadeDuration;
            const blended = blendPoses(scratch, into, towardCurrent);
            into.clear();
            for (const [name, bone] of blended)
                into.set(name, bone);
        }
        if (this.#mask) {
            const masked = maskPose(into, this.#mask);
            into.clear();
            for (const [name, bone] of masked)
                into.set(name, bone);
        }
        return into;
    }
}
/**
 * Drives layers, and optionally a state machine over them.
 *
 * The base layer is created automatically, because every animator has one and
 * requiring it to be added is friction with no upside.
 */
export class Animator {
    #layers = [];
    #parameters = new Map();
    #pose = new Map();
    #layerPose = new Map();
    #scratch = new Map();
    #treePose = new Map();
    #treeScratch = new Map();
    #events = [];
    #machine;
    #stateName;
    #transitionCount = 0;
    #elapsed = 0;
    #activeBlendTree;
    #blendTreeTime = 0;
    #blendTreeSpeed = 1;
    constructor() {
        this.#layers.push(new AnimatorLayer({ name: "base", weight: 1 }));
    }
    get base() {
        return this.#layers[0];
    }
    get layers() {
        return this.#layers;
    }
    get state() {
        return this.#stateName;
    }
    layer(name) {
        const found = this.#layers.find((layer) => layer.name === name);
        if (!found) {
            throw new Error(`Animator has no layer "${name}". Layers: ${this.#layers.map((layer) => layer.name).join(", ")}.`);
        }
        return found;
    }
    addLayer(options) {
        if (this.#layers.some((layer) => layer.name === options.name)) {
            throw new Error(`Animator already has a layer named "${options.name}".`);
        }
        const layer = new AnimatorLayer(options);
        this.#layers.push(layer);
        return layer;
    }
    /** Convenience for the common case of playing on the base layer. */
    play(clip, options) {
        this.base.play(clip, options);
    }
    setParameter(name, value) {
        if (!name.trim())
            throw new Error("An animator parameter requires a non-empty name.");
        if (typeof value === "number" && !Number.isFinite(value))
            throw new Error(`Animator parameter "${name}" must be finite.`);
        this.#parameters.set(name, value);
    }
    getParameter(name) {
        return this.#parameters.get(name);
    }
    /** Installs a state machine and enters its initial state. */
    setStateMachine(machine) {
        if (machine.states.length === 0)
            throw new Error("An animator state machine needs at least one state.");
        const names = new Set(machine.states.map((state) => state.name));
        if (names.size !== machine.states.length)
            throw new Error("An animator state machine has duplicate state names.");
        for (const state of machine.states) {
            if (!state.name.trim())
                throw new Error("An animator state requires a non-empty name.");
            if ((state.clip === undefined) === (state.blendTree === undefined))
                throw new Error(`Animator state "${state.name}" must define exactly one clip or blend tree.`);
            if (state.clip)
                validateClip(state.clip);
            if (state.blendTree)
                validateBlendTree(state.blendTree);
            if (state.speed !== undefined && !Number.isFinite(state.speed))
                throw new Error(`Animator state "${state.name}" speed must be finite.`);
            for (const transition of state.transitions ?? []) {
                if (!names.has(transition.to)) {
                    throw new Error(`State "${state.name}" transitions to "${transition.to}", which the machine does not define.`);
                }
            }
        }
        for (const transition of machine.anyStateTransitions ?? []) {
            if (!names.has(transition.to))
                throw new Error(`An any-state transition targets "${transition.to}", which the machine does not define.`);
        }
        if (!names.has(machine.initial))
            throw new Error(`The initial state "${machine.initial}" is not one of the machine's states.`);
        this.#machine = machine;
        this.#enter(machine.initial, 0);
    }
    /** Advances time, evaluates transitions, and produces the final pose. */
    update(deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("Animator.update requires a finite, non-negative delta.");
        this.#elapsed += deltaSeconds;
        if (this.#activeBlendTree)
            this.#blendTreeTime += deltaSeconds * this.#blendTreeSpeed;
        for (const layer of this.#layers)
            layer.advance(deltaSeconds);
        if (this.#machine)
            this.#evaluateTransitions();
        return this.#evaluate();
    }
    /** The pose produced by the last update, without advancing time. */
    pose() {
        return this.#evaluate();
    }
    /** Events raised since the last call, clearing them. */
    drainEvents() {
        const events = [...this.#events];
        this.#events.length = 0;
        return events;
    }
    stats() {
        return {
            layers: this.#layers.length,
            state: this.#stateName,
            transitions: this.#transitionCount,
            elapsedSeconds: this.#elapsed,
        };
    }
    #evaluate() {
        this.#pose.clear();
        let firstLayer = 0;
        if (this.#activeBlendTree) {
            sampleBlendTree(this.#activeBlendTree, this.#parameters, this.#blendTreeTime, this.#treePose, this.#treeScratch);
            for (const [name, bone] of this.#treePose)
                this.#pose.set(name, { ...bone });
            firstLayer = 1;
        }
        for (let index = firstLayer; index < this.#layers.length; index += 1) {
            const layer = this.#layers[index];
            const layerPose = layer.evaluate(this.#layerPose, this.#scratch);
            if (!layerPose)
                continue;
            if (this.#pose.size === 0) {
                for (const [name, bone] of layerPose)
                    this.#pose.set(name, { ...bone });
                continue;
            }
            const blended = blendPoses(this.#pose, layerPose, layer.weight);
            this.#pose.clear();
            for (const [name, bone] of blended)
                this.#pose.set(name, bone);
        }
        return this.#pose;
    }
    #evaluateTransitions() {
        const machine = this.#machine;
        const current = machine.states.find((state) => state.name === this.#stateName);
        const candidates = [
            ...(machine.anyStateTransitions ?? []),
            ...(current?.transitions ?? []),
        ];
        for (const transition of candidates) {
            if (transition.to === this.#stateName)
                continue;
            const normalizedTime = this.#activeBlendTree
                ? this.#blendTreeTime / blendTreeDuration(this.#activeBlendTree)
                : this.base.normalizedTime;
            if (transition.waitForExit && normalizedTime < 1)
                continue;
            if (!transition.conditions.every((condition) => this.#matches(condition)))
                continue;
            this.#enter(transition.to, transition.fadeSeconds ?? 0.2);
            return;
        }
    }
    #matches(condition) {
        const value = this.#parameters.get(condition.parameter);
        if (value === undefined)
            return false;
        switch (condition.operator) {
            case "==":
                return value === condition.value;
            case "!=":
                return value !== condition.value;
            default: {
                if (typeof value !== "number" || typeof condition.value !== "number")
                    return false;
                if (condition.operator === ">")
                    return value > condition.value;
                if (condition.operator === ">=")
                    return value >= condition.value;
                if (condition.operator === "<")
                    return value < condition.value;
                return value <= condition.value;
            }
        }
    }
    #enter(name, fadeSeconds) {
        const state = this.#machine.states.find((candidate) => candidate.name === name);
        this.#stateName = name;
        this.#transitionCount += 1;
        if (state.blendTree) {
            this.#activeBlendTree = state.blendTree;
            this.#blendTreeTime = 0;
            this.#blendTreeSpeed = state.speed ?? 1;
            this.base.stop();
        }
        else {
            this.#activeBlendTree = undefined;
            this.base.play(state.clip, {
                fadeSeconds,
                ...(state.speed === undefined ? {} : { speed: state.speed }),
                restart: true,
            });
        }
        this.#events.push({
            clip: state.clip?.name ?? `blend-tree:${name}`,
            name: `enter:${name}`,
            time: this.#elapsed,
        });
    }
}
//# sourceMappingURL=animator.js.map