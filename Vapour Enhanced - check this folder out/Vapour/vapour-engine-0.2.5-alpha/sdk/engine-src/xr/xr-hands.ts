/** Hand-pose recognition and queued haptics.
 *
 * A tracked hand is 25 joints and no meaning. Games want "is the player
 * pinching" and "is that a fist", and want the answer not to flicker when a
 * fingertip hovers on the threshold. Recognition here is deliberately simple —
 * distances and curl ratios over the WebXR joint set — with per-pose
 * *hysteresis*: a pose engages at one threshold and releases at a looser one,
 * so a hand that is 51% then 49% pinched reads as one steady pinch.
 *
 * Haptics are queued rather than fired because gameplay code pulses from
 * collision callbacks and animation events that do not know about each other.
 * A queue with a per-hand cap coalesces them into something a controller can
 * actually play and lets a device with no actuator no-op without every caller
 * checking.
 */
import type { XrHandedness, XrInputSnapshot, XrJointSnapshot } from "./xr.js";

export type XrHandPose = "open" | "fist" | "pinch" | "point";

export interface HandPoseThresholds {
  /** Thumb-tip to index-tip distance, metres, at which a pinch engages. */
  readonly pinchEngage?: number;
  /** Distance at which an engaged pinch releases. Must be ≥ `pinchEngage`. */
  readonly pinchRelease?: number;
  /** Average finger curl (0 straight … 1 fully curled) at which a fist engages. */
  readonly fistEngage?: number;
  readonly fistRelease?: number;
  /** Curl below which a finger counts as extended for `point` and `open`. */
  readonly extendedCurl?: number;
}

export interface HandPoseState {
  readonly hand: XrHandedness;
  readonly pose: XrHandPose | undefined;
  readonly pinchDistance: number | undefined;
  /** Per-finger curl: thumb, index, middle, ring, little. */
  readonly curl: readonly [number, number, number, number, number];
  readonly tracked: boolean;
}

const FINGERS = ["thumb", "index-finger", "middle-finger", "ring-finger", "pinky-finger"] as const;
const SEGMENTS = ["metacarpal", "phalanx-proximal", "phalanx-intermediate", "phalanx-distal", "tip"] as const;

const DEFAULTS: Required<HandPoseThresholds> = {
  pinchEngage: 0.02,
  pinchRelease: 0.035,
  fistEngage: 0.7,
  fistRelease: 0.55,
  extendedCurl: 0.3,
};

function jointPosition(joint: XrJointSnapshot | undefined): readonly [number, number, number] | undefined {
  if (joint === undefined) return undefined;
  const m = joint.transform;
  return [m[12]!, m[13]!, m[14]!];
}

function distance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Curl of one finger in `[0, 1]`: 0 when the tip is as far from the wrist as
 * the finger is long, 1 when the tip has folded back to the base joint.
 */
export function fingerCurl(joints: ReadonlyMap<string, XrJointSnapshot>, finger: (typeof FINGERS)[number]): number | undefined {
  const names = SEGMENTS.map((segment) => `${finger}-${segment}`);
  const points = names.map((name) => jointPosition(joints.get(name)));
  const base = points[0];
  const tip = points[points.length - 1];
  if (base === undefined || tip === undefined) return undefined;
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) return undefined;
    length += distance(from, to);
  }
  if (length <= 0) return undefined;
  const reach = distance(base, tip);
  return Math.max(0, Math.min(1, 1 - reach / length));
}

/** Recognises poses per hand with hysteresis across frames. */
export class HandPoseRecognizer {
  readonly #thresholds: Required<HandPoseThresholds>;
  readonly #current = new Map<XrHandedness, XrHandPose | undefined>();

  constructor(thresholds: HandPoseThresholds = {}) {
    const merged = { ...DEFAULTS, ...thresholds };
    if (merged.pinchRelease < merged.pinchEngage) throw new Error("pinchRelease must be at least pinchEngage, or the pose would flicker.");
    if (merged.fistRelease > merged.fistEngage) throw new Error("fistRelease must be at most fistEngage, or the pose would flicker.");
    this.#thresholds = merged;
  }

  /** Current pose for a hand, or undefined when nothing is engaged. */
  pose(hand: XrHandedness): XrHandPose | undefined {
    return this.#current.get(hand);
  }

