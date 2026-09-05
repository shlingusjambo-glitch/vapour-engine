import * as THREE from 'three';
import { WorldManager } from '../../world/WorldManager';
import { BlockRegistry } from '../../world/BlockRegistry';

interface Limb {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angular: THREE.Vector3;
}

interface Ragdoll {
  limbs: Limb[];
  expiresAt: number;
}

export class RagdollSystem {
  private ragdolls: Ragdoll[] = [];

  constructor(private scene: THREE.Scene) {}

  public spawn(position: THREE.Vector3, finalVelocity: THREE.Vector3, color = 0xc74338): void {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f2428, roughness: 0.86, metalness: 0.02 });
    const pieces: Array<{ size: [number, number, number]; offset: [number, number, number]; mat: THREE.Material }> = [
      { size: [0.48, 0.42, 0.34], offset: [0, 1.38, 0], mat: material },
      { size: [0.58, 0.70, 0.34], offset: [0, 0.86, 0], mat: material },
      { size: [0.18, 0.62, 0.18], offset: [-0.42, 0.9, 0], mat: dark },
      { size: [0.18, 0.62, 0.18], offset: [0.42, 0.9, 0], mat: dark },
      { size: [0.20, 0.72, 0.20], offset: [-0.18, 0.22, 0], mat: dark },
      { size: [0.20, 0.72, 0.20], offset: [0.18, 0.22, 0], mat: dark },
    ];
    const limbs = pieces.map((piece, index) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...piece.size), piece.mat);
      mesh.position.copy(position).add(new THREE.Vector3(...piece.offset));
      mesh.rotation.set(Math.random() * 0.4, Math.random() * 0.4, Math.random() * 0.4);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return {
        mesh,
        velocity: finalVelocity.clone().multiplyScalar(0.55 + Math.random() * 0.22).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.6, (Math.random() - 0.5) * 3)),
        angular: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5 + index),
      };
    });
    this.ragdolls.push({ limbs, expiresAt: performance.now() + 10_000 });
  }

  public update(dt: number, world?: WorldManager): void {
    const now = performance.now();
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const ragdoll = this.ragdolls[i];
      for (const limb of ragdoll.limbs) {
        limb.velocity.y -= 18 * dt;
        limb.mesh.position.addScaledVector(limb.velocity, dt);
        limb.mesh.rotation.x += limb.angular.x * dt;
        limb.mesh.rotation.y += limb.angular.y * dt;
        limb.mesh.rotation.z += limb.angular.z * dt;

        let grounded = false;
        let groundY = 0;

        if (world) {
          const lx = Math.floor(limb.mesh.position.x);
          const ly = Math.floor(limb.mesh.position.y);
          const lz = Math.floor(limb.mesh.position.z);
          const blockId = world.getVoxel(lx, ly, lz);
          const blockBelowId = world.getVoxel(lx, ly - 1, lz);
          const isSolid = blockId !== 0 && BlockRegistry.get(blockId)?.isSolid;
          const isBelowSolid = blockBelowId !== 0 && BlockRegistry.get(blockBelowId)?.isSolid;

          if (isSolid) {
            grounded = true;
            groundY = ly + 1.0;
          } else if (isBelowSolid && limb.mesh.position.y - ly < 0.15) {
            grounded = true;
            groundY = ly;
          }
        } else {
          if (limb.mesh.position.y < 64.08) {
            grounded = true;
            groundY = 64.08;
          }
        }

        if (grounded) {
          limb.mesh.position.y = groundY;
          limb.velocity.y = Math.abs(limb.velocity.y) * 0.18;
          limb.velocity.x *= 0.72;
          limb.velocity.z *= 0.72;
          limb.angular.multiplyScalar(0.75);
        }
      }
      if (now >= ragdoll.expiresAt) {
        for (const limb of ragdoll.limbs) {
          this.scene.remove(limb.mesh);
          limb.mesh.geometry.dispose();
        }
        this.ragdolls.splice(i, 1);
      }
    }
  }
}

