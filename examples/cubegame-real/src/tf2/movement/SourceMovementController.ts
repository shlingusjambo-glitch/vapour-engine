import * as THREE from 'three';
import { InputManager } from '../../core/InputManager';
import { AudioManager } from '../../audio/AudioManager';
import { EventBus } from '../../core/EventBus';
import type { PlayerMovementOverrideContext } from '../../player/PlayerController';
import type { TF2ClassProfile } from '../classes/TF2ClassRegistry';

export interface TF2MovementSnapshot {
  seq: number;
  at: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  grounded: boolean;
}

export interface TF2BlastImpulse {
  origin: THREE.Vector3;
  radius: number;
  force: number;
  verticalBias?: number;
}

export class SourceMovementController {
  private readonly snapshots: TF2MovementSnapshot[] = [];
  private queuedBlasts: TF2BlastImpulse[] = [];
  private seq = 0;
  private jumpQueuedUntil = 0;
  private doubleJumpAvailable = false;
  private movementMultiplier = 1;
  private wasJumpDown = false;

  constructor(private profile: TF2ClassProfile) {}

  public setClassProfile(profile: TF2ClassProfile): void {
    this.profile = profile;
    this.doubleJumpAvailable = profile.id === 'scout';
  }

  public setMovementMultiplier(multiplier: number): void {
    this.movementMultiplier = THREE.MathUtils.clamp(multiplier, 0.25, 1.35);
  }

  public queueBlast(impulse: TF2BlastImpulse): void {
    this.queuedBlasts.push(impulse);
  }

  public tick(ctx: PlayerMovementOverrideContext): boolean {
    const dimension = ctx.world.currentDimension;
    if (!dimension.startsWith('tf2_')) return false;

    const player = ctx.player;
    const dt = Math.min(ctx.dt, 1 / 30);
    const up = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3(ctx.cameraDirection.x, 0, ctx.cameraDirection.z);
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const forwardInput = (InputManager.isActionDown('moveForward') ? 1 : 0) - (InputManager.isActionDown('moveBackward') ? 1 : 0);
    const sideInput = (InputManager.isActionDown('moveRight') ? 1 : 0) - (InputManager.isActionDown('moveLeft') ? 1 : 0);

    const now = performance.now() / 1000;
    const jumpDown = InputManager.isActionDown('jump');
    if (jumpDown && !this.wasJumpDown) this.jumpQueuedUntil = now + 0.14;
    this.wasJumpDown = jumpDown;

    let wish = new THREE.Vector3();
    if (player.grounded) {
      wish.addScaledVector(forward, forwardInput);
      wish.addScaledVector(right, sideInput);
    } else {
      // Source-like air strafing: side input and camera yaw bend velocity in air;
      // forward-only input does not add more forward acceleration.
      wish.addScaledVector(right, sideInput);
      if (sideInput === 0 && forwardInput < 0) wish.addScaledVector(forward, -0.35);
    }
    if (wish.lengthSq() > 0.0001) wish.normalize();

    const baseSpeed = 6.15 * this.profile.speedScale * this.movementMultiplier;
    const maxGroundSpeed = baseSpeed;
    const maxAirWishSpeed = 0.72 * this.profile.airControlScale;
    const groundAccel = 54;
    const airAccel = 18 * this.profile.airControlScale;
    const friction = 8.2;
    const gravity = 22;

    const horizontal = new THREE.Vector3(player.velocity.x, 0, player.velocity.z);
    if (player.grounded) {
      this.doubleJumpAvailable = this.profile.id === 'scout';
      const speed = horizontal.length();
      if (speed > 0.001) {
        const drop = speed * friction * dt;
        horizontal.multiplyScalar(Math.max(speed - drop, 0) / speed);
      }
      this.accelerate(horizontal, wish, maxGroundSpeed, groundAccel, dt);
      if (this.jumpQueuedUntil >= now) {
        player.velocity.y = this.profile.jumpPower;
        player.grounded = false;
        this.jumpQueuedUntil = 0;
        AudioManager.playStep('stone');
      }
    } else {
      player.velocity.y = Math.max(player.velocity.y - gravity * dt, -36);
      this.accelerate(horizontal, wish, maxAirWishSpeed, airAccel, dt);
      if (this.profile.id === 'scout' && this.doubleJumpAvailable && this.jumpQueuedUntil >= now) {
        player.velocity.y = this.profile.jumpPower * 0.92;
        horizontal.addScaledVector(forward, 1.15);
        this.doubleJumpAvailable = false;
        this.jumpQueuedUntil = 0;
        AudioManager.playStep('stone');
        EventBus.emit('tf2:scoutDoubleJump', { pos: player.position.clone(), vel: player.velocity.clone() });
      }
    }

    this.applyQueuedBlasts(player.position, player.velocity);

    const hSpeed = horizontal.length();
    const maxSpeed = player.grounded ? maxGroundSpeed : Math.max(maxGroundSpeed * 1.85, hSpeed);
    if (hSpeed > maxSpeed) horizontal.multiplyScalar(maxSpeed / hSpeed);
    player.velocity.x = horizontal.x;
    player.velocity.z = horizontal.z;

    const wasGrounded = player.grounded;
    const result = ctx.physics.move(player.position, player.velocity, player.dimensions, dt, false, wasGrounded);
    player.grounded = result.grounded;
    player.isSprinting = false;
    player.isCrouching = InputManager.isActionDown('crouch');

    this.storeSnapshot(player.position, player.velocity, player.grounded);
    return true;
  }

  public getPredictionHistory(): ReadonlyArray<TF2MovementSnapshot> {
    return this.snapshots;
  }

  private accelerate(velocity: THREE.Vector3, wishDir: THREE.Vector3, wishSpeed: number, accel: number, dt: number): void {
    if (wishDir.lengthSq() <= 0.0001) return;
    const currentSpeed = velocity.dot(wishDir);
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) return;
    const accelSpeed = Math.min(accel * wishSpeed * dt, addSpeed);
    velocity.addScaledVector(wishDir, accelSpeed);
  }

  private applyQueuedBlasts(position: THREE.Vector3, velocity: THREE.Vector3): void {
    if (this.queuedBlasts.length === 0) return;
    for (const blast of this.queuedBlasts.splice(0)) {
      const fromBlast = position.clone().sub(blast.origin);
      const dist = Math.max(0.35, fromBlast.length());
      if (dist > blast.radius) continue;
      const falloff = 1 - dist / blast.radius;
      const dir = fromBlast.normalize();
      dir.y = Math.max(dir.y, blast.verticalBias ?? 0.42);
      dir.normalize();
      velocity.addScaledVector(dir, blast.force * falloff);
    }
  }

  private storeSnapshot(pos: THREE.Vector3, vel: THREE.Vector3, grounded: boolean): void {
    this.snapshots.push({
      seq: ++this.seq,
      at: performance.now(),
      pos: pos.clone(),
      vel: vel.clone(),
      grounded,
    });
    if (this.snapshots.length > 32) this.snapshots.splice(0, this.snapshots.length - 32);
  }
}
