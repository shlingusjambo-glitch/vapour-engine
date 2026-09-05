import * as THREE from 'three';
import { Combatant } from '@vapour/engine';
import { BaseEntity, MobEntity, PlayerEntity, MobType } from './EntityTypes';
import { MobAI } from './MobAI';
import { WorldManager } from '../world/WorldManager';
import { EventBus } from '../core/EventBus';
import { AudioManager } from '../audio/AudioManager';
import { BlockRegistry } from '../world/BlockRegistry';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { ItemRegistry } from '../items/ItemRegistry';
import { InputManager } from '../core/InputManager';
import { createDefaultSteveSkinDataUrl } from '../player/DefaultSteveSkin';
import { isSkinDataUrl, setBoxSkin, skinPartRects } from '../player/MinecraftSkin';

// ── Interpolation Types ────────────────────────────────────────────────────
interface InterpState {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  heldItemId: number;
  receivedAt: number; // performance.now() timestamp
}

interface ArrowProjectile {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mesh: THREE.Mesh;
  damage: number;
  fromPlayer: boolean;
  age: number;
  stuck: boolean;
  isSpectral?: boolean;
  isOnFire?: boolean;
}

/** A single timestamped network snapshot for a remote player. */
interface RemotePlayerState {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  heldItemId: number;
  receivedAt: number; // performance.now() timestamp
}

type MaterialLike = THREE.Material | THREE.Material[];

interface MaterialFlashSlot {
  mesh: THREE.Mesh;
  original: MaterialLike;
  flash: MaterialLike;
}

export class EntityManager {
  private scene: THREE.Scene;
  private world: WorldManager;
  private mobAI: MobAI;

  public localMobs: MobEntity[] = [];
  public remotePlayers: Map<string, { entity: PlayerEntity; mesh: THREE.Group; interpBuffer: InterpState[] }> = new Map();
  private readonly INTERP_DELAY_MS = 185; // Render slightly behind to hide jitter on real networks.
  private readonly INTERP_BUFFER_MAX = 18;
  private remotePlayerSkins: Map<string, string> = new Map();
  public mobMeshes: Map<string, THREE.Group> = new Map();
  public mobHealthBars: Map<string, THREE.Mesh> = new Map();
  private mobOriginalMaterials: Map<string, MaterialFlashSlot[]> = new Map();
  private mobFlashTimers: Map<string, number> = new Map();
  private playerFlashTimers: Map<string, number> = new Map();
  private playerOriginalMaterials: Map<string, MaterialFlashSlot[]> = new Map();
  private remoteDeathTimers: Map<string, number> = new Map();
  private localDeathBodies: { mesh: THREE.Group; age: number; maxAge: number; targetY: number }[] = [];
  private arrows: ArrowProjectile[] = [];

