/**
 * The nearest target a ray hits.
 *
 * Targets are spheres rather than meshes deliberately: a pointer needs to be
 * forgiving, and precise mesh intersection makes small controls almost
 * impossible to hit with a tremoring hand.
 */
export function raycastTargets(pose, targets, options = {}) {
    const maxDistance = options.maxDistance ?? 10;
    const softness = options.softness ?? 0.035;
    if (!(maxDistance > 0))
        throw new Error("A ray max distance must be positive.");
    if (!(softness >= 0))
        throw new Error("Ray softness must not be negative.");
    const direction = normalize(pose.forward);
    let best;
    let bestScore = Infinity;
    let bestPriority = -Infinity;
    for (const target of targets) {
        if (!(target.radius > 0))
            throw new Error(`Ray target "${target.id}" needs a positive radius.`);
        const toTarget = subtract(target.position, pose.position);
        const along = dot(toTarget, direction);
        if (along <= 0 || along > maxDistance)
            continue;
        const closest = add(pose.position, scale(direction, along));
        const offset = length(subtract(target.position, closest));
        // The cone widens with distance, so a distant target is as easy to hit as a
        // near one of the same apparent size.
        const allowed = target.radius + softness * along;
        if (offset > allowed)
            continue;
        const priority = target.priority ?? 0;
        if (priority < bestPriority)
            continue;
        if (priority === bestPriority && along >= bestScore)
            continue;
        bestPriority = priority;
        bestScore = along;
        best = { id: target.id, distance: along, point: closest };
    }
    return best;
}
/**
 * Grabbing with one or two hands.
 *
 * Two-handed manipulation is included because it is the natural way to scale
 * and rotate an object in VR — pulling your hands apart to make something
 * bigger is a gesture people try unprompted — and because retrofitting it means
 * changing how single-handed grabs store their offsets.
 */
