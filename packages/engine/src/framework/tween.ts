/** Tweening on the simulation clock.
 *
 * Animating a number over time is one of the things every game reimplements,
 * usually with `setInterval` and a hand-rolled ease. Tweens here run on the
 * same explicitly advanced clock as {@link Scheduler}, so they pause when the
 * game pauses, slow down in slow motion, and reproduce exactly under a replay.
 *
 * Values are interpolated component-wise, so the same tween drives a number, a
 * position, a colour, or any fixed-length numeric tuple.
 */
import { EASINGS, saturate, type EasingName } from "@vapour/math";

export type TweenValue = number | readonly number[];

export type TweenLoopMode = "once" | "loop" | "pingPong";

export interface TweenOptions<T extends TweenValue> {
  readonly from: T;
  readonly to: T;
  readonly durationSeconds: number;
  readonly easing?: EasingName;
  /** Simulation seconds to wait before the first update. */
  readonly delaySeconds?: number;
  readonly loop?: TweenLoopMode;
  readonly onUpdate: (value: T) => void;
  readonly onComplete?: () => void;
}

export type TweenState = "delayed" | "running" | "completed" | "cancelled";

export interface TweenHandle {
  readonly state: TweenState;
  /** Progress in `[0, 1]` before easing. */
  readonly progress: number;
  cancel(): void;
  /** Jumps to the end, invoking `onUpdate` and `onComplete` once. */
  complete(): void;
}

interface TweenRecord<T extends TweenValue> {
  readonly options: TweenOptions<T>;
  readonly numeric: boolean;
  readonly length: number;
  elapsed: number;
  delay: number;
  state: TweenState;
  forward: boolean;
  scratch: number[];
}

/**
 * Runs tweens against an explicitly advanced clock.
 *
 * One `TweenRunner` per timeline is the usual arrangement: gameplay tweens on
 * the paused-with-the-game clock, UI tweens on an unpaused one, so a menu still
 * animates while the world is frozen.
 */
export class TweenRunner {
  readonly #tweens = new Set<TweenRecord<never>>();

  get count(): number {
    return this.#tweens.size;
  }

  /** Starts a tween. It does not update until the first {@link advance}, so a
   * caller that wants the start value applied immediately should set it. */
  to<T extends TweenValue>(options: TweenOptions<T>): TweenHandle {
    const duration = options.durationSeconds;
    if (!Number.isFinite(duration) || duration < 0) throw new Error("A tween requires a finite, non-negative duration.");
    const delay = options.delaySeconds ?? 0;
    if (!Number.isFinite(delay) || delay < 0) throw new Error("A tween delay must be finite and non-negative.");
    if (typeof options.onUpdate !== "function") throw new Error("A tween requires an onUpdate callback.");
    const easingName = options.easing ?? "linear";
    if (!Object.hasOwn(EASINGS, easingName)) throw new Error(`Unknown tween easing "${easingName}".`);

    const numeric = typeof options.from === "number";
    if (numeric !== (typeof options.to === "number")) {
      throw new Error("A tween's from and to values must both be numbers or both be numeric arrays.");
    }
    const length = numeric ? 1 : (options.from as readonly number[]).length;
    if (!numeric && (options.to as readonly number[]).length !== length) {
      throw new Error(`A tween's from and to arrays must be the same length (got ${length} and ${(options.to as readonly number[]).length}).`);
    }

    const record: TweenRecord<T> = {
      options,
      numeric,
      length,
      elapsed: 0,
      delay,
      state: delay > 0 ? "delayed" : "running",
      forward: true,
      scratch: new Array<number>(length).fill(0),
    };
    this.#tweens.add(record as unknown as TweenRecord<never>);

    return {
      get state() {
        return record.state;
      },
      get progress() {
        return duration <= 0 ? 1 : saturate(record.elapsed / duration);
      },
      cancel: () => {
        if (record.state === "completed" || record.state === "cancelled") return;
        record.state = "cancelled";
        this.#tweens.delete(record as unknown as TweenRecord<never>);
      },
      complete: () => {
        if (record.state === "completed" || record.state === "cancelled") return;
        record.elapsed = duration;
        const erased = record as unknown as TweenRecord<TweenValue>;
        this.#apply(erased, 1);
        this.#finish(erased);
      },
    };
  }

  advance(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new Error("TweenRunner.advance requires a finite, non-negative delta.");
    }
    for (const record of [...this.#tweens] as unknown as TweenRecord<TweenValue>[]) {
      if (record.state === "cancelled" || record.state === "completed") continue;
      let remaining = deltaSeconds;
      if (record.delay > 0) {
        const consumed = Math.min(record.delay, remaining);
        record.delay -= consumed;
        remaining -= consumed;
        if (record.delay > 0) continue;
        record.state = "running";
      }
      const duration = record.options.durationSeconds;
      if (duration <= 0) {
        this.#apply(record, 1);
        this.#finish(record);
        continue;
      }
      record.elapsed += remaining;
      const mode = record.options.loop ?? "once";
      if (record.elapsed < duration) {
        this.#apply(record, this.#fraction(record));
        continue;
      }
      if (mode === "once") {
        record.elapsed = duration;
        this.#apply(record, record.forward ? 1 : 0);
        this.#finish(record);
        continue;
      }
      // Wrap, carrying the overshoot so a loop does not drift on long deltas.
      const cycles = Math.floor(record.elapsed / duration);
      record.elapsed -= cycles * duration;
      if (mode === "pingPong" && cycles % 2 === 1) record.forward = !record.forward;
      this.#apply(record, this.#fraction(record));
    }
  }

  /** Cancels every tween without invoking `onComplete`. */
  clear(): void {
    for (const record of this.#tweens) record.state = "cancelled";
    this.#tweens.clear();
  }

  #fraction(record: TweenRecord<TweenValue>): number {
    const raw = saturate(record.elapsed / record.options.durationSeconds);
    return record.forward ? raw : 1 - raw;
  }

  #apply(record: TweenRecord<TweenValue>, fraction: number): void {
    const ease = EASINGS[record.options.easing ?? "linear"];
    const t = ease(saturate(fraction));
    if (record.numeric) {
      const from = record.options.from as number;
      const to = record.options.to as number;
      (record.options.onUpdate as (value: number) => void)(from + (to - from) * t);
      return;
    }
    const from = record.options.from as readonly number[];
    const to = record.options.to as readonly number[];
    // Reuse one scratch array per tween: a tween updating every frame for a
    // whole session should not allocate every frame.
    for (let index = 0; index < record.length; index += 1) {
      const a = from[index]!;
      record.scratch[index] = a + (to[index]! - a) * t;
    }
    (record.options.onUpdate as (value: readonly number[]) => void)(record.scratch);
  }

  #finish(record: TweenRecord<TweenValue>): void {
    record.state = "completed";
    this.#tweens.delete(record as unknown as TweenRecord<never>);
    record.options.onComplete?.();
  }
}