  constructor(scene: THREE.Scene, world: WorldManager) {
    this.scene = scene;
    this.world = world;
    this.mobAI = new MobAI(world);

    EventBus.on('player:died', ({ position }: { position: THREE.Vector3; reason?: string }) => {
      if (position instanceof THREE.Vector3) this.spawnLocalDeathBody(position);
    });

    // Listen to player attack events
    EventBus.on('player:attack', ({ damage, range }: { damage: number; range: number }) => {
      const pc = (window as any).gamePlayerController;
      if (!pc || !pc.position) return;

      // Check mobs
      const mobs = this.getMobsNear(pc.position, range);
      let closestMob: MobEntity | null = null;
      let minMobDist = Infinity;
      for (const mob of mobs) {
        if ((mob as any).staticShop || (mob as any).shopKind || mob.aiState === 'shop') continue;
        const d = mob.position.distanceTo(pc.position);
        if (d < minMobDist) {
          minMobDist = d;
          closestMob = mob;
        }
      }

      // Check remote players. Require the target to be roughly in the
      // crosshair cone so PvP feels deliberate and does not hit friends behind
      // you just because they are mathematically closer than the mob.
      const eyePos = pc.position.clone().add(new THREE.Vector3(0, pc.eyeHeight ?? 1.62, 0));
      const cameraDir = new THREE.Vector3();
      (window as any).gameCameraController?.getDirection?.(cameraDir);
      if (cameraDir.lengthSq() < 0.001) cameraDir.set(0, 0, -1);
      cameraDir.normalize();

      let closestPlayer: any = null;
      let minPlayerDist = Infinity;
      for (const [id, rp] of this.remotePlayers) {
        const targetCenter = rp.entity.position.clone().add(new THREE.Vector3(0, 0.9, 0));
        const toTarget = targetCenter.sub(eyePos);
        const d = toTarget.length();
        if (d < 0.001 || d > range + 0.45) continue;
        const aimDot = toTarget.normalize().dot(cameraDir);
        if (aimDot < 0.42) continue;
        if (d < minPlayerDist) {
          minPlayerDist = d;
          closestPlayer = { id, rp };
        }
      }

      // Check critical hit
      const isCrit = !pc.grounded && pc.velocity.y < 0 && !pc.isSubmerged && !pc.isFlying;
      const finalDamage = isCrit ? Math.ceil(damage * 1.5) : damage;

      // Determine which one is hit (whichever is closer and within range)
      if (closestPlayer && minPlayerDist < range && minPlayerDist < minMobDist) {
        const targetId = closestPlayer.id;
        const targetMesh = closestPlayer.rp.mesh;
        
        EventBus.emit('network:sendPvpDamage', { targetUuid: targetId, damage: finalDamage });
        this.flashPlayer(targetId);

        AudioManager.playPlayerHit();
        const bloodPos = targetMesh.position.clone().add(new THREE.Vector3(0, 0.8, 0));
        EventBus.emit('particles:spawn', bloodPos, 337, 12);
        if (isCrit) {
          EventBus.emit('particles:spawn', bloodPos, 21, 12);
          EventBus.emit('network:chat', `[PVP] Critical Hit on ${closestPlayer.rp.entity.username}! Dealt ${finalDamage} damage.`);
        }
      } else if (closestMob && minMobDist < range) {
        const cameraDir = new THREE.Vector3();
        (window as any).gameCameraController?.getDirection?.(cameraDir);
        if (cameraDir.lengthSq() > 0.001) {
          const knockDir = new THREE.Vector3(cameraDir.x, 0, cameraDir.z).normalize();
          closestMob.velocity.x += knockDir.x * 5.5;
          closestMob.velocity.z += knockDir.z * 5.5;
          closestMob.velocity.y += 2.0; // pop up
        }

        const nm = (window as any).gameNetworkManager;
        if (nm && !nm.isMobAuthority) {
          EventBus.emit('network:sendMobDamage', { mobId: closestMob.id, damage: finalDamage });
          this.flashMob(closestMob.id);
        } else {
          this.damageMob(closestMob.id, finalDamage);
        }

        AudioManager.playPlayerHit();
        const bloodPos = closestMob.position.clone().add(new THREE.Vector3(0, 0.8, 0));
        if (isCrit) {
          EventBus.emit('particles:spawn', bloodPos, 21, 12);
          EventBus.emit('network:chat', `[System] Critical Hit! Dealt ${finalDamage} damage.`);
        }

        // Sword sweep attack
        const held = pc.getHeldItemId();
        if (ItemRegistry.getToolType(held) === 'sword') {
          for (const other of this.localMobs) {
            if (other.id !== closestMob.id && !other.isDead) {
              const d = other.position.distanceTo(closestMob.position);
              if (d <= 2.2) {
                this.damageMob(other.id, 2); // 1 heart sweep damage
                EventBus.emit('particles:spawn', other.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 12, 4); // sweep particles (tall grass)
              }
            }
          }
        }
      }
    });

    // Listen to explode events to handle block destruction
    EventBus.on('mob:explode', ({ pos, radius, damage }: any) => {
      EventBus.emit('particles:spawn', pos, 2, 32);
      // Destroy blocks in sphere
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (dx * dx + dy * dy + dz * dz <= radius * radius) {
              const bx = Math.floor(pos.x) + dx;
              const by = Math.floor(pos.y) + dy;
              const bz = Math.floor(pos.z) + dz;
              const bid = this.world.getVoxel(bx, by, bz);
              if (bid !== 0 && bid !== 35) { // don't destroy bedrock
                this.world.setVoxel(bx, by, bz, 0);
              }
            }
          }
        }
      }
      EventBus.emit('mob:attack', { mobId: '__creeper__', damage });
    });

    EventBus.on('mob:shootArrow', ({ pos, dir, damage }: any) => {
      this.spawnArrow(pos, dir, damage, false);
    });

    EventBus.on('player:shootArrow', ({ pos, dir, damage, isSpectral }: any) => {
      this.spawnArrow(pos, dir, damage, true, isSpectral);
    });
  }

  // ── SPAWNING ─────────────────────────────────────────────────────────────

  public spawnMob(pos: THREE.Vector3, mobType: MobType, options?: { slimeSize?: number; isTamed?: boolean; ownerId?: string; id?: string; networkRemote?: boolean; skipGroundSnap?: boolean }): string {
    const id = options?.id || Math.random().toString(36).substring(2, 9);
    if (this.localMobs.some(m => m.id === id)) return id;
    const spawnPos = options?.skipGroundSnap ? pos.clone() : (this.world.findGroundSpawnNear(pos, 0, 14) || pos);

    const mobDefs: Record<MobType, { dims: [number,number,number]; health: number; damage: number; drops: {id:number;count:number}[] }> = {
      zombie:   { dims: [0.6, 1.9, 0.6], health: 20, damage: 2, drops: [{ id: 208, count: 1 }] },
      skeleton: { dims: [0.6, 1.9, 0.6], health: 20, damage: 3, drops: [{ id: 208, count: 1 }, { id: 211, count: 2 }] },
      creeper:  { dims: [0.6, 1.7, 0.6], health: 20, damage: 10, drops: [{ id: 209, count: 1 }] },
      spider:   { dims: [1.4, 0.9, 1.4], health: 16, damage: 2, drops: [{ id: 206, count: 2 }] },
      pig:      { dims: [0.9, 0.9, 0.9], health: 10, damage: 0, drops: [{ id: 213, count: 2 }] },
      sheep:    { dims: [0.9, 1.3, 0.9], health: 8,  damage: 0, drops: [{ id: 210, count: 2 }] },
      cow:      { dims: [0.9, 1.4, 0.9], health: 10, damage: 0, drops: [{ id: 212, count: 2 }] },
      warden:   { dims: [0.9, 2.5, 0.9], health: 100, damage: 6, drops: [] },
      dragon:   { dims: [2.5, 1.8, 2.5], health: 150, damage: 8, drops: [{ id: 204, count: 5 }] },
      enderman: { dims: [0.6, 2.9, 0.6], health: 40, damage: 5, drops: [{ id: 208, count: 1 }] },
      villager: { dims: [0.6, 1.9, 0.6], health: 20, damage: 0, drops: [{ id: 281, count: 1 }] },
      wither:   { dims: [1.6, 2.0, 1.0], health: 120, damage: 8, drops: [{ id: 204, count: 3 }] },
      blaze:    { dims: [0.8, 1.8, 0.8], health: 20, damage: 4, drops: [{ id: 209, count: 1 }] },
      ghast:    { dims: [3.0, 3.0, 3.0], health: 20, damage: 6, drops: [{ id: 209, count: 2 }] },
      slime:    { dims: [1.0, 1.0, 1.0], health: 16, damage: 2, drops: [{ id: 206, count: 1 }] },
      magma_cube: { dims: [1.0, 1.0, 1.0], health: 16, damage: 3, drops: [{ id: 209, count: 1 }] },
      wolf:     { dims: [0.7, 0.9, 1.0], health: 16, damage: 3, drops: [{ id: 208, count: 1 }] },
      cat:      { dims: [0.55, 0.7, 0.9], health: 10, damage: 1, drops: [{ id: 206, count: 1 }] },
      iron_golem: { dims: [1.4, 2.7, 1.4], health: 80, damage: 7, drops: [{ id: 202, count: 3 }] },
      snow_golem: { dims: [0.7, 1.8, 0.7], health: 8, damage: 1, drops: [{ id: 208, count: 1 }] },
      bacteria: { dims: [0.55, 2.75, 0.55], health: 34, damage: 7, drops: [] },
      still_life: { dims: [0.75, 2.35, 0.75], health: 46, damage: 8, drops: [] },
      clark_monster: { dims: [0.95, 2.85, 0.95], health: 72, damage: 10, drops: [] },
    };

    const def = mobDefs[mobType];
    
    // Slime size handling
    let slimeSize = 3;
    let dims = new THREE.Vector3(...def.dims);
    let maxHealth = def.health;
    let attackDamage = def.damage;
    if (mobType === 'slime' || mobType === 'magma_cube') {
      slimeSize = options?.slimeSize ?? 3;
      dims.setScalar(0.42 * slimeSize);
      maxHealth = slimeSize * slimeSize * 2;
      attackDamage = slimeSize;
    }

    const combatant = new Combatant<string>({ maxHealth });
    const mob: MobEntity = {
      id,
      type: 'mob',
      position: spawnPos.clone(),
      velocity: new THREE.Vector3(),
      rotation: new THREE.Euler(0, Math.random() * Math.PI * 2, 0),
      dimensions: dims,
      grounded: false,
      mobType,
      combatant,
      health: maxHealth,
      maxHealth: maxHealth,
      aiState: 'idle',
      aiTimer: Math.random() * 3,
      targetPos: null,
      targetEntityId: null,
      attackCooldown: 0,
      attackDamage: attackDamage,
      isAngered: false,
      fuseTimer: 0,
      isExploding: false,
      deathTimer: -1,
      isDead: false,
      drops: def.drops,
    };
    Object.defineProperties(mob, {
      health: {
        enumerable: true,
        get: () => combatant.health,
        set: (value: number) => {
          if (value > 0 && !combatant.alive) combatant.revive(value);
          else combatant.setHealth(Math.max(0, value));
        },
      },
      maxHealth: {
        enumerable: true,
        get: () => combatant.maxHealth,
        set: (value: number) => combatant.setMaxHealth(value),
      },
      isDead: {
        enumerable: true,
        get: () => !combatant.alive,
        set: (value: boolean) => {
          if (value && combatant.alive) combatant.kill('state');
          else if (!value && !combatant.alive) combatant.revive();
        },
      },
    });

    (mob as any).slimeSize = slimeSize;
    (mob as any).isTamed = options?.isTamed ?? false;
    (mob as any).ownerId = options?.ownerId ?? null;
    (mob as any).isSitting = false;
    (mob as any).networkRemote = options?.networkRemote ?? false;
    (mob as any).lastNetworkAt = performance.now();

    const mesh = this.createMobMesh(mobType);
    mesh.position.copy(spawnPos);

    if (mobType === 'slime' || mobType === 'magma_cube') {
      mesh.scale.setScalar(0.35 * slimeSize);
    }

    this.scene.add(mesh);

    this.localMobs.push(mob);
    this.mobMeshes.set(id, mesh);
    this.createHealthBar(id, mob);
    return id;
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────

  public update(dt: number, playerPos: THREE.Vector3, playerId: string): void {
    // Tick remote player interpolation every frame
    this.tickRemotePlayerInterpolation(dt);
    this.tickLocalDeathBodies(dt);

    // Handle player flash timers
    for (const [id, flashT] of this.playerFlashTimers.entries()) {
      const nextT = flashT - dt;
      if (nextT <= 0) {
        this.restorePlayerMaterials(id);
      } else {
        this.playerFlashTimers.set(id, nextT);
      }
    }

    const cameraDir = (window as any).gameCameraController?.getDirection?.() as THREE.Vector3 | undefined;
    const time = performance.now() / 1000;

    // Update arrow projectiles
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i];
      if (!arrow.stuck) {
        arrow.velocity.y -= 9.8 * dt; // gravity
        arrow.position.addScaledVector(arrow.velocity, dt);
        arrow.mesh.position.copy(arrow.position);
        arrow.mesh.lookAt(arrow.position.clone().add(arrow.velocity));

        const bx = Math.floor(arrow.position.x);
        const by = Math.floor(arrow.position.y);
        const bz = Math.floor(arrow.position.z);
        
        // Ignite if flying through lava (block ID 37)
        if (this.world.getVoxel(bx, by, bz) === 37) {
          arrow.isOnFire = true;
        }

        if (arrow.isOnFire) {
          // Spark yellow/orange trails (Torch particles)
          EventBus.emit('particles:spawn', arrow.position, 21, 1);
        }

        const block = this.world.getVoxel(bx, by, bz);
        if (BlockRegistry.get(block).isSolid) {
          arrow.stuck = true;
          arrow.velocity.set(0, 0, 0);
          continue;
        }

        if (arrow.fromPlayer) {
          let hit = false;
          for (const mob of this.localMobs) {
            if (!mob.isDead && arrow.position.distanceTo(mob.position.clone().add(new THREE.Vector3(0, 0.8, 0))) <= 0.95) {
              const extraDmg = arrow.isOnFire ? 3 : 0;
              this.damageMob(mob.id, arrow.damage + extraDmg);
              
              if (arrow.isOnFire) {
                EventBus.emit('particles:spawn', mob.position, 21, 6);
              }

              if (arrow.isSpectral) {
                (mob as any).isGlowing = true;
                (mob as any).glowingTimer = 10.0;
                EventBus.emit('network:chat', `[System] Spectral Arrow hit! Mob is glowing.`);
              }

              AudioManager.playArrowHit();
              this.removeArrowAt(i);
              hit = true;
              break;
            }
          }
          if (hit) continue;
        } else {
          const pc = (window as any).gamePlayerController;
          if (pc && arrow.position.distanceTo(pc.position.clone().add(new THREE.Vector3(0, 0.8, 0))) <= 0.85) {
            const held = pc.getHeldItemId();
            const isBlocking = InputManager.isRightMouseDown() && ItemRegistry.getToolType(held) === 'sword';
            if (isBlocking) {
              // Arrow Bounce/Deflect!
              arrow.velocity.negate().multiplyScalar(0.4);
              arrow.velocity.y = 4.0;
              arrow.fromPlayer = true; // can damage other mobs now!
              AudioManager.playItemPickup();
              EventBus.emit('network:chat', `[System] Deflected arrow with sword block!`);
              arrow.position.addScaledVector(arrow.velocity, dt * 2.0);
            } else {
              pc.takeDamage(arrow.damage, 'mob');
              this.removeArrowAt(i);
            }
            continue;
          }
        }
      } else {
        arrow.age += dt;
        if (arrow.age > 10.0) {
          this.removeArrowAt(i);
        }
      }
    }

    for (let i = this.localMobs.length - 1; i >= 0; i--) {
      const mob = this.localMobs[i];

      // Handle death animation
      if (mob.isDead) {
        if (mob.deathTimer > 0) {
          mob.deathTimer -= dt;
          const mesh = this.mobMeshes.get(mob.id);
          if (mesh) {
            // Roll the mob onto its side
            mesh.rotation.z += (Math.PI / 2 - mesh.rotation.z) * dt * 4;
          }
          if (mob.deathTimer <= 0) {
            // Fully dead — spawn drops and remove
            for (const drop of mob.drops) {
              const dropPos = mob.position.clone().add(new THREE.Vector3(0, 0.5, 0));
              EventBus.emit('item:spawn', dropPos, drop.id, drop.count);
            }

            // Splitting slimes/magma cubes
            if (mob.mobType === 'slime' || mob.mobType === 'magma_cube') {
              const size = (mob as any).slimeSize ?? 3;
              if (size > 1) {
                const left = mob.position.clone().add(new THREE.Vector3(-0.4, 0.2, -0.4));
                const right = mob.position.clone().add(new THREE.Vector3(0.4, 0.2, 0.4));
                this.spawnMob(left, mob.mobType, { slimeSize: size - 1 });
                this.spawnMob(right, mob.mobType, { slimeSize: size - 1 });
                EventBus.emit('network:chat', `[System] Slime split into two smaller ones!`);
              }
            }

            this.removeMob(mob.id);
            this.localMobs.splice(i, 1);
          }
        }
        continue;
      }

      if ((mob as any).networkRemote && performance.now() - ((mob as any).lastNetworkAt || 0) > 5000) {
        this.removeMob(mob.id);
        this.localMobs.splice(i, 1);
        continue;
      }

      // Update creeper explosion
      if (mob.mobType === 'creeper' && mob.isExploding) {
        mob.isDead = true;
        mob.deathTimer = 0.3;
        continue;
      }

      // Run AI only on local/authoritative mobs. Remote network mobs are
      // driven by snapshots from the room authority so health/position/animations
      // do not diverge between clients.
      if (!(mob as any).networkRemote) {
        this.mobAI.updateMob(mob, dt, playerPos, playerId, cameraDir);
      }

      const mesh = this.mobMeshes.get(mob.id);
      if (mesh) {
        mesh.position.copy(mob.position);
        mesh.rotation.y = mob.rotation.y;
        if (mob.mobType === 'dragon') mesh.rotation.x = mob.rotation.x;

        // Scale and flash creeper when fusing
        // Scale and flash creeper when fusing, or glow yellow if spectral
        if (mob.mobType === 'creeper' && mob.fuseTimer > 0) {
          const pulse = 1 + Math.sin(time * 15 * (mob.fuseTimer / 3)) * 0.08;
          mesh.scale.setScalar(pulse);
          const flashPhase = Math.floor(time * 10) % 2 === 0;
          mesh.traverse(child => {
            if ((child as THREE.Mesh).isMesh) {
              const mat = (child as THREE.Mesh).material as THREE.MeshLambertMaterial;
              if (mat) {
                mat.emissive = new THREE.Color(flashPhase ? 0xffffff : 0x008800);
                mat.emissiveIntensity = 0.55;
              }
            }
          });
        } else if ((mob as any).isGlowing) {
          mesh.scale.setScalar(1);
          mesh.traverse(child => {
            if ((child as THREE.Mesh).isMesh) {
              const mat = (child as THREE.Mesh).material as THREE.MeshLambertMaterial;
              if (mat) {
                mat.emissive = new THREE.Color(0xffff00);
                mat.emissiveIntensity = 0.65;
              }
            }
          });
        } else {
          const size = (mob as any).slimeSize ?? 3;
          const s = (mob.mobType === 'slime' || mob.mobType === 'magma_cube') ? 0.35 * size : 1;
          mesh.scale.setScalar(s);
          mesh.traverse(child => {
            if ((child as THREE.Mesh).isMesh) {
              const mat = (child as THREE.Mesh).material as THREE.MeshLambertMaterial;
              if (mat && mat.emissive) {
                mat.emissive.setHex(0x000000);
                mat.emissiveIntensity = 0;
              }
            }
          });
        }

        if (mob.mobType === 'wolf') {
          const collar = mesh.getObjectByName('collar');
          if (collar) {
            collar.visible = !!(mob as any).isTamed;
          }
        }

        // Ticking glowing timer
        if ((mob as any).isGlowing) {
          (mob as any).glowingTimer -= dt;
          if ((mob as any).glowingTimer <= 0) {
            (mob as any).isGlowing = false;
          }
        }

        this.animateLimbs(mesh, mob.velocity, mob.mobType, time);
        this.updateHealthBar(mob, mesh, playerPos);
      }

      // Handle hit flash timers
      const flashT = this.mobFlashTimers.get(mob.id) || 0;
      if (flashT > 0) {
        this.mobFlashTimers.set(mob.id, flashT - dt);
        if (flashT - dt <= 0) {
          this.restoreMaterials(mob.id);
        }
      }
    }
  }

  // ── DAMAGE ────────────────────────────────────────────────────────────

  public damageMob(mobId: string, damage: number): void {
    const mob = this.localMobs.find(m => m.id === mobId);
    if (!mob || mob.isDead) return;

    const result = mob.combatant.damage({ amount: damage, kind: 'combat', source: 'player' });
    if (!result.accepted) return;
    this.flashMob(mob.id);

    if (mob.health > 0 && mob.mobType === 'villager') {
      AudioManager.playVillagerSound('hurt');
    }

    if (mob.health > 0 && mob.mobType === 'zombie') {
      const playerPos = (window as any).gamePlayerController?.position;
      if (playerPos) {
        for (const other of this.localMobs) {
          if (other.mobType === 'zombie' && !other.isDead && other.id !== mob.id) {
            if (other.position.distanceTo(mob.position) <= 15.0) {
              other.aiState = 'chase';
              other.targetPos = playerPos.clone();
            }
          }
        }
      }
    }

    if (result.killed) {
      mob.deathTimer = 0.8;

      const player = (window as any).gamePlayerController;
      if (player && typeof player.addXp === 'function') {
        let xp = 15;
        if (mob.mobType === 'creeper') xp = 25;
        else if (mob.mobType === 'skeleton') xp = 25;
        else if (mob.mobType === 'enderman') xp = 40;
        else if (mob.mobType === 'spider') xp = 20;
        player.addXp(xp);
      }
    }
  }

  public getMobNetworkStates(limit = 96): any[] {
    return this.localMobs
      .filter(mob => !(mob as any).networkRemote)
      .slice(0, limit)
      .map(mob => ({
        id: mob.id,
        mobType: mob.mobType,
        x: mob.position.x, y: mob.position.y, z: mob.position.z,
        vx: mob.velocity.x, vy: mob.velocity.y, vz: mob.velocity.z,
        yaw: mob.rotation.y,
        health: mob.health,
        maxHealth: mob.maxHealth,
        dead: mob.isDead,
        state: mob.aiState,
        slimeSize: (mob as any).slimeSize ?? 3,
        tamed: !!(mob as any).isTamed,
        sitting: !!(mob as any).isSitting,
        staticShop: !!(mob as any).staticShop,
        shopTeam: (mob as any).shopTeam || undefined,
        shopKind: (mob as any).shopKind || undefined,
        displayName: (mob as any).displayName || undefined,
      }));
  }

  public applyRemoteMobSnapshot(states: any[]): void {
    const now = performance.now();
    const seen = new Set<string>();

    for (const state of states) {
      const id = String(state?.id || '').slice(0, 64);
      const mobType = String(state?.mobType || '') as MobType;
      if (!id || !mobType) continue;

      const x = Number(state.x), y = Number(state.y), z = Number(state.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      seen.add(id);

      let mob = this.localMobs.find(m => m.id === id);
      if (!mob) {
        this.spawnMob(new THREE.Vector3(x, y, z), mobType, {
          id,
          networkRemote: true,
          skipGroundSnap: true,
          slimeSize: Number(state.slimeSize) || undefined,
          isTamed: !!state.tamed,
        });
        mob = this.localMobs.find(m => m.id === id);
      }
      if (!mob) continue;

      (mob as any).networkRemote = true;
      (mob as any).lastNetworkAt = now;
      (mob as any).slimeSize = Number(state.slimeSize) || ((mob as any).slimeSize ?? 3);
      (mob as any).isTamed = !!state.tamed;
      (mob as any).isSitting = !!state.sitting;
      if (state.staticShop || state.shopKind || state.shopTeam) {
        (mob as any).staticShop = true;
        (mob as any).shopTeam = String(state.shopTeam || (mob as any).shopTeam || 'Red');
        (mob as any).shopKind = String(state.shopKind || (mob as any).shopKind || 'itemShop');
        (mob as any).displayName = String(state.displayName || (mob as any).displayName || `${(mob as any).shopTeam} Shop`);
        mob.aiState = 'shop';
        mob.health = mob.maxHealth;
        mob.isDead = false;
      }

      mob.position.lerp(new THREE.Vector3(x, y, z), 0.65);
      mob.velocity.set(Number(state.vx) || 0, Number(state.vy) || 0, Number(state.vz) || 0);
      mob.rotation.y = Number.isFinite(Number(state.yaw)) ? Number(state.yaw) : mob.rotation.y;
      mob.health = Math.max(0, Number(state.health ?? mob.health));
      mob.maxHealth = Math.max(1, Number(state.maxHealth ?? mob.maxHealth));
      mob.aiState = String(state.state || mob.aiState) as any;
      mob.isDead = !!state.dead;
      if (mob.isDead && mob.deathTimer < 0) mob.deathTimer = 0.4;
    }

    // Remote mobs missing from snapshots for several seconds are cleaned up by
    // the update loop. Do not immediately delete here, because packet loss would
    // otherwise cause visible popping.
  }

  public getMobsNear(pos: THREE.Vector3, radius: number): MobEntity[] {
    return this.localMobs.filter(m => !m.isDead && !(m as any).staticShop && !(m as any).shopKind && m.aiState !== 'shop' && m.position.distanceTo(pos) <= radius);
  }

  private flashMob(mobId: string): void {
    if (this.mobOriginalMaterials.has(mobId)) {
      this.mobFlashTimers.set(mobId, 0.15);
      return;
    }

    const mesh = this.mobMeshes.get(mobId);
    if (!mesh) return;

    const slots = this.flashObjectMaterials(mesh, 0xff2222);
    if (slots.length === 0) return;

    this.mobOriginalMaterials.set(mobId, slots);
    this.mobFlashTimers.set(mobId, 0.15);
  }

  private restoreMaterials(mobId: string): void {
    const slots = this.mobOriginalMaterials.get(mobId);
    if (!slots) return;

    this.restoreFlashSlots(slots);
    this.mobOriginalMaterials.delete(mobId);
    this.mobFlashTimers.delete(mobId);
  }

  public flashPlayer(playerId: string): void {
    if (this.playerOriginalMaterials.has(playerId)) {
      this.playerFlashTimers.set(playerId, 0.15);
      return;
    }

    const rPlayer = this.remotePlayers.get(playerId);
    if (!rPlayer || !rPlayer.mesh) return;

    const slots = this.flashObjectMaterials(rPlayer.mesh, 0xff2222, true);
    if (slots.length === 0) return;

    this.playerOriginalMaterials.set(playerId, slots);
    this.playerFlashTimers.set(playerId, 0.15);
  }

  private restorePlayerMaterials(playerId: string): void {
    const slots = this.playerOriginalMaterials.get(playerId);
    if (!slots) return;

    this.restoreFlashSlots(slots);
    this.playerOriginalMaterials.delete(playerId);
    this.playerFlashTimers.delete(playerId);
  }

  private flashObjectMaterials(root: THREE.Object3D, color: number, skipNameTag = false): MaterialFlashSlot[] {
    const slots: MaterialFlashSlot[] = [];

    root.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (skipNameTag && mesh.name === 'nameTag') return;

      const original = mesh.material as MaterialLike;
      const flash = Array.isArray(original)
        ? original.map(() => new THREE.MeshBasicMaterial({ color }))
        : new THREE.MeshBasicMaterial({ color });

      slots.push({ mesh, original, flash });
      mesh.material = flash;
    });

    return slots;
  }

  private restoreFlashSlots(slots: MaterialFlashSlot[]): void {
    for (const slot of slots) {
      if (this.materialLikeMatches(slot.mesh.material as MaterialLike, slot.flash)) {
        slot.mesh.material = slot.original;
      }
      this.disposeMaterialLike(slot.flash);
    }
  }

  private materialLikeMatches(a: MaterialLike, b: MaterialLike): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((mat, idx) => mat === b[idx]);
    }
    return a === b;
  }

  private disposeMaterialLike(material: MaterialLike): void {
    const mats = Array.isArray(material) ? material : [material];
    for (const mat of mats) {
      mat.dispose();
    }
  }

  private removeMob(id: string): void {
    this.restoreMaterials(id);
    const mesh = this.mobMeshes.get(id);
    if (mesh) { this.scene.remove(mesh); this.disposeObject(mesh); }
    const bar = this.mobHealthBars.get(id);
    if (bar) { this.scene.remove(bar); this.disposeObject(bar); }
    this.mobMeshes.delete(id);
    this.mobHealthBars.delete(id);
    this.mobOriginalMaterials.delete(id);
    this.mobFlashTimers.delete(id);
  }

  // ── HEALTH BARS ────────────────────────────────────────────────────────

  private createHealthBar(id: string, mob: MobEntity): void {
    const geo = new THREE.PlaneGeometry(0.8, 0.08);
    const mat = new THREE.MeshBasicMaterial({ color: 0x44ff44, depthWrite: false });
    const bar = new THREE.Mesh(geo, mat);
    bar.position.copy(mob.position);
    bar.position.y += mob.dimensions.y + 0.3;
    this.scene.add(bar);
    this.mobHealthBars.set(id, bar);
  }

  private updateHealthBar(mob: MobEntity, mobMesh: THREE.Group, cameraPos: THREE.Vector3): void {
    const bar = this.mobHealthBars.get(mob.id);
    if (!bar) return;

    bar.position.copy(mob.position);
    bar.position.y += mob.dimensions.y + 0.3;
    bar.lookAt(cameraPos);

    const pct = mob.health / mob.maxHealth;
    bar.scale.x = pct;

    const mat = bar.material as THREE.MeshBasicMaterial;
    if (pct > 0.6) mat.color.setHex(0x44ff44);
    else if (pct > 0.3) mat.color.setHex(0xffaa00);
    else mat.color.setHex(0xff3333);
  }

  // ── LIMB ANIMATIONS ───────────────────────────────────────────────────

  private animateLimbs(group: THREE.Group, velocity: THREE.Vector3, type: MobType, time: number): void {
    const hSpeed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2);
    const isMoving = hSpeed > 0.1;
    const swingFreq = 10.0;
    const angle = isMoving ? Math.sin(time * swingFreq) * 0.45 : 0;

    const getObj = (name: string) => group.getObjectByName(name) as THREE.Object3D | undefined;

    if (type === 'zombie') {
      const armL = getObj('armL'), armR = getObj('armR');
      if (armL) armL.rotation.x = -Math.PI / 2 + Math.sin(time * 2.0) * 0.05;
      if (armR) armR.rotation.x = -Math.PI / 2 + Math.cos(time * 2.0) * 0.05;
      const legL = getObj('legL'), legR = getObj('legR');
      if (legL) legL.rotation.x = angle;
      if (legR) legR.rotation.x = -angle;

    } else if (type === 'skeleton') {
      const armL = getObj('armL'), armR = getObj('armR');
      if (armL) armL.rotation.x = isMoving ? angle * 0.6 : 0;
      if (armR) armR.rotation.x = isMoving ? -angle * 0.6 : 0;
      const legL = getObj('legL'), legR = getObj('legR');
      if (legL) legL.rotation.x = angle;
      if (legR) legR.rotation.x = -angle;

    } else if (type === 'creeper') {
      for (let i = 1; i <= 4; i++) {
        const leg = getObj(`leg${i}`);
        if (leg) leg.rotation.x = i % 2 === 0 ? angle : -angle;
      }

    } else if (type === 'spider') {
      for (let i = 1; i <= 8; i++) {
        const leg = getObj(`leg${i}`);
        if (leg) {
          const offset = (i - 1) * 0.4;
          leg.rotation.z = Math.sin(time * 8 + offset) * 0.3;
        }
      }

    } else if (type === 'cow' || type === 'pig' || type === 'sheep') {
      for (let i = 1; i <= 4; i++) {
        const leg = getObj(`leg${i}`);
        if (leg) leg.rotation.x = i % 2 === 0 ? angle : -angle;
      }

    } else if (type === 'bacteria' || type === 'still_life' || type === 'clark_monster') {
      const armL = getObj('armL'), armR = getObj('armR');
      const legL = getObj('legL'), legR = getObj('legR');
      const twitch = Math.sin(time * 17.0) * 0.12 + Math.sin(time * 6.7) * 0.08;
      if (armL) armL.rotation.x = -0.45 + (isMoving ? angle * 0.55 : twitch);
      if (armR) armR.rotation.x = -0.45 + (isMoving ? -angle * 0.55 : -twitch);
      if (legL) legL.rotation.x = angle * 0.75;
      if (legR) legR.rotation.x = -angle * 0.75;
      const head = getObj('head');
      if (head) head.rotation.z = twitch * 0.22;

    } else if (type === 'villager') {
      const legL = getObj('legL'), legR = getObj('legR');
      if (legL) legL.rotation.x = angle;
      if (legR) legR.rotation.x = -angle;

    } else if (type === 'enderman') {
      const armL = getObj('armL'), armR = getObj('armR');
      if (armL) armL.rotation.x = isMoving ? angle * 0.4 : Math.sin(time * 0.8) * 0.15;
      if (armR) armR.rotation.x = isMoving ? -angle * 0.4 : Math.cos(time * 0.8) * 0.15;
      const legL = getObj('legL'), legR = getObj('legR');
      if (legL) legL.rotation.x = angle;
      if (legR) legR.rotation.x = -angle;

    } else if (type === 'warden') {
      const armL = getObj('armL'), armR = getObj('armR');
      if (armL) armL.rotation.x = angle * 0.7;
      if (armR) armR.rotation.x = -angle * 0.7;
      const legL = getObj('legL'), legR = getObj('legR');
      if (legL) legL.rotation.x = angle;
      if (legR) legR.rotation.x = -angle;

    } else if (type === 'dragon') {
      const wingL = getObj('wingL'), wingR = getObj('wingR'), tail = getObj('tail');
      if (wingL) wingL.rotation.z = Math.sin(time * 8.0) * 0.4;
      if (wingR) wingR.rotation.z = -Math.sin(time * 8.0) * 0.4;
      if (tail) tail.rotation.y = Math.sin(time * 4.0) * 0.15;

    } else if (type === 'blaze') {
      for (let i = 1; i <= 8; i++) {
        const rod = getObj(`leg${i}`);
        if (rod) {
          rod.position.y = 1.0 + Math.sin(time * 5.0 + i) * 0.15;
          rod.rotation.y = time * 2.0;
        }
      }

    } else if (type === 'ghast') {
      for (let i = 1; i <= 9; i++) {
        const tentacle = getObj(`leg${i}`);
        if (tentacle) {
          tentacle.rotation.x = Math.sin(time * 3.0 + i) * 0.22;
        }
      }

    } else if (type === 'slime' || type === 'magma_cube') {
      const body = group.children[0];
      if (body) {
        if (Math.abs(velocity.y) > 0.5) {
          body.scale.set(0.85, 1.25, 0.85);
        } else {
          body.scale.set(1.0, 1.0, 1.0);
        }
      }

    } else if (type === 'wolf' || type === 'cat') {
      const sitting = (group as any).isSitting; // sit check
      for (let i = 1; i <= 4; i++) {
        const leg = getObj(`leg${i}`);
        if (leg) {
          if (sitting) {
            leg.rotation.x = -Math.PI / 3;
          } else {
            leg.rotation.x = i % 2 === 0 ? angle : -angle;
          }
        }
      }

    } else if (type === 'iron_golem') {
      const legL = getObj('legL'), legR = getObj('legR');
      if (legL) legL.rotation.x = angle * 0.7;
      if (legR) legR.rotation.x = -angle * 0.7;
      const armL = getObj('armL'), armR = getObj('armR');
      if (armL) armL.rotation.x = isMoving ? -angle * 0.7 : 0;
      if (armR) armR.rotation.x = isMoving ? angle * 0.7 : 0;
    }
  }

  private rigVerticalLimb(root: THREE.Group, name: string, hingeBias = 0.5): THREE.Object3D | null {
    const part = root.getObjectByName(name);
    if (!part || !(part instanceof THREE.Mesh) || !part.parent) return part ?? null;

    const parent = part.parent;
    const box = new THREE.Box3().setFromObject(part);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (!Number.isFinite(size.y) || size.y <= 0.001) return part;

    const originalRotation = part.rotation.clone();
    const originalPosition = part.position.clone();
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(originalPosition.x, originalPosition.y + size.y * hingeBias, originalPosition.z);
    pivot.rotation.copy(originalRotation);

    part.name = `${name}Mesh`;
    part.rotation.set(0, 0, 0);
    part.position.set(0, -size.y * hingeBias, 0);

    parent.remove(part);
    parent.add(pivot);
    pivot.add(part);
    return pivot;
  }

  private rigHorizontalLimb(root: THREE.Group, name: string, side: number): THREE.Object3D | null {
    const part = root.getObjectByName(name);
    if (!part || !(part instanceof THREE.Mesh) || !part.parent) return part ?? null;

    const parent = part.parent;
    const box = new THREE.Box3().setFromObject(part);
    const size = new THREE.Vector3();
    box.getSize(size);
    const originalRotation = part.rotation.clone();
    const originalPosition = part.position.clone();
    const pivot = new THREE.Group();
    pivot.name = name;
    const hingeX = originalPosition.x - side * size.x * 0.5;
    pivot.position.set(hingeX, originalPosition.y, originalPosition.z);
    pivot.rotation.copy(originalRotation);

    part.name = `${name}Mesh`;
    part.rotation.set(0, 0, 0);
    part.position.set(side * size.x * 0.5, 0, 0);

    parent.remove(part);
    parent.add(pivot);
    pivot.add(part);
    return pivot;
  }

  private polishMobRig(group: THREE.Group, type: MobType): void {
    // Convert simple box limbs into pivoted rigs. This is the important fix for
    // “detached” animation: limbs now rotate from their shoulder/hip instead of
    // around their own center, so arms/legs stay physically attached.
    const humanoids: MobType[] = ['zombie', 'skeleton', 'enderman', 'warden', 'iron_golem'];
    if (humanoids.includes(type)) {
      for (const name of ['armL', 'armR', 'legL', 'legR']) this.rigVerticalLimb(group, name, 0.5);
    }

    if (type === 'villager') {
      for (const name of ['legL', 'legR']) this.rigVerticalLimb(group, name, 0.5);
    }

    if (type === 'cow' || type === 'pig' || type === 'sheep' || type === 'wolf' || type === 'cat' || type === 'creeper') {
      for (let i = 1; i <= 4; i++) this.rigVerticalLimb(group, `leg${i}`, 0.5);
    }

    if (type === 'spider') {
      for (let i = 1; i <= 8; i++) {
        const side = i <= 4 ? -1 : 1;
        this.rigHorizontalLimb(group, `leg${i}`, side);
      }
    }

    if (type === 'ghast') {
      for (let i = 1; i <= 9; i++) this.rigVerticalLimb(group, `leg${i}`, 0.5);
    }

    // Slight model-wide polish: shadows, nearest-pixel vibes, and names for debug.
    group.name = `${type}_rig`;
    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if ('roughness' in mat) (mat as THREE.MeshStandardMaterial).roughness = Math.max((mat as any).roughness ?? 0.7, 0.68);
      }
    });
  }

  // ── MODEL BUILDERS ─────────────────────────────────────────────────────

  private createMobMesh(type: MobType): THREE.Group {
    const group = new THREE.Group();

    const mat = (color: number) => new THREE.MeshLambertMaterial({ color });
    const box = (w: number, h: number, d: number, color: number, name?: string, px = 0, py = 0, pz = 0, parent: THREE.Object3D = group): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
      if (name) m.name = name;
      m.position.set(px, py, pz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    if (type === 'zombie') {
      box(0.35, 0.35, 0.35, 0x4caf50, 'head', 0, 1.6, 0);
      box(0.4, 0.6, 0.2, 0x2196f3, 'torso', 0, 1.1, 0);
      const armL = box(0.12, 0.55, 0.12, 0x4caf50, 'armL', -0.26, 1.1, 0.15);
      armL.rotation.x = -Math.PI / 2;
      const armR = box(0.12, 0.55, 0.12, 0x4caf50, 'armR', 0.26, 1.1, 0.15);
      armR.rotation.x = -Math.PI / 2;
      box(0.14, 0.7, 0.14, 0x3f51b5, 'legL', -0.11, 0.45, 0);
      box(0.14, 0.7, 0.14, 0x3f51b5, 'legR', 0.11, 0.45, 0);

    } else if (type === 'skeleton') {
      const boneColor = 0xeeeedd;
      const darkBone = 0xccccbb;
      box(0.3, 0.3, 0.3, boneColor, 'head', 0, 1.7, 0);
      box(0.32, 0.48, 0.12, darkBone, 'torso', 0, 1.1, 0);
      box(0.1, 0.52, 0.1, boneColor, 'armL', -0.22, 1.1, 0);
      box(0.1, 0.52, 0.1, boneColor, 'armR', 0.22, 1.1, 0);
      box(0.1, 0.62, 0.1, boneColor, 'legL', -0.1, 0.45, 0);
      box(0.1, 0.62, 0.1, boneColor, 'legR', 0.1, 0.45, 0);
      // Bow on right arm
      const armRMesh = group.getObjectByName('armR') as THREE.Mesh;
      if (armRMesh) {
        box(0.06, 0.45, 0.06, 0x8B5E3C, undefined, 0.06, 0, 0.12, armRMesh);
      }

    } else if (type === 'creeper') {
      const green = 0x1db31d, darkGreen = 0x0d660d;
      box(0.4, 0.4, 0.4, green, 'head', 0, 1.55, 0);
      // face
      box(0.08, 0.08, 0.02, darkGreen, undefined, -0.1, 1.62, 0.21);
      box(0.08, 0.08, 0.02, darkGreen, undefined, 0.1, 1.62, 0.21);
      box(0.06, 0.15, 0.02, darkGreen, undefined, 0, 1.45, 0.21);
      box(0.4, 0.6, 0.3, green, 'body', 0, 1.0, 0);
      box(0.18, 0.4, 0.18, darkGreen, 'leg1', -0.12, 0.4, 0.08);
      box(0.18, 0.4, 0.18, darkGreen, 'leg2', 0.12, 0.4, 0.08);
      box(0.18, 0.4, 0.18, darkGreen, 'leg3', -0.12, 0.4, -0.08);
      box(0.18, 0.4, 0.18, darkGreen, 'leg4', 0.12, 0.4, -0.08);

    } else if (type === 'spider') {
      const spiderBody = 0x4a1a4a, legColor = 0x3a1030;
      box(1.0, 0.45, 0.7, spiderBody, 'body', 0, 0.5, 0);
      box(0.4, 0.4, 0.4, spiderBody, 'head', 0, 0.5, 0.5);
      // 8 red eyes
      for (let i = -1; i <= 1; i += 2) {
        box(0.08, 0.08, 0.04, 0xff0000, undefined, i * 0.12, 0.56, 0.7);
        box(0.08, 0.08, 0.04, 0xff0000, undefined, i * 0.06, 0.44, 0.7);
      }
      // 8 legs
      for (let i = 1; i <= 8; i++) {
        const side = i <= 4 ? -1 : 1;
        const idx = i <= 4 ? i : i - 4;
        const zOff = (idx - 2.5) * 0.22;
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.07), mat(legColor));
        leg.name = `leg${i}`;
        leg.position.set(side * 0.55, 0.5, zOff);
        leg.rotation.z = side * 0.5;
        group.add(leg);
      }

    } else if (type === 'pig') {
      const pink = 0xffc0cb, dark = 0xff8898;
      box(0.8, 0.65, 1.1, pink, 'body', 0, 0.75, 0);
      box(0.4, 0.38, 0.38, pink, 'head', 0, 1.1, 0.45);
      box(0.28, 0.18, 0.14, dark, 'snout', 0, 1.02, 0.67);
      // Nostrils
      box(0.05, 0.05, 0.03, 0xcc8090, undefined, -0.06, 1.03, 0.75);
      box(0.05, 0.05, 0.03, 0xcc8090, undefined, 0.06, 1.03, 0.75);
      // Ears
      box(0.1, 0.12, 0.04, dark, undefined, -0.15, 1.3, 0.42);
      box(0.1, 0.12, 0.04, dark, undefined, 0.15, 1.3, 0.42);
      box(0.16, 0.44, 0.16, dark, 'leg1', -0.25, 0.28, 0.35);
      box(0.16, 0.44, 0.16, dark, 'leg2', 0.25, 0.28, 0.35);
      box(0.16, 0.44, 0.16, dark, 'leg3', -0.25, 0.28, -0.35);
      box(0.16, 0.44, 0.16, dark, 'leg4', 0.25, 0.28, -0.35);

    } else if (type === 'sheep') {
      const wool = 0xf1f1e8, woolShade = 0xdadad2, face = 0x8c8c86, leg = 0x6f6f69, hoof = 0x2a2a28, eye = 0x111111;
      // Minecraft-like sheep: rectangular wool body, short square face, and four straight legs.
      box(0.92, 0.72, 1.12, woolShade, 'body', 0, 0.82, 0);
      box(0.84, 0.64, 1.04, wool, 'woolCore', 0, 0.86, 0);
      box(0.42, 0.42, 0.42, face, 'head', 0, 1.08, 0.60);
      box(0.48, 0.26, 0.28, wool, 'headWool', 0, 1.25, 0.46);
      box(0.20, 0.12, 0.10, face, 'muzzle', 0, 1.02, 0.84);
      box(0.035, 0.045, 0.018, eye, 'eyeL', -0.095, 1.14, 0.815);
      box(0.035, 0.045, 0.018, eye, 'eyeR', 0.095, 1.14, 0.815);
      box(0.13, 0.28, 0.13, leg, 'leg1', -0.28, 0.36, 0.34);
      box(0.13, 0.28, 0.13, leg, 'leg2', 0.28, 0.36, 0.34);
      box(0.13, 0.28, 0.13, leg, 'leg3', -0.28, 0.36, -0.34);
      box(0.13, 0.28, 0.13, leg, 'leg4', 0.28, 0.36, -0.34);
      box(0.15, 0.06, 0.15, hoof, 'hoof1', -0.28, 0.18, 0.34);
      box(0.15, 0.06, 0.15, hoof, 'hoof2', 0.28, 0.18, 0.34);
      box(0.15, 0.06, 0.15, hoof, 'hoof3', -0.28, 0.18, -0.34);
      box(0.15, 0.06, 0.15, hoof, 'hoof4', 0.28, 0.18, -0.34);

    } else if (type === 'cow') {
      const brown = 0x5d4037, pink = 0xff8a80, hornColor = 0xeeeeee;
      box(0.7, 0.6, 1.1, brown, 'body', 0, 0.8, 0);
      box(0.35, 0.35, 0.35, brown, 'head', 0, 1.1, 0.5);
      box(0.25, 0.15, 0.1, pink, 'snout', 0, 1.0, 0.7);
      box(0.06, 0.15, 0.06, hornColor, undefined, -0.15, 1.3, 0.45);
      box(0.06, 0.15, 0.06, hornColor, undefined, 0.15, 1.3, 0.45);
      box(0.16, 0.5, 0.16, brown, 'leg1', -0.25, 0.25, 0.45);
      box(0.16, 0.5, 0.16, brown, 'leg2', 0.25, 0.25, 0.45);
      box(0.16, 0.5, 0.16, brown, 'leg3', -0.25, 0.25, -0.45);
      box(0.16, 0.5, 0.16, brown, 'leg4', 0.25, 0.25, -0.45);


    } else if (type === 'bacteria') {
      const black = 0x080808, wet = 0x1c1c1c, eye = 0xf4f4d0;
      box(0.34, 0.26, 0.46, black, 'head', 0, 2.52, 0.02);
      box(0.11, 0.04, 0.04, eye, 'eyeL', -0.08, 2.55, 0.25);
      box(0.11, 0.04, 0.04, eye, 'eyeR', 0.08, 2.55, 0.25);
      box(0.12, 1.15, 0.12, wet, 'torso', 0, 1.65, 0);
      const spine = box(0.055, 1.7, 0.055, black, 'spine', 0.02, 1.35, -0.06);
      spine.rotation.z = 0.08;
      const armL = box(0.07, 1.35, 0.07, black, 'armL', -0.42, 1.58, 0);
      const armR = box(0.07, 1.35, 0.07, black, 'armR', 0.42, 1.58, 0);
      armL.rotation.z = -0.18; armR.rotation.z = 0.18;
      box(0.06, 1.35, 0.06, black, 'legL', -0.12, 0.62, 0);
      box(0.06, 1.35, 0.06, black, 'legR', 0.12, 0.62, 0);
      box(0.18, 0.035, 0.035, black, 'fingerL1', -0.56, 0.98, 0.04);
      box(0.18, 0.035, 0.035, black, 'fingerR1', 0.56, 0.98, 0.04);

    } else if (type === 'still_life') {
      const skin = 0xc7b08a, rot = 0x5d2f2f, cloth = 0x66513c, dark = 0x14100e;
      box(0.42, 0.44, 0.42, skin, 'head', 0, 2.05, 0);
      box(0.22, 0.06, 0.045, dark, 'mouth', 0, 1.93, 0.23);
      box(0.50, 0.16, 0.50, cloth, 'hat', 0, 2.32, 0);
      box(0.18, 0.24, 0.42, cloth, 'hatFront', 0, 2.40, 0.15);
      box(0.55, 0.85, 0.28, rot, 'torso', 0, 1.35, 0);
      box(0.08, 1.05, 0.08, skin, 'armL', -0.42, 1.32, 0.06);
      box(0.08, 1.05, 0.08, skin, 'armR', 0.42, 1.32, 0.06);
      box(0.12, 0.92, 0.12, cloth, 'legL', -0.16, 0.55, 0);
      box(0.12, 0.92, 0.12, cloth, 'legR', 0.16, 0.55, 0);

    } else if (type === 'clark_monster') {
      const coat = 0x1d2730, flesh = 0xb28b6a, hat = 0x0a0d12, red = 0x5a1118;
      box(0.52, 0.52, 0.52, flesh, 'head', 0, 2.45, 0);
      box(0.64, 0.16, 0.64, hat, 'captainHatBrim', 0, 2.75, 0);
      box(0.42, 0.30, 0.38, hat, 'captainHatTop', 0, 2.92, 0);
      box(0.09, 0.07, 0.04, 0xffffcc, 'eyeL', -0.13, 2.48, 0.27);
      box(0.09, 0.07, 0.04, 0xffffcc, 'eyeR', 0.13, 2.48, 0.27);
      box(0.72, 1.15, 0.36, coat, 'torso', 0, 1.60, 0);
      box(0.40, 0.14, 0.39, red, 'sash', 0, 1.82, 0.02);
      const armL = box(0.10, 1.35, 0.10, flesh, 'armL', -0.58, 1.58, 0.05);
      const armR = box(0.10, 1.35, 0.10, flesh, 'armR', 0.58, 1.58, 0.05);
      armL.rotation.z = -0.1; armR.rotation.z = 0.1;
      box(0.16, 1.12, 0.16, coat, 'legL', -0.19, 0.66, 0);
      box(0.16, 1.12, 0.16, coat, 'legR', 0.19, 0.66, 0);

    } else if (type === 'villager') {
      const robeColor = 0x805030;
      const skinColor = 0xd49a6a;
      box(0.36, 0.45, 0.36, skinColor, 'head', 0, 1.62, 0);
      box(0.1, 0.18, 0.12, skinColor, 'nose', 0, 1.55, 0.22);
      box(0.38, 0.08, 0.38, robeColor, 'hood', 0, 1.85, 0);
      box(0.42, 0.75, 0.3, robeColor, 'torso', 0, 1.05, 0);
      box(0.48, 0.18, 0.18, robeColor, 'crossedArms', 0, 1.15, 0.22);
      box(0.14, 0.55, 0.14, 0x4a2a1a, 'legL', -0.1, 0.35, 0);
      box(0.14, 0.55, 0.14, 0x4a2a1a, 'legR', 0.1, 0.35, 0);

    } else if (type === 'enderman') {
      const black = 0x111111, purpleEye = 0x8800ff;
      box(0.3, 0.3, 0.3, black, 'head', 0, 2.75, 0);
      box(0.07, 0.07, 0.07, purpleEye, undefined, -0.08, 2.78, 0.155);
      box(0.07, 0.07, 0.07, purpleEye, undefined, 0.08, 2.78, 0.155);
      box(0.35, 1.0, 0.2, black, 'torso', 0, 1.9, 0);
      box(0.14, 1.4, 0.14, black, 'armL', -0.3, 1.6, 0);
      box(0.14, 1.4, 0.14, black, 'armR', 0.3, 1.6, 0);
      box(0.14, 1.3, 0.14, black, 'legL', -0.1, 0.65, 0);
      box(0.14, 1.3, 0.14, black, 'legR', 0.1, 0.65, 0);

    } else if (type === 'warden') {
      const bodyMat = mat(0x0f1e25), hornMat = mat(0x00ced1), sculkMat = mat(0x008080);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.48), bodyMat);
      head.name = 'head'; head.position.y = 2.1; head.castShadow = true; group.add(head);
      const hornL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.08), hornMat);
      hornL.position.set(-0.2, 0.3, 0); hornL.rotation.z = 0.2; head.add(hornL);
      const hornR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.08), hornMat);
      hornR.position.set(0.2, 0.3, 0); hornR.rotation.z = -0.2; head.add(hornR);
      box(0.7, 0.9, 0.4, 0x008080, 'torso', 0, 1.35, 0);
      box(0.2, 0.85, 0.2, 0x0f1e25, 'armL', -0.45, 1.35, 0);
      box(0.2, 0.85, 0.2, 0x0f1e25, 'armR', 0.45, 1.35, 0);
      box(0.24, 0.65, 0.24, 0x0f1e25, 'legL', -0.2, 0.325, 0);
      box(0.24, 0.65, 0.24, 0x0f1e25, 'legR', 0.2, 0.325, 0);

    } else if (type === 'dragon') {
      const blackMat = mat(0x111111), purpleMat = mat(0xa020f0);
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 1.5), blackMat);
      body.position.y = 0.9; body.castShadow = true; group.add(body);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.8), blackMat);
      neck.position.set(0, 0.4, 0.85); body.add(neck);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), blackMat);
      head.position.set(0, 0.25, 0.5); neck.add(head);
      const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), purpleMat);
      eyeL.position.set(-0.16, 0.1, 0.18); head.add(eyeL);
      const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), purpleMat);
      eyeR.position.set(0.16, 0.1, 0.18); head.add(eyeR);
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.9), blackMat);
      wingL.name = 'wingL'; wingL.position.set(-1.1, 0.2, 0); body.add(wingL);
      const wingR = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.9), blackMat);
      wingR.name = 'wingR'; wingR.position.set(1.1, 0.2, 0); body.add(wingR);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.1), blackMat);
      tail.name = 'tail'; tail.position.set(0, 0, -1.1); body.add(tail);
    } else if (type === 'wither') {
      const black = mat(0x1a1a1a), grey = mat(0x555555);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), grey);
      head.name = 'head'; head.position.set(0, 1.8, 0); head.castShadow = true; group.add(head);
      const headL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), black);
      headL.position.set(-0.35, 1.75, 0.05); group.add(headL);
      const headR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), black);
      headR.position.set(0.35, 1.75, 0.05); group.add(headR);
      box(0.5, 0.75, 0.16, 0x1a1a1a, 'torso', 0, 1.15, 0);
      box(0.12, 0.65, 0.12, 0x333333, 'tail', 0, 0.45, 0);

    } else if (type === 'blaze') {
      const blazeMat = mat(0xffcc00);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), blazeMat);
      head.name = 'head'; head.position.set(0, 1.4, 0); group.add(head);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const rod = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), mat(0xd87d0d));
        rod.name = `leg${i + 1}`;
        rod.position.set(Math.cos(angle) * 0.48, 1.0, Math.sin(angle) * 0.48);
        group.add(rod);
      }

    } else if (type === 'ghast') {
      const white = mat(0xeeeeee), red = mat(0xff3333);
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), white);
      body.name = 'body'; body.position.y = 1.2; body.castShadow = true; group.add(body);
      const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.04), red);
      eyeL.position.set(-0.3, 0.2, 0.61); body.add(eyeL);
      const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.04), red);
      eyeR.position.set(0.3, 0.2, 0.61); body.add(eyeR);
      for (let i = 0; i < 9; i++) {
        const tx = ((i % 3) - 1) * 0.35;
        const tz = (Math.floor(i / 3) - 1) * 0.35;
        const tentacle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.65, 0.08), mat(0xdddddd));
        tentacle.name = `leg${i + 1}`;
        tentacle.position.set(tx, -0.9, tz);
        body.add(tentacle);
      }

    } else if (type === 'slime') {
      const outerMat = new THREE.MeshLambertMaterial({ color: 0x48f048, transparent: true, opacity: 0.62 });
      const innerMat = new THREE.MeshLambertMaterial({ color: 0x14a014 });
      const outer = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), outerMat);
      outer.position.y = 0.4; outer.castShadow = true; group.add(outer);
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), innerMat);
      inner.position.y = 0.4; outer.add(inner);

    } else if (type === 'magma_cube') {
      const outerMat = mat(0x333333), innerMat = mat(0xff4500);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), outerMat);
      body.position.y = 0.4; body.castShadow = true; group.add(body);
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.48), innerMat);
      core.position.y = 0.4; body.add(core);

    } else if (type === 'wolf') {
      box(0.3, 0.3, 0.35, 0xbfbfbf, 'head', 0, 0.68, 0.3);
      box(0.14, 0.14, 0.18, 0x999999, 'snout', 0, 0.58, 0.52);
      box(0.38, 0.38, 0.65, 0xbfbfbf, 'body', 0, 0.48, 0);
      box(0.42, 0.08, 0.42, 0xd32f2f, 'collar', 0, 0.6, 0.15);
      box(0.12, 0.36, 0.12, 0x999999, 'leg1', -0.12, 0.18, 0.22);
      box(0.12, 0.36, 0.12, 0x999999, 'leg2', 0.12, 0.18, 0.22);
      box(0.12, 0.36, 0.12, 0x999999, 'leg3', -0.12, 0.18, -0.22);
      box(0.12, 0.36, 0.12, 0x999999, 'leg4', 0.12, 0.18, -0.22);

    } else if (type === 'cat') {
      box(0.24, 0.22, 0.22, 0xe5a65d, 'head', 0, 0.42, 0.22);
      box(0.24, 0.22, 0.48, 0xd38a37, 'body', 0, 0.3, 0);
      box(0.08, 0.22, 0.08, 0xd38a37, 'leg1', -0.08, 0.11, 0.16);
      box(0.08, 0.22, 0.08, 0xd38a37, 'leg2', 0.08, 0.11, 0.16);
      box(0.08, 0.22, 0.08, 0xd38a37, 'leg3', -0.08, 0.11, -0.16);
      box(0.08, 0.22, 0.08, 0xd38a37, 'leg4', 0.08, 0.11, -0.16);

    } else if (type === 'iron_golem') {
      box(0.4, 0.5, 0.4, 0xcccccc, 'head', 0, 2.3, 0);
      box(0.1, 0.2, 0.1, 0xc0a080, 'nose', 0, 2.22, 0.24);
      box(0.9, 1.1, 0.5, 0xdcdcdc, 'body', 0, 1.5, 0);
      box(0.25, 1.3, 0.25, 0xb0b0b0, 'armL', -0.58, 1.3, 0);
      box(0.25, 1.3, 0.25, 0xb0b0b0, 'armR', 0.58, 1.3, 0);
      box(0.28, 0.85, 0.28, 0x999999, 'legL', -0.22, 0.425, 0);
      box(0.28, 0.85, 0.28, 0x999999, 'legR', 0.22, 0.425, 0);

    } else if (type === 'snow_golem') {
      box(0.7, 0.7, 0.7, 0xffffff, 'bodyBottom', 0, 0.35, 0);
      box(0.5, 0.5, 0.5, 0xeeeeee, 'bodyTop', 0, 0.95, 0);
      box(0.4, 0.4, 0.4, 0xd87d0d, 'head', 0, 1.4, 0);
    }

    this.polishMobRig(group, type);
    return group;
  }

  public spawnRemotePlayer(id: string, username: string): void {
    const group = this.createPlayerAvatar(username);
    const savedSkin = this.remotePlayerSkins.get(id);
    if (savedSkin) this.applyMinecraftSkinToAvatar(group, savedSkin);
    this.scene.add(group);

    const playerEntity: PlayerEntity = {
      id, type: 'player',
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      rotation: new THREE.Euler(),
      dimensions: new THREE.Vector3(0.6, 1.8, 0.6),
      grounded: true, username, heldItemId: 0, ping: 0, isCrouching: false, isSprinting: false, isMoving: false, punchUntil: 0
    };
    this.remotePlayers.set(id, { entity: playerEntity, mesh: group, interpBuffer: [] });
  }

  public hasRemotePlayer(id: string): boolean {
    return this.remotePlayers.has(id);
  }


  public markRemotePlayerDead(id: string): void {
    const rPlayer = this.remotePlayers.get(id);
    if (!rPlayer) return;
    rPlayer.entity.health = 0;
    rPlayer.entity.velocity.set(0, 0, 0);
    rPlayer.interpBuffer.length = 0;
    this.remoteDeathTimers.set(id, 5.0);
    const tag = rPlayer.mesh.getObjectByName('nameTag');
    if (tag) tag.visible = false;
  }

  public reviveRemotePlayer(id: string): void {
    const rPlayer = this.remotePlayers.get(id);
    if (!rPlayer) return;
    this.remoteDeathTimers.delete(id);
    rPlayer.mesh.rotation.z = 0;
    rPlayer.mesh.rotation.x = 0;
    const tag = rPlayer.mesh.getObjectByName('nameTag');
    if (tag) tag.visible = true;
  }

  public setRemotePlayerSkin(id: string, skinDataUrl: string): void {
    if (!skinDataUrl || !/^data:image\/(png|jpeg);base64,/i.test(skinDataUrl)) return;

    this.remotePlayerSkins.set(id, skinDataUrl);
    const rPlayer = this.remotePlayers.get(id);
    if (rPlayer) {
      this.applyMinecraftSkinToAvatar(rPlayer.mesh, skinDataUrl);
    }
  }

  public updateRemotePlayer(id: string, pos: THREE.Vector3, yaw: number, pitch: number, heldItemId: number = 0): void {
    const rPlayer = this.remotePlayers.get(id);
    if (!rPlayer) return;

    const now = performance.now();
    const last = rPlayer.interpBuffer[rPlayer.interpBuffer.length - 1];
    if (last) {
      const dtSec = Math.max(0.025, Math.min(0.35, (now - last.receivedAt) / 1000));
      const delta = pos.clone().sub(last.pos);
      const speed = delta.length() / dtSec;

      // Network jitter or room teleports can produce single-packet spikes. Let
      // true teleports snap, but clamp normal walk/sprint packets so remote
      // players do not rubber-band or jitter all over the place.
      if (delta.lengthSq() > 400) {
        rPlayer.mesh.position.copy(pos);
        rPlayer.entity.position.copy(pos);
        rPlayer.interpBuffer.length = 0;
        rPlayer.entity.velocity.set(0, 0, 0);
      } else if (speed > 42) {
        delta.setLength(42 * dtSec);
        pos = last.pos.clone().add(delta);
        rPlayer.entity.velocity.copy(delta).multiplyScalar(1 / dtSec);
      } else {
        rPlayer.entity.velocity.copy(delta).multiplyScalar(1 / dtSec);
      }
    } else {
      rPlayer.mesh.position.copy(pos);
      rPlayer.entity.position.copy(pos);
      rPlayer.entity.velocity.set(0, 0, 0);
    }

    const state: InterpState = { pos: pos.clone(), yaw, pitch, heldItemId, receivedAt: now };
    rPlayer.interpBuffer.push(state);

    if (rPlayer.interpBuffer.length > this.INTERP_BUFFER_MAX) {
      rPlayer.interpBuffer.splice(0, rPlayer.interpBuffer.length - this.INTERP_BUFFER_MAX);
    }
  }

  public setRemotePlayerCrouching(id: string, isCrouching: boolean): void {
    this.setRemotePlayerState(id, { crouching: isCrouching });
  }

  public setRemotePlayerState(id: string, state: { crouching?: boolean; sprinting?: boolean; moving?: boolean; punching?: boolean; invisible?: boolean }): void {
    const rPlayer = this.remotePlayers.get(id);
    if (!rPlayer) return;
    if (typeof state.crouching === 'boolean') {
      rPlayer.entity.isCrouching = state.crouching;
      rPlayer.entity.dimensions.y = state.crouching ? 1.45 : 1.8;
    }
    if (typeof state.sprinting === 'boolean') rPlayer.entity.isSprinting = state.sprinting;
    if (typeof state.moving === 'boolean') rPlayer.entity.isMoving = state.moving;
    if (state.punching) rPlayer.entity.punchUntil = performance.now() + 420;
    if (typeof state.invisible === 'boolean') (rPlayer.entity as any).isInvisible = state.invisible;
    this.applyRemoteCrouchPose(rPlayer.mesh, !!rPlayer.entity.isCrouching);
  }

  public playRemotePlayerAction(id: string, action: string): void {
    const rPlayer = this.remotePlayers.get(id);
    if (!rPlayer) return;
    if (action === 'punch') {
      rPlayer.entity.punchUntil = performance.now() + 420;
    }
  }

  private dampScalar(current: number, target: number, lambda: number, dt: number): number {
    return THREE.MathUtils.damp(current, target, lambda, dt);
  }

  private dampAngle(current: number, target: number, lambda: number, dt: number): number {
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * (1 - Math.exp(-lambda * dt));
  }

  private dampVector(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
    current.set(
      this.dampScalar(current.x, target.x, lambda, dt),
      this.dampScalar(current.y, target.y, lambda, dt),
      this.dampScalar(current.z, target.z, lambda, dt),
    );
  }

  /** Called every frame from update() to smoothly move remote player meshes. */
  private tickRemotePlayerInterpolation(dt: number): void {
    const now = performance.now();
    const renderTime = now - this.INTERP_DELAY_MS;

    for (const [_id, rPlayer] of this.remotePlayers) {
      const deathLeft = this.remoteDeathTimers.get(_id);
      if (deathLeft !== undefined) {
        const next = deathLeft - dt;
        if (next <= 0) {
          this.remoteDeathTimers.delete(_id);
          this.scene.remove(rPlayer.mesh);
          this.disposeObject(rPlayer.mesh);
          this.remotePlayers.delete(_id);
          continue;
        }
        this.remoteDeathTimers.set(_id, next);
        rPlayer.mesh.rotation.z = this.dampAngle(rPlayer.mesh.rotation.z, Math.PI / 2, 8, dt);
        rPlayer.mesh.rotation.x = this.dampAngle(rPlayer.mesh.rotation.x, -0.18, 6, dt);
        continue;
      }

      const buf = rPlayer.interpBuffer;
      if (buf.length === 0) continue;

      let desiredPos = buf[buf.length - 1].pos.clone();
      let desiredYaw = buf[buf.length - 1].yaw;
      let desiredPitch = buf[buf.length - 1].pitch;
      let desiredHeldItem = buf[buf.length - 1].heldItemId;

      for (let i = 0; i < buf.length - 1; i++) {
        const a = buf[i];
        const b = buf[i + 1];
        if (a.receivedAt <= renderTime && b.receivedAt >= renderTime) {
          const span = Math.max(1, b.receivedAt - a.receivedAt);
          const rawT = THREE.MathUtils.clamp((renderTime - a.receivedAt) / span, 0, 1);
          const t = rawT * rawT * (3 - 2 * rawT);
          desiredPos = a.pos.clone().lerp(b.pos, t);
          desiredYaw = this.dampAngle(a.yaw, b.yaw, 1000, t / 60);
          desiredPitch = THREE.MathUtils.lerp(a.pitch, b.pitch, t);
          desiredHeldItem = b.heldItemId;
          break;
        }
      }

      if (renderTime > buf[buf.length - 1].receivedAt) {
        const latest = buf[buf.length - 1];
        const leadSeconds = Math.min(0.08, Math.max(0, (renderTime - latest.receivedAt) / 1000));
        desiredPos = latest.pos.clone().addScaledVector(rPlayer.entity.velocity, leadSeconds);
        desiredYaw = latest.yaw;
        desiredPitch = latest.pitch;
        desiredHeldItem = latest.heldItemId;
      }

      const distSq = rPlayer.mesh.position.distanceToSquared(desiredPos);
      if (distSq > 144) {
        rPlayer.mesh.position.copy(desiredPos);
      } else {
        this.dampVector(rPlayer.mesh.position, desiredPos, 18, dt);
      }

      rPlayer.mesh.rotation.y = this.dampAngle(rPlayer.mesh.rotation.y, desiredYaw, 18, dt);
      const head = rPlayer.mesh.getObjectByName('head');
      if (head) head.rotation.x = this.dampScalar(head.rotation.x, desiredPitch, 18, dt);
      rPlayer.entity.position.copy(rPlayer.mesh.position);
      rPlayer.entity.rotation.y = rPlayer.mesh.rotation.y;

      if (rPlayer.entity.heldItemId !== desiredHeldItem) {
        rPlayer.entity.heldItemId = desiredHeldItem;
        this.updatePlayerHeldItemMesh(rPlayer.mesh, desiredHeldItem);
      }

      const cutoff = renderTime - 2000;
      while (buf.length > 2 && buf[0].receivedAt < cutoff) buf.shift();

      this.applyRemoteCrouchPose(rPlayer.mesh, !!rPlayer.entity.isCrouching);
      this.animateRemotePlayer(rPlayer.mesh, rPlayer.entity, dt);

      // Handle invisibility effect styling
      const isInvisible = !!(rPlayer.entity as any).isInvisible;
      if (isInvisible) {
        const game = (window as any).game;
        let isTeammate = false;
        if (game) {
          const myTeam = game.getMyBedWarsTeam?.();
          const playerTeam = game.getPlayerBedWarsTeam?.(rPlayer.entity.username);
          if (myTeam && playerTeam && myTeam === playerTeam) {
            isTeammate = true;
          }
        }

        if (isTeammate) {
          // Semi-transparent to teammates
          rPlayer.mesh.visible = true;
          rPlayer.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              if (child.name === 'nameTag') {
                child.visible = true;
              } else {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                for (const mat of materials) {
                  if (mat) {
                    if (mat.userData.originalOpacity === undefined) {
                      mat.userData.originalOpacity = mat.opacity;
                      mat.userData.originalTransparent = mat.transparent;
                    }
                    mat.transparent = true;
                    mat.opacity = 0.25;
                  }
                }
                child.visible = true;
              }
            }
          });
        } else {
          // Fully invisible to enemies except their held item
          rPlayer.mesh.visible = true; // group remains visible, but we toggle children
          rPlayer.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              if (child.name === 'nameTag') {
                child.visible = false;
              } else if (child.name === 'heldItem' || child.userData?.heldItem) {
                child.visible = true;
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                for (const mat of materials) {
                  if (mat) {
                    if (mat.userData.originalOpacity !== undefined) {
                      mat.opacity = mat.userData.originalOpacity;
                      mat.transparent = mat.userData.originalTransparent;
                    }
                  }
                }
              } else {
                child.visible = false;
              }
            }
          });
        }
      } else {
        // Restore normal rendering
        rPlayer.mesh.visible = true;
        rPlayer.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (child.name === 'nameTag') {
              const isDead = rPlayer.entity.health === 0 || this.remoteDeathTimers.has(_id);
              child.visible = !isDead;
            } else {
              child.visible = true;
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              for (const mat of materials) {
                if (mat) {
                  if (mat.userData.originalOpacity !== undefined) {
                    mat.opacity = mat.userData.originalOpacity;
                    mat.transparent = mat.userData.originalTransparent;
                  } else {
                    mat.transparent = mat.alphaTest > 0;
                    mat.opacity = 1.0;
                  }
                }
              }
            }
          }
        });
      }
    }
  }

  private applyRemoteCrouchPose(group: THREE.Group, isCrouching: boolean): void {
    const targetScaleY = isCrouching ? 0.78 : 1.0;
    group.scale.y += (targetScaleY - group.scale.y) * 0.35;
    const head = group.getObjectByName('head');
    const torso = group.getObjectByName('torso');
    const nameTag = group.getObjectByName('nameTag');
    if (head) head.position.y += ((isCrouching ? 1.42 : 1.62) - head.position.y) * 0.35;
    if (torso) torso.position.y += ((isCrouching ? 0.93 : 1.08) - torso.position.y) * 0.35;
    if (nameTag) nameTag.position.y += ((isCrouching ? 1.72 : 2.05) - nameTag.position.y) * 0.35;
  }

  private updatePlayerHeldItemMesh(playerMesh: THREE.Group, heldItemId: number): void {
    const armR = playerMesh.getObjectByName('armR');
    if (!armR) return;

    // Remove only previous held-item meshes. The old code removed the actual
    // rightArm child because it only spared armRSleeve/armRHand names that this
    // rig does not use, which made remote arms disappear/detach as soon as an
    // item synced over multiplayer.
    const toRemove: THREE.Object3D[] = [];
    armR.children.forEach(child => {
      if (child.userData?.heldItem || child.name.startsWith('heldItem')) {
        toRemove.push(child);
      }
    });
    toRemove.forEach(child => {
      armR.remove(child);
      this.disposeObject(child);
    });

    // Create and attach new held item mesh
    const itemMesh = this.createHeldItemMesh(heldItemId);
    if (itemMesh) {
      itemMesh.name = 'heldItem';
      itemMesh.userData.heldItem = true;
      armR.add(itemMesh);
    }
  }

  private applyBlockUVs(geometry: THREE.BufferGeometry, blockId: number): void {
    const cols = 16;
    const rows = 96;
    const tileUv = (faceIndex: number, flipY = false): number[] => {
      const texIdx = BlockRegistry.getFaceTextureIndex(blockId, faceIndex);
      const uMin = (texIdx % cols) / cols;
      const uMax = uMin + 1 / cols;
      const vMax = 1.0 - Math.floor(texIdx / cols) / rows;
      const vMin = vMax - 1 / rows;
      return flipY
        ? [uMin, vMin, uMax, vMin, uMax, vMax, uMin, vMax]
        : [uMax, vMax, uMin, vMax, uMin, vMin, uMax, vMin];
    };

    // BoxGeometry face order is +X, -X, +Y, -Y, +Z, -Z.
    // BlockRegistry face order is Top, Bottom, -X, +X, +Z, -Z.
    // This fixes grass/log held blocks showing the top texture on every side and
    // keeps side textures upright instead of sideways in inventory/hand models.
    const uvs = new Float32Array([
      ...tileUv(3),       // +X right
      ...tileUv(2),       // -X left
      ...tileUv(0),       // +Y top
      ...tileUv(1, true), // -Y bottom
      ...tileUv(4),       // +Z front
      ...tileUv(5),       // -Z back
    ]);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  private createHeldItemMesh(itemId: number): THREE.Object3D | null {
    if (itemId === 0) return null;

    // 1. If it's a placeable block, render a mini block!
    if (ItemRegistry.shouldRenderAsBlock(itemId) && BlockRegistry.isPlaceableBlock(itemId)) {
      const size = 0.16;
      const geometry = new THREE.BoxGeometry(size, size, size);
      this.applyBlockUVs(geometry, itemId);

      const map = TextureGenerator.atlasTexture;
      const material = map
        ? new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0.0 })
        : new THREE.MeshStandardMaterial({ color: 0x8f8f8f, roughness: 0.82, metalness: 0.0 });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, -0.4, -0.1);
      mesh.rotation.set(0.2, 0.4, 0.1);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    // 2. Otherwise, render a procedural tool or item!
    const group = new THREE.Group();
    const matWood = new THREE.MeshStandardMaterial({ color: 0x7b4b2a, roughness: 0.75 });

    const getTierColor = (tier: number): number => {
      switch (tier) {
        case 0: return 0x866043;
        case 1: return 0x8b8b8b;
        case 2: return 0xe2e2e2;
        case 3: return 0xf4c430;
        case 4: return 0x4ee2ec;
        default: return 0xffffff;
      }
    };

    if (itemId >= 220 && itemId <= 264) {
      const toolType = Math.floor((itemId - 220) / 5);
      const tier = (itemId - 220) % 5;
      const headColor = getTierColor(tier);
      const headMat = new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.68, metalness: tier >= 2 ? 0.4 : 0.0 });

      // Handle (stick)
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.28, 0.03), matWood);
      handle.position.set(0, -0.35, -0.05);
      handle.rotation.x = Math.PI / 3; // Tilt forward
      handle.castShadow = true;
      group.add(handle);

      if (toolType === 0) { // Pickaxe
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.05), headMat);
        head.position.set(0, 0.12, 0);
        handle.add(head);
      } else if (toolType === 1) { // Axe
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.04), headMat);
        head.position.set(-0.04, 0.1, 0);
        handle.add(head);
      } else if (toolType === 2) { // Shovel
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), headMat);
        head.position.set(0, 0.12, 0);
        handle.add(head);
      } else if (toolType === 3) { // Sword
        group.remove(handle);
        
        const swordHandle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.03), matWood);
        swordHandle.position.set(0, -0.32, -0.08);
        swordHandle.rotation.x = Math.PI / 4;
        group.add(swordHandle);

        const guardMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 });
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.04), guardMat);
        guard.position.set(0, 0.05, 0);
        swordHandle.add(guard);

        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.04), headMat);
        blade.position.set(0, 0.18, 0);
        swordHandle.add(blade);
      } else if (toolType === 4) { // Hoe
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.04), headMat);
        head.position.set(-0.03, 0.12, 0);
        handle.add(head);
      }
    } else {
      // Draw general item as a tiny block
      const geometry = new THREE.BoxGeometry(0.08, 0.08, 0.08);
      const mat = new THREE.MeshStandardMaterial({ color: 0xc24a3f }); // red apple color as default
      if (itemId === 200) mat.color.setHex(0x866043); // Stick wood color
      if (itemId === 201) mat.color.setHex(0x111111); // Coal black
      if (itemId === 202) mat.color.setHex(0xe2e2e2); // Iron silver
      if (itemId === 203) mat.color.setHex(0xf4c430); // Gold yellow
      if (itemId === 204) mat.color.setHex(0x4ee2ec); // Diamond cyan
      const itemMesh = new THREE.Mesh(geometry, mat);
      itemMesh.position.set(0, -0.42, 0);
      group.add(itemMesh);
    }

    return group;
  }

  private createDefaultSteveSkin(): string {
    return createDefaultSteveSkinDataUrl();
  }

  public updatePlayerNameTag(group: THREE.Group, username: string, health: number): void {
    const tag = group.getObjectByName('nameTag') as THREE.Mesh | undefined;
    if (!tag) return;

    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, 256, 48);
    ctx.fillStyle = '#ffffff'; ctx.font = '24px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${username} (${health} HP)`, 128, 24);

    const tagTexture = new THREE.CanvasTexture(canvas);
    if (tag.material instanceof THREE.MeshBasicMaterial) {
      if (tag.material.map) tag.material.map.dispose();
      tag.material.map = tagTexture;
      tag.material.needsUpdate = true;
    }
  }


  private createPlayerAvatar(username: string): THREE.Group {
    const group = new THREE.Group();
    group.name = `remotePlayer:${username}`;
    group.userData.minecraftAvatar = true;

    // Minecraft/Java-style proportions: 8×8×8 head, 8×12×4 body,
    // 4×12×4 arms/legs, scaled to a 1.8-block tall player.
    const unit = 1.8 / 32;
    const head = unit * 8;
    const bodyW = unit * 8;
    const bodyH = unit * 12;
    const bodyD = unit * 4;
    const limbW = unit * 4;
    const limbH = unit * 12;
    const limbD = unit * 4;
    const overlayGrow = unit * 0.55;

    const fallbackMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const addBox = (name: string, size: [number, number, number], pos: [number, number, number], parent: THREE.Object3D = group, material: THREE.Material = fallbackMat): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material.clone());
      mesh.name = name;
      mesh.position.set(...pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    };

    const legY = bodyH / 2;
    const bodyY = limbH + bodyH / 2;
    const headY = limbH + bodyH + head / 2;

    addBox('head', [head, head, head], [0, headY, 0]);
    addBox('headOuter', [head + overlayGrow, head + overlayGrow, head + overlayGrow], [0, headY, 0]);
    addBox('torso', [bodyW, bodyH, bodyD], [0, bodyY, 0]);
    addBox('torsoOuter', [bodyW + overlayGrow, bodyH + overlayGrow, bodyD + overlayGrow], [0, bodyY, 0]);

    const armTopY = limbH + bodyH;
    const armL = new THREE.Group(); armL.name = 'armL'; armL.position.set(-(bodyW / 2 + limbW / 2), armTopY, 0); group.add(armL);
    addBox('leftArm', [limbW, limbH, limbD], [0, -limbH / 2, 0], armL);
    addBox('leftArmOuter', [limbW + overlayGrow, limbH + overlayGrow, limbD + overlayGrow], [0, -limbH / 2, 0], armL);

    const armR = new THREE.Group(); armR.name = 'armR'; armR.position.set(bodyW / 2 + limbW / 2, armTopY, 0); group.add(armR);
    addBox('rightArm', [limbW, limbH, limbD], [0, -limbH / 2, 0], armR);
    addBox('rightArmOuter', [limbW + overlayGrow, limbH + overlayGrow, limbD + overlayGrow], [0, -limbH / 2, 0], armR);

    const legL = new THREE.Group(); legL.name = 'legL'; legL.position.set(-limbW / 2, limbH, 0); group.add(legL);
    addBox('leftLeg', [limbW, limbH, limbD], [0, -limbH / 2, 0], legL);
    addBox('leftLegOuter', [limbW + overlayGrow, limbH + overlayGrow, limbD + overlayGrow], [0, -limbH / 2, 0], legL);

    const legR = new THREE.Group(); legR.name = 'legR'; legR.position.set(limbW / 2, limbH, 0); group.add(legR);
    addBox('rightLeg', [limbW, limbH, limbD], [0, -limbH / 2, 0], legR);
    addBox('rightLegOuter', [limbW + overlayGrow, limbH + overlayGrow, limbD + overlayGrow], [0, -limbH / 2, 0], legR);

    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, 256, 48);
    ctx.fillStyle = '#ffffff'; ctx.font = '24px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(username, 128, 24);
    const tagTexture = new THREE.CanvasTexture(canvas);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.26), new THREE.MeshBasicMaterial({ map: tagTexture, transparent: true, depthWrite: false }));
    tag.name = 'nameTag'; tag.position.y = 2.08; group.add(tag);

    this.applyMinecraftSkinToAvatar(group, this.createDefaultSteveSkin());
    return group;
  }

  private applyMinecraftSkinToAvatar(group: THREE.Group, skinDataUrl: string): void {
    if (!isSkinDataUrl(skinDataUrl)) return;
    const img = new Image();
    img.onload = () => {
      const legacy = img.height <= 32;
      try {
        setBoxSkin(group, 'head', img, skinPartRects('head', legacy));
        setBoxSkin(group, 'torso', img, skinPartRects('body', legacy));
        setBoxSkin(group, 'rightArm', img, skinPartRects('rightArm', legacy));
        setBoxSkin(group, 'leftArm', img, skinPartRects(legacy ? 'rightArm' : 'leftArm', legacy), legacy);
        setBoxSkin(group, 'rightLeg', img, skinPartRects('rightLeg', legacy));
        setBoxSkin(group, 'leftLeg', img, skinPartRects(legacy ? 'rightLeg' : 'leftLeg', legacy), legacy);

        // The outer layer is the skin jacket/hat/sleeves/pants. These are slightly
        // larger transparent boxes, so skins visibly wrap the outside of the model.
        const outerTargets: Array<[string, any, boolean]> = [
          ['headOuter', 'head', false], ['torsoOuter', 'body', false],
          ['rightArmOuter', 'rightArm', false], ['leftArmOuter', legacy ? 'rightArm' : 'leftArm', legacy],
          ['rightLegOuter', 'rightLeg', false], ['leftLegOuter', legacy ? 'rightLeg' : 'leftLeg', legacy],
        ];
        for (const [name, part, mirror] of outerTargets) {
          const obj = group.getObjectByName(name);
          if (!obj) continue;
          if (legacy) {
            obj.visible = false;
          } else {
            obj.visible = true;
            setBoxSkin(group, name, img, skinPartRects(part, false, true), mirror, { outer: true });
          }
        }
      } catch (err) {
        console.warn('[PlayerModel] Failed to apply Minecraft skin:', err);
      }
    };
    img.src = skinDataUrl;
  }

  private animateRemotePlayer(group: THREE.Group, entity: PlayerEntity, dt: number = 0.016): void {
    const moving = !!entity.isMoving || entity.velocity.lengthSq() > 0.0002;
    const sprint = !!entity.isSprinting;
    const crouch = !!entity.isCrouching;
    const now = performance.now();
    const cycle = now * (sprint ? 0.019 : crouch ? 0.008 : 0.012);
    const swing = moving ? Math.sin(cycle) * (sprint ? 0.95 : crouch ? 0.32 : 0.48) : 0;
    const punchLeft = Math.max(0, (Number(entity.punchUntil || 0) - now) / 420);
    const punchCurve = punchLeft > 0 ? Math.sin((1 - punchLeft) * Math.PI) : 0;

    const armL = group.getObjectByName('armL');
    const armR = group.getObjectByName('armR');
    const legL = group.getObjectByName('legL');
    const legR = group.getObjectByName('legR');
    const head = group.getObjectByName('head');
    const torso = group.getObjectByName('torso');
    const tag = group.getObjectByName('nameTag');

    if (armL) armL.rotation.x = -swing * (sprint ? 0.78 : 0.55);
    if (armR) {
      if (punchCurve > 0.001) {
        armR.rotation.x = -0.72 - punchCurve * 1.18;
        armR.rotation.y = -0.18 - punchCurve * 0.24;
        armR.rotation.z = -0.10 - punchCurve * 0.28;
      } else {
        armR.rotation.x = swing * (sprint ? 0.78 : 0.55);
        armR.rotation.y = 0;
        armR.rotation.z = 0;
      }
    }
    if (legL) legL.rotation.x = swing;
    if (legR) legR.rotation.x = -swing;
    if (head) head.position.y += ((crouch ? 1.42 : 1.62) - head.position.y) * Math.min(1, dt * 12);
    if (torso) torso.position.y += ((crouch ? 0.93 : 1.08) - torso.position.y) * Math.min(1, dt * 12);
    if (tag) tag.rotation.y = -group.rotation.y;

    // Keep remote player vertical position network-authoritative. Visual bobbing on
    // the whole avatar looked like rubbery bouncing from other POVs, especially
    // under packet jitter. Limb swing now carries the movement read instead.
    (group as any)._bobOffset = 0;
  }


  private spawnLocalDeathBody(position: THREE.Vector3): void {
    const body = this.createPlayerAvatar('');
    body.position.copy(position).add(new THREE.Vector3(0, 0.05, 0));
    body.rotation.y = (window as any).gameCameraController?.yaw ?? 0;
    body.rotation.z = Math.PI / 2;
    const tag = body.getObjectByName('nameTag');
    if (tag) tag.visible = false;
    body.traverse(obj => { obj.userData.localDeathBody = true; });
    this.scene.add(body);
    this.localDeathBodies.push({ mesh: body, age: 0, maxAge: 6.0, targetY: position.y + 0.22 });
  }

  private tickLocalDeathBodies(dt: number): void {
    for (let i = this.localDeathBodies.length - 1; i >= 0; i--) {
      const body = this.localDeathBodies[i];
      body.age += dt;
      body.mesh.rotation.z += (Math.PI / 2 - body.mesh.rotation.z) * Math.min(1, dt * 8);
      body.mesh.position.y += (body.targetY - body.mesh.position.y) * Math.min(1, dt * 3);
      if (body.age >= body.maxAge) {
        this.scene.remove(body.mesh);
        this.disposeObject(body.mesh);
        this.localDeathBodies.splice(i, 1);
      }
    }
  }

  public removeRemotePlayer(id: string): void {
    const rPlayer = this.remotePlayers.get(id);
    if (rPlayer) {
      this.restorePlayerMaterials(id);
      this.scene.remove(rPlayer.mesh);
      this.disposeObject(rPlayer.mesh);
      this.remotePlayers.delete(id);
      this.remoteDeathTimers.delete(id);
    }
  }

  public clearRemotePlayers(): void {
    for (const id of Array.from(this.remotePlayers.keys())) {
      this.removeRemotePlayer(id);
    }
  }

  public clear(): void {
    for (const id of Array.from(this.mobMeshes.keys())) {
      this.removeMob(id);
    }
    this.localMobs = [];
    this.clearRemotePlayers();
    for (const body of this.localDeathBodies) {
      this.scene.remove(body.mesh);
      this.disposeObject(body.mesh);
    }
    this.localDeathBodies = [];

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      this.removeArrowAt(i);
    }
  }

  private removeArrowAt(index: number): void {
    const arrow = this.arrows[index];
    if (!arrow) return;
    this.scene.remove(arrow.mesh);
    this.disposeObject(arrow.mesh);
    this.arrows.splice(index, 1);
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose?.();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        mat?.dispose?.();
      }
    });
  }

  private spawnArrow(pos: THREE.Vector3, dir: THREE.Vector3, damage: number, fromPlayer: boolean, isSpectral = false): void {
    const mesh = this.createArrowMesh(isSpectral);
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().add(dir));
    this.scene.add(mesh);

    const velocity = dir.clone().multiplyScalar(fromPlayer ? 24.0 : 15.0);

    this.arrows.push({
      position: pos.clone(),
      velocity,
      mesh,
      damage,
      fromPlayer,
      age: 0,
      stuck: false,
      isSpectral,
      isOnFire: false
    });
  }

  private createArrowMesh(isSpectral = false): THREE.Mesh {
    const arrowColor = isSpectral ? 0xe6b800 : 0x8b5e3c;
    const headColor = isSpectral ? 0xffcc00 : 0x888888;
    const featherColor = isSpectral ? 0xffff66 : 0xffffff;

    const arrow = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.6),
      new THREE.MeshLambertMaterial({ color: arrowColor })
    );
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.12),
      new THREE.MeshLambertMaterial({ color: headColor })
    );
    head.position.set(0, 0, 0.3);
    arrow.add(head);

    const feathers = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.02, 0.15),
      new THREE.MeshLambertMaterial({ color: featherColor })
    );
    feathers.position.set(0, 0, -0.22);
    arrow.add(feathers);

    arrow.castShadow = true;
    return arrow;
  }
}
