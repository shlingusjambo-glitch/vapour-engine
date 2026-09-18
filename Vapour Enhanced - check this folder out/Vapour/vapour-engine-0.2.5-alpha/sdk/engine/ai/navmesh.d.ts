/** NavMesh baking and queries.
 *
 * Before Mirage, `findPath` searched a graph the *caller* supplied. That is the
 * right low-level primitive and the wrong thing to ask a game for: building the
 * graph is the hard part, and it is the part that has to agree with the
 * geometry the renderer and physics use. So this module bakes one from
 * triangles.
 *
 * The approach is a heightfield voxelization, the same shape of algorithm
 * Recast uses and for the same reasons: it makes no assumptions about the input
 * being clean, it handles overlapping floors (a bridge over a road, a second
 * storey) naturally by keeping several spans per column, and its parameters —
 * cell size, agent radius, step height — are quantities a designer can reason
 * about rather than tuning constants.
 *
 * Baking is deliberately **per agent size**. A navmesh eroded for a 0.3 m
 * radius is wrong for a 1.2 m vehicle, and the alternative — one mesh with
 * runtime radius checks — is both slower and subtly wrong at corners.
 */
import { type NavigationNode, type PathResult } from "./navigation.js";
export interface NavMeshSettings {
    /** Horizontal resolution in world units. Smaller is more accurate and slower. */
    readonly cellSize?: number;
    /** Vertical quantization. Should be well under `agentMaxClimb`. */
    readonly cellHeight?: number;
    /** Agent radius. Walkable area is eroded by this, so paths clear walls. */
    readonly agentRadius?: number;
    /** Vertical clearance an agent needs to stand. */
    readonly agentHeight?: number;
    /** Tallest step an agent can walk up without jumping. */
    readonly agentMaxClimb?: number;
    /** Steepest ground an agent can stand on. */
    readonly maxSlopeDegrees?: number;
}
export declare const DEFAULT_NAVMESH_SETTINGS: Required<NavMeshSettings>;
/** Triangles to bake, plus optional per-triangle area ids. */
export interface NavMeshInput {
    readonly positions: Float32Array;
    readonly indices: Uint32Array;
    /** Area id per triangle. Area 0 is the default; see {@link NavArea}. */
    readonly areas?: Uint8Array;
}
/** A named traversal cost multiplier. Water costs more than road. */
export interface NavArea {
    readonly id: number;
    readonly name: string;
    /** Multiplies traversal cost. `Infinity` makes the area impassable. */
    readonly cost: number;
}
export declare const DEFAULT_AREA: NavArea;
/** One walkable surface in one column of the grid. */
export interface NavSpan {
    readonly index: number;
    /** Column coordinates. */
    readonly x: number;
    readonly z: number;
    /** World height of the walkable surface. */
    readonly y: number;
    readonly area: number;
    /** Indices of connected spans in the four neighbouring columns. */
    readonly links: number[];
}
/** A connection that is not simple adjacency: a door, a jump, a ladder. */
export interface OffMeshLink {
    readonly from: readonly [number, number, number];
    readonly to: readonly [number, number, number];
    /** Cost of using the link, in world units. */
    readonly cost?: number;
    readonly bidirectional?: boolean;
    readonly kind?: string;
}
/** A runtime carving volume. Reusing an id moves it atomically. */
export interface NavObstacle {
    readonly id: string;
    readonly position: readonly [number, number, number];
    readonly radius: number;
    readonly height?: number;
}
export interface NavMeshStats {
    readonly spans: number;
    readonly columns: number;
    readonly links: number;
    readonly offMeshLinks: number;
    readonly bakeMs: number;
    readonly cellSize: number;
    readonly agentRadius: number;
    readonly dynamicObstacles: number;
}
/** A world-space AABB (Y ignored) of the region that changed and needs
 * rebaking — e.g. a streamed-in tile or an edited chunk of geometry. */
export interface RebakeRegion {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
}
/** What a {@link NavMesh.rebakeRegion} call changed. Span counts are scoped to
 * the requested region; `spansRebaked` also counts the halo recomputed around
 * it to keep adjacency correct. */
export interface RebakeReport {
    readonly navmesh: NavMesh;
    readonly spansAdded: number;
    readonly spansRemoved: number;
    readonly spansModified: number;
    readonly spansRebaked: number;
    readonly spansTotal: number;
    readonly offMeshLinksInvalidated: number;
}
export declare const NAVMESH_DATA_VERSION: 1;
/** Source-control-friendly baked navigation asset. Infinity area costs are
 * encoded as `null`, the JSON representation for an impassable area. */
