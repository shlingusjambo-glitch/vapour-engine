# MMCP — Model Music Context Protocol

Prompt Claude / ChatGPT / Gemini for "a tense boss theme" or "a lo-fi piano ballad" and get a real WAV back — no Web Audio API blips.
The model writes a small JSON song spec; MMCP renders it offline through **real sampled instruments**
(128 General MIDI instruments + drum kits via FluidSynth and a 215 MB SoundFont), optional retro synth patches,
or any folder of your own WAV samples — and returns **metadata describing how it sounds** (key, brightness,
dynamics, loudness arc, rhythmic density, per-track stats) so the model can iterate without ears.

Models get: chord symbols (`Am7`, `G/B`), sustain pedal, humanized timing/velocity, tempo maps, per-track
reverb/chorus/pan, named drum hits, step patterns, and any `.sf2` they want to swap in.

Three ways in, one engine:

| Use | How |
|---|---|
| MCP server (Claude Desktop, Cursor, etc.) | `python -m mmcp serve` |
| Agentic / in-code (a game that needs a jingle) | `import mmcp; mmcp.render_to_file(spec, "out.wav")` |
| CLI | `python -m mmcp render spec.json out.wav` |

## Setup
```bash
brew install fluid-synth
python3.11 -m venv .venv && .venv/bin/pip install -e .
mkdir -p soundfonts && curl -L -o soundfonts/MuseScore_General.sf2 https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2
```
(Any GM-compatible `.sf2` works — set `"soundfont": "/path.sf2"` in the spec to use a different one.)

Claude Desktop `claude_desktop_config.json`:
```json
{"mcpServers": {"mmcp": {"command": "/ABS/PATH/MMCP/.venv/bin/python", "args": ["-m", "mmcp", "serve"]}}}
```
Then: *"Use mmcp to write me a 30-second heroic chiptune loop at 160 bpm."* The model calls `spec_format`, writes a spec, calls `render_song`, reads the metadata, adjusts.

## Tools
- `spec_format()` — the JSON format + instruments (see [mmcp/SPEC.md](mmcp/SPEC.md))
- `list_instruments(family="")` — 128 GM instruments by family, drum kits, synth patches, drum hit names
- `chord(symbol, octave, inversion)` — expand `Fmaj9` to MIDI notes
- `render_song(spec, out_path)` → WAV + metadata
- `analyze_wav(path, bpm)` → same metadata for any 16-bit WAV

## Demo
`.venv/bin/python examples/finale_style.py` — an original 62-second track in the style of Undertale's *Finale*
(A minor, 160 bpm): picked bass + cello, bright piano arpeggios, string ensemble, choir, brass-section lead
doubled by trumpet, french horns, power kit with tom fills, timpani. Renders in ~1 s. Metadata reports
`loudness_arc: builds toward the end`, `brightness: warm / acoustic`, `rhythmic_density: busy`.

## Test
```bash
.venv/bin/python test_mmcp.py
```
