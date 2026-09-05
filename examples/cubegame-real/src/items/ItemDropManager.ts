import * as THREE from 'three';
import { ItemDropEntity } from '../entities/EntityTypes';
import { WorldManager } from '../world/WorldManager';
import { BlockRegistry } from '../world/BlockRegistry';
import { ItemRegistry } from './ItemRegistry';
import { Inventory } from '../inventory/Inventory';
import { AudioManager } from '../audio/AudioManager';
import { EventBus } from '../core/EventBus';
import { TextureGenerator } from '../graphics/TextureGenerator';


export interface ItemDropSpawnOptions {
  id?: string;
  velocity?: THREE.Vector3;
  network?: boolean;
  pickupDelay?: number;
}

export class ItemDropManager {
  private scene: THREE.Scene;
  private world: WorldManager;
  private inventory: Inventory;
  private textureAtlas: THREE.Texture;

  public drops: ItemDropEntity[] = [];
  private itemMaterial: THREE.MeshLambertMaterial;

  constructor(scene: THREE.Scene, world: WorldManager, inventory: Inventory, textureAtlas: THREE.Texture) {
    this.scene = scene;
    this.world = world;
    this.inventory = inventory;
    this.textureAtlas = textureAtlas;

    // Standard material using the generated atlas for miniature blocks
    this.itemMaterial = new THREE.MeshLambertMaterial({
      map: textureAtlas
    });

    EventBus.on('item:spawn', (pos: THREE.Vector3, itemId: number, count?: number) => {
      this.spawn(pos, itemId, count || 1);
    });
  }

  public spawn(pos: THREE.Vector3, blockId: number, count: number = 1, options: ItemDropSpawnOptions = {}): string {
    const id = options.id || Math.random().toString(36).substring(2, 11);

    // Remote packets can arrive twice after reconnect/snapshot. Keep one copy.
    if (this.drops.some(drop => drop.id === id)) return id;
    
    const mesh = new THREE.Group();
    mesh.add(this.createDropVisual(blockId));

    mesh.position.copy(pos);
    this.scene.add(mesh);

    // Drop physics velocity: small horizontal spray + upward pop. Network packets
    // include velocity so every player sees the same pickup land in the same spot.
    const velocity = options.velocity ? options.velocity.clone() : new THREE.Vector3(
      (Math.random() - 0.5) * 1.5,
      2.5,
      (Math.random() - 0.5) * 1.5
    );

    const drop: ItemDropEntity = {
      id,
      type: 'item_drop',
      position: pos.clone(),
      velocity,
      rotation: new THREE.Euler(0, Math.random() * Math.PI, 0),
      dimensions: new THREE.Vector3(0.3, 0.3, 0.3),
      grounded: false,
      blockId,
      count,
      age: 0,
      pickupDelay: options.pickupDelay ?? 1.1,
      mesh
    };

    this.drops.push(drop);

    if (options.network !== false) {
      EventBus.emit('item:networkSpawned', {
        id,
        itemId: blockId,
        count,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: velocity.x,
        vy: velocity.y,
        vz: velocity.z,
      });
    }

    return id;
  }

