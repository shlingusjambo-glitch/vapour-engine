/** Mixer architecture: standard buses, music crossfading, zones, and voice limits.
 *
 * `AudioEngine` provides buses, clips, and spatial voices. What it deliberately
 * does not decide is *policy*: which buses exist, what happens when a hundred
 * sounds want to play at once, how music transitions, and how a room changes
 * the way things sound. Those are the parts every game gets wrong in the same
 * way, so they are provided here rather than left to each project.
 *
 * Everything in this file is plain logic over an injected engine interface, so
 * it is testable without a Web Audio context — which matters, because the
 * failure modes being guarded against (voice exhaustion, a crossfade leaving
 * two tracks audible) are exactly the ones nobody notices until a real session.
 */
/** The subset of `AudioEngine` the mixer needs, so it can be tested. */
export interface MixerEngine {
    setBusVolume(id: string, volume: number): void;
    setBusMuted(id: string, muted: boolean): void;
}
/**
 * The bus layout almost every game needs.
 *
 * Named consistently so that a settings screen, a script, and the docs all
 * agree — and because "music", "sfx", and "voice" as separate player-facing
 * volume sliders is a baseline accessibility expectation, not a nicety.
 */
export declare const STANDARD_BUSES: {
    readonly master: "master";
    readonly music: "music";
    readonly sfx: "sfx";
    readonly voice: "voice";
    readonly ui: "ui";
    readonly ambience: "ambience";
};
export type StandardBus = (typeof STANDARD_BUSES)[keyof typeof STANDARD_BUSES];
export interface BusLayoutEntry {
    readonly id: string;
    readonly parent?: string;
    readonly volume?: number;
    readonly compressor?: boolean;
}
/** The standard buses, all routed through `master`. */
export declare function standardBusLayout(): readonly BusLayoutEntry[];
/**
 * Player volume settings, one per standard bus.
 *
 * Values are explicitly `number | undefined` rather than merely optional: a
 * settings snapshot legitimately contains keys whose value is unset, and
 * requiring callers to strip those before passing them here would be busywork.
 */
export interface VolumeSettings {
    readonly master?: number | undefined;
    readonly music?: number | undefined;
    readonly sfx?: number | undefined;
    readonly voice?: number | undefined;
    readonly ui?: number | undefined;
    readonly ambience?: number | undefined;
}
/**
 * Applies player volume settings to the standard buses.
 *
 * Settings are stored linearly because that is what a slider produces, and
 * converted here — perceived loudness is roughly the cube of the linear value,
 * so a slider at half that maps to half gain sounds far louder than half.
 */
export declare function applyVolumeSettings(engine: MixerEngine, settings: VolumeSettings): void;
/** Converts a linear slider value to a gain that sounds proportional. */
export declare function perceptualGain(slider: number): number;
/** The inverse, for showing a stored gain on a slider. */
export declare function gainToSlider(gain: number): number;
export interface CrossfadeTrack {
    readonly clip: string;
    /** Gain in `[0, 1]`, applied on top of the bus volume. */
    readonly gain: number;
}
export type MusicState = "stopped" | "playing" | "crossfading" | "fadingOut";
/**
 * Music playback with crossfades.
 *
 * Produces the gains for the outgoing and incoming tracks each frame rather
 * than touching audio nodes, so the transition logic can be tested and reused
 * for a music system built on any playback backend.
 *
 * The curve is equal-power, not linear. Two linearly crossfaded tracks dip
 * audibly in the middle, because summed power — not summed amplitude — is what
 * the ear hears.
 */
