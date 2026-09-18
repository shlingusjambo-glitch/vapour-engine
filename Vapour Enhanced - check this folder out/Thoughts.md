Straight answer: yes, all three were sufficient — the game exists and runs at 60 fps with 1000 creatures. But each one cost me real time on things that weren't game problems. Ranked by pain:

**Vapour engine — good core, rough edges that an AI hits hard**
1. `SpriteBatch2D` uses bottom-left texture origin; the renderer and `layoutText2D` use top-left. Sprites silently sample the wrong rows. This cost the most time because it *half-worked* (my atlas rows happened to be near the middle). Fix the engine, or document it in `2d-rendering.md`.
2. `vapour dev` builds once, no watch, and the generated service worker is cache-first. Together they mean "edit → reload → see old build" with no error. Add `--watch` and skip the SW in dev.
3. `InputSystem` samples button state per frame, so a click shorter than one frame is lost. Expose edge events or latch presses.
4. `UiDocument` holds pressed state inside the document; rebuilding it (the only way to change text/hover) drops the click. Layout should be separable from interaction state, or `composeUi2D` should take dynamic text without a rebuild.
5. Default sprite `size` derives from `rect`, so any UV inset shrinks the quad. Minor, but no doc says "always pass size".
6. What worked well: `GameRuntime`, `FrameBuilder`, particles, font import, audio buses, `GradientNoise`, `--json` CLI, TypeScript strictness catching my bugs. The `AGENTS.md` + docs were enough to build without reading engine source until things broke.

**AMCP — sufficient for pixel art, awkward for it**
- The skill says "never hand-write pixel grids" but 16px characters *are* grids; `paint_pixels` was the right tool. Update the skill for tiny sprites.
- No way to cut holes (transparent fill is a no-op); I reached into PIL. Add an `erase` op.
- No atlas packing; I wrote my own. That's the #1 thing a game needs from an art tool.
- The output looks WorldBox-adjacent, not WorldBox-good. That's on me/the model as artist more than the tool — but a "render and look" loop at 3–4x zoom per sprite would help.

**MMCP — worked first try, two bugs**
- `synth:kick/snare/hat` as an instrument crashes in `_info` (`SYNTH[payload]` KeyError). Workaround: `synth:pluck` + `drum` names.
- `effects` is a list of `{type}` but the SPEC shows a dict. Docs mismatch.
- WAV only, 14 MB for 80 s. Add an OGG/AAC export or a `sample_rate` note; I used macOS `afconvert`.
- The metadata loop ("warm, rises then falls") was genuinely useful for iterating blind.

**Environment**
- The desktop preview sandbox can't exec anything under `~/Documents` ("Operation not permitted"), so `launch.json` could only attach to a server I started from Bash.

**Was the AI able to use it?** Yes, end to end, without a human touching it. The biggest improvement isn't features — it's making failures loud. Every hour I lost was to something that rendered *slightly wrong* or served *stale* instead of throwing.