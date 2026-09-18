import type { XrHandedness } from "../xr/xr.js";
export type InputDevice = "keyboard" | "pointer" | "gamepad" | "xr";
/** The target-ray pose space, for `control: "pose"` bindings. */
export declare const XR_TARGET_RAY_SPACE = "target-ray";
/** The grip pose space, for `control: "pose"` bindings. */
export declare const XR_GRIP_SPACE = "grip";
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
    readonly buttons: readonly {
        readonly value: number;
        readonly pressed: boolean;
        readonly touched: boolean;
    }[];
    readonly axes: ArrayLike<number>;
    readonly targetRayTransform?: ArrayLike<number> | undefined;
    readonly gripTransform?: ArrayLike<number> | undefined;
    readonly joints?: readonly {
        readonly name: string;
        readonly transform: ArrayLike<number>;
    }[] | undefined;
}
export type InputBinding = {
    readonly device: "keyboard";
    readonly code: string;
    readonly scale?: number;
} | {
    readonly device: "pointer";
    readonly axis: "x" | "y" | "wheelX" | "wheelY";
    readonly scale?: number;
    readonly button?: never;
} | {
    readonly device: "pointer";
    readonly button: number;
    readonly scale?: number;
    readonly axis?: never;
} | {
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
/** Action-based input collector. DOM listeners only update device state;
 * `update()` resolves every action once at the beginning of an engine frame. */
export declare class InputSystem {
    #private;
    constructor(definitions: readonly InputActionDefinition[]);
    attach(target: Window): void;
    detach(): void;
    /** Clears held physical state after focus or pointer-lock loss. */
    resetDeviceState(): void;
    /**
     * Resolves every action for this frame.
     *
     * `xrInputs` is the current frame's XR controllers and tracked hands, which
     * is `XrFrameSnapshot.inputs` in a real session and a plain array anywhere
     * else. It is a per-frame argument for the same reason `gamepads` is: the
     * browser hands these out fresh each frame and the input system does not own
     * their lifetime.
     */
    update(gamepads?: readonly (Gamepad | null)[], xrInputs?: readonly XrInputDeviceState[]): void;
    action(name: string): ActionState;
    /** Latest pointer position in viewport CSS pixels. */
    get pointerPosition(): Readonly<{
        x: number;
        y: number;
    }>;
    /** The device whose binding most recently contributed a non-zero value, so
     * UI can show matching prompts. Resolved per binding rather than per action,
     * because an action bound to a key *and* an XR trigger is answered wrongly by
     * looking at the action's first binding. */
    get lastDevice(): InputDevice | undefined;
    /** Deterministic test and virtual-controller injection point. */
    setKey(code: string, pressed: boolean): void;
    /** Deterministic test and virtual-pointer injection point. */
    setPointerButton(button: number, pressed: boolean): void;
    /** Deterministic and virtual-pointer position injection. */
    setPointerPosition(x: number, y: number): void;
    /** Defines a new action or replaces an existing action's kind and bindings.
     * Live rebinding does not require detaching browser listeners. */
    defineAction(definition: InputActionDefinition): void;
    setBindings(name: string, bindings: readonly InputBinding[]): void;
    bindings(name: string): readonly InputBinding[];
    /** Injects touch controls, accessibility switches, replay data, or remote
     * local-player devices into the same action resolver as physical devices. */
    setVirtualAction(name: string, value: number): void;
    /** Deterministic virtual look/touch injection, accumulated until update. */
    addPointerDelta(x: number, y: number): void;
    /** Deterministic mouse-wheel injection, accumulated until update. Values use
     * the browser WheelEvent delta convention and are intentionally unbounded. */
    addWheelDelta(x: number, y: number): void;
}
export interface PointerLockControllerOptions {
    readonly onChange?: (locked: boolean) => void;
    readonly onError?: (error: unknown) => void;
}
/** Browser pointer-lock lifecycle with unadjusted-motion progressive
 * enhancement. Games decide when UI allows locking; Vapour owns browser API
 * differences, state reset, and listener cleanup. */
export declare class PointerLockController {
    #private;
    constructor(element: HTMLElement, options?: PointerLockControllerOptions);
    get locked(): boolean;
    attach(): void;
    lock(): Promise<boolean>;
    unlock(): Promise<void>;
    detach(): void;
}
//# sourceMappingURL=input.d.ts.map