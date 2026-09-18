import { describe, expect, it, vi } from "vitest";
import {
  AudioZones, MusicPlayer, STANDARD_BUSES, VoiceLimiter, applyVolumeSettings, equalPowerIn,
  equalPowerOut, gainToSlider, perceptualGain, standardBusLayout, type MixerEngine,
} from "./mixer.js";

describe("standard buses", () => {
  it("routes everything through master, with a compressor there", () => {
    const layout = standardBusLayout();
    expect(layout[0]).toMatchObject({ id: "master", compressor: true });
    for (const bus of layout.slice(1)) expect(bus.parent).toBe(STANDARD_BUSES.master);
    expect(layout.map((bus) => bus.id)).toContain("voice");
  });
});

describe("volume settings", () => {
  it("converts a linear slider into a gain that sounds proportional", () => {
    // Half a slider mapped to half gain sounds far louder than half.
    expect(perceptualGain(1)).toBe(1);
    expect(perceptualGain(0)).toBe(0);
    expect(perceptualGain(0.5)).toBeCloseTo(0.125, 6);
    expect(gainToSlider(perceptualGain(0.5))).toBeCloseTo(0.5, 6);
  });

  it("applies settings to their buses", () => {
    const calls: [string, number][] = [];
    const engine: MixerEngine = { setBusVolume: (id, volume) => calls.push([id, volume]), setBusMuted: vi.fn() };
    applyVolumeSettings(engine, { master: 1, music: 0.5, sfx: undefined });
    expect(calls).toEqual([["master", 1], ["music", 0.125]]);
  });

  it("rejects out-of-range volumes", () => {
    const engine: MixerEngine = { setBusVolume: vi.fn(), setBusMuted: vi.fn() };
    expect(() => applyVolumeSettings(engine, { master: 2 })).toThrow(/must lie in \[0, 1\]/);
    expect(() => perceptualGain(-1)).toThrow(/\[0, 1\]/);
    expect(() => gainToSlider(-1)).toThrow(/must not be negative/);
  });
});

describe("equal-power curves", () => {
  it("sum to constant power, which is why a crossfade does not dip", () => {
    // Two linearly crossfaded tracks dip audibly in the middle, because summed
    // power — not summed amplitude — is what the ear hears.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(equalPowerIn(t) ** 2 + equalPowerOut(t) ** 2).toBeCloseTo(1, 6);
    }
    expect(equalPowerIn(0)).toBeCloseTo(0, 6);
    expect(equalPowerIn(1)).toBeCloseTo(1, 6);
  });

  it("clamps outside the unit range", () => {
    expect(equalPowerIn(-1)).toBeCloseTo(0, 6);
    expect(equalPowerOut(2)).toBeCloseTo(0, 6);
  });
});

