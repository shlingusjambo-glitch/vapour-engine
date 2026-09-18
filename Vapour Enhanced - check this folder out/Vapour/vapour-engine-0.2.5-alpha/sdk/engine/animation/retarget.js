import { validateSkinnedSkeleton, } from "./skinning.js";
export function buildRetargetMap(source, target, options = {}) {
    validateSkinnedSkeleton(source);
    validateSkinnedSkeleton(target);
    assertUniqueNames(source, "source");
    assertUniqueNames(target, "target");
    const targetByName = new Map(target.bones.map((bone) => [bone.name, bone]));
    const targetByCanonical = new Map();
    for (const bone of target.bones)
        targetByCanonical.set(canonicalBoneName(bone.name), bone);
    const usedTargets = new Set();
    const entries = new Map();
    for (const sourceBone of source.bones) {
        const requested = options.boneMap?.[sourceBone.name];
        const targetBone = requested === undefined
            ? (targetByName.get(sourceBone.name) ??
                targetByCanonical.get(canonicalBoneName(sourceBone.name)))
            : targetByName.get(requested);
        if (requested !== undefined && targetBone === undefined)
            throw new Error(`Retarget map sends source bone "${sourceBone.name}" to missing target bone "${requested}".`);
        if (!targetBone)
            continue;
        if (usedTargets.has(targetBone.name))
            throw new Error(`More than one source bone maps to target bone "${targetBone.name}".`);
        usedTargets.add(targetBone.name);
        entries.set(sourceBone.name, {
            source: sourceBone.name,
            target: targetBone.name,
            translationScale: options.scaleTranslation === false
                ? 1
                : boneScale(sourceBone, targetBone, source, target),
        });
    }
    return {
        entries,
        unmappedSource: source.bones
            .map((bone) => bone.name)
            .filter((name) => !entries.has(name)),
        unmappedTarget: target.bones
            .map((bone) => bone.name)
            .filter((name) => !usedTargets.has(name)),
    };
}
/** Retargets local-space animation while retaining the target rest pose.
 * Rotations and scales transfer directly; translation transfers as an offset
 * from the source rest transform and is proportionally scaled. */
export function retargetPose(pose, source, target, options = {}, into = new Map()) {
    const map = buildRetargetMap(source, target, options);
    const sourceByName = new Map(source.bones.map((bone) => [bone.name, bone]));
    const targetByName = new Map(target.bones.map((bone) => [bone.name, bone]));
    into.clear();
    for (const [sourceName, sourcePose] of pose) {
        const entry = map.entries.get(sourceName);
        if (!entry)
            continue;
        const sourceBone = sourceByName.get(sourceName);
        const targetBone = targetByName.get(entry.target);
        const result = {};
        if (sourcePose.position) {
            result.position = [0, 1, 2].map((axis) => targetBone.position[axis] +
                (sourcePose.position[axis] - sourceBone.position[axis]) *
                    entry.translationScale);
        }
        if (sourcePose.rotation)
            result.rotation = [...sourcePose.rotation];
        if (sourcePose.scale)
            result.scale = [...sourcePose.scale];
        into.set(entry.target, result);
    }
    return into;
}
/** Normalizes common exporter prefixes and separators without guessing
 * semantic aliases such as "pelvis" → "hips"; those belong in `boneMap`. */
export function canonicalBoneName(name) {
    return name
        .toLowerCase()
        .replace(/^mixamorig[:_]?/, "")
        .replace(/[^a-z0-9]/g, "");
}
function boneScale(sourceBone, targetBone, source, target) {
    const sourceLength = Math.hypot(...sourceBone.position);
    const targetLength = Math.hypot(...targetBone.position);
    if (sourceLength > 1e-6 && targetLength > 1e-6)
        return targetLength / sourceLength;
    return skeletonExtent(target) / Math.max(skeletonExtent(source), 1e-6);
}
function skeletonExtent(skeleton) {
    let extent = 0;
    for (const bone of skeleton.bones)
        extent = Math.max(extent, Math.hypot(...bone.position));
    return extent || 1;
}
function assertUniqueNames(skeleton, label) {
    const names = new Set();
    for (const bone of skeleton.bones) {
        if (!bone.name.trim())
            throw new Error(`The ${label} skeleton contains a bone with an empty name.`);
        if (names.has(bone.name))
            throw new Error(`The ${label} skeleton contains duplicate bone name "${bone.name}".`);
        names.add(bone.name);
    }
}
//# sourceMappingURL=retarget.js.map