import { AABB, Vector3, clamp, lerpAngleRadians, wrapRadians } from '../core/Math';
import { COBTeamId, PlayerRuntimeState, TransformState, VehicleStatePayload, cloneTransform, createTransform } from '../core/Models';

export type VehicleType = 'tank' | 'humvee' | 'helicopter' | 'fighter_jet';
export type SeatRole = 'driver' | 'pilot' | 'gunner' | 'passenger';

export interface VehicleSeat {
  index: number;
  role: SeatRole;
  occupant: PlayerRuntimeState | null;
}

export interface VehicleInputState {
  throttle: number;
  brake: number;
  steer: number;
  pitch: number;
  roll: number;
  yaw: number;
  collective: number;
  mouseYaw: number;
  mousePitch: number;
  firePrimary: boolean;
  fireSecondary: boolean;
}

export interface VehicleWeaponEvent {
  vehicleId: string;
  seatIndex: number;
  weaponId: string;
  origin: Vector3;
  direction: Vector3;
  damage: number;
  createdAtMs: number;
  targetVehicleId: string | null;
}

export interface MissileLockSnapshot {
  state: 'searching' | 'acquiring' | 'locked' | 'cooldown';
  targetVehicleId: string | null;
  progress01: number;
}

export function createNeutralVehicleInput(): VehicleInputState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
    collective: 0,
    mouseYaw: 0,
    mousePitch: 0,
    firePrimary: false,
    fireSecondary: false,
  };
}

export abstract class BaseVehicle {
  public readonly seats: VehicleSeat[];
  public readonly transform: TransformState;
  public readonly velocity = Vector3.zero();
  public readonly angularVelocity = Vector3.zero();
  public health: number;

  protected readonly localBounds: AABB;

  public constructor(
    public readonly id: string,
    public readonly vehicleType: VehicleType,
    public readonly teamId: COBTeamId,
    spawnTransform: TransformState,
    seatRoles: SeatRole[],
    public readonly maxHealth: number,
    boundsHalfExtents: Vector3
  ) {
    this.transform = cloneTransform(spawnTransform);
    this.health = maxHealth;
    this.seats = [];
    for (let i = 0; i < seatRoles.length; i++) {
      this.seats.push({ index: i, role: seatRoles[i], occupant: null });
    }
    this.localBounds = new AABB(boundsHalfExtents.multiplyScalar(-1), boundsHalfExtents.clone());
  }

  public onInteract(player: PlayerRuntimeState): boolean {
    if (this.health <= 0) return false;
    if (this.seats.length === 0) return false;

    const driverSeat = this.seats[0];
    if (!driverSeat.occupant) {
      this.assignSeat(driverSeat, player);
      return true;
    }

    if (driverSeat.occupant.teamId !== player.teamId) {
      return false;
    }

    for (let i = 1; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (seat.occupant) continue;
      this.assignSeat(seat, player);
      return true;
    }

    return false;
  }

  public exitSeat(playerId: string): boolean {
    for (let i = 0; i < this.seats.length; i++) {
      const occupant = this.seats[i].occupant;
      if (!occupant || occupant.id !== playerId) continue;
      occupant.inputFrozen = false;
      occupant.transform.position = this.transform.position.add(new Vector3(1.5 + i * 0.3, 0, 0));
      occupant.velocity.copy(this.velocity);
      this.seats[i].occupant = null;
      return true;
    }
    return false;
  }

  public getWorldBounds(): AABB {
    const min = this.localBounds.min.add(this.transform.position);
    const max = this.localBounds.max.add(this.transform.position);
    return new AABB(min, max);
  }

  public applyDamage(rawDamage: number, hitWorldPosition: Vector3): number {
    if (this.health <= 0) return 0;
    const amount = Math.max(0, rawDamage);
    const multiplier = this.getArmorMultiplier(hitWorldPosition);
    const applied = amount * multiplier;
    this.health = Math.max(0, this.health - applied);
    if (this.health <= 0) {
      this.ejectAll();
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
    }
    return applied;
  }

  public toPayload(): VehicleStatePayload {
    const occupants: Array<string | null> = [];
    for (let i = 0; i < this.seats.length; i++) {
      occupants.push(this.seats[i].occupant?.id ?? null);
    }

    return {
      vehicleId: this.id,
      vehicleType: this.vehicleType,
      transform: cloneTransform(this.transform),
      velocity: this.velocity.clone(),
      health: this.health,
      seatOccupants: occupants,
    };
  }

