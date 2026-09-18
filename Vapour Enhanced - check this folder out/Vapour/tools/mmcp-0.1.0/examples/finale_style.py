"""Original composition in the style of Undertale's 'Finale': fast, heroic, driving bass,
relentless arpeggios, soaring lead. Run: .venv/bin/python examples/finale_style.py"""
import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import mmcp

BPM = 160
# 8-bar chord loop (roots), classic "heroic" progression: i - VI - III - VII with a lift at the end
PROG = ["A2", "F2", "C3", "G2", "A2", "F2", "C3", "E3"]
CHORDS = {"A2": ["A3", "C4", "E4"], "F2": ["F3", "A3", "C4"], "C3": ["C4", "E4", "G4"],
          "G2": ["G3", "B3", "D4"], "E3": ["E4", "G#4", "B4"]}

def bass(bars):
    out = []
    for b in range(bars):
        root = PROG[b % 8]
        for i in range(8):  # driving 8ths, octave pop on beats 2 and 4 upbeat
            up = i in (3, 7)
            p = mmcp.note_to_midi(root) + (12 if up else 0)
            out.append({"start": b * 4 + i * 0.5, "dur": 0.45, "pitch": p, "vel": 1.0 if i % 2 == 0 else 0.8})
    return out

def arp(bars, offset=0):
    out = []
    for b in range(bars):
        ch = CHORDS[PROG[b % 8]]
        seq = [ch[0], ch[1], ch[2], ch[1] + "", ch[2], ch[0], ch[1], ch[2]]
        for i, p in enumerate(seq):
            m = mmcp.note_to_midi(p) + 12 + offset
            out.append({"start": b * 4 + i * 0.5, "dur": 0.4, "pitch": m, "vel": 0.7})
    return out

# lead melody: 8 bars, written as (beat, dur, pitch), triumphant leaps + fast runs
LEAD_A = [
    (0, 1.5, "E5"), (1.5, 0.5, "D5"), (2, 1, "C5"), (3, 1, "D5"),
    (4, 2, "E5"), (6, 0.5, "E5"), (6.5, 0.5, "F5"), (7, 1, "G5"),
    (8, 1.5, "A5"), (9.5, 0.5, "G5"), (10, 1, "E5"), (11, 1, "C5"),
    (12, 3, "D5"), (15, 0.5, "C5"), (15.5, 0.5, "B4"),
    (16, 1.5, "C5"), (17.5, 0.5, "D5"), (18, 1, "E5"), (19, 1, "G5"),
    (20, 2, "A5"), (22, 0.5, "G5"), (22.5, 0.5, "A5"), (23, 1, "B5"),
    (24, 1, "C6"), (25, 0.5, "B5"), (25.5, 0.5, "A5"), (26, 1, "G5"), (27, 1, "E5"),
    (28, 0.5, "F5"), (28.5, 0.5, "E5"), (29, 0.5, "D5"), (29.5, 0.5, "C5"), (30, 2, "B4"),
]
LEAD_B = [  # higher, more frantic variation
    (0, 0.5, "A5"), (0.5, 0.5, "B5"), (1, 0.5, "C6"), (1.5, 0.5, "B5"), (2, 1, "A5"), (3, 1, "E5"),
    (4, 0.5, "F5"), (4.5, 0.5, "G5"), (5, 0.5, "A5"), (5.5, 0.5, "G5"), (6, 2, "F5"),
    (8, 0.5, "G5"), (8.5, 0.5, "A5"), (9, 0.5, "B5"), (9.5, 0.5, "C6"), (10, 1, "D6"), (11, 1, "C6"),
    (12, 2, "B5"), (14, 0.5, "A5"), (14.5, 0.5, "G5"), (15, 1, "A5"),
    (16, 1, "C6"), (17, 1, "A5"), (18, 1, "E5"), (19, 1, "A5"),
    (20, 1, "C6"), (21, 1, "A5"), (22, 1, "F5"), (23, 1, "A5"),
    (24, 0.5, "E6"), (24.5, 0.5, "D6"), (25, 0.5, "C6"), (25.5, 0.5, "B5"), (26, 0.5, "A5"), (26.5, 0.5, "G5"), (27, 1, "A5"),
    (28, 4, "E5"),
]

def lead(phrase, at_bar, vel=0.9):
    return [{"start": at_bar * 4 + s, "dur": d * 0.95, "pitch": p, "vel": vel} for s, d, p in phrase]

