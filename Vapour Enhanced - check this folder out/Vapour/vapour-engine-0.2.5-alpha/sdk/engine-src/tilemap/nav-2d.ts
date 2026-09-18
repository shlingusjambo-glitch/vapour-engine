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
import {
  findPath,
  type NavigationNode,
  type PathResult,
} from "../ai/navigation.js";
import { smoothPath } from "../ai/navmesh.js";
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

const GRID_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** 2D pathfinding over a tilemap: walkability, agent clearance, dynamic
 * obstacles, and smoothed paths, all reusing the engine's existing A* and
 * string-pulling rather than a second implementation of either. */
export class Nav2D {
  readonly #tilemap: Tilemap;
  readonly #radius: number;
  readonly #blockingKinds: ReadonlySet<TileCollision["kind"]>;
  readonly #blocked = new Set<string>();

  constructor(tilemap: Tilemap, options: Nav2DOptions = {}) {
    this.#tilemap = tilemap;
    const radius = Math.round(options.agentRadius ?? 0);
    if (!Number.isFinite(radius) || radius < 0)
      throw new Error("Nav2D agentRadius must be a non-negative number.");
    this.#radius = radius;
    this.#blockingKinds = new Set(options.blockingKinds ?? ["solid"]);
  }

  get agentRadius(): number {
    return this.#radius;
  }

  /** Raw tilemap collision at one cell, ignoring agent radius and dynamic
   * obstacles. */
  isTileOpen(x: number, y: number): boolean {
    const hit = this.#tilemap.tileAt(x, y);
    if (!hit?.definition.collision) return true;
    return !this.#blockingKinds.has(hit.definition.collision.kind);
  }

  /** Whether an agent of this nav's radius and current dynamic obstacles can
   * occupy a cell: every tile in its footprint must be open. */
  isWalkable(x: number, y: number): boolean {
    if (this.#blocked.has(cellKey(x, y))) return false;
    for (let dy = -this.#radius; dy <= this.#radius; dy += 1) {
      for (let dx = -this.#radius; dx <= this.#radius; dx += 1) {
        if (!this.isTileOpen(x + dx, y + dy)) return false;
      }
    }
    return true;
  }

  /** Marks a cell as temporarily blocked (or clears that), independent of
   * the tilemap's own geometry — a crate, another agent, a closed door. */
  setBlocked(x: number, y: number, blocked = true): void {
    const key = cellKey(x, y);
    if (blocked) this.#blocked.add(key);
    else this.#blocked.delete(key);
  }

  isDynamicallyBlocked(x: number, y: number): boolean {
    return this.#blocked.has(cellKey(x, y));
  }

  /** Straight-line walkability between two cell centres, for
   * {@link smoothPath}. Samples along the segment rather than a true
   * Bresenham walk — cheap, and exact enough at grid resolution. */
  lineOfSight(
    from: readonly [number, number],
    to: readonly [number, number],
  ): boolean {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = Math.round(from[0] + dx * t);
      const y = Math.round(from[1] + dy * t);
      if (!this.isWalkable(x, y)) return false;
    }
    return true;
  }

  /** Finds a path in tile coordinates. Returns the raw corridor and a
   * string-pulled, shorter `points` route. */
  findPath(
    start: readonly [number, number],
    goal: readonly [number, number],
    options: { maxVisited?: number } = {},
  ): Nav2DPathResult {
    if (!this.isWalkable(start[0], start[1]) || !this.isWalkable(goal[0], goal[1])) {
      return { status: "unreachable", cells: [], points: [], visited: 0, cost: Infinity };
    }
    const toNode = (x: number, y: number): NavigationNode => ({ x, y: 0, z: y });
    const result = findPath(
      toNode(start[0], start[1]),
      toNode(goal[0], goal[1]),
      {
        key: (node) => `${node.x},${node.z}`,
        neighbours: (node) => {
          const out: NavigationNode[] = [];
          for (const [dx, dz] of GRID_OFFSETS) {
            const nx = node.x + dx;
            const nz = node.z + dz;
            if (this.isWalkable(nx, nz)) out.push(toNode(nx, nz));
          }
          return out;
        },
        ...(options.maxVisited === undefined
          ? {}
          : { maxVisited: options.maxVisited }),
      },
    );

    const cells = result.path.map(
      (node) => [node.x, node.z] as [number, number],
    );
    const points3 = cells.map(
      ([x, y]) => [x, 0, y] as [number, number, number],
    );
    const smoothed = smoothPath(points3, (from, to) =>
      this.lineOfSight(
        [from[0] ?? 0, from[2] ?? 0],
        [to[0] ?? 0, to[2] ?? 0],
      ),
    );
    return {
      status: result.status,
      cells,
      points: smoothed.map(([x, , z]) => [x, z] as [number, number]),
      visited: result.visited,
      cost: result.cost,
    };
  }
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}