  public abstract updatePhysics(input: VehicleInputState, dtSeconds: number, nowMs: number, enemyVehicles: BaseVehicle[]): VehicleWeaponEvent[];

  protected assignSeat(seat: VehicleSeat, player: PlayerRuntimeState): void {
    seat.occupant = player;
    player.inputFrozen = true;
    player.velocity.set(0, 0, 0);
    player.transform.position = this.transform.position.clone();
    player.transform.rotation = this.transform.rotation.clone();
  }

  protected syncOccupantsToVehicle(): void {
    for (let i = 0; i < this.seats.length; i++) {
      const occupant = this.seats[i].occupant;
      if (!occupant) continue;
      occupant.transform.position = this.transform.position.clone();
      occupant.transform.rotation = this.transform.rotation.clone();
      occupant.velocity.copy(this.velocity);
      occupant.lastValidAtMs = Date.now();
    }
  }

  protected ejectAll(): void {
    for (let i = 0; i < this.seats.length; i++) {
      const occupant = this.seats[i].occupant;
      if (!occupant) continue;
      occupant.inputFrozen = false;
      occupant.velocity.copy(this.velocity);
      occupant.transform.position = this.transform.position.add(new Vector3(i * 0.5, 0.5, 1.4));
      this.seats[i].occupant = null;
    }
  }

  protected forwardVector(): Vector3 {
    return new Vector3(Math.sin(this.transform.rotation.y), 0, Math.cos(this.transform.rotation.y)).normalize();
  }

  protected rightVector(): Vector3 {
    return new Vector3(Math.cos(this.transform.rotation.y), 0, -Math.sin(this.transform.rotation.y)).normalize();
  }

  protected applyGroundDrag(dtSeconds: number, linearDrag: number): void {
    const drag = clamp(1 - linearDrag * dtSeconds, 0, 1);
    this.velocity.multiplyScalarInPlace(drag);
  }

  protected getArmorMultiplier(_hitWorldPosition: Vector3): number {
    return 1;
  }
}

export class Tank extends BaseVehicle {
  public readonly turretRotation = Vector3.zero();
  private cannonNextFireAtMs = 0;
  private machineGunNextFireAtMs = 0;

  public constructor(id: string, teamId: COBTeamId, spawn: TransformState) {
    super(id, 'tank', teamId, spawn, ['driver', 'gunner', 'passenger', 'passenger'], 1200, new Vector3(2.4, 1.7, 3.4));
  }

  public updatePhysics(input: VehicleInputState, dtSeconds: number, nowMs: number, _enemyVehicles: BaseVehicle[]): VehicleWeaponEvent[] {
    const events: VehicleWeaponEvent[] = [];
    if (this.health <= 0) return events;

    const throttle = clamp(input.throttle, -1, 1);
    const steer = clamp(input.steer, -1, 1);
    const leftTrack = clamp(throttle - steer * 0.65, -1, 1);
    const rightTrack = clamp(throttle + steer * 0.65, -1, 1);
    const trackWidth = 3.2;
    const maxTrackSpeed = 9.5;
    const leftSpeed = leftTrack * maxTrackSpeed;
    const rightSpeed = rightTrack * maxTrackSpeed;
    const forwardSpeed = (leftSpeed + rightSpeed) * 0.5;
    const yawRate = (rightSpeed - leftSpeed) / trackWidth;

    this.transform.rotation.y = wrapRadians(this.transform.rotation.y + yawRate * dtSeconds);
    const forward = this.forwardVector();
    this.velocity.copy(forward.multiplyScalar(forwardSpeed));
    this.transform.position.addInPlace(this.velocity.multiplyScalar(dtSeconds));
    this.applyGroundDrag(dtSeconds, 1.6);

    const desiredTurretYaw = wrapRadians(this.turretRotation.y + input.mouseYaw * 0.018);
    const desiredTurretPitch = clamp(this.turretRotation.x + input.mousePitch * 0.012, -0.25, 0.32);
    this.turretRotation.y = lerpAngleRadians(this.turretRotation.y, desiredTurretYaw, clamp(dtSeconds * 12, 0, 1));
    this.turretRotation.x = this.turretRotation.x + (desiredTurretPitch - this.turretRotation.x) * clamp(dtSeconds * 12, 0, 1);

    const gunner = this.seats[1]?.occupant;
    const muzzleDirection = Vector3.forwardFromYawPitch(this.transform.rotation.y + this.turretRotation.y, -this.turretRotation.x);
    const muzzle = this.transform.position.add(new Vector3(0, 1.65, 0)).add(muzzleDirection.multiplyScalar(3.2));
    if (gunner && input.firePrimary && nowMs >= this.cannonNextFireAtMs) {
      this.cannonNextFireAtMs = nowMs + 3200;
      events.push({
        vehicleId: this.id,
        seatIndex: 1,
        weaponId: 'tank_120mm_cannon',
        origin: muzzle,
        direction: muzzleDirection,
        damage: 420,
        createdAtMs: nowMs,
        targetVehicleId: null,
      });
    }

    if (gunner && input.fireSecondary && nowMs >= this.machineGunNextFireAtMs) {
      this.machineGunNextFireAtMs = nowMs + 90;
      events.push({
        vehicleId: this.id,
        seatIndex: 1,
        weaponId: 'tank_coax_mg',
        origin: muzzle,
        direction: muzzleDirection,
        damage: 22,
        createdAtMs: nowMs,
        targetVehicleId: null,
      });
    }

    this.syncOccupantsToVehicle();
    return events;
  }

