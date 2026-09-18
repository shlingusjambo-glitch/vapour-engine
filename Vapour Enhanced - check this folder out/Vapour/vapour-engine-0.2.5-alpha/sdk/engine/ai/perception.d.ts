import type { Vector3Like } from "./ai.js";
export interface PerceptionTarget {
    readonly id: string;
    readonly position: Vector3Like;
    readonly tags?: readonly string[];
    readonly threat?: number;
}
export interface VisionSensorOptions {
    readonly range: number;
    /** Full horizontal field of view in degrees. */
    readonly fieldOfView: number;
    readonly eye?: Vector3Like;
    readonly forward?: Vector3Like;
    /** Return true when geometry blocks the segment. */
    readonly occluded?: (from: Vector3Like, to: Vector3Like, target: PerceptionTarget) => boolean;
}
export interface PerceivedTarget extends PerceptionTarget {
    readonly distance: number;
    readonly score: number;
}
/** Allocation-conscious vision query with range, cone, tags, and pluggable LOS. */
export declare function perceiveVision(targets: Iterable<PerceptionTarget>, options: VisionSensorOptions, requiredTag?: string): PerceivedTarget[];
export interface SoundStimulus {
    readonly id: string;
    readonly position: Vector3Like;
    readonly loudness: number;
    readonly tags?: readonly string[];
}
export interface HeardStimulus extends SoundStimulus {
    readonly distance: number;
    readonly strength: number;
}
/** Distance-attenuated hearing; an optional obstruction callback can model walls. */
export declare function perceiveHearing(listener: Vector3Like, range: number, sounds: Iterable<SoundStimulus>, obstruction?: (from: Vector3Like, to: Vector3Like, sound: SoundStimulus) => number): HeardStimulus[];
export interface BlackboardKey<T> {
    readonly name: string;
    readonly defaultValue?: T;
}
export declare function blackboardKey<T>(name: string, defaultValue?: T): BlackboardKey<T>;
/** Typed shared memory for behavior trees and controllers. */
export declare class Blackboard {
    #private;
    has(key: BlackboardKey<unknown>): boolean;
    get<T>(key: BlackboardKey<T>): T | undefined;
    require<T>(key: BlackboardKey<T>): T;
    set<T>(key: BlackboardKey<T>, value: T): void;
    delete(key: BlackboardKey<unknown>): boolean;
    clear(): void;
    observe<T>(key: BlackboardKey<T>, listener: (value: T, previous: T | undefined) => void): () => void;
    snapshot(): Readonly<Record<string, unknown>>;
}
export type TargetPolicy = "highest-score" | "nearest" | "highest-threat";
export declare function selectTarget(targets: readonly PerceivedTarget[], policy?: TargetPolicy): PerceivedTarget | undefined;
/** Small orchestration primitive. Games supply sensors and decisions; the engine owns cadence and memory. */
export declare class AiController<TContext> {
    #private;
    readonly blackboard: Blackboard;
    constructor(options: {
        readonly sense: (context: TContext, blackboard: Blackboard) => void;
        readonly decide: (context: TContext, blackboard: Blackboard, deltaSeconds: number) => void;
        readonly sensingInterval?: number;
    });
    get enabled(): boolean;
    set enabled(value: boolean);
    update(context: TContext, deltaSeconds: number): void;
}
//# sourceMappingURL=perception.d.ts.map