import type { Vector3Like } from "./ai.js";
export interface SpatialEntity extends Vector3Like {
    readonly id: string;
}
/** A mutable XZ spatial hash for broad-phase AI queries and activation. */
export declare class SpatialEntityIndex<T extends SpatialEntity> {
    #private;
    constructor(cellSize?: number);
    get size(): number;
    upsert(entity: T): void;
    remove(id: string): boolean;
    get(id: string): T | undefined;
    queryRadius(center: Vector3Like, radius: number, predicate?: (entity: T) => boolean): T[];
}
export type SimulationTier = "full" | "reduced" | "dormant";
export interface SimulationTierSettings {
    readonly fullDistance?: number;
    readonly reducedDistance?: number;
    readonly reducedHz?: number;
}
export interface SimulationDecision {
    readonly tier: SimulationTier;
    readonly shouldTick: boolean;
    readonly deltaSeconds: number;
}
/** Staggers distant AI work while keeping elapsed time correct for each agent. */
export declare class SimulationLodScheduler {
    #private;
    constructor(settings?: SimulationTierSettings);
    evaluate(id: string, position: Vector3Like, focus: Vector3Like, frameDelta: number): SimulationDecision;
    forget(id: string): void;
    clear(): void;
}
export type TrafficSignalPhase = "green" | "yellow" | "all-red";
export interface TrafficSignalPlan {
    readonly greenSeconds: number;
    readonly yellowSeconds?: number;
    readonly clearanceSeconds?: number;
}
export interface TrafficSignalSnapshot {
    readonly approach: number;
    readonly phase: TrafficSignalPhase;
    readonly remainingSeconds: number;
}
/** Deterministic multi-approach signal plan with an all-red clearance phase. */
export declare class TrafficSignalController {
    #private;
    constructor(plans: readonly TrafficSignalPlan[]);
    update(deltaSeconds: number): TrafficSignalSnapshot;
    snapshot(): TrafficSignalSnapshot;
    permits(approach: number): boolean;
}
//# sourceMappingURL=open-world.d.ts.map