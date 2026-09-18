export interface RuntimeFrameTime {
  readonly deltaSeconds: number;
  readonly elapsedSeconds: number;
  readonly frame: number;
  readonly fixedDeltaSeconds: number;
  readonly fixedSteps: number;
}

export interface RuntimeLoopHooks {
  readonly start?: () => void | Promise<void>;
  readonly update: (time: RuntimeFrameTime) => void;
  readonly stop?: () => void;
  readonly error?: (error: unknown) => void;
}

export interface RuntimeLoopOptions {
  readonly fixedHz?: number;
  readonly maxDeltaSeconds?: number;
  readonly maxFixedStepsPerFrame?: number;
  readonly now?: () => number;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
}

/** Renderer-independent browser game lifecycle and fixed-step clock.
 *
 * The WebGPU `GameRuntime`, editor play mode, Three migration bridge, and
 * server-authoritative simulations can all use the same timing contract. The
 * loop clamps background-tab deltas and caps catch-up work to prevent a death
 * spiral, while still exposing exactly how many deterministic steps belong to
 * the current presentation frame. */
export class RuntimeLoop extends EventTarget {
  readonly #hooks: RuntimeLoopHooks;
  readonly #fixedDelta: number;
  readonly #maxDelta: number;
  readonly #maxFixedSteps: number;
  readonly #now: () => number;
  readonly #requestFrame: (callback: FrameRequestCallback) => number;
  readonly #cancelFrame: (handle: number) => void;
  #running = false;
  #starting = false;
  #handle = 0;
  #lastMilliseconds = 0;
  #accumulator = 0;
  #elapsed = 0;
  #frame = 0;

  constructor(hooks: RuntimeLoopHooks, options: RuntimeLoopOptions = {}) {
    super();
    const fixedHz = options.fixedHz ?? 60;
    const maxDelta = options.maxDeltaSeconds ?? 0.1;
    const maxFixedSteps = options.maxFixedStepsPerFrame ?? 8;
    if (!(fixedHz > 0) || !Number.isFinite(fixedHz)) throw new Error("fixedHz must be positive and finite.");
    if (!(maxDelta > 0) || !Number.isFinite(maxDelta)) throw new Error("maxDeltaSeconds must be positive and finite.");
    if (!Number.isInteger(maxFixedSteps) || maxFixedSteps < 1) throw new Error("maxFixedStepsPerFrame must be a positive integer.");
    this.#hooks = hooks;
    this.#fixedDelta = 1 / fixedHz;
    this.#maxDelta = maxDelta;
    this.#maxFixedSteps = maxFixedSteps;
    this.#now = options.now ?? (() => performance.now());
    this.#requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.#cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  }

  get running(): boolean { return this.#running; }

  async start(): Promise<void> {
    if (this.#running || this.#starting) return;
    this.#starting = true;
    try {
      await this.#hooks.start?.();
      this.#running = true;
      this.#lastMilliseconds = this.#now();
      this.#accumulator = 0;
      this.#handle = this.#requestFrame(this.#tick);
      this.dispatchEvent(new Event("started"));
    } catch (error) {
      this.#report(error);
      throw error;
    } finally {
      this.#starting = false;
    }
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#handle !== 0) this.#cancelFrame(this.#handle);
    this.#handle = 0;
    try { this.#hooks.stop?.(); }
    catch (error) { this.#report(error); }
    this.dispatchEvent(new Event("stopped"));
  }

  /** Advances deterministically without scheduling; used by tests, editor
   * stepping, replay tools, and non-window hosts. */
  step(nowMilliseconds: number): RuntimeFrameTime {
    const rawDelta = (nowMilliseconds - this.#lastMilliseconds) / 1000;
    this.#lastMilliseconds = nowMilliseconds;
    const delta = Math.min(Math.max(rawDelta, 0), this.#maxDelta);
    this.#elapsed += delta;
    this.#accumulator = Math.min(
      this.#accumulator + delta,
      this.#fixedDelta * this.#maxFixedSteps,
    );
    const fixedSteps = Math.min(
      Math.floor((this.#accumulator + Number.EPSILON) / this.#fixedDelta),
      this.#maxFixedSteps,
    );
    this.#accumulator -= fixedSteps * this.#fixedDelta;
    const time: RuntimeFrameTime = {
      deltaSeconds: delta,
      elapsedSeconds: this.#elapsed,
      frame: this.#frame,
      fixedDeltaSeconds: this.#fixedDelta,
      fixedSteps,
    };
    this.#hooks.update(time);
    this.#frame += 1;
    return time;
  }

  readonly #tick = (now: number): void => {
    if (!this.#running) return;
    try { this.step(now); }
    catch (error) { this.#report(error); this.stop(); return; }
    if (this.#running) this.#handle = this.#requestFrame(this.#tick);
  };

  #report(error: unknown): void {
    this.#hooks.error?.(error);
    this.dispatchEvent(new Event("error"));
  }
}
