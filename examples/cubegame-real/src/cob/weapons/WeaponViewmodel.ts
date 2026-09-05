import { Matrix4, Vector3, clamp, lerp } from '../core/Math';
import { LocalViewmodelPose } from '../core/Models';

export enum WeaponViewmodelState {
  Idle = 'Idle',
  Sprinting = 'Sprinting',
  AimDownSights = 'AimDownSights',
}

export interface WeaponViewmodelInput {
  nowMs: number;
  dtSeconds: number;
  playerVelocity: Vector3;
  rightClickHeld: boolean;
  baseCameraFovDegrees: number;
  walkingSpeedThreshold: number;
  footstepIntervalMs: number;
}

export interface WeaponViewmodelConfig {
  idleOffset: Vector3;
  sprintOffset: Vector3;
  sprintTiltRadians: Vector3;
  opticLocalNode: Vector3;
  adsViewportTarget: Vector3;
  idleSwayAmplitudeRadians: Vector3;
  sprintSwayAmplitudeRadians: Vector3;
  adsInterpolationPerSecond: number;
  sprintInterpolationPerSecond: number;
  idleInterpolationPerSecond: number;
}

export class WeaponViewmodel {
  private state = WeaponViewmodelState.Idle;
  private readonly position = new Vector3(0.36, -0.28, -0.62);
  private readonly rotation = Vector3.zero();
  private readonly scale = new Vector3(1, 1, 1);
  private adsBlend01 = 0;
  private sprintBlend01 = 0;

  public constructor(private readonly config: WeaponViewmodelConfig = WeaponViewmodel.defaultConfig()) {}

  public static defaultConfig(): WeaponViewmodelConfig {
    return {
      idleOffset: new Vector3(0.36, -0.28, -0.62),
      sprintOffset: new Vector3(0.18, -0.47, -0.54),
      sprintTiltRadians: new Vector3(-0.22, -0.18, 0.36),
      opticLocalNode: new Vector3(0.18, -0.065, -0.5),
      adsViewportTarget: new Vector3(0, 0, -0.5),
      idleSwayAmplitudeRadians: new Vector3(0.012, 0.018, 0.009),
      sprintSwayAmplitudeRadians: new Vector3(0.075, 0.045, 0.085),
      adsInterpolationPerSecond: 11.5,
      sprintInterpolationPerSecond: 9.5,
      idleInterpolationPerSecond: 6.5,
    };
  }

