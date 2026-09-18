import type { XrHandedness } from "../xr/xr.js";

export type InputDevice = "keyboard" | "pointer" | "gamepad" | "xr";

/** The target-ray pose space, for `control: "pose"` bindings. */
export const XR_TARGET_RAY_SPACE = "target-ray";
/** The grip pose space, for `control: "pose"` bindings. */
export const XR_GRIP_SPACE = "grip";

/**
 * One XR controller or tracked hand for a single frame.
 *
 * Deliberately structural rather than a WebXR object: `XrInputSnapshot` from
 * the `xr` subsystem satisfies it, and so does a plain object literal, so XR
 * bindings resolve headlessly in tests, replays, and recorded sessions exactly
 * the way `setKey` and the `Gamepad` argument already do for other devices.
 * Transforms are column-major 16-element matrices, the WebXR layout.
 */
export interface XrInputDeviceState {
  readonly handedness: XrHandedness;
  readonly buttons: readonly { readonly value: number; readonly pressed: boolean; readonly touched: boolean }[];
  readonly axes: ArrayLike<number>;
  readonly targetRayTransform?: ArrayLike<number> | undefined;
  readonly gripTransform?: ArrayLike<number> | undefined;
  readonly joints?: readonly { readonly name: string; readonly transform: ArrayLike<number> }[] | undefined;
}

export type InputBinding =
  | { readonly device: "keyboard"; readonly code: string; readonly scale?: number }
  | { readonly device: "pointer"; readonly axis: "x" | "y" | "wheelX" | "wheelY"; readonly scale?: number; readonly button?: never }
  | { readonly device: "pointer"; readonly button: number; readonly scale?: number; readonly axis?: never }
  | {
      readonly device: "gamepad";
      readonly gamepad: number;
      readonly control: "button" | "axis";
      readonly index: number;
      readonly scale?: number;
      readonly deadZone?: number;
    }
  /** An XR controller button, by `xr-standard` index: 0 trigger, 1 squeeze,
   * 2 touchpad, 3 thumbstick, 4 and 5 the face buttons. `touch` resolves the
   * capacitive touched flag rather than the pressed value. */
  | {
      readonly device: "xr";
      readonly hand: XrHandedness;
      readonly control: "button" | "touch";
      readonly index: number;
      readonly scale?: number;
    }
  /** An XR controller axis: 0 and 1 the touchpad, 2 and 3 the thumbstick. */
  | {
      readonly device: "xr";
      readonly hand: XrHandedness;
      readonly control: "axis";
      readonly index: number;
      readonly scale?: number;
      readonly deadZone?: number;
    }
  /** One component of a tracked pose, in reference-space metres. `space` is
   * {@link XR_TARGET_RAY_SPACE}, {@link XR_GRIP_SPACE}, or a hand-joint name
   * such as `index-finger-tip`. */
  | {
      readonly device: "xr";
      readonly hand: XrHandedness;
      readonly control: "pose";
      readonly space: string;
      readonly axis: "x" | "y" | "z";
      readonly scale?: number;
    };

export interface InputActionDefinition {
  readonly name: string;
  readonly kind: "button" | "axis" | "delta";
  readonly bindings: readonly InputBinding[];
}

export interface ActionState {
  readonly value: number;
  readonly pressed: boolean;
  readonly justPressed: boolean;
  readonly justReleased: boolean;
}

interface MutableActionState {
  value: number;
  previous: number;
}

/** Action-based input collector. DOM listeners only update device state;
 * `update()` resolves every action once at the beginning of an engine frame. */
export class InputSystem {
  readonly #definitions = new Map<string, InputActionDefinition>();
  readonly #actions = new Map<string, MutableActionState>();
  readonly #keys = new Set<string>();
  readonly #pointerButtons = new Set<number>();
  readonly #pointerDelta = { x: 0, y: 0 };
  readonly #wheelDelta = { x: 0, y: 0 };
  readonly #pointerPosition = { x: 0, y: 0 };
  readonly #virtualValues = new Map<string, number>();
  #detach: (() => void) | undefined;
  #lastDevice: InputDevice | undefined;

