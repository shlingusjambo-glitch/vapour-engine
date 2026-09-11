# Field recording provenance

Both recordings are released as **CC0 1.0 Universal** on their original source pages. Credit is retained here despite attribution being optional. The files are unmodified public high-quality MP3 encodings offered by Freesound; they are not the original lossless masters. No synthesized sound is included.

| File              | Recording and credit                                                                                                                     | Source                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ocean-waves.mp3` | “Calm ocean waves” — SamsterBirdies. Calm surf recorded with a Zoom H1n at Whidbey Island, Washington.                                   | [Original recording and CC0 declaration](https://freesound.org/people/SamsterBirdies/sounds/578524/) |
| `city-night.mp3`  | “Seamless City Loop” — qubodup, derived from the CC0 field recording “White noise city captured from window at 1st floor” by jmbphilmes. | [Original recording and CC0 declaration](https://freesound.org/people/qubodup/sounds/223093/)        |

License and provenance were checked September 5, 2026. The source URLs, download URLs, byte counts and SHA-256 hashes are pinned in `sources.json`. Re-fetch safely with `python3 tools/blender/fetch_audio.py`; changed downloads fail validation before replacing a working asset. Original lossless source files require a Freesound login and are not bundled.

Both files decode to stereo 48 kHz PCM without clipping. Ocean duration is 179.7101 seconds; city duration is 30 seconds. These objective checks establish valid audio data, not a subjective mix approval. Listening at gameplay level and matching loudness to the world remain runtime validation work. The ocean recording is loopable according to its author; decoded MP3 loop boundaries should be crossfaded if a playback implementation retains encoder padding.

The city loop is a distant ambience bed. It is unsuitable as a close vehicle engine emitter. Vehicle engines, tire friction, footsteps, impacts, doors, weapons and nearby crowd voices still require separate reviewed recordings.
