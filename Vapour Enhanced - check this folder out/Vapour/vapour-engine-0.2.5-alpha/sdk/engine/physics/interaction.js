export const DEFAULT_GRAB_OPTIONS = {
    stiffness: 20,
    damping: 1,
    maxSpeed: 12,
    breakDistance: 3,
    angularStiffness: 0,
};
/**
 * Holds objects with a damped spring on velocity.
 *
 * One instance per grabbing hand — a player has one or two, a crane has one.
 * Objects are released explicitly or break away on their own.
 */
export class GrabController {
    #held = new Map();
    get heldBodies() {
        return [...this.#held.keys()];
    }
    isHeld(bodyId) {
        return this.#held.has(bodyId);
    }
    held(bodyId) {
        return this.#held.get(bodyId);
    }
    /** Begins holding a body at a point. */
    grab(bodyId, holdPoint, options = {}) {
        if (!Number.isInteger(bodyId) || bodyId <= 0)
            throw new Error(`A grabbed body id must be a positive whole number (got ${bodyId}).`);
        if (this.#held.has(bodyId))
            throw new Error(`Body ${bodyId} is already held.`);
        const resolved = { ...DEFAULT_GRAB_OPTIONS, ...options };
        if (!(resolved.stiffness > 0))
            throw new Error("Grab stiffness must be positive.");
        if (!(resolved.damping >= 0))
            throw new Error("Grab damping must not be negative.");
        if (!(resolved.maxSpeed > 0))
            throw new Error("Grab max speed must be positive.");
        if (!(resolved.breakDistance > 0))
            throw new Error("Grab break distance must be positive.");
        if (!(resolved.angularStiffness >= 0))
            throw new Error("Grab angular stiffness must not be negative.");
        const object = { bodyId, options: resolved, holdPoint: [...holdPoint], holdRotation: undefined };
        this.#held.set(bodyId, object);
        return object;
    }
    /** Moves where a held object is being held, each frame. */
    moveHold(bodyId, holdPoint, holdRotation) {
        const object = this.#held.get(bodyId);
        if (!object)
            throw new Error(`Body ${bodyId} is not held.`);
        object.holdPoint = [...holdPoint];
        object.holdRotation = holdRotation ? [...holdRotation] : undefined;
    }
    release(bodyId) {
        return this.#held.delete(bodyId);
    }
    releaseAll() {
        this.#held.clear();
    }
    /**
     * Releases a body with an added impulse — a throw.
     *
     * Returned as an impulse rather than a velocity so that mass matters: a
     * thrown crate should travel further than a thrown anvil for the same effort.
     */
    throwObject(bodyId, impulse) {
        if (!this.#held.delete(bodyId))
            throw new Error(`Body ${bodyId} is not held and cannot be thrown.`);
        return [{ type: "applyImpulse", id: bodyId, impulse: [...impulse] }];
    }
    /**
     * Produces this step's hold commands from current body poses.
     *
     * Bodies with no pose are skipped rather than treated as being at the origin,
     * which would yank them across the level on the frame a snapshot is missing.
     */
    update(poses, deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0)
            throw new Error("Grab update requires a positive, finite delta.");
        const commands = [];
        const broken = [];
        for (const object of [...this.#held.values()]) {
            const pose = poses.get(object.bodyId);
            if (!pose)
                continue;
            const toHold = [
                object.holdPoint[0] - pose.position[0],
                object.holdPoint[1] - pose.position[1],
                object.holdPoint[2] - pose.position[2],
            ];
            const distance = Math.hypot(toHold[0], toHold[1], toHold[2]);
            if (distance > object.options.breakDistance) {
                this.#held.delete(object.bodyId);
                broken.push(object.bodyId);
                continue;
            }
            // Critically damped spring on velocity: the target velocity closes the
            // gap over roughly one stiffness-time, minus what the body already has.
            const target = [
                toHold[0] * object.options.stiffness - pose.linearVelocity[0] * object.options.damping,
                toHold[1] * object.options.stiffness - pose.linearVelocity[1] * object.options.damping,
                toHold[2] * object.options.stiffness - pose.linearVelocity[2] * object.options.damping,
            ];
            const speed = Math.hypot(target[0], target[1], target[2]);
            const scale = speed > object.options.maxSpeed ? object.options.maxSpeed / speed : 1;
            commands.push({
                type: "setLinearVelocity",
                id: object.bodyId,
                velocity: [target[0] * scale, target[1] * scale, target[2] * scale],
            });
            if (object.holdRotation && object.options.angularStiffness > 0) {
                const angular = angularVelocityToward(pose.rotation, object.holdRotation, object.options.angularStiffness);
                commands.push({ type: "setAngularVelocity", id: object.bodyId, velocity: angular });
            }
        }
        return { commands, broken };
    }
}
/** Angular velocity that rotates `from` toward `to` at the given rate. */
function angularVelocityToward(from, to, stiffness) {
    // Relative rotation `to * inverse(from)`, converted to an axis-angle rate.
    const [x, y, z, w] = from;
    const inverse = [-x, -y, -z, w];
    const delta = [
        to[3] * inverse[0] + to[0] * inverse[3] + to[1] * inverse[2] - to[2] * inverse[1],
        to[3] * inverse[1] - to[0] * inverse[2] + to[1] * inverse[3] + to[2] * inverse[0],
        to[3] * inverse[2] + to[0] * inverse[1] - to[1] * inverse[0] + to[2] * inverse[3],
        to[3] * inverse[3] - to[0] * inverse[0] - to[1] * inverse[1] - to[2] * inverse[2],
    ];
    // Take the short way round; q and -q are the same rotation.
    const sign = delta[3] < 0 ? -1 : 1;
    const axisLength = Math.hypot(delta[0], delta[1], delta[2]);
    if (axisLength < 1e-6)
        return [0, 0, 0];
    const angle = 2 * Math.atan2(axisLength, Math.abs(delta[3]));
    const rate = (angle * stiffness * sign) / axisLength;
    return [delta[0] * rate, delta[1] * rate, delta[2] * rate];
}
/**
 * A motorised door.
 *
 * Driven by a hinge motor rather than by animation, so the door pushes objects,
 * is blocked by them, and can be held open by a crate — the behaviours that
 * make a physics door worth having over a scripted one.
 */
export class PhysicsDoor {
    jointId;
    #speed;
    #force;
    #travelSeconds;
    #autoCloseSeconds;
    #state = "closed";
    #elapsed = 0;
    #openFor = 0;
    constructor(options) {
        if (!Number.isInteger(options.jointId) || options.jointId <= 0)
            throw new Error("A door needs a positive joint id.");
        this.jointId = options.jointId;
        this.#speed = options.speed ?? 2;
        this.#force = options.force ?? 500;
        this.#travelSeconds = options.travelSeconds ?? 1;
        if (!(this.#speed > 0))
            throw new Error("A door's speed must be positive.");
        if (!(this.#force > 0))
            throw new Error("A door's motor force must be positive.");
        if (!(this.#travelSeconds > 0))
            throw new Error("A door's travel time must be positive.");
        if (options.autoCloseSeconds !== undefined) {
            if (!(options.autoCloseSeconds > 0))
                throw new Error("A door's auto-close time must be positive.");
            this.#autoCloseSeconds = options.autoCloseSeconds;
        }
    }
    get state() {
        return this.#state;
    }
    open() {
        if (this.#state === "open" || this.#state === "opening")
            return;
        this.#state = "opening";
        this.#elapsed = 0;
    }
    close() {
        if (this.#state === "closed" || this.#state === "closing")
            return;
        this.#state = "closing";
        this.#elapsed = 0;
    }
    toggle() {
        if (this.#state === "closed" || this.#state === "closing")
            this.open();
        else
            this.close();
    }
    /** Advances the door and returns the motor commands for this step. */
    update(deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("A door update requires a finite, non-negative delta.");
        if (this.#state === "opening" || this.#state === "closing") {
            this.#elapsed += deltaSeconds;
            const direction = this.#state === "opening" ? 1 : -1;
            if (this.#elapsed >= this.#travelSeconds) {
                this.#state = this.#state === "opening" ? "open" : "closed";
                this.#elapsed = 0;
                this.#openFor = 0;
                // Hold position with the motor rather than releasing it, or a door
                // pushed by a crate would drift shut on its own.
                return [{ type: "setJointMotor", id: this.jointId, targetVelocity: 0, maxForce: this.#force }];
            }
            return [{ type: "setJointMotor", id: this.jointId, targetVelocity: this.#speed * direction, maxForce: this.#force }];
        }
        if (this.#state === "open" && this.#autoCloseSeconds !== undefined) {
            this.#openFor += deltaSeconds;
            if (this.#openFor >= this.#autoCloseSeconds) {
                this.close();
                this.#openFor = 0;
            }
        }
        return [];
    }
}
/**
 * Where a held object should sit, given a viewer.
 *
 * Held in front of the eye at a fixed distance, which is the arrangement that
 * keeps an object visible without letting it clip into the camera.
 */
export function holdPointInFront(eye, forward, distance) {
    if (!(distance > 0))
        throw new Error("A hold distance must be positive.");
    const length = Math.hypot(forward[0], forward[1], forward[2]);
    if (length < 1e-6)
        throw new Error("A hold direction cannot be zero-length.");
    return [
        eye[0] + (forward[0] / length) * distance,
        eye[1] + (forward[1] / length) * distance,
        eye[2] + (forward[2] / length) * distance,
    ];
}
/** A throw impulse from an aim direction and a strength. */
export function throwImpulse(forward, strength) {
    if (!(strength > 0))
        throw new Error("A throw strength must be positive.");
    const length = Math.hypot(forward[0], forward[1], forward[2]);
    if (length < 1e-6)
        throw new Error("A throw direction cannot be zero-length.");
    return [(forward[0] / length) * strength, (forward[1] / length) * strength, (forward[2] / length) * strength];
}
//# sourceMappingURL=interaction.js.map