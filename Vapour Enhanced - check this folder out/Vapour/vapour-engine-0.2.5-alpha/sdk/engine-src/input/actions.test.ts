import { describe, expect, it } from "vitest";
import { InputActions, PlayerInput, STANDARD_ACTIONS, defaultGameplayMap, type ActionMapDefinition } from "./actions.js";

const gameplay: ActionMapDefinition = {
  name: "gameplay",
  actions: [
    { name: "MoveX", kind: "axis", bindings: [{ device: "keyboard", code: "KeyD" }, { device: "keyboard", code: "KeyA", scale: -1 }] },
    { name: "MoveY", kind: "axis", bindings: [{ device: "keyboard", code: "KeyW" }, { device: "keyboard", code: "KeyS", scale: -1 }] },
    { name: "Jump", kind: "button", bindings: [{ device: "keyboard", code: "Space" }] },
  ],
  composites: [{ name: "Move", kind: "vector2", positiveX: "MoveX", positiveY: "MoveY" }],
};

const menu: ActionMapDefinition = {
  name: "menu",
  actions: [
    { name: "Submit", kind: "button", bindings: [{ device: "keyboard", code: "Enter" }] },
    { name: "Cancel", kind: "button", bindings: [{ device: "keyboard", code: "Escape" }] },
  ],
};

/** Presses keys, resolves a frame, and returns the actions. */
function press(actions: InputActions, ...codes: string[]): InputActions {
  for (const code of codes) actions.system.setKey(code, true);
  actions.update();
  return actions;
}

describe("action maps", () => {
  it("resolves actions from a map", () => {
    const actions = new InputActions([gameplay]);
    press(actions, "Space");
    expect(actions.pressed("Jump")).toBe(true);
    expect(actions.justPressed("Jump")).toBe(true);
    actions.update();
    expect(actions.justPressed("Jump")).toBe(false);
  });

  it("rejects duplicate maps and duplicate action names across maps", () => {
    const actions = new InputActions([gameplay]);
    expect(() => actions.addMap(gameplay)).toThrow(/already registered/);
    expect(() => actions.addMap({ name: "other", actions: gameplay.actions }))
      .toThrow(/defined in both "gameplay" and "other"/);
    expect(() => actions.addMap({ name: " ", actions: [] })).toThrow(/non-empty name/);
  });

  it("rejects a composite naming an action nothing defines", () => {
    expect(() =>
      new InputActions([{ name: "m", actions: [], composites: [{ name: "Move", kind: "vector2", positiveX: "Ghost", positiveY: "Ghost" }] }]),
    ).toThrow(/references action "Ghost"/);
  });

  it("reports unknown actions and maps by name", () => {
    const actions = new InputActions([gameplay]);
    expect(() => actions.value("Ghost")).toThrow(/No action named "Ghost"/);
    expect(() => actions.setMapEnabled("ghost", true)).toThrow(/No action map named "ghost".*Maps: gameplay/s);
    expect(() => actions.vector("Ghost")).toThrow(/No composite named "Ghost".*Composites: Move/s);
  });

  it("returns zero from a disabled map rather than stale values", () => {
    const actions = new InputActions([gameplay]);
    press(actions, "Space");
    expect(actions.pressed("Jump")).toBe(true);
    actions.setMapEnabled("gameplay", false);
    expect(actions.pressed("Jump")).toBe(false);
    expect(actions.value("MoveX")).toBe(0);
  });
});

describe("contexts", () => {
  it("suspends gameplay input while a menu context is on top", () => {
    const actions = new InputActions([gameplay, menu]);
    press(actions, "Space", "Enter");
    expect(actions.pressed("Jump")).toBe(true);
    expect(actions.pressed("Submit")).toBe(true);

    // Opening a menu should not require every gameplay system to check a flag.
    actions.pushContext(["menu"]);
    expect(actions.pressed("Jump")).toBe(false);
    expect(actions.pressed("Submit")).toBe(true);

    actions.popContext();
    expect(actions.pressed("Jump")).toBe(true);
  });

  it("nests and unwinds contexts", () => {
    const actions = new InputActions([gameplay, menu]);
    actions.pushContext(["gameplay"]);
    actions.pushContext(["menu"]);
    expect(actions.contextDepth).toBe(2);
    expect(actions.isMapEnabled("gameplay")).toBe(false);
    expect(actions.popContext()).toEqual(["menu"]);
    expect(actions.isMapEnabled("gameplay")).toBe(true);
    actions.clearContexts();
    expect(actions.contextDepth).toBe(0);
  });

  it("rejects a context naming an unknown map", () => {
    const actions = new InputActions([gameplay]);
    expect(() => actions.pushContext(["ghost"])).toThrow(/unknown action map "ghost"/);
  });
});

