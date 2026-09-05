import { describe, expect, it } from "vitest";
import { FocusNavigator, focusableNodes, navigate, type NavigationDirection } from "./navigation.js";
import type { UiLayoutNode } from "./ui.js";

function node(id: string, x: number, y: number, width = 100, height = 40, overrides: Partial<UiLayoutNode> = {}): UiLayoutNode {
  return { id, role: "button", rect: { x, y, width, height }, depth: 0, visible: true, enabled: true, ...overrides };
}

/** A 3x3 grid of buttons, 100x40 each, spaced 120x60. */
const grid: UiLayoutNode[] = [];
for (let row = 0; row < 3; row += 1) {
  for (let column = 0; column < 3; column += 1) {
    grid.push(node(`r${row}c${column}`, column * 120, row * 60));
  }
}

describe("focusableNodes", () => {
  it("keeps visible, enabled, sized nodes of a focusable role", () => {
    const nodes = [
      node("ok", 0, 0),
      node("hidden", 0, 0, 100, 40, { visible: false }),
      node("disabled", 0, 0, 100, 40, { enabled: false }),
      node("zero", 0, 0, 0, 0),
      node("panel", 0, 0, 100, 40, { role: "panel" }),
    ];
    expect(focusableNodes(nodes).map((entry) => entry.id)).toEqual(["ok"]);
  });

  it("honours a custom role set", () => {
    const nodes = [node("panel", 0, 0, 100, 40, { role: "panel" })];
    expect(focusableNodes(nodes, { focusableRoles: ["panel"] })).toHaveLength(1);
  });
});

describe("navigate", () => {
  it("enters at the top-left when nothing is focused", () => {
    expect(navigate(grid, undefined, "down")!.id).toBe("r0c0");
  });

  it("moves one cell in each direction", () => {
    expect(navigate(grid, "r1c1", "left")!.id).toBe("r1c0");
    expect(navigate(grid, "r1c1", "right")!.id).toBe("r1c2");
    expect(navigate(grid, "r1c1", "up")!.id).toBe("r0c1");
    expect(navigate(grid, "r1c1", "down")!.id).toBe("r2c1");
  });

  it("stops at the edge", () => {
    expect(navigate(grid, "r0c0", "up")).toBeUndefined();
    expect(navigate(grid, "r0c0", "left")).toBeUndefined();
    expect(navigate(grid, "r2c2", "down")).toBeUndefined();
  });

  it("wraps when asked, keeping the cross-axis position", () => {
    const wrapped = navigate(grid, "r0c1", "up", { wrap: true });
    expect(wrapped!.id).toBe("r2c1");
    expect(navigate(grid, "r1c2", "right", { wrap: true })!.id).toBe("r1c0");
  });

  it("prefers the control directly below a wide one, not the nearest diagonal", () => {
    // The failure this guards against: from a wide button, "down" jumping to
    // whichever narrow control happens to be closest diagonally.
    const nodes = [
      node("wide", 0, 0, 400, 40),
      node("below", 150, 60, 100, 40),
      node("diagonal", 380, 50, 40, 40),
    ];
    expect(navigate(nodes, "wide", "down")!.id).toBe("below");
  });

  it("ignores candidates that are not in the requested direction", () => {
    const nodes = [node("a", 0, 0), node("left", -200, 0)];
    expect(navigate(nodes, "a", "right")).toBeUndefined();
  });

  it("skips unfocusable nodes when stepping", () => {
    const nodes = [node("a", 0, 0), node("blocked", 120, 0, 100, 40, { enabled: false }), node("c", 240, 0)];
    expect(navigate(nodes, "a", "right")!.id).toBe("c");
  });

  it("returns undefined when nothing is focusable", () => {
    expect(navigate([node("panel", 0, 0, 100, 40, { role: "panel" })], undefined, "down")).toBeUndefined();
    expect(navigate([], undefined, "down")).toBeUndefined();
  });

  it("breaks ties deterministically", () => {
    const nodes = [node("start", 0, 0), node("b", 120, 0), node("a", 120, 0)];
    expect(navigate(nodes, "start", "right")!.id).toBe("a");
  });

  it("rejects a negative cross-axis weight", () => {
    expect(() => navigate(grid, "r0c0", "right", { crossAxisWeight: -1 })).toThrow(/must not be negative/);
  });
});

