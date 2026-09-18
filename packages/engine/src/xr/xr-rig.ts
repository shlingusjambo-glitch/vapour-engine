/** The XR rig: reference spaces, player height, floor, and per-eye cameras.
 *
 * WebXR hands the engine a viewer pose in a reference space and leaves the
 * rest to the game: where the floor is, how tall the player is, whether they
 * are sitting, and how a tracked pose becomes a world-space camera. This
 * module owns those decisions as pure data so they are the same in a test as
 * on a headset.
 *
 * The rig transform is the key idea. Tracking is in *tracking space* (metres
 * from the reference-space origin); the game moves a *rig* through the world
 * (teleporting, riding a vehicle, walking with a thumbstick); the camera the
 * renderer uses is `rig × tracked`. Floor calibration, seated offsets, and
 * height scaling are all adjustments to the rig, never to the tracked pose,
 * which keeps the headset's own motion untouched.
 *
 * Height has two sources: `local-floor` spaces measure it (the viewer's
 * tracked Y is height above the floor), while `local` and `viewer` spaces do
 * not know the floor and need a configured height. Reporting which source is
 * in use lets a game decide whether to trust it for scaling the world.
 */
import { compose, invert, multiplyMat4, transformPoint, type Mat4, type Quat, type Vec3, type Vec3Like } from "@vapour/math";
import type { XrFrameSnapshot, XrReferenceSpaceType, XrViewSnapshot } from "./xr.js";

export type XrPlayMode = "standing" | "seated";

export interface XrRigOptions {
  readonly referenceSpace: XrReferenceSpaceType;
  readonly mode?: XrPlayMode;
  /** Height in metres to assume when the reference space does not know the floor. */
  readonly configuredHeight?: number;
  /** Eye height a seated player's view is lifted to, so a seated session sees standing height. */
  readonly seatedEyeHeight?: number;
  /** Manual floor offset in metres, added to whatever the space provides. */
  readonly floorOffset?: number;
}

export interface XrHeightReport {
  readonly metres: number;
  readonly source: "measured" | "configured";
}

/** One eye's camera, ready for a renderer: world transform, view, projection. */
export interface XrEyeCamera {
  readonly eye: XrViewSnapshot["eye"];
  readonly world: Mat4;
  readonly view: Mat4;
  readonly projection: Mat4;
  readonly position: Vec3;
}

export interface XrRigFrame {
  readonly eyes: readonly XrEyeCamera[];
  /** The viewer (head) in world space. */
  readonly head: Mat4;
  readonly headPosition: Vec3;
  readonly height: XrHeightReport;
  /** Distance between the left and right eye positions, or 0 for mono. */
  readonly interpupillaryDistance: number;
}

const FLOOR_AWARE: ReadonlySet<XrReferenceSpaceType> = new Set(["local-floor", "bounded-floor"]);
const DEFAULT_HEIGHT = 1.6;

function toMat4(values: ArrayLike<number>): Mat4 {
  if (values.length !== 16) throw new Error("An XR transform must have 16 elements.");
  return Array.from(values) as unknown as Mat4;
}

/**
 * Tracks a rig through the world and turns frames into cameras.
 *
 * Calibration is explicit: {@link calibrateFloor} samples the current head
 * height, so a game can offer "recentre" or "set floor" without the engine
 * guessing when that should happen.
 */
export class XrRig {
  readonly #referenceSpace: XrReferenceSpaceType;
  #mode: XrPlayMode;
  #configuredHeight: number;
  #seatedEyeHeight: number;
  #floorOffset: number;
  #position: Vec3 = [0, 0, 0] as unknown as Vec3;
  #rotation: Quat = [0, 0, 0, 1];
  #measuredHeight: number | undefined;
  /** Head height (tracking space) captured when seated play began; the lift is fixed from it. */
  #seatedHeadY: number | undefined;

  constructor(options: XrRigOptions) {
    this.#referenceSpace = options.referenceSpace;
    this.#mode = options.mode ?? "standing";
    this.#configuredHeight = positive(options.configuredHeight ?? DEFAULT_HEIGHT, "configuredHeight");
    this.#seatedEyeHeight = positive(options.seatedEyeHeight ?? DEFAULT_HEIGHT, "seatedEyeHeight");
    this.#floorOffset = finite(options.floorOffset ?? 0, "floorOffset");
  }

