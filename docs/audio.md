# Audio

`AudioEngine` is the browser audio service exposed as `GameContext.audio`.
`GameRuntime` creates and owns it when Web Audio is available; headless runs and
explicitly disabled runtimes receive `undefined`. Tests can inject a mixer.

Named buses route into `master`. Each bus supports hierarchical routing,
volume, mute, and optional dynamics compression. Clips may be registered as
decoded `AudioBuffer` objects or fetched and decoded with `loadClip`. Long music
uses `createStream`, which routes an `HTMLAudioElement` through the same mixer
without retaining the entire decoded file.

Voices support volume, pitch/playback rate, loops, offsets, stopping, and
optional HRTF spatialization with minimum/maximum distance. Spatial sources can
select `linear`, `inverse`, or `exponential` attenuation, rolloff, orientation,
and inner/outer directional cones. Spatial voices can move and reorient after
playback and the listener accepts position, forward, and up vectors.
`stopAll` optionally targets one bus.

`audio.createSource({ clip, ...settings })` creates a reusable authored source
controller whose position, volume, and pitch update both its stored definition
and its live voice. ECS AudioSource components and VS scripts can therefore own
stable settings without retaining browser audio nodes themselves.

`voice.setPitch(value)` changes an already-playing decoded clip or stream. The
value must remain positive; invalid changes fail before reaching Web Audio.

Spatial voices also support physical Doppler. Supply emitter `velocity`,
`dopplerFactor`, and `speedOfSound`, then update movement with
`voice.setVelocity()`. Listener velocity is the fourth argument to
`setListener()`. Vapour projects both velocities onto the listener-to-source
axis, multiplies the resulting Doppler ratio by authored pitch, and safely
clamps extreme rates to Web Audio's practical range. A factor of zero disables
the effect. `dopplerRatio` exposes the same deterministic calculation to
headless simulation and tests.

Browsers commonly begin with a suspended audio context. Call
`await game.audio?.unlock()` from a click, key, or touch handler. If policy still
blocks playback, Vapour reports the context state and user-gesture guidance.
Fetch, HTTP, decode, missing-clip, unknown-bus, invalid-distance, and unsupported
streaming errors preserve the relevant clip, bus, or URL.

Reverb/convolution presets, authorable filter chains, editor waveform tools,
and serialized AudioSource components remain release gates. The current API
already covers music, dialogue voices, UI sounds, world effects, and mixer
controls without game-specific audio infrastructure.

---

# Mixer architecture (Alpha 0.2.5)

`AudioEngine` provides buses, clips, and spatial voices. What it deliberately
does not decide is **policy**: which buses exist, what happens when a hundred
sounds want to play at once, how music transitions, and how a room changes the
way things sound. Those are the parts every game gets wrong in the same way.

## Standard buses

```ts
import { standardBusLayout, applyVolumeSettings, STANDARD_BUSES } from "@vapour/engine";

for (const bus of standardBusLayout()) engine.defineBus(bus);
applyVolumeSettings(engine, settings.snapshot());
```

`master`, `music`, `sfx`, `voice`, `ui`, `ambience` — all routed through
`master`, which carries a compressor. That compressor stops a burst of
simultaneous sounds from clipping, the most common cause of a game "sounding
bad" in a way players cannot describe.

Separate music/sfx/voice sliders are a baseline accessibility expectation, not a
nicety.

### Volume is not linear

```ts
perceptualGain(0.5);   // 0.125, not 0.5
```

Sliders produce linear values; loudness is roughly the cube of them. A slider at
half mapped straight to half gain sounds far louder than half. `perceptualGain`
and `gainToSlider` convert in both directions, so settings can be stored as the
linear value the player set.

## Music crossfading

```ts
const music = new MusicPlayer();
music.crossfadeTo("combat", 2);

// each frame
for (const track of music.update(deltaSeconds)) engine.setClipGain(track.clip, track.gain);
```

The curve is **equal-power**, not linear: `in² + out² = 1` at every point. Two
linearly crossfaded tracks dip audibly in the middle, because summed *power* —
not summed amplitude — is what the ear hears. There is a test asserting the
invariant directly.

Crossfading to the track already playing is a **no-op**. Gameplay calls this
whenever a state is entered, and restarting the music on every re-entry is
jarring.

## Voice limiting

Browsers degrade badly past a few dozen simultaneous voices: latency rises, and
on some platforms playback simply stops. A game that plays a sound per impact
will exceed that during any explosion, so the question is not *whether* to limit
but **which** sounds to drop.

```ts
const limiter = new VoiceLimiter({ maxVoices: 32, perBus: { sfx: 20 }, maxPerClip: 4 });

const slot = limiter.request({ bus: "sfx", clip: "impact", priority: 1, distance: distanceToListener });
if (slot) {
  slot.stopped && engine.stopVoice(slot.stopped.id);
  play(slot.voice.id);
}
```

Policy is **priority first, then distance**. A quiet footstep across the map
loses to a nearby gunshot; dialogue with a high priority never loses to either.
Per-bus caps stop effects starving dialogue, and `maxPerClip` prevents ten
copies of one impact sound — which is a flam, not a louder impact.

## Audio zones

```ts
const zones = new AudioZones({ reverb: 0.05 });
zones.add({ id: "cave", bounds: [-10, -10, -10, 10, 10, 10], reverb: 0.8, lowPassHz: 4000, blendDistance: 5 });

const here = zones.sample(listener.position);   // { reverb, lowPassHz, gain }
```

Zones **blend** rather than switching. A hard cut as the listener crosses a
boundary is audible and cheap to avoid, and the blend distance is what makes a
doorway sound like a doorway. Overlaps resolve by priority, so a phone booth
inside a cave sounds like a phone booth.

## API reference

| Export | Purpose |
| ------ | ------- |
| `standardBusLayout`, `STANDARD_BUSES` | The conventional bus tree |
| `applyVolumeSettings`, `perceptualGain`, `gainToSlider` | Player volume settings |
| `MusicPlayer` | `play`, `crossfadeTo`, `fadeOut`, `stop`, `update` |
| `equalPowerIn`, `equalPowerOut` | The crossfade curves |
| `VoiceLimiter` | `request`, `release`, `setDistance`, `stats` |
| `AudioZones` | `add`, `remove`, `sample` |
| `dopplerRatio` | Physical listener/source velocity pitch multiplier |

## Performance considerations

Everything here is plain logic over an injected engine interface, so it runs and
is tested without a Web Audio context. The failure modes it guards against —
voice exhaustion, a crossfade leaving two tracks audible — are exactly the ones
nobody notices until a real session.

`AudioZones.sample` scans every zone. That is fine for the tens of zones a level
has; a world with thousands needs a spatial index in front of it.