describe("FocusNavigator", () => {
  const step = (navigator: FocusNavigator, x: number, y = 0, dt = 1 / 60) => navigator.update(grid, { x, y }, dt);

  it("takes one step per push, not one per frame", () => {
    const navigator = new FocusNavigator({ repeatDelaySeconds: 10 });
    step(navigator, 1);
    const first = navigator.focused;
    // Held below the repeat delay: no further movement.
    for (let frame = 0; frame < 10; frame += 1) step(navigator, 1);
    expect(navigator.focused).toBe(first);
  });

  it("repeats after the delay, then faster", () => {
    const navigator = new FocusNavigator({ repeatDelaySeconds: 0.4, repeatIntervalSeconds: 0.1 });
    navigator.setFocus("r0c0");
    step(navigator, 1);
    expect(navigator.focused).toBe("r0c1");
    // Held past the delay.
    navigator.update(grid, { x: 1 }, 0.5);
    expect(navigator.focused).toBe("r0c2");
  });

  it("ignores input below the threshold", () => {
    const navigator = new FocusNavigator({ threshold: 0.5 });
    navigator.setFocus("r0c0");
    step(navigator, 0.3);
    expect(navigator.focused).toBe("r0c0");
  });

  it("moves along the dominant axis only", () => {
    const navigator = new FocusNavigator();
    navigator.setFocus("r1c1");
    // A diagonal push must not move both ways.
    navigator.update(grid, { x: 1, y: 0.6 }, 1 / 60);
    expect(navigator.focused).toBe("r1c2");
  });

  it("emits focus events as it moves", () => {
    const navigator = new FocusNavigator();
    navigator.setFocus("r0c0");
    const events = navigator.update(grid, { x: 1 }, 1 / 60);
    expect(events).toEqual([{ type: "focus", id: "r0c1" }]);
  });

  it("fires submit and cancel on press, not while held", () => {
    const navigator = new FocusNavigator();
    navigator.setFocus("r0c0");
    expect(navigator.update(grid, { submit: true }, 1 / 60)).toEqual([{ type: "submit", id: "r0c0" }]);
    // A held button must not activate a control repeatedly.
    expect(navigator.update(grid, { submit: true }, 1 / 60)).toEqual([]);
    expect(navigator.update(grid, { submit: false }, 1 / 60)).toEqual([]);
    expect(navigator.update(grid, { submit: true }, 1 / 60)).toEqual([{ type: "submit", id: "r0c0" }]);
    expect(navigator.update(grid, { cancel: true }, 1 / 60)).toEqual([{ type: "cancel", id: "r0c0" }]);
  });

  it("re-enters when its focused node disappears", () => {
    // A panel closing or a button disabling must not leave the UI unresponsive.
    const navigator = new FocusNavigator();
    navigator.setFocus("r2c2");
    const shrunk = grid.filter((entry) => entry.id !== "r2c2");
    navigator.update(shrunk, {}, 1 / 60);
    expect(navigator.focused).toBeUndefined();
    navigator.update(shrunk, { x: 1 }, 1 / 60);
    expect(navigator.focused).toBe("r0c0");
  });

  it("stops emitting at an edge rather than repeating in place", () => {
    const navigator = new FocusNavigator();
    navigator.setFocus("r0c2");
    expect(navigator.update(grid, { x: 1 }, 1 / 60)).toEqual([]);
    expect(navigator.focused).toBe("r0c2");
  });

  it("validates its options", () => {
    expect(() => new FocusNavigator({ threshold: 0 })).toThrow(/\(0, 1\]/);
    expect(() => new FocusNavigator({ repeatDelaySeconds: -1 })).toThrow(/must not be negative/);
    expect(() => new FocusNavigator({ repeatIntervalSeconds: 0 })).toThrow(/must be positive/);
    expect(() => new FocusNavigator().update(grid, {}, -1)).toThrow(/non-negative delta/);
  });

  it("drives a menu with input actions, which is the point", () => {
    // Standing in for InputActions: navigate with an axis, activate with submit.
    const navigator = new FocusNavigator();
    const path: (string | undefined)[] = [];
    for (const [x, y] of [[0, 1], [0, 1], [1, 0]] as const) {
      navigator.update(grid, { x, y }, 1);
      path.push(navigator.focused);
    }
    expect(path).toEqual(["r0c0", "r1c0", "r1c1"]);
  });
});