  get referenceSpace(): XrReferenceSpaceType { return this.#referenceSpace; }
  get mode(): XrPlayMode { return this.#mode; }
  get position(): Vec3 { return this.#position; }
  get rotation(): Quat { return this.#rotation; }
  /** Whether the reference space itself puts y = 0 on the floor. */
  get floorAware(): boolean { return FLOOR_AWARE.has(this.#referenceSpace); }

  setMode(mode: XrPlayMode): void {
    this.#mode = mode;
    this.#seatedHeadY = undefined;
  }

  /**
   * Fixes the seated lift from the current head height. Called lazily on the
   * first seated frame; call it explicitly for a "recentre" button.
   */
  calibrateSeat(frame: XrFrameSnapshot): void {
    this.#seatedHeadY = frame.viewerTransform[13]! - this.#floorOffset;
  }
  setConfiguredHeight(metres: number): void { this.#configuredHeight = positive(metres, "configuredHeight"); }
  setFloorOffset(metres: number): void { this.#floorOffset = finite(metres, "floorOffset"); }

  /** Moves the rig in the world; the tracked pose is untouched. */
  setPose(position: Vec3Like, rotation: Quat = this.#rotation): void {
    this.#position = [position[0]!, position[1]!, position[2]!] as unknown as Vec3;
    this.#rotation = rotation;
  }

  /**
   * Uses the current head height as the player's standing height.
   *
   * In a floor-aware space this measures the player; elsewhere it defines the
   * floor as `height` metres below the head, which is what "set floor" does
   * in a `local` space that started at eye level.
   */
  calibrateFloor(frame: XrFrameSnapshot, height?: number): XrHeightReport {
    const headY = frame.viewerTransform[13]!;
    if (this.floorAware) {
      this.#measuredHeight = Math.max(0.5, headY - this.#floorOffset);
      return this.height();
    }
    const assumed = positive(height ?? this.#configuredHeight, "height");
    // The head is `assumed` above the floor, so the floor sits at headY - assumed.
    this.#floorOffset = headY - assumed;
    this.#configuredHeight = assumed;
    return this.height();
  }

  /** Resets to the space's own floor and forgets any measured height. */
  resetCalibration(): void {
    this.#floorOffset = 0;
    this.#measuredHeight = undefined;
  }

  height(): XrHeightReport {
    if (this.floorAware && this.#measuredHeight !== undefined) return { metres: this.#measuredHeight, source: "measured" };
    return { metres: this.#configuredHeight, source: "configured" };
  }

  /**
   * The rig transform: world from tracking space.
   *
   * A seated player is lifted so their eyes sit at `seatedEyeHeight`; the
   * lift is the difference between where their head was when seated play
   * began and where a standing head would be, and it stays fixed so leaning
   * still moves the view. In a non-floor-aware space the floor offset moves
   * tracking space so the calibrated floor lands on y = 0.
   */
  rigMatrix(frame?: XrFrameSnapshot): Mat4 {
    let lift = -this.#floorOffset;
    if (this.#mode === "seated" && frame !== undefined) {
      if (this.#seatedHeadY === undefined) this.calibrateSeat(frame);
      lift += this.#seatedEyeHeight - this.#seatedHeadY!;
    }
    return compose([this.#position[0], this.#position[1] + lift, this.#position[2]], this.#rotation, [1, 1, 1]);
  }

  /** World-space cameras for every view in the frame. */
  resolve(frame: XrFrameSnapshot): XrRigFrame {
    const rig = this.rigMatrix(frame);
    const head = multiplyMat4(rig, toMat4(frame.viewerTransform));
    const eyes = frame.views.map((view): XrEyeCamera => {
      const world = multiplyMat4(rig, toMat4(view.transform));
      return { eye: view.eye, world, view: invert(world), projection: toMat4(view.projection), position: transformPoint(world, [0, 0, 0]) };
    });
    const left = eyes.find((eye) => eye.eye === "left");
    const right = eyes.find((eye) => eye.eye === "right");
    const ipd = left !== undefined && right !== undefined ? Math.hypot(left.position[0] - right.position[0], left.position[1] - right.position[1], left.position[2] - right.position[2]) : 0;
    return { eyes, head, headPosition: transformPoint(head, [0, 0, 0]), height: this.height(), interpupillaryDistance: ipd };
  }
}

/**
 * A synthetic frame for tests, replays, and desktop preview.
 *
 * Views are placed `ipd / 2` either side of the head along its local X with a
 * symmetric perspective projection, which is what a real headset reports up
 * to lens asymmetry.
 */
export function syntheticXrFrame(options: {
  readonly headPosition: Vec3Like;
  readonly headRotation?: Quat;
  readonly ipd?: number;
  readonly time?: number;
  readonly projection?: Mat4;
}): XrFrameSnapshot {
  const rotation = options.headRotation ?? [0, 0, 0, 1];
  const ipd = options.ipd ?? 0.064;
  const head = compose(options.headPosition, rotation, [1, 1, 1]);
  const projection = options.projection ?? defaultProjection();
  const eye = (which: "left" | "right"): XrViewSnapshot => ({
    eye: which,
    transform: new Float32Array(multiplyMat4(head, compose([which === "left" ? -ipd / 2 : ipd / 2, 0, 0], [0, 0, 0, 1], [1, 1, 1]))),
    projection: new Float32Array(projection),
  });
  return {
    time: options.time ?? 0,
    viewerTransform: new Float32Array(head),
    views: [eye("left"), eye("right")],
    inputs: [],
    visibilityState: "visible",
  };
}

function defaultProjection(): Mat4 {
  // 90° symmetric, near 0.1, far 1000 — a typical headset's per-eye field.
  const f = 1;
  const near = 0.1;
  const far = 1000;
  return [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0] as unknown as Mat4;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`XR rig ${label} must be finite.`);
  return value;
}

function positive(value: number, label: string): number {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`XR rig ${label} must be a positive number.`);
  return value;
}
