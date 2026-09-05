/** Renderer-independent UI transitions for DOM, canvas, and world-space UI. */
import { easing, type EasingName, type Rgba } from "@vapour/math";

export interface UiAnimatedState {
  readonly opacity: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotation: number;
  readonly color?: Rgba;
}

export type UiAnimatedProperty = keyof UiAnimatedState;

export interface UiAnimationTrack {
  readonly property: UiAnimatedProperty;
  readonly from: number | Rgba;
  readonly to: number | Rgba;
  readonly easing?: EasingName;
}

export interface UiAnimationClip {
  readonly name: string;
  readonly duration: number;
  readonly delay?: number;
  readonly tracks: readonly UiAnimationTrack[];
  readonly loop?: boolean;
  readonly pingPong?: boolean;
}

export interface UiAnimationEvent {
  readonly target: string;
  readonly clip: string;
  readonly type: "complete" | "cancel";
}

interface Playing {
  readonly target: string;
  readonly clip: UiAnimationClip;
  elapsed: number;
}

export const DEFAULT_UI_ANIMATED_STATE: UiAnimatedState = {
  opacity: 1,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
};

/** Deterministic UI animation scheduler. It changes plain visual state rather
 * than DOM styles, so the exact same clips animate screen and XR panels. */
export class UiAnimator {
  readonly #states = new Map<string, UiAnimatedState>();
  readonly #playing = new Map<string, Playing>();
  readonly #events: UiAnimationEvent[] = [];
  reducedMotion = false;

  state(target: string): UiAnimatedState {
    return this.#states.get(target) ?? DEFAULT_UI_ANIMATED_STATE;
  }

  setState(target: string, state: Partial<UiAnimatedState>): void {
    requireTarget(target);
    this.#states.set(target, {
      ...DEFAULT_UI_ANIMATED_STATE,
      ...this.state(target),
      ...state,
    });
  }

  play(target: string, clip: UiAnimationClip): void {
    requireTarget(target);
    validateUiAnimation(clip);
    this.#playing.set(target, { target, clip, elapsed: 0 });
    if (this.reducedMotion) this.#finish(this.#playing.get(target)!);
  }

  cancel(target: string): boolean {
    const playing = this.#playing.get(target);
    if (!playing) return false;
    this.#playing.delete(target);
    this.#events.push({ target, clip: playing.clip.name, type: "cancel" });
    return true;
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
      throw new Error(
        "UI animation update requires a finite, non-negative delta.",
      );
    for (const playing of [...this.#playing.values()]) {
      playing.elapsed += deltaSeconds;
      const delay = playing.clip.delay ?? 0;
      if (playing.elapsed < delay) continue;
      const local = playing.elapsed - delay;
      const cycles = local / playing.clip.duration;
      if (!playing.clip.loop && cycles >= 1) {
        this.#finish(playing);
        continue;
      }
      let t = playing.clip.loop ? cycles % 1 : Math.min(1, cycles);
      if (playing.clip.pingPong && Math.floor(cycles) % 2 === 1) t = 1 - t;
      this.#apply(playing, t);
    }
  }

  drainEvents(): readonly UiAnimationEvent[] {
    const events = this.#events.splice(0);
    return events;
  }

  get activeCount(): number {
    return this.#playing.size;
  }

  #finish(playing: Playing): void {
    this.#apply(playing, playing.clip.pingPong && playing.clip.loop ? 0 : 1);
    this.#playing.delete(playing.target);
    this.#events.push({
      target: playing.target,
      clip: playing.clip.name,
      type: "complete",
    });
  }

  #apply(playing: Playing, time: number): void {
    const next = { ...this.state(playing.target) } as Record<
      UiAnimatedProperty,
      number | Rgba | undefined
    >;
    for (const track of playing.clip.tracks) {
      const t = easing(track.easing ?? "linear")(time);
      next[track.property] = interpolate(track.from, track.to, t);
    }
    this.#states.set(playing.target, next as UiAnimatedState);
  }
}

export function validateUiAnimation(clip: UiAnimationClip): UiAnimationClip {
  if (!clip.name.trim())
    throw new Error("A UI animation requires a non-empty name.");
  if (!Number.isFinite(clip.duration) || clip.duration <= 0)
    throw new Error(
      `UI animation "${clip.name}" duration must be positive and finite.`,
    );
  if (
    clip.delay !== undefined &&
    (!Number.isFinite(clip.delay) || clip.delay < 0)
  )
    throw new Error(
      `UI animation "${clip.name}" delay must be finite and non-negative.`,
    );
  if (clip.tracks.length === 0)
    throw new Error(`UI animation "${clip.name}" requires at least one track.`);
  const properties = new Set<string>();
  for (const track of clip.tracks) {
    if (properties.has(track.property))
      throw new Error(
        `UI animation "${clip.name}" has duplicate track "${track.property}".`,
      );
    properties.add(track.property);
    const color = track.property === "color";
    if (
      color !== Array.isArray(track.from) ||
      color !== Array.isArray(track.to)
    )
      throw new Error(
        `UI animation "${clip.name}" track "${track.property}" has the wrong value type.`,
      );
    const values = [
      ...(Array.isArray(track.from) ? track.from : [track.from]),
      ...(Array.isArray(track.to) ? track.to : [track.to]),
    ];
    if (values.some((value) => !Number.isFinite(value)))
      throw new Error(
        `UI animation "${clip.name}" track "${track.property}" contains a non-finite value.`,
      );
  }
  return clip;
}

function interpolate(
  from: number | Rgba,
  to: number | Rgba,
  t: number,
): number | Rgba {
  if (typeof from === "number" && typeof to === "number")
    return from + (to - from) * t;
  if (Array.isArray(from) && Array.isArray(to))
    return [0, 1, 2, 3].map(
      (index) => from[index]! + (to[index]! - from[index]!) * t,
    ) as Rgba;
  throw new Error("UI animation values do not have matching types.");
}

function requireTarget(target: string): void {
  if (!target.trim())
    throw new Error("A UI animation target requires a non-empty id.");
}
