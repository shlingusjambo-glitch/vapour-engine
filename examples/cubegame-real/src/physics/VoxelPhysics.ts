import * as THREE from 'three';
import { AABB } from './AABB';
import { WorldManager } from '../world/WorldManager';
import { BlockRegistry } from '../world/BlockRegistry';

export class VoxelPhysics {
  private world: WorldManager;

  // Pre-allocated object pools and scratch vectors to achieve zero-allocation runtime performance
  private nearbyColliders: AABB[] = [];
  private poolIndex = 0;
  private stepColliders: AABB[] = [];
  private stepPoolIndex = 0;
  private scratchDisplacement = new THREE.Vector3();
  private scratchTestPos = new THREE.Vector3();
  
  private playerAABB = new AABB(new THREE.Vector3(), new THREE.Vector3());
  private testAABB = new AABB(new THREE.Vector3(), new THREE.Vector3());

  constructor(world: WorldManager) {
    this.world = world;

    // Pre-allocate collider AABBs to prevent garbage collector pressure during high frequency updates
    for (let i = 0; i < 256; i++) {
      this.nearbyColliders.push(new AABB(new THREE.Vector3(), new THREE.Vector3()));
      this.stepColliders.push(new AABB(new THREE.Vector3(), new THREE.Vector3()));
    }
  }

  /**
   * Moves an AABB through the voxel world, colliding and sliding against solid blocks.
   * Modifies position and velocity in-place.
   * Returns whether the object is grounded.
   */
  public move(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    dimensions: THREE.Vector3, // width, height, depth (usually 0.6, 1.8, 0.6)
    dt: number,
    isSubmerged: boolean,
    wasGrounded: boolean
  ): { grounded: boolean; hitCeiling: boolean } {
    let grounded = false;
    let hitCeiling = false;

    // Apply movement step using reusable displacement vector
    const displacement = this.scratchDisplacement.copy(velocity).multiplyScalar(dt);

    const halfW = dimensions.x / 2;
    const halfD = dimensions.z / 2;

    // Set player bounding box boundaries
    this.playerAABB.min.set(position.x - halfW, position.y, position.z - halfD);
    this.playerAABB.max.set(position.x + halfW, position.y + dimensions.y, position.z + halfD);

    // 1. Resolve X Axis
    if (displacement.x !== 0) {
      position.x += displacement.x;
      this.updateAABB(this.playerAABB, position, dimensions);
      const count = this.getNearbySolidBlockAABBs(this.playerAABB);
      
      for (let i = 0; i < count; i++) {
        const box = this.nearbyColliders[i];
        if (this.playerAABB.intersects(box)) {
          // Collision! Try stepping up (only if already on the ground)
          const stepSuccess = wasGrounded && this.tryStepUp(position, velocity, dimensions, this.playerAABB);
          if (!stepSuccess) {
            // Push out of solid along X
            if (displacement.x > 0) {
              position.x = box.min.x - halfW - 0.0001;
            } else {
              position.x = box.max.x + halfW + 0.0001;
            }
            velocity.x = 0;
            this.updateAABB(this.playerAABB, position, dimensions);
          } else {
            break; // Succeeded stepping up, no further horizontal collisions on this axis
          }
        }
      }
    }

    // 2. Resolve Z Axis
    if (displacement.z !== 0) {
      position.z += displacement.z;
      this.updateAABB(this.playerAABB, position, dimensions);
      const count = this.getNearbySolidBlockAABBs(this.playerAABB);

      for (let i = 0; i < count; i++) {
        const box = this.nearbyColliders[i];
        if (this.playerAABB.intersects(box)) {
          // Collision! Try stepping up (only if already on the ground)
          const stepSuccess = wasGrounded && this.tryStepUp(position, velocity, dimensions, this.playerAABB);
          if (!stepSuccess) {
            // Push out along Z
            if (displacement.z > 0) {
              position.z = box.min.z - halfD - 0.0001;
            } else {
              position.z = box.max.z + halfD + 0.0001;
            }
            velocity.z = 0;
            this.updateAABB(this.playerAABB, position, dimensions);
          } else {
            break; // Succeeded stepping up, no further horizontal collisions on this axis
          }
        }
      }
    }

    // 3. Resolve Y Axis
    if (displacement.y !== 0) {
      position.y += displacement.y;
      this.updateAABB(this.playerAABB, position, dimensions);
      const count = this.getNearbySolidBlockAABBs(this.playerAABB);

      for (let i = 0; i < count; i++) {
        const box = this.nearbyColliders[i];
        if (this.playerAABB.intersects(box)) {
          if (displacement.y < 0) {
            // Landing on ground
            position.y = box.max.y + 0.0001;
            velocity.y = 0;
            grounded = true;
          } else {
            // Bumping ceiling
            position.y = box.min.y - dimensions.y - 0.0001;
            velocity.y = 0;
            hitCeiling = true;
          }
          this.updateAABB(this.playerAABB, position, dimensions);
        }
      }
    }

    return { grounded, hitCeiling };
  }

