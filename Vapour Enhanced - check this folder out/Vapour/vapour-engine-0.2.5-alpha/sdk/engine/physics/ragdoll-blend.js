/** Ragdoll runtime blend: fading a character between an animated pose and its
 * physics-driven ragdoll bodies.
 *
 * Ragdoll *joints* (see `ragdollJoints` in `physics-3d.ts`) are built once,
 * from the skeleton, when a character is set up. What happens every frame
 * *after* that — a hit ramping a character from animation into physics, and
 * physics ramping back into animation once it recovers — is what lives here.
 *
 * The blend runs in world space and converts back to the skeleton's local
 * pose space, because that is the space `Pose` (and therefore skinning)
 * expects. Only bones a caller supplies a ragdoll transform for are touched;
 * everything else passes the animated pose through untouched, so a partial
 * ragdoll (legs only, say) leaves the rest of the character animating.
 */
import { compose, decompose, invert, multiplyMat4, multiplyQuat, invertQuat, nlerp } from "@vapour/math";
import { poseMatrices } from "../animation/skinning.js";
function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}
/**
 * Blends an animated pose with dynamic ragdoll body transforms, per bone.
 *
 * A bone with no ragdoll transform, or a weight of `0`, keeps its animated
 * local pose exactly — no world round-trip, no floating-point drift — which
 * is what makes weight `0` reproduce pure animation precisely rather than
 * merely approximately.
 */
export function blendRagdollPose(skeleton, animatedPose, ragdollTransforms, weights, into = new Map()) {
    into.clear();
    for (const [bone, pose] of animatedPose)
        into.set(bone, { ...pose });
    const animatedWorld = poseMatrices(skeleton, animatedPose);
    const blendedWorld = new Array(skeleton.bones.length);
    for (const [index, bone] of skeleton.bones.entries()) {
        const transform = ragdollTransforms.get(bone.name);
        const weight = transform ? clamp01(weights.get(bone.name) ?? 0) : 0;
        if (weight <= 0) {
            // Untouched: keep the animated world matrix so a child bone's own
            // blend still has a correct parent to work from, and leave the local
            // pose as the clone of the animated pose already in `into`.
            blendedWorld[index] = animatedWorld[index];
            continue;
        }
        if (weight >= 1) {
            blendedWorld[index] = compose(transform.position, transform.rotation, [1, 1, 1]);
        }
        else {
            const animated = decompose(animatedWorld[index]);
            blendedWorld[index] = compose(lerpVec3(animated.translation, transform.position, weight), nlerp(animated.rotation, transform.rotation, weight), animated.scale);
        }
        // The bone's *local* pose only needs recomputing when the blend actually
        // touched it; everything else stays the clone of the animated pose.
        const parent = bone.parent;
        const parentWorld = parent === -1 ? undefined : blendedWorld[parent];
        const local = parentWorld ? multiplyLocal(parentWorld, blendedWorld[index]) : blendedWorld[index];
        const decomposed = decompose(local);
        into.set(bone.name, { position: decomposed.translation, rotation: decomposed.rotation, scale: decomposed.scale });
    }
    return into;
}
function lerpVec3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function multiplyLocal(parentWorld, world) {
    return multiplyMat4(invert(parentWorld), world);
}
/**
 * Computes, for each bound bone, the world transform and velocity the
 * animated pose had at the instant ragdoll activates.
 *
 * A caller feeds these into the physics bridge (`setKinematicTarget` /
 * `setLinearVelocity` / `setAngularVelocity`, or directly into the dynamic
 * body's initial state) *before* handing the bone over to the solver.
 */