describe("composites", () => {
  it("combines signed axes into a vector", () => {
    const actions = new InputActions([gameplay], { deadZone: 0 });
    press(actions, "KeyD");
    expect(actions.vector("Move")).toEqual({ x: 1, y: 0 });
    actions.system.setKey("KeyD", false);
    press(actions, "KeyW");
    expect(actions.vector("Move")).toEqual({ x: 0, y: 1 });
  });

  it("normalizes diagonals, so moving diagonally is not faster", () => {
    const actions = new InputActions([gameplay], { deadZone: 0 });
    press(actions, "KeyD", "KeyW");
    const move = actions.vector("Move");
    expect(Math.hypot(move.x, move.y)).toBeCloseTo(1, 6);
    expect(move.x).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("keeps raw magnitude when normalization is off", () => {
    const actions = new InputActions(
      [{ ...gameplay, composites: [{ name: "Move", kind: "vector2", positiveX: "MoveX", positiveY: "MoveY", normalize: false, deadZone: 0 }] }],
      { deadZone: 0 },
    );
    press(actions, "KeyD", "KeyW");
    // Clamped to unit length but not renormalized to it.
    expect(Math.hypot(actions.vector("Move").x, actions.vector("Move").y)).toBeCloseTo(1, 6);
  });

  it("applies a dead zone and rescales from its edge", () => {
    const actions = new InputActions(
      // Bound to a gamepad axis that reports nothing here, so the virtual value
      // is what the composite sees — the same path a real stick takes.
      [{ name: "m",
         actions: [
           { name: "StickX", kind: "axis", bindings: [{ device: "gamepad", gamepad: 0, control: "axis", index: 0 }] },
           { name: "StickY", kind: "axis", bindings: [{ device: "gamepad", gamepad: 0, control: "axis", index: 1 }] },
         ],
         composites: [{ name: "Look", kind: "vector2", positiveX: "StickX", positiveY: "StickY", deadZone: 0.5 }] }],
    );
    actions.system.setVirtualAction("StickX", 0.4);
    actions.update();
    expect(actions.vector("Look")).toEqual({ x: 0, y: 0 });

    actions.system.setVirtualAction("StickX", 1);
    actions.update();
    // At full deflection the result reaches one, not the dead-zone remainder.
    expect(actions.vector("Look").x).toBeCloseTo(1, 6);

    actions.system.setVirtualAction("StickX", 0.75);
    actions.update();
    expect(actions.vector("Look").x).toBeCloseTo(0.5, 6);
  });

  it("rejects an invalid dead zone or sensitivity", () => {
    expect(() => new InputActions([], { deadZone: 1 })).toThrow(/\[0, 1\)/);
    expect(() => new InputActions([], { lookSensitivity: 0 })).toThrow(/must be positive/);
  });
});

describe("look sensitivity", () => {
  it("scales delta actions", () => {
    const actions = new InputActions(
      [{ name: "look", actions: [{ name: "LookX", kind: "delta", bindings: [{ device: "pointer", axis: "x" }] }] }],
      { lookSensitivity: 2.5 },
    );
    actions.system.addPointerDelta(10, 0);
    actions.update();
    expect(actions.look("LookX")).toBeCloseTo(actions.value("LookX") * 2.5, 6);
  });
});

describe("rebinding", () => {
  it("replaces a binding and reports it as an override", () => {
    const actions = new InputActions([gameplay]);
    expect(actions.overrides()).toEqual({});

    actions.rebind("Jump", [{ device: "keyboard", code: "KeyJ" }]);
    press(actions, "KeyJ");
    expect(actions.pressed("Jump")).toBe(true);
    expect(Object.keys(actions.overrides())).toEqual(["Jump"]);
  });

  it("restores defaults", () => {
    const actions = new InputActions([gameplay]);
    actions.rebind("Jump", [{ device: "keyboard", code: "KeyJ" }]);
    actions.resetBindings("Jump");
    expect(actions.overrides()).toEqual({});
    press(actions, "Space");
    expect(actions.pressed("Jump")).toBe(true);
  });

  it("resets everything at once", () => {
    const actions = new InputActions([gameplay]);
    actions.rebind("Jump", [{ device: "keyboard", code: "KeyJ" }]);
    actions.rebind("MoveX", [{ device: "keyboard", code: "KeyL" }]);
    actions.resetBindings();
    expect(actions.overrides()).toEqual({});
  });

  it("round-trips overrides through serialization", () => {
    const first = new InputActions([gameplay]);
    first.rebind("Jump", [{ device: "keyboard", code: "KeyJ" }]);
    const saved = JSON.parse(JSON.stringify(first.overrides()));

    const second = new InputActions([gameplay]);
    expect(second.applyOverrides(saved)).toEqual([]);
    press(second, "KeyJ");
    expect(second.pressed("Jump")).toBe(true);
  });

  it("ignores overrides for actions this build no longer has", () => {
    // Only overrides are serialized, so a later build changing a default still
    // reaches players who never remapped that action.
    const actions = new InputActions([gameplay]);
    expect(actions.applyOverrides({ Removed: [{ device: "keyboard", code: "KeyX" }] })).toEqual(["Removed"]);
    expect(actions.applyOverrides({ Jump: [] })).toEqual(["Jump"]);
  });

  it("rejects rebinding an unknown action or to nothing", () => {
    const actions = new InputActions([gameplay]);
    expect(() => actions.rebind("Ghost", [{ device: "keyboard", code: "KeyX" }])).toThrow(/unknown action "Ghost"/);
    expect(() => actions.rebind("Jump", [])).toThrow(/would make it unusable/);
    expect(() => actions.resetBindings("Ghost")).toThrow(/unknown action "Ghost"/);
  });
});

describe("device tracking and stats", () => {
  it("notes which device last produced input", () => {
    const actions = new InputActions([gameplay]);
    expect(actions.lastDevice).toBeUndefined();
    press(actions, "Space");
    expect(actions.lastDevice).toBe("keyboard");
  });

  it("reports map and action counts", () => {
    const actions = new InputActions([gameplay, menu]);
    expect(actions.stats()).toMatchObject({ maps: 2, enabledMaps: 2, actions: 5, contextDepth: 0 });
    actions.pushContext(["menu"]);
    expect(actions.stats().enabledMaps).toBe(1);
  });
});

describe("defaultGameplayMap", () => {
  it("provides the usual verbs bound to keyboard and gamepad", () => {
    const actions = new InputActions([defaultGameplayMap()]);
    press(actions, "KeyW", "Space");
    expect(actions.pressed(STANDARD_ACTIONS.jump)).toBe(true);
    expect(actions.vector(STANDARD_ACTIONS.move).y).toBeCloseTo(1, 6);
    expect(actions.maps).toEqual(["gameplay"]);
  });
});

describe("PlayerInput", () => {
  const maps = [
    {
      name: "gameplay",
      actions: [
        { name: "Jump", kind: "button" as const, bindings: [
          { device: "keyboard" as const, code: "Space" },
          { device: "gamepad" as const, gamepad: 0, control: "button" as const, index: 0 },
        ] },
      ],
    },
  ];

  it("gives each player its own actions", () => {
    const players = new PlayerInput(maps);
    const one = players.addPlayer({ id: 0, keyboard: true, gamepad: 0 });
    const two = players.addPlayer({ id: 1, keyboard: false, gamepad: 1 });
    expect(players.playerIds).toEqual([0, 1]);
    expect(players.get(0)).toBe(one);

    one.system.setKey("Space", true);
    players.update();
    // Player one uses the keyboard; player two does not.
    expect(one.pressed("Jump")).toBe(true);
    expect(two.pressed("Jump")).toBe(false);
  });

  it("rewrites gamepad bindings to each player's pad", () => {
    const players = new PlayerInput(maps);
    players.addPlayer({ id: 0, gamepad: 0 });
    const two = players.addPlayer({ id: 1, keyboard: false, gamepad: 3 });
    const binding = two.system.bindings("Jump").find((entry) => entry.device === "gamepad");
    expect(binding).toMatchObject({ gamepad: 3 });
    // The keyboard binding was dropped for this player.
    expect(two.system.bindings("Jump").some((entry) => entry.device === "keyboard")).toBe(false);
  });

  it("adds, finds, and removes players", () => {
    const players = new PlayerInput(maps);
    players.addPlayer({ id: 0 });
    expect(() => players.addPlayer({ id: 0 })).toThrow(/already registered/);
    expect(() => players.addPlayer({ id: -1 })).toThrow(/non-negative whole number/);
    expect(() => players.get(9)).toThrow(/No player 9.*Players: 0/s);
    expect(players.removePlayer(0)).toBe(true);
    expect(players.removePlayer(0)).toBe(false);
  });
});