  private updateAABB(aabb: AABB, pos: THREE.Vector3, dim: THREE.Vector3): void {
    const halfW = dim.x / 2;
    const halfD = dim.z / 2;
    aabb.min.set(pos.x - halfW, pos.y, pos.z - halfD);
    aabb.max.set(pos.x + halfW, pos.y + dim.y, pos.z + halfD);
  }

  /**
   * Attempt to climb a step (e.g. grass blocks, slabs) using independent stepColliders pool
   */
  private tryStepUp(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    dimensions: THREE.Vector3,
    originalAABB: AABB
  ): boolean {
    // We want to find the highest solid surface we are colliding with horizontally.
    // Query the solid blocks at our current horizontal position (which has already moved)
    // but at our original height.
    const count = this.getNearbySolidBlockAABBsForStep(originalAABB);
    
    let highestStepY = position.y;
    let collided = false;
    
    for (let i = 0; i < count; i++) {
      const box = this.stepColliders[i];
      // If we intersect the block, and it's a step (top is above our feet, but within step assist height)
      if (originalAABB.intersects(box)) {
        collided = true;
        if (box.max.y > highestStepY && box.max.y <= position.y + 1.05) {
          highestStepY = box.max.y;
        }
      }
    }
    
    if (!collided || highestStepY <= position.y) {
      return false;
    }
    
    // Test if player fits at the step height
    const testPos = this.scratchTestPos.copy(position);
    testPos.y = highestStepY + 0.0001;
    
    this.updateAABB(this.testAABB, testPos, dimensions);
    
    // Check if player would collide with anything at this new height
    const testCount = this.getNearbySolidBlockAABBsForStep(this.testAABB);
    let stepCollision = false;
    for (let i = 0; i < testCount; i++) {
      if (this.testAABB.intersects(this.stepColliders[i])) {
        stepCollision = true;
        break;
      }
    }
    
    if (!stepCollision) {
      // Step succeeded! Snap to the step height
      position.copy(testPos);
      originalAABB.min.copy(this.testAABB.min);
      originalAABB.max.copy(this.testAABB.max);
      return true;
    }
    
    return false;
  }

  /**
   * Queries nearby solid block AABBs within a broadphase search area
   * Returns the count of solid colliders found (populates nearbyColliders array)
   */
  public getNearbySolidBlockAABBs(aabb: AABB): number {
    this.poolIndex = 0;

    const minX = Math.floor(aabb.min.x);
    const maxX = Math.ceil(aabb.max.x);
    const minY = Math.floor(aabb.min.y);
    const maxY = Math.ceil(aabb.max.y);
    const minZ = Math.floor(aabb.min.z);
    const maxZ = Math.ceil(aabb.max.z);

    // Look in a grid around player bounding box
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const blockId = this.world.getVoxel(x, y, z);
          if (blockId === 0) continue;

          const collisionBoxes = BlockRegistry.getCollisionBoxes(blockId);
          for (let i = 0; i < collisionBoxes.length && this.poolIndex < this.nearbyColliders.length; i++) {
            const local = collisionBoxes[i];
            const box = this.nearbyColliders[this.poolIndex++];
            box.min.set(x + local.minX, y + local.minY, z + local.minZ);
            box.max.set(x + local.maxX, y + local.maxY, z + local.maxZ);
          }
        }
      }
    }

    return this.poolIndex;
  }

  /**
   * Queries nearby solid block AABBs using the step pool
   */
  public getNearbySolidBlockAABBsForStep(aabb: AABB): number {
    this.stepPoolIndex = 0;

    const minX = Math.floor(aabb.min.x);
    const maxX = Math.ceil(aabb.max.x);
    const minY = Math.floor(aabb.min.y);
    const maxY = Math.ceil(aabb.max.y);
    const minZ = Math.floor(aabb.min.z);
    const maxZ = Math.ceil(aabb.max.z);

    // Look in a grid around player bounding box
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const blockId = this.world.getVoxel(x, y, z);
          if (blockId === 0) continue;

          const collisionBoxes = BlockRegistry.getCollisionBoxes(blockId);
          for (let i = 0; i < collisionBoxes.length && this.stepPoolIndex < this.stepColliders.length; i++) {
            const local = collisionBoxes[i];
            const box = this.stepColliders[this.stepPoolIndex++];
            box.min.set(x + local.minX, y + local.minY, z + local.minZ);
            box.max.set(x + local.maxX, y + local.maxY, z + local.maxZ);
          }
        }
      }
    }

    return this.stepPoolIndex;
  }
}
