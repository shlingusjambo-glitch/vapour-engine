# AMCP — Art Model Context Protocol

A layered 2D canvas LLMs can actually paint on: anti-aliased SVG paths, gradients, clipping masks, soft airbrush shading, multiply/screen/overlay layers, PNG export. Think "Procreate as a tool call".

Runs two ways:
- **MCP server** (`python -m amcp serve`) — tools + a `render` tool so the model sees its work and iterates.
- **Agentic CLI** (`python -m amcp ops.json`) — any coding agent writes a JSON op list and runs it; `.claude/skills/amcp/SKILL.md` teaches Claude Code to do this on its own when a project needs art.

## Setup (any location, Python 3.10+)
```bash
./install.sh                     # creates .venv, installs, runs self-check, prints the MCP config line
.venv/bin/amcp examples/character.json   # -> examples/character.png
PYTHONPATH=. .venv/bin/python examples/classroom.py
```
`install.sh` prints a ready `claude mcp add ...` command. For agentic use without MCP, copy
`.claude/skills/amcp/` into a project's `.claude/skills/` (or `~/.claude/skills/`) — Claude Code will then
make art on its own whenever a project needs an asset.

## One-shot design
`set_goal` pins the target and echoes it on every render; `draw_poly3d` gives correct perspective from metre
coordinates; `pixel_art=True` makes every op crisp; `repeat` stamps rows. See `.claude/skills/amcp/SKILL.md`.

## Tools
`new_document`, `add_layer`, `set_layer`, `list_layers`, `draw_path` (SVG M/L/C/Q/Z, fill/stroke/gradient/clip), `draw_ellipse`, `soft_shade` (airbrush, clipped), `fill_layer`, `filter_layer` (blur/noise), `render` (image back to the model), `export`.

Example output: `examples/character.png`.
