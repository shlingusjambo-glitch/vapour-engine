import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { Renderer } from '../graphics/Renderer';
import { WorldManager } from '../world/WorldManager';
import { BlockRegistry } from '../world/BlockRegistry';
import { PlayerController } from '../player/PlayerController';
import { EntityManager } from '../entities/EntityManager';
import { Inventory } from '../inventory/Inventory';
import { BaseClass } from './classes/BaseClass';
import { TF2ClassId, TF2Team, getTF2ClassProfile, listTF2ClassProfiles } from './classes/TF2ClassRegistry';
import { SourceMovementController } from './movement/SourceMovementController';
import { RagdollSystem } from './ragdoll/RagdollSystem';
import { TF2GameStateManager, TF2ModeKind } from './modes/TF2GameStateManager';
import { TF2ProjectileState, TF2WeaponDef, TF2WeaponHandler, TF2_WEAPONS, calculateTF2Damage } from './weapons/TF2WeaponFramework';
import { TF2_SLOT_ORDER, getTF2WeaponDisplayName, getTF2WeaponItemId } from './runtime/TF2Loadout';
import type { PlayerMovementOverrideContext } from '../player/PlayerController';
import { ParticleSystem } from '../graphics/ParticleSystem';

const TF2_DIMENSIONS = new Set(['tf2_payload', 'tf2_cp', 'tf2_koth', 'tf2_ctf', 'tf2_test']);
type TF2BuildingKind = 'sentry' | 'dispenser' | 'teleporter_entrance' | 'teleporter_exit';

interface TF2BuildingDef {
  kind: TF2BuildingKind;
  label: string;
  cost: number;
  health: number;
  buildTime: number;
  upgradeCost: number;
}

interface TF2BuildingState {
  id: string;
  kind: TF2BuildingKind;
  team: TF2Team;
  pos: THREE.Vector3;
  yaw: number;
  health: number;
  maxHealth: number;
  level: number;
  construction: number;
  mesh: THREE.Group;
  cooldown: number;
  rocketCooldown?: number;
}

interface RuntimeProjectile extends TF2ProjectileState {
  mesh: THREE.Object3D;
  gravity: number;
  age: number;
  stuck: boolean;
  armed: boolean;
  bounceCount: number;
}

const TF2_BUILDINGS: Record<TF2BuildingKind, TF2BuildingDef> = {
  sentry: { kind: 'sentry', label: 'Sentry Gun', cost: 130, health: 150, buildTime: 10.5, upgradeCost: 200 },
  dispenser: { kind: 'dispenser', label: 'Dispenser', cost: 100, health: 150, buildTime: 21, upgradeCost: 200 },
  teleporter_entrance: { kind: 'teleporter_entrance', label: 'Teleporter Entrance', cost: 50, health: 150, buildTime: 21, upgradeCost: 200 },
  teleporter_exit: { kind: 'teleporter_exit', label: 'Teleporter Exit', cost: 50, health: 150, buildTime: 21, upgradeCost: 200 },
};

export class TF2Manager {
  private root: HTMLDivElement;
  private hud: HTMLDivElement;
  private buildHud: HTMLDivElement;
  private currentClass = new BaseClass('soldier', 'BLU');
  private movement = new SourceMovementController(this.currentClass.profile);
  private ragdolls: RagdollSystem;
  private mode = new TF2GameStateManager('payload');
  private weapons = new TF2WeaponHandler();
  private projectiles: RuntimeProjectile[] = [];
  private buildings: TF2BuildingState[] = [];
  private buildPreview = new THREE.Group();
  private selectedBuildKind: TF2BuildingKind | null = null;
  private buildYaw = 0;
  private lastDimension = '';
  private wasActive = false;
  private baseFov = 75;
  private sniperScoped = false;
  private sniperScopedAt = 0;
  private sniperCharge = 0;
  private heavySpin = 0;
  private heavyBarrelAngle = 0;
  private medicUberActiveUntil = 0;
  private spyAttackLockedUntil = 0;
  private lastUtilityMessageAt = 0;
  private readonly movementOverrideFn = (ctx: PlayerMovementOverrideContext) => this.movement.tick(ctx);

  // Reloading, Medigun, Deflection, and Afterburn DOT states
  private reloadingWeaponId: string | null = null;
  private reloadProgress = 0;
  private reloadStage: 'start' | 'inserting' = 'start';
  private healingTarget: { kind: 'mob' | 'player'; id: string; lastSeen: number } | null = null;
  private medigunBeam: THREE.Line | null = null;
  private afterburns: Array<{ targetId: string; kind: 'mob' | 'player'; until: number; nextTick: number; damage: number }> = [];

  constructor(
    private renderer: Renderer,
    private world: WorldManager,
    private player: PlayerController,
    private entities: EntityManager,
    private inventory: Inventory,
    private particleSystem: ParticleSystem
  ) {
    this.baseFov = renderer.camera.fov;
    this.ragdolls = new RagdollSystem(renderer.scene);
    this.root = this.createClassOverlay();
    this.hud = this.createHud();
    this.buildHud = this.createBuildHud();
    this.buildPreview.visible = false;
    this.renderer.scene.add(this.buildPreview);
    this.bindEvents();
    (window as any).tf2Manager = this;
  }

  public update(dt: number): void {
    const active = TF2_DIMENSIONS.has(this.world.currentDimension);
    if (!active) {
      this.deactivate();
      this.ragdolls.update(dt, this.world);
      return;
    }

    if (!this.wasActive) this.activate();
    if (this.lastDimension !== this.world.currentDimension) {
      this.mode.setMode(this.modeFromDimension(this.world.currentDimension));
      this.lastDimension = this.world.currentDimension;
    }

    this.player.movementOverride = this.movementOverrideFn;
    this.currentClass.tick(dt);
    this.tickReload(dt);
    this.tickAfterburn(dt);
    this.tickMedigun(dt);
    this.updateClassRuntime(dt);
    this.syncPlayerHealthFromClass();
    this.updateSniperState(dt);
    this.updateProjectiles(dt);
    this.updateEngineerBuildings(dt);
    this.updateBuildPreview();

    this.root.classList.toggle('visible', InputManager.isUIActive && !document.pointerLockElement);
    this.hud.classList.add('visible');
    this.buildHud.classList.toggle('toggle', this.currentClass.profile.id === 'engineer');
    this.updateHud(dt);
    this.updateBuildHud();
    this.ragdolls.update(dt, this.world);
  }

  private activate(): void {
    this.wasActive = true;
    this.baseFov = this.renderer.camera.fov;
    this.player.movementOverride = this.movementOverrideFn;
    this.equipClassLoadout(true);
    this.syncPlayerHealthFromClass(true);
    EventBus.emit('network:chat', `[Fortress] ${this.currentClass.profile.name} ready. 1/2/3 swap weapons, comma changes class.`);
  }

  private deactivate(): void {
    if (this.player.movementOverride === this.movementOverrideFn) this.player.movementOverride = null;
    this.root.classList.remove('visible');
    this.hud.classList.remove('visible');
    this.buildHud.classList.remove('visible');
    this.buildPreview.visible = false;
    this.selectedBuildKind = null;
    this.wasActive = false;
    this.setScoped(false);
  }