  constructor(definitions: readonly InputActionDefinition[]) {
    for (const definition of definitions) {
      if (this.#definitions.has(definition.name)) throw new Error(`Duplicate input action '${definition.name}'.`);
      this.defineAction(definition);
    }
  }

  attach(target: Window): void {
    this.detach();
    const keyDown = (event: KeyboardEvent): void => {
      this.#keys.add(event.code);
    };
    const keyUp = (event: KeyboardEvent): void => {
      this.#keys.delete(event.code);
    };
    const pointerMove = (event: PointerEvent): void => {
      this.#pointerDelta.x += event.movementX;
      this.#pointerDelta.y += event.movementY;
      this.#pointerPosition.x = event.clientX;
      this.#pointerPosition.y = event.clientY;
    };
    const pointerDown = (event: PointerEvent): void => { this.#pointerPosition.x = event.clientX; this.#pointerPosition.y = event.clientY; this.#pointerButtons.add(event.button); };
    const pointerUp = (event: PointerEvent): void => { this.#pointerPosition.x = event.clientX; this.#pointerPosition.y = event.clientY; this.#pointerButtons.delete(event.button); };
    const wheel = (event: WheelEvent): void => { this.#wheelDelta.x += event.deltaX; this.#wheelDelta.y += event.deltaY; };
    const blur = (): void => { this.#keys.clear(); this.#pointerButtons.clear(); };
    target.addEventListener("keydown", keyDown);
    target.addEventListener("keyup", keyUp);
    target.addEventListener("pointermove", pointerMove);
    target.addEventListener("pointerdown", pointerDown);
    target.addEventListener("pointerup", pointerUp);
    target.addEventListener("wheel", wheel, { passive: true });
    target.addEventListener("blur", blur);
    this.#detach = (): void => {
      target.removeEventListener("keydown", keyDown);
      target.removeEventListener("keyup", keyUp);
      target.removeEventListener("pointermove", pointerMove);
      target.removeEventListener("pointerdown", pointerDown);
      target.removeEventListener("pointerup", pointerUp);
      target.removeEventListener("wheel", wheel);
      target.removeEventListener("blur", blur);
    };
  }

  detach(): void {
    this.#detach?.();
    this.#detach = undefined;
    this.resetDeviceState();
  }

  /** Clears held physical state after focus or pointer-lock loss. */
  resetDeviceState(): void {
    this.#keys.clear();
    this.#pointerButtons.clear();
    this.#pointerDelta.x = 0;
    this.#pointerDelta.y = 0;
    this.#wheelDelta.x = 0;
    this.#wheelDelta.y = 0;
  }

  /**
   * Resolves every action for this frame.
   *
   * `xrInputs` is the current frame's XR controllers and tracked hands, which
   * is `XrFrameSnapshot.inputs` in a real session and a plain array anywhere
   * else. It is a per-frame argument for the same reason `gamepads` is: the
   * browser hands these out fresh each frame and the input system does not own
   * their lifetime.
   */
  update(gamepads: readonly (Gamepad | null)[] = [], xrInputs: readonly XrInputDeviceState[] = []): void {
    for (const [name, definition] of this.#definitions) {
      const state = this.#actions.get(name)!;
      state.previous = state.value;
      let value = 0;
      for (const binding of definition.bindings) {
        const contribution = this.#bindingValue(binding, gamepads, xrInputs);
        // A tracked pose is never zero at rest, so it reports presence rather
        // than actuation and must not claim to be the player's active device.
        if (contribution !== 0 && !(binding.device === "xr" && binding.control === "pose")) {
          this.#lastDevice = binding.device;
        }
        value += contribution;
      }
      value += this.#virtualValues.get(name) ?? 0;
      state.value = definition.kind === "button"
        ? Number(value > 0.5)
        : definition.kind === "axis"
          ? Math.max(-1, Math.min(1, value))
          : value;
    }
    this.#pointerDelta.x = 0;
    this.#pointerDelta.y = 0;
    this.#wheelDelta.x = 0;
    this.#wheelDelta.y = 0;
  }

  action(name: string): ActionState {
    const state = this.#actions.get(name);
    if (state === undefined) {
      throw new Error(`Unknown input action '${name}'.`);
    }
    return {
      value: state.value,
      pressed: state.value > 0.5,
      justPressed: state.value > 0.5 && state.previous <= 0.5,
      justReleased: state.value <= 0.5 && state.previous > 0.5,
    };
  }

  /** Latest pointer position in viewport CSS pixels. */
  get pointerPosition(): Readonly<{ x: number; y: number }> { return this.#pointerPosition; }

  /** The device whose binding most recently contributed a non-zero value, so
   * UI can show matching prompts. Resolved per binding rather than per action,
   * because an action bound to a key *and* an XR trigger is answered wrongly by
   * looking at the action's first binding. */
  get lastDevice(): InputDevice | undefined { return this.#lastDevice; }

  /** Deterministic test and virtual-controller injection point. */
  setKey(code: string, pressed: boolean): void {
    if (pressed) this.#keys.add(code);
    else this.#keys.delete(code);
  }

  /** Deterministic test and virtual-pointer injection point. */
  setPointerButton(button: number, pressed: boolean): void {
    if (!Number.isInteger(button) || button < 0) throw new Error("Pointer button must be a non-negative integer.");
    if (pressed) this.#pointerButtons.add(button);
    else this.#pointerButtons.delete(button);
  }

  /** Deterministic and virtual-pointer position injection. */
  setPointerPosition(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Pointer position must be finite.");
    this.#pointerPosition.x = x;
    this.#pointerPosition.y = y;
  }

  /** Defines a new action or replaces an existing action's kind and bindings.
   * Live rebinding does not require detaching browser listeners. */
  defineAction(definition: InputActionDefinition): void {
    if (definition.name.trim() === "") throw new Error("Input action names cannot be empty.");
    // An action with no bindings is legal: a player slot without a gamepad or
    // headset still defines every action so gameplay code reads zeros rather
    // than throwing, and virtual (touch) input can still drive it.
    validateBindings(definition.bindings);
    this.#definitions.set(definition.name, {
      ...definition,
      bindings: definition.bindings.map((binding) => ({ ...binding })),
    });
    if (!this.#actions.has(definition.name)) {
      this.#actions.set(definition.name, { value: 0, previous: 0 });
    }
  }

  setBindings(name: string, bindings: readonly InputBinding[]): void {
    const definition = this.#definitions.get(name);
    if (definition === undefined) throw new Error(`Unknown input action '${name}'.`);
    this.defineAction({ ...definition, bindings });
  }

  bindings(name: string): readonly InputBinding[] {
    const definition = this.#definitions.get(name);
    if (definition === undefined) throw new Error(`Unknown input action '${name}'.`);
    return definition.bindings.map((binding) => ({ ...binding }));
  }

  /** Injects touch controls, accessibility switches, replay data, or remote
   * local-player devices into the same action resolver as physical devices. */
  setVirtualAction(name: string, value: number): void {
    if (!this.#definitions.has(name)) throw new Error(`Unknown input action '${name}'.`);
    if (!Number.isFinite(value)) throw new Error("Virtual input values must be finite.");
    if (value === 0) this.#virtualValues.delete(name);
    else this.#virtualValues.set(name, value);
  }

  /** Deterministic virtual look/touch injection, accumulated until update. */
  addPointerDelta(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Pointer deltas must be finite.");
    this.#pointerDelta.x += x;
    this.#pointerDelta.y += y;
  }

  /** Deterministic mouse-wheel injection, accumulated until update. Values use
   * the browser WheelEvent delta convention and are intentionally unbounded. */
  addWheelDelta(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Wheel deltas must be finite.");
    this.#wheelDelta.x += x;
    this.#wheelDelta.y += y;
  }

  #bindingValue(binding: InputBinding, gamepads: readonly (Gamepad | null)[], xrInputs: readonly XrInputDeviceState[]): number {
    const scale = binding.scale ?? 1;
    if (binding.device === "keyboard") {
      return (this.#keys.has(binding.code) ? 1 : 0) * scale;
    }
    if (binding.device === "pointer") {
      if (binding.button !== undefined) return (this.#pointerButtons.has(binding.button) ? 1 : 0) * scale;
      if (binding.axis === "wheelX") return this.#wheelDelta.x * scale;
      if (binding.axis === "wheelY") return this.#wheelDelta.y * scale;
      return this.#pointerDelta[binding.axis] * scale;
    }
    if (binding.device === "xr") {
      // An absent controller reads as zero rather than throwing: hands and
      // controllers appear and disappear mid-session, and that is normal.
      const device = xrInputs.find((candidate) => candidate.handedness === binding.hand);
      if (device === undefined) return 0;
      if (binding.control === "button") return (device.buttons[binding.index]?.value ?? 0) * scale;
      if (binding.control === "touch") return (device.buttons[binding.index]?.touched === true ? 1 : 0) * scale;
      if (binding.control === "axis") {
        const value = device.axes[binding.index] ?? 0;
        return (Math.abs(value) >= (binding.deadZone ?? 0.15) ? value : 0) * scale;
      }
      if (binding.control === "pose") {
        const transform = xrPoseTransform(device, binding.space);
        if (transform === undefined) return 0;
        return (transform[12 + POSE_AXIS[binding.axis]] ?? 0) * scale;
      }
      return 0;
    }
    const gamepad = gamepads[binding.gamepad];
    if (gamepad === null || gamepad === undefined) return 0;
    if (binding.control === "button") {
      return (gamepad.buttons[binding.index]?.value ?? 0) * scale;
    }
    const value = gamepad.axes[binding.index] ?? 0;
    return (Math.abs(value) >= (binding.deadZone ?? 0.15) ? value : 0) * scale;
  }
}

export interface PointerLockControllerOptions {
  readonly onChange?: (locked: boolean) => void;
  readonly onError?: (error: unknown) => void;
}

/** Browser pointer-lock lifecycle with unadjusted-motion progressive
 * enhancement. Games decide when UI allows locking; Vapour owns browser API
 * differences, state reset, and listener cleanup. */
export class PointerLockController {
  readonly #element: HTMLElement;
  readonly #document: Document;
  readonly #options: PointerLockControllerOptions;
  #attached = false;
  #locked = false;

  constructor(element: HTMLElement, options: PointerLockControllerOptions = {}) {
    this.#element = element;
    this.#document = element.ownerDocument;
    this.#options = options;
  }

  get locked(): boolean { return this.#locked; }

  attach(): void {
    if (this.#attached) return;
    this.#attached = true;
    this.#document.addEventListener("pointerlockchange", this.#change);
    this.#document.addEventListener("pointerlockerror", this.#error);
    this.#change();
  }

  async lock(): Promise<boolean> {
    this.attach();
    if (this.#locked) return true;
    const request = this.#element.requestPointerLock as ((options?: { unadjustedMovement?: boolean }) => Promise<void> | void) | undefined;
    if (request === undefined) return false;
    try {
      await request.call(this.#element, { unadjustedMovement: true });
    } catch {
      try { await request.call(this.#element); }
      catch (error) { this.#options.onError?.(error); return false; }
    }
    this.#change();
    return this.#locked;
  }

  async unlock(): Promise<void> {
    if (this.#document.pointerLockElement === this.#element) {
      await this.#document.exitPointerLock();
    }
  }

  detach(): void {
    if (!this.#attached) return;
    this.#attached = false;
    this.#document.removeEventListener("pointerlockchange", this.#change);
    this.#document.removeEventListener("pointerlockerror", this.#error);
    this.#locked = false;
  }

  readonly #change = (): void => {
    const next = this.#document.pointerLockElement === this.#element;
    if (next === this.#locked) return;
    this.#locked = next;
    this.#options.onChange?.(next);
  };

  readonly #error = (event: Event): void => { this.#options.onError?.(event); };
}

const POSE_AXIS = { x: 0, y: 1, z: 2 } as const;

/** Column-major transform of a named XR pose space, or undefined when the
 * device does not currently expose it. */
function xrPoseTransform(device: XrInputDeviceState, space: string): ArrayLike<number> | undefined {
  if (space === XR_TARGET_RAY_SPACE) return device.targetRayTransform;
  if (space === XR_GRIP_SPACE) return device.gripTransform;
  return device.joints?.find((joint) => joint.name === space)?.transform;
}

function validateBindings(bindings: readonly InputBinding[]): void {
  for (const binding of bindings) {
    if (binding.device === "keyboard" && binding.code.trim() === "") throw new Error("Keyboard binding codes cannot be empty.");
    if (binding.device === "xr") {
      if (binding.control === "pose") {
        if (binding.space.trim() === "") throw new Error("XR pose bindings need a pose space: 'target-ray', 'grip', or a hand-joint name.");
      } else if (!Number.isInteger(binding.index) || binding.index < 0) {
        throw new Error("XR button and axis indices must be non-negative integers.");
      }
    }
    if (binding.device === "pointer" && binding.button !== undefined && (!Number.isInteger(binding.button) || binding.button < 0)) {
      throw new Error("Pointer binding buttons must be non-negative integers.");
    }
    if (binding.device === "gamepad" && (!Number.isInteger(binding.gamepad) || binding.gamepad < 0 || !Number.isInteger(binding.index) || binding.index < 0)) {
      throw new Error("Gamepad and control indices must be non-negative integers.");
    }
  }
}
