import { AABB, SeededRandom, Vector3, clamp } from '../core/Math';
import { COBTeamId, PlayerSession, SpawnAssignment, TransformState, cloneTransform, createTransform } from '../core/Models';

export interface VehicleSpawnNode {
  id: string;
  vehicleType: 'tank' | 'humvee' | 'helicopter' | 'fighter_jet';
  teamId: COBTeamId;
  transform: TransformState;
  respawnDelayMs: number;
}

export interface CapturePointBounds {
  id: string;
  bounds: AABB;
  owningTeamId: COBTeamId;
  captureSeconds: number;
}

export interface StaticCollisionHull {
  id: string;
  bounds: AABB;
  material: 'concrete' | 'metal' | 'terrain' | 'glass' | 'wood';
  processingCost: number;
}

export interface MapConfig {
  id: string;
  displayName: string;
  teamASpawnPoints: TransformState[];
  teamBSpawnPoints: TransformState[];
  vehicleSpawnNodes: VehicleSpawnNode[];
  capturePointBounds: CapturePointBounds[];
  staticWorldCollisionHulls: StaticCollisionHull[];
  combatRadius: number;
  lodNearDistance: number;
  lodMidDistance: number;
  lodFarDistance: number;
  gridCellSize: number;
}

export interface LODEvaluation {
  hullId: string;
  distance: number;
  tier: 0 | 1 | 2 | 3;
  processingWeight: number;
}

export class SpatialGrid {
  private readonly cells = new Map<string, StaticCollisionHull[]>();

  public constructor(private readonly cellSize: number) {}

  public rebuild(hulls: StaticCollisionHull[]): void {
    this.cells.clear();
    for (let i = 0; i < hulls.length; i++) {
      this.insert(hulls[i]);
    }
  }

  public insert(hull: StaticCollisionHull): void {
    const minX = Math.floor(hull.bounds.min.x / this.cellSize);
    const minY = Math.floor(hull.bounds.min.y / this.cellSize);
    const minZ = Math.floor(hull.bounds.min.z / this.cellSize);
    const maxX = Math.floor(hull.bounds.max.x / this.cellSize);
    const maxY = Math.floor(hull.bounds.max.y / this.cellSize);
    const maxZ = Math.floor(hull.bounds.max.z / this.cellSize);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = this.cellKey(x, y, z);
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
          }
          bucket.push(hull);
        }
      }
    }
  }

  public queryAABB(bounds: AABB): StaticCollisionHull[] {
    const visited = new Set<string>();
    const result: StaticCollisionHull[] = [];
    const minX = Math.floor(bounds.min.x / this.cellSize);
    const minY = Math.floor(bounds.min.y / this.cellSize);
    const minZ = Math.floor(bounds.min.z / this.cellSize);
    const maxX = Math.floor(bounds.max.x / this.cellSize);
    const maxY = Math.floor(bounds.max.y / this.cellSize);
    const maxZ = Math.floor(bounds.max.z / this.cellSize);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const bucket = this.cells.get(this.cellKey(x, y, z));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const hull = bucket[i];
            if (visited.has(hull.id)) continue;
            visited.add(hull.id);
            if (hull.bounds.intersects(bounds)) result.push(hull);
          }
        }
      }
    }

    return result;
  }

  public queryRadius(center: Vector3, radius: number): StaticCollisionHull[] {
    const r = Math.max(0, radius);
    const bounds = new AABB(
      new Vector3(center.x - r, center.y - r, center.z - r),
      new Vector3(center.x + r, center.y + r, center.z + r)
    );
    const candidates = this.queryAABB(bounds);
    const result: StaticCollisionHull[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const hull = candidates[i];
      if (hull.bounds.intersectsSphere(center, r)) result.push(hull);
    }
    return result;
  }

  private cellKey(x: number, y: number, z: number): string {
    return `${x}:${y}:${z}`;
  }
}

export class MapManager {
  private readonly maps = new Map<string, MapConfig>();
  private readonly rotation: string[] = [];
  private readonly grids = new Map<string, SpatialGrid>();
  private rotationCursor = 0;
  private teamASpawnCursor = 0;
  private teamBSpawnCursor = 0;

  public registerMap(config: MapConfig): void {
    this.validateMap(config);
    const normalized: MapConfig = {
      ...config,
      teamASpawnPoints: config.teamASpawnPoints.map(spawn => cloneTransform(spawn)),
      teamBSpawnPoints: config.teamBSpawnPoints.map(spawn => cloneTransform(spawn)),
      vehicleSpawnNodes: config.vehicleSpawnNodes.map(node => ({
        id: node.id,
        vehicleType: node.vehicleType,
        teamId: node.teamId,
        transform: cloneTransform(node.transform),
        respawnDelayMs: Math.max(0, node.respawnDelayMs),
      })),
      capturePointBounds: config.capturePointBounds.map(point => ({
        id: point.id,
        bounds: point.bounds.clone(),
        owningTeamId: point.owningTeamId,
        captureSeconds: Math.max(1, point.captureSeconds),
      })),
      staticWorldCollisionHulls: config.staticWorldCollisionHulls.map(hull => ({
        id: hull.id,
        bounds: hull.bounds.clone(),
        material: hull.material,
        processingCost: Math.max(1, hull.processingCost),
      })),
      combatRadius: Math.max(1, config.combatRadius),
      lodNearDistance: Math.max(1, config.lodNearDistance),
      lodMidDistance: Math.max(config.lodNearDistance + 1, config.lodMidDistance),
      lodFarDistance: Math.max(config.lodMidDistance + 1, config.lodFarDistance),
      gridCellSize: Math.max(4, config.gridCellSize),
    };

    if (!this.maps.has(normalized.id)) this.rotation.push(normalized.id);
    this.maps.set(normalized.id, normalized);
    const grid = new SpatialGrid(normalized.gridCellSize);
    grid.rebuild(normalized.staticWorldCollisionHulls);
    this.grids.set(normalized.id, grid);
  }

