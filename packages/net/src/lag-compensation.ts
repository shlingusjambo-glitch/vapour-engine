/** Server-side rewind: judging a shot against what the shooter actually saw.
 *
 * Interpolation and prediction hide latency from the *player*; they do nothing
 * for the *server*. A client rendering two ticks behind, on a 80 ms link, aims
 * at where a target was ~130 ms ago. Validating that shot against the present
 * misses every moving target, and the game feels like the hit registration is
 * broken — because it is.
 *
 * The fix is to keep a bounded history of past world states and evaluate the
 * shot in the past. Two properties make that safe rather than exploitable:
 *
 * - **The history is bounded.** A ring of `capacity` ticks costs a fixed amount
 *   of memory no matter how long the match runs.
 * - **The rewind is clamped.** A client claiming a second of latency would
 *   otherwise be shooting at a world everyone else left long ago, so the rewind
 *   stops at `maxRewindMs` and reports that it did. Clamping rather than
 *   rejecting is deliberate: a genuinely laggy player still gets a shot judged
 *   as fairly as the budget allows, they just stop getting a free one.
 *
 * Everything here is expressed in ticks and caller-supplied milliseconds. There
 * is no clock read anywhere in this file, which is what makes a rewind test
 * reproduce exactly.
 */
import { clamp, ray, rayIntersectsSphere, sphere } from "@vapour/math";
import type { NetState, NetValue, NetworkId } from "./protocol.js";

/** One retained tick of the world. */
export interface HistoricalState {
  readonly tick: number;
  readonly states: ReadonlyMap<NetworkId, NetState>;
}

/** Anything with a replicated state; `NetworkEntity` satisfies it. */
export interface RecordableEntity {
  readonly id: NetworkId;
  readonly state: NetState;
}

export interface SnapshotHistoryOptions {
  /** Ticks retained. The buffer never grows past this. */
  readonly capacity?: number;
  /** Server tick rate, used to convert a latency in milliseconds to ticks. */
  readonly tickRate?: number;
  /** Furthest the server will rewind, in milliseconds. */
  readonly maxRewindMs?: number;
}

export interface RewindResult {
  /** Fractional tick actually rewound to. */
  readonly tick: number;
  /** Whether the request was cut short by the clamp or by the buffer's age. */
  readonly clamped: boolean;
  /** Milliseconds actually rewound, after clamping. */
  readonly appliedMs: number;
  readonly states: ReadonlyMap<NetworkId, NetState>;
}

/**
 * A ring buffer of past world states.
 *
 * Recording is a shallow copy of each entity's state object. States are frozen
 * by convention in the replication layer (they are replaced wholesale, never
 * mutated), so retaining the reference is safe and keeps recording O(entities)
 * with no deep clone per tick.
 */
export class SnapshotHistory {
  readonly #capacity: number;
  readonly #tickRate: number;
  readonly #maxRewindMs: number;
  readonly #ring: (HistoricalState | undefined)[];
  #count = 0;
  #next = 0;

