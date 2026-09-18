"""Smallest check that fails if the engine breaks: .venv/bin/python test_mmcp.py"""
import os, tempfile, mmcp
from mmcp.song import chord_to_midi

assert mmcp.note_to_midi("A4") == 69 and mmcp.note_to_midi("Bb2") == 46 and mmcp.note_to_midi("C#-1") == 1
assert chord_to_midi("Am7", 3) == [57, 60, 64, 67] and chord_to_midi("C/E", 4) == [52, 60, 64, 67]
assert chord_to_midi("C", 4, 1) == [64, 67, 72]

spec = {"bpm": 120, "tracks": [
    {"instrument": "acoustic_grand_piano", "notes": [{"start": i, "dur": 1, "pitch": p} for i, p in enumerate(["C4", "E4", "G4", "C5"])]},
    {"instrument": "fingered_bass", "notes": [{"start": 0, "dur": 4, "pitch": "C2"}]},
    {"instrument": "drums:standard", "patterns": {"kick": "x...x...", "snare": "..x...x."}, "step": 0.5, "bars": 1},
    {"instrument": "synth:lead_square", "volume": 0.3, "notes": [{"start": 0, "dur": 4, "chord": "C", "octave": 5}]},
]}
with tempfile.TemporaryDirectory() as d:
    m = mmcp.render_to_file(spec, os.path.join(d, "t.wav"))
assert m["estimated_key"] == "C major", m["estimated_key"]
assert 3.9 < m["duration_sec"] < 7 and m["peak_dbfs"] < 0
assert m["tracks"][0]["pitch_range"] == [60, 72] and m["tracks"][2]["drums_used"] == ["kick", "snare"]
print("ok", m["estimated_key"], m["brightness"], m["rhythmic_density"])