  protected override getArmorMultiplier(hitWorldPosition: Vector3): number {
    const localHit = hitWorldPosition.subtract(this.transform.position);
    const forward = this.forwardVector();
    const right = this.rightVector();
    const forwardDot = localHit.normalized().dot(forward);
    const rightDot = Math.abs(localHit.normalized().dot(right));
    if (localHit.y > 1.4) return 0.85;
    if (forwardDot > 0.55) return 0.35;
    if (forwardDot < -0.45) return 1.1;
    if (rightDot > 0.45) return 0.6;
    return 0.75;
  }
}

export class Humvee extends BaseVehicle {
  private roofGunYaw = 0;
  private roofGunPitch = 0;
  private roofGunNextFireAtMs = 0;

  public constructor(id: string, teamId: COBTeamId, spawn: TransformState) {
    super(id, 'humvee', teamId, spawn, ['driver', 'gunner', 'passenger', 'passenger', 'passenger'], 420, new Vector3(1.45, 1.45, 2.45));
  }

  public updatePhysics(input: VehicleInputState, dtSeconds: number, nowMs: number, _enemyVehicles: BaseVehicle[]): VehicleWeaponEvent[] {
    const events: VehicleWeaponEvent[] = [];
    if (this.health <= 0) return events;

    const throttle = clamp(input.throttle, -1, 1);
    const brake = clamp(input.brake, 0, 1);
    const steer = clamp(input.steer, -1, 1);
    const forward = this.forwardVector();
    const right = this.rightVector();
    const forwardSpeed = this.velocity.dot(forward);
    const lateralSpeed = this.velocity.dot(right);
    const acceleration = throttle * 18;
    const braking = brake * Math.sign(forwardSpeed) * -26;
    const steeringFactor = clamp(Math.abs(forwardSpeed) / 16, 0.18, 1);

    this.velocity.addInPlace(forward.multiplyScalar((acceleration + braking) * dtSeconds));
    this.velocity.addInPlace(right.multiplyScalar(-lateralSpeed * clamp(dtSeconds * 8.5, 0, 1)));
    this.velocity.clampLength(28);
    this.transform.rotation.y = wrapRadians(this.transform.rotation.y + steer * steeringFactor * dtSeconds * 1.7);
    this.transform.position.addInPlace(this.velocity.multiplyScalar(dtSeconds));
    this.applyGroundDrag(dtSeconds, 0.75 + brake * 3.5);

    this.roofGunYaw = lerpAngleRadians(this.roofGunYaw, this.roofGunYaw + input.mouseYaw * 0.02, clamp(dtSeconds * 18, 0, 1));
    this.roofGunPitch = clamp(this.roofGunPitch + input.mousePitch * 0.012, -0.45, 0.28);
    const gunner = this.seats[1]?.occupant;
    if (gunner && input.firePrimary && nowMs >= this.roofGunNextFireAtMs) {
      this.roofGunNextFireAtMs = nowMs + 75;
      const dir = Vector3.forwardFromYawPitch(this.transform.rotation.y + this.roofGunYaw, -this.roofGunPitch);
      events.push({
        vehicleId: this.id,
        seatIndex: 1,
        weaponId: 'humvee_roof_50cal',
        origin: this.transform.position.add(new Vector3(0, 2.05, 0)).add(dir.multiplyScalar(1.4)),
        direction: dir,
        damage: 34,
        createdAtMs: nowMs,
        targetVehicleId: null,
      });
    }

    this.syncOccupantsToVehicle();
    return events;
  }
}

