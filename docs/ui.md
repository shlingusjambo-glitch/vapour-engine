# Game UI

`UiDocument` is Vapour's retained, renderer-independent UI tree. The same
calculated rectangles drive rendering, pointer hit testing, keyboard/gamepad
focus, and future XR ray adapters, avoiding disagreement between what a player
sees and what they can activate.

Nodes have stable IDs, roles, intrinsic sizes, values, children, and layout
styles. Containers arrange children in rows or columns with fixed, content, or
fill sizing; flex growth; minimum/maximum constraints; padding; gaps; alignment;
and main-axis justification. Content sizing recursively measures visible
children, padding, and gaps. Visibility and enabled state propagate through the
tree. Duplicate IDs and invalid sizes fail while the document is constructed.

Interactive roles currently include buttons, toggles, and sliders. Pointer
down/up semantics prevent dragging off a control from activating it. `focusNext`
and `activateFocused` serve keyboard and gamepad navigation. `drainActions`
returns deterministic click/change/focus records for gameplay code.

`composeUi2D` turns document rectangles plus sprite/text visuals into material-
batched meshes. Draw those batches through `game.overlay` for screen-space UI,
or through the world frame for world-space and XR surfaces. Text fields,
dropdowns, scroll views, anchoring, accessibility metadata, and scene
serialization remain release gates before this capability moves to Working.

---

# Focus navigation (Alpha 0.2.5)

A UI that only responds to a pointer does not work on a gamepad, does not work
in VR, and does not work for anyone navigating by keyboard. Retrofitting that is
painful, because it needs to know which control is "to the left of" another —
spatial information the layout already has and that a hand-authored focus order
throws away.

So navigation is **computed from the laid-out rectangles**. Authors do not
maintain a focus graph; they lay out their UI, and moving right goes to whatever
is on the right.

```ts
import { FocusNavigator, STANDARD_ACTIONS } from "@vapour/engine";

const navigator = new FocusNavigator({ wrap: true });

// each frame
const events = navigator.update(document.layout(), {
  x: input.value(STANDARD_ACTIONS.navigateX),
  y: input.value(STANDARD_ACTIONS.navigateY),
  submit: input.pressed(STANDARD_ACTIONS.submit),
  cancel: input.pressed(STANDARD_ACTIONS.cancel),
}, deltaSeconds);

for (const event of events) {
  if (event.type === "submit" && event.id) activate(event.id);
}
```

## Why the scoring is weighted

Picking the nearest candidate in the chosen direction is the obvious rule and
behaves badly: from a wide button, "down" jumps to whichever narrow control
happens to be closest *diagonally* rather than the one directly below.

Weighting cross-axis offset three times more heavily than distance along the
direction of travel fixes it, and matches what every console UI does. There is a
test for exactly that case.

## Repeat behaviour

A held stick that moves focus every frame makes a player overshoot every time.
`FocusNavigator` steps once on push, waits `repeatDelaySeconds`, then repeats
every `repeatIntervalSeconds` — the same shape as keyboard auto-repeat.

Submit and cancel fire **on press, not while held**, or a held button activates
a control repeatedly.

## Losing focus

When the focused node disappears — a panel closes, a button disables — focus is
dropped and the next input re-enters at the top-left. A UI that becomes
unresponsive because focus is pointing at something that no longer exists is a
bug players cannot recover from without a mouse.

## API reference

| Export | Purpose |
| ------ | ------- |
| `FocusNavigator` | `update`, `setFocus`, `focused` |
| `navigate` | One directional step, given layout nodes |
| `focusableNodes` | Visible, enabled, sized nodes of a focusable role |
| `DEFAULT_FOCUSABLE_ROLES` | `button`, `toggle`, `slider` |

## XR considerations

The same navigator drives a world-space panel from a thumbstick, which is what
makes a VR menu usable without precise ray-pointing. Ray input and stick
navigation can both be live: the ray sets focus via `setFocus`, and the stick
steps from wherever the ray left it.

---

# Widgets and themes (Alpha 0.2.5)

## Widgets are state machines

Scroll views, text fields, tooltips, and drags are the widgets a game UI cannot
do without, and a layout engine alone does not provide them — because each is a
small **state machine** rather than a rectangle. A scroll view remembers where
it is scrolled; a text field remembers a caret and a selection; a drag remembers
what was picked up and from where.

Keeping that state as plain objects, separate from layout and rendering, is what
lets it be tested, serialized into a save, and driven from a pointer, a gamepad,
or an XR ray without three implementations.

## Scroll views and virtual lists

```ts
import { ScrollView, virtualRange } from "@vapour/engine";

const list = new ScrollView({ viewportHeight: 360, contentHeight: items.length * 40 });
list.scrollSteps(wheelDelta);
list.revealRange(focusedIndex * 40, 40, 8);   // keyboard navigation

const { firstIndex, lastIndex, offsetY } = virtualRange(list, 40, items.length);
```

