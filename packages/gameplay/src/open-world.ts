export type WorldPosition3d = readonly [number, number, number];

export interface VehicleSeat {
  readonly id: string;
  readonly role: "driver" | "passenger";
}

export interface VehicleOccupancyEvent {
  readonly type: "entered" | "exited";
  readonly actorId: number;
  readonly vehicleId: number;
  readonly seatId: string;
}

/** Authoritative seat ownership for player/NPC enter and exit flows. Animation,
 * doors and physics remain consumers of these deterministic transitions. */
export class VehicleOccupancySystem {
  readonly #vehicles = new Map<number, Map<string, number>>();
  readonly #actors = new Map<number, { vehicleId: number; seatId: string }>();
  readonly #listeners = new Set<(event: VehicleOccupancyEvent) => void>();

  register(vehicleId: number, seats: readonly VehicleSeat[]): void {
    id(vehicleId, "Vehicle");
    if (seats.length === 0 || new Set(seats.map((seat) => seat.id)).size !== seats.length) throw new Error("Vehicles need unique seats.");
    if (seats.filter((seat) => seat.role === "driver").length !== 1) throw new Error("Vehicles need exactly one driver seat.");
    this.#vehicles.set(vehicleId, new Map(seats.map((seat) => [seat.id, 0])));
  }

  unregister(vehicleId: number): readonly number[] {
    const seats = this.#vehicles.get(vehicleId);
    if (seats === undefined) return [];
    const actors = [...seats.values()].filter((actor) => actor !== 0);
    for (const actor of actors) this.#actors.delete(actor);
    this.#vehicles.delete(vehicleId);
    return actors;
  }

