import { describe, expect, it, vi } from "vitest";
import { AudioEngine, dopplerRatio } from "./audio.js";
class Param {
    value = 1;
    cancelScheduledValues() { }
    setValueAtTime(value) {
        this.value = value;
    }
}
class Node {
    connected = [];
    connect(node) {
        this.connected.push(node);
        return node;
    }
    disconnect() {
        this.connected = [];
    }
}
class Gain extends Node {
    gain = new Param();
}
class Source extends Node {
    buffer;
    loop = false;
    playbackRate = new Param();
    onended = null;
    started;
    stopped = false;
    start(...values) {
        this.started = values;
    }
    stop() {
        this.stopped = true;
    }
}
class Panner extends Node {
    panningModel = "equalpower";
    distanceModel = "inverse";
    refDistance = 1;
    maxDistance = 10_000;
    rolloffFactor = 1;
    coneInnerAngle = 360;
    coneOuterAngle = 360;
    coneOuterGain = 0;
    positionX = new Param();
    positionY = new Param();
    positionZ = new Param();
    orientationX = new Param();
    orientationY = new Param();
    orientationZ = new Param();
}
function fakeContext() {
    const destination = new Node();
    const sources = [];
    const gains = [];
    const listener = {
        positionX: new Param(),
        positionY: new Param(),
        positionZ: new Param(),
        forwardX: new Param(),
        forwardY: new Param(),
        forwardZ: new Param(),
        upX: new Param(),
        upY: new Param(),
        upZ: new Param(),
    };
    const context = {
        state: "suspended",
        currentTime: 0,
        destination,
        sources,
        gains,
        listener,
        resumed: false,
        createGain() {
            const gain = new Gain();
            gains.push(gain);
            return gain;
        },
        createDynamicsCompressor() {
            return new Node();
        },
        createPanner() {
            return new Panner();
        },
        createBufferSource() {
            const source = new Source();
            sources.push(source);
            return source;
        },
        async resume() {
            context.state = "running";
            context.resumed = true;
        },
        async close() {
            context.state = "closed";
        },
    };
    return context;
}
describe("AudioEngine", () => {
    it("unlocks audio and routes named buses with volume and mute state", async () => {
        const context = fakeContext();
        const audio = new AudioEngine(context);
        await audio.unlock();
        expect(context.resumed).toBe(true);
        audio.defineBus({ id: "music", volume: 0.5, compressor: true });
        expect(context.gains.at(-1)?.gain.value).toBe(0.5);
        audio.setBusMuted("music", true);
        expect(context.gains.at(-1)?.gain.value).toBe(0);
        audio.setBusVolume("music", 0.25);
        audio.setBusMuted("music", false);
        expect(context.gains.at(-1)?.gain.value).toBe(0.25);
    });
    it("plays decoded clips as controllable spatial voices", () => {
        const context = fakeContext();
        const audio = new AudioEngine(context);
        audio.defineBus({ id: "sfx" });
        audio.registerClip("jump", { duration: 1 });
        const voice = audio.play("jump", {
            bus: "sfx",
            volume: 0.4,
            pitch: 1.2,
            offset: 0.25,
            position: [1, 2, 3],
            orientation: [0, 0, -1],
            distanceModel: "linear",
            rolloffFactor: 0.5,
        });
        expect(context.sources[0]?.started).toEqual([0, 0.25]);
        expect(context.sources[0]?.playbackRate.value).toBe(1.2);
        expect(voice.playing).toBe(true);
        voice.setPosition([4, 5, 6]);
        voice.setPitch(0.75);
        expect(context.sources[0]?.playbackRate.value).toBe(0.75);
        expect(() => voice.setPitch(0)).toThrow(/positive/);
        voice.stop();
        expect(voice.playing).toBe(false);
        expect(context.sources[0]?.stopped).toBe(true);
    });
    it("applies Doppler to moving emitters and listeners without changing authored pitch", () => {
        const context = fakeContext();
        const audio = new AudioEngine(context);
        audio.registerClip("engine", { duration: 1 });
        const voice = audio.play("engine", {
            position: [10, 0, 0],
            velocity: [-34.3, 0, 0],
            pitch: 1,
        });
        expect(context.sources[0].playbackRate.value).toBeGreaterThan(1);
        const approaching = context.sources[0].playbackRate.value;
        voice.setVelocity([34.3, 0, 0]);
        expect(context.sources[0].playbackRate.value).toBeLessThan(1);
        audio.setListener([0, 0, 0], [0, 0, -1], [0, 1, 0], [100, 0, 0]);
        expect(context.sources[0].playbackRate.value).toBeGreaterThan(1);
        voice.setPitch(2);
        expect(context.sources[0].playbackRate.value).toBeGreaterThan(approaching);
    });
    it("supports legacy method-based Firefox listeners", () => {
        const context = fakeContext();
        const setPosition = vi.fn(), setOrientation = vi.fn();
        Object.assign(context, { listener: { setPosition, setOrientation } });
        const audio = new AudioEngine(context);
        audio.setListener([1, 2, 3], [0, 0, -1], [0, 1, 0]);
        expect(setPosition).toHaveBeenCalledWith(1, 2, 3);
        expect(setOrientation).toHaveBeenCalledWith(0, 0, -1, 0, 1, 0);
    });
    it("computes bounded Doppler ratios and supports an explicit off switch", () => {
        expect(dopplerRatio([0, 0, 0], [0, 0, 0], [10, 0, 0], [-20, 0, 0])).toBeGreaterThan(1);
        expect(dopplerRatio([0, 0, 0], [0, 0, 0], [10, 0, 0], [20, 0, 0])).toBeLessThan(1);
        expect(dopplerRatio([0, 0, 0], [0, 0, 0], [10, 0, 0], [-20, 0, 0], 0)).toBe(1);
        expect(dopplerRatio([0, 0, 0], [0, 0, 0], [10, 0, 0], [-100_000, 0, 0])).toBeLessThanOrEqual(8);
        expect(() => dopplerRatio([0, 0, 0], [0, 0, 0], [1, 0, 0], [0, 0, 0], -1)).toThrow(/factor.*non-negative/);
    });
    it("provides reusable authored audio sources", () => {
        const audio = new AudioEngine(fakeContext());
        audio.registerClip("step", { duration: 0.2 });
        const source = audio.createSource({
            clip: "step",
            volume: 0.5,
            position: [0, 0, 0],
            distanceModel: "exponential",
        });
        source.play();
        source.setPosition([1, 0, 0]);
        source.setPitch(0.8);
        source.setVolume(0.25);
        expect(source.playing).toBe(true);
        expect(source.definition).toMatchObject({
            clip: "step",
            volume: 0.25,
            pitch: 0.8,
            position: [1, 0, 0],
        });
        source.stop();
        expect(source.playing).toBe(false);
    });
    it("reports missing resources and invalid routing with actionable IDs", () => {
        const audio = new AudioEngine(fakeContext());
        expect(() => audio.play("missing")).toThrow(/missing.*not loaded/);
        audio.registerClip("ok", { duration: 1 });
        expect(() => audio.play("ok", { bus: "dialogue" })).toThrow(/dialogue.*Define it/);
        expect(() => audio.defineBus({ id: "bad", parent: "unknown" })).toThrow(/unknown/);
    });
});
//# sourceMappingURL=audio.test.js.map