export class XrGrabController {
    #grabs = new Map();
    #twoHandedStart;
    get held() {
        return [...this.#grabs.values()];
    }
    heldBy(hand) {
        return this.#grabs.get(hand);
    }
    isHeld(id) {
        return [...this.#grabs.values()].some((grab) => grab.id === id);
    }
    /** True when both hands hold the same object. */
    get twoHanded() {
        const left = this.#grabs.get("left");
        const right = this.#grabs.get("right");
        return left !== undefined && right !== undefined && left.id === right.id;
    }
    /** Grabs whatever is within reach of the hand, if anything. */
    grabDirect(hand, pose, grabbables) {
        let best;
        let bestDistance = Infinity;
        for (const candidate of grabbables) {
            const distance = length(subtract(candidate.position, pose.position));
            if (distance > candidate.radius || distance >= bestDistance)
                continue;
            bestDistance = distance;
            best = candidate;
        }
        if (!best)
            return undefined;
        return this.#begin(hand, best.id, "direct", subtract(best.position, pose.position), bestDistance);
    }
    /** Grabs the target a ray is pointing at, keeping it at its current distance. */
    grabByRay(hand, pose, targets, options) {
        const hit = raycastTargets(pose, targets, options);
        if (!hit)
            return undefined;
        const target = targets.find((candidate) => candidate.id === hit.id);
        return this.#begin(hand, hit.id, "ray", subtract(target.position, pose.position), hit.distance);
    }
    release(hand) {
        const grab = this.#grabs.get(hand);
        if (!grab)
            return undefined;
        this.#grabs.delete(hand);
        this.#twoHandedStart = undefined;
        return grab.id;
    }
    releaseAll() {
        this.#grabs.clear();
        this.#twoHandedStart = undefined;
    }
    /**
     * Where a held object should be this frame.
     *
     * Returns a position rather than moving anything, so the caller decides
     * whether to snap it there (a UI panel) or drive it with physics (a crate).
     */
    resolve(hand, pose) {
        const grab = this.#grabs.get(hand);
        if (!grab)
            return undefined;
        if (grab.mode === "direct")
            return add(pose.position, grab.offset);
        // Ray grabs follow the ray at their captured distance, which is what makes
        // a distant object feel attached to the pointer rather than reeled in.
        return add(pose.position, scale(normalize(pose.forward), grab.rayDistance));
    }
    /**
     * The transform two hands imply for the object they both hold.
     *
     * Position is the midpoint, scale is the change in separation, and yaw is the
     * change in the angle between them — the three degrees of freedom people
     * actually use two hands for.
     */
    resolveTwoHanded(left, right) {
        if (!this.twoHanded) {
            this.#twoHandedStart = undefined;
            return undefined;
        }
        const separation = length(subtract(right.position, left.position));
        const angle = Math.atan2(right.position[2] - left.position[2], right.position[0] - left.position[0]);
        const id = this.#grabs.get("left").id;
        if (!this.#twoHandedStart || this.#twoHandedStart.id !== id) {
            this.#twoHandedStart = { separation: Math.max(separation, 1e-4), angle, id };
        }
        return {
            position: scale(add(left.position, right.position), 0.5),
            scale: separation / this.#twoHandedStart.separation,
            yaw: wrapAngle(angle - this.#twoHandedStart.angle),
        };
    }
    #begin(hand, id, mode, offset, rayDistance) {
        const grab = { id, hand, mode, offset, rayDistance };
        this.#grabs.set(hand, grab);
        // A second hand joining resets the two-handed reference, so scale starts
        // at one rather than jumping.
        this.#twoHandedStart = undefined;
        return grab;
    }
}
/**
 * Smooth and snap locomotion with comfort fades.
 *
 * Snap turning is the default because smooth turning is the single most common
 * cause of simulator sickness, and the snap's brief fade is what keeps even the
 * snap comfortable. Games that want smooth turning should offer both — this
 * exposes the choice rather than picking for the player.
 */
export class XrLocomotion {
    #options;
    #position = [0, 0, 0];
    #yaw = 0;
    #fade = 0;
    #fadeRemaining = 0;
    #pendingYaw = 0;
    #pendingTeleport;
    #turnHeld = false;
    constructor(options = {}) {
        this.#options = {
            turnStyle: options.turnStyle ?? "snap",
            snapDegrees: options.snapDegrees ?? 30,
            smoothTurnSpeed: options.smoothTurnSpeed ?? 90,
            moveSpeed: options.moveSpeed ?? 2.5,
            moveReference: options.moveReference ?? "head",
            comfortFadeSeconds: options.comfortFadeSeconds ?? 0.1,
            deadZone: options.deadZone ?? 0.2,
        };
        if (!(this.#options.snapDegrees > 0))
            throw new Error("A snap turn must be a positive number of degrees.");
        if (!(this.#options.moveSpeed >= 0))
            throw new Error("A locomotion move speed must not be negative.");
        if (!(this.#options.deadZone >= 0 && this.#options.deadZone < 1))
            throw new Error("A locomotion dead zone must lie in [0, 1).");
        if (!(this.#options.comfortFadeSeconds >= 0))
            throw new Error("A comfort fade must not be negative.");
    }
    get position() {
        return this.#position;
    }
    get yaw() {
        return this.#yaw;
    }
    /** Fade opacity in `[0, 1]`, for the comfort blink. */
    get fade() {
        return this.#fade;
    }
    setPosition(position) {
        this.#position = [position[0], position[1], position[2]];
    }
    /** Queues a teleport, which takes effect at the midpoint of the fade. */
    teleport(destination) {
        this.#pendingTeleport = [destination[0], destination[1], destination[2]];
        this.#fadeRemaining = this.#options.comfortFadeSeconds;
        if (this.#options.comfortFadeSeconds === 0)
            this.#commitTeleport();
    }
    update(input, headForward, deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("Locomotion requires a finite, non-negative delta.");
        let turned = false;
        // Turn input is read *before* the fade is advanced, so a snap and its blink
        // begin on the same frame. Advancing the fade first delays it by a frame,
        // which reads as the world turning slightly before the blink covers it.
        const turnX = this.#applyDeadZone(input.turnX ?? 0);
        if (this.#options.turnStyle === "snap") {
            // One turn per push: a held stick that snapped every frame would spin.
            if (turnX !== 0 && !this.#turnHeld) {
                this.#pendingYaw = -Math.sign(turnX) * (this.#options.snapDegrees * Math.PI) / 180;
                if (this.#options.comfortFadeSeconds > 0)
                    this.#fadeRemaining = this.#options.comfortFadeSeconds;
                else {
                    this.#yaw = wrapAngle(this.#yaw + this.#pendingYaw);
                    this.#pendingYaw = 0;
                    turned = true;
                }
            }
            this.#turnHeld = turnX !== 0;
        }
        else if (turnX !== 0) {
            this.#yaw = wrapAngle(this.#yaw - turnX * (this.#options.smoothTurnSpeed * Math.PI) / 180 * deltaSeconds);
            turned = true;
        }
        // Comfort fade: the teleport or snap lands halfway through, so the player
        // never sees the world move.
        if (this.#fadeRemaining > 0) {
            const total = this.#options.comfortFadeSeconds;
            this.#fadeRemaining = Math.max(0, this.#fadeRemaining - deltaSeconds);
            const progress = 1 - this.#fadeRemaining / total;
            this.#fade = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
            if (progress >= 0.5) {
                if (this.#pendingTeleport)
                    this.#commitTeleport();
                if (this.#pendingYaw !== 0) {
                    this.#yaw = wrapAngle(this.#yaw + this.#pendingYaw);
                    this.#pendingYaw = 0;
                    turned = true;
                }
            }
            if (this.#fadeRemaining === 0)
                this.#fade = 0;
        }
        const moveX = this.#applyDeadZone(input.moveX ?? 0);
        const moveY = this.#applyDeadZone(input.moveY ?? 0);
        if (moveX !== 0 || moveY !== 0) {
            // Movement follows where the player is looking, flattened to the ground.
            // Ignoring head orientation is the other classic comfort failure.
            const flat = normalize([headForward[0], 0, headForward[2]]);
            const right = [-flat[2], 0, flat[0]];
            const speed = this.#options.moveSpeed * deltaSeconds;
            this.#position = [
                this.#position[0] + (right[0] * moveX + flat[0] * moveY) * speed,
                this.#position[1],
                this.#position[2] + (right[2] * moveX + flat[2] * moveY) * speed,
            ];
        }
        return { position: this.#position, yaw: this.#yaw, fade: this.#fade, turned };
    }
    #commitTeleport() {
        if (!this.#pendingTeleport)
            return;
        this.#position = this.#pendingTeleport;
        this.#pendingTeleport = undefined;
    }
    /** Rescales from the dead-zone edge, so the usable range still spans 0 to 1. */
    #applyDeadZone(value) {
        const magnitude = Math.abs(value);
        if (magnitude <= this.#options.deadZone)
            return 0;
        const scaled = (magnitude - this.#options.deadZone) / (1 - this.#options.deadZone);
        return Math.sign(value) * Math.min(1, scaled);
    }
}
/**
 * A ballistic teleport arc.
 *
 * An arc rather than a straight ray because it lets a player aim at the floor
 * without pointing straight down, and because its landing point is visible
 * before committing — which is what makes teleport comfortable in the first
 * place. Validity is decided by an injected predicate, so a navmesh, a physics
 * raycast, or a simple height test all work.
 */
export function teleportArc(pose, isValidLanding, groundHeightAt, options = {}) {
    const speed = options.speed ?? 8;
    const gravity = options.gravity ?? -9.81;
    const steps = options.steps ?? 24;
    const maxTime = options.maxTime ?? 2;
    if (!(speed > 0))
        throw new Error("A teleport arc speed must be positive.");
    if (!Number.isInteger(steps) || steps < 2)
        throw new Error("A teleport arc needs at least two steps.");
    const direction = normalize(pose.forward);
    const velocity = scale(direction, speed);
    const points = [pose.position];
    for (let step = 1; step <= steps; step += 1) {
        const t = (step / steps) * maxTime;
        const point = [
            pose.position[0] + velocity[0] * t,
            pose.position[1] + velocity[1] * t + 0.5 * gravity * t * t,
            pose.position[2] + velocity[2] * t,
        ];
        const ground = groundHeightAt(point[0], point[2]);
        if (ground !== undefined && point[1] <= ground) {
            const landing = [point[0], ground, point[2]];
            points.push(landing);
            const valid = isValidLanding(landing);
            return { points, destination: valid ? landing : undefined, valid };
        }
        points.push(point);
    }
    return { points, destination: undefined, valid: false };
}
function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function subtract(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a, factor) {
    return [a[0] * factor, a[1] * factor, a[2] * factor];
}
function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function length(a) {
    return Math.hypot(a[0], a[1], a[2]);
}
function normalize(a) {
    const magnitude = length(a);
    if (magnitude < 1e-9)
        return [0, 0, -1];
    return [a[0] / magnitude, a[1] / magnitude, a[2] / magnitude];
}
function wrapAngle(radians) {
    const wrapped = ((radians + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return wrapped === -Math.PI ? Math.PI : wrapped;
}
//# sourceMappingURL=interaction.js.map