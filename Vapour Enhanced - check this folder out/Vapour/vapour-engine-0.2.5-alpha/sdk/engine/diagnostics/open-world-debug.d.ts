import type { Vector3Like } from "../ai/ai.js";
import type { PerceivedTarget } from "../ai/perception.js";
import { type DebugDraw } from "./debug-draw.js";
import type { Diagnostics } from "./counters.js";
export interface AiDebugAgent {
    readonly id: string;
    readonly position: Vector3Like;
    readonly forward: Vector3Like;
    readonly state: string;
    readonly visionRange?: number;
    readonly fieldOfView?: number;
    readonly targets?: readonly PerceivedTarget[];
}
/** Draws AI heading, state, vision cone, and current perceived targets. */
export declare function drawAiAgent(debug: DebugDraw, agent: AiDebugAgent): void;
export interface OpenWorldFrameStats {
    readonly activeAi: number;
    readonly reducedAi: number;
    readonly dormantAi: number;
    readonly pedestrianCount: number;
    readonly trafficCount: number;
    readonly audioVoices: number;
    readonly audioRejected?: number;
}
/** Records standard open-world counters for the overlay and performance captures. */
export declare function recordOpenWorldStats(diagnostics: Diagnostics, stats: OpenWorldFrameStats): void;
//# sourceMappingURL=open-world-debug.d.ts.map