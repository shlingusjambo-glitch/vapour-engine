import {
  moveVoxelBody,
  type GameContext,
  type VoxelBody,
  type VoxelPalette,
  type VoxelRayHit,
  type VoxelWorld,
  raycastVoxels,
} from "@vapour/engine";

const WALK_SPEED = 5.4;
const AIR_CONTROL = 0.42;
const JUMP_SPEED = 8.4;
const GRAVITY = 25;
const EYE_HEIGHT = 1.62;

export class FirstPersonVoxelPlayer {
  readonly body: VoxelBody;
  yaw = 0;
  pitch = -0.12;

  constructor(
    readonly world: VoxelWorld,
    readonly palette: VoxelPalette,
    spawn: readonly [number, number, number],
  ) {
    this.body = {
      position: [...spawn],
      velocity: [0, 0, 0],
      width: 0.62,
      height: 1.8,
      depth: 0.62,
      grounded: false,
    };
  }

  fixedUpdate(game: GameContext, deltaSeconds: number): void {
    const moveX = game.input.action("MoveX").value;
    const moveForward = game.input.action("MoveForward").value;
    const length = Math.hypot(moveX, moveForward);
    const normalizedX = length > 1 ? moveX / length : moveX;
    const normalizedForward = length > 1 ? moveForward / length : moveForward;
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const control = this.body.grounded ? 1 : AIR_CONTROL;
    const targetX = (rightX * normalizedX + forwardX * normalizedForward) * WALK_SPEED;
    const targetZ = (rightZ * normalizedX + forwardZ * normalizedForward) * WALK_SPEED;
    this.body.velocity[0] += (targetX - this.body.velocity[0]) * control;
    this.body.velocity[2] += (targetZ - this.body.velocity[2]) * control;
    if (game.input.action("Jump").justPressed && this.body.grounded) this.body.velocity[1] = JUMP_SPEED;
    this.body.velocity[1] -= GRAVITY * deltaSeconds;
    moveVoxelBody(this.world, this.palette, this.body, deltaSeconds);
  }

  updateLook(game: GameContext): void {
    if (!game.pointerLocked) return;
    this.yaw -= game.input.action("LookX").value;
    this.pitch -= game.input.action("LookY").value;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
  }

  eye(): [number, number, number] {
    return [this.body.position[0], this.body.position[1] + EYE_HEIGHT, this.body.position[2]];
  }

  forward(): [number, number, number] {
    const horizontal = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * horizontal, Math.sin(this.pitch), -Math.cos(this.yaw) * horizontal];
  }

  target(distance = 6): VoxelRayHit | undefined {
    return raycastVoxels(this.world, this.palette, this.eye(), this.forward(), distance);
  }

  overlapsBlock(x: number, y: number, z: number): boolean {
    const halfWidth = this.body.width / 2;
    const halfDepth = this.body.depth / 2;
    return this.body.position[0] + halfWidth > x && this.body.position[0] - halfWidth < x + 1
      && this.body.position[1] + this.body.height > y && this.body.position[1] < y + 1
      && this.body.position[2] + halfDepth > z && this.body.position[2] - halfDepth < z + 1;
  }
}
