import * as THREE from 'three';
import { armorDamageModifier, Combatant, StatusEffectSet } from '@vapour/engine';
import { InputManager } from '../core/InputManager';
import { EventBus } from '../core/EventBus';
import { WorldManager } from '../world/WorldManager';
import { VoxelPhysics } from '../physics/VoxelPhysics';
import { BlockRegistry } from '../world/BlockRegistry';
import { AABB } from '../physics/AABB';
import { AudioManager } from '../audio/AudioManager';
import { Inventory } from '../inventory/Inventory';
import { StorageManager } from '../storage/StorageManager';
import { ItemRegistry } from '../items/ItemRegistry';
import { getFeatureBlockId, getFeatureItemId, getPlantableItem } from '../content/FeatureCatalog';
import type { MobEntity } from '../entities/EntityTypes';
import { CROWNFORGE_BEDWARS_SHOP_NPCS, isCrownForgeDimension, defaultSpawnForDimension } from '../crownforge/CrownForgeCatalog';

export interface PlayerMovementOverrideContext {
  dt: number;
  cameraDirection: THREE.Vector3;
  previousPosition: THREE.Vector3;
  footBlock: number;
  player: PlayerController;
  world: WorldManager;
  physics: VoxelPhysics;
}

export class PlayerController {
  private static readonly crownForgePlayerPlacedBlocks = new Set<string>();

  public position = new THREE.Vector3(0, 20, 0); // Spawn high up
  public velocity = new THREE.Vector3();
  public dimensions = new THREE.Vector3(0.6, 1.8, 0.6);
  public eyeHeight = 1.6;

  public grounded = false;
  public isSubmerged = false;
  public isCrouching = false;

  // Stats / Gameplay variables
  public gameMode: 'survival' | 'creative' | 'hardcore' = 'survival';
  private readonly combatant = new Combatant({ maxHealth: 20 });
  public hunger = 20;
  public maxHunger = 20;
  public isFlying = false;
  public isSpectator = false;
  
  public xp = 0;
  public level = 0;

  private hungerTimer = 0;
  private regenTimer = 0;
  private lastSpacePressTime = 0;

  public activeEffects = new StatusEffectSet<string>([
    { id: 'poison', tickInterval: 2.0 },
    { id: 'wither', tickInterval: 1.5 },
    { id: 'regeneration', tickInterval: 2.0 },
  ]);
  private lavaDamageTimer = 0;

  // Physics / movement tuning
  private groundAccel = 160.0;
  private airAccel = 40.0;
  private groundFriction = 12.0;
  private bhopBoost = 1.08;
  private maxHorizontalSpeed = 20.0;
  private lastJumpPressed = false;

  // B-hop streak tracking
  private bhopStreak = 0;
  private bhopStreakMax = 20;
  private bhopStreakDecayTime = 0.9; // seconds before streak resets
  private lastJumpTime = 0; // seconds timestamp of last jump

  // Portal variables
  private isInPortal = false;
  private portalTimer = 0;
  private caveAmbienceTimer = 0;
  private hasSetInitialSpawn = false;

  public isSprinting = false;
  public movementOverride: ((context: PlayerMovementOverrideContext) => boolean) | null = null;
  private lastSprintParticleTime = 0;

  public oxygen = 20;
  public maxOxygen = 20;
  private drowningTimer = 0;

  public isDrawingBow = false;
  private bowDrawTime = 0;

  private world: WorldManager;
  private physics: VoxelPhysics;
  private inventory: Inventory;

  // Camera direction vectors
  private moveDirection = new THREE.Vector3();

  public get health(): number { return this.combatant.health; }
  public set health(value: number) {
    if (value > 0 && !this.combatant.alive) this.combatant.revive(value);
    else this.combatant.setHealth(value);
  }
  public get maxHealth(): number { return this.combatant.maxHealth; }
  public set maxHealth(value: number) { this.combatant.setMaxHealth(value); }
  public get isDead(): boolean { return !this.combatant.alive; }
  public set isDead(value: boolean) {
    if (value && this.combatant.alive) this.combatant.kill('state');
    else if (!value && !this.combatant.alive) this.combatant.revive();
  }

  // Mining / Interaction variables
  public targetBlock: { x: number; y: number; z: number; normal: THREE.Vector3; blockId: number } | null = null;
  
  private isMining = false;
  private miningProgress = 0; // 0.0 to 1.0
  private lastMiningStage = 0;
  private lastHitSoundTime = 0;
  private lastProtectedBlockWarnAt = 0;

