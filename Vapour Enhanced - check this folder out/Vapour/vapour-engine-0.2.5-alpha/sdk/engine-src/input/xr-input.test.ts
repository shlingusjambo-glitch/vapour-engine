import { describe, expect, it } from "vitest";
import { InputActions, PlayerInput, type ActionMapDefinition } from "./actions.js";
import { XR_GRIP_SPACE, XR_TARGET_RAY_SPACE, type XrInputDeviceState } from "./input.js";

/** Mirage M84: XR controllers and hands as first-class input devices. */
const xrMap: ActionMapDefinition = {
  name: "xr",
  actions: [
    { name: "Fire", kind: "button", bindings: [{ device: "keyboard", code: "Space" }, { device: "xr", hand: "right", control: "button", index: 0 }] },
    { name: "Grab", kind: "button", bindings: [{ device: "keyboard", code: "KeyG" }, { device: "xr", hand: "left", control: "button", index: 1 }] },
    { name: "TouchPad", kind: "button", bindings: [{ device: "keyboard", code: "KeyT" }, { device: "xr", hand: "right", control: "touch", index: 2 }] },
    { name: "TurnX", kind: "axis", bindings: [{ device: "xr", hand: "right", control: "axis", index: 2, deadZone: 0.2 }] },
    { name: "TurnY", kind: "axis", bindings: [{ device: "xr", hand: "right", control: "axis", index: 3, deadZone: 0.2 }] },
    // Poses are metres, not a normalised axis: "delta" is the unclamped kind.
    { name: "HandHeight", kind: "delta", bindings: [{ device: "xr", hand: "left", control: "pose", space: XR_GRIP_SPACE, axis: "y" }] },
    { name: "FingerX", kind: "delta", bindings: [{ device: "xr", hand: "left", control: "pose", space: "index-finger-tip", axis: "x" }] },
    { name: "RayZ", kind: "delta", bindings: [{ device: "xr", hand: "right", control: "pose", space: XR_TARGET_RAY_SPACE, axis: "z" }] },
  ],
  composites: [{ name: "Turn", kind: "vector2", positiveX: "TurnX", positiveY: "TurnY" }],
};

