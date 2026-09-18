import { type DebugDraw } from "../diagnostics/debug-draw.js";
import type { Nav2D } from "../tilemap/nav-2d.js";
import type { NavMesh } from "./navmesh.js";
export interface NavDebugOptions {
    readonly spans?: boolean;
    readonly adjacency?: boolean;
    readonly offMeshLinks?: boolean;
    readonly labels?: boolean;
    readonly heightOffset?: number;
}
/** Queues a baked navmesh into the shared debug-draw buffer. */
export declare function drawNavMesh(debug: DebugDraw, navmesh: NavMesh, options?: NavDebugOptions): void;
export interface NavDebug2DOptions {
    /** World size of one cell, matching the tilemap's `tileSize`. */
    readonly cellSize?: number;
    readonly bounds: {
        readonly x0: number;
        readonly y0: number;
        readonly x1: number;
        readonly y1: number;
    };
    readonly path?: readonly (readonly [number, number])[];
}
/** Queues a 2D nav grid into the shared debug-draw buffer, projecting tile
 * (x, y) onto the (x, z) ground plane at height 0 — the same convention
 * {@link drawNavMesh} uses, so both can be viewed together. */
export declare function drawNav2D(debug: DebugDraw, nav: Nav2D, options: NavDebug2DOptions): void;
/** Draws an agent route, highlighting start and destination. */
export declare function drawNavigationPath(debug: DebugDraw, points: readonly (readonly number[])[], heightOffset?: number): void;
//# sourceMappingURL=nav-debug.d.ts.map