"""Song spec -> stereo float32 buffer. Sampled GM instruments via FluidSynth, synth patches via numpy,
user WAV folders via 'sample:'. See SPEC.md."""
import json
import os
import re
import tempfile
import wave
import numpy as np
from . import synth, gm, midi

NOTE_RE = re.compile(r"^([A-Ga-g])([#b]?)(-?\d+)$")
_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

SYNTH = {  # numpy patches — the "retro" family, kept as one option among many
    "lead_saw":   (dict(shape="saw", voices=3, detune=12, cutoff=6000, a=0.005, d=0.1, s=0.8, r=0.15), "bright supersaw lead"),
    "lead_square":(dict(shape="square", cutoff=4000, a=0.005, d=0.05, s=0.9, r=0.1), "chiptune square lead"),
    "pluck":      (dict(shape="triangle", a=0.002, d=0.15, s=0.0, r=0.1), "short plucked triangle"),
    "pad":        (dict(shape="saw", voices=5, detune=18, cutoff=1800, a=0.4, d=0.3, s=0.8, r=0.8), "wide slow saw pad"),
    "bass":       (dict(shape="saw", cutoff=900, a=0.005, d=0.1, s=0.9, r=0.08), "filtered saw bass"),
    "sub":        (dict(shape="sine", a=0.01, d=0.05, s=1.0, r=0.1), "sine sub bass"),
    "organ":      (dict(shape="square", voices=2, detune=6, cutoff=3000, a=0.02, d=0.0, s=1.0, r=0.05), "reedy square organ"),
    "bell":       (dict(shape="sine", voices=2, detune=1200, a=0.001, d=0.6, s=0.0, r=0.4), "glassy sine bell"),
}
SYNTH_DRUMS = {"kick": "kick", "snare": "snare", "hat": "hat", "hihat_closed": "hat", "clap": "clap"}

# chord symbols
_CHORD = {"": [0, 4, 7], "m": [0, 3, 7], "dim": [0, 3, 6], "aug": [0, 4, 8], "sus2": [0, 2, 7], "sus4": [0, 5, 7],
          "5": [0, 7], "6": [0, 4, 7, 9], "m6": [0, 3, 7, 9], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11],
          "m7": [0, 3, 7, 10], "dim7": [0, 3, 6, 9], "m7b5": [0, 3, 6, 10], "9": [0, 4, 7, 10, 14],
          "maj9": [0, 4, 7, 11, 14], "m9": [0, 3, 7, 10, 14], "add9": [0, 4, 7, 14], "madd9": [0, 3, 7, 14],
          "7sus4": [0, 5, 7, 10], "11": [0, 4, 7, 10, 14, 17], "13": [0, 4, 7, 10, 14, 21]}
CHORD_RE = re.compile(r"^([A-Ga-g][#b]?)(.*?)(?:/([A-Ga-g][#b]?))?$")


def note_to_midi(n):
    if isinstance(n, (int, float)):
        return int(n)
    m = NOTE_RE.match(n)
    if not m:
        raise ValueError(f"bad note {n!r}")
    letter, acc, octv = m.groups()
    return 12 * (int(octv) + 1) + _SEMI[letter.upper()] + {"#": 1, "b": -1, "": 0}[acc]


def chord_to_midi(symbol, octave=4, inversion=0):
    """'Am7' -> [57, 60, 64, 67]. Supports slash bass: 'C/E'."""
    m = CHORD_RE.match(symbol)
    if not m or m.group(2) not in _CHORD:
        raise ValueError(f"unknown chord {symbol!r}")
    root = note_to_midi(m.group(1) + str(octave))
    notes = [root + i for i in _CHORD[m.group(2)]]
    for _ in range(inversion):
        notes.append(notes.pop(0) + 12)
    if m.group(3):
        notes.insert(0, note_to_midi(m.group(3) + str(octave - 1)))
    return notes


def midi_to_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def _expand_notes(track, rng):
    """Yield (start_beat, dur_beats, midi_or_drumname, vel)."""
    hum_t, hum_v = track.get("humanize", 0.0), track.get("humanize", 0.0)
    def jit(s, d, p, v):
        if hum_t:
            s = max(0.0, s + rng.normal(0, hum_t * 0.05))
            v = float(np.clip(v + rng.normal(0, hum_v * 0.1), 0.05, 1.0))
        return s, d, p, v
    for n in track.get("notes", []):
        vel = n.get("vel", 0.8)
        if "chord" in n:
            for p in chord_to_midi(n["chord"], n.get("octave", 4), n.get("inversion", 0)):
                yield jit(n["start"], n.get("dur", 1), p, vel)
            continue
        pitches = n.get("pitch", n.get("drum"))
        for p in (pitches if isinstance(pitches, list) else [pitches]):
            if isinstance(p, str) and p in gm.DRUMS and not NOTE_RE.match(p):
                yield jit(n["start"], n.get("dur", 0.25), p, vel)
            else:
                yield jit(n["start"], n.get("dur", 1), note_to_midi(p) if p is not None else "kick", vel)
    for drum, pat in track.get("patterns", {}).items():  # {"kick": "x...x...", "snare": "....x..."}
        step = track.get("step", 0.25)
        for r in range(int(np.ceil(track.get("bars", 1) * 4 / (len(pat) * step)))):
            for i, ch in enumerate(pat):
                if ch in "xX":
                    yield jit((r * len(pat) + i) * step, step, drum, 1.0 if ch == "X" else 0.7)
    if "pattern" in track:  # single-drum shorthand
        yield from _expand_notes({"patterns": {track.get("drum", "kick"): track["pattern"]},
                                  "step": track.get("step", 0.25), "bars": track.get("bars", 1)}, rng)