export class Helicopter extends BaseVehicle {
  public constructor(id: string, teamId: COBTeamId, spawn: TransformState) {
    super(id, 'helicopter', teamId, spawn, ['pilot', 'gunner', 'passenger', 'passenger', 'passenger', 'passenger'], 680, new Vector3(2.2, 1.7, 5.5));
  }

  public updatePhysics(input: VehicleInputState, dtSeconds: number, _nowMs: number, _enemyVehicles: BaseVehicle[]): VehicleWeaponEvent[] {
    const events: VehicleWeaponEvent[] = [];
    if (this.health <= 0) return events;

    const collective = clamp(input.collective, -0.25, 1);
    const pitch = clamp(input.pitch, -1, 1);
    const roll = clamp(input.roll, -1, 1);
    const yaw = clamp(input.yaw, -1, 1);
    const gravity = new Vector3(0, -9.81, 0);
    const liftPower = 19.5;
    const lift = new Vector3(0, collective * liftPower, 0);
    const forward = this.forwardVector();
    const right = this.rightVector();
    const thrust = forward.multiplyScalar(-pitch * 9.5).add(right.multiplyScalar(roll * 7.5));
    const speed = this.velocity.length();
    const drag = this.velocity.multiplyScalar(-0.018 * speed);

    this.velocity.addInPlace(gravity.multiplyScalar(dtSeconds));
    this.velocity.addInPlace(lift.multiplyScalar(dtSeconds));
    this.velocity.addInPlace(thrust.multiplyScalar(dtSeconds));
    this.velocity.addInPlace(drag.multiplyScalar(dtSeconds));
    this.velocity.clampLength(58);

    this.angularVelocity.x += pitch * dtSeconds * 1.8;
    this.angularVelocity.z += -roll * dtSeconds * 1.8;
    this.angularVelocity.y += yaw * dtSeconds * 1.35;
    this.angularVelocity.multiplyScalarInPlace(clamp(1 - dtSeconds * 1.4, 0, 1));

    this.transform.rotation.x = clamp(this.transform.rotation.x + this.angularVelocity.x * dtSeconds, -0.55, 0.55);
    this.transform.rotation.z = clamp(this.transform.rotation.z + this.angularVelocity.z * dtSeconds, -0.75, 0.75);
    this.transform.rotation.y = wrapRadians(this.transform.rotation.y + this.angularVelocity.y * dtSeconds);
    this.transform.position.addInPlace(this.velocity.multiplyScalar(dtSeconds));
    if (this.transform.position.y < 0) {
      this.transform.position.y = 0;
      if (this.velocity.y < 0) this.velocity.y *= -0.18;
    }

    this.syncOccupantsToVehicle();
    return events;
  }
}

export class FighterJet extends BaseVehicle {
  private throttleAccumulator = 0.45;
  private missileLockState: MissileLockSnapshot['state'] = 'searching';
  private missileTargetId: string | null = null;
  private missileLockProgressMs = 0;
  private missileCooldownUntilMs = 0;

  public constructor(id: string, teamId: COBTeamId, spawn: TransformState) {
    super(id, 'fighter_jet', teamId, spawn, ['pilot'], 520, new Vector3(3.7, 1.1, 6.2));
  }

