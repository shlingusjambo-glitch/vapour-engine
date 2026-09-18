"""MCP server: `python -m mmcp.server` (stdio)."""
import json
from pathlib import Path
from mcp.server.mcpserver import MCPServer
from . import song
from .analyze import analyze as _analyze

mcp = MCPServer("mmcp")
SPEC_DOC = (Path(__file__).parent / "SPEC.md").read_text()


@mcp.tool()
def spec_format() -> str:
    """Read this first. Returns the JSON song-spec format and available instruments/effects."""
    return SPEC_DOC


@mcp.tool()
def list_instruments(family: str = "") -> dict:
    """All instrument names grouped by family: 128 sampled General MIDI instruments (piano, guitar, strings,
    brass, reed, pipe, ethnic...), sampled drum kits (drums:standard|jazz|brush|electronic|tr808|orchestra...),
    synth patches (synth:*), plus drum hit names. Pass a family name to filter."""
    out = {}
    for name, fam in song.INSTRUMENTS.items():
        out.setdefault(fam, []).append(name)
    out["drum_hit_names"] = sorted(song.gm.DRUMS)
    if family:
        return {k: v for k, v in out.items() if family in k}
    return out


@mcp.tool()
def chord(symbol: str, octave: int = 4, inversion: int = 0) -> list:
    """Expand a chord symbol (Am7, Fmaj9, G/B, Csus4...) into MIDI note numbers."""
    return song.chord_to_midi(symbol, octave, inversion)


@mcp.tool()
def render_song(spec: dict, out_path: str) -> dict:
    """Render a song spec to a WAV file. Returns metadata describing how it sounds
    (key, loudness arc, brightness, rhythmic density, per-track stats) so you can iterate."""
    return song.render_to_file(spec, out_path)


@mcp.tool()
def analyze_wav(path: str, bpm: float = 120) -> dict:
    """Analyze an existing WAV (16-bit PCM) and return the same metadata as render_song."""
    import wave, numpy as np
    with wave.open(path, "rb") as w:
        sr, ch = w.getframerate(), w.getnchannels()
        pcm = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32767
    st = pcm.reshape(-1, ch).T
    if ch == 1:
        st = np.vstack([st, st])
    return _analyze(st, sr, bpm)


if __name__ == "__main__":
    mcp.run()
