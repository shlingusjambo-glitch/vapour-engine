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
import { navMeshLineOfSight, smoothPath } from "./navmesh.js";

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
export class NavAgent {
  readonly id: number;
  readonly radius: number;
  readonly maxSpeed: number;
  readonly maxAcceleration: number;
  readonly arrivalRadius: number;
  readonly waypointRadius: number;
  readonly priority: number;

  position: [number, number, number];
  velocity: [number, number, number] = [0, 0, 0];

  #path: readonly [number, number, number][] = [];
  #waypoint = 0;
  #destination: [number, number, number] | undefined;
  #state: NavAgentState = "idle";

  /** @internal Constructed through {@link Crowd.addAgent}. */
  constructor(id: number, options: NavAgentOptions) {
    this.id = id;
    this.position = [options.position[0], options.position[1], options.position[2]];
    this.radius = positive(options.radius ?? 0.35, "A nav agent radius");
    this.maxSpeed = positive(options.maxSpeed ?? 3.5, "A nav agent max speed");
    this.maxAcceleration = positive(options.maxAcceleration ?? 12, "A nav agent max acceleration");
    this.arrivalRadius = positive(options.arrivalRadius ?? 0.4, "A nav agent arrival radius");
    this.waypointRadius = positive(options.waypointRadius ?? 0.6, "A nav agent waypoint radius");
    this.priority = options.priority ?? 1;
  }

  get state(): NavAgentState {
    return this.#state;
  }

  get destination(): readonly [number, number, number] | undefined {
    return this.#destination;
  }

  /** Remaining waypoints, for debug rendering. */
  get path(): readonly (readonly [number, number, number])[] {
    return this.#path.slice(this.#waypoint);
  }

