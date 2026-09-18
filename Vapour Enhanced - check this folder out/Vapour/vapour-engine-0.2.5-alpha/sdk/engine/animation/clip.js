/** Animation clips: sampled channels of transform data over time.
 *
 * A clip is plain data — a list of channels, each a list of keyframes — so it
 * serializes into scene JSON, imports from glTF without translation, and can be
 * generated procedurally by the asset system. Nothing here knows about a
 * skeleton: a clip targets bones *by name*, which is what lets one walk cycle
 * play on every character the generator produces.
 *
 * That indirection is the whole retargeting story. A clip bound to bone indices
 * only works on the exact skeleton it was authored against; a clip bound to
 * names works on anything following the same convention.
 */
import { nlerp } from "@vapour/math";
export function validateClip(clip) {
    if (!clip.name.trim())
        throw new Error("An animation clip requires a non-empty name.");
    if (!(clip.duration > 0))
        throw new Error(`Clip "${clip.name}" requires a positive duration.`);
    if (clip.channels.length === 0)
        throw new Error(`Clip "${clip.name}" has no channels.`);
    for (const channel of clip.channels) {
        if (!channel.target.trim())
            throw new Error(`Clip "${clip.name}" has a channel with no target bone.`);
        if (channel.keyframes.length === 0) {
            throw new Error(`Channel "${channel.target}.${channel.property}" in clip "${clip.name}" has no keyframes.`);
        }
        const components = channel.property === "rotation" ? 4 : 3;
        let previous = -Infinity;
        for (const keyframe of channel.keyframes) {
            if (!Number.isFinite(keyframe.time)) {
                throw new Error(`Channel "${channel.target}.${channel.property}" in clip "${clip.name}" has a non-finite keyframe time.`);
            }
            if (keyframe.time < previous) {
                throw new Error(`Channel "${channel.target}.${channel.property}" in clip "${clip.name}" has keyframes out of order at ${keyframe.time}.`);
            }
            previous = keyframe.time;
            if (keyframe.value.length !== components) {
                throw new Error(`Channel "${channel.target}.${channel.property}" in clip "${clip.name}" expects ${components} components per keyframe but got ${keyframe.value.length}.`);
            }
        }
    }
    return clip;
}
/** Maps a time onto the clip's duration according to its loop mode. */
export function wrapClipTime(clip, time) {
    const loop = clip.loop ?? "once";
    if (loop === "once")
        return Math.min(Math.max(time, 0), clip.duration);
    const cycles = time / clip.duration;
    if (loop === "loop")
        return (((cycles % 1) + 1) % 1) * clip.duration;
    // Ping-pong: even cycles run forward, odd ones back.
    const folded = (((cycles % 2) + 2) % 2);
    return (folded <= 1 ? folded : 2 - folded) * clip.duration;
}
/** Samples one channel at a time already wrapped into the clip's range. */
export function sampleChannel(channel, time) {
    const keys = channel.keyframes;
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (time <= first.time)
        return [...first.value];
    if (time >= last.time)
        return [...last.value];
    // Binary search for the surrounding pair; clips can have hundreds of keys and
    // this runs per bone per frame.
    let low = 0;
    let high = keys.length - 1;
    while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (keys[mid].time <= time)
            low = mid;
        else
            high = mid;
    }
    const a = keys[low];
    const b = keys[high];
    if ((channel.interpolation ?? "linear") === "step")
        return [...a.value];
    const span = b.time - a.time;
    const t = span < 1e-9 ? 0 : (time - a.time) / span;
    if (channel.property === "rotation") {
        // Rotations must interpolate on the sphere; a component-wise lerp of
        // quaternions produces a non-unit rotation that shears the mesh.
        return [...nlerp(a.value, b.value, t)];
    }
    return a.value.map((component, index) => component + (b.value[index] - component) * t);
}
/** Samples every channel into a pose. */
export function samplePose(clip, time, into = new Map()) {
    const wrapped = wrapClipTime(clip, time);
    for (const channel of clip.channels) {
        const value = sampleChannel(channel, wrapped);
        let pose = into.get(channel.target);
        if (!pose) {
            pose = {};
            into.set(channel.target, pose);
        }
        if (channel.property === "rotation")
            pose.rotation = [value[0], value[1], value[2], value[3]];
        else if (channel.property === "position")
            pose.position = [value[0], value[1], value[2]];
        else
            pose.scale = [value[0], value[1], value[2]];
    }
    return into;
}
/**
 * Blends two poses.
 *
 * Bones present in only one pose are taken from it unchanged rather than
 * blended toward a default — blending a bone against an implicit identity is
 * how a partially-authored clip yanks a character's arms to its sides.
 */
