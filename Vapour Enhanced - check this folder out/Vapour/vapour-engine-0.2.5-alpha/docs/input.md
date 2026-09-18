# Input

Vapour resolves physical controls into named actions. Gameplay asks for
`MoveForward`, `Jump`, or `Fire`; it does not inspect keyboard keys or gamepad
indices. `InputSystem` combines keyboard, pointer, gamepad, touch/virtual, replay,
and accessibility inputs at the beginning of a frame.

```ts
const input = new InputSystem([
  {
    name: "MoveForward",
    kind: "button",
    bindings: [
      { device: "keyboard", code: "KeyW" },
      { device: "gamepad", gamepad: 0, control: "axis", index: 1, scale: -1 },
    ],
  },
  { name: "LookX", kind: "delta", bindings: [{ device: "pointer", axis: "x" }] },
  { name: "Zoom", kind: "delta", bindings: [{ device: "pointer", axis: "wheelY", scale: 0.01 }] },
]);
input.attach(window);

// Once, before simulation updates:
input.update(Array.from(navigator.getGamepads()));
if (input.action("MoveForward").pressed) move();
```

Action kinds are:

- `button`: resolves to zero or one and reports pressed/released edges.
- `axis`: combines bindings and clamps to `[-1, 1]`.
- `delta`: preserves unbounded relative motion for camera and gesture input.

## Rebinding and virtual controls

`setBindings` replaces an action's bindings live without reinstalling browser
listeners. `bindings` returns a defensive copy suitable for settings UI and
serialization. Games should store action maps, not engine-internal device state.

Touch sticks and buttons call `setVirtualAction`. Touch-look surfaces, replays,
and remote local-player devices can call `addPointerDelta`. Virtual and physical
values pass through the same action resolver, so gameplay has one input path.
Wheel bindings use `wheelX` and `wheelY`; `addWheelDelta` provides the same
frame-scoped deterministic injection seam for tests and virtual devices.

## Pointer lock

`PointerLockController` owns browser pointer-lock state, listener cleanup, and
the progressive fallback from raw/unadjusted motion. The game still decides
whether a menu permits capture. On lock loss, call `resetDeviceState` so a mouse
button released outside the page cannot remain stuck.

CubeGame now consumes these APIs for keyboard, pointer, gamepad, mobile virtual
controls, live rebinding, and pointer lock. Its compatibility `InputManager`
retains only game-specific shortcut events and its existing mobile HTML wiring.

---

# Action maps, contexts, and rebinding (Alpha 0.2.5)

`InputSystem` resolves named actions from device bindings, which is the
important half: gameplay asks for `Jump`, not for `KeyC`. `InputActions` adds
the structure a real game needs on top, all of which games otherwise rewrite
badly.

## Action maps

Maps group actions by situation. "Gameplay", "Menu", and "Vehicle" are different
sets, and the same physical key means different things in each.

```ts
import { InputActions, defaultGameplayMap, STANDARD_ACTIONS } from "@vapour/engine";

const input = new InputActions([defaultGameplayMap(), menuMap]);
input.system.attach(window);

// once per frame, early
input.update();

if (input.justPressed(STANDARD_ACTIONS.jump)) player.jump();
const move = input.vector(STANDARD_ACTIONS.move);
```

Action names must be unique **across** maps, so a name always identifies one
thing. `defaultGameplayMap()` provides the usual verbs bound to both keyboard
and gamepad, because the first hour of every project is otherwise spent
retyping it.

## Contexts

```ts
input.pushContext(["menu"]);   // gameplay input suspends
// ...
input.popContext();            // and resumes
```

Only maps named by the topmost context resolve. Opening a menu therefore
suspends gameplay input without every gameplay system checking `isPaused` —
actions in suspended maps report zero and `false`, not stale values.

## Composites

A composite turns component actions into one vector, so `Move` is a direction
whether it came from WASD, a stick, or a touch pad:

```ts
composites: [{ name: "Move", kind: "vector2", positiveX: "MoveX", positiveY: "MoveY" }]
```

The negative halves are optional: an already-signed axis supplies both
directions, while four discrete buttons name all four.

**Diagonals are normalized by default.** Moving faster diagonally than straight
is a bug players notice immediately and developers rarely think to prevent.

Dead zones **rescale from their edge**, so a stick's usable range still spans
zero to one rather than jumping to the dead-zone value the moment it engages.

## Rebinding

```ts
input.rebind("Jump", [{ device: "keyboard", code: "KeyJ" }]);

saveSettings({ bindings: input.overrides() });         // only what changed
input.applyOverrides(loadSettings().bindings);          // returns skipped names
```

`overrides()` serializes **only bindings that differ from their defaults**. That
matters across versions: a later build changing a default binding still reaches
players who never remapped that action. `applyOverrides` returns the names it
skipped rather than throwing, so a save from an older build loads cleanly.

## Local multiplayer

```ts
const players = new PlayerInput([defaultGameplayMap()]);
players.addPlayer({ id: 0, keyboard: true, gamepad: 0 });
players.addPlayer({ id: 1, keyboard: false, gamepad: 1 });

players.update();
const move = players.get(1).vector("Move");
```

Each player gets its own `InputActions` built from the same maps, with gamepad
bindings rewritten to that player's pad and unavailable devices filtered out.
Local multiplayer becomes a routing question rather than a parallel input stack.

## Device prompts

`input.lastDevice` reports which device most recently produced input, so UI can
show the matching button prompts without the game tracking it separately.

## API reference

| Export | Purpose |
| ------ | ------- |
| `InputActions` | `addMap`, `setMapEnabled`, `pushContext`, `popContext`, `update`, `value`, `look`, `pressed`, `justPressed`, `justReleased`, `vector`, `rebind`, `resetBindings`, `overrides`, `applyOverrides`, `lastDevice`, `stats` |
| `PlayerInput` | `addPlayer`, `get`, `removePlayer`, `update`, `playerIds` |
| `defaultGameplayMap` | The standard map, keyboard and gamepad |
| `STANDARD_ACTIONS` | Shared action-name constants |
| Types | `ActionMapDefinition`, `CompositeVector2`, `BindingOverrides`, `PlayerSlotOptions` |

## Performance considerations

`update()` resolves every action once per frame; querying an action afterwards
is a map lookup. Call `update()` once, early, and read as often as you like.

Contexts are checked per query, so a deep context stack costs a small array scan
per action read — keep stacks shallow (menu over gameplay, not twenty layers).

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import InputActions

var fire = { name: "Fire", kind: "button", bindings: [{ device: "keyboard", code: "Space" }, { device: "xr", hand: "right", control: "button", index: 0 }] }
var actions = new InputActions([{ name: "gameplay", actions: [fire] }])

export func update(gamepads, xr_inputs):
    actions.update(gamepads, xr_inputs)
    if actions.justPressed("Fire"):
        return actions.lastDevice
    return None
```