  enter(actorId: number, vehicleId: number, seatId?: string): boolean {
    id(actorId, "Actor");
    if (this.#actors.has(actorId)) return false;
    const seats = this.#vehicles.get(vehicleId);
    if (seats === undefined) return false;
    const selected = seatId ?? [...seats].find(([, occupant]) => occupant === 0)?.[0];
    if (selected === undefined || seats.get(selected) !== 0) return false;
    seats.set(selected, actorId);
    this.#actors.set(actorId, { vehicleId, seatId: selected });
    this.#emit({ type: "entered", actorId, vehicleId, seatId: selected });
    return true;
  }

  exit(actorId: number): boolean {
    const occupancy = this.#actors.get(actorId);
    if (occupancy === undefined) return false;
    this.#vehicles.get(occupancy.vehicleId)?.set(occupancy.seatId, 0);
    this.#actors.delete(actorId);
    this.#emit({ type: "exited", actorId, ...occupancy });
    return true;
  }

  occupancy(actorId: number): Readonly<{ vehicleId: number; seatId: string }> | undefined { return this.#actors.get(actorId); }
  occupant(vehicleId: number, seatId: string): number | undefined {
    const actor = this.#vehicles.get(vehicleId)?.get(seatId);
    return actor === 0 ? undefined : actor;
  }
  subscribe(listener: (event: VehicleOccupancyEvent) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #emit(event: VehicleOccupancyEvent): void { for (const listener of this.#listeners) listener(event); }
}

export interface TrafficSpawnPoint {
  readonly id: string;
  readonly position: WorldPosition3d;
  readonly heading: number;
  readonly routeId: string;
}
export interface TrafficAgent {
  readonly id: number;
  readonly spawnPointId: string;
  readonly routeId: string;
  readonly position: WorldPosition3d;
  readonly heading: number;
}
export interface TrafficSpawnerOptions {
  readonly maximumAgents?: number;
  readonly spawnRadius?: number;
  readonly despawnRadius?: number;
  readonly minimumPlayerDistance?: number;
  readonly respawnDelaySeconds?: number;
  readonly firstAgentId?: number;
}

/** Stable traffic population budget. The game owns vehicle creation and feeds
 * moved positions back through `setPosition`; this class owns spawn selection. */
export class TrafficSpawner {
  readonly #points: readonly TrafficSpawnPoint[];
  readonly #maximum: number;
  readonly #spawnRadius: number;
  readonly #despawnRadius: number;
  readonly #minimumDistance: number;
  readonly #delay: number;
  readonly #agents = new Map<number, TrafficAgent>();
  readonly #cooldown = new Map<string, number>();
  #nextId: number;

  constructor(points: readonly TrafficSpawnPoint[], options: TrafficSpawnerOptions = {}) {
    if (new Set(points.map((point) => point.id)).size !== points.length) throw new Error("Traffic spawn point ids must be unique.");
    this.#points = [...points].sort((a, b) => a.id.localeCompare(b.id));
    this.#maximum = integer(options.maximumAgents ?? 32, "Traffic maximum", 0);
    this.#spawnRadius = positive(options.spawnRadius ?? 180, "Traffic spawn radius");
    this.#despawnRadius = positive(options.despawnRadius ?? 240, "Traffic despawn radius");
    if (this.#despawnRadius <= this.#spawnRadius) throw new Error("Traffic despawn radius must exceed spawn radius.");
    this.#minimumDistance = nonnegative(options.minimumPlayerDistance ?? 28, "Traffic minimum player distance");
    this.#delay = nonnegative(options.respawnDelaySeconds ?? 8, "Traffic respawn delay");
    this.#nextId = integer(options.firstAgentId ?? 1, "Traffic first agent id", 1);
  }

  update(dt: number, observers: readonly WorldPosition3d[]): { readonly spawned: readonly TrafficAgent[]; readonly despawned: readonly number[] } {
    nonnegative(dt, "Traffic delta");
    for (const [point, left] of this.#cooldown) left <= dt ? this.#cooldown.delete(point) : this.#cooldown.set(point, left - dt);
    const despawned: number[] = [];
    for (const [agentId, agent] of this.#agents) if (nearestDistance(agent.position, observers) > this.#despawnRadius) {
      this.#agents.delete(agentId); this.#cooldown.set(agent.spawnPointId, this.#delay); despawned.push(agentId);
    }
    const occupied = new Set([...this.#agents.values()].map((agent) => agent.spawnPointId));
    const candidates = this.#points.filter((point) => {
      const distance = nearestDistance(point.position, observers);
      return !occupied.has(point.id) && !this.#cooldown.has(point.id) && distance >= this.#minimumDistance && distance <= this.#spawnRadius;
    }).sort((a, b) => nearestDistance(a.position, observers) - nearestDistance(b.position, observers) || a.id.localeCompare(b.id));
    const spawned: TrafficAgent[] = [];
    for (const point of candidates.slice(0, Math.max(0, this.#maximum - this.#agents.size))) {
      const agent = { id: this.#nextId++, spawnPointId: point.id, routeId: point.routeId, position: point.position, heading: point.heading };
      this.#agents.set(agent.id, agent); spawned.push(agent);
    }
    return { spawned, despawned };
  }

  setPosition(agentId: number, position: WorldPosition3d): boolean {
    const agent = this.#agents.get(agentId); if (agent === undefined) return false;
    this.#agents.set(agentId, { ...agent, position: finitePosition(position) }); return true;
  }
  agents(): readonly TrafficAgent[] { return [...this.#agents.values()].sort((a, b) => a.id - b.id); }
}

export interface CrimeReport { readonly severity: number; readonly witnessed?: boolean; readonly identified?: boolean; }
export interface WantedLevel { readonly level: number; readonly heat: number; readonly dispatchUnits: number; readonly searchRadius: number; }
export interface WantedResponseOptions { readonly thresholds?: readonly number[]; readonly decayPerSecond?: number; readonly unseenDecayMultiplier?: number; }

/** Heat accumulator and response bands for police dispatch. Reports can remain
 * unidentified, allowing witness/perception systems to gate wanted escalation. */
export class WantedResponseSystem {
  readonly #thresholds: readonly number[];
  readonly #decay: number;
  readonly #unseenMultiplier: number;
  #heat = 0;
  constructor(options: WantedResponseOptions = {}) {
    this.#thresholds = options.thresholds ?? [20, 50, 90, 140, 210];
    if (this.#thresholds.length === 0 || this.#thresholds.some((value, index) => value <= 0 || (index > 0 && value <= this.#thresholds[index - 1]!))) throw new Error("Wanted thresholds must be positive and increasing.");
    this.#decay = nonnegative(options.decayPerSecond ?? 2, "Wanted decay");
    this.#unseenMultiplier = positive(options.unseenDecayMultiplier ?? 3, "Wanted unseen decay multiplier");
  }
  report(report: CrimeReport): WantedLevel {
    const severity = nonnegative(report.severity, "Crime severity");
    if (report.witnessed !== false && report.identified !== false) this.#heat += severity;
    return this.state;
  }
  update(dt: number, visibleToResponse: boolean): WantedLevel {
    this.#heat = Math.max(0, this.#heat - nonnegative(dt, "Wanted delta") * this.#decay * (visibleToResponse ? 1 : this.#unseenMultiplier));
    return this.state;
  }
  clear(): void { this.#heat = 0; }
  get state(): WantedLevel {
    const level = this.#thresholds.filter((threshold) => this.#heat >= threshold).length;
    return { level, heat: this.#heat, dispatchUnits: level === 0 ? 0 : 1 + level * 2, searchRadius: level === 0 ? 0 : 80 + level * 70 };
  }
}

function nearestDistance(position: WorldPosition3d, observers: readonly WorldPosition3d[]): number {
  return observers.reduce((best, other) => Math.min(best, Math.hypot(position[0] - other[0], position[1] - other[1], position[2] - other[2])), Number.POSITIVE_INFINITY);
}
function finitePosition(position: WorldPosition3d): WorldPosition3d { if (position.length !== 3 || !position.every(Number.isFinite)) throw new Error("World positions need three finite coordinates."); return [...position]; }
function id(value: number, label: string): number { return integer(value, `${label} id`, 1); }
function integer(value: number, label: string, minimum: number): number { if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be an integer of at least ${minimum}.`); return value; }
function positive(value: number, label: string): number { if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive.`); return value; }
function nonnegative(value: number, label: string): number { if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must not be negative.`); return value; }
