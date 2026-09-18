# MMCP — instructions for an AI agent

You can compose real music with this folder. Do this:

1. Run `./install.sh` once (creates `.venv`, installs FluidSynth if needed, verifies with a test render).
2. Read `mmcp/SPEC.md` — the JSON song format. Or run `.venv/bin/mmcp spec`.
3. Write a spec to a file and render: `.venv/bin/mmcp render song.json song.wav`
   The command prints JSON metadata (key, brightness, dynamics, loudness arc per bar, per-track stats).
   Read it, adjust the spec, render again. That loop is how you "hear" your work.
4. From Python: `import mmcp; meta = mmcp.render_to_file(spec_dict, "out.wav")`
5. As an MCP server for a chat client: command `<this folder>/.venv/bin/python`, args `["-m", "mmcp", "serve"]`.

Instrument names: `.venv/bin/python -c "import mmcp,json;print(json.dumps(mmcp.INSTRUMENTS,indent=1))"`
Worked example of a full arrangement: `examples/finale_style.py` (run it to get a 62 s orchestral-rock track).