  constructor(options: SnapshotHistoryOptions = {}) {
    const capacity = options.capacity ?? 32;
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new Error("Snapshot history capacity must be a whole number of at least 2.");
    }
    const tickRate = options.tickRate ?? 20;
    if (!Number.isInteger(tickRate) || tickRate < 1) {
      throw new Error("Snapshot history tick rate must be a whole number of at least 1.");
    }
    const maxRewindMs = options.maxRewindMs ?? 250;
    if (!(maxRewindMs >= 0)) throw new Error("Maximum rewind must not be negative.");
    this.#capacity = capacity;
    this.#tickRate = tickRate;
    this.#maxRewindMs = maxRewindMs;
    this.#ring = new Array<HistoricalState | undefined>(capacity).fill(undefined);
  }

  get capacity(): number {
    return this.#capacity;
  }

  get tickRate(): number {
    return this.#tickRate;
  }

  get maxRewindMs(): number {
    return this.#maxRewindMs;
  }

  /** Ticks currently retained, oldest first. */
  get ticks(): readonly number[] {
    return this.#ordered().map((entry) => entry.tick);
  }

  get newestTick(): number | undefined {
    return this.#ordered().at(-1)?.tick;
  }

  get oldestTick(): number | undefined {
    return this.#ordered()[0]?.tick;
  }

  /** Records the world as of `tick`, evicting the oldest retained tick. */
  record(tick: number, entities: Iterable<RecordableEntity>): void {
    if (!Number.isInteger(tick)) throw new Error("A recorded tick must be a whole number.");
    const states = new Map<NetworkId, NetState>();
    for (const entity of entities) states.set(entity.id, entity.state);
    this.#ring[this.#next] = { tick, states };
    this.#next = (this.#next + 1) % this.#capacity;
    if (this.#count < this.#capacity) this.#count += 1;
  }

  clear(): void {
    this.#ring.fill(undefined);
    this.#count = 0;
    this.#next = 0;
  }

  /** The exact recorded tick, if it is still retained. */
  at(tick: number): HistoricalState | undefined {
    return this.#ordered().find((entry) => entry.tick === tick);
  }

  /**
   * The world at a fractional tick, interpolating between the two recorded
   * ticks that bracket it.
   *
   * A shot fired 1.6 ticks ago did not happen on a tick boundary, and snapping
   * it to one reintroduces up to half a tick of the error the rewind exists to
   * remove.
   */
  sample(tick: number): ReadonlyMap<NetworkId, NetState> {
    const ordered = this.#ordered();
    if (ordered.length === 0) return new Map();
    const first = ordered[0]!;
    const last = ordered.at(-1)!;
    if (tick <= first.tick) return first.states;
    if (tick >= last.tick) return last.states;
    let before = first;
    let after = last;
    for (const entry of ordered) {
      if (entry.tick <= tick) before = entry;
      else {
        after = entry;
        break;
      }
    }
    const span = after.tick - before.tick;
    if (span <= 0) return before.states;
    const t = clamp((tick - before.tick) / span, 0, 1);
    const blended = new Map<NetworkId, NetState>();
    for (const [id, state] of before.states) {
      const target = after.states.get(id);
      blended.set(id, target === undefined ? state : lerpState(state, target, t));
    }
    return blended;
  }

  /**
   * Rewinds by a client's latency, clamped by `maxRewindMs` and by how much
   * history is retained.
   */
  rewind(latencyMs: number, atTick?: number): RewindResult {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) {
      throw new Error("A rewind latency must be a finite, non-negative number of milliseconds.");
    }
    const newest = atTick ?? this.newestTick ?? 0;
    const oldest = this.oldestTick ?? newest;
    const requestedMs = latencyMs;
    let appliedMs = Math.min(requestedMs, this.#maxRewindMs);
    let clamped = appliedMs < requestedMs;

    const msPerTick = 1000 / this.#tickRate;
    let tick = newest - appliedMs / msPerTick;
    // The buffer is the second, harder limit: history that has been evicted
    // cannot be recovered, and pretending otherwise would judge the shot
    // against a world that is not the one the record says existed.
    if (tick < oldest) {
      tick = oldest;
      appliedMs = (newest - oldest) * msPerTick;
      clamped = clamped || appliedMs < requestedMs;
    }
    return { tick, clamped, appliedMs, states: this.sample(tick) };
  }

  /**
   * Rewinds to the tick a client says it was looking at.
   *
   * This is the form the server actually uses: a client stamps each input with
   * its view tick, and the difference from the newest recorded tick is the lag,
   * with no clock or round-trip estimate involved. Clamping applies exactly as
   * for {@link rewind}, so a client claiming an ancient view tick gets the
   * budgeted rewind, not a free one.
   */
  rewindToTick(viewTick: number): RewindResult {
    if (!Number.isFinite(viewTick)) throw new Error("A view tick must be a finite number.");
    const newest = this.newestTick ?? 0;
    const lagTicks = Math.max(0, newest - viewTick);
    return this.rewind((lagTicks * 1000) / this.#tickRate);
  }

  #ordered(): readonly HistoricalState[] {
    const out: HistoricalState[] = [];
    for (let index = 0; index < this.#count; index += 1) {
      const slot = (this.#next - this.#count + index + this.#capacity * 2) % this.#capacity;
      const entry = this.#ring[slot];
      if (entry !== undefined) out.push(entry);
    }
    return out;
  }
}

export interface LagCompensatorOptions extends SnapshotHistoryOptions {
  /** Reads a world position out of a replicated state. */
  readonly positionOf: (state: NetState) => readonly number[] | undefined;
  /** Default hit radius when a request does not give one. */
  readonly radius?: number;
  /**
   * Share an existing history — typically `server.history` — rather than
   * recording a second copy of every tick.
   */
  readonly history?: SnapshotHistory;
}

export interface HitRequest {
  /**
   * The server tick the shooter was looking at, as their client reported it
   * (`ServerConnection.viewTick`). Preferred over `latencyMs`: it is exact.
   */
  readonly viewTick?: number;
  /** The shooter's one-way view lag in milliseconds, when no view tick is known. */
  readonly latencyMs?: number;
  readonly origin: readonly [number, number, number];
  /** Need not be normalized. */
  readonly direction: readonly [number, number, number];
  readonly maxDistance?: number;
  readonly radius?: number;
  /** Entities the shot passes through — the shooter, their own projectiles. */
  readonly ignore?: Iterable<NetworkId>;
}

export interface HitResult {
  /** The nearest entity the ray met in the rewound world. */
  readonly hit: NetworkId | undefined;
  readonly distance: number;
  /** Fractional tick the shot was judged at. */
  readonly tick: number;
  /** True when the requested rewind was cut short. */
  readonly clamped: boolean;
  /** Where the target was when the shot was judged. */
  readonly position: readonly [number, number, number] | undefined;
}

/**
 * Records history and validates hits against it.
 *
 * The separation from {@link SnapshotHistory} is not decoration: a game with
 * its own hit shapes uses `history.rewind()` and does its own query, while a
 * game whose targets are adequately spheres uses `validateHit` and writes no
 * geometry at all.
 */
export class LagCompensator {
  readonly history: SnapshotHistory;
  readonly #positionOf: (state: NetState) => readonly number[] | undefined;
  readonly #radius: number;

  constructor(options: LagCompensatorOptions) {
    const radius = options.radius ?? 0.5;
    if (!(radius > 0)) throw new Error("A lag-compensation hit radius must be positive.");
    this.history = options.history ?? new SnapshotHistory(options);
    this.#positionOf = options.positionOf;
    this.#radius = radius;
  }

  record(tick: number, entities: Iterable<RecordableEntity>): void {
    this.history.record(tick, entities);
  }

  validateHit(request: HitRequest): HitResult {
    const radius = request.radius ?? this.#radius;
    if (!(radius > 0)) throw new Error("A lag-compensation hit radius must be positive.");
    const maxDistance = request.maxDistance ?? Number.POSITIVE_INFINITY;
    if (request.viewTick === undefined && request.latencyMs === undefined) {
      throw new Error("A hit request needs either the shooter's viewTick or a latencyMs.");
    }
    const rewound = request.viewTick !== undefined
      ? this.history.rewindToTick(request.viewTick)
      : this.history.rewind(request.latencyMs!);
    const ignore = new Set(request.ignore ?? []);
    const shot = ray(request.origin, request.direction);

    let hit: NetworkId | undefined;
    let distance = Number.POSITIVE_INFINITY;
    let position: readonly [number, number, number] | undefined;
    // Iterating in id order keeps the result identical run to run when two
    // targets are exactly the same distance away.
    for (const id of [...rewound.states.keys()].sort((a, b) => a - b)) {
      if (ignore.has(id)) continue;
      const point = this.#positionOf(rewound.states.get(id)!);
      if (point === undefined) continue;
      const centre: [number, number, number] = [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0];
      const t = rayIntersectsSphere(shot, sphere(centre, radius));
      if (t === undefined || t > maxDistance || t >= distance) continue;
      hit = id;
      distance = t;
      position = centre;
    }
    return {
      hit,
      distance: hit === undefined ? Number.POSITIVE_INFINITY : distance,
      tick: rewound.tick,
      clamped: rewound.clamped,
      position,
    };
  }
}

/** Numeric fields and numeric array members interpolate; everything else holds. */
function lerpState(from: NetState, to: NetState, t: number): NetState {
  const out: Record<string, NetValue> = { ...to };
  for (const [key, value] of Object.entries(to)) {
    const previous = from[key];
    if (typeof value === "number" && typeof previous === "number") {
      out[key] = previous + (value - previous) * t;
      continue;
    }
    if (Array.isArray(value) && Array.isArray(previous) && value.length === previous.length) {
      const start = previous as readonly NetValue[];
      // Non-numeric members hold rather than interpolating: there is no
      // meaningful midpoint between two strings, and inventing one would put a
      // value on the wire that neither side ever had.
      out[key] = value.map((component, index) => {
        const origin = start[index];
        return typeof component === "number" && typeof origin === "number"
          ? origin + (component - origin) * t
          : component;
      });
    }
  }
  return out;
}
