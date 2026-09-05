import * as THREE from 'three';
import { MobEntity, MobType } from './EntityTypes';
import { WorldManager } from '../world/WorldManager';
import { EventBus } from '../core/EventBus';
import { BlockRegistry } from '../world/BlockRegistry';
import { AudioManager } from '../audio/AudioManager';

const GRAVITY = 22.0;

export class MobAI {
  private world: WorldManager;

  constructor(world: WorldManager) {
    this.world = world;
  }

  public updateMob(
    mob: MobEntity,
    dt: number,
    playerPos: THREE.Vector3,
    _playerId: string,
    cameraDir?: THREE.Vector3
  ): void {
    if (mob.isDead) return;

    mob.aiTimer += dt;
    if (mob.attackCooldown > 0) mob.attackCooldown -= dt;

    const toPlayer = new THREE.Vector3().subVectors(playerPos, mob.position);
    const distToPlayer = toPlayer.length();
    const dirToPlayer = toPlayer.clone().normalize();

    // BedWars shopkeepers must never drift, wander, fall, or pathfind. They are
    // fixed interaction anchors like Hypixel-style island shop NPCs.
    if ((mob as any).staticShop) {
      mob.aiState = 'shop';
      mob.velocity.set(0, 0, 0);
      mob.grounded = true;
      if (distToPlayer < 7) {
        mob.rotation.y = Math.atan2(playerPos.x - mob.position.x, playerPos.z - mob.position.z);
      }
      return;
    }

    // ── Per-mob AI ────────────────────────────────────────────────────────
    switch (mob.mobType) {
      case 'zombie':
        this.updateZombie(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'skeleton':
        this.updateSkeleton(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'creeper':
        this.updateCreeper(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'spider':
        this.updateSpider(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'pig':
      case 'sheep':
      case 'cow':
        this.updatePassive(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'enderman':
        this.updateEnderman(mob, dt, playerPos, distToPlayer, dirToPlayer, cameraDir);
        break;
      case 'warden':
        this.updateWarden(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'dragon':
        this.updateDragon(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'villager':
        this.updateVillager(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'wither':
        this.updateWither(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'blaze':
        this.updateBlaze(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'ghast':
        this.updateGhast(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'slime':
      case 'magma_cube':
        this.updateSlimeOrMagmaCube(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'wolf':
        this.updateWolf(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'cat':
        this.updateCat(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'iron_golem':
        this.updateIronGolem(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'snow_golem':
        this.updateSnowGolem(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
      case 'bacteria':
      case 'still_life':
      case 'clark_monster':
        this.updateBackroomsEntity(mob, dt, playerPos, distToPlayer, dirToPlayer);
        break;
    }

    // ── Physics ─────────────────────────────────────────────────────────
    const isSpider = mob.mobType === 'spider';

    // Gravity (spiders can cling to walls — reduced gravity when touching wall)
    if (!mob.grounded) {
      const grav = isSpider ? GRAVITY * 0.3 : GRAVITY;
      mob.velocity.y -= grav * dt;
    }
    mob.velocity.y = Math.max(mob.velocity.y, -30);

    // Horizontal friction
    if (mob.grounded) {
      const friction = Math.max(0, 1 - 10 * dt);
      mob.velocity.x *= friction;
      mob.velocity.z *= friction;
    }

    // Obstacle avoidance — if we're moving but blocked, try to turn or jump
    if (mob.grounded && (mob.aiState === 'chase' || mob.aiState === 'wander' || mob.aiState === 'flee')) {
      this.avoidObstacles(mob, dt);
    }

    // Spider wall climbing
    if (mob.mobType === 'spider') {
      const hSpeed = Math.sqrt(mob.velocity.x ** 2 + mob.velocity.z ** 2);
      if (hSpeed > 0.1) {
        const forward = new THREE.Vector3(mob.velocity.x / hSpeed, 0, mob.velocity.z / hSpeed);
        const checkPos = mob.position.clone().add(forward.multiplyScalar(0.9));
        const blockAhead = this.world.getVoxel(Math.floor(checkPos.x), Math.floor(mob.position.y + 0.5), Math.floor(checkPos.z));
        if (BlockRegistry.get(blockAhead).isSolid) {
          mob.velocity.y = 4.0;
        }
      }
    }

    // Position integration
    const newPos = mob.position.clone().addScaledVector(mob.velocity, dt);

    // Simple collision (keep inside world bounds; step up 1 block)
    const blockBelow = this.world.getVoxel(
      Math.floor(newPos.x), Math.floor(mob.position.y - 0.05), Math.floor(newPos.z)
    );
    const blockFeetNew = this.world.getVoxel(
      Math.floor(newPos.x), Math.floor(mob.position.y + 0.01), Math.floor(newPos.z)
    );
    const blockHeadNew = this.world.getVoxel(
      Math.floor(newPos.x), Math.floor(mob.position.y + mob.dimensions.y - 0.01), Math.floor(newPos.z)
    );

    const cfgFeet = BlockRegistry.get(blockFeetNew);
    const cfgHead = BlockRegistry.get(blockHeadNew);

    if (!cfgFeet.isSolid || cfgFeet.isWater) {
      mob.position.x = newPos.x;
      mob.position.z = newPos.z;
    }

    // Vertical
    if (mob.velocity.y < 0) {
      const blockFloor = this.world.getVoxel(
        Math.floor(mob.position.x), Math.floor(newPos.y - 0.01), Math.floor(mob.position.z)
      );
      const cfgFloor = BlockRegistry.get(blockFloor);
      if (cfgFloor.isSolid && !cfgFloor.isWater) {
        mob.position.y = Math.floor(mob.position.y - 0.01) + 1;
        mob.velocity.y = 0;
        mob.grounded = true;
      } else {
        mob.position.y = newPos.y;
        mob.grounded = false;
      }
    } else {
      if (cfgHead.isSolid && !cfgHead.isWater) {
        mob.velocity.y = 0;
      } else {
        mob.position.y = newPos.y;
      }
      mob.grounded = BlockRegistry.get(blockBelow).isSolid;
    }

    // Face movement direction
    const hSpeed = Math.sqrt(mob.velocity.x * mob.velocity.x + mob.velocity.z * mob.velocity.z);
    if (hSpeed > 0.3) {
      mob.rotation.y = Math.atan2(mob.velocity.x, mob.velocity.z);
    }

    // Keep animation bobbing visual-only. Never alter physics position here;
    // doing so made every mob feel rubbery/bouncy and caused collision jitter.
  }


  private updateBackroomsEntity(mob: MobEntity, dt: number, _playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    const depth = Math.hypot(mob.position.x, mob.position.z);
    const baseSpeed = mob.mobType === 'clark_monster' ? 6.9 : mob.mobType === 'still_life' ? 6.2 : 5.75;
    const speed = baseSpeed + Math.min(2.2, depth / 260);
    const ambushRange = mob.mobType === 'clark_monster' ? 34 : 28;

    if (dist < ambushRange || mob.health < mob.maxHealth) {
      mob.aiState = dist > 9 && Math.random() < 0.015 ? 'stalk' : 'chase';
      this.moveToward(mob, dir, speed);
      if (dist < 1.65 && mob.attackCooldown <= 0) {
        mob.attackCooldown = mob.mobType === 'clark_monster' ? 0.72 : 0.9;
        EventBus.emit('mob:attack', { mobId: mob.id, damage: mob.attackDamage });
        if (Math.random() < 0.42) AudioManager.playBackroomsScream(1.8);
      } else if (dist < 10 && Math.random() < dt * 0.18) {
        AudioManager.playBackroomsScream(1.1);
      }
      return;
    }

    // Far away: stand weirdly still, then lurch. It feels less like a normal mob
    // and more like the room suddenly remembered where the player is.
    if (Math.random() < dt * 0.18) {
      mob.aiState = 'ambush';
      this.moveToward(mob, dir, speed * 1.25);
    } else {
      mob.aiState = 'stalk';
      this.wanderBehavior(mob, dt);
    }
  }

  // ── Zombie ─────────────────────────────────────────────────────────────

  private updateZombie(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    // Daylight burning
    const sky = (window as any).gameSkySystem;
    const time = sky ? sky.getTime() : 0.5;
    const isDay = time > 0.27 && time < 0.73;
    if (isDay) {
      let exposed = true;
      const startY = Math.ceil(mob.position.y + mob.dimensions.y);
      for (let y = startY; y < 176; y++) {
        if (BlockRegistry.get(this.world.getVoxel(Math.floor(mob.position.x), y, Math.floor(mob.position.z))).isSolid) {
          exposed = false;
          break;
        }
      }
      if (exposed) {
        mob.health = Math.max(0, mob.health - dt * 2.0);
        EventBus.emit('particles:spawn', mob.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 21, 1);
      }
    }
    if (dist < 18) {
      mob.aiState = 'chase';
      this.moveToward(mob, dir, 2.8);
      if (dist < 1.2 && mob.attackCooldown <= 0) {
        mob.attackCooldown = 1.2;
        EventBus.emit('mob:attack', { mobId: mob.id, damage: mob.attackDamage });
      }
    } else {
      this.wanderBehavior(mob, dt);
    }
  }

  // ── Skeleton ───────────────────────────────────────────────────────────

  private updateSkeleton(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    // Daylight burning
    const sky = (window as any).gameSkySystem;
    const time = sky ? sky.getTime() : 0.5;
    const isDay = time > 0.27 && time < 0.73;
    if (isDay) {
      let exposed = true;
      const startY = Math.ceil(mob.position.y + mob.dimensions.y);
      for (let y = startY; y < 176; y++) {
        if (BlockRegistry.get(this.world.getVoxel(Math.floor(mob.position.x), y, Math.floor(mob.position.z))).isSolid) {
          exposed = false;
          break;
        }
      }
      if (exposed) {
        mob.health = Math.max(0, mob.health - dt * 2.0);
        EventBus.emit('particles:spawn', mob.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 21, 1);
      }
    }
    if (dist < 20) {
      if (dist < 3) {
        // Too close — flee
        mob.aiState = 'flee';
        this.moveToward(mob, dir.clone().negate(), 3.5);
      } else if (dist <= 16) {
        // Strafe around player at range
        mob.aiState = 'attack_range';
        const strafeDir = new THREE.Vector3(-dir.z, 0, dir.x);
        const combined = dir.clone().multiplyScalar(0.3).add(strafeDir.multiplyScalar(0.7));
        this.moveToward(mob, combined.normalize(), 2.0);

        // Shoot arrow every 2.5s with improved aiming
        if (mob.attackCooldown <= 0) {
          mob.attackCooldown = 2.5;
          const shootPos = mob.position.clone().add(new THREE.Vector3(0, 1.5, 0));

          // Aim at center-mass (not feet)
          const aimTarget = playerPos.clone().add(new THREE.Vector3(0, 0.9, 0));

          // Velocity lead: estimate time-of-flight at arrow speed ~22 m/s
          // and partially compensate for player movement direction (0.5 factor = challenging but dodgeable)
          const pc = (window as any).gamePlayerController;
          const playerVel = pc?.velocity ? pc.velocity.clone() : new THREE.Vector3();
          const tof = dist / 22;
          aimTarget.addScaledVector(playerVel, tof * 0.5);

          let shootDir = new THREE.Vector3().subVectors(aimTarget, shootPos).normalize();

          // Parabolic arc: add upward component proportional to range
          // so the arrow follows a realistic arc and lands at the target.
          shootDir.y += dist * 0.028;
          shootDir.normalize();

          // Accuracy spread: ±3° cone at max range (16 blocks), nearly perfect at 3 blocks
          const spreadAngle = THREE.MathUtils.lerp(0, Math.PI / 60, Math.min(dist / 16, 1));
          if (spreadAngle > 0) {
            const perpA = new THREE.Vector3(-shootDir.z, 0, shootDir.x).normalize();
            const perpB = new THREE.Vector3().crossVectors(shootDir, perpA).normalize();
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * spreadAngle;
            shootDir.addScaledVector(perpA, Math.cos(theta) * r);
            shootDir.addScaledVector(perpB, Math.sin(theta) * r);
            shootDir.normalize();
          }

          EventBus.emit('mob:shootArrow', { pos: shootPos, dir: shootDir, damage: 3 });
        }
      } else {
        // Close distance to range
        mob.aiState = 'chase';
        this.moveToward(mob, dir, 3.0);
      }
    } else {
      this.wanderBehavior(mob, dt);
    }
  }

  // ── Creeper ────────────────────────────────────────────────────────────

  private updateCreeper(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    if (mob.isExploding) return;

    const em = (window as any).gameEntityManager;
    let closestCat: MobEntity | null = null;
    let minCatDist = 10.0;
    if (em && em.localMobs) {
      for (const other of em.localMobs) {
        if (other.mobType === 'cat' && (other as any).isTamed && !other.isDead) {
          const d = mob.position.distanceTo(other.position);
          if (d < minCatDist) {
            minCatDist = d;
            closestCat = other;
          }
        }
      }
    }

    if (closestCat) {
      mob.aiState = 'flee';
      mob.fuseTimer = 0;
      const fleeDir = new THREE.Vector3().subVectors(mob.position, closestCat.position).normalize();
      fleeDir.y = 0;
      this.moveToward(mob, fleeDir, 4.0);
      return;
    }

    if (dist < 16) {
      if (dist > 2.5) {
        mob.aiState = 'chase';
        mob.fuseTimer = 0;
        this.moveToward(mob, dir, 3.2);
      } else {
        // In range — start/continue fuse
        mob.aiState = 'explode';
        mob.velocity.x *= 0.2;
        mob.velocity.z *= 0.2;
        mob.fuseTimer += dt;

        if (mob.fuseTimer >= 3.0) {
          mob.isExploding = true;
          const center = mob.position.clone().add(new THREE.Vector3(0, 1, 0));
          EventBus.emit('mob:explode', { pos: center, radius: 4, damage: 10 });
        }
      }
    } else {
      mob.fuseTimer = 0;
      this.wanderBehavior(mob, dt);
    }
  }

  // ── Spider ─────────────────────────────────────────────────────────────

  private updateSpider(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    if (dist < 20) {
      mob.aiState = 'chase';
      this.moveToward(mob, dir, 3.8);

      if (dist < 4 && mob.attackCooldown <= 0) {
        // Leap attack
        mob.attackCooldown = 1.5;
        mob.velocity.y = 6;
        mob.velocity.x += dir.x * 5;
        mob.velocity.z += dir.z * 5;
      }
      if (dist < 1.5 && mob.attackCooldown <= 0) {
        mob.attackCooldown = 1.0;
        EventBus.emit('mob:attack', { mobId: mob.id, damage: mob.attackDamage });
      }
    } else {
      this.wanderBehavior(mob, dt);
    }
  }

  // ── Passive mobs (pig, sheep, cow) ─────────────────────────────────────

  private updatePassive(mob: MobEntity, dt: number, _playerPos: THREE.Vector3, _dist: number, dirToPlayer: THREE.Vector3): void {
    if (mob.health < mob.maxHealth) {
      // Flee when hurt
      mob.aiState = 'flee';
      this.moveToward(mob, dirToPlayer.clone().negate(), 4.5);
      mob.aiTimer = 0;
    } else {
      this.wanderBehavior(mob, dt);
    }
  }

  private updateVillager(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    if ((mob as any).staticShop) {
      mob.aiState = 'shop';
      mob.velocity.set(0, mob.velocity.y, 0);
      if (dist < 7) {
        mob.rotation.y = Math.atan2(playerPos.x - mob.position.x, playerPos.z - mob.position.z);
      }
      return;
    }
    const em = (window as any).gameEntityManager;
    let closestHostile: MobEntity | null = null;
    let minDist = 12.0;

    if (em && em.localMobs) {
      for (const other of em.localMobs) {
        if (other.isDead || other.id === mob.id) continue;
        if (other.mobType === 'zombie' || other.mobType === 'skeleton') {
          const d = mob.position.distanceTo(other.position);
          if (d < minDist) {
            minDist = d;
            closestHostile = other;
          }
        }
      }
    }

    if (closestHostile) {
      mob.aiState = 'flee';
      const fleeDir = new THREE.Vector3().subVectors(mob.position, closestHostile.position).normalize();
      fleeDir.y = 0;
      this.moveToward(mob, fleeDir, 3.2);

      if (Math.random() < 0.01) {
        AudioManager.playVillagerSound('hurt');
      }
    } else {
      this.wanderBehavior(mob, dt);

      if (Math.random() < 0.002) {
        AudioManager.playVillagerSound('idle');
      }
    }
  }

  // ── Enderman ───────────────────────────────────────────────────────────

  private updateEnderman(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3, cameraDir?: THREE.Vector3): void {
    // Water allergy / damage
    const headBlock = this.world.getVoxel(Math.floor(mob.position.x), Math.floor(mob.position.y + mob.dimensions.y - 0.5), Math.floor(mob.position.z));
    const feetBlock = this.world.getVoxel(Math.floor(mob.position.x), Math.floor(mob.position.y), Math.floor(mob.position.z));
    if (BlockRegistry.get(headBlock).isWater || BlockRegistry.get(feetBlock).isWater) {
      mob.health = Math.max(0, mob.health - dt * 4.0);
      const rx = (Math.random() - 0.5) * 16;
      const rz = (Math.random() - 0.5) * 16;
      const teleportPos = this.world.findGroundSpawnNear(
        new THREE.Vector3(mob.position.x + rx, mob.position.y, mob.position.z + rz), 0, 4
      );
      if (teleportPos) {
        mob.position.copy(teleportPos);
        AudioManager.playItemPickup();
      }
    }
    // Check if player is looking at enderman
    if (cameraDir && dist < 20) {
      const dot = cameraDir.dot(dir);
      if (dot > 0.95) {
        mob.isAngered = true;
      }
    }

    if (dist > 25) mob.isAngered = false;

    if (mob.isAngered) {
      mob.aiState = 'angry';
      this.moveToward(mob, dir, 4.5);

      // Teleport randomly every 3s
      if (mob.aiTimer > 3.0) {
        mob.aiTimer = 0;
        const rx = (Math.random() - 0.5) * 16;
        const rz = (Math.random() - 0.5) * 16;
        const teleportPos = this.world.findGroundSpawnNear(
          new THREE.Vector3(mob.position.x + rx, mob.position.y, mob.position.z + rz), 0, 4
        );
        if (teleportPos) {
          mob.position.copy(teleportPos);
        }
      }

      if (dist < 1.5 && mob.attackCooldown <= 0) {
        mob.attackCooldown = 2.0;
        EventBus.emit('mob:attack', { mobId: mob.id, damage: mob.attackDamage });
      }
    } else {
      this.wanderBehavior(mob, dt);
    }
  }

  // ── Warden ─────────────────────────────────────────────────────────────

  private updateWarden(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    if (dist < 20) {
      mob.aiState = 'chase';
      this.moveToward(mob, dir, 3.0);
      if (dist < 1.8 && mob.attackCooldown <= 0) {
        mob.attackCooldown = 2.0;
        EventBus.emit('mob:attack', { mobId: mob.id, damage: mob.attackDamage });
      }
    } else {
      this.wanderBehavior(mob, dt);
    }
  }

  // ── Dragon (flying) ────────────────────────────────────────────────────

  private updateDragon(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    mob.aiState = 'chase';
    const targetY = playerPos.y + 5;
    const flyDir = new THREE.Vector3(dir.x, (targetY - mob.position.y) * 0.2, dir.z).normalize();
    mob.velocity.x += flyDir.x * 12 * dt;
    mob.velocity.y += flyDir.y * 8 * dt;
    mob.velocity.z += flyDir.z * 12 * dt;

    const hSpeed = Math.sqrt(mob.velocity.x ** 2 + mob.velocity.z ** 2);
    if (hSpeed > 10) {
      mob.velocity.x = (mob.velocity.x / hSpeed) * 10;
      mob.velocity.z = (mob.velocity.z / hSpeed) * 10;
    }

    mob.rotation.x = Math.atan2(mob.velocity.y, hSpeed) * 0.5;

    if (dist < 4 && mob.attackCooldown <= 0) {
      mob.attackCooldown = 2.5;
      EventBus.emit('mob:attack', { mobId: mob.id, damage: mob.attackDamage });
    }
  }

  // ── Shared helpers ─────────────────────────────────────────────────────

  private moveToward(mob: MobEntity, dir: THREE.Vector3, speed: number): void {
    mob.velocity.x = dir.x * speed;
    mob.velocity.z = dir.z * speed;
  }

  private wanderBehavior(mob: MobEntity, dt: number): void {
    mob.aiState = 'wander';

    if (mob.aiTimer > 4.0) {
      mob.aiTimer = 0;
      // Pick random direction or stop
      if (Math.random() < 0.5) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 0.8;
        mob.targetPos = mob.position.clone().add(
          new THREE.Vector3(Math.sin(angle) * 6, 0, Math.cos(angle) * 6)
        );
        mob.velocity.x = Math.sin(angle) * speed;
        mob.velocity.z = Math.cos(angle) * speed;
      } else {
        mob.velocity.x *= 0.2;
        mob.velocity.z *= 0.2;
      }
    }

    // Slow down as we approach target
    if (mob.targetPos) {
      const d = mob.position.distanceTo(mob.targetPos);
      if (d < 1.5) {
        mob.velocity.x *= 0.3;
        mob.velocity.z *= 0.3;
        mob.targetPos = null;
      }
    }
  }

  private avoidObstacles(mob: MobEntity, dt: number): void {
    const hSpeed = Math.sqrt(mob.velocity.x ** 2 + mob.velocity.z ** 2);
    if (hSpeed < 0.5) return;

    const forward = new THREE.Vector3(mob.velocity.x / hSpeed, 0, mob.velocity.z / hSpeed);
    const checkPos = mob.position.clone().add(forward.clone().multiplyScalar(0.7));

    const blockAhead = this.world.getVoxel(
      Math.floor(checkPos.x), Math.floor(mob.position.y + 0.5), Math.floor(checkPos.z)
    );
    const cfgAhead = BlockRegistry.get(blockAhead);

    if (cfgAhead.isSolid && !cfgAhead.isWater && mob.grounded) {
      const now = performance.now();
      const lastStepJump = (mob as any).lastStepJumpAt || 0;
      // Step-hop, not trampoline-hop. The cooldown prevents mobs from bouncing
      // forever against fences, trees, cave lips, or unloaded chunk seams.
      if (now - lastStepJump > 650) {
        mob.velocity.y = 3.9;
        (mob as any).lastStepJumpAt = now;
      }
    }
  }

  // ── Wither Boss AI ──
  private updateWither(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    // Hover 5 blocks above player
    mob.velocity.y = (playerPos.y + 5.0 - mob.position.y) * 0.25;
    this.moveToward(mob, dir, 3.2);

    // Health regeneration (1 HP per second)
    mob.health = Math.min(mob.maxHealth, mob.health + dt * 1.0);

    if (mob.attackCooldown <= 0 && dist < 24) {
      mob.attackCooldown = 2.0;
      const headPos = mob.position.clone().add(new THREE.Vector3(0, 2.0, 0));
      EventBus.emit('mob:shootArrow', { pos: headPos, dir: dir.clone(), damage: 5, isWitherSkull: true });
    }
  }

  // ── Blaze AI ──
  private updateBlaze(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    // Hover 2.5 blocks above player
    mob.velocity.y = (playerPos.y + 2.5 - mob.position.y) * 0.15;
    this.moveToward(mob, dir, 2.5);

    // 3-round fireball burst every 3.5s
    if (mob.attackCooldown <= 0 && dist < 18) {
      mob.attackCooldown = 3.5;
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          if (mob.isDead) return;
          const pos = mob.position.clone().add(new THREE.Vector3(0, 0.8, 0));
          EventBus.emit('mob:shootArrow', { pos, dir: dir.clone(), damage: 3, isOnFire: true });
        }, i * 300);
      }
    }
  }

  // ── Ghast AI ──
  private updateGhast(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    // Hover high up
    mob.velocity.y = (playerPos.y + 14.0 - mob.position.y) * 0.2;

    // Try to stay 15-20 blocks away
    if (dist < 15) {
      this.moveToward(mob, dir.clone().negate(), 3.0);
    } else if (dist > 22) {
      this.moveToward(mob, dir, 3.0);
    } else {
      mob.velocity.x *= 0.3;
      mob.velocity.z *= 0.3;
    }

    if (mob.attackCooldown <= 0 && dist < 36) {
      mob.attackCooldown = 4.0;
      const pos = mob.position.clone().add(new THREE.Vector3(0, 1.5, 0));
      EventBus.emit('mob:shootArrow', { pos, dir: dir.clone(), damage: 6, isFireball: true });
      EventBus.emit('network:chat', `* Ghast screeches! *`);
    }
  }

  // ── Slime & Magma Cube AI ──
  private updateSlimeOrMagmaCube(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    if (!(mob as any).hopTimer) (mob as any).hopTimer = 0;
    (mob as any).hopTimer += dt;

    if (mob.grounded && (mob as any).hopTimer >= 1.5) {
      (mob as any).hopTimer = 0;
      mob.velocity.y = 5.5; // Hop up
      this.moveToward(mob, dir, 3.2); // Hop towards player
    }

    // Passive horizontal friction when landing
    if (mob.grounded && (mob as any).hopTimer < 0.2) {
      mob.velocity.x *= 0.2;
      mob.velocity.z *= 0.2;
    }

    if (dist < 1.5 && mob.attackCooldown <= 0) {
      mob.attackCooldown = 1.0;
      EventBus.emit('mob:attack', { mobId: mob.id, damage: mob.attackDamage });
    }
  }

  // ── Wolf AI ──
  private updateWolf(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    if ((mob as any).isTamed) {
      if ((mob as any).isSitting) {
        mob.velocity.set(0, 0, 0);
        mob.aiState = 'idle';
        return;
      }

      // Check for targets (hostile targets attacked by player or attacking player)
      const em = (window as any).gameEntityManager;
      let target: MobEntity | null = null;
      let targetDist = 16.0;
      if (em && em.localMobs) {
        for (const other of em.localMobs) {
          if (!other.isDead && other.id !== mob.id && (other.mobType === 'zombie' || other.mobType === 'skeleton' || other.mobType === 'spider' || other.mobType === 'creeper')) {
            const d = mob.position.distanceTo(other.position);
            if (d < targetDist) {
              targetDist = d;
              target = other;
            }
          }
        }
      }

      if (target) {
        mob.aiState = 'chase';
        const tDir = new THREE.Vector3().subVectors(target.position, mob.position).normalize();
        this.moveToward(mob, tDir, 4.0);
        if (targetDist < 1.5 && mob.attackCooldown <= 0) {
          mob.attackCooldown = 1.0;
          em.damageMob(target.id, 4);
        }
      } else {
        // Follow player
        if (dist > 16.0) {
          // Teleport to player
          const spawn = this.world.findGroundSpawnNear(playerPos, 1, 3);
          if (spawn) mob.position.copy(spawn);
        } else if (dist > 3.0) {
          mob.aiState = 'chase';
          this.moveToward(mob, dir, 3.5);
        } else {
          mob.velocity.x *= 0.2;
          mob.velocity.z *= 0.2;
          mob.aiState = 'idle';
        }
      }
    } else {
      // Wild wolf AI
      if (mob.isAngered) {
        mob.aiState = 'angry';
        this.moveToward(mob, dir, 3.8);
        if (dist < 1.5 && mob.attackCooldown <= 0) {
          mob.attackCooldown = 1.2;
          EventBus.emit('mob:attack', { mobId: mob.id, damage: mob.attackDamage });
        }
      } else {
        this.wanderBehavior(mob, dt);
      }
    }
  }

  // ── Cat AI ──
  private updateCat(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    if ((mob as any).isTamed) {
      if ((mob as any).isSitting) {
        mob.velocity.set(0, 0, 0);
        mob.aiState = 'idle';
        return;
      }
      // Follow player
      if (dist > 16.0) {
        const spawn = this.world.findGroundSpawnNear(playerPos, 1, 3);
        if (spawn) mob.position.copy(spawn);
      } else if (dist > 3.0) {
        mob.aiState = 'chase';
        this.moveToward(mob, dir, 3.4);
      } else {
        mob.velocity.x *= 0.2;
        mob.velocity.z *= 0.2;
        mob.aiState = 'idle';
      }
    } else {
      this.wanderBehavior(mob, dt);
    }
  }

  // ── Iron Golem AI ──
  private updateIronGolem(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    const em = (window as any).gameEntityManager;
    let target: MobEntity | null = null;
    let targetDist = 16.0;

    if (em && em.localMobs) {
      for (const other of em.localMobs) {
        if (!other.isDead && other.id !== mob.id && (other.mobType === 'zombie' || other.mobType === 'skeleton' || other.mobType === 'spider' || other.mobType === 'creeper')) {
          const d = mob.position.distanceTo(other.position);
          if (d < targetDist) {
            targetDist = d;
            target = other;
          }
        }
      }
    }

    if (target) {
      mob.aiState = 'chase';
      const tDir = new THREE.Vector3().subVectors(target.position, mob.position).normalize();
      this.moveToward(mob, tDir, 3.6);
      if (targetDist < 2.0 && mob.attackCooldown <= 0) {
        mob.attackCooldown = 1.5;
        em.damageMob(target.id, 8);
        target.velocity.y = 7.5; // Fling high up!
      }
    } else {
      this.wanderBehavior(mob, dt);
    }
  }

  // ── Snow Golem AI ──
  private updateSnowGolem(mob: MobEntity, dt: number, playerPos: THREE.Vector3, dist: number, dir: THREE.Vector3): void {
    const em = (window as any).gameEntityManager;
    let target: MobEntity | null = null;
    let targetDist = 16.0;

    if (em && em.localMobs) {
      for (const other of em.localMobs) {
        if (!other.isDead && other.id !== mob.id && (other.mobType === 'zombie' || other.mobType === 'skeleton' || other.mobType === 'spider' || other.mobType === 'creeper')) {
          const d = mob.position.distanceTo(other.position);
          if (d < targetDist) {
            targetDist = d;
            target = other;
          }
        }
      }
    }

    if (target) {
      mob.velocity.x *= 0.2;
      mob.velocity.z *= 0.2;
      mob.aiState = 'attack_range';

      if (mob.attackCooldown <= 0) {
        mob.attackCooldown = 1.5;
        const tDir = new THREE.Vector3().subVectors(target.position, mob.position).normalize();
        const pos = mob.position.clone().add(new THREE.Vector3(0, 1.2, 0));
        EventBus.emit('mob:shootArrow', { pos, dir: tDir, damage: 0, isSnowball: true });
      }
    } else {
      this.wanderBehavior(mob, dt);
    }
  }
}