export interface NavMeshData {
    readonly version: typeof NAVMESH_DATA_VERSION;
    readonly settings: Required<NavMeshSettings>;
    readonly origin: readonly [number, number, number];
    readonly spans: readonly NavSpan[];
    readonly areas: readonly {
        readonly id: number;
        readonly name: string;
        readonly cost: number | null;
    }[];
    readonly offMeshLinks: readonly {
        readonly from: number;
        readonly to: number;
        readonly cost: number;
        readonly kind: string;
    }[];
}
interface Column {
    readonly spans: NavSpan[];
}
/** Baked navigation data plus the queries a game runs against it. */
export declare class NavMesh {
    #private;
    readonly settings: Required<NavMeshSettings>;
    /** @internal Built by {@link bakeNavMesh}. */
    constructor(settings: Required<NavMeshSettings>, spans: NavSpan[], columns: Map<number, Column>, origin: readonly [number, number, number], areas: readonly NavArea[], bakeMs: number);
    get spanCount(): number;
    get isEmpty(): boolean;
    stats(): NavMeshStats;
    /** Deterministic asset form; runtime maps and column indexes are rebuilt on load. */
    serialize(): NavMeshData;
    /** Rehydrates a baked asset without rerunning geometry voxelization. */
    static deserialize(input: unknown): NavMesh;
    /** Every span, for debug rendering. */
    spans(): readonly NavSpan[];
    /** World-space centre of a span, which is where a path routes through. */
    spanPosition(span: NavSpan): [number, number, number];
    /**
     * Adds a connection that adjacency cannot express.
     *
     * This is how a generated building's doorways become routes: the architecture
     * generator reports apertures, and each walkable one becomes a link here.
     * Endpoints snap to the nearest span, so a link placed approximately still
     * connects.
     */
    addOffMeshLink(link: OffMeshLink): boolean;
    /** Off-mesh links, for debug rendering. */
    offMeshLinks(): readonly {
        readonly from: readonly [number, number, number];
        readonly to: readonly [number, number, number];
        readonly kind: string;
    }[];
    /** Adds or moves a dynamic obstacle and returns its carved span count. */
    setObstacle(obstacle: NavObstacle): number;
    /** Removes one carving volume while preserving overlapping obstacles. */
    removeObstacle(id: string): boolean;
    isSpanBlocked(index: number): boolean;
    /**
     * The walkable span nearest a world position.
     *
     * Searches outward ring by ring rather than scanning every span: an agent
     * asks this every time it is given a destination, and a linear scan over a
     * large map would show up in the frame.
     */
    nearestSpan(position: readonly number[], maxRadiusCells?: number): NavSpan | undefined;
    isWalkable(position: readonly number[], tolerance?: number): boolean;
    /**
     * Finds a path between two world positions.
     *
     * Returns the corridor of span centres. Use {@link smoothPath} to turn it
     * into the straight-line route an agent should actually walk — a raw grid
     * corridor makes agents move in visible staircase steps.
     */
    findPath(start: readonly number[], goal: readonly number[], options?: {
        maxVisited?: number;
    }): PathResult<NavigationNode> & {
        readonly points: readonly [number, number, number][];
    };
    /**
     * Rebakes only the spans touching `region`, splicing them into this mesh
     * instead of rebaking whole. Built for streaming worlds: a newly loaded or
     * edited tile shouldn't force every other tile's navmesh to reprocess.
     *
     * `input` must describe the tile's *current* geometry (not a delta) — a
     * column inside `region` with no covering triangle becomes empty, which is
     * how removed geometry is represented.
     *
     * Correctness relies on two rings around `region`, sized from the agent
     * radius: a "halo" of `ceil(agentRadius / cellSize) + 1` columns where span
     * *existence* is recomputed (erosion can only be affected this far from a
     * geometry change), and one further ring where only *links* are
     * recomputed against the halo's new spans. Everything outside that is
     * mechanically unreachable by the edit and is carried over unchanged,
     * other than a possible index renumbering — the flat span array has no
     * gaps, so any change in span count shifts later indices; span *content*
     * (position/area/links) outside the touched rings is otherwise untouched.
     * Off-mesh links with an endpoint in the touched region are re-snapped by
     * position; a removed endpoint drops the link.
     */
    rebakeRegion(input: NavMeshInput, region: RebakeRegion): RebakeReport;
}
export declare function serializeNavMesh(navmesh: NavMesh): string;
export declare function deserializeNavMesh(source: string | unknown): NavMesh;
/**
 * Bakes a navmesh from triangles.
 *
 * Steps, in order:
 *
 * 1. **Rasterize** each triangle into the columns its footprint covers,
 *    recording a surface height per column, and reject triangles steeper than
 *    the slope limit.
 * 2. **Merge** near-coincident surfaces in a column, so a floor made of many
 *    triangles becomes one span rather than dozens.
 * 3. **Connect** spans in neighbouring columns whose height difference an agent
 *    can step over.
 * 4. **Erode** by the agent radius, removing spans too close to an edge — this
 *    is what stops agents clipping walls, and doing it on the grid is far
 *    cheaper than testing radius at query time.
 */
export declare function bakeNavMesh(input: NavMeshInput, settings?: NavMeshSettings, areas?: readonly NavArea[]): NavMesh;
/**
 * Straightens a grid corridor into the route an agent should walk.
 *
 * A raw corridor follows cell centres, so an agent walking it moves in visible
 * staircase steps. This removes any waypoint that can be skipped without
 * leaving the corridor, which is the cheap and robust half of what a funnel
 * algorithm does and needs no portal extraction.
 */
export declare function smoothPath(points: readonly (readonly [number, number, number])[], isClear: (from: readonly number[], to: readonly number[]) => boolean): readonly [number, number, number][];
/** Straight-line walkability test over a navmesh, for {@link smoothPath}. */
export declare function navMeshLineOfSight(navmesh: NavMesh, from: readonly number[], to: readonly number[]): boolean;
export {};
//# sourceMappingURL=navmesh.d.ts.map