export function ragdollActivationTargets(skeleton, bones, poseNow, posePrevious, dt) {
    if (!(dt > 0))
        throw new Error("Ragdoll activation requires a positive timestep between the two poses.");
    const worldNow = poseMatrices(skeleton, poseNow);
    const worldPrevious = poseMatrices(skeleton, posePrevious);
    const indexByName = new Map(skeleton.bones.map((bone, index) => [bone.name, index]));
    const targets = [];
    for (const name of bones) {
        const index = indexByName.get(name);
        if (index === undefined)
            continue;
        const now = decompose(worldNow[index]);
        const previous = decompose(worldPrevious[index]);
        targets.push({
            bone: name,
            position: now.translation,
            rotation: now.rotation,
            linearVelocity: [
                (now.translation[0] - previous.translation[0]) / dt,
                (now.translation[1] - previous.translation[1]) / dt,
                (now.translation[2] - previous.translation[2]) / dt,
            ],
            angularVelocity: angularVelocityFromQuats(previous.rotation, now.rotation, dt),
        });
    }
    return targets;
}
/** Small-angle angular velocity between two orientations one `dt` apart. */
function angularVelocityFromQuats(from, to, dt) {
    let delta = multiplyQuat(to, invertQuat(from));
    // Shortest path: a quaternion and its negation represent the same rotation.
    if (delta[3] < 0)
        delta = [-delta[0], -delta[1], -delta[2], -delta[3]];
    return [(2 * delta[0]) / dt, (2 * delta[1]) / dt, (2 * delta[2]) / dt];
}
/** Linear ramp, clamped to `[0, 1]`; `duration <= 0` snaps immediately to `1`. */
export function rampWeight(elapsed, duration) {
    if (duration <= 0)
        return 1;
    return clamp01(elapsed / duration);
}
/**
 * Drives one character's ragdoll ramp and hand-off state.
 *
 * A small stateful wrapper around the pure functions above: it owns nothing
 * but a phase and an elapsed time, and every frame's blended pose is still
 * computed by {@link blendRagdollPose}, so the state machine stays testable
 * without a physics world.
 */
export class RagdollBlendController {
    #bones;
    #boneWeights;
    #rampIn;
    #rampOut;
    #phase = "animated";
    #elapsed = 0;
    constructor(bones, options = {}) {
        if (bones.length === 0)
            throw new Error("A ragdoll blend needs at least one bone.");
        this.#bones = bones;
        this.#boneWeights = options.boneWeights ?? new Map(bones.map((bone) => [bone, 1]));
        this.#rampIn = options.rampInSeconds ?? 0.25;
        this.#rampOut = options.rampOutSeconds ?? 0.4;
        if (this.#rampIn < 0 || this.#rampOut < 0)
            throw new Error("Ragdoll ramp durations must be non-negative.");
    }
    get phase() {
        return this.#phase;
    }
    /** The current effective weight for one bone: `0` animation, `1` ragdoll. */
    weight(bone) {
        const target = this.#boneWeights.get(bone) ?? 0;
        if (this.#phase === "animated")
            return 0;
        if (this.#phase === "ragdoll")
            return target;
        const ramp = rampWeight(this.#elapsed, this.#phase === "activatingRagdoll" ? this.#rampIn : this.#rampOut);
        return this.#phase === "activatingRagdoll" ? target * ramp : target * (1 - ramp);
    }
    /** Every bound bone's current weight, for {@link blendRagdollPose}. */
    weights() {
        return new Map(this.#bones.map((bone) => [bone, this.weight(bone)]));
    }
    /**
     * Hands control to physics: starts (or restarts) the ramp into ragdoll and
     * returns the kinematic targets each bound body should start from, so the
     * transition carries the animated pose's momentum.
     */
    activate(skeleton, poseNow, posePrevious, dt) {
        this.#phase = this.#rampIn > 0 ? "activatingRagdoll" : "ragdoll";
        this.#elapsed = 0;
        return ragdollActivationTargets(skeleton, this.#bones, poseNow, posePrevious, dt);
    }
    /** Starts blending the animated pose back in. */
    recover() {
        if (this.#phase === "animated")
            return;
        this.#phase = this.#rampOut > 0 ? "recoveringToAnimation" : "animated";
        this.#elapsed = 0;
    }
    /** Advances the ramp by `dt`. Returns `true` on the frame recovery
     * completes and control returns fully to the animator. */
    advance(dt) {
        if (this.#phase === "animated" || this.#phase === "ragdoll")
            return false;
        this.#elapsed += dt;
        if (this.#phase === "activatingRagdoll" && this.#elapsed >= this.#rampIn) {
            this.#phase = "ragdoll";
            this.#elapsed = 0;
        }
        else if (this.#phase === "recoveringToAnimation" && this.#elapsed >= this.#rampOut) {
            this.#phase = "animated";
            this.#elapsed = 0;
            return true;
        }
        return false;
    }
    /** This frame's blended pose. */
    blend(skeleton, animatedPose, ragdollTransforms, into) {
        return blendRagdollPose(skeleton, animatedPose, ragdollTransforms, this.weights(), into);
    }
}
//# sourceMappingURL=ragdoll-blend.js.map