  /** Straight-line distance along the remaining path. */
  get remainingDistance(): number {
    let total = 0;
    let from = this.position;
    for (let index = this.#waypoint; index < this.#path.length; index += 1) {
      total += distance(from, this.#path[index]!);
      from = this.#path[index]!;
    }
    return total;
  }

  /** @internal Set by the crowd when a path is computed. */
  setPath(path: readonly [number, number, number][], destination: [number, number, number] | undefined, state: NavAgentState): void {
    this.#path = path;
    this.#waypoint = 0;
    this.#destination = destination;
    this.#state = state;
  }

  clearPath(): void {
    this.#path = [];
    this.#waypoint = 0;
    this.#destination = undefined;
    this.#state = "idle";
    this.velocity = [0, 0, 0];
  }

  /** @internal The velocity the agent wants before avoidance. */
  desiredVelocity(): [number, number, number] {
    if (this.#state !== "moving" || this.#waypoint >= this.#path.length) return [0, 0, 0];
    // Advance past waypoints already reached, so a fast agent does not
    // ping-pong between two it passed in one step.
    while (this.#waypoint < this.#path.length - 1 && distance(this.position, this.#path[this.#waypoint]!) <= this.waypointRadius) {
      this.#waypoint += 1;
    }
    const target = this.#path[this.#waypoint]!;
    const toTarget: [number, number, number] = [target[0] - this.position[0], 0, target[2] - this.position[2]];
    const length = Math.hypot(toTarget[0], toTarget[2]);
    if (length < 1e-6) return [0, 0, 0];

    const isLast = this.#waypoint === this.#path.length - 1;
    // Slow into the final waypoint so the agent stops rather than overshooting
    // and circling back, which is what makes arrival look deliberate.
    const speed = isLast ? this.maxSpeed * Math.min(1, length / Math.max(this.arrivalRadius, 1e-6)) : this.maxSpeed;
    return [(toTarget[0] / length) * speed, 0, (toTarget[2] / length) * speed];
  }

  /** @internal Applied by the crowd after avoidance. */
  integrate(velocity: readonly [number, number, number], deltaSeconds: number): void {
    this.velocity = [velocity[0], velocity[1], velocity[2]];
    this.position = [
      this.position[0] + velocity[0] * deltaSeconds,
      this.position[1] + velocity[1] * deltaSeconds,
      this.position[2] + velocity[2] * deltaSeconds,
    ];
    if (this.#state === "moving" && this.#waypoint >= this.#path.length - 1) {
      const target = this.#path[this.#path.length - 1];
      if (target && distance(this.position, target) <= this.arrivalRadius) {
        this.#state = "arrived";
        this.velocity = [0, 0, 0];
      }
    }
  }

  snapshot(): NavAgentSnapshot {
    return {
      id: this.id,
      position: [...this.position],
      velocity: [...this.velocity],
      state: this.#state,
      remainingDistance: this.remainingDistance,
    };
  }
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
export class Crowd {
  readonly #navmesh: NavMesh;
  readonly #agents = new Map<number, NavAgent>();
  readonly #options: Required<CrowdOptions>;
  #nextId = 1;
  #repaths = 0;

  constructor(navmesh: NavMesh, options: CrowdOptions = {}) {
    this.#navmesh = navmesh;
    this.#options = {
      avoidanceHorizon: options.avoidanceHorizon ?? 1.6,
      avoidanceSamples: options.avoidanceSamples ?? 12,
      maxNeighbours: options.maxNeighbours ?? 8,
      smoothPaths: options.smoothPaths ?? true,
    };
    if (!(this.#options.avoidanceHorizon > 0)) throw new Error("A crowd's avoidance horizon must be positive.");
    if (!Number.isInteger(this.#options.avoidanceSamples) || this.#options.avoidanceSamples < 1) {
      throw new Error("A crowd's avoidance sample count must be a whole number of at least 1.");
    }
  }

  get agents(): readonly NavAgent[] {
    return [...this.#agents.values()];
  }

  agent(id: number): NavAgent | undefined {
    return this.#agents.get(id);
  }

  addAgent(options: NavAgentOptions): NavAgent {
    const agent = new NavAgent(this.#nextId++, options);
    this.#agents.set(agent.id, agent);
    return agent;
  }

  removeAgent(id: number): boolean {
    return this.#agents.delete(id);
  }

  /**
   * Sets an agent's destination, computing and smoothing a path.
   *
   * Returns whether a route was found. An unreachable destination leaves the
   * agent stationary in the `unreachable` state rather than walking toward a
   * place it cannot get to.
   */
  setDestination(agent: NavAgent, destination: readonly [number, number, number]): boolean {
    this.#repaths += 1;
    const result = this.#navmesh.findPath(agent.position, destination);
    if (result.status !== "complete" || result.points.length === 0) {
      agent.setPath([], [destination[0], destination[1], destination[2]], "unreachable");
      agent.velocity = [0, 0, 0];
      return false;
    }
    const points = this.#options.smoothPaths
      ? smoothPath(result.points, (from, to) => navMeshLineOfSight(this.#navmesh, from, to))
      : result.points;
    agent.setPath([...points] as [number, number, number][], [destination[0], destination[1], destination[2]], "moving");
    return true;
  }

  /**
   * Repaths any agent whose destination has moved further than `threshold`.
   *
   * This is how an NPC chases a moving target without repathing every frame,
   * which on a large navmesh is the difference between a playable crowd and a
   * frame-rate problem.
   */
  updateMovingDestination(agent: NavAgent, destination: readonly [number, number, number], threshold = 1.5): boolean {
    const previous = agent.destination;
    if (previous !== undefined && distance(previous, destination) < threshold && agent.state === "moving") return false;
    return this.setDestination(agent, destination);
  }

  /** Advances every agent by one step, with avoidance. */
  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("Crowd.update requires a finite, non-negative delta.");
    if (deltaSeconds === 0) return;
    // Iterate in id order so the result does not depend on Map insertion
    // details — determinism is a requirement, not a nicety.
    const agents = [...this.#agents.values()].sort((a, b) => a.id - b.id);
    const desired = agents.map((agent) => agent.desiredVelocity());
    const chosen: [number, number, number][] = [];

    for (const [index, agent] of agents.entries()) {
      const want = desired[index]!;
      const neighbours = this.#neighboursOf(agent, agents);
      const velocity = neighbours.length === 0 ? want : this.#avoid(agent, want, neighbours);
      // Clamp acceleration so an agent turns rather than snapping direction.
      const maxDelta = agent.maxAcceleration * deltaSeconds;
      const dx = velocity[0] - agent.velocity[0];
      const dz = velocity[2] - agent.velocity[2];
      const change = Math.hypot(dx, dz);
      chosen.push(
        change <= maxDelta
          ? [velocity[0], 0, velocity[2]]
          : [agent.velocity[0] + (dx / change) * maxDelta, 0, agent.velocity[2] + (dz / change) * maxDelta],
      );
    }

    for (const [index, agent] of agents.entries()) agent.integrate(chosen[index]!, deltaSeconds);
  }

  stats(): CrowdStats {
    const agents = [...this.#agents.values()];
    return {
      agents: agents.length,
      moving: agents.filter((agent) => agent.state === "moving").length,
      arrived: agents.filter((agent) => agent.state === "arrived").length,
      unreachable: agents.filter((agent) => agent.state === "unreachable").length,
      repaths: this.#repaths,
    };
  }

  /** The nearest few agents, which bounds avoidance cost in a dense crowd. */
  #neighboursOf(agent: NavAgent, agents: readonly NavAgent[]): NavAgent[] {
    const horizon = agent.maxSpeed * this.#options.avoidanceHorizon + agent.radius * 4;
    const near: { agent: NavAgent; distance: number }[] = [];
    for (const other of agents) {
      if (other.id === agent.id) continue;
      const separation = Math.hypot(other.position[0] - agent.position[0], other.position[2] - agent.position[2]);
      if (separation > horizon) continue;
      near.push({ agent: other, distance: separation });
    }
    near.sort((a, b) => a.distance - b.distance || a.agent.id - b.agent.id);
    return near.slice(0, this.#options.maxNeighbours).map((entry) => entry.agent);
  }

  /**
   * Picks the best candidate velocity by time to collision.
   *
   * Candidates are the desired velocity plus a fan of rotated and scaled
   * variants. Scoring balances how soon a candidate collides against how far it
   * deviates from what the agent wanted — so an agent with a clear path keeps
   * going straight, and one facing a collision turns the smallest amount that
   * resolves it.
   */
  #avoid(agent: NavAgent, want: readonly [number, number, number], neighbours: readonly NavAgent[]): [number, number, number] {
    const wantSpeed = Math.hypot(want[0], want[2]);
    if (wantSpeed < 1e-6) return [0, 0, 0];
    const horizon = this.#options.avoidanceHorizon;
    const samples = this.#options.avoidanceSamples;

    let best: [number, number, number] = [want[0], 0, want[2]];
    let bestScore = -Infinity;

    for (let sample = 0; sample <= samples; sample += 1) {
      for (const speedScale of [1, 0.6, 0.25] as const) {
        // Sample alternately left and right of the desired heading, so a
        // symmetric encounter still resolves rather than deadlocking.
        const step = Math.ceil(sample / 2);
        const side = sample % 2 === 0 ? 1 : -1;
        const angle = ((step * Math.PI) / samples) * side * 1.5;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const candidate: [number, number, number] = [
          (want[0] * cos - want[2] * sin) * speedScale,
          0,
          (want[0] * sin + want[2] * cos) * speedScale,
        ];

        let earliest = horizon;
        for (const other of neighbours) {
          const time = timeToCollision(agent, other, candidate, horizon);
          if (time < earliest) earliest = time;
        }

        // Prefer late collisions, then similarity to the desired velocity.
        const deviation = Math.hypot(candidate[0] - want[0], candidate[2] - want[2]) / Math.max(wantSpeed, 1e-6);
        const score = earliest * 2.5 - deviation;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
    }
    return best;
  }
}

/**
 * Time until two agents' discs touch, given a candidate velocity.
 *
 * Returns the horizon when they never collide within it. Neighbours are treated
 * as continuing at their current velocity, which is the standard reciprocal
 * assumption: both agents adjust, so each only needs to solve half the problem.
 */
function timeToCollision(agent: NavAgent, other: NavAgent, velocity: readonly [number, number, number], horizon: number): number {
  const px = other.position[0] - agent.position[0];
  const pz = other.position[2] - agent.position[2];
  const combined = agent.radius + other.radius;
  const overlapping = px * px + pz * pz;
  // Already touching: treat as an immediate collision so the agent backs off.
  if (overlapping <= combined * combined) return 0;

  // Priority decides who yields; an equal pair splits the adjustment.
  const share = agent.priority >= other.priority ? 0.5 : 1;
  const vx = velocity[0] - other.velocity[0] * share;
  const vz = velocity[2] - other.velocity[2] * share;

  const a = vx * vx + vz * vz;
  if (a < 1e-9) return horizon;
  const b = px * vx + pz * vz;
  if (b <= 0) return horizon;   // moving apart
  const c = overlapping - combined * combined;
  const discriminant = b * b - a * c;
  if (discriminant <= 0) return horizon;
  const time = (b - Math.sqrt(discriminant)) / a;
  return time < 0 ? horizon : Math.min(time, horizon);
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

function positive(value: number, label: string): number {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`${label} must be a positive, finite number (got ${value}).`);
  return value;
}
