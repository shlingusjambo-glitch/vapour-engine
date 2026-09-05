import { describe, expect, it } from "vitest";
import { InputSystem } from "./input.js";

describe("InputSystem", () => {
  it("combines bindings and exposes edge transitions", () => {
    const input = new InputSystem([
      {
        name: "MoveX",
        kind: "axis",
        bindings: [
          { device: "keyboard", code: "KeyA", scale: -1 },
          { device: "keyboard", code: "KeyD" },
        ],
      },
    ]);
    input.setKey("KeyD", true);
    input.update();
    expect(input.action("MoveX")).toEqual({ value: 1, pressed: true, justPressed: true, justReleased: false });
    input.update();
    expect(input.action("MoveX").justPressed).toBe(false);
    input.setKey("KeyD", false);
    input.update();
    expect(input.action("MoveX").justReleased).toBe(true);
  });

  it("resolves pointer buttons as ordinary action bindings", () => {
    const input = new InputSystem([
      { name: "Break", kind: "button", bindings: [{ device: "pointer", button: 0 }] },
      { name: "Place", kind: "button", bindings: [{ device: "pointer", button: 2 }] },
    ]);
    input.setPointerButton(0, true);
    input.update();
    expect(input.action("Break")).toMatchObject({ pressed: true, justPressed: true });
    expect(input.action("Place").pressed).toBe(false);
    input.update();
    expect(input.action("Break").justPressed).toBe(false);
    input.setPointerButton(0, false);
    input.update();
    expect(input.action("Break").justReleased).toBe(true);
  });

  it("rejects duplicate actions", () => {
    expect(
      () =>
        new InputSystem([
          { name: "Jump", kind: "button", bindings: [{ device: "keyboard", code: "Space" }] },
          { name: "Jump", kind: "button", bindings: [{ device: "keyboard", code: "KeyJ" }] },
        ]),
    ).toThrow("Duplicate input action");
  });

  it("supports live rebinding without losing action transition state", () => {
    const input = new InputSystem([
      { name: "Jump", kind: "button", bindings: [{ device: "keyboard", code: "Space" }] },
    ]);
    input.setBindings("Jump", [{ device: "keyboard", code: "KeyJ" }]);
    input.setKey("Space", true);
    input.update();
    expect(input.action("Jump").pressed).toBe(false);
    input.setKey("KeyJ", true);
    input.update();
    expect(input.action("Jump")).toMatchObject({ pressed: true, justPressed: true });
    expect(input.bindings("Jump")).toEqual([{ device: "keyboard", code: "KeyJ" }]);
  });

  it("combines virtual controls with physical bindings", () => {
    const input = new InputSystem([
      { name: "MoveX", kind: "axis", bindings: [{ device: "keyboard", code: "KeyA", scale: -1 }] },
    ]);
    input.setVirtualAction("MoveX", 0.75);
    input.update();
    expect(input.action("MoveX").value).toBe(0.75);
    input.setKey("KeyA", true);
    input.update();
    expect(input.action("MoveX").value).toBe(-0.25);
  });

  it("preserves unbounded pointer deltas for camera input", () => {
    const input = new InputSystem([
      { name: "LookX", kind: "delta", bindings: [{ device: "pointer", axis: "x" }] },
    ]);
    input.addPointerDelta(19, 0);
    input.update();
    expect(input.action("LookX").value).toBe(19);
    input.update();
    expect(input.action("LookX").value).toBe(0);
  });

  it("exposes mouse-wheel movement as frame-scoped action deltas", () => {
    const input = new InputSystem([
      { name: "Zoom", kind: "delta", bindings: [{ device: "pointer", axis: "wheelY", scale: -0.01 }] },
    ]);
    input.addWheelDelta(4, 120);
    input.update();
    expect(input.action("Zoom").value).toBe(-1.2);
    input.update();
    expect(input.action("Zoom").value).toBe(0);
    expect(() => input.addWheelDelta(Number.NaN, 0)).toThrow(/finite/);
  });

  it("tracks absolute pointer position for engine-native UI hit testing", () => {
    const input = new InputSystem([]);
    input.setPointerPosition(120, 45);
    expect(input.pointerPosition).toEqual({ x: 120, y: 45 });
    expect(() => input.setPointerPosition(Number.NaN, 0)).toThrow(/finite/);
  });
});