function transformAt(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function controller(hand: "left" | "right", overrides: Partial<XrInputDeviceState> = {}): XrInputDeviceState {
  return {
    handedness: hand,
    buttons: [
      { value: 0, pressed: false, touched: false },
      { value: 0, pressed: false, touched: false },
      { value: 0, pressed: false, touched: false },
      { value: 0, pressed: false, touched: false },
    ],
    axes: [0, 0, 0, 0],
    targetRayTransform: transformAt(0, 1.4, -0.5),
    gripTransform: transformAt(0.2, 1.2, -0.3),
    ...overrides,
  };
}

describe("XR bindings", () => {
  it("resolves trigger, squeeze, and touch bindings by hand", () => {
    const actions = new InputActions([xrMap]);
    const right = controller("right", { buttons: [{ value: 0.9, pressed: true, touched: true }, { value: 0, pressed: false, touched: false }, { value: 0, pressed: false, touched: true }] });
    const left = controller("left", { buttons: [{ value: 0, pressed: false, touched: false }, { value: 1, pressed: true, touched: true }] });
    actions.update([], [left, right]);
    expect(actions.pressed("Fire")).toBe(true);
    // A button action reports pressed as 1; the analogue trigger value is on the raw binding.
    expect(actions.value("Fire")).toBe(1);
    expect(actions.pressed("Grab")).toBe(true);
    expect(actions.pressed("TouchPad")).toBe(true);
    expect(actions.lastDevice).toBe("xr");
  });

  it("applies a dead zone to thumbstick axes and reads them into a composite", () => {
    const actions = new InputActions([xrMap]);
    actions.update([], [controller("right", { axes: [0, 0, 0.1, -0.8] })]);
    // Below the dead zone reads zero; above it the value is rescaled into the remaining range.
    expect(actions.vector("Turn").x).toBe(0);
    expect(actions.vector("Turn").y).toBeLessThan(-0.7);
    actions.update([], [controller("right", { axes: [0, 0, 0.6, 0] })]);
    expect(actions.vector("Turn").x).toBeGreaterThan(0.4);
  });

  it("reads pose components from grip, target-ray, and hand-joint spaces", () => {
    const actions = new InputActions([xrMap]);
    const left = controller("left", { joints: [{ name: "index-finger-tip", transform: transformAt(0.35, 1.3, -0.4) }] });
    actions.update([], [left, controller("right")]);
    expect(actions.value("HandHeight")).toBeCloseTo(1.2);
    expect(actions.value("FingerX")).toBeCloseTo(0.35);
    expect(actions.value("RayZ")).toBeCloseTo(-0.5);
    // A pose is presence, not actuation: it must not claim the active device.
    expect(actions.lastDevice).toBeUndefined();
  });

  it("reads zero, not an error, when a controller or joint is absent", () => {
    const actions = new InputActions([xrMap]);
    actions.update([], []);
    expect(actions.value("Fire")).toBe(0);
    expect(actions.value("HandHeight")).toBe(0);
    actions.update([], [controller("left", { gripTransform: undefined })]);
    expect(actions.value("HandHeight")).toBe(0);
    expect(actions.value("FingerX")).toBe(0);
  });

  it("keeps keyboard and XR bindings on one action and reports whichever fired", () => {
    const actions = new InputActions([xrMap]);
    actions.system.setKey("Space", true);
    actions.update([], [controller("right")]);
    expect(actions.pressed("Fire")).toBe(true);
    expect(actions.lastDevice).toBe("keyboard");
  });

  it("rebinds to an XR control, serializes the override, and reloads it", () => {
    const actions = new InputActions([xrMap]);
    actions.rebind("Fire", [{ device: "xr", hand: "left", control: "button", index: 0 }]);
    const overrides = actions.overrides();
    expect(overrides["Fire"]).toEqual([{ device: "xr", hand: "left", control: "button", index: 0 }]);
    const reloaded = new InputActions([xrMap]);
    expect(reloaded.applyOverrides(JSON.parse(JSON.stringify(overrides)))).toEqual([]);
    reloaded.update([], [controller("left", { buttons: [{ value: 1, pressed: true, touched: true }] })]);
    expect(reloaded.pressed("Fire")).toBe(true);
    reloaded.resetBindings("Fire");
    reloaded.update([], [controller("left", { buttons: [{ value: 1, pressed: true, touched: true }] })]);
    expect(reloaded.pressed("Fire")).toBe(false);
  });

  it("validates XR bindings at definition time", () => {
    expect(() => new InputActions([{ name: "bad", actions: [{ name: "A", kind: "button", bindings: [{ device: "xr", hand: "left", control: "button", index: -1 }] }] }]))
      .toThrow(/non-negative/);
    expect(() => new InputActions([{ name: "bad", actions: [{ name: "A", kind: "axis", bindings: [{ device: "xr", hand: "left", control: "pose", space: " ", axis: "x" }] }] }]))
      .toThrow(/pose space/);
  });

  it("routes XR to exactly the player slot that owns the headset", () => {
    const players = new PlayerInput([xrMap]);
    const headset = players.addPlayer({ id: 0, xr: true, keyboard: false });
    const couch = players.addPlayer({ id: 1, gamepad: 0 });
    const fired = controller("right", { buttons: [{ value: 1, pressed: true, touched: true }] });
    headset.update([], [fired]);
    couch.update([], [fired]);
    expect(headset.pressed("Fire")).toBe(true);
    expect(couch.pressed("Fire")).toBe(false);
    expect(couch.system.bindings("Fire").some((binding) => binding.device === "xr")).toBe(false);
  });
});
