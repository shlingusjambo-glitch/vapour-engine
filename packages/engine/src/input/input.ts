export type InputDevice = "keyboard" | "pointer" | "gamepad";

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

  update(gamepads: readonly (Gamepad | null)[] = []): void {
    for (const [name, definition] of this.#definitions) {
      const state = this.#actions.get(name)!;
      state.previous = state.value;
      let value = 0;
      for (const binding of definition.bindings) {
        value += this.#bindingValue(binding, gamepads);
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
    if (definition.bindings.length === 0) throw new Error(`Input action '${definition.name}' has no bindings.`);
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

  #bindingValue(binding: InputBinding, gamepads: readonly (Gamepad | null)[]): number {
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

function validateBindings(bindings: readonly InputBinding[]): void {
  if (bindings.length === 0) throw new Error("Input actions need at least one binding.");
  for (const binding of bindings) {
    if (binding.device === "keyboard" && binding.code.trim() === "") throw new Error("Keyboard binding codes cannot be empty.");
    if (binding.device === "pointer" && binding.button !== undefined && (!Number.isInteger(binding.button) || binding.button < 0)) {
      throw new Error("Pointer binding buttons must be non-negative integers.");
    }
    if (binding.device === "gamepad" && (!Number.isInteger(binding.gamepad) || binding.gamepad < 0 || !Number.isInteger(binding.index) || binding.index < 0)) {
      throw new Error("Gamepad and control indices must be non-negative integers.");
    }
  }
}
