/** Navigation agents and crowd avoidance.
 *
 * A path is not movement. An NPC handed a list of waypoints still has to
 * follow them at a sensible speed, stop when it arrives, notice when its
 * destination moves, and — the part every game underestimates — not walk
 * through the other twenty NPCs doing the same thing.
 *
 * Local avoidance here is **velocity sampling**: each agent proposes a set of
 * candidate velocities around its desired one and picks the best-scoring by
 * time-to-collision against its neighbours. This is the approach Recast uses,
 * chosen over a force-based model because forces produce the two failures that
 * make crowds look wrong — agents that oscillate against each other, and agents
 * that shove each other through walls. Sampling never proposes a velocity that
 * was not already acceptable.
 *
 * Everything is deterministic: candidates are enumerated in a fixed order and
 * ties break on index, so the same inputs produce the same movement on every
 * machine. That is what lets a client predict NPC motion instead of waiting for
 * the server to send positions.
 */
import type { NavMesh } from "./navmesh.js";
export type NavAgentState = "idle" | "moving" | "arrived" | "unreachable";
export interface NavAgentOptions {
    readonly position: readonly [number, number, number];
    readonly radius?: number;
    readonly maxSpeed?: number;
    /** How fast the agent may change velocity, in units per second squared. */
    readonly maxAcceleration?: number;
    /** Distance at which the agent considers itself arrived. */
    readonly arrivalRadius?: number;
    /** Distance from a waypoint at which it advances to the next. */
    readonly waypointRadius?: number;
    /** Higher-priority agents yield less. Equal priorities share avoidance. */
    readonly priority?: number;
}
export interface NavAgentSnapshot {
    readonly id: number;
    readonly position: readonly [number, number, number];
    readonly velocity: readonly [number, number, number];
    readonly state: NavAgentState;
    readonly remainingDistance: number;
}
/** One navigating agent. Owned by a {@link Crowd}, which steps it. */
export declare class NavAgent {
    #private;
    readonly id: number;
    readonly radius: number;
    readonly maxSpeed: number;
    readonly maxAcceleration: number;
    readonly arrivalRadius: number;
    readonly waypointRadius: number;
    readonly priority: number;
    position: [number, number, number];
    velocity: [number, number, number];
    /** @internal Constructed through {@link Crowd.addAgent}. */
    constructor(id: number, options: NavAgentOptions);
    get state(): NavAgentState;
    get destination(): readonly [number, number, number] | undefined;
    /** Remaining waypoints, for debug rendering. */
    get path(): readonly (readonly [number, number, number])[];
    /** Straight-line distance along the remaining path. */
    get remainingDistance(): number;
    /** @internal Set by the crowd when a path is computed. */
    setPath(path: readonly [number, number, number][], destination: [number, number, number] | undefined, state: NavAgentState): void;
    clearPath(): void;
    /** @internal The velocity the agent wants before avoidance. */
    desiredVelocity(): [number, number, number];
    /** @internal Applied by the crowd after avoidance. */
    integrate(velocity: readonly [number, number, number], deltaSeconds: number): void;
    snapshot(): NavAgentSnapshot;
}
export interface CrowdOptions {
    /** How far ahead avoidance looks, in seconds. */
    readonly avoidanceHorizon?: number;
    /** Candidate directions sampled around the desired velocity. */
    readonly avoidanceSamples?: number;
    /** Neighbours considered per agent. Bounds the cost of a dense crowd. */
    readonly maxNeighbours?: number;
    /** Straighten paths on assignment. */
    readonly smoothPaths?: boolean;
}
export interface CrowdStats {
    readonly agents: number;
    readonly moving: number;
    readonly arrived: number;
    readonly unreachable: number;
    readonly repaths: number;
}
/**
 * A set of agents navigating one navmesh together.
 *
 * The crowd owns stepping because avoidance is inherently a group decision: an
 * agent cannot choose a velocity without knowing what its neighbours chose.
 */
export declare class Crowd {
    #private;
    constructor(navmesh: NavMesh, options?: CrowdOptions);
    get agents(): readonly NavAgent[];
    agent(id: number): NavAgent | undefined;
    addAgent(options: NavAgentOptions): NavAgent;
    removeAgent(id: number): boolean;
    /**
     * Sets an agent's destination, computing and smoothing a path.
     *
     * Returns whether a route was found. An unreachable destination leaves the
     * agent stationary in the `unreachable` state rather than walking toward a
     * place it cannot get to.
     */
    setDestination(agent: NavAgent, destination: readonly [number, number, number]): boolean;
    /**
     * Repaths any agent whose destination has moved further than `threshold`.
     *
     * This is how an NPC chases a moving target without repathing every frame,
     * which on a large navmesh is the difference between a playable crowd and a
     * frame-rate problem.
     */
    updateMovingDestination(agent: NavAgent, destination: readonly [number, number, number], threshold?: number): boolean;
    /** Advances every agent by one step, with avoidance. */
    update(deltaSeconds: number): void;
    stats(): CrowdStats;
}
//# sourceMappingURL=nav-agent.d.ts.map