describe("MusicPlayer", () => {
  it("plays a track at full gain", () => {
    const music = new MusicPlayer();
    music.play("theme");
    expect(music.update(1)).toEqual([{ clip: "theme", gain: 1 }]);
    expect(music.state).toBe("playing");
  });

  it("crossfades, keeping constant power throughout", () => {
    const music = new MusicPlayer();
    music.play("explore");
    music.crossfadeTo("combat", 2);
    expect(music.state).toBe("crossfading");

    const mid = music.update(1);
    expect(mid).toHaveLength(2);
    expect(mid[0]!.clip).toBe("explore");
    expect(mid[1]!.clip).toBe("combat");
    expect(mid[0]!.gain ** 2 + mid[1]!.gain ** 2).toBeCloseTo(1, 6);

    const done = music.update(1);
    expect(done).toEqual([{ clip: "combat", gain: 1 }]);
    expect(music.state).toBe("playing");
    expect(music.currentClip).toBe("combat");
  });

  it("ignores a crossfade to the track already playing", () => {
    // Gameplay calls this whenever a state is entered; restarting the music on
    // every re-entry is jarring.
    const music = new MusicPlayer();
    music.play("theme");
    music.crossfadeTo("theme", 2);
    expect(music.state).toBe("playing");
  });

  it("ignores a repeated crossfade to the incoming track", () => {
    const music = new MusicPlayer();
    music.play("a");
    music.crossfadeTo("b", 2);
    music.update(0.5);
    music.crossfadeTo("b", 2);
    // Not restarted: the fade continues from where it was.
    const mid = music.update(0.5);
    expect(mid[1]!.gain).toBeGreaterThan(equalPowerIn(0.25));
  });

  it("starts immediately when nothing is playing or the fade is instant", () => {
    const music = new MusicPlayer();
    music.crossfadeTo("first", 3);
    expect(music.state).toBe("playing");
    music.crossfadeTo("second", 0);
    expect(music.currentClip).toBe("second");
  });

  it("fades out and stops", () => {
    const music = new MusicPlayer();
    music.play("theme");
    music.fadeOut(1);
    expect(music.update(0.5)[0]!.gain).toBeCloseTo(equalPowerOut(0.5), 6);
    expect(music.update(0.5)).toEqual([]);
    expect(music.state).toBe("stopped");
  });

  it("stops immediately and reports nothing", () => {
    const music = new MusicPlayer();
    music.play("theme");
    music.stop();
    expect(music.update(1)).toEqual([]);
    expect(music.currentClip).toBeUndefined();
    // Fading out with nothing playing is harmless.
    expect(() => music.fadeOut(1)).not.toThrow();
  });

  it("validates its arguments", () => {
    const music = new MusicPlayer();
    expect(() => music.play(" ")).toThrow(/must not be empty/);
    expect(() => music.crossfadeTo("a", -1)).toThrow(/must not be negative/);
    expect(() => music.fadeOut(-1)).toThrow(/must not be negative/);
    expect(() => music.update(-1)).toThrow(/non-negative delta/);
  });
});

describe("VoiceLimiter", () => {
  it("grants voices up to its budget", () => {
    const limiter = new VoiceLimiter({ maxVoices: 2 });
    expect(limiter.request({ bus: "sfx" })).toBeDefined();
    expect(limiter.request({ bus: "sfx" })).toBeDefined();
    expect(limiter.request({ bus: "sfx" })).toBeUndefined();
    expect(limiter.stats()).toMatchObject({ active: 2, granted: 2, rejected: 1 });
  });

  it("steals from a lower-priority voice", () => {
    const limiter = new VoiceLimiter({ maxVoices: 1 });
    const quiet = limiter.request({ bus: "sfx", priority: 0 })!;
    const loud = limiter.request({ bus: "sfx", priority: 5 })!;
    expect(loud.stopped?.id).toBe(quiet.voice.id);
    expect(limiter.stats().stolen).toBe(1);
  });

  it("prefers nearer sounds at equal priority", () => {
    const limiter = new VoiceLimiter({ maxVoices: 1 });
    const far = limiter.request({ bus: "sfx", distance: 90 })!;
    const near = limiter.request({ bus: "sfx", distance: 3 })!;
    expect(near.stopped?.id).toBe(far.voice.id);
    // And a distant newcomer does not displace a nearby sound.
    expect(limiter.request({ bus: "sfx", distance: 200 })).toBeUndefined();
  });

  it("caps a bus, so effects cannot starve dialogue", () => {
    const limiter = new VoiceLimiter({ maxVoices: 10, perBus: { sfx: 2 } });
    limiter.request({ bus: "sfx" });
    limiter.request({ bus: "sfx" });
    expect(limiter.request({ bus: "sfx" })).toBeUndefined();
    expect(limiter.request({ bus: "voice" })).toBeDefined();
  });

  it("limits duplicates of one clip", () => {
    // Ten copies of one impact sound is a flam, not a louder impact.
    const limiter = new VoiceLimiter({ maxVoices: 32, maxPerClip: 2 });
    limiter.request({ bus: "sfx", clip: "hit" });
    limiter.request({ bus: "sfx", clip: "hit" });
    expect(limiter.request({ bus: "sfx", clip: "hit" })).toBeUndefined();
    expect(limiter.request({ bus: "sfx", clip: "other" })).toBeDefined();
  });

  it("lets a higher-priority duplicate steal its own kind", () => {
    const limiter = new VoiceLimiter({ maxVoices: 32, maxPerClip: 1 });
    const first = limiter.request({ bus: "sfx", clip: "hit", priority: 0 })!;
    const second = limiter.request({ bus: "sfx", clip: "hit", priority: 3 })!;
    expect(second.stopped?.id).toBe(first.voice.id);
  });

  it("frees voices and updates distances", () => {
    const limiter = new VoiceLimiter({ maxVoices: 1 });
    const voice = limiter.request({ bus: "sfx", distance: 1 })!;
    limiter.setDistance(voice.voice.id, 500);
    // Now a nearer sound wins the slot.
    expect(limiter.request({ bus: "sfx", distance: 2 })).toBeDefined();
    expect(limiter.release(voice.voice.id)).toBe(false);
    limiter.releaseAll();
    expect(limiter.active).toEqual([]);
  });

  it("validates its options and arguments", () => {
    expect(() => new VoiceLimiter({ maxVoices: 0 })).toThrow(/at least one voice/);
    expect(() => new VoiceLimiter({ maxPerClip: 0 })).toThrow(/at least one instance per clip/);
    const limiter = new VoiceLimiter();
    expect(() => limiter.request({ bus: "sfx", priority: Number.NaN })).toThrow(/must be finite/);
    expect(() => limiter.request({ bus: "sfx", distance: -1 })).toThrow(/must not be negative/);
    expect(() => limiter.setDistance(999, 1)).toThrow(/not active/);
  });
});

