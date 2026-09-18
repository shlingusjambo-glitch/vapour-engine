export interface VehicleAudioInput {
    /** Engine speed normalized between idle and redline. */
    readonly rpm: number;
    /** Signed drivetrain load: braking/coast -1, full throttle +1. */
    readonly load: number;
    readonly speedMetersPerSecond: number;
    readonly slip: number;
    readonly interior?: boolean;
}
export interface VehicleAudioLayer {
    readonly layer: "idle" | "low" | "high" | "tire" | "wind";
    readonly gain: number;
    readonly pitch: number;
}
export interface VehicleAudioMix {
    readonly layers: readonly VehicleAudioLayer[];
    readonly lowPassHz: number;
}
/** Continuous engine, tire, and wind parameters for a layered vehicle sound rig. */
export declare function mixVehicleAudio(input: VehicleAudioInput): VehicleAudioMix;
export interface AmbienceVariant {
    readonly clip: string;
    readonly weight?: number;
    readonly volume?: number;
}
export interface AmbienceEmitterDefinition {
    readonly id: string;
    readonly variants: readonly AmbienceVariant[];
    readonly minInterval: number;
    readonly maxInterval: number;
    readonly seed?: number;
}
export interface AmbienceEvent {
    readonly emitter: string;
    readonly clip: string;
    readonly volume: number;
}
/** Seeded one-shot ambience scheduler; save/load can preserve its elapsed state. */
export declare class AmbienceEmitter {
    #private;
    constructor(definition: AmbienceEmitterDefinition);
    get remainingSeconds(): number;
    update(deltaSeconds: number): readonly AmbienceEvent[];
}
//# sourceMappingURL=open-world-audio.d.ts.map