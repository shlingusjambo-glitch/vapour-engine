---
name: amcp
description: Make 2D game art (character sprites, portraits, backgrounds, textures, icons, UI) as real anti-aliased layered PNGs. Use whenever a project needs an image asset and no image-gen model is available — do NOT hand-write pixel grids or ASCII art. Triggers: "sprite", "character art", "texture", "background", "icon", "make the art", or any game/app that needs a visual asset.
---

# AMCP — draw the asset, don't describe it

You have a layered vector/raster canvas. Use it like Procreate: shapes on layers, clipped shading, blend modes, then look at the result and fix it.

## Run
Write a JSON op list (or a Python script importing `amcp.server`) and run it with the `amcp` CLI.
AMCP lives in the folder containing this skill's `../../..` (the repo root, has `install.sh`); if `.venv` is
missing there, run `./install.sh` once. Then:
```bash
<amcp-root>/.venv/bin/amcp ops.json
```
Each op is `{"op": "<tool>", ...args}`; `"as": "doc"` saves a return value, `"$doc"` reads it. Tools and args: read `amcp/server.py` docstrings. Or, if the `amcp` MCP server is connected, call the tools directly and use `render` to see the canvas.

## One-shot rules (the tool is built for this — no trial and error)
- Call `set_goal` first, restating exactly what the user asked for (subject, style, size, palette). It is echoed back on every render/export so you cannot drift.
- Plan the entire piece with coordinates before the first draw op. Draw everything. Render once. Fix only real defects.
- Backgrounds/rooms/props: `draw_poly3d` with metre coordinates — perspective is computed for you.
- Rows of things (desks, windows, tiles, fences): `repeat=[count, dx, dy, scale_step]`.
- Pixel art: `new_document(pixel_art=True)` + paths/ellipses. Never hand-type pixel grids.
- Recreating a given image: pass it as `reference_image` to `set_goal`; render shows it side-by-side.

## Workflow
1. `new_document` at final size (sprites 256–1024px; textures 512/1024 square).
2. Block in silhouettes back-to-front, one layer per part (hair_back, body, face, eyes, hair, lineart).
3. Shade with `soft_shade` on a `multiply` layer with `clip` set to the base layer; highlights on a `screen` layer.
4. `export`, then **Read the PNG and look at it**. Fix composition/proportions. Iterate 2–3 times minimum.
5. Save into the project's asset folder; transparent background for sprites (`background: null`).

## Quality rules
- Smooth `C` bezier curves for anything organic; never polylines for faces/hair.
- Lineart thin (2–4px at 600px), slightly coloured (dark brown/purple), never pure black.
- 3-tone cel shading: base, one multiply shade, one screen highlight. Blush/gradient irises for anime style.
- Textures: fill_layer with noise via `filter_layer(noise=…)`, overlay large soft_shade blotches, keep edges seamless by keeping features away from borders or mirroring.
- Never ship a 16x16 "pixel art" result unless explicitly asked for pixel art.