class Tempo:
    """Piecewise-constant tempo map: beat -> seconds."""
    def __init__(self, spec):
        tm = spec.get("tempo_map") or [{"beat": 0, "bpm": spec.get("bpm", 120)}]
        self.pts = sorted((float(t["beat"]), float(t["bpm"])) for t in tm)
        if self.pts[0][0] > 0:
            self.pts.insert(0, (0.0, self.pts[0][1]))
    def sec(self, beat):
        t, (b0, bpm) = 0.0, self.pts[0]
        for b1, bpm1 in self.pts[1:]:
            if beat <= b1:
                break
            t += (b1 - b0) * 60 / bpm
            b0, bpm = b1, bpm1
        return t + (beat - b0) * 60 / bpm


def _kind(name):
    """'piano' style resolution: returns (kind, payload)."""
    if name.startswith("synth:"):
        return "synth", name[6:]
    if name.startswith("sample:"):
        return "sample", name[7:]
    if name.startswith("drums"):
        return "drums", gm.DRUM_KITS[name.split(":")[1]] if ":" in name else 0
    if name in gm.PROGRAMS:
        return "gm", gm.PROGRAMS[name]
    if name in SYNTH:
        return "synth", name
    raise ValueError(f"unknown instrument {name!r}; call list_instruments()")


def _load_samples(folder, sr):
    """Folder of WAVs named by note (C4.wav) or drum name (snare.wav). Returns {key: mono float32}."""
    out = {}
    for f in os.listdir(folder):
        if not f.lower().endswith(".wav"):
            continue
        with wave.open(os.path.join(folder, f), "rb") as w:
            pcm = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32767
            x = pcm.reshape(-1, w.getnchannels()).mean(axis=1)
            if w.getframerate() != sr:
                x = np.interp(np.arange(0, len(x), w.getframerate() / sr), np.arange(len(x)), x)
        key = os.path.splitext(f)[0]
        out[note_to_midi(key) if NOTE_RE.match(key) else key] = x.astype(np.float32)
    if not out:
        raise ValueError(f"no .wav files in {folder}")
    return out


def _sample_for(samples, key):
    if key in samples:
        return samples[key]
    pitched = [k for k in samples if isinstance(k, int)]
    if isinstance(key, int) and pitched:  # nearest root, resample to pitch
        root = min(pitched, key=lambda k: abs(k - key))
        x = samples[root]
        ratio = 2 ** ((key - root) / 12)
        return np.interp(np.arange(0, len(x), ratio), np.arange(len(x)), x).astype(np.float32)
    return None


