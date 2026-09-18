"""MMCP — Model Music Context Protocol. Render a JSON song spec to WAV + metadata."""
from .song import render, render_to_file, INSTRUMENTS, note_to_midi
from .analyze import analyze

__all__ = ["render", "render_to_file", "analyze", "INSTRUMENTS", "note_to_midi"]
