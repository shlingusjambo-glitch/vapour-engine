# Migrating to Alpha 0.2.5 "Mirage"

Mirage's compatibility rule (brief §24): every symbol reachable from
`@vapour/engine` before Mirage stays reachable, and `packages/engine/src/public-api.test.ts`
pins that surface in CI. Projects written against 0.2.0 build unchanged. This
page lists the handful of places where behaviour or an *internal* contract
moved, and what to do about each.

## No action needed

- **Gameplay modules** (`InventoryContainer`, `CraftingRegistry`, `Combatant`,
  `StatusEffectSet`, `NarrativeRunner`, …) now live in `@vapour/gameplay` and are
  re-exported from `@vapour/engine`. Importing from either works; new code should
  import from `@vapour/gameplay` directly.
- **Subsystem barrels.** The engine is organised into `src/<subsystem>/index.ts`
  internally. Keep importing from `@vapour/engine`; the internal layout is not a
  public path.
- **Additive type growth.** `UiStyle`, `UiRole`, `UiNodeDefinition`,
  `RichTextStyle`, `RichTextParseOptions`, `WelcomeMessage`, `ServerOptions`,
  `PhysicsBodyDescriptor2d/3d`, `VoxelBlockDefinition`, `VoxelMesh`, and
  `VoxelMesherOptions` gained optional fields only. Existing literals still
  type-check.

## Behaviour changes

- **Input actions may have zero bindings.** `InputSystem.defineAction` and
  `InputActions` no longer throw for an action whose binding list is empty.
  A player slot without a gamepad or headset now defines every action and reads
  zero, instead of throwing at construction. `InputActions.rebind` still refuses
  an empty list, because that is an authoring mistake rather than a routing
  outcome.
- **Rich-text wrapping** no longer emits a whitespace-only line when a word that
  is split across lines ends in a space. Measured `lineCount` can be one lower
  than before for such inputs; layouts that hard-coded the old count should
  re-measure.
- **`UiDocument.setValue` on a dropdown** now validates the option even before
  the first layout/interaction. Previously an unknown option was silently
  accepted until the dropdown was first opened.
- **`NetworkServer.receive`** accepts a `join` message from an unknown peer when
  an `authenticate` hook is configured (or admits it directly when none is).
  Servers that relied on every unknown-peer packet being dropped should set
  `authenticate` to a hook that returns `{ ok: false }`.

## Internal contracts that moved

These only affect code that implements or mocks Vapour's own boundaries.

- **`RustRenderer` (WASM bridge).** `set_render_layers` takes two extra
  arrays — `boneOffsets` and `boneMatrices` — and the interface gained
  `upload_skinned_mesh`. A custom `WasmModuleLoader` or a test double for the
  renderer must provide both; `pnpm build:wasm` regenerates the real module.
- **`set_render_layers` frame packing.** `packRenderLayers` now concatenates
  per-layer bone palettes and rebases each instance's bone offset. Callers that
  built the packed frame by hand should go through `packRenderLayers`.
- **Perf tests.** `render-scale`, `ui-scale`, `net-scale`, `physics-scale`, and
  `world-scale` assert an *average* cost against a generous budget plus a much
  looser worst-case bound. A CI job that grepped the old single tight assertion
  will not find it.

## Deprecations

Nothing is marked `@deprecated` in 0.2.5. The pre-Mirage flat import paths and
the `@vapour/engine` gameplay re-exports are kept without a removal date.
