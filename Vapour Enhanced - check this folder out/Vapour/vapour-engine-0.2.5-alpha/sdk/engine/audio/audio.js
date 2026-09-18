/** Serializable-style audio source controller. It separates authored source
 * settings from short-lived Web Audio voices and is suitable for ECS/script
 * components in TypeScript and VS. */
export class AudioSource {
    #engine;
    #definition;
    #voice;
    constructor(engine, definition) {
        nonEmpty(definition.clip, "Audio source clip");
        this.#engine = engine;
        this.#definition = { ...definition };
    }
    get playing() {
        return this.#voice?.playing ?? false;
    }
    get definition() {
        return { ...this.#definition };
    }
    play(overrides = {}) {
        this.stop();
        this.#voice = this.#engine.play(this.#definition.clip, {
            ...this.#definition,
            ...overrides,
        });
        return this.#voice;
    }
    stop() {
        this.#voice?.stop();
        this.#voice = undefined;
    }
    setPosition(position) {
        tuple3(position, "Audio source position");
        this.#definition = { ...this.#definition, position: [...position] };
        this.#voice?.setPosition(position);
    }
    setVolume(value) {
        const next = volume(value, "Audio source volume");
        this.#definition = { ...this.#definition, volume: next };
        this.#voice?.setVolume(next);
    }
    setPitch(value) {
        const next = positive(value, "Audio source pitch");
        this.#definition = { ...this.#definition, pitch: next };
        this.#voice?.setPitch(next);
    }
    setVelocity(value) {
        tuple3(value, "Audio source velocity");
        this.#definition = { ...this.#definition, velocity: [...value] };
        this.#voice?.setVelocity(value);
    }
}
/** Browser-native audio mixer with named buses, decoded clips, streamed music,
 * spatial voices, and explicit autoplay recovery. */
