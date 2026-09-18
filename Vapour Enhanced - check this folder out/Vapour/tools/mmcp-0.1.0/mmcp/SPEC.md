# MMCP song spec

One JSON object. Times in **beats** (quarter notes). Pitches: note names (`"C4"`, `"F#3"`, `"Bb2"`) or MIDI ints.
Instruments are **real sampled instruments** (General MIDI via SoundFont) unless you ask for `synth:` or `sample:`.

```json
{
  "bpm": 92,
  "tempo_map": [{"beat": 0, "bpm": 92}, {"beat": 64, "bpm": 100}],
  "swing": 0.0,
  "master_reverb": 0.4,
  "tracks": [
    {
      "name": "piano", "instrument": "acoustic_grand_piano",
      "volume": 0.85, "pan": 0.0, "reverb": 0.3, "chorus": 0.0, "transpose": 0, "humanize": 0.3,
      "pedal": [[0, 4], [4, 8]],
      "notes": [
        {"start": 0, "dur": 4, "chord": "Am7", "octave": 3, "inversion": 0, "vel": 0.6},
        {"start": 0, "dur": 0.5, "pitch": "E5", "vel": 0.8},
        {"start": 1, "dur": 1, "pitch": ["C4", "E4", "G4"]}
      ]
    },
    {"name": "strings", "instrument": "string_ensemble_1", "volume": 0.5, "reverb": 0.7, "pan": -0.3,
     "notes": [{"start": 0, "dur": 4, "chord": "Am", "octave": 4}]},
    {"name": "kit", "instrument": "drums:standard", "humanize": 0.2, "bars": 8, "step": 0.25,
     "patterns": {"kick": "x...x...x...x...", "snare": "....x.......x...", "hihat_closed": "x.x.x.x.x.x.x.x.", "crash": "x..............."}},
    {"name": "fills", "instrument": "drums:standard", "notes": [{"start": 31, "dur": 0.25, "drum": "tom_high"}, {"start": 31.5, "drum": "tom_low"}]}
  ]
}
```

## Instruments (`list_instruments()` for the full list)
- **Sampled GM** (default, realistic): `acoustic_grand_piano`, `electric_piano_1`, `nylon_guitar`, `steel_guitar`, `clean_guitar`, `distortion_guitar`, `fingered_bass`, `picked_bass`, `slap_bass_1`, `violin`, `cello`, `string_ensemble_1`, `choir_aahs`, `trumpet`, `french_horn`, `brass_section`, `alto_sax`, `clarinet`, `flute`, `church_organ`, `rock_organ`, `vibraphone`, `marimba`, `sitar`, `koto`, `kalimba`, `pad_warm`, `lead_sawtooth`, `timpani`, `taiko_drum` … (128 total)
- **Drum kits** (use `patterns` / `drum` names, not pitches): `drums:standard`, `drums:room`, `drums:power`, `drums:electronic`, `drums:tr808`, `drums:jazz`, `drums:brush`, `drums:orchestra`
- **Synth** (retro/chiptune, numpy): `synth:lead_saw`, `synth:lead_square`, `synth:pluck`, `synth:pad`, `synth:bass`, `synth:sub`, `synth:organ`, `synth:bell`, `synth:kick`, `synth:snare`, `synth:hat`, `synth:clap`
- **Your own samples**: `sample:/path/to/folder` — WAVs named `C4.wav`, `G#2.wav` (pitched, nearest root is resampled) or `snare.wav`, `kick.wav` (one-shots referenced by `drum`)

## Fields
- `notes[]`: `start`, `dur` (default 1), and one of `pitch` (name/int/list), `chord` (+`octave`,`inversion`), `drum`. `vel` 0..1.
- `chord` symbols: `C Cm C7 Cmaj7 Cm7 Cdim Caug Csus2 Csus4 C5 C6 C9 Cmaj9 Cm9 Cadd9 Cm7b5 Cdim7 C7sus4 C11 C13`, slash bass `C/E`.
- `patterns`: `{drum_name: "x.X."}` — `x` hit, `X` accent, `.` rest; `step` beats per char; `bars` loop count.
- `humanize` 0..1: random timing (±~50 ms at 1.0) and velocity jitter. `seed` at top level makes it repeatable.
- `offset`: beats added to every note in the track (start a loop at bar 8 = `"offset": 32`).
- `pedal`: sustain-pedal regions `[[start_beat, end_beat], …]` (GM only).
- `reverb` / `chorus` 0..1 per GM track (send levels). `master_reverb`, `master_chorus` 0..1 global.
- `effects` (synth/sample tracks only): `reverb {mix,size}`, `delay {time,feedback,mix}`, `soft_clip {drive}`.
- `tempo_map`: list of `{beat, bpm}` for ritardando / tempo changes. `swing` 0..0.5.
- `soundfont`: path to another `.sf2` if you want a different sample library.

## Reading the metadata
`render_song` returns `estimated_key`, `brightness` (dark→harsh), `dynamics`, `rhythmic_density`, `loudness_arc`,
`loudness_per_bar_dbfs`, `brightness_per_bar_hz`, and per-track `pitch_range`, `note_count`, `drums_used`.
Iterate on it: flat arc → thin the intro; muddy (dark + busy) → fewer low notes overlapping, raise `octave`;
too clean → `humanize` 0.3–0.5; sounds mechanical → vary `vel` per note, use `pedal`, add ghost notes at vel 0.3.
