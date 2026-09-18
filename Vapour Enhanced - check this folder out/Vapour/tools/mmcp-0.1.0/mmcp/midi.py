"""Minimal SMF type-0 writer + FluidSynth offline render. No mido."""
import os
import shutil
import struct
import subprocess
import tempfile
import wave
import numpy as np

PPQ = 480
SF2_DEFAULT = os.path.join(os.path.dirname(__file__), "..", "soundfonts", "MuseScore_General.sf2")


def _vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(out))


def write_midi(path, events, tempo_map):
    """events: list of (tick, bytes). tempo_map: list of (beat, bpm)."""
    evs = [(int(b * PPQ), b"\xff\x51\x03" + struct.pack(">I", int(60e6 / bpm))[1:]) for b, bpm in tempo_map]
    evs += events
    evs.sort(key=lambda e: e[0])
    data, t = bytearray(), 0
    for tick, msg in evs:
        data += _vlq(tick - t) + msg
        t = tick
    data += b"\x00\xff\x2f\x00"
    with open(path, "wb") as f:
        f.write(b"MThd" + struct.pack(">IHHH", 6, 0, 1, PPQ))
        f.write(b"MTrk" + struct.pack(">I", len(data)) + bytes(data))


def fluidsynth_available():
    return shutil.which("fluidsynth") is not None


def render_midi(midi_path, sf2, sr, reverb=0.4, chorus=0.0):
    """Render a MIDI file through FluidSynth. Returns stereo float32 (2, n)."""
    if not fluidsynth_available():
        raise RuntimeError("fluidsynth not found: brew install fluid-synth")
    if not os.path.exists(sf2):
        raise RuntimeError(f"soundfont not found: {sf2}")
    out = tempfile.mktemp(suffix=".wav")
    cmd = ["fluidsynth", "-ni", "-q", "-F", out, "-r", str(sr), "-g", "0.6",
           "-o", f"synth.reverb.level={reverb}", "-o", f"synth.reverb.room-size=0.6",
           "-o", f"synth.chorus.level={chorus}", "-o", "synth.polyphony=512",
           sf2, midi_path]
    subprocess.run(cmd, check=True, capture_output=True)
    with wave.open(out, "rb") as w:
        pcm = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32767
        st = pcm.reshape(-1, w.getnchannels()).T
    os.remove(out)
    return st