  public update(input: WeaponViewmodelInput): LocalViewmodelPose {
    const speed = Math.sqrt(input.playerVelocity.x * input.playerVelocity.x + input.playerVelocity.z * input.playerVelocity.z);
    const wantsAds = input.rightClickHeld;
    const wantsSprint = !wantsAds && speed > Math.max(0, input.walkingSpeedThreshold);

    if (wantsAds) this.state = WeaponViewmodelState.AimDownSights;
    else if (wantsSprint) this.state = WeaponViewmodelState.Sprinting;
    else this.state = WeaponViewmodelState.Idle;

    const adsStep = clamp(input.dtSeconds * this.config.adsInterpolationPerSecond, 0, 1);
    const sprintStep = clamp(input.dtSeconds * this.config.sprintInterpolationPerSecond, 0, 1);
    this.adsBlend01 = lerp(this.adsBlend01, wantsAds ? 1 : 0, adsStep);
    this.sprintBlend01 = lerp(this.sprintBlend01, wantsSprint ? 1 : 0, sprintStep);

    const idleTarget = this.config.idleOffset;
    const sprintTarget = this.config.sprintOffset;
    const adsTarget = new Vector3(
      this.config.adsViewportTarget.x - this.config.opticLocalNode.x,
      this.config.adsViewportTarget.y - this.config.opticLocalNode.y,
      this.config.adsViewportTarget.z - this.config.opticLocalNode.z
    );

    const sprintMixed = new Vector3(
      lerp(idleTarget.x, sprintTarget.x, this.sprintBlend01),
      lerp(idleTarget.y, sprintTarget.y, this.sprintBlend01),
      lerp(idleTarget.z, sprintTarget.z, this.sprintBlend01)
    );

    const finalTarget = new Vector3(
      lerp(sprintMixed.x, adsTarget.x, this.adsBlend01),
      lerp(sprintMixed.y, adsTarget.y, this.adsBlend01),
      lerp(sprintMixed.z, adsTarget.z, this.adsBlend01)
    );

    const interpolation = this.state === WeaponViewmodelState.Idle
      ? this.config.idleInterpolationPerSecond
      : this.state === WeaponViewmodelState.Sprinting
        ? this.config.sprintInterpolationPerSecond
        : this.config.adsInterpolationPerSecond;
    const step = clamp(input.dtSeconds * interpolation, 0, 1);
    this.position.x = lerp(this.position.x, finalTarget.x, step);
    this.position.y = lerp(this.position.y, finalTarget.y, step);
    this.position.z = lerp(this.position.z, finalTarget.z, step);

    const seconds = input.nowMs / 1000;
    const breathingSway = this.computeBreathingSway(seconds, this.adsBlend01);
    const sprintSway = this.computeSprintSway(input.nowMs, input.footstepIntervalMs, this.sprintBlend01, this.adsBlend01);
    const sprintTilt = new Vector3(
      this.config.sprintTiltRadians.x * this.sprintBlend01,
      this.config.sprintTiltRadians.y * this.sprintBlend01,
      this.config.sprintTiltRadians.z * this.sprintBlend01
    );

    this.rotation.x = breathingSway.x + sprintSway.x + sprintTilt.x;
    this.rotation.y = breathingSway.y + sprintSway.y + sprintTilt.y;
    this.rotation.z = breathingSway.z + sprintSway.z + sprintTilt.z;

    const cameraFov = lerp(input.baseCameraFovDegrees, input.baseCameraFovDegrees * 0.7, this.adsBlend01);
    return {
      position: this.position.clone(),
      rotation: this.rotation.clone(),
      scale: this.scale.clone(),
      matrix: Matrix4.compose(this.position, this.rotation, this.scale),
      cameraFov,
    };
  }

  public getState(): WeaponViewmodelState {
    return this.state;
  }

  private computeBreathingSway(seconds: number, adsBlend01: number): Vector3 {
    const adsSwayReductionMultiplier = lerp(1, 0.2, adsBlend01);
    const lowFrequency = seconds * Math.PI * 0.85;
    const x = Math.sin(lowFrequency) * this.config.idleSwayAmplitudeRadians.x * adsSwayReductionMultiplier;
    const y = Math.cos(lowFrequency * 0.72) * this.config.idleSwayAmplitudeRadians.y * adsSwayReductionMultiplier;
    const z = Math.sin(lowFrequency * 0.51 + Math.PI * 0.25) * this.config.idleSwayAmplitudeRadians.z * adsSwayReductionMultiplier;
    return new Vector3(x, y, z);
  }

  private computeSprintSway(nowMs: number, footstepIntervalMs: number, sprintBlend01: number, adsBlend01: number): Vector3 {
    const interval = Math.max(80, footstepIntervalMs);
    const stepIndex = Math.floor(nowMs / interval);
    const stepStart = stepIndex * interval;
    const stepT = clamp((nowMs - stepStart) / interval, 0, 1);
    const alternatingSide = stepIndex % 2 === 0 ? 1 : -1;
    const phase = stepT * Math.PI * 2;
    const adsSwayReductionMultiplier = lerp(1, 0.2, adsBlend01);
    const blend = sprintBlend01 * adsSwayReductionMultiplier;
    return new Vector3(
      Math.sin(phase) * this.config.sprintSwayAmplitudeRadians.x * blend,
      Math.abs(Math.sin(phase)) * this.config.sprintSwayAmplitudeRadians.y * blend,
      Math.sin(phase + Math.PI * 0.5) * alternatingSide * this.config.sprintSwayAmplitudeRadians.z * blend
    );
  }
}
