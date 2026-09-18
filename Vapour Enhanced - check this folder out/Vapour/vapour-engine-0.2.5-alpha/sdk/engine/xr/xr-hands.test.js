import { describe, expect, it } from "vitest";
import { Diagnostics } from "../diagnostics/counters.js";
import { HandPoseRecognizer, XrHaptics, fingerCurl } from "./xr-hands.js";
import { debugXrFrame, detectXrCapabilities, diagnoseXrCapabilities, formatXrDebug, inspectSession, setFoveation } from "./xr-capabilities.js";
import { syntheticXrFrame } from "./xr-rig.js";
/** Mirage M107: haptics, hand poses, foveation, capability detection, debugging. */
function joint(name, x, y, z) {
    const transform = new Float32Array(16);
    transform[0] = 1;
    transform[5] = 1;
    transform[10] = 1;
    transform[15] = 1;
    transform[12] = x;
    transform[13] = y;
    transform[14] = z;
    return { name, transform, radius: 0.01 };
}
/** A hand along +X with fingers extended straight (curl 0) or folded back (curl ~1). */
function hand(curls, pinchDistance = 0.1) {
    const joints = [];
    const fingers = [["thumb", curls.thumb ?? 0], ["index-finger", curls.index ?? 0], ["middle-finger", curls.middle ?? 0], ["ring-finger", curls.ring ?? 0], ["pinky-finger", curls.pinky ?? 0]];
    fingers.forEach(([finger, curl], row) => {
        const segments = ["metacarpal", "phalanx-proximal", "phalanx-intermediate", "phalanx-distal", "tip"];
        // Four 2 cm segments. Curl folds the last three back so a full curl puts
        // the tip on the base joint.
        let x = 0;
        const z = row * 0.02;
        segments.forEach((segment, index) => {
            if (index > 0)
                x += index === 1 ? 0.02 : 0.02 * (1 - (4 / 3) * curl);
            joints.push(joint(`${finger}-${segment}`, x, 0, z));
        });
    });
    // Put the thumb tip `pinchDistance` from the index tip.
    const indexTip = joints.find((entry) => entry.name === "index-finger-tip");
    const thumbTip = joints.find((entry) => entry.name === "thumb-tip");
    thumbTip.transform[12] = indexTip.transform[12];
    thumbTip.transform[13] = indexTip.transform[13];
    thumbTip.transform[14] = indexTip.transform[14] - pinchDistance;
    return { handedness: "right", targetRayMode: "tracked-pointer", profiles: [], targetRayTransform: undefined, gripTransform: undefined, buttons: [], axes: new Float32Array(), joints };
}
describe("hand poses", () => {
    it("computes finger curl from joint geometry", () => {
        const straight = new Map(hand({}).joints.map((entry) => [entry.name, entry]));
        const folded = new Map(hand({ index: 1 }).joints.map((entry) => [entry.name, entry]));
        expect(fingerCurl(straight, "index-finger")).toBeCloseTo(0);
        expect(fingerCurl(folded, "index-finger")).toBeGreaterThan(0.6);
        expect(fingerCurl(new Map(), "index-finger")).toBeUndefined();
    });
    it("recognises open, fist, point, and pinch", () => {
        const recognizer = new HandPoseRecognizer();
        expect(recognizer.update(hand({})).pose).toBe("open");
        expect(recognizer.update(hand({ index: 1, middle: 1, ring: 1, pinky: 1 })).pose).toBe("fist");
        expect(recognizer.update(hand({ middle: 1, ring: 1, pinky: 1 })).pose).toBe("point");
        expect(recognizer.update(hand({}, 0.01)).pose).toBe("pinch");
        expect(recognizer.update({ ...hand({}), joints: [] })).toMatchObject({ pose: undefined, tracked: false });
    });
    it("holds a pinch inside the hysteresis band and releases past it", () => {
        const recognizer = new HandPoseRecognizer({ pinchEngage: 0.02, pinchRelease: 0.035 });
        expect(recognizer.update(hand({}, 0.03)).pose).toBe("open");
        expect(recognizer.update(hand({}, 0.015)).pose).toBe("pinch");
        // 3 cm is above engage but below release: still pinching.
        expect(recognizer.update(hand({}, 0.03)).pose).toBe("pinch");
        expect(recognizer.update(hand({}, 0.04)).pose).toBe("open");
        expect(recognizer.pose("right")).toBe("open");
        expect(() => new HandPoseRecognizer({ pinchEngage: 0.05, pinchRelease: 0.02 })).toThrow(/flicker/);
    });
});
describe("haptics", () => {
    it("queues, merges per hand, plays through the actuator, and counts", async () => {
        const played = [];
        const haptics = new XrHaptics(async (hand, intensity, duration) => { played.push([hand, intensity, duration]); return true; });
        haptics.pulse("right", 0.3, 20);
        haptics.pulse("right", 0.8, 10);
        haptics.pulse("left", 0.5, 30);
        expect(haptics.stats().queued).toBe(3);
        await haptics.flush();
        expect(played).toEqual([["right", 0.8, 20], ["left", 0.5, 30]]);
        expect(haptics.stats()).toEqual({ queued: 0, played: 2, dropped: 0, unsupported: 0 });
    });
    it("no-ops on a device without an actuator and drops past the per-hand cap", async () => {
        const haptics = new XrHaptics(async () => false, { maxPerHand: 2 });
        haptics.pulse("left", 1, 10);
        haptics.pulse("left", 1, 10);
        haptics.pulse("left", 1, 10);
        await haptics.flush();
        expect(haptics.stats()).toMatchObject({ dropped: 1, unsupported: 1, played: 0 });
        const throwing = new XrHaptics(async () => { throw new Error("no device"); });
        throwing.pulse("right", 0.5, 5);
        await expect(throwing.flush()).resolves.toBeUndefined();
        expect(throwing.stats().unsupported).toBe(1);
        expect(() => haptics.pulse("left", 2, 10)).toThrow(/\[0, 1\]/);
    });
});
describe("capabilities and debugging", () => {
    it("detects XR support and produces diagnostics for a stripped-down browser", async () => {
        const none = await detectXrCapabilities({});
        expect(none.webxr).toBe(false);
        expect(diagnoseXrCapabilities(none)[0]?.code).toBe("xr.unavailable");
        const fake = { navigator: { xr: { isSessionSupported: async (mode) => mode === "immersive-vr" } }, XRWebGLLayer: class {
            } };
        const some = await detectXrCapabilities(fake);
        expect(some.modes).toEqual({ inline: false, "immersive-vr": true, "immersive-ar": false });
        expect(some.webgpuBinding).toBe(false);
        expect(some.webglLayer).toBe(true);
        const diagnostics = diagnoseXrCapabilities(some);
        expect(diagnostics.map((entry) => [entry.code, entry.severity])).toEqual([["xr.webgpu-binding-unavailable", "warning"]]);
    });
    it("reports session-level features and foveation honestly", () => {
        const layerWithFoveation = { fixedFoveation: 0 };
        const report = setFoveation(layerWithFoveation, 2);
        expect(report).toEqual({ supported: true, requested: 2, applied: 2 / 3 });
        expect(setFoveation({}, 3)).toEqual({ supported: false, requested: 3, applied: undefined });
        expect(() => setFoveation(layerWithFoveation, 5)).toThrow(/0, 1, 2, or 3/);
        const session = inspectSession({ enabledFeatures: ["local-floor", "hand-tracking"], inputSources: [], renderState: { layers: [layerWithFoveation] } }, "immersive-vr", "local-floor", report);
        expect(session.handTracking).toBe(true);
        expect(session.layers).toBe(true);
        expect(session.foveation.applied).toBeCloseTo(2 / 3);
        const bare = inspectSession({ inputSources: [{ hand: {} }] }, "immersive-vr", "local");
        expect(bare.handTracking).toBe(true);
        expect(bare.foveation.supported).toBe(false);
    });
    it("summarises a frame into diagnostics counters and a one-line string", () => {
        const diagnostics = new Diagnostics({ now: () => 0 });
        const frame = { ...syntheticXrFrame({ headPosition: [0, 1.6, 0], time: 1016 }), inputs: [hand({}), { ...hand({}), handedness: "left", joints: [], buttons: [{ value: 1, pressed: true, touched: true }], axes: new Float32Array([0.25, -0.5]) }] };
        const snapshot = debugXrFrame(frame, diagnostics, 1000);
        expect(snapshot.views).toBe(2);
        expect(snapshot.inputs[1]).toMatchObject({ hand: "left", buttonsPressed: 1, axes: [0.25, -0.5], joints: 0 });
        expect(diagnostics.counter("xr.trackedHands").value).toBe(1);
        expect(diagnostics.counter("xr.frameTime").value).toBe(16);
        expect(formatXrDebug(snapshot)).toBe("xr t=1016 visible views=2 head=[0.00, 1.60, 0.00] right:tracked-pointer(25j) b0 left:tracked-pointer b1");
    });
});
//# sourceMappingURL=xr-hands.test.js.map