describe("AudioZones", () => {
  const cave = {
    id: "cave",
    bounds: [-10, -10, -10, 10, 10, 10] as const,
    reverb: 0.8,
    lowPassHz: 4000,
    blendDistance: 5,
  };

  it("returns defaults outside every zone", () => {
    const zones = new AudioZones({ reverb: 0.1 });
    zones.add(cave);
    expect(zones.sample([100, 0, 0])).toEqual({ reverb: 0.1, lowPassHz: 22_050, gain: 1 });
  });

  it("applies a zone fully inside it", () => {
    const zones = new AudioZones();
    zones.add(cave);
    expect(zones.sample([0, 0, 0])).toMatchObject({ reverb: 0.8, lowPassHz: 4000 });
  });

  it("blends across the boundary rather than cutting", () => {
    // A hard cut as the listener crosses a boundary is audible and cheap to
    // avoid; the blend distance is what makes a doorway sound like a doorway.
    const zones = new AudioZones();
    zones.add(cave);
    const halfway = zones.sample([12.5, 0, 0]);
    expect(halfway.reverb).toBeGreaterThan(0.2);
    expect(halfway.reverb).toBeLessThan(0.8);
    expect(zones.sample([16, 0, 0]).reverb).toBe(0);
  });

  it("resolves overlaps by priority", () => {
    const zones = new AudioZones();
    zones.add(cave);
    zones.add({ id: "booth", bounds: [-1, -1, -1, 1, 1, 1], reverb: 0, lowPassHz: 800, priority: 10 });
    expect(zones.sample([0, 0, 0])).toMatchObject({ lowPassHz: 800 });
  });

  it("adds and removes zones", () => {
    const zones = new AudioZones();
    zones.add(cave);
    expect(zones.ids).toEqual(["cave"]);
    expect(() => zones.add(cave)).toThrow(/already registered/);
    expect(zones.remove("cave")).toBe(true);
    expect(zones.remove("cave")).toBe(false);
  });

  it("validates zone definitions", () => {
    const zones = new AudioZones();
    expect(() => zones.add({ id: " ", bounds: [0, 0, 0, 1, 1, 1] })).toThrow(/non-empty id/);
    expect(() => zones.add({ id: "bad", bounds: [5, 0, 0, 1, 1, 1] })).toThrow(/inverted bounds/);
    expect(() => zones.add({ id: "bad2", bounds: [0, 0, 0, 1, 1, 1], blendDistance: -1 })).toThrow(/negative blend distance/);
  });
});