  private bindEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-class]').forEach(button => {
      button.addEventListener('click', () => {
        this.setClass(String(button.dataset.class || 'soldier') as TF2ClassId);
        this.root.classList.remove('visible');
        InputManager.isUIActive = false;
        InputManager.lockPointer();
      });
    });
    this.buildHud.querySelectorAll<HTMLButtonElement>('[data-build]').forEach(button => {
      button.addEventListener('click', () => {
        this.selectBuildKind(String(button.dataset.build) as TF2BuildingKind);
        InputManager.lockPointer();
      });
    });

    window.addEventListener('keydown', (event) => {
      if (!TF2_DIMENSIONS.has(this.world.currentDimension) || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === ',') {
        this.root.classList.add('visible');
        InputManager.isUIActive = true;
        InputManager.unlockPointer();
        return;
      }
      if (key === '1' || key === 'q') this.selectSlot('primary');
      if (key === '2' || key === 'e') this.selectSlot('secondary');
      if (key === '3' || key === 'f') this.selectSlot('melee');
      if (this.currentClass.profile.id === 'engineer') {
        if (key === 'b') this.toggleBuildPanel();
        if (key === '4') this.selectBuildKind('sentry');
        if (key === '5') this.selectBuildKind('dispenser');
        if (key === '6') this.selectBuildKind('teleporter_entrance');
        if (key === '7') this.selectBuildKind('teleporter_exit');
        if (key === 'r') this.buildYaw += Math.PI / 2;
        if (key === 'u') this.upgradeAimedBuilding();
        if (key === 'x') this.destroyAimedBuilding();
      }
      if (this.currentClass.profile.id === 'spy' && key === 'c') this.toggleSpyCloak();
      if (this.currentClass.profile.id === 'spy' && key === 'v') this.disguiseAsNextEnemy();
    });

    EventBus.on('mouse:leftClick', () => {
      if (!TF2_DIMENSIONS.has(this.world.currentDimension) || InputManager.isUIActive) return;
      if (this.currentClass.profile.id === 'engineer' && this.selectedBuildKind) {
        this.placeSelectedBuilding();
      } else {
        this.fireActiveWeapon();
      }
    });
    EventBus.on('mouse:rightClick', () => {
      if (!TF2_DIMENSIONS.has(this.world.currentDimension) || InputManager.isUIActive) return;
      const weaponId = this.getActiveWeaponId();
      if (this.currentClass.profile.id === 'sniper' && weaponId === 'sniper_rifle') {
        this.setScoped(!this.sniperScoped);
      } else if (this.currentClass.profile.id === 'heavy' && weaponId === 'minigun') {
        this.heavySpin = Math.max(this.heavySpin, 0.25);
      } else if (this.currentClass.profile.id === 'demoman' && weaponId === 'stickybomb_launcher') {
        this.detonateStickies();
      } else if (this.currentClass.profile.id === 'medic' && weaponId === 'medigun') {
        this.tryActivateUber();
      } else if (this.currentClass.profile.id === 'pyro' && weaponId === 'flamethrower') {
        this.firePyroAirblast();
      } else if (this.currentClass.profile.id === 'engineer' && this.selectedBuildKind) {
        this.buildYaw += Math.PI / 2;
      } else if (this.currentClass.profile.id === 'spy') {
        this.toggleSpyCloak();
      }
    });

    EventBus.on('tf2:blast', (data: any) => {
      this.movement.queueBlast({
        origin: new THREE.Vector3(Number(data?.x || 0), Number(data?.y || 0), Number(data?.z || 0)),
        radius: Number(data?.radius || 5),
        force: Number(data?.force || 16),
        verticalBias: Number(data?.verticalBias ?? 0.46),
      });
    });
    EventBus.on('player:died', () => {
      if (!TF2_DIMENSIONS.has(this.world.currentDimension)) return;
      const color = this.currentClass.state.team === 'RED' ? 0xc74338 : 0x3c6fc7;
      this.ragdolls.spawn(this.player.position, this.player.velocity, color);
    });
  }

  private setClass(classId: TF2ClassId, team: TF2Team = this.currentClass.state.team): void {
    this.currentClass = new BaseClass(classId, team);
    this.movement.setClassProfile(getTF2ClassProfile(classId));
    this.setScoped(false);
    this.selectedBuildKind = null;
    this.heavySpin = 0;
    this.heavyBarrelAngle = 0;
    this.medicUberActiveUntil = 0;
    this.spyAttackLockedUntil = 0;
    this.equipClassLoadout(true);
    this.syncPlayerHealthFromClass(true);
    EventBus.emit('network:chat', `[Fortress] Class changed to ${this.currentClass.profile.name}. Press 1/2/3 to swap weapons.`);
  }

  private equipClassLoadout(selectPrimary = false): void {
    const slots = this.currentClass.profile;
    const weaponIds = [slots.primary, slots.secondary, slots.melee];
    for (let i = 0; i < TF2_SLOT_ORDER.length; i++) {
      const weaponId = weaponIds[i];
      this.inventory.setSlot(i, {
        id: getTF2WeaponItemId(weaponId),
        count: 1,
        customName: `${this.currentClass.profile.name} ${getTF2WeaponDisplayName(weaponId)}`,
        team: this.currentClass.state.team,
      });
    }
    if (selectPrimary) this.currentClass.setSlot('primary');
    this.selectSlot(this.currentClass.state.selectedSlot);
    EventBus.emit('inventory:updated');
  }

  private selectSlot(slot: 'primary' | 'secondary' | 'melee'): void {
    this.currentClass.setSlot(slot);
    const slotIndex = TF2_SLOT_ORDER.indexOf(slot);
    const weaponId = this.getActiveWeaponId();
    const itemId = getTF2WeaponItemId(weaponId);
    this.inventory.setSlot(slotIndex, {
      id: itemId,
      count: 1,
      customName: `${this.currentClass.profile.name} ${getTF2WeaponDisplayName(weaponId)}`,
      team: this.currentClass.state.team,
    });
    EventBus.emit('hotbar:select', slotIndex);
    this.renderer.updateHandMeshBlock(itemId);
    if (weaponId !== 'sniper_rifle') this.setScoped(false);
    if (this.currentClass.profile.id !== 'engineer') this.selectedBuildKind = null;
  }

  private getActiveWeaponId(): string {
    const slot = this.currentClass.state.selectedSlot;
    if (slot === 'primary') return this.currentClass.profile.primary;
    if (slot === 'secondary') return this.currentClass.profile.secondary;
    return this.currentClass.profile.melee;
  }

  private getActiveWeaponDef(): TF2WeaponDef | null {
    return TF2_WEAPONS[this.getActiveWeaponId()] || null;
  }

  private fireActiveWeapon(): void {
    const def = this.getActiveWeaponDef();
    if (!def || this.player.isDead || this.player.isSpectator) return;
    if (this.currentClass.profile.id === 'spy' && this.currentClass.state.cloakActive) {
      this.postUtilityMessage('[Spy] Attacks are locked while cloaked.');
      return;
    }
    if (this.currentClass.profile.id === 'spy' && performance.now() / 1000 < this.spyAttackLockedUntil) {
      this.postUtilityMessage('[Spy] Decloak attack lockout.');
      return;
    }

    // --- AMMO AND RELOADING CHECKS ---
    if (def.kind !== 'melee') {
      const clip = this.currentClass.state.ammoClip[def.id];
      if (clip !== undefined) {
        if (clip <= 0) {
          if (this.reloadingWeaponId !== def.id) {
            this.startReload(def.id);
          }
          return;
        }
        // Interruption of shell-by-shell reloads by firing
        if (this.reloadingWeaponId === def.id) {
          const isShellReload = [
            'scattergun',
            'shotgun',
            'rocket_launcher',
            'grenade_launcher',
            'stickybomb_launcher'
          ].includes(def.id);
          if (isShellReload) {
            this.reloadingWeaponId = null; // Interrupted reload
            this.postUtilityMessage(`[Fortress] Reload interrupted.`);
          } else {
            // Cannot interrupt standard reload (Pistol, SMG, etc.)
            return;
          }
        }
        this.currentClass.state.ammoClip[def.id]--;
      }
    }

    if (this.currentClass.profile.id === 'heavy' && def.id === 'minigun' && this.heavySpin < 0.85) {
      this.heavySpin = Math.min(1, this.heavySpin + 0.22);
      this.renderer.playGunRecoil(0.08);
      return;
    }

    const ownerUuid = String((window as any).gameNetworkManager?.myUuid || 'local');
    const direction = this.renderer.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const origin = this.player.position.clone().add(new THREE.Vector3(0, this.player.eyeHeight, 0)).addScaledVector(direction, 0.55);

    if (def.id === 'sniper_rifle') {
      this.fireSniperRifle(def, origin, direction, ownerUuid);
      return;
    }

    if (def.kind === 'beam') {
      if (!this.weapons.canFire(def)) return;
      this.weapons.markFired(def);
      // Medic medigun primary fire handled in tickMedigun
      this.playWeaponFeedback(def, origin, direction, 0.10, 6, false);
      return;
    }

    if (def.kind === 'projectile') {
      const projectile = this.weapons.emitProjectile(def, origin, direction, ownerUuid);
      if (!projectile) return;
      const mesh = this.createProjectileMesh(def);
      mesh.position.copy(projectile.pos);
      this.renderer.scene.add(mesh);
      const runtimeProjectile: RuntimeProjectile = {
        id: projectile.id,
        weaponId: projectile.weaponId,
        ownerUuid: projectile.ownerUuid,
        pos: projectile.pos,
        vel: projectile.vel,
        radius: projectile.radius,
        damage: projectile.damage,
        splashRadius: projectile.splashRadius,
        life: def.id === 'stickybomb_launcher' ? 120 : projectile.life,
        mesh,
        gravity: def.projectileGravity || 0,
        age: 0,
        stuck: false,
        armed: def.id !== 'stickybomb_launcher',
        bounceCount: 0,
      };
      this.projectiles.push(runtimeProjectile);
      if (this.projectiles.length > 64) this.destroyProjectile(this.projectiles.shift()!);
      if (def.id === 'stickybomb_launcher') this.limitStickybombs(ownerUuid);
      this.playWeaponFeedback(def, origin, direction, def.id === 'rocket_launcher' ? 1.0 : 0.55, 10, false);
      return;
    }

    if (def.kind === 'flame') {
      if (!this.weapons.canFire(def)) return;
      this.weapons.markFired(def);

      // Pyro Flame Cone-Cast Direct Impact Check
      const range = 5.6;
      for (const mob of this.entities.localMobs) {
        if (mob.isDead || (mob as any).staticShop || (mob as any).shopKind || mob.aiState === 'shop') continue;
        const center = mob.position.clone().add(new THREE.Vector3(0, 0.9, 0));
        const toTarget = center.sub(origin);
        const dist = toTarget.length();
        if (dist > range) continue;
        const dot = toTarget.normalize().dot(direction);
        if (dot >= 0.86) {
          this.entities.damageMob(mob.id, def.baseDamage);
          this.applyAfterburn(mob.id, 'mob', 7.5, 4);
        }
      }
      for (const [id, remote] of this.entities.remotePlayers) {
        if (remote.entity.isDead) continue;
        const center = remote.entity.position.clone().add(new THREE.Vector3(0, 0.9, 0));
        const toTarget = center.sub(origin);
        const dist = toTarget.length();
        if (dist > range) continue;
        const dot = toTarget.normalize().dot(direction);
        if (dot >= 0.86) {
          EventBus.emit('network:sendPvpDamage', { targetUuid: id, damage: def.baseDamage });
          this.applyAfterburn(id, 'player', 7.5, 4);
        }
      }

      EventBus.emit('tf2:flame', { ownerUuid, origin, dir: direction, damage: def.baseDamage, range: 5.6, afterburnSeconds: 7.5 });
      this.playWeaponFeedback(def, origin, direction, 0.16, 5, false);
      return;
    }

    if (def.kind === 'melee') {
      if (!this.weapons.canFire(def)) return;
      this.weapons.markFired(def);
      if (def.id === 'knife') {
        this.fireSpyKnife(origin, direction, ownerUuid);
        this.playWeaponFeedback(def, origin, direction, 0.35, 2.2, false);
        return;
      }
      // Standard melee swing hitscan check
      const range = 2.2;
      let hitTarget = false;
      for (const mob of this.entities.localMobs) {
        if (mob.isDead || (mob as any).staticShop || (mob as any).shopKind || mob.aiState === 'shop') continue;
        const center = mob.position.clone().add(new THREE.Vector3(0, 0.9, 0));
        const toTarget = center.sub(origin);
        if (toTarget.length() <= range && toTarget.normalize().dot(direction) >= 0.65) {
          this.entities.damageMob(mob.id, def.baseDamage);
          hitTarget = true;
          break;
        }
      }
      if (!hitTarget) {
        for (const [id, remote] of this.entities.remotePlayers) {
          if (remote.entity.isDead) continue;
          const center = remote.entity.position.clone().add(new THREE.Vector3(0, 0.9, 0));
          const toTarget = center.sub(origin);
          if (toTarget.length() <= range && toTarget.normalize().dot(direction) >= 0.65) {
            EventBus.emit('network:sendPvpDamage', { targetUuid: id, damage: def.baseDamage });
            hitTarget = true;
            break;
          }
        }
      }

      EventBus.emit('tf2:melee', { ownerUuid, origin, dir: direction, damage: def.baseDamage, range });
      this.playWeaponFeedback(def, origin, direction, 0.35, range, false);
      return;
    }

    if (!this.weapons.canFire(def)) return;
    this.weapons.markFired(def);
    const hit = this.traceWorld(origin, direction, 64);
    const distance = hit?.distance ?? 24;
    const damage = calculateTF2Damage(def, distance);
    EventBus.emit('tf2:hitscan', { weaponId: def.id, ownerUuid, origin, dir: direction, damage, spread: def.spread || 0, hit });
    this.playWeaponFeedback(def, origin, direction, def.id === 'minigun' ? 0.18 : 0.45, distance, true);
  }

  private fireSniperRifle(def: TF2WeaponDef, origin: THREE.Vector3, direction: THREE.Vector3, ownerUuid: string): void {
    if (!this.weapons.canFire(def)) return;
    this.weapons.markFired(def);
    const hit = this.traceWorld(origin, direction, 96);
    // Sniper damage magnification over 3.3s scoped duration (up to 3x base damage)
    const baseVal = 50;
    const chargeMultiplier = 1 + this.sniperCharge * 2;
    const damage = Math.round(baseVal * chargeMultiplier);

    // Hitscan damage dispatch to mobs or remote players
    let targetHit = false;
    if (hit) {
      const hitPos = origin.clone().addScaledVector(direction, hit.distance);
      for (const mob of this.entities.localMobs) {
        if (mob.isDead || (mob as any).staticShop || (mob as any).shopKind || mob.aiState === 'shop') continue;
        if (mob.position.distanceTo(hitPos) < 1.45) {
          this.entities.damageMob(mob.id, damage);
          targetHit = true;
          break;
        }
      }
      if (!targetHit) {
        for (const [id, remote] of this.entities.remotePlayers) {
          if (remote.entity.isDead) continue;
          if (remote.entity.position.distanceTo(hitPos) < 1.45) {
            EventBus.emit('network:sendPvpDamage', { targetUuid: id, damage });
            targetHit = true;
            break;
          }
        }
      }
    }

    EventBus.emit('tf2:hitscan', {
      weaponId: def.id,
      ownerUuid,
      origin,
      dir: direction,
      damage,
      headshotDamage: damage * 3,
      scoped: this.sniperScoped,
      charge: this.sniperCharge,
      hit,
    });
    this.sniperCharge = 0;
    this.sniperScopedAt = performance.now() / 1000;
    this.playWeaponFeedback(def, origin, direction, this.sniperScoped ? 0.55 : 0.85, hit?.distance ?? 96, true);
  }

  private firePyroAirblast(): void {
    const def = TF2_WEAPONS.flamethrower;
    const airblastDef: TF2WeaponDef = {
      id: 'airblast',
      name: 'Compression Blast',
      slot: def.slot,
      kind: def.kind,
      baseDamage: 0,
      fireRate: 0.75,
      clipSize: def.clipSize,
      reserveAmmo: def.reserveAmmo,
      projectileSpeed: def.projectileSpeed,
      splashRadius: 5.5,
    };
    if (!this.weapons.canFire(airblastDef)) return;
    this.weapons.markFired(airblastDef);

    // Consume 20 ammo from Flamethrower
    if (this.currentClass.state.ammoClip['flamethrower'] !== undefined) {
      if (this.currentClass.state.ammoClip['flamethrower'] < 20) {
        this.postUtilityMessage('[Pyro] Need 20 ammo for airblast.');
        return;
      }
      this.currentClass.state.ammoClip['flamethrower'] -= 20;
    }

    const origin = this.player.position.clone().add(new THREE.Vector3(0, this.player.eyeHeight, 0));
    const dir = this.renderer.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const ownerUuid = String((window as any).gameNetworkManager?.myUuid || 'local');

    // 1. Deflect projectiles
    let deflectedCount = 0;
    for (const proj of this.projectiles) {
      if (proj.ownerUuid === ownerUuid) continue;
      const toProj = proj.pos.clone().sub(origin);
      const dist = toProj.length();
      if (dist > 5.5) continue;
      const projDot = toProj.normalize().dot(dir);
      if (projDot >= 0.70) {
        proj.vel.copy(dir).multiplyScalar(Math.max(12, proj.vel.length()) * 1.35);
        proj.ownerUuid = ownerUuid;
        proj.stuck = false;
        proj.armed = true;
        deflectedCount++;
      }
    }

    // 2. Push back enemies
    for (const mob of this.entities.localMobs) {
      if (mob.isDead || (mob as any).staticShop || (mob as any).shopKind || mob.aiState === 'shop') continue;
      const toMob = mob.position.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(origin);
      const dist = toMob.length();
      if (dist > 5.5) continue;
      const mobDot = toMob.normalize().dot(dir);
      if (mobDot >= 0.70) {
        const pushForce = dir.clone().multiplyScalar(14 * (1 - dist / 5.5));
        mob.position.add(pushForce.multiplyScalar(0.25));
        this.entities.damageMob(mob.id, 1);
      }
    }
    for (const [id, remote] of this.entities.remotePlayers) {
      if (remote.entity.isDead) continue;
      const toPlayer = remote.entity.position.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(origin);
      const dist = toPlayer.length();
      if (dist > 5.5) continue;
      const playerDot = toPlayer.normalize().dot(dir);
      if (playerDot >= 0.70) {
        const pushForce = dir.clone().multiplyScalar(14 * (1 - dist / 5.5));
        EventBus.emit('network:sendKnockback', { targetUuid: id, force: pushForce });
      }
    }

    EventBus.emit('tf2:airblast', { origin, dir, radius: 5.5, force: 18 });
    this.playWeaponFeedback(airblastDef, origin, dir, 0.4, 4, false);
    if (deflectedCount > 0) {
      this.postUtilityMessage(`[Pyro] Airblast deflected ${deflectedCount} projectile${deflectedCount === 1 ? '' : 's'}!`);
    } else {
      this.postUtilityMessage('[Pyro] Airblast push emitted.');
    }
  }

  private playWeaponFeedback(def: TF2WeaponDef, origin: THREE.Vector3, direction: THREE.Vector3, recoil: number, tracerDistance: number, tracer: boolean): void {
    this.renderer.playGunRecoil(recoil);
    const sound = this.soundKindForWeapon(def);
    if (sound) AudioManager.playGunshot(sound);

    const color = def.kind === 'flame'
      ? 0xff7a20
      : def.kind === 'beam'
        ? 0x78d1ff
        : def.id === 'airblast'
          ? 0xbdefff
          : 0xffd26a;
    const flashSize = def.kind === 'flame' ? 0.22 : def.id === 'rocket_launcher' ? 0.18 : 0.12;
    const flashPos = origin.clone().addScaledVector(direction, 0.32);
    const flashMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(flashSize, 10, 8), flashMaterial);
    flash.position.copy(flashPos);
    flash.renderOrder = 80;
    this.renderer.scene.add(flash);

    const light = new THREE.PointLight(color, def.kind === 'flame' ? 2.1 : 1.45, def.kind === 'flame' ? 5.5 : 3.5);
    light.position.copy(flashPos);
    this.renderer.scene.add(light);

    // Spawning Pyro flame feedback particles
    if (def.kind === 'flame') {
      for (let d = 0.5; d < tracerDistance; d += 0.8) {
        const pPos = origin.clone().addScaledVector(direction, d);
        this.particleSystem.spawnFlameSmokeParticles(pPos, 1);
      }
    }

    let beam: THREE.Line | null = null;
    if (tracer || def.kind === 'beam' || def.id === 'airblast') {
      const end = origin.clone().addScaledVector(direction, Math.max(1, tracerDistance));
      const geometry = new THREE.BufferGeometry().setFromPoints([origin.clone(), end]);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: def.kind === 'beam' ? 0.62 : 0.72,
        depthWrite: false,
      });
      beam = new THREE.Line(geometry, material);
      beam.renderOrder = 70;
      this.renderer.scene.add(beam);
    }

    window.setTimeout(() => {
      this.renderer.scene.remove(flash);
      flash.geometry.dispose();
      flashMaterial.dispose();
      this.renderer.scene.remove(light);
      light.dispose();
      if (beam) {
        this.renderer.scene.remove(beam);
        beam.geometry.dispose();
        const mat = beam.material as THREE.Material;
        mat.dispose();
      }
    }, def.kind === 'flame' ? 80 : 58);
  }

  private soundKindForWeapon(def: TF2WeaponDef): 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' | null {
    if (def.id === 'pistol' || def.id === 'revolver' || def.id === 'flare_gun') return 'pistol';
    if (def.id === 'smg' || def.id === 'minigun' || def.id === 'syringe_gun') return 'smg';
    if (def.id === 'sniper_rifle') return 'sniper';
    if (def.id === 'scattergun' || def.id === 'shotgun') return 'shotgun';
    if (def.kind === 'melee' && def.id !== 'sapper') return 'pistol';
    if (def.kind === 'beam') return 'smg';
    if (def.id === 'airblast') return 'shotgun';
    return 'rifle';
  }

  private updateSniperState(dt: number): void {
    const activeWeapon = this.getActiveWeaponId();
    if (activeWeapon !== 'sniper_rifle') this.setScoped(false);
    if (this.sniperScoped) {
      const elapsed = performance.now() / 1000 - this.sniperScopedAt;
      this.sniperCharge = THREE.MathUtils.clamp(elapsed / 3.3, 0, 1);
      this.renderer.camera.fov += (28 - this.renderer.camera.fov) * Math.min(1, dt * 12);
    } else {
      this.sniperCharge = 0;
      this.renderer.camera.fov += (this.baseFov - this.renderer.camera.fov) * Math.min(1, dt * 10);
    }
    this.renderer.camera.updateProjectionMatrix();
  }

  private setScoped(scoped: boolean): void {
    if (scoped === this.sniperScoped) return;
    this.sniperScoped = scoped;
    this.sniperScopedAt = performance.now() / 1000;
    this.sniperCharge = 0;
    EventBus.emit('tf2:sniperScope', { scoped });
  }

  private startReload(weaponId: string): void {
    const def = TF2_WEAPONS[weaponId];
    if (!def || def.clipSize <= 1) return;
    const clip = this.currentClass.state.ammoClip[weaponId] ?? 0;
    const reserve = this.currentClass.state.ammoReserve[weaponId] ?? 0;
    if (clip >= def.clipSize || reserve <= 0) return;

    this.reloadingWeaponId = weaponId;
    this.reloadProgress = 0;
    this.reloadStage = 'start';
    this.postUtilityMessage(`[Fortress] Reloading ${def.name}...`);
  }

  private tickReload(dt: number): void {
    if (!this.reloadingWeaponId) return;
    const def = TF2_WEAPONS[this.reloadingWeaponId];
    if (!def) {
      this.reloadingWeaponId = null;
      return;
    }

    const isShellReload = [
      'scattergun',
      'shotgun',
      'rocket_launcher',
      'grenade_launcher',
      'stickybomb_launcher'
    ].includes(this.reloadingWeaponId);

    this.reloadProgress += dt;

    if (isShellReload) {
      const startDuration = 0.85;
      const insertDuration = 0.45;
      if (this.reloadStage === 'start') {
        if (this.reloadProgress >= startDuration) {
          this.reloadStage = 'inserting';
          this.reloadProgress = 0;
          this.insertReloadShell(def);
        }
      } else {
        if (this.reloadProgress >= insertDuration) {
          this.reloadProgress = 0;
          this.insertReloadShell(def);
        }
      }
    } else {
      const reloadDuration = 1.35;
      if (this.reloadProgress >= reloadDuration) {
        const clip = this.currentClass.state.ammoClip[this.reloadingWeaponId] ?? 0;
        const reserve = this.currentClass.state.ammoReserve[this.reloadingWeaponId] ?? 0;
        const needed = def.clipSize - clip;
        const amount = Math.min(needed, reserve);
        this.currentClass.state.ammoClip[this.reloadingWeaponId] = clip + amount;
        this.currentClass.state.ammoReserve[this.reloadingWeaponId] = reserve - amount;
        this.reloadingWeaponId = null;
        this.postUtilityMessage(`[Fortress] Reload complete.`);
      }
    }
  }

  private insertReloadShell(def: TF2WeaponDef): void {
    const clip = this.currentClass.state.ammoClip[def.id] ?? 0;
    const reserve = this.currentClass.state.ammoReserve[def.id] ?? 0;
    if (clip < def.clipSize && reserve > 0) {
      this.currentClass.state.ammoClip[def.id] = clip + 1;
      this.currentClass.state.ammoReserve[def.id] = reserve - 1;
      AudioManager.playStep('stone');

      const newClip = this.currentClass.state.ammoClip[def.id];
      if (newClip >= def.clipSize || this.currentClass.state.ammoReserve[def.id] <= 0) {
        this.reloadingWeaponId = null;
        this.postUtilityMessage(`[Fortress] Reload complete.`);
      }
    } else {
      this.reloadingWeaponId = null;
    }
  }

  private applyAfterburn(targetId: string, kind: 'mob' | 'player', duration: number, damage: number): void {
    const now = performance.now() / 1000;
    const existing = this.afterburns.find(a => a.targetId === targetId && a.kind === kind);
    if (existing) {
      existing.until = now + duration;
    } else {
      this.afterburns.push({
        targetId,
        kind,
        until: now + duration,
        nextTick: now + 0.5,
        damage: 4
      });
    }
  }

  private tickAfterburn(dt: number): void {
    const now = performance.now() / 1000;
    for (let i = this.afterburns.length - 1; i >= 0; i--) {
      const entry = this.afterburns[i];
      if (now >= entry.until) {
        this.afterburns.splice(i, 1);
        continue;
      }
      if (now >= entry.nextTick) {
        entry.nextTick = now + 0.5;
        let pos: THREE.Vector3 | null = null;
        if (entry.kind === 'mob') {
          const mob = this.entities.localMobs.find(m => m.id === entry.targetId);
          if (mob && !mob.isDead) {
            this.entities.damageMob(entry.targetId, entry.damage);
            pos = mob.position;
          } else {
            this.afterburns.splice(i, 1);
            continue;
          }
        } else {
          const player = this.entities.remotePlayers.get(entry.targetId);
          if (player && !player.entity.isDead) {
            EventBus.emit('network:sendPvpDamage', { targetUuid: entry.targetId, damage: entry.damage });
            pos = player.entity.position;
          } else {
            this.afterburns.splice(i, 1);
            continue;
          }
        }
        if (pos) {
          this.particleSystem.spawnFlameSmokeParticles(pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 3);
        }
      }
    }
  }

  private tickMedigun(dt: number): void {
    const activeWeapon = this.getActiveWeaponId();
    const wantsPrimaryFire = InputManager.isLeftMouseDown();
    const now = performance.now() / 1000;

    if (activeWeapon === 'medigun' && wantsPrimaryFire && !this.player.isDead && !this.player.isSpectator) {
      if (this.healingTarget === null) {
        // Lock onto closest teammate in front
        let bestTarget: { id: string; kind: 'player' | 'mob'; position: THREE.Vector3; distance: number } | null = null;
        const origin = this.player.position.clone().add(new THREE.Vector3(0, this.player.eyeHeight, 0));
        const dir = this.renderer.camera.getWorldDirection(new THREE.Vector3()).normalize();

        for (const [id, remote] of this.entities.remotePlayers) {
          if (remote.entity.isDead) continue;
          const center = remote.entity.position.clone().add(new THREE.Vector3(0, 0.9, 0));
          const toTarget = center.clone().sub(origin);
          const dist = toTarget.length();
          if (dist > 7.5) continue;
          const dot = toTarget.normalize().dot(dir);
          if (dot > 0.65) {
            if (!bestTarget || dist < bestTarget.distance) {
              bestTarget = { id, kind: 'player', position: remote.entity.position, distance: dist };
            }
          }
        }

        for (const mob of this.entities.localMobs) {
          if (mob.isDead || (mob as any).staticShop || (mob as any).shopKind || mob.aiState === 'shop') continue;
          const center = mob.position.clone().add(new THREE.Vector3(0, 0.9, 0));
          const toTarget = center.clone().sub(origin);
          const dist = toTarget.length();
          if (dist > 7.5) continue;
          const dot = toTarget.normalize().dot(dir);
          if (dot > 0.65) {
            if (!bestTarget || dist < bestTarget.distance) {
              bestTarget = { id: mob.id, kind: 'mob', position: mob.position, distance: dist };
            }
          }
        }

        if (bestTarget) {
          this.healingTarget = { kind: bestTarget.kind, id: bestTarget.id, lastSeen: performance.now() };
          this.postUtilityMessage(`[Medic] Medigun locked onto teammate.`);
        }
      }

      if (this.healingTarget !== null) {
        let targetPos: THREE.Vector3 | null = null;
        let targetMax = 125;
        let targetHealth = 125;
        let valid = false;

        if (this.healingTarget.kind === 'player') {
          const remote = this.entities.remotePlayers.get(this.healingTarget.id);
          if (remote && !remote.entity.isDead && remote.entity.position.distanceTo(this.player.position) <= 9.0) {
            targetPos = remote.entity.position;
            targetMax = remote.entity.maxHealth || 125;
            targetHealth = remote.entity.health || targetMax;
            valid = true;

            // Heal and build Ubercharge
            EventBus.emit('network:healPlayer', { targetUuid: this.healingTarget.id, amount: dt * 24 });
            const overhealPct = Math.max(0, targetHealth - targetMax) / (targetMax * 0.5);
            this.currentClass.addUbercharge(dt * (overhealPct >= 1 ? 0.008 : 0.024));

            if (this.currentClass.state.invulnerable) {
              EventBus.emit('network:setInvulnerable', { targetUuid: this.healingTarget.id, until: this.medicUberActiveUntil });
            }
          }
        } else {
          const mob = this.entities.localMobs.find(m => m.id === this.healingTarget!.id);
          if (mob && !mob.isDead && mob.position.distanceTo(this.player.position) <= 9.0) {
            targetPos = mob.position;
            targetMax = mob.maxHealth;
            targetHealth = mob.health;
            valid = true;

            mob.health = Math.min(targetMax * 1.5, mob.health + dt * 24);
            const overhealPct = Math.max(0, mob.health - targetMax) / (targetMax * 0.5);
            this.currentClass.addUbercharge(dt * (overhealPct >= 1 ? 0.008 : 0.024));

            if (this.currentClass.state.invulnerable) {
              (mob as any).invulnerable = true;
            }
          }
        }

        if (valid && targetPos) {
          const origin = this.player.position.clone().add(new THREE.Vector3(0, this.player.eyeHeight - 0.2, 0));
          const dest = targetPos.clone().add(new THREE.Vector3(0, 0.9, 0));

          if (this.medigunBeam === null) {
            const geometry = new THREE.BufferGeometry().setFromPoints([origin, dest]);
            const material = new THREE.LineBasicMaterial({ color: 0x78d1ff, transparent: true, opacity: 0.85 });
            this.medigunBeam = new THREE.Line(geometry, material);
            this.renderer.scene.add(this.medigunBeam);
          } else {
            this.medigunBeam.geometry.setFromPoints([origin, dest]);
            this.medigunBeam.geometry.computeBoundingBox();
            this.medigunBeam.geometry.computeBoundingSphere();
          }
        } else {
          this.healingTarget = null;
          this.clearMedigunBeam();
        }
      }
    } else {
      this.healingTarget = null;
      this.clearMedigunBeam();
    }
  }

  private clearMedigunBeam(): void {
    if (this.medigunBeam) {
      this.renderer.scene.remove(this.medigunBeam);
      this.medigunBeam.geometry.dispose();
      (this.medigunBeam.material as THREE.Material).dispose();
      this.medigunBeam = null;
    }
  }


  private updateClassRuntime(dt: number): void {
    const weaponId = this.getActiveWeaponId();
    const wantsPrimaryFire = InputManager.isLeftMouseDown();
    const wantsSecondaryFire = InputManager.isRightMouseDown();

    if (this.currentClass.profile.id === 'heavy' && weaponId === 'minigun') {
      const targetSpin = wantsPrimaryFire || wantsSecondaryFire ? 1 : 0;
      const spinRate = targetSpin > this.heavySpin ? 2.2 : 1.55;
      this.heavySpin += (targetSpin - this.heavySpin) * Math.min(1, dt * spinRate);
      this.heavyBarrelAngle += dt * (4 + this.heavySpin * 42);
      this.movement.setMovementMultiplier(THREE.MathUtils.lerp(1, 0.48, this.heavySpin));
      if (wantsPrimaryFire && this.heavySpin >= 0.85) this.fireActiveWeapon();
    } else {
      this.heavySpin += (0 - this.heavySpin) * Math.min(1, dt * 3);
      this.movement.setMovementMultiplier(1);
    }

    if (wantsPrimaryFire && (weaponId === 'flamethrower' || weaponId === 'medigun')) {
      this.fireActiveWeapon();
    }

    const now = performance.now() / 1000;
    this.currentClass.state.invulnerable = this.currentClass.profile.id === 'medic' && now < this.medicUberActiveUntil;
    if (this.currentClass.state.invulnerable) {
      this.currentClass.state.health = Math.max(this.currentClass.state.health, this.currentClass.profile.maxHealth);
    }

    if (this.currentClass.profile.id === 'spy' && this.currentClass.state.cloakActive) {
      this.currentClass.state.cloak = Math.max(0, this.currentClass.state.cloak - dt * 0.22);
      if (this.currentClass.state.cloak <= 0) {
        this.currentClass.state.cloakActive = false;
        this.spyAttackLockedUntil = now + 0.75;
        EventBus.emit('tf2:spyCloak', { active: false });
      }
    }
  }

  private createProjectileMesh(def: TF2WeaponDef): THREE.Object3D {
    const group = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({
      color: def.id === 'flare_gun' ? 0xff6a2a : def.id === 'rocket_launcher' ? 0x4d463d : def.id === 'stickybomb_launcher' ? 0x252b34 : 0x2f3940,
      emissive: def.id === 'flare_gun' ? 0x8f270c : 0x000000,
      emissiveIntensity: def.id === 'flare_gun' ? 0.8 : 0,
      roughness: 0.52,
      metalness: 0.35,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x11100f, roughness: 0.72, metalness: 0.2 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb58a42, roughness: 0.44, metalness: 0.28 });

    if (def.id === 'rocket_launcher') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.56, 18), shell);
      body.rotation.z = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.078, 0.18, 18), dark);
      nose.rotation.z = -Math.PI / 2;
      nose.position.x = -0.36;
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.06, 0.13, 18), brass);
      tail.rotation.z = Math.PI / 2;
      tail.position.x = 0.34;
      group.add(body, nose, tail);
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.08), dark);
        fin.position.set(0.22, Math.cos(i * Math.PI / 2) * 0.085, Math.sin(i * Math.PI / 2) * 0.085);
        fin.rotation.x = i * Math.PI / 2;
        group.add(fin);
      }
    } else if (def.id === 'stickybomb_launcher') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.10, 20), shell);
      body.rotation.z = Math.PI / 2;
      const center = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 16), brass);
      center.rotation.z = Math.PI / 2;
      group.add(body, center);
    } else if (def.id === 'grenade_launcher') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.24, 16), shell);
      body.rotation.z = Math.PI / 2;
      const bandA = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 16), brass);
      bandA.rotation.z = Math.PI / 2;
      bandA.position.x = -0.08;
      const bandB = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 16), brass);
      bandB.rotation.z = Math.PI / 2;
      bandB.position.x = 0.08;
      group.add(body, bandA, bandB);
    } else {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.30, 14), shell);
      body.rotation.z = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.12, 14), shell);
      tip.rotation.z = -Math.PI / 2;
      tip.position.x = -0.20;
      group.add(body, tip);
    }
    group.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return group;
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      const previousPos = projectile.pos.clone();
      projectile.age += dt;
      if (projectile.weaponId === 'stickybomb_launcher' && projectile.age >= 0.7) projectile.armed = true;
      projectile.life -= dt;
      if (!projectile.stuck) {
        projectile.vel.y -= projectile.gravity * dt;
        projectile.pos.addScaledVector(projectile.vel, dt);
      }
      projectile.mesh.position.copy(projectile.pos);
      if (projectile.vel.lengthSq() > 0.001) {
        projectile.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), projectile.vel.clone().normalize());
      }

      // Spawning smoke/fire trails behind flying rockets
      if (projectile.weaponId === 'rocket_launcher' && !projectile.stuck) {
        this.particleSystem.spawnFlameSmokeParticles(projectile.pos, 2);
      }

      // Direct mob/player impact collision detection
      let hitTarget = false;
      if (!projectile.stuck) {
        for (const mob of this.entities.localMobs) {
          if (mob.isDead || (mob as any).staticShop || (mob as any).shopKind || mob.aiState === 'shop') continue;
          const dist = mob.position.clone().add(new THREE.Vector3(0, 0.9, 0)).distanceTo(projectile.pos);
          if (dist < 0.75) {
            this.handleProjectileImpact(projectile, mob.id, 'mob');
            hitTarget = true;
            break;
          }
        }
        if (!hitTarget) {
          for (const [id, remote] of this.entities.remotePlayers) {
            if (remote.entity.isDead) continue;
            const dist = remote.entity.position.clone().add(new THREE.Vector3(0, 0.9, 0)).distanceTo(projectile.pos);
            if (dist < 0.75) {
              this.handleProjectileImpact(projectile, id, 'player');
              hitTarget = true;
              break;
            }
          }
        }
      }

      if (hitTarget) {
        this.removeProjectileAt(i);
        continue;
      }

      const blockId = this.world.getVoxel(Math.floor(projectile.pos.x), Math.floor(projectile.pos.y), Math.floor(projectile.pos.z));
      const solid = blockId !== 0 && BlockRegistry.get(blockId)?.isSolid;
      if (solid || projectile.life <= 0) {
        if (projectile.weaponId === 'grenade_launcher' && solid && projectile.age < 2.35 && projectile.bounceCount < 7) {
          projectile.pos.copy(previousPos);
          projectile.vel.x *= -0.48;
          projectile.vel.z *= -0.48;
          projectile.vel.y = Math.abs(projectile.vel.y) * 0.58 + 1.2;
          projectile.bounceCount++;
          continue;
        }
        if (projectile.weaponId === 'stickybomb_launcher' && solid && projectile.life > 0) {
          projectile.pos.copy(previousPos);
          projectile.vel.set(0, 0, 0);
          projectile.stuck = true;
          projectile.mesh.position.copy(projectile.pos);
          continue;
        }
        if (solid || projectile.weaponId === 'grenade_launcher') this.explodeProjectile(projectile);
        this.removeProjectileAt(i);
      }
    }
  }

  private handleProjectileImpact(projectile: RuntimeProjectile, targetId: string, kind: 'mob' | 'player'): void {
    if (projectile.weaponId === 'flare_gun') {
      const hasBurn = this.afterburns.some(a => a.targetId === targetId && a.kind === kind);
      const dmg = hasBurn ? projectile.damage * 3 : projectile.damage;
      if (kind === 'mob') {
        this.entities.damageMob(targetId, dmg);
      } else {
        EventBus.emit('network:sendPvpDamage', { targetUuid: targetId, damage: dmg });
      }
      this.applyAfterburn(targetId, kind, 7.5, 4);
      if (hasBurn) this.postUtilityMessage('[Pyro] Flare CRITICAL hit on burning target!');
    } else if (projectile.weaponId === 'syringe_gun') {
      if (kind === 'mob') {
        this.entities.damageMob(targetId, projectile.damage);
      } else {
        EventBus.emit('network:sendPvpDamage', { targetUuid: targetId, damage: projectile.damage });
      }
    } else {
      this.explodeProjectile(projectile);
    }
  }

  private explodeProjectile(projectile: RuntimeProjectile): void {
    if (projectile.splashRadius <= 0) return;
    EventBus.emit('tf2:blast', {
      x: projectile.pos.x,
      y: projectile.pos.y,
      z: projectile.pos.z,
      radius: projectile.splashRadius,
      force: projectile.weaponId === 'rocket_launcher' ? 18 : 13,
      verticalBias: 0.48,
    });

    const origin = projectile.pos;
    const radius = projectile.splashRadius;
    const baseDamage = projectile.damage;

    // Splash damage to mobs
    for (const mob of this.entities.localMobs) {
      if (mob.isDead || (mob as any).staticShop || (mob as any).shopKind || mob.aiState === 'shop') continue;
      const dist = mob.position.distanceTo(origin);
      if (dist > radius) continue;
      const falloff = 1.0 - (dist / radius);
      const dmg = Math.round(baseDamage * falloff);
      this.entities.damageMob(mob.id, dmg);
    }

    // Splash damage to remote players
    for (const [id, remote] of this.entities.remotePlayers) {
      if (remote.entity.isDead) continue;
      const dist = remote.entity.position.distanceTo(origin);
      if (dist > radius) continue;
      const falloff = 1.0 - (dist / radius);
      const dmg = Math.round(baseDamage * falloff);
      EventBus.emit('network:sendPvpDamage', { targetUuid: id, damage: dmg });
    }

    // Self-damage to local player (blast-jumping)
    const localDist = this.player.position.distanceTo(origin);
    if (localDist < radius) {
      const falloff = 1.0 - (localDist / radius);
      const selfDmg = Math.round(baseDamage * falloff * 0.6);
      this.currentClass.state.health = Math.max(0, this.currentClass.state.health - selfDmg);
      this.postUtilityMessage(`[Fortress] Self-damage: ${selfDmg} HP.`);
    }

    // Spawn burst of explosion fire/smoke particles
    this.particleSystem.spawnFlameSmokeParticles(origin, 14);

    EventBus.emit('tf2:explosion', {
      weaponId: projectile.weaponId,
      pos: projectile.pos.clone(),
      damage: projectile.damage,
      radius: projectile.splashRadius,
    });
  }

  private destroyProjectile(projectile: RuntimeProjectile): void {
    this.renderer.scene.remove(projectile.mesh);
    this.disposeObject(projectile.mesh);
  }

  private disposeGroup(group: THREE.Group): void {
    this.disposeObject(group);
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat?.dispose?.();
    });
  }

  private removeProjectileAt(index: number): void {
    const projectile = this.projectiles[index];
    if (!projectile) return;
    this.destroyProjectile(projectile);
    this.projectiles.splice(index, 1);
  }

  private limitStickybombs(ownerUuid: string): void {
    const stickies = this.projectiles.filter(projectile => projectile.ownerUuid === ownerUuid && projectile.weaponId === 'stickybomb_launcher');
    while (stickies.length > 8) {
      const oldest = stickies.shift();
      if (!oldest) break;
      const index = this.projectiles.indexOf(oldest);
      if (index >= 0) this.removeProjectileAt(index);
    }
  }

  private detonateStickies(): void {
    const ownerUuid = String((window as any).gameNetworkManager?.myUuid || 'local');
    let detonated = 0;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      if (projectile.ownerUuid !== ownerUuid || projectile.weaponId !== 'stickybomb_launcher' || !projectile.armed) continue;
      this.explodeProjectile(projectile);
      this.removeProjectileAt(i);
      detonated++;
    }
    if (detonated > 0) this.postUtilityMessage(`[Demoman] Detonated ${detonated} stickybomb${detonated === 1 ? '' : 's'}.`);
  }

  private fireSpyKnife(origin: THREE.Vector3, direction: THREE.Vector3, ownerUuid: string): void {
    const target = this.findKnifeTarget(origin, direction, 2.35);
    if (!target) {
      EventBus.emit('tf2:melee', { ownerUuid, origin, dir: direction, damage: 40, range: 2.35, backstab: false });
      return;
    }
    const damage = target.backstab ? target.lethalDamage : 40;
    if (target.kind === 'mob') {
      this.entities.damageMob(target.id, damage);
    } else {
      EventBus.emit('network:sendPvpDamage', { targetUuid: target.id, damage });
    }
    EventBus.emit('tf2:knifeHit', { ownerUuid, targetId: target.id, damage, backstab: target.backstab });
    this.postUtilityMessage(target.backstab ? '[Spy] Backstab.' : '[Spy] Knife hit.');
  }

  private findKnifeTarget(origin: THREE.Vector3, direction: THREE.Vector3, range: number): { kind: 'mob' | 'player'; id: string; backstab: boolean; lethalDamage: number } | null {
    let best: { kind: 'mob' | 'player'; id: string; backstab: boolean; lethalDamage: number; distance: number } | null = null;
    for (const mob of this.entities.localMobs) {
      if (mob.isDead || (mob as any).staticShop || (mob as any).shopKind || mob.aiState === 'shop') continue;
      const center = mob.position.clone().add(new THREE.Vector3(0, 0.9, 0));
      const toTarget = center.sub(origin);
      const distance = toTarget.length();
      if (distance > range || distance < 0.05) continue;
      const aimDot = toTarget.normalize().dot(direction);
      if (aimDot < 0.45) continue;
      // Z=-1 is the forward vector in this engine.
      const targetForward = new THREE.Vector3(0, 0, -1).applyEuler(mob.rotation).setY(0).normalize();
      const toAttacker = this.player.position.clone().sub(mob.position).setY(0).normalize();
      const backstab = targetForward.dot(toAttacker) < 0;
      if (!best || distance < best.distance) best = { kind: 'mob', id: mob.id, backstab, lethalDamage: Math.max(mob.maxHealth * 6, mob.health * 6), distance };
    }
    for (const [id, remote] of this.entities.remotePlayers) {
      const center = remote.entity.position.clone().add(new THREE.Vector3(0, 0.9, 0));
      const toTarget = center.sub(origin);
      const distance = toTarget.length();
      if (distance > range || distance < 0.05) continue;
      const aimDot = toTarget.normalize().dot(direction);
      if (aimDot < 0.45) continue;
      const targetForward = new THREE.Vector3(0, 0, -1).applyEuler(remote.entity.rotation).setY(0).normalize();
      const toAttacker = this.player.position.clone().sub(remote.entity.position).setY(0).normalize();
      const backstab = targetForward.dot(toAttacker) < 0;
      const maxHealth = remote.entity.maxHealth || 125;
      if (!best || distance < best.distance) best = { kind: 'player', id, backstab, lethalDamage: maxHealth * 6, distance };
    }
    return best ? { kind: best.kind, id: best.id, backstab: best.backstab, lethalDamage: best.lethalDamage } : null;
  }

  private tryActivateUber(): void {
    if (this.currentClass.profile.id !== 'medic') return;
    if (this.currentClass.state.ubercharge < 1) {
      this.postUtilityMessage(`[Medic] Ubercharge ${Math.round(this.currentClass.state.ubercharge * 100)}%.`);
      return;
    }
    this.currentClass.state.ubercharge = 0;
    this.currentClass.state.invulnerable = true;
    this.medicUberActiveUntil = performance.now() / 1000 + 8;
    EventBus.emit('tf2:uberActivated', { until: this.medicUberActiveUntil });
    this.postUtilityMessage('[Medic] Ubercharge deployed.');
  }

  private findAimedBuilding(maxDistance = 7): TF2BuildingState | null {
    const origin = this.player.position.clone().add(new THREE.Vector3(0, this.player.eyeHeight, 0));
    const direction = this.renderer.camera.getWorldDirection(new THREE.Vector3()).normalize();
    let best: TF2BuildingState | null = null;
    let bestDistance = Infinity;
    for (const building of this.buildings) {
      const center = building.pos.clone().add(new THREE.Vector3(0, 0.55, 0));
      const toBuilding = center.sub(origin);
      const distance = toBuilding.length();
      if (distance > maxDistance || distance < 0.05) continue;
      const aimDot = toBuilding.normalize().dot(direction);
      if (aimDot < 0.72) continue;
      if (distance < bestDistance) {
        best = building;
        bestDistance = distance;
      }
    }
    return best;
  }

  private upgradeAimedBuilding(): void {
    const building = this.findAimedBuilding();
    if (!building) {
      this.postUtilityMessage('[Engineer] Aim at a building to upgrade.');
      return;
    }
    if (building.level >= 3) {
      this.postUtilityMessage('[Engineer] Building already level 3.');
      return;
    }
    const def = TF2_BUILDINGS[building.kind];
    if (!this.currentClass.consumeMetal(def.upgradeCost)) {
      this.postUtilityMessage(`[Engineer] Need ${def.upgradeCost} metal to upgrade.`);
      return;
    }
    building.level++;
    building.maxHealth = Math.round(def.health * (1 + (building.level - 1) * 0.22));
    building.health = building.maxHealth;
    building.mesh.scale.setScalar(1 + (building.level - 1) * 0.13);
    EventBus.emit('tf2:buildingUpgraded', { id: building.id, kind: building.kind, level: building.level });
    this.postUtilityMessage(`[Engineer] ${TF2_BUILDINGS[building.kind].label} upgraded to level ${building.level}.`);
  }

  private destroyAimedBuilding(): void {
    const building = this.findAimedBuilding(8);
    if (!building) {
      this.postUtilityMessage('[Engineer] Aim at a building to destroy.');
      return;
    }
    const index = this.buildings.indexOf(building);
    if (index < 0) return;
    this.disposeGroup(building.mesh);
    this.renderer.scene.remove(building.mesh);
    this.buildings.splice(index, 1);
    EventBus.emit('tf2:buildingDestroyed', { id: building.id, kind: building.kind });
    this.postUtilityMessage(`[Engineer] ${TF2_BUILDINGS[building.kind].label} destroyed.`);
  }

  private toggleBuildPanel(): void {
    if (this.currentClass.profile.id !== 'engineer') return;
    if (this.selectedBuildKind) {
      this.selectedBuildKind = null;
      this.buildPreview.visible = false;
    } else {
      this.selectBuildKind('sentry');
    }
  }

  private selectBuildKind(kind: TF2BuildingKind): void {
    if (this.currentClass.profile.id !== 'engineer') return;
    this.selectedBuildKind = kind;
    this.updateBuildPreview(true);
    this.postUtilityMessage(`[Engineer] ${TF2_BUILDINGS[kind].label} selected. Left-click places, right-click or R rotates.`);
  }

  private placeSelectedBuilding(): void {
    if (!this.selectedBuildKind || this.currentClass.profile.id !== 'engineer') return;
    const placement = this.getBuildPlacement();
    if (!placement.valid) {
      this.postUtilityMessage('[Engineer] Cannot build there.');
      return;
    }
    const def = TF2_BUILDINGS[this.selectedBuildKind];
    if (!this.currentClass.consumeMetal(def.cost)) {
      this.postUtilityMessage(`[Engineer] Need ${def.cost} metal for ${def.label}.`);
      return;
    }
    const mesh = this.createBuildingMesh(def.kind, this.currentClass.state.team);
    mesh.position.copy(placement.pos);
    mesh.rotation.y = this.buildYaw;
    this.renderer.scene.add(mesh);
    this.buildings.push({
      id: `${def.kind}:${Date.now()}:${this.buildings.length}`,
      kind: def.kind,
      team: this.currentClass.state.team,
      pos: placement.pos.clone(),
      yaw: this.buildYaw,
      health: def.health,
      maxHealth: def.health,
      level: 1,
      construction: 0,
      mesh,
      cooldown: 0,
    });
    EventBus.emit('tf2:buildingPlaced', { kind: def.kind, team: this.currentClass.state.team, pos: placement.pos.clone() });
    this.postUtilityMessage(`[Engineer] ${def.label} placed. Metal ${Math.floor(this.currentClass.state.metal)}.`);
  }

  private getBuildPlacement(): { valid: boolean; pos: THREE.Vector3 } {
    const dir = this.renderer.camera.getWorldDirection(new THREE.Vector3());
    dir.y = 0;
    if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
    dir.normalize();
    const x = Math.round(this.player.position.x + dir.x * 4.2);
    const z = Math.round(this.player.position.z + dir.z * 4.2);
    let floorY = Math.floor(this.player.position.y - 1);
    for (let y = Math.floor(this.player.position.y + 2); y >= Math.floor(this.player.position.y - 5); y--) {
      const below = this.world.getVoxel(x, y - 1, z);
      const feet = this.world.getVoxel(x, y, z);
      const head = this.world.getVoxel(x, y + 1, z);
      if (below !== 0 && BlockRegistry.get(below)?.isSolid && feet === 0 && head === 0) {
        floorY = y;
        break;
      }
    }
    const pos = new THREE.Vector3(x + 0.5, floorY, z + 0.5);
    const tooClose = this.buildings.some(building => building.pos.distanceTo(pos) < 2.2);
    const under = this.world.getVoxel(Math.floor(pos.x), Math.floor(pos.y - 1), Math.floor(pos.z));
    const valid = !tooClose && under !== 0 && !!BlockRegistry.get(under)?.isSolid;
    return { valid, pos };
  }

  private updateBuildPreview(forceVisible = false): void {
    if (!this.selectedBuildKind) {
      this.buildPreview.visible = false;
      return;
    }
    if (this.buildPreview.children.length === 0 || this.buildPreview.userData.kind !== this.selectedBuildKind) {
      this.buildPreview.clear();
      const preview = this.createBuildingMesh(this.selectedBuildKind, this.currentClass.state.team, true);
      this.buildPreview.add(preview);
      this.buildPreview.userData.kind = this.selectedBuildKind;
    }
    const placement = this.getBuildPlacement();
    this.buildPreview.position.copy(placement.pos);
    this.buildPreview.rotation.y = this.buildYaw;
    this.buildPreview.visible = forceVisible || true;
    this.buildPreview.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const m = material as THREE.MeshStandardMaterial;
        m.color.setHex(placement.valid ? 0x5fd16f : 0xd15343);
        m.opacity = 0.45;
        m.transparent = true;
      }
    });
  }

  private createBuildingMesh(kind: TF2BuildingKind, team: TF2Team, preview = false): THREE.Group {
    const group = new THREE.Group();
    const teamColor = team === 'RED' ? 0xa6493f : 0x3f6f9d;
    const body = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.64, metalness: 0.12, transparent: preview, opacity: preview ? 0.45 : 1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x605b52, roughness: 0.45, metalness: 0.48, transparent: preview, opacity: preview ? 0.45 : 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x171514, roughness: 0.86, metalness: 0.05, transparent: preview, opacity: preview ? 0.45 : 1 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xf3d179, emissive: 0x604915, emissiveIntensity: preview ? 0.2 : 0.55, roughness: 0.35, transparent: preview, opacity: preview ? 0.45 : 1 });

    const box = (size: [number, number, number], pos: [number, number, number], mat: THREE.Material): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.castShadow = !preview;
      mesh.receiveShadow = !preview;
      group.add(mesh);
    };
    const cyl = (radius: number, height: number, pos: [number, number, number], mat: THREE.Material, axis: 'x' | 'y' | 'z' = 'y'): void => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 18), mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      if (axis === 'x') mesh.rotation.z = Math.PI / 2;
      if (axis === 'z') mesh.rotation.x = Math.PI / 2;
      mesh.castShadow = !preview;
      mesh.receiveShadow = !preview;
      group.add(mesh);
    };

    if (kind === 'sentry') {
      cyl(0.42, 0.16, [0, 0.08, 0], metal);
      box([0.56, 0.32, 0.42], [0, 0.36, 0], body);
      cyl(0.08, 0.82, [-0.42, 0.44, 0], dark, 'x');
      cyl(0.08, 0.82, [-0.42, 0.30, 0], dark, 'x');
      box([0.14, 0.14, 0.20], [0.31, 0.51, 0], glow);
      box([0.12, 0.46, 0.12], [-0.23, 0.08, -0.23], metal,);
      box([0.12, 0.46, 0.12], [0.23, 0.08, -0.23], metal);
      box([0.12, 0.46, 0.12], [0, 0.08, 0.27], metal);
    } else if (kind === 'dispenser') {
      box([0.82, 0.74, 0.52], [0, 0.42, 0], body);
      box([0.62, 0.12, 0.06], [0, 0.62, -0.30], glow);
      box([0.52, 0.18, 0.07], [0, 0.25, -0.30], dark);
      cyl(0.14, 0.18, [-0.28, 0.22, -0.31], metal, 'z');
      cyl(0.14, 0.18, [0.28, 0.22, -0.31], metal, 'z');
    } else {
      cyl(0.48, 0.16, [0, 0.08, 0], body);
      cyl(0.35, 0.10, [0, 0.22, 0], metal);
      cyl(0.22, 0.16, [0, 0.36, 0], glow);
      box([0.12, 0.42, 0.12], [-0.28, 0.28, 0], metal);
      box([0.12, 0.42, 0.12], [0.28, 0.28, 0], metal);
      if (kind === 'teleporter_exit') {
        box([0.20, 0.20, 0.06], [0, 0.58, -0.36], glow);
      }
    }

    return group;
  }

  private updateEngineerBuildings(dt: number): void {
    for (const building of this.buildings) {
      const def = TF2_BUILDINGS[building.kind];
      building.construction = Math.min(1, building.construction + dt / def.buildTime);
      building.cooldown = Math.max(0, building.cooldown - dt);
      if (building.rocketCooldown !== undefined) {
        building.rocketCooldown = Math.max(0, building.rocketCooldown - dt);
      }
      building.mesh.scale.setScalar(THREE.MathUtils.lerp(0.62, 1, building.construction));
      if (building.kind === 'sentry' && building.construction >= 1) {
        this.updateSentry(building, dt);
      }
      if (building.kind === 'dispenser' && building.construction >= 1) {
        const distance = building.pos.distanceTo(this.player.position);
        if (distance < 4.2) {
          this.currentClass.state.health = Math.min(this.currentClass.profile.maxHealth * 1.5, this.currentClass.state.health + dt * 16);
          this.currentClass.state.overheal = Math.max(0, this.currentClass.state.health - this.currentClass.profile.maxHealth);
          this.currentClass.state.metal = Math.min(200, this.currentClass.state.metal + dt * 14);
          this.currentClass.replenishAmmo(dt * 0.15);
        }
      }
    }
    this.updateTeleporterPair(dt);
  }

  private updateSentry(building: TF2BuildingState, dt: number): void {
    const target = this.findSentryTarget(building, building.level >= 3 ? 16 : 12);
    if (!target) {
      building.mesh.rotation.y += dt * 0.9;
      return;
    }
    const aim = target.position.clone().sub(building.pos);
    building.mesh.rotation.y = Math.atan2(aim.x, aim.z);

    // Level 3 Sentry rocket pod firing logic
    if (building.level >= 3) {
      if (building.rocketCooldown === undefined) building.rocketCooldown = 0;
      if (building.rocketCooldown <= 0) {
        const origin = building.pos.clone().add(new THREE.Vector3(0, 0.9, 0));
        const direction = target.position.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(origin).normalize();
        const rocketDef = TF2_WEAPONS.rocket_launcher;
        const mesh = this.createProjectileMesh(rocketDef);
        mesh.position.copy(origin);
        this.renderer.scene.add(mesh);
        this.projectiles.push({
          id: `sentryRocket:${building.id}:${Date.now()}`,
          weaponId: 'rocket_launcher',
          ownerUuid: 'sentry',
          pos: origin,
          vel: direction.multiplyScalar(22),
          radius: 0.18,
          damage: 80,
          splashRadius: 4.5,
          life: 5.0,
          mesh,
          gravity: 0,
          age: 0,
          stuck: false,
          armed: true,
          bounceCount: 0
        });
        building.rocketCooldown = 3.0;
        EventBus.emit('tf2:sentryRocket', { id: building.id, pos: building.pos.clone(), target: target.position.clone(), damage: 80 });
        this.postUtilityMessage('[Engineer] Sentry Level 3 fired rockets!');
      }
    }

    if (building.cooldown > 0) return;
    const damage = building.level === 1 ? 16 : building.level === 2 ? 24 : 32;
    if (target.kind === 'mob') {
      this.entities.damageMob(target.id, damage);
    } else {
      EventBus.emit('network:sendPvpDamage', { targetUuid: target.id, damage });
    }
    EventBus.emit('tf2:sentryFired', { id: building.id, targetId: target.id, damage });
    building.cooldown = building.level === 1 ? 0.8 : 0.5;
  }

  private findSentryTarget(building: TF2BuildingState, radius: number): { kind: 'mob' | 'player'; id: string; position: THREE.Vector3 } | null {
    let best: { kind: 'mob' | 'player'; id: string; position: THREE.Vector3; distance: number } | null = null;
    for (const mob of this.entities.localMobs) {
      if (mob.isDead || (mob as any).staticShop || (mob as any).shopKind || mob.aiState === 'shop') continue;
      const distance = mob.position.distanceTo(building.pos);
      if (distance > radius) continue;
      if (!best || distance < best.distance) best = { kind: 'mob', id: mob.id, position: mob.position.clone(), distance };
    }
    for (const [id, remote] of this.entities.remotePlayers) {
      const distance = remote.entity.position.distanceTo(building.pos);
      if (distance > radius) continue;
      if (!best || distance < best.distance) best = { kind: 'player', id, position: remote.entity.position.clone(), distance };
    }
    return best ? { kind: best.kind, id: best.id, position: best.position } : null;
  }

  private updateTeleporterPair(_dt: number): void {
    const entrance = this.buildings.find(b => b.kind === 'teleporter_entrance' && b.construction >= 1);
    const exit = this.buildings.find(b => b.kind === 'teleporter_exit' && b.construction >= 1);
    if (!entrance || !exit || entrance.cooldown > 0) return;
    if (entrance.pos.distanceTo(this.player.position) > 1.45) return;
    this.player.position.copy(exit.pos).add(new THREE.Vector3(0, 0.55, 0));
    this.player.velocity.set(0, 0, 0);
    entrance.cooldown = 8;
    exit.cooldown = 8;
    EventBus.emit('tf2:teleported', { from: entrance.pos.clone(), to: exit.pos.clone() });
    this.postUtilityMessage('[Engineer] Teleporter used.');
  }

  private toggleSpyCloak(): void {
    if (this.currentClass.profile.id !== 'spy') return;
    const ok = this.currentClass.toggleSpyCloak();
    if (ok) {
      const now = performance.now() / 1000;
      if (this.currentClass.state.cloakActive) {
        this.currentClass.state.cloak = Math.max(0, this.currentClass.state.cloak - 0.12);
        this.postUtilityMessage('[Spy] Cloak shimmer engaged.');
      } else {
        this.spyAttackLockedUntil = now + 0.75;
        this.postUtilityMessage('[Spy] Decloaking.');
      }
    } else {
      this.postUtilityMessage('[Spy] Cloak not ready.');
    }
  }

  private disguiseAsNextEnemy(): void {
    if (this.currentClass.profile.id !== 'spy') return;
    const order = listTF2ClassProfiles().filter(profile => profile.id !== 'spy').map(profile => profile.id);
    const currentIndex = order.indexOf(this.currentClass.state.disguiseClass || 'scout');
    const next = order[(currentIndex + 1 + order.length) % order.length];
    const enemyTeam: TF2Team = this.currentClass.state.team === 'RED' ? 'BLU' : 'RED';
    this.currentClass.disguise(next, enemyTeam);
    this.postUtilityMessage(`[Spy] Disguised as ${getTF2ClassProfile(next).name}.`);
  }

  private syncPlayerHealthFromClass(reset = false): void {
    this.player.maxHealth = Math.ceil(this.currentClass.profile.maxHealth / 10);
    if (reset) {
      this.currentClass.state.health = this.currentClass.profile.maxHealth;
      this.player.health = this.player.maxHealth;
    } else {
      this.player.health = Math.max(1, Math.ceil(this.currentClass.state.health / 10));
    }
    EventBus.emit('player:healthChanged', this.player.health);
  }

  private traceWorld(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): { x: number; y: number; z: number; distance: number; blockId: number } | null {
    const probe = new THREE.Vector3();
    for (let distance = 0; distance <= maxDistance; distance += 0.18) {
      probe.copy(origin).addScaledVector(direction, distance);
      const x = Math.floor(probe.x);
      const y = Math.floor(probe.y);
      const z = Math.floor(probe.z);
      const blockId = this.world.getVoxel(x, y, z);
      if (blockId === 0) continue;
      if (!BlockRegistry.get(blockId)?.isSolid) continue;
      return { x, y, z, distance, blockId };
    }
    return null;
  }

  private updateHud(dt: number): void {
    const players = [{
      uuid: String((window as any).gameNetworkManager?.myUuid || 'local'),
      team: this.currentClass.state.team,
      position: this.player.position.clone(),
      alive: !this.player.isDead,
    }];
    const snapshot = this.mode.tick(dt, players);
    const weaponId = this.getActiveWeaponId();
    const sniperInfo = this.currentClass.profile.id === 'sniper'
      ? `<span>Scope ${this.sniperScoped ? 'on' : 'off'} · Charge ${Math.round(this.sniperCharge * 100)}%</span>`
      : '';
    const engineerInfo = this.currentClass.profile.id === 'engineer'
      ? `<span>Metal ${Math.floor(this.currentClass.state.metal)} · Buildings ${this.buildings.length}</span>`
      : '';
    const medicInfo = this.currentClass.profile.id === 'medic'
      ? `<span>Uber ${Math.round(this.currentClass.state.ubercharge * 100)}%</span>`
      : '';
    const spyInfo = this.currentClass.profile.id === 'spy'
      ? `<span>Cloak ${Math.round(this.currentClass.state.cloak * 100)}%${this.currentClass.state.disguiseClass ? ` · ${getTF2ClassProfile(this.currentClass.state.disguiseClass).name}` : ''}</span>`
      : '';
    this.hud.innerHTML = `
      <div><strong>${this.currentClass.profile.name}</strong><span>${this.currentClass.profile.role} · ${this.currentClass.profile.maxHealth} HP</span></div>
      <div><strong>${snapshot.phase}</strong><span>${snapshot.label}</span></div>
      <div><strong>${Math.ceil(snapshot.timer)}s</strong><span>${snapshot.mode}</span></div>
      <div><strong>${getTF2WeaponDisplayName(weaponId)}</strong><span>Slot ${this.currentClass.state.selectedSlot}</span>${sniperInfo}${engineerInfo}${medicInfo}${spyInfo}</div>
    `;
  }

  private updateBuildHud(): void {
    if (this.currentClass.profile.id !== 'engineer') return;
    this.buildHud.querySelectorAll<HTMLButtonElement>('[data-build]').forEach(button => {
      const kind = String(button.dataset.build) as TF2BuildingKind;
      const def = TF2_BUILDINGS[kind];
      button.classList.toggle('selected', this.selectedBuildKind === kind);
      button.disabled = this.currentClass.state.metal < def.cost;
      const label = button.querySelector('span');
      if (label) label.textContent = `${def.label} · ${def.cost}`;
    });
    const metal = this.buildHud.querySelector<HTMLElement>('[data-metal]');
    if (metal) metal.textContent = `${Math.floor(this.currentClass.state.metal)} metal`;
  }

  private modeFromDimension(dimension: string): TF2ModeKind {
    if (dimension === 'tf2_koth') return 'koth';
    if (dimension === 'tf2_cp') return 'control_points';
    if (dimension === 'tf2_ctf') return 'ctf';
    return 'payload';
  }

  private postUtilityMessage(message: string): void {
    const now = performance.now();
    if (now - this.lastUtilityMessageAt < 300) return;
    this.lastUtilityMessageAt = now;
    EventBus.emit('network:chat', message);
  }

  private createClassOverlay(): HTMLDivElement {
    this.injectStyles();
    const root = document.createElement('div');
    root.id = 'tf2-root';
    root.innerHTML = `
      <div class="tf2-panel">
        <header><strong>Fortress Classes</strong><span>Press comma in-match to reopen</span></header>
        <div class="tf2-class-grid">
          ${listTF2ClassProfiles().map(profile => `
            <button data-class="${profile.id}">
              <strong>${profile.name}</strong>
              <span>${profile.role} · ${profile.maxHealth} HP · ${(profile.speedScale * 100).toFixed(0)}% speed</span>
              <em>${getTF2WeaponDisplayName(profile.primary)} / ${getTF2WeaponDisplayName(profile.secondary)} / ${getTF2WeaponDisplayName(profile.melee)}</em>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  private createHud(): HTMLDivElement {
    const hud = document.createElement('div');
    hud.id = 'tf2-hud';
    document.body.appendChild(hud);
    return hud;
  }

  private createBuildHud(): HTMLDivElement {
    const hud = document.createElement('div');
    hud.id = 'tf2-build-hud';
    hud.innerHTML = `
      <strong>Engineer PDA</strong>
      <span data-metal>200 metal</span>
      <button data-build="sentry" type="button"><kbd>4</kbd><span>Sentry Gun · 130</span></button>
      <button data-build="dispenser" type="button"><kbd>5</kbd><span>Dispenser · 100</span></button>
      <button data-build="teleporter_entrance" type="button"><kbd>6</kbd><span>Entrance · 50</span></button>
      <button data-build="teleporter_exit" type="button"><kbd>7</kbd><span>Exit · 50</span></button>
    `;
    document.body.appendChild(hud);
    return hud;
  }

  private injectStyles(): void {
    if (document.getElementById('tf2-styles')) return;
    const style = document.createElement('style');
    style.id = 'tf2-styles';
    style.textContent = `
      #tf2-root {
        position: fixed;
        inset: 0;
        z-index: 3200;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(8, 10, 12, 0.58);
        color: #f5efe4;
        font-family: Inter, Segoe UI, Arial, sans-serif;
      }
      #tf2-root.visible { display: flex; }
      .tf2-panel {
        width: min(980px, calc(100vw - 32px));
        padding: 16px;
        border: 1px solid rgba(245,239,228,0.22);
        border-radius: 7px;
        background: rgba(33, 35, 34, 0.96);
        box-shadow: 0 26px 90px rgba(0,0,0,0.58);
      }
      .tf2-panel header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .tf2-panel header strong { font-size: 28px; }
      .tf2-panel header span { color: rgba(245,239,228,0.68); font-size: 13px; }
      .tf2-class-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .tf2-class-grid button {
        min-height: 104px;
        padding: 12px;
        text-align: left;
        border: 1px solid rgba(245,239,228,0.12);
        border-radius: 6px;
        color: #f5efe4;
        background: linear-gradient(135deg, #62322b, #253f5d);
        cursor: pointer;
      }
      .tf2-class-grid button:hover { border-color: #f4c36b; filter: brightness(1.08); }
      .tf2-class-grid strong, .tf2-class-grid span, .tf2-class-grid em { display: block; }
      .tf2-class-grid span { margin-top: 6px; color: rgba(245,239,228,0.74); font-size: 12px; }
      .tf2-class-grid em { margin-top: 8px; color: #f4c36b; font-style: normal; font-size: 12px; }
      #tf2-hud {
        position: fixed;
        left: 50%;
        top: 14px;
        transform: translateX(-50%);
        z-index: 2500;
        display: none;
        grid-template-columns: repeat(4, minmax(130px, auto));
        gap: 8px;
        color: #f5efe4;
        font-family: Inter, Segoe UI, Arial, sans-serif;
        pointer-events: none;
      }
      #tf2-hud.visible { display: grid; }
      #tf2-hud div {
        min-height: 44px;
        padding: 8px 12px;
        border: 1px solid rgba(245,239,228,0.16);
        border-radius: 6px;
        background: rgba(30, 32, 34, 0.86);
        box-shadow: 0 8px 24px rgba(0,0,0,0.28);
      }
      #tf2-hud strong, #tf2-hud span { display: block; }
      #tf2-hud span { margin-top: 2px; color: rgba(245,239,228,0.68); font-size: 11px; }
      #tf2-build-hud {
        position: fixed;
        right: 14px;
        bottom: 96px;
        z-index: 2500;
        display: none;
        width: 242px;
        padding: 10px;
        border: 1px solid rgba(245,239,228,0.18);
        border-radius: 7px;
        background: rgba(35, 32, 29, 0.88);
        color: #f5efe4;
        font-family: Inter, Segoe UI, Arial, sans-serif;
      }
      #tf2-build-hud.visible { display: grid; gap: 6px; }
      #tf2-build-hud strong { font-size: 15px; }
      #tf2-build-hud [data-metal] { color: #f4c36b; font-size: 12px; }
      #tf2-build-hud button {
        display: grid;
        grid-template-columns: 28px 1fr;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        border: 1px solid rgba(245,239,228,0.14);
        border-radius: 5px;
        background: rgba(92, 70, 50, 0.82);
        color: #f5efe4;
        text-align: left;
        cursor: pointer;
      }
      #tf2-build-hud button.selected { border-color: #f4c36b; background: rgba(117, 89, 48, 0.96); }
      #tf2-build-hud button:disabled { opacity: 0.44; cursor: default; }
      #tf2-build-hud kbd {
        display: inline-grid;
        place-items: center;
        min-width: 22px;
        height: 22px;
        border-radius: 4px;
        background: rgba(0,0,0,0.28);
        font: 700 12px/1 Inter, Segoe UI, Arial, sans-serif;
      }
      #tf2-build-hud span { font-size: 12px; }
      @media (max-width: 760px) {
        .tf2-class-grid { grid-template-columns: 1fr; }
        #tf2-hud { left: 8px; right: 8px; transform: none; grid-template-columns: 1fr 1fr; }
        #tf2-build-hud { left: 8px; right: 8px; bottom: 84px; width: auto; }
      }
    `;
    document.head.appendChild(style);
  }
}