  public update(dt: number, playerPos: THREE.Vector3): void {
    const gravity = -18.0;
    const magnetDist = 4.5;
    const collectDist = 0.85;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;

      // Never simulate or pick up drops inside unloaded chunks. This prevents
      // client-only item drift/pickups that can desync multiplayer server history.
      if (!this.world.isColumnReady(d.position)) {
        d.velocity.set(0, 0, 0);
        d.grounded = true;
        if (d.mesh) d.mesh.position.copy(d.position);
        continue;
      }

      const dist = d.position.distanceTo(playerPos);

      // Magnet check (accelerate towards player after pickup delay)
      if (d.age > d.pickupDelay && dist < magnetDist) {
        // Disable standard gravity, fly straight to player chest height
        const target = playerPos.clone().add(new THREE.Vector3(0, 0.8, 0));
        const pullDir = new THREE.Vector3().subVectors(target, d.position).normalize();
        const pullSpeed = THREE.MathUtils.lerp(3.0, 9.0, (magnetDist - dist) / magnetDist);

        d.velocity.copy(pullDir.multiplyScalar(pullSpeed));
        d.position.addScaledVector(d.velocity, dt);
        d.grounded = false;

        // Collision check
        if (dist < collectDist) {
          // Add to inventory
          const leftovers = this.inventory.addItem(d.blockId, d.count);
          if (leftovers === 0) {
            // Picked up successfully
            AudioManager.playItemPickup();
            EventBus.emit('item:networkPickedUp', { id: d.id });
            if (d.mesh) this.scene.remove(d.mesh);
            this.drops.splice(i, 1);
            continue;
          } else {
            // Inventory full, update stack count if some were collected
            d.count = leftovers;
            d.velocity.set(0, 2.0, 0); // bounce off player
            d.age = 0; // reset delay
          }
        }
      } else {
        // Standard projectile physics (gravity + bounce on ground)
        if (!d.grounded) {
          const currentBlock = this.world.getVoxel(Math.floor(d.position.x), Math.floor(d.position.y), Math.floor(d.position.z));
          if (BlockRegistry.get(currentBlock).isWater) {
            d.velocity.y += 5.5 * dt;
            d.velocity.multiplyScalar(Math.exp(-2.8 * dt));
            d.velocity.y = THREE.MathUtils.clamp(d.velocity.y, -0.6, 0.85);
          } else {
            d.velocity.y += gravity * dt;
          }
        }

        // Apply friction
        d.velocity.x *= Math.exp(-2.0 * dt);
        d.velocity.z *= Math.exp(-2.0 * dt);

        d.position.addScaledVector(d.velocity, dt);

        // Simple ground collision: drop items land at Y floor levels
        // (Voxel lookup: check underneath block)
        const feetY = Math.floor(d.position.y);
        const blockUnder = Math.floor(d.position.y - 0.05);
        const voxel = this.world.getVoxel(Math.floor(d.position.x), blockUnder, Math.floor(d.position.z));
        
        if (voxel !== 0 && BlockRegistry.get(voxel).isSolid) {
          d.position.y = blockUnder + 1.0;
          d.velocity.set(0, 0, 0);
          d.grounded = true;
        } else {
          d.grounded = false;
        }
      }

      // Render translations (tumble rotating + levitation bobbing)
      if (d.mesh) {
        d.mesh.position.copy(d.position);
        
        // Add vertical floating sine wave
        const floatOffset = Math.sin(d.age * 3.5) * 0.05;
        d.mesh.children[0].position.y = floatOffset;
        
        // Tumbling rotation
        d.mesh.children[0].rotation.y += 1.8 * dt;
        d.mesh.children[0].rotation.x += 0.8 * dt;
      }
    }
  }

  public removeById(id: string): void {
    const index = this.drops.findIndex(drop => drop.id === id);
    if (index < 0) return;

    const drop = this.drops[index];
    if (drop.mesh) { this.scene.remove(drop.mesh); this.disposeDropObject(drop.mesh); }
    this.drops.splice(index, 1);
  }

  public clear(): void {
    for (const d of this.drops) {
      if (d.mesh) { this.scene.remove(d.mesh); this.disposeDropObject(d.mesh); }
    }
    this.drops = [];
  }

  private disposeDropObject(object: THREE.Object3D): void {
    object.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose?.();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (mat && mat !== this.itemMaterial) mat.dispose();
      }
    });
  }

  private createDropVisual(itemId: number): THREE.Object3D {
    if (ItemRegistry.shouldRenderAsBlock(itemId) && BlockRegistry.isPlaceableBlock(itemId)) {
      const size = 0.22;
      const geometry = new THREE.BoxGeometry(size, size, size);
      this.applyBlockUVs(geometry, itemId);

      const cube = new THREE.Mesh(geometry, this.itemMaterial);
      cube.castShadow = true;
      cube.receiveShadow = false;
      return cube;
    }

    const iconVisual = this.createExtrudedItemIcon(itemId);
    if (iconVisual) return iconVisual;

    const group = new THREE.Group();
    const matWood = new THREE.MeshLambertMaterial({ color: 0x8d5a2b });

    if (itemId >= 220 && itemId <= 264) {
      const toolType = Math.floor((itemId - 220) / 5);
      const tier = (itemId - 220) % 5;

      let headColor = 0x866043;
      if (tier === 1) headColor = 0x8b8b8b;
      else if (tier === 2) headColor = 0xe2e2e2;
      else if (tier === 3) headColor = 0xf4c430;
      else if (tier === 4) headColor = 0x4ee2ec;

      const headMat = new THREE.MeshLambertMaterial({ color: headColor });
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.28, 0.035), matWood);
      handle.rotation.z = -0.6;

      if (toolType === 0) {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.055), headMat);
        head.rotation.z = -0.6;
        head.position.set(-0.05, 0.11, 0);
        group.add(handle, head);
      } else if (toolType === 3) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.28, 0.045), headMat);
        blade.position.set(-0.04, 0.09, 0);
        blade.rotation.z = -0.6;
        group.add(handle, blade);
      } else {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.055), headMat);
        head.rotation.z = -0.6;
        head.position.set(-0.05, 0.11, 0);
        group.add(handle, head);
      }
    } else if (itemId === 200) {
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.28, 0.035), matWood);
      stick.rotation.z = -0.6;
      group.add(stick);
    } else if (itemId === 280 || itemId === 285) {
      const appleColor = itemId === 285 ? 0xffd700 : 0xd83a2e;
      const apple = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshLambertMaterial({ color: appleColor }));
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.04), new THREE.MeshLambertMaterial({ color: 0x6dae39 }));
      leaf.position.set(0.03, 0.08, 0);
      group.add(apple, leaf);
    } else {
      let itemColor = 0xd9d9d9;
      if (itemId === 201) itemColor = 0x222222;
      else if (itemId === 202) itemColor = 0xbfbfbf;
      else if (itemId === 203) itemColor = 0xe6b800;
      else if (itemId === 204) itemColor = 0x4ee2ec;

      group.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.04), new THREE.MeshLambertMaterial({ color: itemColor })));
    }

    return group;
  }


  private createExtrudedItemIcon(itemId: number): THREE.Object3D | null {
    const dataUrl = TextureGenerator.getItemIconDataURL(itemId);
    if (!dataUrl) return null;

    const texture = new THREE.TextureLoader().load(dataUrl);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    (texture as any).colorSpace = (THREE as any).SRGBColorSpace || (THREE as any).sRGBEncoding;

    const geometry = new THREE.BoxGeometry(0.26, 0.26, 0.055);
    const face = new THREE.MeshLambertMaterial({ map: texture, transparent: true, alphaTest: 0.08 });
    const side = new THREE.MeshLambertMaterial({ color: 0x6f6a55 });
    const mesh = new THREE.Mesh(geometry, [side, side, side, side, face, face]);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }

  private applyBlockUVs(geometry: THREE.BufferGeometry, blockId: number): void {
    const texIdx = BlockRegistry.getFaceTextureIndex(blockId, 0);
    const cols = 16;
    const rows = 96;
    const uMin = (texIdx % cols) / cols;
    const uMax = uMin + 1 / cols;
    const vMax = 1.0 - Math.floor(texIdx / cols) / rows;
    const vMin = vMax - 1 / rows;

    const uvs = new Float32Array([
      uMax, vMax, uMin, vMax, uMin, vMin, uMax, vMin,
      uMin, vMax, uMax, vMax, uMax, vMin, uMin, vMin,
      uMin, vMax, uMax, vMax, uMax, vMin, uMin, vMin,
      uMin, vMin, uMax, vMin, uMax, vMax, uMin, vMax,
      uMin, vMax, uMax, vMax, uMax, vMin, uMin, vMin,
      uMax, vMax, uMin, vMax, uMin, vMin, uMax, vMin
    ]);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
}
