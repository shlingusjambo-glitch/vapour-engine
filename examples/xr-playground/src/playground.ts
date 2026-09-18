/** XR playground: the XR systems composed, headlessly.
 *
 * A synthetic headset frame drives the real rig, input bindings, hand-pose
 * recogniser, grab controller, locomotion, haptics, and a world-space UI
 * panel — the same objects a live WebXR session hands them. Everything here
 * is public engine API, so it doubles as the reference for wiring a session.
 */
import {
  Diagnostics,
  HandPoseRecognizer,
  InputActions,
  UiDocument,
  WorldUiCanvas,
  XrGrabController,
  XrHaptics,
  XrLocomotion,
  XrRig,
  debugXrFrame,
  syntheticXrFrame,
  type XrFrameSnapshot,
  type XrInputSnapshot,
  type XrJointSnapshot,
  type XrPose,
} from "@vapour/engine";

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function transformAt(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(IDENTITY);
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/** A tracked hand with every finger straight; `pinch` sets the thumb-index gap. */
export function trackedHand(hand: "left" | "right", position: readonly [number, number, number], pinch = 0.1): XrInputSnapshot {
  const joints: XrJointSnapshot[] = [];
  const fingers = ["thumb", "index-finger", "middle-finger", "ring-finger", "pinky-finger"];
  fingers.forEach((finger, row) => {
    ["metacarpal", "phalanx-proximal", "phalanx-intermediate", "phalanx-distal", "tip"].forEach((segment, index) => {
      joints.push({ name: `${finger}-${segment}`, transform: transformAt(position[0] + index * 0.02, position[1], position[2] + row * 0.02), radius: 0.01 });
    });
  });
  const indexTip = joints.find((joint) => joint.name === "index-finger-tip")!;
  const thumbTip = joints.find((joint) => joint.name === "thumb-tip")!;
  thumbTip.transform.set(indexTip.transform);
  thumbTip.transform[14] = indexTip.transform[14]! - pinch;
  return { handedness: hand, targetRayMode: "tracked-pointer", profiles: ["generic-hand"], targetRayTransform: transformAt(...position), gripTransform: transformAt(...position), buttons: [], axes: new Float32Array(), joints };
}

/** A controller with trigger/squeeze values and a thumbstick. */
export function controller(hand: "left" | "right", position: readonly [number, number, number], options: { trigger?: number; squeeze?: number; stick?: readonly [number, number] } = {}): XrInputSnapshot {
  const button = (value: number) => ({ value, pressed: value > 0.5, touched: value > 0 });
  return {
    handedness: hand, targetRayMode: "tracked-pointer", profiles: ["generic-trigger-squeeze-thumbstick"],
    targetRayTransform: transformAt(...position), gripTransform: transformAt(...position),
    buttons: [button(options.trigger ?? 0), button(options.squeeze ?? 0), button(0), button(0)],
    axes: new Float32Array([0, 0, options.stick?.[0] ?? 0, options.stick?.[1] ?? 0]),
    joints: [],
  };
}

export interface PlaygroundStats {
  readonly headHeight: number;
  readonly ipd: number;
  readonly leftPose: string | undefined;
  readonly held: string | undefined;
  readonly playerPosition: readonly [number, number, number];
  readonly playerYaw: number;
  readonly hapticsPlayed: number;
  readonly uiClicks: number;
  readonly frames: number;
}

export class XrPlayground {
  readonly diagnostics = new Diagnostics({ now: () => performance.now() });
  readonly rig = new XrRig({ referenceSpace: "local-floor", mode: "standing" });
  readonly input = new InputActions([{
    name: "xr",
    actions: [
      { name: "Grab", kind: "button", bindings: [{ device: "xr", hand: "right", control: "button", index: 1 }] },
      { name: "MoveX", kind: "axis", bindings: [{ device: "xr", hand: "left", control: "axis", index: 2, deadZone: 0.15 }] },
      { name: "MoveY", kind: "axis", bindings: [{ device: "xr", hand: "left", control: "axis", index: 3, deadZone: 0.15 }] },
      { name: "TurnX", kind: "axis", bindings: [{ device: "xr", hand: "right", control: "axis", index: 2, deadZone: 0.15 }] },
    ],
    composites: [{ name: "Move", kind: "vector2", positiveX: "MoveX", positiveY: "MoveY" }],
  }]);
  readonly poses = new HandPoseRecognizer();
  readonly grabs = new XrGrabController();
  readonly locomotion = new XrLocomotion({ turnStyle: "snap", snapDegrees: 45, moveSpeed: 2 });
  readonly haptics: XrHaptics;
  readonly panel: WorldUiCanvas;
  readonly crate = { id: "crate", position: [0.3, 1.0, -0.5] as [number, number, number], radius: 0.15 };
  #played = 0;
  #uiClicks = 0;
  #frames = 0;
  #lastFrameTime: number | undefined;

  constructor() {
    this.haptics = new XrHaptics(async () => { this.#played += 1; return true; });
    const ui = new UiDocument({ id: "menu", role: "panel", style: { direction: "column", padding: 10, gap: 10 }, children: [
      { id: "resume", role: "button", style: { height: 30 } },
      { id: "quit", role: "button", style: { height: 30 } },
    ] });
    ui.layout(200, 100);
    this.panel = new WorldUiCanvas(ui, { position: [0, 1.5, -1.5], pixelsPerUnit: 200, billboard: "upright" });
  }

  /** One headset frame: tracking → rig, bindings, poses, grabs, locomotion, UI, haptics. */
  async frame(frame: XrFrameSnapshot, deltaSeconds: number): Promise<void> {
    this.diagnostics.begin("xr.frame");
    this.#frames += 1;
    const resolved = this.rig.resolve(frame);
    this.input.update([], frame.inputs);
    debugXrFrame(frame, this.diagnostics, this.#lastFrameTime);
    this.#lastFrameTime = frame.time;

    for (const source of frame.inputs) {
      if (source.joints.length > 0) this.poses.update(source);
    }

    const right = frame.inputs.find((source) => source.handedness === "right");
    const rightPose = right?.gripTransform === undefined ? undefined : this.#poseFrom(right.gripTransform);
    if (rightPose !== undefined) {
      if (this.input.justPressed("Grab") && this.grabs.heldBy("right") === undefined) {
        const grab = this.grabs.grabDirect("right", rightPose, [this.crate]);
        if (grab !== undefined) this.haptics.pulse("right", 0.6, 20);
      } else if (!this.input.pressed("Grab") && this.grabs.heldBy("right") !== undefined) {
        this.grabs.release("right");
      }
      const carried = this.grabs.resolve("right", rightPose);
      if (carried !== undefined) this.crate.position = [carried[0], carried[1], carried[2]];
      // Pointing at the panel with the right hand and pinching clicks it.
      if (this.poses.pose("right") === "pinch") {
        const ray = { origin: [...rightPose.position] as [number, number, number], direction: [...rightPose.forward] as [number, number, number] };
        const hit = this.panel.pointerDown(ray);
        if (hit !== undefined) {
          this.panel.pointerUp(ray);
          this.#uiClicks += this.panel.document.drainActions().filter((action) => action.type === "click").length;
          this.haptics.pulse("right", 0.3, 10);
        }
      }
    }

    const move = this.input.vector("Move");
    const headForward = [-resolved.head[8]!, 0, -resolved.head[10]!] as const;
    const result = this.locomotion.update({ moveX: move.x, moveY: move.y, turnX: this.input.value("TurnX") }, headForward, deltaSeconds);
    this.rig.setPose(result.position);
    this.panel.face(resolved.headPosition);
    await this.haptics.flush();
    this.diagnostics.end("xr.frame");
  }

  stats(): PlaygroundStats {
    const resolved = this.rig.resolve(syntheticXrFrame({ headPosition: [0, 1.6, 0] }));
    const locomotion = this.locomotion.update({}, [0, 0, -1], 0);
    return {
      headHeight: resolved.headPosition[1],
      ipd: resolved.interpupillaryDistance,
      leftPose: this.poses.pose("left"),
      held: this.grabs.heldBy("right")?.id,
      playerPosition: locomotion.position,
      playerYaw: locomotion.yaw,
      hapticsPlayed: this.#played,
      uiClicks: this.#uiClicks,
      frames: this.#frames,
    };
  }

  #poseFrom(transform: ArrayLike<number>): XrPose {
    return { position: [transform[12]!, transform[13]!, transform[14]!], forward: [-transform[8]!, -transform[9]!, -transform[10]!] };
  }
}