  update(input: XrInputSnapshot): HandPoseState {
    const joints = new Map(input.joints.map((joint) => [joint.name, joint]));
    if (joints.size === 0) {
      this.#current.set(input.handedness, undefined);
      return { hand: input.handedness, pose: undefined, pinchDistance: undefined, curl: [0, 0, 0, 0, 0], tracked: false };
    }
    const curl = FINGERS.map((finger) => fingerCurl(joints, finger) ?? 0) as [number, number, number, number, number];
    const thumb = jointPosition(joints.get("thumb-tip"));
    const index = jointPosition(joints.get("index-finger-tip"));
    const pinchDistance = thumb !== undefined && index !== undefined ? distance(thumb, index) : undefined;
    const previous = this.#current.get(input.handedness);
    const next = this.#classify(previous, curl, pinchDistance);
    this.#current.set(input.handedness, next);
    return { hand: input.handedness, pose: next, pinchDistance, curl, tracked: true };
  }

  #classify(previous: XrHandPose | undefined, curl: readonly number[], pinch: number | undefined): XrHandPose | undefined {
    const t = this.#thresholds;
    // Pinch has priority: it is the deliberate gesture and a pinching hand's
    // other fingers are usually curled enough to look like a fist.
    if (pinch !== undefined) {
      if (previous === "pinch" ? pinch <= t.pinchRelease : pinch <= t.pinchEngage) return "pinch";
    }
    // Point is checked before fist: an extended index finger is what makes a
    // hand a point rather than a fist, even while the other three fingers'
    // curl still reads inside the fist hysteresis band from a moment ago.
    const indexExtended = curl[1]! < t.extendedCurl;
    const othersCurled = curl[2]! >= t.extendedCurl && curl[3]! >= t.extendedCurl && curl[4]! >= t.extendedCurl;
    if (indexExtended && othersCurled) return "point";
    const fingersCurl = (curl[1]! + curl[2]! + curl[3]! + curl[4]!) / 4;
    if (previous === "fist" ? fingersCurl >= t.fistRelease : fingersCurl >= t.fistEngage) return "fist";
    if (curl.slice(1).every((value) => value < t.extendedCurl)) return "open";
    return undefined;
  }
}

/** A queued pulse for one hand. */
export interface HapticPulse {
  readonly hand: Exclude<XrHandedness, "none">;
  readonly intensity: number;
  readonly durationMs: number;
}

/** The pulse sink: the session manager's `pulse`, or anything shaped like it. */
export type HapticActuator = (hand: Exclude<XrHandedness, "none">, intensity: number, durationMs: number) => Promise<boolean>;

export interface HapticsStats {
  readonly queued: number;
  readonly played: number;
  readonly dropped: number;
  /** Pulses the device reported it could not play. */
  readonly unsupported: number;
}

/**
 * Queues pulses per hand and plays them through an actuator.
 *
 * Pulses queued in the same frame for the same hand are merged into one whose
 * intensity is the maximum and duration the longest — a controller cannot
 * play two overlapping rumbles, and the strongest one is what the player
 * should feel.
 */
export class XrHaptics {
  readonly #actuator: HapticActuator;
  readonly #maxPerHand: number;
  readonly #queue = new Map<HapticPulse["hand"], HapticPulse[]>();
  #played = 0;
  #dropped = 0;
  #unsupported = 0;

  constructor(actuator: HapticActuator, options: { readonly maxPerHand?: number } = {}) {
    this.#actuator = actuator;
    this.#maxPerHand = options.maxPerHand ?? 4;
    if (!Number.isInteger(this.#maxPerHand) || this.#maxPerHand < 1) throw new Error("Haptics maxPerHand must be a positive whole number.");
  }

  pulse(hand: HapticPulse["hand"], intensity: number, durationMs: number): void {
    if (!(intensity >= 0 && intensity <= 1)) throw new Error("Haptic intensity must be in [0, 1].");
    if (!(durationMs >= 0 && durationMs <= 5000)) throw new Error("Haptic duration must be in [0, 5000] ms.");
    const queue = this.#queue.get(hand) ?? [];
    if (queue.length >= this.#maxPerHand) {
      this.#dropped += 1;
      return;
    }
    queue.push({ hand, intensity, durationMs });
    this.#queue.set(hand, queue);
  }

  /** Plays one merged pulse per hand and clears the queue. Never throws for an unsupported device. */
  async flush(): Promise<void> {
    const pending = [...this.#queue.entries()];
    this.#queue.clear();
    for (const [hand, pulses] of pending) {
      if (pulses.length === 0) continue;
      const intensity = Math.max(...pulses.map((pulse) => pulse.intensity));
      const durationMs = Math.max(...pulses.map((pulse) => pulse.durationMs));
      let ok = false;
      try {
        ok = await this.#actuator(hand, intensity, durationMs);
      } catch {
        ok = false;
      }
      if (ok) this.#played += 1;
      else this.#unsupported += 1;
    }
  }

  stats(): HapticsStats {
    let queued = 0;
    for (const pulses of this.#queue.values()) queued += pulses.length;
    return { queued, played: this.#played, dropped: this.#dropped, unsupported: this.#unsupported };
  }
}
