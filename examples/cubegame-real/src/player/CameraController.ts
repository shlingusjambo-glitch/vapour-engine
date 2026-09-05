import * as THREE from 'three';
import { InputManager } from '../core/InputManager';
import { EventBus } from '../core/EventBus';
import { PlayerController } from './PlayerController';
import { Renderer } from '../graphics/Renderer';

type CameraMode = 'first' | 'third_back' | 'third_front';

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private cameraGroup: THREE.Group;
  private cameraMode: CameraMode = 'first';

  public pitch: number = 0; // Look up/down
  public yaw: number = 0;   // Look left/right
  private roll: number = 0;  // Camera roll for strafing

  private mouseSensitivity: number = 0.0022;

  constructor(renderer: Renderer) {
    this.camera = renderer.camera;
    this.cameraGroup = renderer.cameraGroup;

    EventBus.on('camera:cycleView', () => this.cycleCameraMode(renderer));
  }

  public isFirstPerson(): boolean {
    return this.cameraMode === 'first';
  }

  public getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  private cycleCameraMode(renderer: Renderer): void {
    this.cameraMode = this.cameraMode === 'first'
      ? 'third_back'
      : this.cameraMode === 'third_back'
        ? 'third_front'
        : 'first';

    renderer.setThirdPersonBodyVisible(this.cameraMode !== 'first');
    renderer.setViewModelVisible(this.cameraMode === 'first');
    if (this.cameraMode === 'first') {
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.y = 0;
      this.camera.rotation.z = 0;
    }
    EventBus.emit('network:chat', `[Camera] ${this.cameraMode === 'first' ? 'First person' : this.cameraMode === 'third_back' ? 'Third person' : 'Front view'}`);
  }

  public resetView(yaw = 0, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = 0;
    this.cameraGroup.rotation.set(0, yaw, 0);
    this.camera.rotation.set(pitch, 0, 0);
  }

  public update(dt: number, player: PlayerController, renderer: Renderer): void {
    this.updateCached(dt, player, renderer);
  }

  public updateCached(dt: number, player: PlayerController, renderer: Renderer, isMenu = false): void {
    let dx = 0;
    let dy = 0;

    if (isMenu) {
      this.yaw += dt * 0.04; // Slow rotation
      this.pitch = -0.05; // Look slightly down
    } else if (InputManager.isPointerLocked() || InputManager.isMobileMode()) {
      const mouseDelta = InputManager.getMouseDelta();
      dx = mouseDelta.x;
      dy = mouseDelta.y;

      const isScoped = (window as any).tf2Manager?.sniperScoped;
      const currentSensitivity = isScoped ? this.mouseSensitivity * 0.37 : this.mouseSensitivity;

      this.yaw -= dx * currentSensitivity;
      this.pitch -= dy * currentSensitivity;

      const limit = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    }

    let targetRoll = 0;
    if (!isMenu) {
      if (InputManager.isActionDown('moveLeft')) {
        targetRoll = 0.035; // Tilt left
      } else if (InputManager.isActionDown('moveRight')) {
        targetRoll = -0.035; // Tilt right
      }
    }
    this.roll += (targetRoll - this.roll) * dt * 10;

    this.cameraGroup.rotation.y = this.yaw;
    this.cameraGroup.rotation.x = 0;
    this.cameraGroup.rotation.z = 0;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.y = 0;
    this.camera.rotation.z = this.roll;

    const eyePosition = player.position.clone().add(new THREE.Vector3(0, player.eyeHeight, 0));
    this.cameraGroup.position.copy(eyePosition);

    const isMoving = !isMenu && player.grounded && player.velocity.lengthSq() > 0.1;
    const isSprinting = isMoving && InputManager.isActionDown('sprint');

    renderer.updateEffects(dt, isMoving, isSprinting, dx, dy, player.isSubmerged, player.grounded, player.velocity.y, player.isCrouching);

    if (isMenu || this.cameraMode === 'first') {
      this.camera.position.z += (0 - this.camera.position.z) * Math.min(1, dt * 16);
      if (Math.abs(this.camera.position.z) < 0.001) this.camera.position.z = 0;
      this.camera.rotation.y = 0;
      renderer.setThirdPersonBodyVisible(false);
      return;
    }

    const distance = 4.35;
    const height = player.isCrouching ? -0.03 : 0.04;

    // Third person is locked to the same head/camera pivot as first person.
    // Do not reuse first-person bob offsets here; that was the F5 jitter source.
    if (this.cameraMode === 'third_back') {
      this.camera.position.set(0, height, distance);
      this.camera.rotation.set(this.pitch, 0, this.roll * 0.35);
    } else {
      this.camera.position.set(0, height, -distance);
      this.camera.rotation.set(-this.pitch, Math.PI, -this.roll * 0.35);
    }
    renderer.setThirdPersonBodyVisible(true);
  }

  public getDirection(): THREE.Vector3 {
    // Return look direction vector
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return dir;
  }
}
