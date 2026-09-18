/** Immediate-mode debug drawing.
 *
 * Every later Mirage subsystem needs to show its own state: collider shapes,
 * navmesh polygons, path corridors, physics contacts, AI perception cones,
 * network interest volumes, culling bounds. If each one invents its own
 * visualization there is no single switch to turn them off, no shared depth or
 * colour convention, and no way to render them in one batch.
 *
 * So they all queue into one buffer here. The API is immediate mode — a call
 * per frame, no handles to retain — because that is what debugging code wants:
 * drop a line in, see it, delete the line later.
 *
 * The buffer is a flat list of primitives that a renderer consumes and
 * {@link DebugDraw.clear}s each frame. Nothing here touches the GPU, so it
 * works headless, in a worker, and in tests.
 */
import type { Rgba } from "@vapour/math";
export type DebugCategory = string;
export interface DebugLine {
    readonly kind: "line";
    readonly category: DebugCategory;
    readonly from: readonly [number, number, number];
    readonly to: readonly [number, number, number];
    readonly color: Rgba;
    /** Seconds this primitive stays queued. `0` means one frame. */
    readonly duration: number;
    /** Draw through geometry rather than being occluded by it. */
    readonly depthTest: boolean;
}
export interface DebugText {
    readonly kind: "text";
    readonly category: DebugCategory;
    readonly position: readonly [number, number, number];
    readonly text: string;
    readonly color: Rgba;
    readonly duration: number;
    readonly depthTest: boolean;
}
export type DebugPrimitive = DebugLine | DebugText;
export interface DebugDrawOptions {
    readonly color?: Rgba;
    readonly duration?: number;
    readonly depthTest?: boolean;
    readonly category?: DebugCategory;
}
/** Default colours, so subsystems agree on what a shape's colour means. */
export declare const DEBUG_COLORS: {
    readonly white: [1, 1, 1, 1];
    readonly red: [1, 0.2, 0.2, 1];
    readonly green: [0.2, 1, 0.3, 1];
    readonly blue: [0.3, 0.5, 1, 1];
    readonly yellow: [1, 0.9, 0.2, 1];
    readonly cyan: [0.2, 0.9, 1, 1];
    readonly magenta: [1, 0.3, 0.9, 1];
    readonly orange: [1, 0.6, 0.1, 1];
};
/** Categories the engine's own subsystems draw under, so they can be toggled
 * independently. */
export declare const DEBUG_CATEGORIES: {
    readonly physics: "physics";
    readonly navigation: "navigation";
    readonly culling: "culling";
    readonly audio: "audio";
    readonly network: "network";
    readonly ai: "ai";
    readonly xr: "xr";
    readonly general: "general";
};
/**
 * A frame's worth of queued debug primitives.
 *
 * Categories can be enabled independently, and a disabled category costs one
 * set lookup per call — cheap enough that debug drawing can stay in shipping
 * gameplay code behind a switch rather than being deleted.
 */
export declare class DebugDraw {
    #private;
    constructor(options?: {
        readonly maxPrimitives?: number;
    });
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Primitives dropped because the budget was hit, so a runaway debug loop is
     * visible as a number instead of as a frozen tab. */
    get dropped(): number;
    get count(): number;
    setCategoryEnabled(category: DebugCategory, enabled: boolean): void;
    isCategoryEnabled(category: DebugCategory): boolean;
    get disabledCategories(): readonly DebugCategory[];
    line(from: readonly number[], to: readonly number[], options?: DebugDrawOptions): void;
    text(position: readonly number[], text: string, options?: DebugDrawOptions): void;
    /** Connects a sequence of points; `close` joins the last back to the first. */
    polyline(points: readonly (readonly number[])[], options?: DebugDrawOptions & {
        readonly close?: boolean;
    }): void;
    /** Wireframe axis-aligned box, the workhorse for bounds and colliders. */
    box(min: readonly number[], max: readonly number[], options?: DebugDrawOptions): void;
    /** Three orthogonal rings approximating a sphere. */
    sphere(center: readonly number[], radius: number, options?: DebugDrawOptions & {
        readonly segments?: number;
    }): void;
    /** A ray with a small arrowhead, for directions and normals. */
    arrow(origin: readonly number[], direction: readonly number[], options?: DebugDrawOptions & {
        readonly headSize?: number;
    }): void;
    /** Three coloured axes showing a transform's orientation. */
    axes(origin: readonly number[], scale?: number, options?: Omit<DebugDrawOptions, "color">): void;
    /** Everything queued, for a renderer to consume. */
    primitives(): readonly DebugPrimitive[];
    /**
     * Drops one frame's primitives, keeping those with time remaining.
     *
     * Timed primitives are what make a single-frame event — a raycast hit, a
     * collision — visible at all: they persist long enough to see without the
     * caller having to redraw them.
     */
    clear(deltaSeconds?: number): void;
    /** Removes everything, timed primitives included. */
    reset(): void;
}
//# sourceMappingURL=debug-draw.d.ts.map