export declare class MusicPlayer {
    #private;
    get state(): MusicState;
    get currentClip(): string | undefined;
    get incomingClip(): string | undefined;
    /** Starts a track immediately, with no transition. */
    play(clip: string): void;
    /**
     * Crossfades to another track.
     *
     * Crossfading to the track already playing is a no-op, because gameplay
     * commonly calls this whenever a state is entered and restarting the music
     * on every re-entry is jarring.
     */
    crossfadeTo(clip: string, seconds: number): void;
    fadeOut(seconds: number): void;
    stop(): void;
    /** Advances the transition and returns the tracks that should be audible. */
    update(deltaSeconds: number): readonly CrossfadeTrack[];
}
/** Equal-power fade curves: their squares sum to one at every point. */
export declare function equalPowerIn(t: number): number;
export declare function equalPowerOut(t: number): number;
export interface VoiceRequest {
    readonly bus: string;
    /** Higher wins when voices are scarce. */
    readonly priority?: number;
    /** Distance from the listener; nearer sounds win ties. */
    readonly distance?: number;
    /** Identifier for the sound, used to limit duplicates. */
    readonly clip?: string;
}
export interface VoiceHandle {
    readonly id: number;
    readonly bus: string;
    readonly priority: number;
    readonly distance: number;
    readonly clip: string | undefined;
}
export interface VoiceLimiterOptions {
    /** Total concurrent voices. */
    readonly maxVoices?: number;
    /** Per-bus caps, so effects cannot starve dialogue. */
    readonly perBus?: Readonly<Record<string, number>>;
    /** Concurrent instances of the same clip. */
    readonly maxPerClip?: number;
}
export interface VoiceLimiterStats {
    readonly active: number;
    readonly granted: number;
    readonly stolen: number;
    readonly rejected: number;
}
/**
 * Decides which sounds get to play when there are more than there is room for.
 *
 * Browsers degrade badly past a few dozen simultaneous voices: latency rises,
 * and on some platforms playback simply stops. A game that plays a sound per
 * impact will exceed that during any explosion, so the question is not whether
 * to limit but *which* sounds to drop.
 *
 * The policy is priority first, then distance. A quiet footstep across the map
 * loses to a nearby gunshot, and dialogue with a high priority never loses to
 * either.
 */
export declare class VoiceLimiter {
    #private;
    constructor(options?: VoiceLimiterOptions);
    get active(): readonly VoiceHandle[];
    stats(): VoiceLimiterStats;
    /**
     * Requests a voice.
     *
     * Returns the granted handle plus any voice that was stopped to make room, so
     * the caller can actually stop it. Returns `undefined` when the request lost.
     */
    request(request: VoiceRequest): {
        readonly voice: VoiceHandle;
        readonly stopped: VoiceHandle | undefined;
    } | undefined;
    /** Frees a voice when its sound finishes or is stopped. */
    release(id: number): boolean;
    releaseAll(): void;
    /** Updates a voice's distance, so a receding sound can lose its slot. */
    setDistance(id: number, distance: number): void;
}
export interface AudioZoneSettings {
    /** Reverb wet mix in `[0, 1]`. */
    readonly reverb?: number;
    /** Low-pass cutoff in hertz. Lower is more muffled. */
    readonly lowPassHz?: number;
    /** Multiplies every sound's gain in this zone. */
    readonly gain?: number;
}
export interface AudioZone extends AudioZoneSettings {
    readonly id: string;
    /** Axis-aligned bounds, as `[minX, minY, minZ, maxX, maxY, maxZ]`. */
    readonly bounds: readonly [number, number, number, number, number, number];
    /** Distance over which the zone blends with its surroundings. */
    readonly blendDistance?: number;
    /** Higher priority wins where zones overlap. */
    readonly priority?: number;
}
/**
 * Positional audio zones: a cave reverberates, a room muffles, water dulls.
 *
 * Zones blend rather than switching. A hard cut as the listener crosses a
 * boundary is audible and cheap to avoid, and the blend distance is what makes
 * a doorway sound like a doorway.
 */
export declare class AudioZones {
    #private;
    constructor(defaults?: AudioZoneSettings);
    add(zone: AudioZone): void;
    remove(id: string): boolean;
    get ids(): readonly string[];
    /** The zone settings at a position, blended across boundaries. */
    sample(position: readonly [number, number, number]): Required<AudioZoneSettings>;
}
//# sourceMappingURL=mixer.d.ts.map