  constructor(world: WorldManager, inventory: Inventory) {
    this.world = world;
    this.inventory = inventory;
    this.physics = new VoxelPhysics(world);
    this.combatant.addModifier({
      id: 'cubegame:fire-resistance',
      priority: 0,
      applies: ({ kind }) => (kind === 'fire' || kind === 'lava') && this.activeEffects.has('fire_resistance'),
      modify: () => null,
    });
    this.combatant.addModifier({
      id: 'cubegame:blocking',
      priority: 10,
      applies: ({ kind }) => (kind === 'mob' || kind === 'combat') && this.isBlockingDamage(),
      modify: ({ amount }) => {
        const reduced = Math.max(0.5, amount * 0.3);
        EventBus.emit('network:chat', `[System] Blocked! Reduced damage from ${amount} to ${reduced}`);
        AudioManager.playItemPickup();
        return reduced;
      },
    });
    this.combatant.addModifier({
      id: 'cubegame:resistance',
      priority: 20,
      applies: ({ kind }) => kind !== 'void' && kind !== 'starvation' && this.activeEffects.has('resistance'),
      modify: ({ amount }) => Math.max(0.5, amount * 0.7),
    });
    this.combatant.addModifier(armorDamageModifier({
      points: () => this.getArmorPoints(),
      minimumDamage: 0.5,
      bypassKinds: new Set(['void', 'starvation', 'drowning']),
    }));
    this.activeEffects.subscribe((event) => {
      if (event.type === 'tick') {
        if (event.effect.id === 'poison' && this.health > 1) this.takeDamage(1, 'poison');
        else if (event.effect.id === 'wither') this.takeDamage(1, 'wither');
        else if (event.effect.id === 'regeneration') this.heal(1);
        return;
      }
      if (event.type === 'expired') {
        EventBus.emit('network:chat', `[System] Effect ${event.effect.id.toUpperCase()} wore off.`);
      }
      EventBus.emit('player:effectsChanged', Array.from(this.activeEffects.keys()));
    });

    setTimeout(() => {
      const xpNeeded = 100 + this.level * 50;
      EventBus.emit('player:xpChanged', { xp: this.xp, level: this.level, max: xpNeeded });
      
      const respawnBtn = document.getElementById('death-respawn-btn');
      if (respawnBtn) {
        respawnBtn.onclick = () => this.respawn();
      }
      const quitBtn = document.getElementById('death-quit-btn');
      if (quitBtn) {
        quitBtn.onclick = () => this.quitToTitle();
      }
    }, 100);

    // Setup input listeners
    EventBus.on('mouse:leftClick', () => {
      if (this.isSpectator) return;
      if (ItemRegistry.getToolType(this.getHeldItemId()) === 'gun') return;
      // BedWars shop villagers are interaction targets, not damage targets.
      // Punching them should open the shop just like right-clicking.
      if (this.tryOpenTargetShop()) return;
      this.startMining();
      this.tryMeleeAttack();
    });
    EventBus.on('mouse:leftRelease', () => {
      if (this.isSpectator) return;
      this.resetMining();
    });
    EventBus.on('mouse:rightClick', () => {
      if (this.isSpectator) return;
      this.useHeldItemOrPlaceBlock();
    });
    EventBus.on('mouse:rightRelease', () => {
      if (this.isSpectator) return;
      this.releaseHeldItem();
    });

    // Command listeners
    EventBus.on('command:gamemode', (mode: 'survival' | 'creative' | 'hardcore') => {
      this.gameMode = mode;
      this.isFlying = (mode === 'creative');
      if (!this.isFlying) {
        this.velocity.y = 0;
      }
      EventBus.emit('player:healthChanged', this.health);
      EventBus.emit('player:hungerChanged', this.hunger);
    });

    EventBus.on('command:tp', (coords: { x: number; y: number; z: number }) => {
      this.position.set(coords.x, coords.y, coords.z);
      this.velocity.set(0, 0, 0);
      this.grounded = false;
      StorageManager.setWorldData('player_pos', { x: coords.x, y: coords.y, z: coords.z });
    });

    EventBus.on('command:dimension', (dim: string) => {
      this.world.setDimension(dim);
      this.position.set(8, 24, 8);
      this.velocity.set(0, 0, 0);
      this.grounded = false;
      StorageManager.setWorldData('player_pos', { x: 8, y: 24, z: 8 });
    });

    // Detect double-space bar for Creative Flight Toggle
    window.addEventListener('keydown', (e) => {
      if (InputManager.isUIActive) return;
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === ' ' || e.key === 'Spacebar') {
        const now = performance.now();
        if (this.gameMode === 'creative') {
          if (now - this.lastSpacePressTime < 250) {
            this.isFlying = !this.isFlying;
            if (!this.isFlying) {
              this.velocity.y = 0;
            }
          }
        }
        this.lastSpacePressTime = now;
      }
    });
  }

  public applyServerSpawn(spawn: { x: number; y: number; z: number }, role: 'player' | 'spectator' = 'player'): void {
    const x = Number.isFinite(Number(spawn?.x)) ? Number(spawn.x) : 8;
    const y = Number.isFinite(Number(spawn?.y)) ? Number(spawn.y) : 68;
    const z = Number.isFinite(Number(spawn?.z)) ? Number(spawn.z) : 8;
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.hasSetInitialSpawn = true;
    this.isDead = false;
    this.setSpectatorMode(role === 'spectator');
    if (role !== 'spectator') {
      this.health = this.maxHealth;
      this.hunger = this.maxHunger;
      EventBus.emit('player:healthChanged', this.health);
      EventBus.emit('player:hungerChanged', this.hunger);
    }
    const screen = document.getElementById('death-screen');
    if (screen) screen.style.display = 'none';
    InputManager.isUIActive = false;
  }

  public update(dt: number, cameraDirection: THREE.Vector3): void {
    if (this.isDead) {
      this.velocity.set(0, 0, 0);
      return;
    }

    // 0. Void-respawn check. Minigames must never fall back to the survival
    // spawn at 8,24,8; the server owns arena respawns and will send serverJump
    // to the proper island/team spawn.
    if (this.position.y < -45.0) {
      const isMinigame = this.world.currentDimension === 'skywars' || this.world.currentDimension === 'bedwars' || this.world.currentDimension === 'void_duels' || this.world.currentDimension === 'castle_siege' || this.world.currentDimension === 'survival_games' || this.world.currentDimension.startsWith('cbgo_') || this.world.currentDimension.startsWith('tf2_') || this.world.currentDimension.startsWith('cob_');
      if (this.isSpectator) {
        this.position.set(0, 84, 0);
        this.velocity.set(0, 0, 0);
        return;
      }
      if (isMinigame && (window as any).gameNetworkManager?.connected) {
        this.velocity.set(0, 0, 0);
        this.takeDamage(this.maxHealth, 'void');
        return;
      }
      const spawn = defaultSpawnForDimension(this.world.currentDimension);
      this.position.set(spawn.x, spawn.y, spawn.z);
      this.velocity.set(0, 0, 0);
      this.grounded = false;
      StorageManager.setWorldData('player_pos', { x: spawn.x, y: spawn.y, z: spawn.z });
      if (this.gameMode === 'hardcore') {
        this.takeDamage(20, 'void');
      } else {
        this.takeDamage(4, 'void');
      }
    }

    // Hold player in place until the chunk column under them is loaded and meshed
    const chunkX = Math.floor(this.position.x / 16);
    const chunkZ = Math.floor(this.position.z / 16);
    const chunkY = Math.floor(this.position.y / 16);
    const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
    const currentChunk = this.world.chunks.get(chunkKey);

    if (!currentChunk || !currentChunk.meshesLoaded) {
      this.velocity.set(0, 0, 0);
      this.grounded = false;
      return;
    }

    if (!this.hasSetInitialSpawn) {
      const px = Math.floor(this.position.x);
      const pz = Math.floor(this.position.z);
      const groundY = this.getHighestSolidBlockY(px, pz);
      this.position.y = groundY + 2.0;
      this.velocity.set(0, 0, 0);
      this.grounded = true;
      this.hasSetInitialSpawn = true;
      StorageManager.setWorldData('player_pos', { x: this.position.x, y: this.position.y, z: this.position.z }).catch(() => {});
    }

    this.updateEffects(dt);

    // Cave Ambience
    this.caveAmbienceTimer += dt;
    if (this.caveAmbienceTimer >= 30.0) {
      this.caveAmbienceTimer = 0;
      if (this.position.y < 12.0) {
        AudioManager.playArrowHit();
        EventBus.emit('network:chat', `* Spooky cave noises *`);
      }
    }

    // 0.5. Stat updates for hunger decay and health regen
    if ((this.gameMode === 'survival' || this.gameMode === 'hardcore') && !this.isSpectator && this.world.currentDimension !== 'backrooms') {
      const isSprinting = InputManager.isActionDown('sprint');
      // hunger decay
      this.hungerTimer += dt;
      if (this.hungerTimer >= 5.0) {
        let decay = 0.1;
        if (isSprinting && this.moveDirection.lengthSq() > 0) decay = 0.3;
        this.hunger = Math.max(0, this.hunger - decay);
        this.hungerTimer = 0;
        EventBus.emit('player:hungerChanged', this.hunger);
      }

      // health regen and starvation
      this.regenTimer += dt;
      if (this.regenTimer >= 2.0) {
        if (this.hunger >= 18 && this.health < 20) {
          this.health = Math.min(20, this.health + 1);
          EventBus.emit('player:healthChanged', this.health);
        } else if (this.hunger === 0) {
          this.takeDamage(1, 'starvation');
        }
        this.regenTimer = 0;
      }
    } else {
      this.health = 20;
      this.hunger = 20;
    }

    if (this.world.currentDimension === 'backrooms' && this.hunger < this.maxHunger) {
      this.hunger = this.maxHunger;
      EventBus.emit('player:hungerChanged', this.hunger);
    }

    // 0.6. Portal Collision check
    const px = Math.floor(this.position.x);
    const py = Math.floor(this.position.y);
    const pz = Math.floor(this.position.z);
    
    const blockFeet = this.world.getVoxel(px, py, pz);
    const blockBody = this.world.getVoxel(px, py + 1, pz);

    if (blockFeet === 29 || blockBody === 29) {
      if (!this.isInPortal) {
        this.isInPortal = true;
        this.portalTimer = 0;
        const command = this.getCrownForgePortalCommand();
        EventBus.emit('network:chat', command ? '[CrownForge] Portal activating...' : '[Portal] Transitioning dimensions in 1.5s...');
      }
      this.portalTimer += dt;
      if (this.portalTimer >= 1.5) {
        this.triggerPortalTransition();
        this.portalTimer = 0;
        this.isInPortal = false;
      }
    } else {
      this.isInPortal = false;
      this.portalTimer = 0;
    }

    // 1. Check if submerged in water
    const eyeBlock = this.world.getVoxel(
      Math.floor(this.position.x),
      Math.floor(this.position.y + this.eyeHeight),
      Math.floor(this.position.z)
    );
    this.isSubmerged = BlockRegistry.get(blockFeet).isWater ||
      BlockRegistry.get(blockBody).isWater ||
      BlockRegistry.get(eyeBlock).isWater;

    // Toggle water overlay and update oxygen container display
    const isEyeSubmerged = BlockRegistry.get(eyeBlock).isWater;
    const waterOverlay = document.getElementById('water-overlay');
    if (waterOverlay) {
      waterOverlay.style.display = isEyeSubmerged ? 'block' : 'none';
    }
    const o2Container = document.getElementById('oxygen-container');
    if (o2Container) {
      o2Container.style.display = isEyeSubmerged ? 'flex' : 'none';
    }

    // 1.5. Check if standing/submerged in Lava (ID 37)
    const isLavaFeet = blockFeet === 37;
    const isLavaBody = blockBody === 37;
    const isLavaEye = eyeBlock === 37;
    if (isLavaFeet || isLavaBody || isLavaEye) {
      this.lavaDamageTimer += dt;
      if (this.lavaDamageTimer >= 1.0) {
        if (!this.activeEffects.has('fire_resistance')) {
          this.takeDamage(4, 'lava');
        }
        this.lavaDamageTimer = 0;
      }
    } else {
      this.lavaDamageTimer = 0;
    }

    // Oxygen depletion / drowning logic
    if (this.gameMode === 'survival' || this.gameMode === 'hardcore') {
      if (isEyeSubmerged) {
        if (!this.activeEffects.has('water_breathing')) {
          this.oxygen = Math.max(0, this.oxygen - dt * 1.5);
        }
        const o2Bar = document.getElementById('oxygen-bar');
        if (o2Bar) {
          o2Bar.style.width = `${(this.oxygen / this.maxOxygen) * 100}%`;
        }

        if (this.oxygen <= 0) {
          this.drowningTimer += dt;
          if (this.drowningTimer >= 1.5) {
            this.drowningTimer = 0;
            this.takeDamage(2, 'drowning');
            EventBus.emit('network:chat', '[System] Drowning!');
          }
        }
      } else {
        this.oxygen = this.maxOxygen;
        this.drowningTimer = 0;
        const o2Bar = document.getElementById('oxygen-bar');
        if (o2Bar) {
          o2Bar.style.width = '100%';
        }
      }
    } else {
      this.oxygen = this.maxOxygen;
      this.drowningTimer = 0;
    }

    // 2. Locate blocks under player feet for step sounds
    const previousPosition = this.position.clone();

    const footBlock = this.world.getVoxel(
      Math.floor(this.position.x),
      Math.floor(this.position.y - 0.1),
      Math.floor(this.position.z)
    );

    if (this.movementOverride?.({
      dt,
      cameraDirection,
      previousPosition,
      footBlock,
      player: this,
      world: this.world,
      physics: this.physics,
    })) {
      return;
    }

    // 3. Locomotion / Movement Inputs
    const up = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3(cameraDirection.x, 0, cameraDirection.z).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();

    this.moveDirection.set(0, 0, 0);

    if (this.isSubmerged) {
      const swimForward = cameraDirection.clone().normalize();
      const swimRightBase = new THREE.Vector3(swimForward.x, 0, swimForward.z).normalize();
      const swimRight = new THREE.Vector3().crossVectors(swimRightBase, up).normalize();

      if (InputManager.isActionDown('moveForward')) this.moveDirection.add(swimForward);
      if (InputManager.isActionDown('moveBackward')) this.moveDirection.sub(swimForward);
      if (InputManager.isActionDown('moveRight')) this.moveDirection.add(swimRight);
      if (InputManager.isActionDown('moveLeft')) this.moveDirection.sub(swimRight);
      if (InputManager.isActionDown('jump')) this.moveDirection.y += 1;
      if (InputManager.isActionDown('crouch')) this.moveDirection.y -= 1;
    } else {
      if (InputManager.isActionDown('moveForward')) this.moveDirection.add(forward);
      if (InputManager.isActionDown('moveBackward')) this.moveDirection.sub(forward);
      if (InputManager.isActionDown('moveRight')) this.moveDirection.add(right);
      if (InputManager.isActionDown('moveLeft')) this.moveDirection.sub(right);
    }

    this.moveDirection.normalize();
    const isCbgoArena = this.world.currentDimension.startsWith('cbgo_') && this.world.currentDimension !== 'cbgo_menu';
    const maxHorizontalSpeed = isCbgoArena ? 32.0 : this.maxHorizontalSpeed;
    const airAccel = isCbgoArena ? 84.0 : this.airAccel;
    const groundFriction = isCbgoArena ? 7.5 : this.groundFriction;

    const wantsCrouch = !this.isSubmerged && !(this.gameMode === 'creative' && this.isFlying) && InputManager.isActionDown('crouch');
    this.applyCrouchState(wantsCrouch);

    // Sprints check
    this.isSprinting = !this.isSubmerged && !this.isCrouching && InputManager.isActionDown('sprint') && this.moveDirection.lengthSq() > 0.0001;
    let speed = this.isSubmerged
      ? 3.0 // Swimming speed
      : this.isCrouching ? 1.55 : this.isSprinting ? 5.6 : 4.3; // Crouch vs sprint vs normal walking

    if ((this.gameMode === 'creative' || this.isSpectator) && this.isFlying) {
      speed = this.isSprinting ? 16.0 : 8.0; // Fly fast
    }

    if (this.activeEffects.has('speed')) {
      speed *= 1.4;
    }
    if (this.activeEffects.has('slowness')) {
      speed *= 0.6;
    }

    // Apply horizontal forces (physics-based)
    const desiredHoriz = new THREE.Vector3(this.moveDirection.x, 0, this.moveDirection.z).multiplyScalar(speed);
    const horizVel = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);

    if (this.isSubmerged) {
      // Swimming uses immediate control
      this.velocity.x = desiredHoriz.x;
      this.velocity.z = desiredHoriz.z;
    } else {
      if (this.grounded) {
        if (this.moveDirection.lengthSq() > 0.0001) {
          // Accelerate towards desired velocity on ground
          const delta = desiredHoriz.clone().sub(horizVel);
          const maxDelta = this.groundAccel * dt;
          if (delta.length() > maxDelta) delta.setLength(maxDelta);
          horizVel.add(delta);
        } else {
          // Apply ground friction when no input
          const frictionFactor = Math.max(0, 1 - groundFriction * dt);
          horizVel.multiplyScalar(frictionFactor);
        }
      } else {
        // Air control (weaker than ground)
        if (this.moveDirection.lengthSq() > 0.0001) {
          const delta = desiredHoriz.clone().sub(horizVel);
          const maxDelta = airAccel * dt;
          if (delta.length() > maxDelta) delta.setLength(maxDelta);
          horizVel.add(delta);
        }
      }

      // Cap horizontal speed
      const horizSpeed = Math.sqrt(horizVel.x * horizVel.x + horizVel.z * horizVel.z);
      if (horizSpeed > maxHorizontalSpeed) {
        horizVel.setLength(maxHorizontalSpeed);
      }

      this.velocity.x = horizVel.x;
      this.velocity.z = horizVel.z;
    }

    // 4. Gravity & Jump / Creative Flight
    const gravityForce = 22.0; // Snappy physics
    if ((this.gameMode === 'creative' || this.isSpectator) && this.isFlying) {
      if (InputManager.isActionDown('jump')) {
        this.velocity.y = speed; // Fly up
      } else if (InputManager.isActionDown('crouch')) {
        this.velocity.y = -speed; // Fly down
      } else {
        this.velocity.y = 0;
      }
    } else if (this.isSubmerged) {
      const targetY = this.moveDirection.y * speed;
      if (Math.abs(targetY) > 0.01) {
        this.velocity.y += (targetY - this.velocity.y) * 0.35;
      } else {
        this.velocity.y -= gravityForce * 0.05 * dt;
        this.velocity.y = Math.max(this.velocity.y, -0.55);
      }
      this.grounded = false;
    } else {
      // Normal air physics
      if (!this.grounded) {
        this.velocity.y -= gravityForce * dt;
      }
      let terminalVel = -32.0;
      if (this.activeEffects.has('slow_falling')) {
        terminalVel = -1.5;
      }
      this.velocity.y = Math.max(this.velocity.y, terminalVel); // Terminal velocity

      // Jump immediately as soon as the action is down while grounded.
      // Grounding is cleared on the same frame, so there is no artificial cooldown
      // and no repeated upward wedging under ceilings.
      const jumpPressed = InputManager.isActionDown('jump');
      const now = performance.now() / 1000;
      if (this.grounded && jumpPressed) {
        let jumpPower = 8.2;
        if (this.activeEffects.has('jump_boost')) {
          jumpPower = 11.2;
        }
        this.velocity.y = jumpPower; // Jump power
        this.grounded = false;

        // Update bhop streak (build momentum)
        if (now - this.lastJumpTime <= this.bhopStreakDecayTime) {
          this.bhopStreak = Math.min(this.bhopStreak + 1, this.bhopStreakMax);
        } else {
          this.bhopStreak = 1;
        }
        this.lastJumpTime = now;

        // B-hop boost: scale with streak
        if (this.moveDirection.lengthSq() > 0.0001) {
          const forwardDir = new THREE.Vector3(this.moveDirection.x, 0, this.moveDirection.z).normalize();
          const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);

          // base boost plus additional per-streak bonus (2% per streak, capped)
          const streakBonus = Math.min((isCbgoArena ? 0.035 : 0.02) * this.bhopStreak, isCbgoArena ? 0.55 : 0.25);
          const boostFactor = (this.bhopBoost - 1.0) + streakBonus;
          const boost = horizSpeed * boostFactor;

          this.velocity.x += forwardDir.x * boost;
          this.velocity.z += forwardDir.z * boost;

          // Small push if nearly stationary
          const newSpeed = Math.hypot(this.velocity.x, this.velocity.z);
          if (newSpeed < 0.1) {
            const smallPush = (isCbgoArena ? 0.55 : 0.2) + (isCbgoArena ? 0.06 : 0.03) * this.bhopStreak;
            this.velocity.x += forwardDir.x * smallPush;
            this.velocity.z += forwardDir.z * smallPush;
          }

          // Cap to max horizontal speed
          const clampedSpeed = Math.hypot(this.velocity.x, this.velocity.z);
          if (clampedSpeed > maxHorizontalSpeed) {
            const scale = maxHorizontalSpeed / clampedSpeed;
            this.velocity.x *= scale;
            this.velocity.z *= scale;
          }
        }

        const config = BlockRegistry.get(footBlock);
        AudioManager.playStep(config.stepSound);
      }

      this.lastJumpPressed = jumpPressed;
    }

    // Pre-displacement Y velocity for fall damage calculation
    const preYVelocity = this.velocity.y;
    const wasGrounded = this.grounded;

    // 5. Run collision resolution or noclip movement
    if ((this.gameMode === 'creative' || this.isSpectator) && this.isFlying) {
      // Noclip flying - bypass collision
      this.position.addScaledVector(this.velocity, dt);
      this.grounded = false;
    } else {
      const results = this.physics.move(this.position, this.velocity, this.dimensions, dt, this.isSubmerged, wasGrounded);
      this.grounded = results.grounded;
      this.applySafeBridgingClamp(previousPosition, wasGrounded);

      // Fall damage check and farmland trampling
      if (this.grounded && !wasGrounded) {
        if (preYVelocity < -11.0 && !this.activeEffects.has('slow_falling')) {
          const dmg = Math.floor((Math.abs(preYVelocity) - 10.0) * 1.5);
          this.takeDamage(dmg, 'fall');
        }

        // Trample farmland on jump land
        if (preYVelocity < -4.0) {
          const bx = Math.floor(this.position.x);
          const by = Math.floor(this.position.y - 0.1);
          const bz = Math.floor(this.position.z);
          const underId = this.world.getVoxel(bx, by, bz);
          const farmlandId = getFeatureBlockId('Farmland');
          const hydratedFarmlandId = getFeatureBlockId('Hydrated Farmland');
          if (underId === farmlandId || underId === hydratedFarmlandId) {
            this.world.setVoxel(bx, by, bz, 2, true);
            AudioManager.playStep('sand');
            // Pop out crop above
            const cropId = this.world.getVoxel(bx, by + 1, bz);
            const cropConfig = BlockRegistry.get(cropId);
            if (cropConfig && cropConfig.name && (cropConfig.name.includes('Crop') || cropConfig.name.includes('Berry Bush') || cropConfig.name.includes('Wheat'))) {
              this.world.setVoxel(bx, by + 1, bz, 0, true);
              const drop = this.getBlockDrop(cropId);
              if (drop !== 0) {
                EventBus.emit('item:spawn', new THREE.Vector3(bx + 0.5, by + 1.5, bz + 0.5), drop);
              }
            }
          }
        }
      }
    }

    // Play footstep sounds when moving
    if (this.grounded && this.moveDirection.lengthSq() > 0) {
      const stepInterval = this.isCrouching ? 0.7 : this.isSprinting ? 0.3 : 0.45;
      const t = performance.now() / 1000;
      if (!this.lastHitSoundTime || t - this.lastHitSoundTime > stepInterval) {
        const config = BlockRegistry.get(footBlock);
        AudioManager.playStep(config.stepSound);
        this.lastHitSoundTime = t;
      }
    }

    // 6. Perform raycast targeting
    this.updateTargetBlock(cameraDirection);

    // Continuous mining check:
    if (InputManager.isLeftMouseDown() && !this.isMining && this.targetBlock) {
      this.startMining();
    }

    // 7. Process Mining tick
    this.updateMining(dt);

    if (this.isDrawingBow) {
      this.bowDrawTime += dt;
    }

    if (this.isSprinting && this.grounded) {
      const now = performance.now() / 1000;
      if (now - this.lastSprintParticleTime > 0.18) {
        this.lastSprintParticleTime = now;
        const standingOn = this.world.getVoxel(
          Math.floor(this.position.x),
          Math.floor(this.position.y - 0.05),
          Math.floor(this.position.z)
        );
        if (standingOn !== 0) {
          const feetPos = this.position.clone();
          EventBus.emit('particles:spawn', feetPos, standingOn, 2);
        }
      }
    }
  }

  private applyCrouchState(next: boolean): void {
    if (this.isCrouching === next) return;
    this.isCrouching = next;
    this.dimensions.y = next ? 1.45 : 1.8;
    this.eyeHeight = next ? 1.27 : 1.6;
    EventBus.emit('player:crouchChanged', next);
  }


  private applySafeBridgingClamp(previousPosition: THREE.Vector3, wasGrounded: boolean): void {
    if (!this.isCrouching || this.isSubmerged || this.isFlying || this.isSpectator || !wasGrounded) return;
    // Minecraft-style sneak/edge safety: if the proposed feet position no
    // longer has support, keep the player on the last supported X/Z instead of
    // letting horizontal velocity carry them into the void.
    if (this.hasFootSupport(this.position)) return;

    const testX = new THREE.Vector3(this.position.x, this.position.y, previousPosition.z);
    const testZ = new THREE.Vector3(previousPosition.x, this.position.y, this.position.z);
    let clamped = false;
    if (!this.hasFootSupport(testX)) {
      this.position.x = previousPosition.x;
      this.velocity.x = Math.min(0, this.velocity.x) === this.velocity.x ? 0 : 0;
      clamped = true;
    }
    if (!this.hasFootSupport(testZ)) {
      this.position.z = previousPosition.z;
      this.velocity.z = 0;
      clamped = true;
    }
    if (!clamped) {
      this.position.x = previousPosition.x;
      this.position.z = previousPosition.z;
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
  }

  private hasFootSupport(pos: THREE.Vector3): boolean {
    const y = Math.floor(pos.y - 0.12);
    const halfX = this.dimensions.x * 0.45;
    const halfZ = this.dimensions.z * 0.45;
    const samples = [
      [0, 0],
      [-halfX, -halfZ], [halfX, -halfZ], [-halfX, halfZ], [halfX, halfZ],
    ];
    for (const [ox, oz] of samples) {
      const id = this.world.getVoxel(Math.floor(pos.x + ox), y, Math.floor(pos.z + oz));
      if (id !== 0 && BlockRegistry.get(id)?.isSolid) return true;
    }
    return false;
  }

  private crownForgeBlockKey(x: number, y: number, z: number): string {
    return `${this.world.currentDimension}:${x},${y},${z}`;
  }

  private isCrownForgeProtectedDimension(): boolean {
    return this.world.currentDimension === 'baseline_sandbox' || isCrownForgeDimension(this.world.currentDimension);
  }

  private registerCrownForgePlacedBlock(x: number, y: number, z: number): void {
    if (!this.isCrownForgeProtectedDimension()) return;
    PlayerController.crownForgePlayerPlacedBlocks.add(this.crownForgeBlockKey(x, y, z));
  }

  private unregisterCrownForgePlacedBlock(x: number, y: number, z: number): void {
    PlayerController.crownForgePlayerPlacedBlocks.delete(this.crownForgeBlockKey(x, y, z));
  }

  private isCrownForgeProtectedBlock(x: number, y: number, z: number): boolean {
    if (!this.isCrownForgeProtectedDimension()) return false;
    const blockId = this.world.getVoxel(x, y, z);
    if (blockId === 0) return false;

    const name = BlockRegistry.get(blockId).name || '';
    if (this.world.currentDimension === 'bedwars' && /(^| )Bed$/.test(name)) {
      return false;
    }

    return !PlayerController.crownForgePlayerPlacedBlocks.has(this.crownForgeBlockKey(x, y, z));
  }

  public takeDamage(amount: number, reason: string): void {
    if (this.gameMode === 'creative' || this.isSpectator) return;
    const result = this.combatant.damage({ amount, kind: reason });
    if (!result.accepted) return;
    if (!['void', 'starvation', 'drowning'].includes(reason)) this.damageEquippedArmor();
    EventBus.emit('player:healthChanged', this.health);
    AudioManager.playPlayerHit();

    // Spawn damage particles
    const blockCenter = this.position.clone().add(new THREE.Vector3(0, 1, 0));
    EventBus.emit('particles:spawn', blockCenter, 13, 8); // red flower particles

    if (result.killed) void this.die();
  }

  private isBlockingDamage(): boolean {
    const heldType = ItemRegistry.getToolType(this.getHeldItemId());
    return InputManager.isRightMouseDown() && (heldType === 'sword' || heldType === 'shield');
  }

  private damageEquippedArmor(): void {
    for (const slotIndex of [37, 38, 39, 40]) {
      const stack = this.inventory.getSlot(slotIndex);
      if (!stack || stack.count <= 0) continue;
      const itemDef = ItemRegistry.get(stack.id);
      if (!itemDef || itemDef.toolType !== 'armor') continue;
      const nextDurability = (stack.durability ?? itemDef.durability) - 1;
      if (nextDurability <= 0) {
        this.inventory.setSlot(slotIndex, null);
        AudioManager.playItemPickup();
        EventBus.emit('network:chat', `[System] Your ${itemDef.name} broke!`);
      } else {
        this.inventory.setSlot(slotIndex, { ...stack, durability: nextDurability });
      }
    }
  }

  private heal(amount: number): void {
    if (this.combatant.heal(amount) > 0) EventBus.emit('player:healthChanged', this.health);
  }

  public getArmorPoints(): number {
    let armorPoints = 0;
    for (let slotIndex of [37, 38, 39, 40]) {
      const stack = this.inventory.getSlot(slotIndex);
      if (stack && stack.count > 0) {
        const itemDef = ItemRegistry.get(stack.id);
        if (itemDef && itemDef.toolType === 'armor') {
          const tier = itemDef.tier;
          let points = 0;
          if (itemDef.name.endsWith('Helmet')) {
            points = tier === 4 ? 3 : tier === 2 ? 2 : tier === 1 ? 2 : tier === 3 ? 2 : 1;
          } else if (itemDef.name.endsWith('Chestplate')) {
            points = tier === 4 ? 8 : tier === 2 ? 6 : tier === 3 ? 5 : tier === 1 ? 4 : 3;
          } else if (itemDef.name.endsWith('Leggings')) {
            points = tier === 4 ? 6 : tier === 2 ? 5 : tier === 3 ? 3 : tier === 1 ? 3 : 2;
          } else if (itemDef.name.endsWith('Boots')) {
            points = tier === 4 ? 3 : tier === 2 ? 2 : tier === 1 ? 1 : tier === 3 ? 1 : 1;
          }
          armorPoints += points;
        }
      }
    }
    return armorPoints;
  }

  private async die(): Promise<void> {
    EventBus.emit('player:died', { position: this.position.clone(), reason: 'death' });
    EventBus.emit('network:chat', `[System] You died!`);
    if (this.gameMode === 'hardcore') {
      alert('HARDCORE: You died! Your world will be deleted.');
      await StorageManager.clearAll();
      window.location.reload();
    } else {
      this.isDead = true;
      this.velocity.set(0, 0, 0);

      // Show death screen
      const screen = document.getElementById('death-screen');
      if (screen) screen.style.display = 'flex';

      InputManager.isUIActive = true;
      InputManager.unlockPointer();
    }
  }

  public setSpectatorMode(spectator: boolean): void {
    this.isSpectator = spectator;
    const bottomHud = document.getElementById('bottom-hud');
    const crosshair = document.getElementById('crosshair');
    if (spectator) {
      this.isFlying = true;
      this.isDead = false;
      this.health = this.maxHealth;
      this.hunger = this.maxHunger;
      const screen = document.getElementById('death-screen');
      if (screen) screen.style.display = 'none';
      if (bottomHud) bottomHud.style.display = 'none';
      if (crosshair) crosshair.style.display = 'none';
      InputManager.isUIActive = false;
      InputManager.lockPointer();
      
      if (this.inventory) {
        this.inventory.clear();
      }
      
      EventBus.emit('player:healthChanged', this.health);
      EventBus.emit('player:hungerChanged', this.hunger);
      EventBus.emit('network:chat', `[System] You are now spectating.`);
    } else {
      this.isFlying = false;
      if (bottomHud) bottomHud.style.display = '';
      if (crosshair) crosshair.style.display = '';
    }
  }

  public respawn(): void {
    const isMinigame = this.world.currentDimension === 'skywars' || this.world.currentDimension === 'bedwars' || this.world.currentDimension === 'void_duels' || this.world.currentDimension === 'castle_siege' || this.world.currentDimension === 'survival_games' || this.world.currentDimension.startsWith('cbgo_') || this.world.currentDimension.startsWith('tf2_') || this.world.currentDimension.startsWith('cob_');
    if (isMinigame && (window as any).gameNetworkManager?.connected) {
      EventBus.emit('network:chat', `[System] Please wait for the server to respawn or transition you...`);
      return;
    }

    const screen = document.getElementById('death-screen');
    if (screen) screen.style.display = 'none';

    const spawn = defaultSpawnForDimension(this.world.currentDimension);
    this.health = 20;
    this.hunger = 20;
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.hasSetInitialSpawn = false; // Trigger Y adjustment on next chunk load
    this.isDead = false;

    InputManager.isUIActive = false;
    InputManager.lockPointer();

    StorageManager.setWorldData('player_pos', { x: spawn.x, y: spawn.y, z: spawn.z }).catch(() => {});
    EventBus.emit('player:healthChanged', this.health);
    EventBus.emit('player:hungerChanged', this.hunger);
    EventBus.emit('network:chat', `[System] Respawned!`);
  }

  private quitToTitle(): void {
    const screen = document.getElementById('death-screen');
    if (screen) screen.style.display = 'none';

    this.isDead = false;
    EventBus.emit('network:disconnect');
  }

  private getHighestSolidBlockY(x: number, z: number): number {
    for (let y = 175; y >= -64; y--) {
      const blockId = this.world.getVoxel(x, y, z);
      if (blockId !== 0) {
        const config = BlockRegistry.get(blockId);
        if (config.isSolid) {
          return y;
        }
      }
    }
    return 16;
  }

  private getCrownForgePortalCommand(): string | null {
    if (this.world.currentDimension !== 'lobby') return null;

    const portals: Array<{ command: string; x: number; z: number; radius: number }> = [
      { command: '/skywars', x: 0, z: -30, radius: 4.4 },
      { command: '/bedwars', x: 30, z: 0, radius: 4.4 },
      { command: '/castle', x: 0, z: 30, radius: 4.4 },
      { command: '/duels', x: -30, z: 0, radius: 4.4 },
      { command: '/sg', x: -30, z: -30, radius: 4.4 },
    ];

    for (const portal of portals) {
      const dx = this.position.x - portal.x;
      const dz = this.position.z - portal.z;
      if (dx * dx + dz * dz <= portal.radius * portal.radius) {
        return portal.command;
      }
    }
    return null;
  }

  private triggerPortalTransition(): void {
    const crownForgeCommand = this.getCrownForgePortalCommand();
    if (crownForgeCommand) {
      EventBus.emit('minigame:join', { command: crownForgeCommand });
      this.velocity.set(0, 0, 0);
      EventBus.emit('network:chat', `[CrownForge] Sending you to ${crownForgeCommand.slice(1)}.`);
      return;
    }

    let newDim = 'overworld';
    if (this.world.currentDimension === 'overworld') {
      newDim = 'nether';
    } else if (this.world.currentDimension === 'nether') {
      newDim = 'the_end';
    }

    this.world.setDimension(newDim);
    this.position.set(8, 24, 8);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    StorageManager.setWorldData('player_pos', { x: 8, y: 24, z: 8 });
    EventBus.emit('network:chat', `[System] Traveled to the ${newDim.toUpperCase()}!`);
  }

  /**
   * Project a 3D ray along camera direction to find target voxel
   */
  private updateTargetBlock(cameraDirection: THREE.Vector3): void {
    const eyePos = this.position.clone().add(new THREE.Vector3(0, this.eyeHeight, 0));
    
    // Fast DDA Raycast algorithm
    const maxReach = 5.0;
    const rayDir = cameraDirection.clone().normalize();

    let cx = Math.floor(eyePos.x);
    let cy = Math.floor(eyePos.y);
    let cz = Math.floor(eyePos.z);

    const stepX = rayDir.x > 0 ? 1 : -1;
    const stepY = rayDir.y > 0 ? 1 : -1;
    const stepZ = rayDir.z > 0 ? 1 : -1;

    // Delta steps
    const tDeltaX = Math.abs(1 / rayDir.x);
    const tDeltaY = Math.abs(1 / rayDir.y);
    const tDeltaZ = Math.abs(1 / rayDir.z);

    // Initial boundary t values
    let tMaxX = rayDir.x > 0 ? (cx + 1 - eyePos.x) * tDeltaX : (eyePos.x - cx) * tDeltaX;
    let tMaxY = rayDir.y > 0 ? (cy + 1 - eyePos.y) * tDeltaY : (eyePos.y - cy) * tDeltaY;
    let tMaxZ = rayDir.z > 0 ? (cz + 1 - eyePos.z) * tDeltaZ : (eyePos.z - cz) * tDeltaZ;

    let normal = new THREE.Vector3();
    let hit = false;
    let dist = 0;

    while (dist < maxReach) {
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          dist = tMaxX;
          tMaxX += tDeltaX;
          cx += stepX;
          normal.set(-stepX, 0, 0);
        } else {
          dist = tMaxZ;
          tMaxZ += tDeltaZ;
          cz += stepZ;
          normal.set(0, 0, -stepZ);
        }
      } else {
        if (tMaxY < tMaxZ) {
          dist = tMaxY;
          tMaxY += tDeltaY;
          cy += stepY;
          normal.set(0, -stepY, 0);
        } else {
          dist = tMaxZ;
          tMaxZ += tDeltaZ;
          cz += stepZ;
          normal.set(0, 0, -stepZ);
        }
      }

      const blockId = this.world.getVoxel(cx, cy, cz);
      const config = BlockRegistry.get(blockId);
      
      // Hit a non-air solid/liquid block
      if (blockId !== 0 && !config.isWater) {
        hit = true;
        break;
      }
    }

    if (hit) {
      if (this.targetBlock && (this.targetBlock.x !== cx || this.targetBlock.y !== cy || this.targetBlock.z !== cz)) {
        this.resetMining(); // switched target, reset progress
      }
      this.targetBlock = { x: cx, y: cy, z: cz, normal, blockId: this.world.getVoxel(cx, cy, cz) };
    } else {
      this.targetBlock = null;
      this.resetMining();
    }
  }

  private startMining(): void {
    if (this.targetBlock) {
      this.isMining = true;
      this.miningProgress = 0;
      this.lastMiningStage = 0;
    }
  }

  private resetMining(): void {
    const needsClear = this.lastMiningStage !== 0 || this.miningProgress !== 0;
    this.isMining = false;
    this.miningProgress = 0;
    this.lastMiningStage = 0;
    if (needsClear) EventBus.emit('mining:progress', 0);
  }

  private updateMining(dt: number): void {
    if (this.isSpectator) return;
    if (this.isMining && this.targetBlock) {
      const config = BlockRegistry.get(this.targetBlock.blockId);
      if (config.breakTime === 99.0) {
        // unbreakable
        this.resetMining();
        return;
      }

      const isProtectedCrownForgeBlock = this.isCrownForgeProtectedBlock(this.targetBlock.x, this.targetBlock.y, this.targetBlock.z);

      // Add progress
      if (this.gameMode === 'creative') {
        this.miningProgress = 1.0;
      } else {
        this.miningProgress += (dt * this.getMiningSpeedMultiplier(this.targetBlock.blockId)) / config.breakTime;
      }
      
      // Play cracking/hit sound periodically (0.22s intervals)
      const now = performance.now() / 1000;
      if (now - this.lastHitSoundTime > 0.22) {
        AudioManager.playHit(config.stepSound);
        this.lastHitSoundTime = now;

        // Spawn debris hit particles
        const blockCenter = new THREE.Vector3(this.targetBlock.x + 0.5, this.targetBlock.y + 0.5, this.targetBlock.z + 0.5);
        EventBus.emit('particles:spawn', blockCenter, this.targetBlock.blockId, 4);
      }

      // Sync visual crack overlays (values 1 to 6)
      const stage = Math.min(6, Math.ceil(this.miningProgress * 6));
      if (stage !== this.lastMiningStage) {
        this.lastMiningStage = stage;
        EventBus.emit('mining:progress', stage);
      }

      if (this.miningProgress >= 1.0) {
        // Mine successful!
        const tx = this.targetBlock.x;
        const ty = this.targetBlock.y;
        const tz = this.targetBlock.z;
        const blockId = this.targetBlock.blockId;

        if (isProtectedCrownForgeBlock) {
          AudioManager.playHit(config.stepSound);
          const nowMs = performance.now();
          if (nowMs - this.lastProtectedBlockWarnAt > 1600) {
            this.lastProtectedBlockWarnAt = nowMs;
            EventBus.emit('network:chat', this.world.currentDimension === 'backrooms'
              ? '[Backrooms] The walls refuse to break.'
              : '[CrownForge] Protected arena blocks crack, but only player-placed blocks can be removed.');
          }
          this.resetMining();
          return;
        }

        // Clear voxel
        this.world.setVoxel(tx, ty, tz, 0);
        this.unregisterCrownForgePlacedBlock(tx, ty, tz);
        AudioManager.playBreak(config.stepSound);

        // Spawn final explosion debris particles
        const blockCenter = new THREE.Vector3(tx + 0.5, ty + 0.5, tz + 0.5);
        EventBus.emit('particles:spawn', blockCenter, blockId, 16);

        const dropId = this.getBlockDrop(blockId);
        const networkConnected = Boolean((window as any).gameNetworkManager?.connected);
        const chunkReady = this.world.isColumnReady(blockCenter);
        if (this.gameMode !== 'creative' && !networkConnected && chunkReady && dropId !== 0 && this.canHarvestBlock(blockId)) {
          EventBus.emit('item:spawn', blockCenter, dropId);
        }

        if (this.gameMode !== 'creative') {
          const activeSlot = this.inventory.getActiveSlotIndex();
          const stack = this.inventory.getSlot(activeSlot);
          if (stack && ItemRegistry.isTool(stack.id)) {
            const def = ItemRegistry.get(stack.id);
            if (def && def.durability > 0) {
              if (stack.durability === undefined) {
                stack.durability = def.durability;
              }
              stack.durability--;
              if (stack.durability <= 0) {
                this.inventory.setSlot(activeSlot, null);
                AudioManager.playToolBreak();
                EventBus.emit('network:chat', `[System] Your ${def.name} broke!`);
              } else {
                this.inventory.saveToStorage();
              }
            }
          }
        }

        this.resetMining();
      }
    }
  }

  private placeBlock(): void {
    if (!this.targetBlock) return;

    // Target place location
    const px = this.targetBlock.x + this.targetBlock.normal.x;
    const py = this.targetBlock.y + this.targetBlock.normal.y;
    const pz = this.targetBlock.z + this.targetBlock.normal.z;

    // Get held block item ID
    const activeSlot = this.inventory.getActiveSlotIndex();
    const stack = this.inventory.getSlot(activeSlot);
    if (!stack || stack.count <= 0) return;

    const blockIdToPlace = stack.id;
    if (!ItemRegistry.isPlaceableItem(blockIdToPlace) || !BlockRegistry.isPlaceableBlock(blockIdToPlace)) return;
    const config = BlockRegistry.get(blockIdToPlace);

    // Prevent placing blocks inside the player's own body AABB
    if (config.isSolid) {
      const blockAABB = new AABB(
        new THREE.Vector3(px, py, pz),
        new THREE.Vector3(px + 1, py + 1, pz + 1)
      );

      const halfW = this.dimensions.x / 2;
      const halfD = this.dimensions.z / 2;
      const playerAABB = new AABB(
        new THREE.Vector3(this.position.x - halfW, this.position.y, this.position.z - halfD),
        new THREE.Vector3(this.position.x + halfW, this.position.y + this.dimensions.y, this.position.z + halfD)
      );

      if (playerAABB.intersects(blockAABB)) {
        return; // Collides with player body, cancel
      }
    }

    // Set voxel
    this.world.setVoxel(px, py, pz, blockIdToPlace);
    this.registerCrownForgePlacedBlock(px, py, pz);
    AudioManager.playPlace(config.stepSound);

    // Immediate gravity check
    this.world.checkBlockGravity(px, py, pz);

    // Golem spawning check
    this.checkGolemSpawning(px, py, pz, blockIdToPlace);

    // Consume inventory item if not in creative mode
    if (this.gameMode !== 'creative') {
      this.inventory.removeItemFromSlot(activeSlot, 1);
    }
  }

  private tryMeleeAttack(): void {
    // Extra guard: if a shop villager is under the crosshair, never route this
    // click into combat. This keeps villagers immortal even under rapid clicking.
    if (this.getTargetShopMob(7.0)) return;
    const activeSlot = this.inventory.getActiveSlotIndex();
    const stack = this.inventory.getSlot(activeSlot);
    let damage = stack ? ItemRegistry.getAttackDamage(stack.id) : 1;
    if (this.activeEffects.has('strength')) {
      damage += 3;
    }
    EventBus.emit('player:attack', { damage, range: 2.5 });
  }

  private tryOpenTargetShop(): boolean {
    const activeSlot = this.inventory.getActiveSlotIndex();
    const stack = this.inventory.getSlot(activeSlot);
    const targetShopMob = this.getTargetShopMob(9.5);
    return !!(targetShopMob && this.interactWithMob(targetShopMob, activeSlot, stack?.id ?? 0));
  }

  private useHeldItemOrPlaceBlock(): void {
    const activeSlot = this.inventory.getActiveSlotIndex();
    const stack = this.inventory.getSlot(activeSlot);

    if (this.tryOpenTargetShop()) {
      return;
    }

    const targetMob = this.getTargetMob();
    if (targetMob && this.interactWithMob(targetMob, activeSlot, stack?.id ?? 0)) {
      return;
    }

    if (stack && stack.id === getFeatureItemId('CrownForge Navigator')) {
      EventBus.emit('ui:openMinigameMenu');
      return;
    }

    if (stack && stack.id === 270) {
      const arrowSlot = this.findArrowInInventory();
      if (arrowSlot !== -1 || this.gameMode === 'creative') {
        this.isDrawingBow = true;
        this.bowDrawTime = 0;
        EventBus.emit('network:chat', `[System] Drawing bow...`);
        AudioManager.playBowDraw();
      } else {
        EventBus.emit('network:chat', `[System] You have no Arrows!`);
      }
      return;
    }

    if (this.targetBlock) {
      const blockId = this.targetBlock.blockId;
      const blockName = BlockRegistry.get(blockId).name;
      if (blockName === 'Bed') {
        const dim = this.world.currentDimension;
        if (dim === 'nether' || dim === 'the_end') {
          const pos = new THREE.Vector3(this.targetBlock.x + 0.5, this.targetBlock.y + 0.5, this.targetBlock.z + 0.5);
          EventBus.emit('mob:explode', { pos, radius: 5, damage: 12 });
          this.world.setVoxel(this.targetBlock.x, this.targetBlock.y, this.targetBlock.z, 0);
          EventBus.emit('network:chat', `[System] You cannot sleep in this dimension! The Bed exploded!`);
          return;
        } else {
          EventBus.emit('network:chat', `[System] Spawn point set.`);
          const sky = (window as any).gameSkySystem;
          if (sky && typeof sky.setTime === 'function') {
            sky.setTime(0.3);
            EventBus.emit('network:chat', `[System] Slept through the night.`);
          }
          return;
        }
      }
    }

    if (this.targetBlock && !InputManager.isActionDown('crouch')) {
      const config = BlockRegistry.get(this.targetBlock.blockId);
      if (config.isInteractable) {
        if (this.world.redstoneSystem.onInteract(this.targetBlock.x, this.targetBlock.y, this.targetBlock.z)) {
          return;
        }
        const obeliskId = getFeatureBlockId('Ancient Obelisk');
        if (obeliskId && this.targetBlock.blockId === obeliskId) {
          this.triggerObeliskInteraction();
          return;
        }
        if (this.targetBlock.blockId === 22) { // Crafting Table
          EventBus.emit('ui:openCraftingTable');
          return;
        }
        if (this.targetBlock.blockId === 23) { // Chest
          EventBus.emit('ui:openChest', { x: this.targetBlock.x, y: this.targetBlock.y, z: this.targetBlock.z });
          return;
        }
        const bName = config.name || "";
        if (this.targetBlock.blockId === 24 || this.targetBlock.blockId === 25 || bName.includes("Blast Furnace") || bName.includes("Smoker")) {
          let type = 'furnace';
          if (bName.includes("Blast Furnace")) type = 'blast-furnace';
          else if (bName.includes("Smoker")) type = 'smoker';
          EventBus.emit('ui:openFurnace', { x: this.targetBlock.x, y: this.targetBlock.y, z: this.targetBlock.z, type });
          return;
        }
        
        const brewingStandId = getFeatureBlockId('Brewing Stand');
        const enchantingTableId = getFeatureBlockId('Enchanting Table');
        const anvilId = getFeatureBlockId('Anvil');
        const stonecutterId = getFeatureBlockId('Stonecutter');
        const loomId = getFeatureBlockId('Loom');
        const lecternId = getFeatureBlockId('Lectern');
        
        if (this.targetBlock.blockId === brewingStandId) {
          EventBus.emit('ui:openBrewingStand', { x: this.targetBlock.x, y: this.targetBlock.y, z: this.targetBlock.z });
          return;
        }
        if (this.targetBlock.blockId === enchantingTableId) {
          EventBus.emit('ui:openEnchantingTable');
          return;
        }
        if (this.targetBlock.blockId === anvilId) {
          EventBus.emit('ui:openAnvil');
          return;
        }
        if (stonecutterId && this.targetBlock.blockId === stonecutterId) {
          EventBus.emit('ui:openStonecutter');
          return;
        }
        if (loomId && this.targetBlock.blockId === loomId) {
          EventBus.emit('ui:openLoom');
          return;
        }
        if (lecternId && this.targetBlock.blockId === lecternId) {
          EventBus.emit('ui:openLectern', { x: this.targetBlock.x, y: this.targetBlock.y, z: this.targetBlock.z });
          return;
        }
        
        const jukeboxId = getFeatureBlockId('Jukebox');
        if (jukeboxId && this.targetBlock.blockId === jukeboxId) {
          if (stack && ItemRegistry.getName(stack.id)?.includes('Music Disc')) {
            const name = ItemRegistry.getName(stack.id);
            EventBus.emit('network:chat', `* Now playing: ${name} *`);
            AudioManager.playMusicDisc(name);
            this.inventory.removeItemFromSlot(this.inventory.getActiveSlotIndex(), 1);
          } else {
            EventBus.emit('network:chat', `* Music Disc stopped *`);
            AudioManager.stopMusicDisc();
          }
          return;
        }
      }
    }

    if (stack && stack.id === 416) { // Splash Potion
      const effect = stack.potionEffect;
      if (effect) {
        const dir = new THREE.Vector3();
        (window as any).gameCameraController?.getDirection?.(dir);
        const pos = this.position.clone().add(new THREE.Vector3(0, this.eyeHeight, 0));
        
        if (effect === 'healing') {
          this.health = Math.min(this.maxHealth, this.health + 6);
          EventBus.emit('player:healthChanged', this.health);
          EventBus.emit('network:chat', `[System] Restored 6 Health!`);
        } else {
          this.activeEffects.set(effect, 120.0);
          EventBus.emit('network:chat', `[System] Gained effect: ${effect.toUpperCase()} for 120s`);
        }
        EventBus.emit('particles:spawn', pos.clone().add(dir.multiplyScalar(2)), 13, 20);
        
        const em = (window as any).gameEntityManager;
        if (em && typeof em.damageMob === 'function') {
          if (effect === 'harming' || effect === 'poison' || effect === 'wither') {
            if (em.mobs && Array.isArray(em.mobs)) {
              for (const mob of em.mobs) {
                if (mob && mob.position) {
                  const dist = pos.distanceTo(mob.position);
                  if (dist < 6.0) {
                    const dmg = effect === 'harming' ? 6 : 2;
                    em.damageMob(mob.id, dmg);
                  }
                }
              }
            }
          }
        }
      }
      this.inventory.removeItemFromSlot(activeSlot, 1);
      AudioManager.playBowRelease();
      return;
    }

    if (stack && this.tryUseContextAction(activeSlot, stack.id)) {
      return;
    }

    if (stack && !BlockRegistry.isPlaceableBlock(stack.id)) {
      this.useHeldItem(activeSlot, stack.id);
      return;
    }

    this.placeBlock();
  }

  private triggerObeliskInteraction(): void {
    const quotes = [
      "The Elden Ring was shattered... in our home, across the Fog.",
      "O, Death... Become my blade once more.",
      "The Golden Order is broken to its core. The Tarnished shall rise.",
      "Fallen leaves tell a story of how a Lord became a wretch.",
      "Great ruins of a forgotten empire... the stones whisper of a giant crown.",
      "I am Malenia, Blade of Miquella. And I have never known defeat.",
      "Tarnished, seek the shards of the shattered crown to restore the golden order.",
      "Hear me, Demigods. I shall carve a path of ruin to the Erdtree.",
      "A run-down empire, left in dust. The Grace of gold has long departed.",
      "The shadow of the Erdtree looms over these decaying castle walls."
    ];
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    EventBus.emit('network:chat', `* Ancient Obelisk: "${quote}" *`);
    AudioManager.playLevelUp();
  }

  private releaseHeldItem(): void {
    if (this.isDrawingBow) {
      const activeSlot = this.inventory.getActiveSlotIndex();
      const stack = this.inventory.getSlot(activeSlot);
      if (stack && stack.id === 270) {
        const arrowSlot = this.findArrowInInventory();
        if (arrowSlot !== -1 || this.gameMode === 'creative') {
          let isSpectral = false;
          if (arrowSlot !== -1) {
            const arrowStack = this.inventory.getSlot(arrowSlot);
            if (arrowStack && arrowStack.id === 215) {
              isSpectral = true;
            }
          }

          if (this.gameMode !== 'creative') {
            this.inventory.removeItemFromSlot(arrowSlot, 1);
            if (stack.durability === undefined) {
              stack.durability = 384;
            }
            stack.durability--;
            if (stack.durability <= 0) {
              this.inventory.setSlot(activeSlot, null);
              AudioManager.playToolBreak();
              EventBus.emit('network:chat', `[System] Your Bow broke!`);
            } else {
              this.inventory.saveToStorage();
            }
          }

          const power = Math.max(0.1, Math.min(1.0, this.bowDrawTime / 1.0));
          const damage = Math.ceil(power * 6 + 2);

          const dir = new THREE.Vector3();
          (window as any).gameCameraController?.getDirection?.(dir);
          const pos = this.position.clone().add(new THREE.Vector3(0, this.eyeHeight, 0));
          
          EventBus.emit('player:shootArrow', { pos, dir, damage, isSpectral });
          AudioManager.playBowRelease();
        } else {
          EventBus.emit('network:chat', `[System] You have no Arrows!`);
        }
      }
      this.isDrawingBow = false;
      this.bowDrawTime = 0;
    }
  }

  private findArrowInInventory(): number {
    for (let i = 0; i < 36; i++) {
      const slot = this.inventory.getSlot(i);
      if (slot && (slot.id === 211 || slot.id === 215) && slot.count > 0) {
        return i;
      }
    }
    return -1;
  }

  private useHeldItem(slot: number, itemId: number): void {
    const itemName = ItemRegistry.getName(itemId);
    const isPotion = itemId === 415 || itemId === 416 || itemId === 417 || itemName.endsWith(' Potion');
    const isMilk = itemId === getFeatureItemId('Milk Bucket');

    if (isPotion) {
      const stack = this.inventory.getSlot(slot);
      let effect = stack?.potionEffect;
      if (!effect && stack) {
        const name = ItemRegistry.getName(stack.id);
        if (name.endsWith(' Potion')) {
          const prefix = name.substring(0, name.length - 7).toLowerCase().replace(' ', '_');
          if (prefix === 'swiftness') effect = 'speed';
          else if (prefix === 'fire_guard') effect = 'fire_resistance';
          else if (prefix === 'leaping') effect = 'jump_boost';
          else effect = prefix;
        }
      }
      if (effect && effect !== 'water' && effect !== 'awkward') {
        if (effect === 'healing') {
          this.health = Math.min(this.maxHealth, this.health + 6);
          EventBus.emit('player:healthChanged', this.health);
          EventBus.emit('network:chat', `[System] Restored 6 Health!`);
        } else {
          this.activeEffects.set(effect, 180.0);
          EventBus.emit('network:chat', `[System] Gained effect: ${effect.toUpperCase()} for 180s`);
        }
      }
      const bottleId = getFeatureItemId('Glass Bottle');
      this.replaceOneHeldItem(slot, bottleId);
      AudioManager.playItemPickup();
      return;
    }

    if (isMilk) {
      this.activeEffects.clear();
      const bucketId = getFeatureItemId('Bucket');
      this.replaceOneHeldItem(slot, bucketId);
      AudioManager.playItemPickup();
      EventBus.emit('network:chat', `[System] Drank milk, cleared all status effects!`);
      return;
    }

    if (ItemRegistry.isFood(itemId) && this.hunger < this.maxHunger) {
      const restored = ItemRegistry.getFoodRestored(itemId);
      this.hunger = Math.min(this.maxHunger, this.hunger + restored);
      if (itemId === 280) { // Apple
        this.health = Math.min(this.maxHealth, this.health + 1);
      } else if (itemId === 285) { // Golden Apple
        this.health = Math.min(this.maxHealth, this.health + 4);
      } else if (itemId === getFeatureItemId('Golden Carrot')) {
        this.health = Math.min(this.maxHealth, this.health + 2);
      } else if (itemId === getFeatureItemId('Honey Bottle')) {
        this.inventory.addItem(getFeatureItemId('Glass Bottle'), 1);
      }
      this.inventory.removeItemFromSlot(slot, 1);
      EventBus.emit('player:hungerChanged', this.hunger);
      EventBus.emit('player:healthChanged', this.health);
      AudioManager.playItemPickup();
    }
  }

  private updateEffects(dt: number): void {
    if (this.gameMode === 'creative') {
      if (this.activeEffects.size > 0) this.activeEffects.clear();
      return;
    }
    this.activeEffects.update(dt);
  }

  public getHeldItemId(): number {
    const stack = this.inventory.getSlot(this.inventory.getActiveSlotIndex());
    return stack ? stack.id : 0;
  }

  public addXp(amount: number): void {
    this.xp += amount;
    let xpNeeded = 100 + this.level * 50;
    let leveledUp = false;
    while (this.xp >= xpNeeded) {
      this.xp -= xpNeeded;
      this.level++;
      xpNeeded = 100 + this.level * 50;
      leveledUp = true;
    }
    if (leveledUp) {
      AudioManager.playLevelUp();
    }
    EventBus.emit('player:xpChanged', { xp: this.xp, level: this.level, max: xpNeeded });
  }

  private getMiningSpeedMultiplier(blockId: number): number {
    const held = this.getHeldItemId();
    const item = ItemRegistry.get(held);
    const block = BlockRegistry.get(blockId);

    let baseSpeed = 1.0;
    if (item) {
      baseSpeed = item.miningSpeed;
    }

    if (block.requiresTool) {
      if (item && item.toolType === block.requiresTool) {
        return baseSpeed;
      } else {
        return 0.3; // Very slow with wrong tool
      }
    }

    return baseSpeed;
  }

  private canHarvestBlock(blockId: number): boolean {
    const block = BlockRegistry.get(blockId);
    if (!block.requiresTool) return true;

    if (block.requiresTool === 'pickaxe') {
      const held = this.getHeldItemId();
      const item = ItemRegistry.get(held);
      if (!item || item.toolType !== 'pickaxe') return false;
      const minTier = block.minTier ?? 0;
      return item.tier >= minTier;
    }

    return true;
  }

  private requiresPickaxe(blockId: number): boolean {
    return BlockRegistry.get(blockId).requiresTool === 'pickaxe';
  }

  private tryUseContextAction(slot: number, itemId: number): boolean {
    if (this.tryUseBucket(slot, itemId)) return true;
    if (this.tryUseIgniter(slot, itemId)) return true;
    if (this.tryTillSoil(slot, itemId)) return true;
    if (this.tryPlantHeldItem(slot, itemId)) return true;
    if (this.tryFertilize(slot, itemId)) return true;
    if (this.tryWaxCopper(slot, itemId)) return true;
    return false;
  }

  private tryUseBucket(slot: number, itemId: number): boolean {
    if (!this.targetBlock) return false;

    const bucketId = getFeatureItemId('Bucket');
    const waterBucketId = getFeatureItemId('Water Bucket');
    const lavaBucketId = getFeatureItemId('Lava Bucket');
    if (!bucketId || !waterBucketId || !lavaBucketId) return false;

    const target = this.targetBlock;
    if (itemId === bucketId) {
      if (target.blockId !== 7 && target.blockId !== 37) return false;
      this.world.setVoxel(target.x, target.y, target.z, 0);
      this.replaceOneHeldItem(slot, target.blockId === 37 ? lavaBucketId : waterBucketId);
      AudioManager.playItemPickup();
      return true;
    }

    if (itemId !== waterBucketId && itemId !== lavaBucketId) return false;
    const px = target.x + target.normal.x;
    const py = target.y + target.normal.y;
    const pz = target.z + target.normal.z;
    const targetBlockId = this.world.getVoxel(px, py, pz);
    const isReplaceable = targetBlockId === 0 ||
      (targetBlockId >= 2001 && targetBlockId <= 2007) ||
      (targetBlockId >= 2011 && targetBlockId <= 2013) ||
      BlockRegistry.get(targetBlockId).isFoliage;
    if (!isReplaceable) return false;

    this.world.setVoxel(px, py, pz, itemId === lavaBucketId ? 37 : 7);
    this.replaceOneHeldItem(slot, bucketId);
    AudioManager.playPlace(itemId === lavaBucketId ? 'stone' : 'water');
    return true;
  }

  private tryUseIgniter(slot: number, itemId: number): boolean {
    if (!this.targetBlock) return false;

    const flintAndSteelId = getFeatureItemId('Flint and Steel');
    const fireChargeId = getFeatureItemId('Fire Charge');
    if (itemId !== flintAndSteelId && itemId !== fireChargeId) return false;

    const target = this.targetBlock;
    const tntId = getFeatureBlockId('TNT');
    if (target.blockId === tntId) {
      const center = new THREE.Vector3(target.x + 0.5, target.y + 0.5, target.z + 0.5);
      this.world.setVoxel(target.x, target.y, target.z, 0);
      EventBus.emit('mob:explode', { pos: center, radius: 4, damage: 6 });
      if (itemId === fireChargeId) this.inventory.removeItemFromSlot(slot, 1);
      else this.damageHeldTool(slot, 1);
      AudioManager.playBreak('stone');
      return true;
    }

    if (target.blockId === 28) {
      const px = target.x + target.normal.x;
      const py = target.y + target.normal.y;
      const pz = target.z + target.normal.z;
      if (this.world.getVoxel(px, py, pz) === 0) {
        this.world.setVoxel(px, py, pz, 29);
        if (itemId === fireChargeId) this.inventory.removeItemFromSlot(slot, 1);
        else this.damageHeldTool(slot, 1);
        EventBus.emit('network:chat', '[Portal] Portal field opened.');
        AudioManager.playPlace('stone');
        return true;
      }
    }

    return false;
  }

  private tryTillSoil(slot: number, itemId: number): boolean {
    if (!this.targetBlock || ItemRegistry.getToolType(itemId) !== 'hoe') return false;

    const farmlandId = getFeatureBlockId('Farmland');
    if (!farmlandId) return false;

    const tillable = new Set([
      1,
      2,
      getFeatureBlockId('Coarse Dirt'),
      getFeatureBlockId('Rooted Dirt'),
      getFeatureBlockId('Podzol'),
    ].filter(Boolean));

    if (!tillable.has(this.targetBlock.blockId)) return false;
    const above = this.world.getVoxel(this.targetBlock.x, this.targetBlock.y + 1, this.targetBlock.z);
    if (above !== 0) return false;

    this.world.setVoxel(this.targetBlock.x, this.targetBlock.y, this.targetBlock.z, farmlandId);
    this.damageHeldTool(slot, 1);
    AudioManager.playPlace('sand');
    return true;
  }

  private tryPlantHeldItem(slot: number, itemId: number): boolean {
    if (!this.targetBlock) return false;

    const plantable = getPlantableItem(itemId);
    if (!plantable) return false;
    if (!plantable.soilIds.includes(this.targetBlock.blockId)) return false;

    const px = this.targetBlock.x;
    const py = this.targetBlock.y + 1;
    const pz = this.targetBlock.z;
    if (this.world.getVoxel(px, py, pz) !== 0) return false;

    this.world.setVoxel(px, py, pz, plantable.blockId);
    if (this.gameMode !== 'creative') {
      this.inventory.removeItemFromSlot(slot, 1);
    }
    AudioManager.playPlace('grass');
    return true;
  }

  private tryFertilize(slot: number, itemId: number): boolean {
    if (!this.targetBlock || itemId !== 208) return false; // Bone acts as bone meal

    const targetX = this.targetBlock.x;
    const targetY = this.targetBlock.y;
    const targetZ = this.targetBlock.z;
    let targetId = this.targetBlock.blockId;

    let fertilizeX = targetX;
    let fertilizeY = targetY;
    let fertilizeZ = targetZ;
    let fertilizeId = targetId;

    const blockAbove = this.world.getVoxel(targetX, targetY + 1, targetZ);
    const aboveCfg = BlockRegistry.get(blockAbove);
    const aboveName = aboveCfg.name || "";
    const targetName = BlockRegistry.get(targetId).name || "";

    if ((targetName.includes("Farmland") || targetId === 1 || targetId === 2) && 
        (aboveName.includes("Crop") || aboveName.includes("Bush") || aboveName.includes("Sapling"))) {
      fertilizeX = targetX;
      fertilizeY = targetY + 1;
      fertilizeZ = targetZ;
      fertilizeId = blockAbove;
    }

    const fertilizeCfg = BlockRegistry.get(fertilizeId);
    const fertName = fertilizeCfg.name || "";

    if (fertName.includes("Sapling")) {
      this.world.growTreeInWorld(fertilizeX, fertilizeY, fertilizeZ, fertilizeId);
      if (this.gameMode !== 'creative') {
        this.inventory.removeItemFromSlot(slot, 1);
      }
      AudioManager.playPlace('grass');
      return true;
    }

    let cropType = "";
    let stage = -1;
    if (fertName.includes("Wheat Crops")) {
      cropType = "Wheat";
      const match = fertName.match(/Stage\s*([0-7])/i);
      stage = match ? parseInt(match[1]) : 0;
    } else if (fertName.includes("Carrot Crops")) {
      cropType = "Carrot";
      const match = fertName.match(/Stage\s*([0-7])/i);
      stage = match ? parseInt(match[1]) : 0;
    } else if (fertName.includes("Potato Crops")) {
      cropType = "Potato";
      const match = fertName.match(/Stage\s*([0-7])/i);
      stage = match ? parseInt(match[1]) : 0;
    } else if (fertName.includes("Beetroot Crops")) {
      cropType = "Beetroot";
      const match = fertName.match(/Stage\s*([0-7])/i);
      stage = match ? parseInt(match[1]) : 0;
    } else if (fertName.includes("Berry Bush")) {
      cropType = "Berry";
      const match = fertName.match(/Stage\s*([0-7])/i);
      stage = match ? parseInt(match[1]) : 0;
    }

    if (cropType !== "" && stage < 7) {
      const nextStage = Math.min(7, stage + 1 + Math.floor(Math.random() * 3));
      const nextStageName = cropType === "Berry" 
        ? `Berry Bush Stage ${nextStage}`
        : `${cropType} Crops Stage ${nextStage}`;
      const nextStageId = getFeatureBlockId(nextStageName);
      if (nextStageId !== 0) {
        this.world.setVoxel(fertilizeX, fertilizeY, fertilizeZ, nextStageId, true);
        if (this.gameMode !== 'creative') {
          this.inventory.removeItemFromSlot(slot, 1);
        }
        AudioManager.playPlace('grass');
        return true;
      }
    }

    if (fertilizeId === 1) { // Grass Block
      let success = false;
      const radius = 2;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > 3) continue;
          const gx = fertilizeX + dx;
          const gz = fertilizeZ + dz;
          for (let dy = -1; dy <= 1; dy++) {
            const gy = fertilizeY + dy;
            if (this.world.getVoxel(gx, gy, gz) === 1 && this.world.getVoxel(gx, gy + 1, gz) === 0) {
              if (Math.random() < 0.45) {
                const roll = Math.random();
                let spawnId = 12; // Tall grass
                if (roll < 0.15) spawnId = 13; // Red flower
                else if (roll < 0.3) spawnId = 14; // Yellow flower
                
                this.world.setVoxel(gx, gy + 1, gz, spawnId, true);
                success = true;
              }
            }
          }
        }
      }
      if (success) {
        if (this.gameMode !== 'creative') {
          this.inventory.removeItemFromSlot(slot, 1);
        }
        AudioManager.playPlace('grass');
        return true;
      }
    }

    return false;
  }

  private replaceOneHeldItem(slot: number, replacementId: number): void {
    if (this.gameMode === 'creative') return;

    const stack = this.inventory.getSlot(slot);
    if (!stack) return;

    if (stack.count <= 1) {
      this.inventory.setSlot(slot, { id: replacementId, count: 1 });
    } else {
      this.inventory.removeItemFromSlot(slot, 1);
      this.inventory.addItem(replacementId, 1);
    }
  }

  private damageHeldTool(slot: number, amount: number): void {
    if (this.gameMode === 'creative') return;

    const stack = this.inventory.getSlot(slot);
    if (!stack) return;
    const def = ItemRegistry.get(stack.id);
    if (!def || def.durability <= 0) return;

    if (stack.durability === undefined) {
      stack.durability = def.durability;
    }
    stack.durability -= amount;
    if (stack.durability <= 0) {
      this.inventory.setSlot(slot, null);
      AudioManager.playToolBreak();
      EventBus.emit('network:chat', `[System] Your ${def.name} broke!`);
    } else {
      this.inventory.saveToStorage();
    }
  }

  private getBlockDrop(blockId: number): number {
    const block = BlockRegistry.get(blockId);
    const name = block.name || "";
    
    // Dynamic crop drops based on growth stage
    if (name.includes('Crops') || name.includes('Bush') || name.includes('Wheat') || name.includes('Carrot') || name.includes('Potato') || name.includes('Beetroot')) {
      let cropType = "";
      let stage = 0;
      const match = name.match(/Stage\s*([0-7])/i);
      stage = match ? parseInt(match[1]) : 0;
      
      if (name.includes('Wheat')) cropType = 'wheat';
      else if (name.includes('Carrot')) cropType = 'carrot';
      else if (name.includes('Potato')) cropType = 'potato';
      else if (name.includes('Beetroot')) cropType = 'beetroot';
      else if (name.includes('Berry')) cropType = 'berry';
      
      if (cropType !== "") {
        const seedId = cropType === 'wheat' ? 433 : cropType === 'carrot' ? 434 : cropType === 'potato' ? 435 : cropType === 'beetroot' ? 436 : 440;
        const harvestId = cropType === 'wheat' ? 33 : seedId; // Wheat harvest block ID is 33
        
        if (stage < 7) {
          return seedId; // immature drops 1 seed/crop
        } else {
          // mature drops: spawn extra seeds/harvests
          const extraCount = Math.floor(Math.random() * 3) + 1; // 1 to 3 extra
          const bx = this.targetBlock ? this.targetBlock.x : this.position.x;
          const by = this.targetBlock ? this.targetBlock.y : this.position.y;
          const bz = this.targetBlock ? this.targetBlock.z : this.position.z;
          const blockCenter = new THREE.Vector3(bx + 0.5, by + 0.5, bz + 0.5);
          for (let i = 0; i < extraCount; i++) {
            EventBus.emit('item:spawn', blockCenter, seedId);
          }
          return harvestId;
        }
      }
    }

    if (block.drops !== undefined) {
      if (block.drops === null) return 0;
      if (Array.isArray(block.drops)) {
        return block.drops[Math.floor(Math.random() * block.drops.length)];
      }
      return block.drops;
    }
    
    if (blockId === 5) {
      const roll = Math.random();
      if (roll < 0.18) return 200; // new Stick
      if (roll < 0.23) return 280; // new Apple
      return 0;
    }

    if (blockId === 12) {
      const roll = Math.random();
      if (roll < 0.18) return getFeatureItemId('Wheat Seeds');
      if (roll < 0.24) return getFeatureItemId('Sweet Berries');
      return 0;
    }

    return blockId;
  }

  private getTargetMob(range: number = 3.5): MobEntity | null {
    const em = (window as any).gameEntityManager;
    if (!em || !em.localMobs) return null;

    const cameraDir = new THREE.Vector3();
    (window as any).gameCameraController?.getDirection?.(cameraDir);
    if (cameraDir.lengthSq() < 0.001) return null;
    cameraDir.normalize();

    const eyePos = this.position.clone().add(new THREE.Vector3(0, this.eyeHeight, 0));
    
    let closest: MobEntity | null = null;
    let minScore = Number.POSITIVE_INFINITY;

    for (const mob of em.localMobs) {
      if (mob.isDead) continue;
      const mobCenter = mob.position.clone().add(new THREE.Vector3(0, mob.dimensions.y * 0.55, 0));
      const toMob = mobCenter.clone().sub(eyePos);
      const proj = toMob.dot(cameraDir);
      const maxRange = (mob as any).staticShop ? Math.max(range, 5.75) : range;
      
      if (proj > 0 && proj < maxRange) {
        const perpDistSq = Math.max(0, toMob.lengthSq() - proj * proj);
        const hitRadius = (mob as any).staticShop
          ? Math.max(1.35, Math.max(mob.dimensions.x, mob.dimensions.z) * 1.85)
          : Math.max(0.75, Math.max(mob.dimensions.x, mob.dimensions.z) * 1.15);
        const score = proj + perpDistSq * 1.75;
        if (perpDistSq <= hitRadius * hitRadius && score < minScore) {
          minScore = score;
          closest = mob;
        }
      }
    }
    return closest;
  }

  private isBedWarsDimension(): boolean {
    return String((this.world as any).currentDimension || '').toLowerCase() === 'bedwars';
  }

  private annotateBedWarsShopMob(mob: MobEntity): boolean {
    if ((mob as any).staticShop || (mob as any).shopKind) return true;
    if (!this.isBedWarsDimension() || mob.mobType !== 'villager') return false;

    let best: any = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (const npc of CROWNFORGE_BEDWARS_SHOP_NPCS) {
      const dx = mob.position.x - npc.x;
      const dy = mob.position.y - npc.y;
      const dz = mob.position.z - npc.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = npc;
      }
    }

    // Server or remote snapshots can recreate the villager without custom shop
    // fields. Position-snapping it to the authored BedWars shop marker makes the
    // interaction reliable for every client, even after mob snapshots resync.
    if (!best || bestDistSq > 16) return false;
    (mob as any).staticShop = true;
    (mob as any).shopTeam = best.team;
    (mob as any).shopKind = best.kind;
    (mob as any).displayName = best.kind === 'itemShop' ? `${best.team} Item Shop` : `${best.team} Team Upgrades`;
    mob.aiState = 'shop';
    mob.velocity.set(0, 0, 0);
    mob.health = mob.maxHealth;
    mob.isDead = false;
    return true;
  }

  private getTargetShopMob(range: number = 8.5): MobEntity | null {
    const em = (window as any).gameEntityManager;
    if (!em || !em.localMobs) return null;

    const cameraDir = new THREE.Vector3();
    (window as any).gameCameraController?.getDirection?.(cameraDir);
    if (cameraDir.lengthSq() < 0.001) return null;
    cameraDir.normalize();

    const eyePos = this.position.clone().add(new THREE.Vector3(0, this.eyeHeight, 0));
    let best: MobEntity | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const mob of em.localMobs as MobEntity[]) {
      if (mob.isDead) continue;
      if (!this.annotateBedWarsShopMob(mob)) continue;
      const center = mob.position.clone().add(new THREE.Vector3(0, mob.dimensions.y * 0.58, 0));
      const toMob = center.sub(eyePos);
      const distance = toMob.length();
      if (distance > range) continue;

      const forwardAmount = toMob.dot(cameraDir);
      if (forwardAmount <= -0.45 && distance > 2.6) continue;
      const perpSq = Math.max(0, toMob.lengthSq() - forwardAmount * forwardAmount);
      const closeInteract = distance <= 4.25 && forwardAmount / Math.max(distance, 0.001) > -0.1;
      const aimedInteract = forwardAmount > 0 && perpSq <= 3.35 * 3.35;
      if (!closeInteract && !aimedInteract) continue;

      const score = distance + perpSq * 0.45 - (closeInteract ? 2.0 : 0.0);
      if (score < bestScore) {
        bestScore = score;
        best = mob;
      }
    }
    return best;
  }

  private interactWithMob(mob: MobEntity, slot: number, itemId: number): boolean {
    if ((mob as any).staticShop || (mob as any).shopTeam || this.annotateBedWarsShopMob(mob)) {
      mob.health = mob.maxHealth;
      mob.isDead = false;
      EventBus.emit('ui:openBedWarsShop', { team: (mob as any).shopTeam || 'Red', villagerId: mob.id, kind: (mob as any).shopKind || 'itemShop' });
      AudioManager.playVillagerSound('idle');
      return true;
    }

    const rawFishId = getFeatureItemId('Raw Fish') || 446;
    const boneId = 208;

    if (itemId === boneId && mob.mobType === 'wolf' && !(mob as any).isTamed) {
      this.inventory.removeItemFromSlot(slot, 1);
      if (Math.random() < 0.35) {
        (mob as any).isTamed = true;
        (mob as any).ownerId = 'local';
        (mob as any).isSitting = false;
        mob.aiState = 'idle';
        EventBus.emit('network:chat', `[System] Wolf has been tamed!`);
        EventBus.emit('particles:spawn', mob.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 13, 12);
        AudioManager.playItemPickup();
      } else {
        EventBus.emit('particles:spawn', mob.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 2, 8);
      }
      return true;
    }

    if (itemId === rawFishId && mob.mobType === 'cat' && !(mob as any).isTamed) {
      this.inventory.removeItemFromSlot(slot, 1);
      if (Math.random() < 0.35) {
        (mob as any).isTamed = true;
        (mob as any).ownerId = 'local';
        (mob as any).isSitting = false;
        mob.aiState = 'idle';
        EventBus.emit('network:chat', `[System] Cat has been tamed!`);
        EventBus.emit('particles:spawn', mob.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 13, 12);
        AudioManager.playItemPickup();
      } else {
        EventBus.emit('particles:spawn', mob.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 2, 8);
      }
      return true;
    }

    if ((mob.mobType === 'wolf' || mob.mobType === 'cat') && (mob as any).isTamed && (mob as any).ownerId === 'local') {
      (mob as any).isSitting = !(mob as any).isSitting;
      EventBus.emit('network:chat', `[System] Sitting: ${(mob as any).isSitting}`);
      AudioManager.playItemPickup();
      return true;
    }

    return false;
  }

  private checkGolemSpawning(px: number, py: number, pz: number, blockIdPlaced: number): void {
    const pumpkinId = getFeatureBlockId('Pumpkin');
    if (blockIdPlaced !== pumpkinId) return;

    const snowBlockId = getFeatureBlockId('Snow Block');
    const ironBlockId = getFeatureBlockId('Iron Block');
    
    // 1. Check Snow Golem (2 vertical snow blocks below pumpkin)
    if (
      this.world.getVoxel(px, py - 1, pz) === snowBlockId &&
      this.world.getVoxel(px, py - 2, pz) === snowBlockId
    ) {
      this.world.setVoxel(px, py, pz, 0);
      this.world.setVoxel(px, py - 1, pz, 0);
      this.world.setVoxel(px, py - 2, pz, 0);

      const em = (window as any).gameEntityManager;
      if (em) {
        em.spawnMob(new THREE.Vector3(px + 0.5, py - 2, pz + 0.5), 'snow_golem');
        EventBus.emit('network:chat', `[System] A Snow Golem has been summoned!`);
      }
      return;
    }

    // 2. Check Iron Golem (T-shape of Iron Blocks below pumpkin)
    if (
      this.world.getVoxel(px, py - 1, pz) === ironBlockId &&
      this.world.getVoxel(px, py - 2, pz) === ironBlockId
    ) {
      let spawned = false;
      if (
        this.world.getVoxel(px - 1, py - 1, pz) === ironBlockId &&
        this.world.getVoxel(px + 1, py - 1, pz) === ironBlockId
      ) {
        this.world.setVoxel(px, py, pz, 0);
        this.world.setVoxel(px, py - 1, pz, 0);
        this.world.setVoxel(px, py - 2, pz, 0);
        this.world.setVoxel(px - 1, py - 1, pz, 0);
        this.world.setVoxel(px + 1, py - 1, pz, 0);
        spawned = true;
      } else if (
        this.world.getVoxel(px, py - 1, pz - 1) === ironBlockId &&
        this.world.getVoxel(px, py - 1, pz + 1) === ironBlockId
      ) {
        this.world.setVoxel(px, py, pz, 0);
        this.world.setVoxel(px, py - 1, pz, 0);
        this.world.setVoxel(px, py - 2, pz, 0);
        this.world.setVoxel(px, py - 1, pz - 1, 0);
        this.world.setVoxel(px, py - 1, pz + 1, 0);
        spawned = true;
      }

      if (spawned) {
        const em = (window as any).gameEntityManager;
        if (em) {
          em.spawnMob(new THREE.Vector3(px + 0.5, py - 2, pz + 0.5), 'iron_golem');
          EventBus.emit('network:chat', `[System] An Iron Golem has been summoned!`);
        }
      }
    }
  }

  private tryWaxCopper(slot: number, itemId: number): boolean {
    if (!this.targetBlock) return false;
    const honeycombId = getFeatureItemId('Honeycomb');
    if (itemId !== honeycombId) return false;

    const target = this.targetBlock;
    const blockName = BlockRegistry.get(target.blockId).name || "";
    if (blockName === 'Copper Block' || blockName === 'Weathered Copper' || blockName === 'Oxidized Copper') {
      const key = `${target.x},${target.y},${target.z}`;
      if ((this.world as any).waxedBlocks && (this.world as any).waxedBlocks.has(key)) {
        EventBus.emit('network:chat', `[System] Already waxed!`);
        return false;
      }
      if (!(this.world as any).waxedBlocks) {
        (this.world as any).waxedBlocks = new Set<string>();
      }
      (this.world as any).waxedBlocks.add(key);
      AudioManager.playItemPickup();
      EventBus.emit('network:chat', `[System] Waxed ${blockName}!`);
      this.inventory.removeItemFromSlot(slot, 1);
      return true;
    }
    return false;
  }
}
