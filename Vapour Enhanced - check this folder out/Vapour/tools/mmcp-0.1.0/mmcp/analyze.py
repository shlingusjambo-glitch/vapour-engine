"""Describe a rendered buffer in words and numbers a model can reason about without hearing it."""
import numpy as np

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Krumhansl key profiles
_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def _db(x):
    return float(20 * np.log10(max(x, 1e-9)))


def _a_weight(f):
    f2 = f ** 2 + 1e-9
    ra = (12194 ** 2 * f2 ** 2) / ((f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
    return ra ** 2


def _brightness(seg, sr, n):
    """A-weighted, power-weighted centroid in log-frequency (octave) space. ~550 piano, ~1300 brass, ~2000 distorted."""
    fr = np.fft.rfftfreq(n, 1 / sr)
    P = np.abs(np.fft.rfft(seg, n=n)) ** 2 * _a_weight(fr)
    m = fr > 40
    w = P[m].sum()
    return float(2 ** ((np.log2(fr[m]) * P[m]).sum() / w)) if w > 0 else 0.0


def _label(v, bands):
    for thresh, name in bands:
        if v < thresh:
            return name
    return bands[-1][1]


def analyze(stereo, sr, bpm=120):
    mono = stereo.mean(axis=0)
    n = len(mono)
    dur = n / sr
    bar = int(60 / bpm * 4 * sr)
    nbars = max(1, int(np.ceil(n / bar)))

    # per-bar loudness + brightness
    loud, bright = [], []
    for b in range(nbars):
        seg = mono[b * bar:(b + 1) * bar]
        if len(seg) < 64:
            break
        rms = np.sqrt(np.mean(seg ** 2))
        loud.append(round(_db(rms), 1))
        bright.append(round(_brightness(seg, sr, bar)))
    while loud and loud[-1] < -50:  # drop silent tail bars
        loud.pop(); bright.pop()

    # pitch-class histogram via chroma from the spectrum
    N = 2 ** 15
    chroma = np.zeros(12)
    fr = np.fft.rfftfreq(N, 1 / sr)
    for start in range(0, n - N, N):
        mag = np.abs(np.fft.rfft(mono[start:start + N] * np.hanning(N)))
        m = (fr > 50) & (fr < 4000)
        midi = 69 + 12 * np.log2(fr[m] / 440)
        np.add.at(chroma, (np.round(midi).astype(int) % 12), mag[m])
    chroma /= chroma.sum() or 1
    scores = [(np.corrcoef(np.roll(_MAJ, i), chroma)[0, 1], f"{PITCH_NAMES[i]} major") for i in range(12)]
    scores += [(np.corrcoef(np.roll(_MIN, i), chroma)[0, 1], f"{PITCH_NAMES[i]} minor") for i in range(12)]
    key = max(scores)[1]

    # dynamics / energy
    peak = _db(np.abs(mono).max())
    rms_all = _db(np.sqrt(np.mean(mono ** 2)))
    crest = peak - rms_all
    # transient density: onsets per second from energy-flux peaks
    hop = 512
    frames = np.sqrt(np.mean(mono[: n // hop * hop].reshape(-1, hop) ** 2, axis=1))
    flux = np.maximum(np.diff(frames), 0)
    onsets = int((flux > flux.mean() + 2 * flux.std()).sum()) if len(flux) else 0
    onset_rate = onsets / dur

    stereo_width = float(np.mean(np.abs(stereo[0] - stereo[1]))) / (float(np.mean(np.abs(mono))) + 1e-9)
    centroid = float(np.mean(bright)) if bright else 0.0

    # loudness arc description
    if len(loud) >= 4:
        q = len(loud) // 4
        arc = [round(np.mean(loud[i * q:(i + 1) * q]), 1) for i in range(4)]
        if arc[-1] - arc[0] > 3:
            shape = "builds toward the end"
        elif arc[0] - arc[-1] > 3:
            shape = "fades / winds down"
        elif max(arc) - min(arc) < 2:
            shape = "flat, consistent energy"
        else:
            shape = "rises then falls"
    else:
        shape = "too short for an arc"

    return {
        "duration_sec": round(dur, 2),
        "bpm": bpm,
        "bars": len(loud),
        "estimated_key": key,
        "pitch_class_weights": {PITCH_NAMES[i]: round(float(chroma[i]), 3) for i in range(12)},
        "peak_dbfs": round(peak, 1),
        "rms_dbfs": round(rms_all, 1),
        "crest_factor_db": round(crest, 1),
        "dynamics": _label(crest, [(8, "compressed / dense"), (14, "moderate punch"), (99, "very dynamic / sparse")]),
        "spectral_centroid_hz": round(centroid),
        "brightness": _label(centroid, [(500, "dark / mellow"), (1000, "warm / acoustic"), (2000, "bright / forward"), (99999, "aggressive / harsh")]),
        "onsets_per_sec": round(onset_rate, 2),
        "rhythmic_density": _label(onset_rate, [(1.5, "sparse"), (4, "moderate"), (8, "busy"), (999, "frantic")]),
        "stereo_width": round(stereo_width, 2),
        "loudness_arc": shape,
        "loudness_per_bar_dbfs": loud,
        "brightness_per_bar_hz": bright,
    }