export function blendPoses(a, b, weight, into = new Map()) {
    into.clear();
    const t = Math.min(1, Math.max(0, weight));
    const names = new Set([...a.keys(), ...b.keys()]);
    for (const name of names) {
        const left = a.get(name);
        const right = b.get(name);
        if (!left) {
            into.set(name, { ...right });
            continue;
        }
        if (!right) {
            into.set(name, { ...left });
            continue;
        }
        const blended = {};
        if (left.position && right.position) {
            blended.position = [
                left.position[0] + (right.position[0] - left.position[0]) * t,
                left.position[1] + (right.position[1] - left.position[1]) * t,
                left.position[2] + (right.position[2] - left.position[2]) * t,
            ];
        }
        else if (left.position ?? right.position) {
            blended.position = [...(right.position ?? left.position)];
        }
        if (left.rotation && right.rotation)
            blended.rotation = nlerp(left.rotation, right.rotation, t);
        else if (left.rotation ?? right.rotation)
            blended.rotation = [...(right.rotation ?? left.rotation)];
        if (left.scale && right.scale) {
            blended.scale = [
                left.scale[0] + (right.scale[0] - left.scale[0]) * t,
                left.scale[1] + (right.scale[1] - left.scale[1]) * t,
                left.scale[2] + (right.scale[2] - left.scale[2]) * t,
            ];
        }
        else if (left.scale ?? right.scale) {
            blended.scale = [...(right.scale ?? left.scale)];
        }
        into.set(name, blended);
    }
    return into;
}
/**
 * Restricts a pose to a set of bones.
 *
 * Masks are what make layers useful: an "aim" layer masked to the spine and
 * arms plays over a walk cycle without disturbing the legs.
 */
export function maskPose(pose, allowed, into = new Map()) {
    into.clear();
    for (const [name, bone] of pose) {
        if (allowed.has(name))
            into.set(name, bone);
    }
    return into;
}
/** A clip built from a single pose, useful as a default or a rest state. */
export function poseClip(name, pose, duration = 1) {
    const channels = [];
    for (const [target, bone] of pose) {
        if (bone.position)
            channels.push({ target, property: "position", keyframes: [{ time: 0, value: [...bone.position] }] });
        if (bone.rotation)
            channels.push({ target, property: "rotation", keyframes: [{ time: 0, value: [...bone.rotation] }] });
        if (bone.scale)
            channels.push({ target, property: "scale", keyframes: [{ time: 0, value: [...bone.scale] }] });
    }
    return validateClip({ name, duration, channels, loop: "loop" });
}
/** Bones a clip drives, for building masks and for validation. */
export function clipTargets(clip) {
    return [...new Set(clip.channels.map((channel) => channel.target))].sort();
}
/**
 * Bones a clip targets that a skeleton does not provide.
 *
 * Reported rather than ignored: a clip silently doing nothing because its bone
 * names do not match is one of the hardest animation bugs to notice.
 */
export function missingTargets(clip, boneNames) {
    const available = new Set(boneNames);
    return clipTargets(clip).filter((target) => !available.has(target));
}
//# sourceMappingURL=clip.js.map