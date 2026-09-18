export interface AudioBusDefinition {
    readonly id: string;
    readonly parent?: string;
    readonly volume?: number;
    readonly muted?: boolean;
    readonly compressor?: boolean;
}
export interface AudioPlayOptions {
    readonly bus?: string;
    readonly volume?: number;
    readonly pitch?: number;
    readonly loop?: boolean;
    readonly offset?: number;
    readonly position?: readonly [number, number, number];
    readonly minDistance?: number;
    readonly maxDistance?: number;
    readonly distanceModel?: "linear" | "inverse" | "exponential";
    readonly rolloffFactor?: number;
    readonly orientation?: readonly [number, number, number];
    readonly coneInnerAngle?: number;
    readonly coneOuterAngle?: number;
    readonly coneOuterGain?: number;
    readonly velocity?: readonly [number, number, number];
    /** Zero disables Doppler. One is physically scaled; defaults to one. */
    readonly dopplerFactor?: number;
    /** World units per second corresponding to sound speed. Defaults to 343. */
    readonly speedOfSound?: number;
}
export interface AudioVoice {
    readonly id: number;
    readonly playing: boolean;
    stop(): void;
    setVolume(volume: number): void;
    setPitch(pitch: number): void;
    setPosition(position: readonly [number, number, number]): void;
    setOrientation(orientation: readonly [number, number, number]): void;
    setVelocity(velocity: readonly [number, number, number]): void;
}
export interface AudioSourceDefinition extends AudioPlayOptions {
    readonly clip: string;
    readonly playOnStart?: boolean;
}
/** Serializable-style audio source controller. It separates authored source
 * settings from short-lived Web Audio voices and is suitable for ECS/script
 * components in TypeScript and VS. */
export declare class AudioSource {
    #private;
    constructor(engine: AudioEngine, definition: AudioSourceDefinition);
    get playing(): boolean;
    get definition(): AudioSourceDefinition;
    play(overrides?: AudioPlayOptions): AudioVoice;
    stop(): void;
    setPosition(position: readonly [number, number, number]): void;
    setVolume(value: number): void;
    setPitch(value: number): void;
    setVelocity(value: readonly [number, number, number]): void;
}
/** Browser-native audio mixer with named buses, decoded clips, streamed music,
 * spatial voices, and explicit autoplay recovery. */
export declare class AudioEngine {
    #private;
    constructor(context?: AudioContext);
    get state(): AudioContextState;
    unlock(): Promise<void>;
    defineBus(definition: AudioBusDefinition): void;
    setBusVolume(id: string, value: number): void;
    setBusMuted(id: string, muted: boolean): void;
    registerClip(id: string, buffer: AudioBuffer): void;
    loadClip(id: string, url: string, signal?: AbortSignal): Promise<void>;
    play(id: string, options?: AudioPlayOptions): AudioVoice;
    createSource(definition: AudioSourceDefinition): AudioSource;
    /** Streams long music through an HTML media element instead of retaining the
     * entire decoded file. Call play() on the returned element from a user
     * gesture when browser autoplay policy requires it. */
    createStream(url: string, options?: Omit<AudioPlayOptions, "offset">): {
        readonly element: HTMLAudioElement;
        readonly voice: AudioVoice;
    };
    setListener(position: readonly [number, number, number], forward?: readonly [number, number, number], up?: readonly [number, number, number], velocity?: readonly [number, number, number]): void;
    stopAll(bus?: string): void;
    close(): Promise<void>;
}
/** Physically based Doppler playback-rate multiplier, safely clamped for Web Audio. */
export declare function dopplerRatio(listenerPosition: readonly [number, number, number], listenerVelocity: readonly [number, number, number], sourcePosition: readonly [number, number, number], sourceVelocity: readonly [number, number, number], factor?: number, speedOfSound?: number): number;
//# sourceMappingURL=audio.d.ts.map