export class AudioEngine {
    #context;
    #buses = new Map();
    #clips = new Map();
    #voices = new Map();
    #nextVoice = 1;
    #listenerMotion = {
        position: [0, 0, 0],
        velocity: [0, 0, 0],
    };
    constructor(context) {
        const Constructor = globalThis.AudioContext ??
            globalThis.webkitAudioContext;
        if (context === undefined && Constructor === undefined)
            throw new Error("Web Audio is unavailable in this browser. Vapour audio requires AudioContext support.");
        this.#context = context ?? new Constructor();
        const gain = this.#context.createGain();
        gain.connect(this.#context.destination);
        this.#buses.set("master", {
            definition: { id: "master", volume: 1 },
            gain,
            output: gain,
        });
    }
    get state() {
        return this.#context.state;
    }
    async unlock() {
        if (this.#context.state === "running")
            return;
        try {
            await this.#context.resume();
        }
        catch (error) {
            throw new Error(`Audio could not start. Call audio.unlock() from a click, key, or touch handler. ${message(error)}`, { cause: error });
        }
        const resumedState = readAudioState(this.#context);
        if (resumedState !== "running")
            throw new Error(`Audio remains '${resumedState}' after resume. The browser may require a direct user gesture.`);
    }
    defineBus(definition) {
        const id = nonEmpty(definition.id, "Audio bus ID");
        if (id === "master")
            throw new Error("The master audio bus already exists; use setBusVolume or setBusMuted to change it.");
        const parentId = definition.parent ?? "master";
        const parent = this.#requireBus(parentId);
        if (this.#buses.has(id))
            throw new Error(`Audio bus '${id}' is already defined.`);
        const gain = this.#context.createGain();
        setGain(gain, definition.muted
            ? 0
            : volume(definition.volume ?? 1, `Audio bus '${id}' volume`), this.#context.currentTime);
        let output = gain;
        if (definition.compressor) {
            const compressor = this.#context.createDynamicsCompressor();
            gain.connect(compressor);
            output = compressor;
        }
        output.connect(parent.gain);
        this.#buses.set(id, {
            definition: {
                ...definition,
                id,
                parent: parentId,
                volume: definition.volume ?? 1,
                muted: definition.muted ?? false,
            },
            gain,
            output,
        });
    }
    setBusVolume(id, value) {
        const bus = this.#requireBus(id);
        const next = volume(value, `Audio bus '${id}' volume`);
        bus.definition = { ...bus.definition, volume: next };
        setGain(bus.gain, bus.definition.muted ? 0 : next, this.#context.currentTime);
    }
    setBusMuted(id, muted) {
        const bus = this.#requireBus(id);
        bus.definition = { ...bus.definition, muted };
        setGain(bus.gain, muted ? 0 : (bus.definition.volume ?? 1), this.#context.currentTime);
    }
    registerClip(id, buffer) {
        nonEmpty(id, "Audio clip ID");
        if (!(buffer.duration >= 0))
            throw new Error(`Audio clip '${id}' has an invalid buffer.`);
        this.#clips.set(id, buffer);
    }
    async loadClip(id, url, signal) {
        nonEmpty(id, "Audio clip ID");
        nonEmpty(url, `Audio clip '${id}' URL`);
        let response;
        try {
            response = await fetch(url, signal === undefined ? {} : { signal });
        }
        catch (error) {
            throw new Error(`Failed to fetch audio clip '${id}' from '${url}': ${message(error)}`, { cause: error });
        }
        if (!response.ok)
            throw new Error(`Failed to fetch audio clip '${id}' from '${url}': HTTP ${String(response.status)} ${response.statusText}.`);
        try {
            this.registerClip(id, await this.#context.decodeAudioData(await response.arrayBuffer()));
        }
        catch (error) {
            throw new Error(`Failed to decode audio clip '${id}' from '${url}'. Verify that the file is WAV, MP3, OGG, or another browser-supported codec. ${message(error)}`, { cause: error });
        }
    }
    play(id, options = {}) {
        const buffer = this.#clips.get(id);
        if (buffer === undefined)
            throw new Error(`Audio clip '${id}' is not loaded. Call loadClip() or registerClip() before play().`);
        const source = this.#context.createBufferSource();
        source.buffer = buffer;
        source.loop = options.loop ?? false;
        source.playbackRate.value = positive(options.pitch ?? 1, `Audio clip '${id}' pitch`);
        const voice = this.#wireVoice(source, options, undefined, (pitch) => setParam(source.playbackRate, pitch, this.#context.currentTime));
        source.start(0, Math.max(0, finite(options.offset ?? 0, `Audio clip '${id}' offset`)));
        return voice;
    }
    createSource(definition) {
        return new AudioSource(this, definition);
    }
    /** Streams long music through an HTML media element instead of retaining the
     * entire decoded file. Call play() on the returned element from a user
     * gesture when browser autoplay policy requires it. */
    createStream(url, options = {}) {
        nonEmpty(url, "Stream URL");
        if (typeof Audio === "undefined")
            throw new Error("Streamed audio requires HTMLAudioElement, which is unavailable in this environment.");
        const element = new Audio(url);
        element.preload = "metadata";
        element.loop = options.loop ?? false;
        element.playbackRate = positive(options.pitch ?? 1, "Audio stream pitch");
        const source = this.#context.createMediaElementSource(element);
        const voice = this.#wireVoice(source, options, () => {
            element.pause();
            element.removeAttribute("src");
            element.load();
        }, (pitch) => {
            element.playbackRate = pitch;
        });
        element.addEventListener("ended", () => voice.finish(), {
            once: true,
        });
        return { element, voice };
    }
    setListener(position, forward = [0, 0, -1], up = [0, 1, 0], velocity = this.#listenerMotion.velocity) {
        tuple3(position, "Audio listener position");
        tuple3(forward, "Audio listener forward");
        tuple3(up, "Audio listener up");
        tuple3(velocity, "Audio listener velocity");
        this.#listenerMotion.position = [...position];
        this.#listenerMotion.velocity = [...velocity];
        const listener = this.#context.listener;
        const now = this.#context.currentTime;
        if (listener.positionX !== undefined) {
            listener.positionX.setValueAtTime(position[0], now);
            listener.positionY.setValueAtTime(position[1], now);
            listener.positionZ.setValueAtTime(position[2], now);
            listener.forwardX.setValueAtTime(forward[0], now);
            listener.forwardY.setValueAtTime(forward[1], now);
            listener.forwardZ.setValueAtTime(forward[2], now);
            listener.upX.setValueAtTime(up[0], now);
            listener.upY.setValueAtTime(up[1], now);
            listener.upZ.setValueAtTime(up[2], now);
        }
        else {
            // Firefox versions implementing the original Web Audio listener API
            // expose methods rather than AudioParams.
            listener.setPosition(position[0], position[1], position[2]);
            listener.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
        }
        for (const voice of this.#voices.values())
            voice.refreshDoppler();
    }
    stopAll(bus) {
        if (bus !== undefined)
            this.#requireBus(bus);
        for (const voice of [...this.#voices.values()])
            if (bus === undefined || voice.bus === bus)
                voice.stop();
    }
    async close() {
        this.stopAll();
        await this.#context.close();
    }
    #wireVoice(source, options, onStop, onPitch) {
        const busId = options.bus ?? "master";
        const bus = this.#requireBus(busId);
        const gain = this.#context.createGain();
        setGain(gain, volume(options.volume ?? 1, "Audio voice volume"), this.#context.currentTime);
        source.connect(gain);
        let panner;
        if (options.position !== undefined) {
            tuple3(options.position, "Audio voice position");
            panner = this.#context.createPanner();
            panner.panningModel = "HRTF";
            panner.distanceModel = options.distanceModel ?? "inverse";
            panner.refDistance = positive(options.minDistance ?? 1, "Audio voice minDistance");
            panner.maxDistance = positive(options.maxDistance ?? 10_000, "Audio voice maxDistance");
            panner.rolloffFactor = nonNegative(options.rolloffFactor ?? 1, "Audio voice rolloffFactor");
            panner.coneInnerAngle = angle(options.coneInnerAngle ?? 360, "Audio voice coneInnerAngle");
            panner.coneOuterAngle = angle(options.coneOuterAngle ?? 360, "Audio voice coneOuterAngle");
            panner.coneOuterGain = unit(options.coneOuterGain ?? 0, "Audio voice coneOuterGain");
            if (panner.maxDistance < panner.refDistance)
                throw new Error("Audio voice maxDistance must be greater than or equal to minDistance.");
            setPosition(panner, options.position, this.#context.currentTime);
            if (options.orientation !== undefined)
                setOrientation(panner, options.orientation, this.#context.currentTime);
            gain.connect(panner);
            panner.connect(bus.gain);
        }
        else if (options.orientation !== undefined)
            throw new Error("Audio voice orientation requires a spatial position.");
        else
            gain.connect(bus.gain);
        const id = this.#nextVoice++;
        const voice = new Voice(id, busId, source, gain, panner, this.#context, () => this.#voices.delete(id), onStop, onPitch, this.#listenerMotion, options);
        this.#voices.set(id, voice);
        if ("onended" in source)
            source.onended = () => voice.finish();
        return voice;
    }
    #requireBus(id) {
        const bus = this.#buses.get(id);
        if (bus === undefined)
            throw new Error(`Unknown audio bus '${id}'. Define it before routing audio. Available buses: ${[...this.#buses.keys()].join(", ")}.`);
        return bus;
    }
}
class Voice {
    id;
    bus;
    source;
    gain;
    panner;
    context;
    remove;
    onStop;
    onPitch;
    listenerMotion;
    #playing = true;
    #basePitch;
    #position;
    #velocity;
    #dopplerFactor;
    #speedOfSound;
    constructor(id, bus, source, gain, panner, context, remove, onStop, onPitch, listenerMotion, options) {
        this.id = id;
        this.bus = bus;
        this.source = source;
        this.gain = gain;
        this.panner = panner;
        this.context = context;
        this.remove = remove;
        this.onStop = onStop;
        this.onPitch = onPitch;
        this.listenerMotion = listenerMotion;
        this.#basePitch = positive(options.pitch ?? 1, "Audio voice pitch");
        this.#position = [...(options.position ?? [0, 0, 0])];
        this.#velocity = [...(options.velocity ?? [0, 0, 0])];
        this.#dopplerFactor = nonNegative(options.dopplerFactor ?? 1, "Audio voice dopplerFactor");
        this.#speedOfSound = positive(options.speedOfSound ?? 343, "Audio voice speedOfSound");
        this.refreshDoppler();
    }
    get playing() {
        return this.#playing;
    }
    stop() {
        if (!this.#playing)
            return;
        if ("stop" in this.source)
            this.source.stop();
        this.onStop?.();
        this.finish();
    }
    setVolume(value) {
        setGain(this.gain, volume(value, "Audio voice volume"), this.context.currentTime);
    }
    setPitch(value) {
        if (this.onPitch === undefined)
            throw new Error(`Audio voice ${String(this.id)} does not expose playback-rate control.`);
        this.#basePitch = positive(value, "Audio voice pitch");
        this.refreshDoppler();
    }
    setPosition(position) {
        if (this.panner === undefined)
            throw new Error(`Audio voice ${String(this.id)} is not spatial. Supply position when playing it.`);
        tuple3(position, "Audio voice position");
        this.#position = [...position];
        setPosition(this.panner, position, this.context.currentTime);
        this.refreshDoppler();
    }
    setVelocity(velocity) {
        if (this.panner === undefined)
            throw new Error(`Audio voice ${String(this.id)} is not spatial. Supply position when playing it.`);
        tuple3(velocity, "Audio voice velocity");
        this.#velocity = [...velocity];
        this.refreshDoppler();
    }
    setOrientation(orientation) {
        if (this.panner === undefined)
            throw new Error(`Audio voice ${String(this.id)} is not spatial. Supply position when playing it.`);
        setOrientation(this.panner, orientation, this.context.currentTime);
    }
    finish() {
        if (!this.#playing)
            return;
        this.#playing = false;
        this.source.disconnect();
        this.gain.disconnect();
        this.panner?.disconnect();
        this.remove();
    }
    refreshDoppler() {
        if (this.onPitch === undefined)
            return;
        const ratio = this.panner === undefined
            ? 1
            : dopplerRatio(this.listenerMotion.position, this.listenerMotion.velocity, this.#position, this.#velocity, this.#dopplerFactor, this.#speedOfSound);
        this.onPitch(this.#basePitch * ratio);
    }
}
/** Physically based Doppler playback-rate multiplier, safely clamped for Web Audio. */
export function dopplerRatio(listenerPosition, listenerVelocity, sourcePosition, sourceVelocity, factor = 1, speedOfSound = 343) {
    tuple3(listenerPosition, "Doppler listener position");
    tuple3(listenerVelocity, "Doppler listener velocity");
    tuple3(sourcePosition, "Doppler source position");
    tuple3(sourceVelocity, "Doppler source velocity");
    nonNegative(factor, "Doppler factor");
    positive(speedOfSound, "Doppler speed of sound");
    const offset = [
        sourcePosition[0] - listenerPosition[0],
        sourcePosition[1] - listenerPosition[1],
        sourcePosition[2] - listenerPosition[2],
    ];
    const distance = Math.hypot(...offset);
    if (distance < 1e-6 || factor === 0)
        return 1;
    const direction = offset.map((value) => value / distance);
    const listenerAlong = listenerVelocity[0] * direction[0] +
        listenerVelocity[1] * direction[1] +
        listenerVelocity[2] * direction[2];
    const sourceAlong = sourceVelocity[0] * direction[0] +
        sourceVelocity[1] * direction[1] +
        sourceVelocity[2] * direction[2];
    const numerator = Math.max(speedOfSound * 0.01, speedOfSound + factor * listenerAlong);
    const denominator = Math.max(speedOfSound * 0.01, speedOfSound + factor * sourceAlong);
    return Math.min(8, Math.max(0.125, numerator / denominator));
}
function setGain(node, value, now) {
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(value, now);
}
function setParam(param, value, now) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(value, now);
}
function setPosition(node, value, now) {
    node.positionX.setValueAtTime(value[0], now);
    node.positionY.setValueAtTime(value[1], now);
    node.positionZ.setValueAtTime(value[2], now);
}
function setOrientation(node, value, now) {
    tuple3(value, "Audio voice orientation");
    if (value.every((item) => item === 0))
        throw new Error("Audio voice orientation cannot be zero.");
    node.orientationX.setValueAtTime(value[0], now);
    node.orientationY.setValueAtTime(value[1], now);
    node.orientationZ.setValueAtTime(value[2], now);
}
function tuple3(value, label) {
    if (value.length !== 3 || value.some((item) => !Number.isFinite(item)))
        throw new Error(`${label} must contain three finite numbers.`);
}
function nonEmpty(value, label) {
    if (!value.trim())
        throw new Error(`${label} must not be empty.`);
    return value;
}
function finite(value, label) {
    if (!Number.isFinite(value))
        throw new Error(`${label} must be finite.`);
    return value;
}
function positive(value, label) {
    finite(value, label);
    if (value <= 0)
        throw new Error(`${label} must be positive.`);
    return value;
}
function volume(value, label) {
    finite(value, label);
    if (value < 0)
        throw new Error(`${label} must be non-negative.`);
    return value;
}
function nonNegative(value, label) {
    finite(value, label);
    if (value < 0)
        throw new Error(`${label} must be non-negative.`);
    return value;
}
function unit(value, label) {
    finite(value, label);
    if (value < 0 || value > 1)
        throw new Error(`${label} must be between 0 and 1.`);
    return value;
}
function angle(value, label) {
    finite(value, label);
    if (value < 0 || value > 360)
        throw new Error(`${label} must be between 0 and 360 degrees.`);
    return value;
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
function readAudioState(context) {
    return context.state;
}
//# sourceMappingURL=audio.js.map