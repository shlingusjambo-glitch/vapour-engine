"""Pure-numpy synthesis primitives. Everything returns float32 mono arrays in [-1, 1]."""
import numpy as np

SR = 44100


def adsr(n, sr, a=0.01, d=0.1, s=0.7, r=0.2):
    """ADSR envelope of length n samples, release appended after n."""
    a, d, r = (max(1, int(x * sr)) for x in (a, d, r))
    total = n + r
    env = np.full(total, s, dtype=np.float32)
    a = min(a, total)
    env[:a] = np.linspace(0, 1, a)
    dd = min(d, total - a)
    env[a:a + dd] = np.linspace(1, s, dd)
    env[n:] = np.linspace(env[min(n, total - 1)], 0, r)
    return env


def osc(shape, freq, n, sr):
    t = np.arange(n) / sr
    ph = 2 * np.pi * freq * t
    if shape == "sine":
        return np.sin(ph)
    if shape == "square":
        return np.sign(np.sin(ph))
    if shape == "saw":
        return 2 * ((freq * t) % 1) - 1
    if shape == "triangle":
        return 2 * np.abs(2 * ((freq * t) % 1) - 1) - 1
    raise ValueError(shape)


def lowpass(x, cutoff, sr):
    """One-pole lowpass. ponytail: 6dB/oct; swap for scipy.signal biquad if it sounds too soft."""
    from scipy.signal import lfilter
    a = np.exp(-2 * np.pi * cutoff / sr)
    return lfilter([1 - a], [1, -a], x)


def tone(freq, n, sr, shape="saw", detune=0.0, voices=1, cutoff=None, **env):
    """A single pitched note: stacked detuned oscillators, lowpass, ADSR."""
    out = np.zeros(n + int(env.get("r", 0.2) * sr) + 1, dtype=np.float32)
    e = adsr(n, sr, **env)
    for v in range(voices):
        off = (v - (voices - 1) / 2) * detune if voices > 1 else 0
        sig = osc(shape, freq * 2 ** (off / 1200), len(e), sr)
        out[: len(e)] += sig
    out /= voices
    if cutoff:
        out = lowpass(out, cutoff, sr)
    out[: len(e)] *= e
    return out.astype(np.float32)


def noise(n):
    return np.random.default_rng(0).uniform(-1, 1, n).astype(np.float32)


# --- drums: synthesized, not sampled ---
def kick(n, sr, **_):
    t = np.arange(n) / sr
    f = 150 * np.exp(-t * 30) + 45
    ph = 2 * np.pi * np.cumsum(f) / sr
    return (np.sin(ph) * np.exp(-t * 8)).astype(np.float32)


def snare(n, sr, **_):
    t = np.arange(n) / sr
    body = np.sin(2 * np.pi * 180 * t) * np.exp(-t * 25)
    hiss = noise(n) * np.exp(-t * 15)
    return (0.5 * body + 0.6 * hiss).astype(np.float32)


def hat(n, sr, **_):
    t = np.arange(n) / sr
    x = noise(n) * np.exp(-t * 60)
    return (x - lowpass(x, 7000, sr)).astype(np.float32) * 0.8


def clap(n, sr, **_):
    t = np.arange(n) / sr
    env = sum(np.exp(-np.maximum(t - d, 0) * 40) * (t >= d) for d in (0, 0.01, 0.02)) * np.exp(-t * 10)
    return (noise(n) * env / 3).astype(np.float32)


# --- effects on a stereo (2, n) buffer ---
def reverb(x, sr, mix=0.25, size=0.6):
    """Schroeder-ish: 4 parallel combs + 1 allpass. ponytail: cheap and boxy; FDN if it matters."""
    from scipy.signal import lfilter
    out = np.zeros_like(x)
    for ch in range(x.shape[0]):
        wet = np.zeros(x.shape[1])
        for ms in (29.7, 37.1, 41.1, 43.7):
            d = int(ms * size * 2 * sr / 1000)
            b = np.zeros(d + 1); b[0] = 1
            a = np.zeros(d + 1); a[0] = 1; a[d] = -0.8 * size
            wet += lfilter(b, a, x[ch])
        d = int(5 * sr / 1000)
        b = np.zeros(d + 1); b[0] = 0.5; b[d] = 1
        a = np.zeros(d + 1); a[0] = 1; a[d] = 0.5
        out[ch] = (1 - mix) * x[ch] + mix * lfilter(b, a, wet / 4)
    return out


def delay(x, sr, time=0.375, feedback=0.35, mix=0.3):
    d = int(time * sr)
    out = x.copy()
    buf = x.copy()
    for _ in range(6):
        buf = np.roll(buf, d, axis=1) * feedback
        buf[:, :d] = 0
        out += buf * mix
    return out


def soft_clip(x, sr=None, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)