  public updatePhysics(input: VehicleInputState, dtSeconds: number, nowMs: number, enemyVehicles: BaseVehicle[]): VehicleWeaponEvent[] {
    const events: VehicleWeaponEvent[] = [];
    if (this.health <= 0) return events;

    this.throttleAccumulator = clamp(this.throttleAccumulator + input.throttle * dtSeconds * 0.42 - input.brake * dtSeconds * 0.55, 0.18, 1);
    const pitch = clamp(input.pitch, -1, 1);
    const roll = clamp(input.roll, -1, 1);
    const yaw = clamp(input.yaw, -1, 1);

    this.angularVelocity.x += pitch * dtSeconds * 1.25;
    this.angularVelocity.z += -roll * dtSeconds * 2.1;
    this.angularVelocity.y += yaw * dtSeconds * 0.7;
    this.angularVelocity.multiplyScalarInPlace(clamp(1 - dtSeconds * 0.9, 0, 1));

    this.transform.rotation.x = clamp(this.transform.rotation.x + this.angularVelocity.x * dtSeconds, -0.72, 0.72);
    this.transform.rotation.z = wrapRadians(this.transform.rotation.z + this.angularVelocity.z * dtSeconds);
    this.transform.rotation.y = wrapRadians(this.transform.rotation.y + this.angularVelocity.y * dtSeconds + Math.sin(this.transform.rotation.z) * dtSeconds * 0.55);

    const forward = Vector3.forwardFromYawPitch(this.transform.rotation.y, -this.transform.rotation.x);
    const speed = this.velocity.length();
    const airDensity = 1.225;
    const wingArea = 8.4;
    const liftCoefficient = clamp(0.18 + speed / 180, 0.18, 1.15);
    const liftMagnitude = 0.5 * airDensity * speed * speed * wingArea * liftCoefficient * 0.018;
    const dragMagnitude = 0.5 * airDensity * speed * speed * 0.032 * 0.015;
    const thrustMagnitude = 42 + this.throttleAccumulator * 96;

    this.velocity.addInPlace(forward.multiplyScalar(thrustMagnitude * dtSeconds));
    this.velocity.addInPlace(new Vector3(0, liftMagnitude * dtSeconds - 9.81 * dtSeconds, 0));
    if (speed > 0.01) this.velocity.addInPlace(this.velocity.normalized().multiplyScalar(-dragMagnitude * dtSeconds));
    this.velocity.clampLength(155);
    this.transform.position.addInPlace(this.velocity.multiplyScalar(dtSeconds));
    if (this.transform.position.y < 2) {
      this.transform.position.y = 2;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    const lockTarget = this.findMissileTarget(enemyVehicles, forward);
    this.updateMissileLock(lockTarget, dtSeconds, nowMs);
    if (input.fireSecondary && this.missileLockState === 'locked' && this.missileTargetId && nowMs >= this.missileCooldownUntilMs) {
      events.push({
        vehicleId: this.id,
        seatIndex: 0,
        weaponId: 'fighter_heatseeker_missile',
        origin: this.transform.position.add(forward.multiplyScalar(4.8)),
        direction: forward,
        damage: 360,
        createdAtMs: nowMs,
        targetVehicleId: this.missileTargetId,
      });
      this.missileCooldownUntilMs = nowMs + 6500;
      this.missileLockState = 'cooldown';
      this.missileLockProgressMs = 0;
      this.missileTargetId = null;
    }

    this.syncOccupantsToVehicle();
    return events;
  }

  public getMissileLockSnapshot(): MissileLockSnapshot {
    return {
      state: this.missileLockState,
      targetVehicleId: this.missileTargetId,
      progress01: clamp(this.missileLockProgressMs / 1500, 0, 1),
    };
  }

  private findMissileTarget(enemyVehicles: BaseVehicle[], forward: Vector3): BaseVehicle | null {
    let best: BaseVehicle | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < enemyVehicles.length; i++) {
      const enemy = enemyVehicles[i];
      if (enemy.teamId === this.teamId || enemy.health <= 0) continue;
      const bounds = enemy.getWorldBounds();
      const targetCenter = bounds.center();
      const toTarget = targetCenter.subtract(this.transform.position);
      const distance = toTarget.length();
      if (distance < 12 || distance > 420) continue;
      const direction = toTarget.normalized();
      const alignment = direction.dot(forward);
      if (alignment < 0.78) continue;
      const boxSize = bounds.size();
      const boxSignal = (boxSize.x + boxSize.y + boxSize.z) / Math.max(1, distance);
      const score = alignment * 100 + boxSignal * 12 - distance * 0.02;
      if (score > bestScore) {
        best = enemy;
        bestScore = score;
      }
    }
    return best;
  }

  private updateMissileLock(target: BaseVehicle | null, dtSeconds: number, nowMs: number): void {
    if (nowMs < this.missileCooldownUntilMs) {
      this.missileLockState = 'cooldown';
      this.missileTargetId = null;
      this.missileLockProgressMs = 0;
      return;
    }

    if (!target) {
      this.missileLockState = 'searching';
      this.missileTargetId = null;
      this.missileLockProgressMs = Math.max(0, this.missileLockProgressMs - dtSeconds * 900);
      return;
    }

    if (this.missileTargetId !== target.id) {
      this.missileTargetId = target.id;
      this.missileLockProgressMs = 0;
      this.missileLockState = 'acquiring';
    } else {
      this.missileLockProgressMs += dtSeconds * 1000;
      this.missileLockState = this.missileLockProgressMs >= 1500 ? 'locked' : 'acquiring';
    }
  }
}

export function createVehicleSpawnTransform(x: number, y: number, z: number, yawRadians: number): TransformState {
  return createTransform(new Vector3(x, y, z), new Vector3(0, yawRadians, 0), new Vector3(1, 1, 1));
}
