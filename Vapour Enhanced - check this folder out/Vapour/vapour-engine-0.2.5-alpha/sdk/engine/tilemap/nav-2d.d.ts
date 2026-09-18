/** 2D grid navigation over a {@link Tilemap}.
 *
 * This is deliberately thin: walkability comes from the tilemap's own
 * collision data (so a level designer never has to keep two copies of "what
 * blocks movement" in sync), and pathfinding is the same budgeted A* every
 * other navigation surface in the engine uses ({@link findPath} from
 * `ai/navigation.js`) — a 2D grid is just another graph to it. Corridor
 * smoothing reuses {@link smoothPath} from `ai/navmesh.js` for the same
 * reason: string-pulling a grid corridor is identical work to string-pulling
 * a navmesh corridor, just over 2D cells instead of 3D spans.
 */
import { type NavigationNode, type PathResult } from "../ai/navigation.js";
import type { Tilemap, TileCollision } from "./tilemap.js";
export interface Nav2DOptions {
    /** Agent footprint radius, in whole tiles. A radius of 1 means the agent
     * also needs its four (plus diagonal) neighbouring tiles clear. */
    readonly agentRadius?: number;
    /** Collision kinds that block a 2D agent. Defaults to `solid` only: a
     * one-way platform or a slope is something a top-down/side-view grid agent
     * can still occupy, even though a 3D navmesh treats them differently. */
    readonly blockingKinds?: readonly TileCollision["kind"][];
}
export interface Nav2DPathResult {
    readonly status: PathResult<NavigationNode>["status"];
    /** The raw grid corridor, one cell per step. */
    readonly cells: readonly (readonly [number, number])[];
    /** The corridor after string-pulling — the route an agent should walk. */
    readonly points: readonly (readonly [number, number])[];
    readonly visited: number;
    readonly cost: number;
}
/** 2D pathfinding over a tilemap: walkability, agent clearance, dynamic
 * obstacles, and smoothed paths, all reusing the engine's existing A* and
 * string-pulling rather than a second implementation of either. */
export declare class Nav2D {
    #private;
    constructor(tilemap: Tilemap, options?: Nav2DOptions);
    get agentRadius(): number;
    /** Raw tilemap collision at one cell, ignoring agent radius and dynamic
     * obstacles. */
    isTileOpen(x: number, y: number): boolean;
    /** Whether an agent of this nav's radius and current dynamic obstacles can
     * occupy a cell: every tile in its footprint must be open. */
    isWalkable(x: number, y: number): boolean;
    /** Marks a cell as temporarily blocked (or clears that), independent of
     * the tilemap's own geometry — a crate, another agent, a closed door. */
    setBlocked(x: number, y: number, blocked?: boolean): void;
    isDynamicallyBlocked(x: number, y: number): boolean;
    /** Straight-line walkability between two cell centres, for
     * {@link smoothPath}. Samples along the segment rather than a true
     * Bresenham walk — cheap, and exact enough at grid resolution. */
    lineOfSight(from: readonly [number, number], to: readonly [number, number]): boolean;
    /** Finds a path in tile coordinates. Returns the raw corridor and a
     * string-pulled, shorter `points` route. */
    findPath(start: readonly [number, number], goal: readonly [number, number], options?: {
        maxVisited?: number;
    }): Nav2DPathResult;
}
//# sourceMappingURL=nav-2d.d.ts.map