def pads(bars, start_bar):
    return [{"start": (start_bar + b) * 4, "dur": 4, "pitch": CHORDS[PROG[b % 8]], "vel": 0.5} for b in range(bars)]

TOTAL = 40  # 8 intro + 8 A + 8 B + 8 A' + 8 B'
B = lambda bar: bar * 4
spec = {
    "bpm": BPM, "seed": 7, "master_reverb": 0.5,
    "tracks": [
        {"name": "bass", "instrument": "picked_bass", "volume": 0.9,
         "notes": [n if n["start"] >= B(8) else {**n, "vel": n["vel"] * 0.6} for n in bass(TOTAL)]},
        {"name": "cello", "instrument": "cello", "volume": 0.6, "reverb": 0.5,
         "notes": [{"start": B(b), "dur": 4, "pitch": PROG[b % 8], "vel": 0.7} for b in range(8, TOTAL)]},
        {"name": "piano_arp", "instrument": "bright_acoustic_piano", "volume": 0.8, "pan": 0.3, "humanize": 0.15,
         "notes": arp(TOTAL)},
        {"name": "piano_hi", "instrument": "bright_acoustic_piano", "volume": 0.5, "pan": -0.4, "humanize": 0.15,
         "notes": [{**n, "start": n["start"] + B(8)} for n in arp(TOTAL - 8, offset=12)]},
        {"name": "strings", "instrument": "string_ensemble_1", "volume": 0.6, "reverb": 0.7, "notes": pads(TOTAL - 8, 8)},
        {"name": "choir", "instrument": "choir_aahs", "volume": 0.5, "reverb": 0.8, "pan": 0.2,
         "notes": [{**n, "octave": 5} for n in pads(16, 24)]},
        {"name": "lead_brass", "instrument": "brass_section", "volume": 0.85, "reverb": 0.4, "humanize": 0.1,
         "notes": lead(LEAD_A, 8) + lead(LEAD_B, 16) + lead(LEAD_A, 24, 1.0) + lead(LEAD_B, 32, 1.0)},
        {"name": "lead_trumpet", "instrument": "trumpet", "volume": 0.5, "pan": -0.2, "transpose": 12, "humanize": 0.1,
         "notes": lead(LEAD_A, 24) + lead(LEAD_B, 32)},
        {"name": "horns", "instrument": "french_horn", "volume": 0.6, "reverb": 0.6,
         "notes": [{"start": B(b), "dur": 4, "chord": {"A2": "Am", "F2": "F", "C3": "C", "G2": "G", "E3": "E"}[PROG[b % 8]], "octave": 3, "vel": 0.6} for b in range(16, TOTAL)]},
        {"name": "kit", "instrument": "drums:power", "volume": 0.9, "humanize": 0.1, "bars": TOTAL - 8, "step": 0.25, "offset": B(8),
         "patterns": {"kick": "x...x...x...x..x", "snare": "....x.......x...", "hihat_closed": "x.x.x.x.x.x.x.x.", "crash": "x..............."},
         "notes": []},
        {"name": "kit_fill", "instrument": "drums:power", "volume": 0.9,
         "notes": [{"start": B(7) + i * 0.25, "drum": ["tom_high", "tom_mid", "tom_low", "snare"][i // 4], "vel": 0.5 + i / 32} for i in range(16)]
                + [{"start": B(b) + 3.5 + i * 0.25, "drum": d, "vel": 0.8} for b in (15, 23, 31) for i, d in enumerate(["tom_high", "tom_low"])]},
        {"name": "timpani", "instrument": "timpani", "volume": 0.7, "reverb": 0.6,
         "notes": [{"start": B(b), "dur": 1, "pitch": mmcp.note_to_midi(PROG[b % 8]) + 12, "vel": 0.9} for b in range(24, TOTAL)]
                + [{"start": B(7) + 3, "dur": 1, "pitch": "E3", "vel": 1.0}]},
        {"name": "hat16", "instrument": "drums:power", "volume": 0.4, "pan": 0.3, "bars": TOTAL - 16, "step": 0.25, "offset": B(16),
         "patterns": {"hihat_closed": "xxxxxxxxxxxxxxxx"}, "notes": []},
    ],
}
if __name__ == "__main__":
    out = pathlib.Path(__file__).with_suffix(".wav")
    pathlib.Path(__file__).with_suffix(".json").write_text(json.dumps(spec))
    meta = mmcp.render_to_file(spec, out)
    print(json.dumps(meta, indent=1))