def render(spec):
    """Returns (stereo float32 (2, n), sample_rate, per-track info)."""
    sr = int(spec.get("sample_rate", synth.SR))
    tempo = Tempo(spec)
    rng = np.random.default_rng(spec.get("seed", 0))
    swing = float(spec.get("swing", 0.0))
    tracks_info, parsed, end = [], [], 0.0
    for tr in spec["tracks"]:
        notes = []
        off = float(tr.get("offset", 0))
        for s, d, p, v in _expand_notes(tr, rng):
            s += off
            if swing and (s / 0.5) % 2 >= 1:
                s += swing * 0.5
            notes.append((s, d, p, v))
            end = max(end, tempo.sec(s + d))
        parsed.append((tr, notes))
    n_total = int((end + 2.5) * sr)
    mix = np.zeros((2, n_total), dtype=np.float32)

    # --- GM tracks: one MIDI, one FluidSynth pass ---
    events, chan = [], 0
    for tr, notes in parsed:
        kind, payload = _kind(tr["instrument"])
        if kind not in ("gm", "drums"):
            continue
        ch = 9 if kind == "drums" else chan
        if kind != "drums":
            chan += 1 + (chan == 8)  # skip channel 10 (index 9)
            if chan > 15:
                raise ValueError("max 15 melodic GM tracks")  # ponytail: multi-pass render if anyone hits this
        pc = bytes([0xC0 | ch, payload])
        cc = lambda c, v: bytes([0xB0 | ch, c, int(np.clip(v, 0, 127))])
        pan = float(tr.get("pan", 0.0))
        events += [(0, pc), (0, cc(7, tr.get("volume", 0.8) * 127)), (0, cc(10, 64 + pan * 63)),
                   (0, cc(91, tr.get("reverb", 0.3) * 127)), (0, cc(93, tr.get("chorus", 0.0) * 127))]
        for s, d, p, v in notes:
            note = gm.DRUMS[p] if isinstance(p, str) else int(p) + tr.get("transpose", 0)
            note = int(np.clip(note, 0, 127))
            t0, t1 = int(s * midi.PPQ), int((s + d * (0.98 if kind == "gm" else 1)) * midi.PPQ)
            events.append((t0, bytes([0x90 | ch, note, int(np.clip(v * 127, 1, 127))])))
            events.append((max(t1, t0 + 1), bytes([0x80 | ch, note, 0])))
        for a, b in tr.get("pedal", []):
            events.append((int(a * midi.PPQ), cc(64, 127)))
            events.append((int(b * midi.PPQ), cc(64, 0)))
        prog_name = f"drums:{[k for k, v in gm.DRUM_KITS.items() if v == payload][0]}" if kind == "drums" else tr["instrument"]
        _info(tracks_info, tr, notes, prog_name, "sampled " + ("drum kit" if kind == "drums" else gm.family(payload)))
    if events:
        with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
            midi.write_midi(f.name, events, [(b, bpm) for b, bpm in tempo.pts])
        st = midi.render_midi(f.name, spec.get("soundfont", midi.SF2_DEFAULT), sr,
                              reverb=spec.get("master_reverb", 0.4), chorus=spec.get("master_chorus", 0.2))
        os.remove(f.name)
        n = min(n_total, st.shape[1])
        mix[:, :n] += st[:, :n]

    # --- synth + sample tracks: numpy ---
    for tr, notes in parsed:
        kind, payload = _kind(tr["instrument"])
        if kind in ("gm", "drums"):
            continue
        samples = _load_samples(payload, sr) if kind == "sample" else None
        buf = np.zeros(n_total, dtype=np.float32)
        for s, d, p, v in notes:
            i0 = int(tempo.sec(s) * sr)
            n = max(1, int((tempo.sec(s + d) - tempo.sec(s)) * sr))
            if kind == "synth":
                if isinstance(p, str):
                    fn = SYNTH_DRUMS.get(p) or SYNTH_DRUMS.get(payload)
                    if not fn:
                        continue
                    sig = getattr(synth, fn)(min(n, sr // 2), sr)
                elif payload in SYNTH_DRUMS:
                    sig = getattr(synth, SYNTH_DRUMS[payload])(min(n, sr // 2), sr)
                else:
                    sig = synth.tone(midi_to_hz(p + tr.get("transpose", 0)), n, sr, **SYNTH[payload][0])
            else:
                sig = _sample_for(samples, p + tr.get("transpose", 0) if isinstance(p, int) else p)
                if sig is None:
                    continue
                if isinstance(p, int) and len(sig) > n + sr // 10:  # pitched: cut to note length with short fade
                    sig = sig[: n + sr // 10].copy()
                    sig[-sr // 10:] *= np.linspace(1, 0, sr // 10)
            sig = sig * v
            i1 = min(n_total, i0 + len(sig))
            buf[i0:i1] += sig[: i1 - i0]
        vol, pan = float(tr.get("volume", 0.8)), float(tr.get("pan", 0.0))
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        st = np.stack([buf * vol * l, buf * vol * r])
        if kind == "synth":
            st = synth.lowpass(st, 9000, sr)
        for fx in tr.get("effects", []):
            fx = dict(fx)
            st = getattr(synth, fx.pop("type"))(st, sr, **fx)
        mix += st
        _info(tracks_info, tr, notes, tr["instrument"], SYNTH[payload][1] if kind == "synth" else f"user samples from {payload}")

    mix = synth.soft_clip(mix, drive=1.0)
    mix *= 0.89 / (np.abs(mix).max() or 1.0)
    return mix, sr, tracks_info


def _info(acc, tr, notes, inst, desc):
    pitches = [p for _, _, p, _ in notes if isinstance(p, int)]
    acc.append({"name": tr.get("name", inst), "instrument": inst, "description": desc, "note_count": len(notes),
                "pitch_range": [min(pitches), max(pitches)] if pitches else None,
                "drums_used": sorted({p for _, _, p, _ in notes if isinstance(p, str)}) or None})


def write_wav(path, stereo, sr):
    pcm = (np.clip(stereo.T, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def render_to_file(spec, path):
    """Render spec (dict or JSON string) to WAV. Returns metadata dict."""
    from .analyze import analyze
    if isinstance(spec, str):
        spec = json.loads(spec)
    stereo, sr, tracks = render(spec)
    write_wav(path, stereo, sr)
    meta = analyze(stereo, sr, bpm=Tempo(spec).pts[0][1])
    meta["tracks"] = tracks
    meta["path"] = str(path)
    return meta


INSTRUMENTS = {**{k: gm.family(v) for k, v in gm.PROGRAMS.items()},
               **{f"drums:{k}": "drum kit" for k in gm.DRUM_KITS},
               **{f"synth:{k}": v[1] for k, v in SYNTH.items()},
               **{f"synth:{k}": "synth drum" for k in SYNTH_DRUMS}}
