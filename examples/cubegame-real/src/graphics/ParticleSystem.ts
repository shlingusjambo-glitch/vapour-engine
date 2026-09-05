import * as THREE from 'three';

interface ActiveParticle {
  instanceIdx: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  scale: number;
  life: number; // 0 to 1
  decay: number; // rate of life loss per second
}

export class ParticleSystem {
  private scene: THREE.Scene;
  private instancedMesh: THREE.InstancedMesh;
  
  private particles: ActiveParticle[] = [];
  private particlePool: ActiveParticle[] = [];
  private maxParticles = 900;

  // Reusable dummy objects to prevent allocations in loops
  private dummyMatrix = new THREE.Matrix4();
  private dummyColor = new THREE.Color();
  private dummyScaleVector = new THREE.Vector3();
  private readonly rainColor = new THREE.Color(0x528bf2);

  private static readonly FLAME_COLORS = [
    new THREE.Color(0xff4500), // Orange-Red
    new THREE.Color(0xff8c00), // Dark Orange
    new THREE.Color(0xffd700), // Gold
    new THREE.Color(0x555555), // Dark Gray
    new THREE.Color(0xaaaaaa), // Light Gray
  ];

  private static readonly BLOCK_DEBRIS_COLORS: { [id: number]: THREE.Color } = {
    1: new THREE.Color('#56ac35'), // Grass
    2: new THREE.Color('#72523b'), // Dirt
    3: new THREE.Color('#7d7d7d'), // Stone
    4: new THREE.Color('#5f4430'), // Wood
    5: new THREE.Color('#288223'), // Leaves
    6: new THREE.Color('#e1d2a0'), // Sand
    7: new THREE.Color('#3278e6'), // Water
    8: new THREE.Color('#383838'), // Coal
    9: new THREE.Color('#d49a6a'), // Iron
    10: new THREE.Color('#b04030'), // Brick
    11: new THREE.Color('#e8f7ff'), // Glass
    12: new THREE.Color('#4caf50'), // Tall Grass
    13: new THREE.Color('#f44336'), // Red Flower
    14: new THREE.Color('#ffeb3b'), // Yellow Flower
    15: new THREE.Color('#b58550')  // Planks
  };
  private static readonly DEFAULT_DEBRIS_COLOR = new THREE.Color('#7d7d7d');

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Small box geometry (0.12 block size)
    const geometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    // Vertex colors make debris match the broken block instead of rendering white.
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, dithering: true });

    this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = true;
    
    // Pre-allocate all particle structures in the object pool to avoid runtime GC garbage collection overhead
    const scaleZero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxParticles; i++) {
      this.instancedMesh.setMatrixAt(i, scaleZero);
      this.particlePool.push({
        instanceIdx: i,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        color: new THREE.Color(),
        scale: 0,
        life: 0,
        decay: 0
      });
    }
    
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.instancedMesh);
  }

  /** Gets an inactive particle from the pool or recycles the oldest active one. */
  private getFreeParticle(): ActiveParticle {
    if (this.particlePool.length > 0) {
      return this.particlePool.pop()!;
    }
    // Recycle the oldest active particle (FIFO)
    return this.particles.shift()!;
  }

  /**
   * Spawns a burst of particles of a specific color
   */
  public spawnBlockParticles(
    pos: THREE.Vector3,
    blockId: number,
    count: number = 12
  ): void {
    const blockColor = this.getBlockColor(blockId);

    for (let i = 0; i < count; i++) {
      const p = this.getFreeParticle();

      // Spawn slightly offset from block center (no new allocations)
      p.position.set(
        pos.x + (Math.random() - 0.5) * 0.6,
        pos.y + (Math.random() - 0.5) * 0.6,
        pos.z + (Math.random() - 0.5) * 0.6
      );

      // Velocity: outwards explosion + upward thrust
      p.velocity.set(
        (Math.random() - 0.5) * 4.0,
        Math.random() * 4.0 + 1.5,
        (Math.random() - 0.5) * 4.0
      );

      p.color.copy(blockColor);
      p.scale = 0.6 + Math.random() * 0.5;
      p.life = 1.0;
      p.decay = 1.0 / (0.55 + Math.random() * 0.35); // lasts roughly 0.55 to 0.9 seconds

      // Set initial color and matrix
      this.dummyColor.copy(p.color);
      this.instancedMesh.setColorAt(p.instanceIdx, this.dummyColor);

      this.dummyMatrix.makeTranslation(p.position.x, p.position.y, p.position.z);
      this.dummyScaleVector.set(p.scale, p.scale, p.scale);
      this.dummyMatrix.scale(this.dummyScaleVector);
      this.instancedMesh.setMatrixAt(p.instanceIdx, this.dummyMatrix);

      this.particles.push(p);
    }

    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public spawnRain(playerPos: THREE.Vector3, count: number = 8): void {
    for (let i = 0; i < count; i++) {
      const p = this.getFreeParticle();

      const rx = (Math.random() - 0.5) * 24;
      const rz = (Math.random() - 0.5) * 24;
      const ry = 8 + Math.random() * 8;

      p.position.set(playerPos.x + rx, playerPos.y + ry, playerPos.z + rz);
      p.velocity.set(0, -26.0, 0);
      p.color.copy(this.rainColor);
      p.scale = 0.15 + Math.random() * 0.1;
      p.life = 1.0;
      p.decay = 1.0 / 0.8;

      this.dummyColor.copy(p.color);
      this.instancedMesh.setColorAt(p.instanceIdx, this.dummyColor);

      this.dummyMatrix.makeTranslation(p.position.x, p.position.y, p.position.z);
      this.dummyScaleVector.set(p.scale * 0.12, p.scale * 4.2, p.scale * 0.12);
      this.dummyMatrix.scale(this.dummyScaleVector);
      this.instancedMesh.setMatrixAt(p.instanceIdx, this.dummyMatrix);

      this.particles.push(p);
    }

    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Physics updates for active particles
   */
  public update(dt: number): void {
    const gravity = -9.81;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Subtract life using delta time so particle lifetime is not FPS-dependent
      p.life -= p.decay * dt;

      if (p.life <= 0) {
        // Hide instance and return structure to the pool
        const scaleZero = new THREE.Matrix4().makeScale(0, 0, 0);
        this.instancedMesh.setMatrixAt(p.instanceIdx, scaleZero);

        this.particles.splice(i, 1);
        this.particlePool.push(p);
        continue;
      }

      // Physics: Apply gravity and velocity
      p.velocity.y += gravity * dt;
      p.velocity.x *= Math.exp(-1.5 * dt); // air resistance
      p.velocity.z *= Math.exp(-1.5 * dt);

      // Tiny ground bounce/dust settle so block breaks feel less flat
      if (p.position.y < 0.04 && p.velocity.y < 0) {
        p.position.y = 0.04;
        p.velocity.y *= -0.18;
        p.velocity.x *= 0.58;
        p.velocity.z *= 0.58;
      }
      
      p.position.addScaledVector(p.velocity, dt);

      // Render: Update instance matrix (scaling down over life)
      const currentScale = p.scale * p.life;
      this.dummyMatrix.makeTranslation(p.position.x, p.position.y, p.position.z);
      this.dummyScaleVector.set(currentScale, currentScale, currentScale);
      this.dummyMatrix.scale(this.dummyScaleVector);
      this.instancedMesh.setMatrixAt(p.instanceIdx, this.dummyMatrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public spawnFlameSmokeParticles(pos: THREE.Vector3, count: number = 6): void {
    for (let i = 0; i < count; i++) {
      const p = this.getFreeParticle();

      p.position.set(
        pos.x + (Math.random() - 0.5) * 0.2,
        pos.y + (Math.random() - 0.5) * 0.2,
        pos.z + (Math.random() - 0.5) * 0.2
      );

      p.velocity.set(
        (Math.random() - 0.5) * 1.5,
        Math.random() * 1.0 + 0.5,
        (Math.random() - 0.5) * 1.5
      );

      p.color.copy(ParticleSystem.FLAME_COLORS[Math.floor(Math.random() * ParticleSystem.FLAME_COLORS.length)]);
      p.scale = 0.25 + Math.random() * 0.25;
      p.life = 1.0;
      p.decay = 1.0 / (0.3 + Math.random() * 0.3);

      this.dummyColor.copy(p.color);
      this.instancedMesh.setColorAt(p.instanceIdx, this.dummyColor);

      this.dummyMatrix.makeTranslation(p.position.x, p.position.y, p.position.z);
      this.dummyScaleVector.set(p.scale, p.scale, p.scale);
      this.dummyMatrix.scale(this.dummyScaleVector);
      this.instancedMesh.setMatrixAt(p.instanceIdx, this.dummyMatrix);

      this.particles.push(p);
    }

    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  private getBlockColor(blockId: number): THREE.Color {
    return ParticleSystem.BLOCK_DEBRIS_COLORS[blockId] || ParticleSystem.DEFAULT_DEBRIS_COLOR;
  }
}