  public selectNextMap(seed: number): MapConfig {
    if (this.rotation.length === 0) {
      throw new Error('COB MapManager has no registered maps.');
    }

    if (this.rotationCursor <= 0) {
      const rng = new SeededRandom(seed);
      this.rotationCursor = Math.max(0, rng.chooseIndex(this.rotation.length));
    } else {
      this.rotationCursor = this.rotationCursor % this.rotation.length;
    }

    const mapId = this.rotation[this.rotationCursor];
    this.rotationCursor = (this.rotationCursor + 1) % this.rotation.length;
    const map = this.maps.get(mapId);
    if (!map) {
      throw new Error(`COB MapManager rotation referenced missing map '${mapId}'.`);
    }

    this.teamASpawnCursor = 0;
    this.teamBSpawnCursor = 0;
    return map;
  }

  public getMap(mapId: string): MapConfig | null {
    return this.maps.get(mapId) ?? null;
  }

  public allocateInitialSpawns(map: MapConfig, sessions: PlayerSession[]): SpawnAssignment[] {
    const assignments: SpawnAssignment[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const teamId = session.state.teamId === COBTeamId.TeamB ? COBTeamId.TeamB : COBTeamId.TeamA;
      const spawn = this.nextSpawnForTeam(map, teamId);
      assignments.push({
        playerId: session.id,
        teamId,
        transform: cloneTransform(spawn),
      });
    }
    return assignments;
  }

  public nextSpawnForTeam(map: MapConfig, teamId: COBTeamId): TransformState {
    if (teamId === COBTeamId.TeamB) {
      const index = this.teamBSpawnCursor % map.teamBSpawnPoints.length;
      this.teamBSpawnCursor++;
      return cloneTransform(map.teamBSpawnPoints[index]);
    }

    const index = this.teamASpawnCursor % map.teamASpawnPoints.length;
    this.teamASpawnCursor++;
    return cloneTransform(map.teamASpawnPoints[index]);
  }

  public queryCollision(mapId: string, bounds: AABB): StaticCollisionHull[] {
    const grid = this.grids.get(mapId);
    if (!grid) return [];
    return grid.queryAABB(bounds);
  }

  public getVisibleCollisionHulls(mapId: string, observer: Vector3, radius: number): StaticCollisionHull[] {
    const map = this.maps.get(mapId);
    const grid = this.grids.get(mapId);
    if (!map || !grid) return [];
    const queryRadius = clamp(radius, 1, map.combatRadius);
    return grid.queryRadius(observer, queryRadius);
  }

  public evaluateLOD(mapId: string, observer: Vector3, activeCombatRadius: number): LODEvaluation[] {
    const map = this.maps.get(mapId);
    const grid = this.grids.get(mapId);
    if (!map || !grid) return [];

    const radius = clamp(activeCombatRadius, 1, map.combatRadius);
    const hulls = grid.queryRadius(observer, radius);
    const evaluations: LODEvaluation[] = [];

    for (let i = 0; i < hulls.length; i++) {
      const hull = hulls[i];
      const distance = Math.sqrt(hull.bounds.distanceSquaredToPoint(observer));
      let tier: 0 | 1 | 2 | 3;
      let multiplier: number;

      if (distance <= map.lodNearDistance) {
        tier = 0;
        multiplier = 1;
      } else if (distance <= map.lodMidDistance) {
        tier = 1;
        multiplier = 0.55;
      } else if (distance <= map.lodFarDistance) {
        tier = 2;
        multiplier = 0.2;
      } else {
        tier = 3;
        multiplier = 0;
      }

      evaluations.push({
        hullId: hull.id,
        distance,
        tier,
        processingWeight: Math.ceil(hull.processingCost * multiplier),
      });
    }

    return evaluations;
  }

  public createSpawn(position: Vector3, yawRadians: number): TransformState {
    return createTransform(position, new Vector3(0, yawRadians, 0), new Vector3(1, 1, 1));
  }

  private validateMap(config: MapConfig): void {
    if (!config.id.trim()) throw new Error('COB map id must not be empty.');
    if (config.teamASpawnPoints.length === 0) throw new Error(`COB map '${config.id}' needs at least one Team A spawn.`);
    if (config.teamBSpawnPoints.length === 0) throw new Error(`COB map '${config.id}' needs at least one Team B spawn.`);
    if (config.gridCellSize <= 0) throw new Error(`COB map '${config.id}' gridCellSize must be positive.`);

    const ids = new Set<string>();
    for (let i = 0; i < config.staticWorldCollisionHulls.length; i++) {
      const hull = config.staticWorldCollisionHulls[i];
      if (!hull.id.trim()) throw new Error(`COB map '${config.id}' has a collision hull with an empty id.`);
      if (ids.has(hull.id)) throw new Error(`COB map '${config.id}' has duplicate collision hull '${hull.id}'.`);
      ids.add(hull.id);
    }
  }
}
