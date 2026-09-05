import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';
import { Inventory } from '../inventory/Inventory';
import { PlayerController } from '../player/PlayerController';
import { Renderer } from '../graphics/Renderer';
import { WorldManager } from '../world/WorldManager';
import { BlockRegistry } from '../world/BlockRegistry';

export interface BaseWeaponHit {
  hit: boolean;
  x?: number;
  y?: number;
  z?: number;
  distance: number;
}

export class BaseWeapon {
  public readonly itemId = 620;
  public readonly name = 'Baseline Sidearm';
  private readonly muzzle = new THREE.Vector3();
  private readonly traceStep = 0.18;
  private lastShotAt = 0;
  private enabled = false;

  constructor(
    private inventory: Inventory,
    private player: PlayerController,
    private renderer: Renderer,
    private world: WorldManager
  ) {
    EventBus.on('mouse:leftClick', () => this.tryFire());
  }

  public enable(): void {
    this.enabled = true;
    this.installToInventory();
  }

  public disable(): void {
    this.enabled = false;
  }

  public installToInventory(): void {
    const active = this.inventory.getActiveSlotIndex();
    this.inventory.setSlot(active, { id: this.itemId, count: 1, customName: this.name });
    this.renderer.updateHandMeshBlock(this.itemId);
    EventBus.emit('inventory:updated');
    EventBus.emit('network:chat', '[Baseline] Sidearm equipped. Left-click fires a raycast shot.');
  }

  public tryFire(): BaseWeaponHit | null {
    if (!this.enabled || InputManager.isUIActive || this.player.isDead || this.player.isSpectator) return null;
    const active = this.inventory.getSlot(this.inventory.getActiveSlotIndex());
    if (!active || active.id !== this.itemId) return null;

    const now = performance.now();
    if (now - this.lastShotAt < 175) return null;
    this.lastShotAt = now;

    const direction = this.renderer.camera.getWorldDirection(new THREE.Vector3()).normalize();
    this.muzzle.copy(this.player.position).add(new THREE.Vector3(0, this.player.eyeHeight, 0));
    const hit = this.trace(this.muzzle, direction, 64);
    this.renderer.playGunRecoil(0.72);
    console.log('Shot Fired', {
      weapon: this.name,
      hit: hit.hit,
      x: hit.x,
      y: hit.y,
      z: hit.z,
      distance: Number(hit.distance.toFixed(2)),
    });
    document.body.dataset.baselineLastShot = JSON.stringify({
      weapon: this.name,
      hit: hit.hit,
      distance: Number(hit.distance.toFixed(2)),
      at: Date.now(),
    });
    EventBus.emit('baseline:shotFired', hit);
    return hit;
  }

  private trace(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): BaseWeaponHit {
    const probe = new THREE.Vector3();
    for (let dist = 0; dist <= maxDistance; dist += this.traceStep) {
      probe.copy(origin).addScaledVector(direction, dist);
      const x = Math.floor(probe.x);
      const y = Math.floor(probe.y);
      const z = Math.floor(probe.z);
      const blockId = this.world.getVoxel(x, y, z);
      if (blockId === 0) continue;
      const block = BlockRegistry.get(blockId);
      if (!block.isSolid) continue;
      return { hit: true, x, y, z, distance: dist };
    }
    return { hit: false, distance: maxDistance };
  }
}