`revealRange` scrolls the **smallest amount** that brings a range into view —
scrolling further than necessary loses the reader's place.

**Virtualization is not optional for a list of any size.** An inventory of two
thousand items laid out as two thousand nodes costs more to lay out than to
draw, every frame, no matter how few are on screen.

Overscroll is **off by default**: it is a touch idiom, and on a mouse it reads
as the view being broken.

## Text fields

```ts
const field = new TextField({ maxLength: 24, filter: (c) => /[\w ]/.test(c) });
field.insert(typed);
field.moveCaret(-1, shiftHeld);
field.deleteWord(-1);
```

**Indices count code points, not UTF-16 units.** Treating them as units puts the
caret inside an emoji and produces mojibake when the user backspaces — a bug
that never appears in English testing. `new TextField({ value: "a👍b" }).length`
is 3.

A plain arrow with an active selection collapses to its edge rather than moving
from the caret, matching every text editor.

## Tooltips

```ts
const tooltips = new TooltipController({ delaySeconds: 0.6, graceSeconds: 0.15 });
tooltips.hover(hoveredId);
tooltips.update(deltaSeconds);
```

The delay is the entire feature. A tooltip that appears instantly fires
constantly as the pointer crosses a toolbar; one with no grace period flickers
when the pointer passes over a one-pixel gap between controls. Once one is
showing, moving to a neighbouring control switches instantly.

## Drag and drop

```ts
const drag = new DragController((payload, target) => canEquip(payload.data, target));
drag.begin(slotId, item);
drag.over(hoveredSlot);
if (drag.willAccept) highlight(hoveredSlot);
const dropped = drag.drop();
```

`willAccept` is available **before** the drop, which is what a cursor change or
a highlight needs — computing it at drop time is too late to show the user
anything. Dropping onto the source slot is refused.

## Themes

```ts
import { ThemeRegistry, STANDARD_TOKENS } from "@vapour/engine";

const themes = new ThemeRegistry();
themes.register({ name: "faction-red", extends: "default", tokens: { [STANDARD_TOKENS.accent]: [1, 0, 0, 1] } });
themes.setActive(settings.get("theme"));

panel.background = themes.color(STANDARD_TOKENS.surface);
panel.padding = themes.number(STANDARD_TOKENS.spacing);
```

A theme is a named set of design tokens that widgets resolve against, rather
than each widget carrying literal values. That indirection makes light/dark, a
high-contrast accessibility mode, and a per-faction reskin the *same* mechanism
instead of three.

**Themes inherit.** A high-contrast variant is a dozen overridden tokens rather
than a full copy that silently drifts from the base as the base changes. A
high-contrast theme ships by default, because "we will add accessibility later"
reliably means never.

A missing token **throws**. A widget silently rendering with the wrong colour is
far harder to notice than a failure at startup.

## UI animation

`UiAnimator` drives renderer-independent visual state: opacity, scale, X/Y
offset, rotation, and tint. Clips are serializable data with named easing,
delay, looping, and ping-pong behavior, so a DOM menu and an XR world panel can
play the same transition. Only one clip owns a target at once; replaying that
target replaces it deterministically, and cancellation/completion events are
drained explicitly.

```ts
uiAnimator.play("inventory", {
  name: "open",
  duration: 0.18,
  tracks: [
    { property: "opacity", from: 0, to: 1, easing: "outCubic" },
    { property: "scale", from: 0.92, to: 1, easing: "outBack" },
  ],
});
uiAnimator.update(deltaSeconds);
drawPanel(uiAnimator.state("inventory"));
```

Set `reducedMotion = true` from accessibility settings to apply final states
immediately while preserving completion events and interface behavior.

## API reference

| Export | Purpose |
| ------ | ------- |
| `ScrollView` | `scrollTo`, `scrollBy`, `scrollSteps`, `scrollPage`, `revealRange`, `settle`, `resize`, `thumb` |
| `virtualRange` | The visible slice of a uniform-height list |
| `TextField` | `insert`, `deleteCharacter`, `deleteWord`, `moveCaret`, `setCaret`, `selectAll`, `selection` |
| `TooltipController` | `hover`, `update`, `hide`, `visibleTarget` |
| `DragController` | `begin`, `over`, `drop`, `cancel`, `willAccept` |
| `ThemeRegistry` | `register`, `setActive`, `resolve`, `token`, `color`, `number` |
| `defaultTheme`, `highContrastTheme`, `STANDARD_TOKENS` | The shipped themes and token names |
| `UiAnimator`, `validateUiAnimation` | Serializable transitions shared by screen and world-space UI |
