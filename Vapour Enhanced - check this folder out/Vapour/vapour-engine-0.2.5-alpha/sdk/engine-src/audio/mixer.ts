/** Mixer architecture: standard buses, music crossfading, zones, and voice limits.
 *
 * `AudioEngine` provides buses, clips, and spatial voices. What it deliberately
 * does not decide is *policy*: which buses exist, what happens when a hundred
 * sounds want to play at once, how music transitions, and how a room changes
 * the way things sound. Those are the parts every game gets wrong in the same
 * way, so they are provided here rather than left to each project.
 *
 * Everything in this file is plain logic over an injected engine interface, so
 * it is testable without a Web Audio context — which matters, because the
 * failure modes being guarded against (voice exhaustion, a crossfade leaving
 * two tracks audible) are exactly the ones nobody notices until a real session.
 */

/** The subset of `AudioEngine` the mixer needs, so it can be tested. */
export interface MixerEngine {
  setBusVolume(id: string, volume: number): void;
  setBusMuted(id: string, muted: boolean): void;
}

/**
 * The bus layout almost every game needs.
 *
 * Named consistently so that a settings screen, a script, and the docs all
 * agree — and because "music", "sfx", and "voice" as separate player-facing
 * volume sliders is a baseline accessibility expectation, not a nicety.
 */
export const STANDARD_BUSES = {
  master: "master",
  music: "music",
  sfx: "sfx",
  voice: "voice",
  ui: "ui",
  ambience: "ambience",
} as const;

export type StandardBus = (typeof STANDARD_BUSES)[keyof typeof STANDARD_BUSES];

export interface BusLayoutEntry {
  readonly id: string;
  readonly parent?: string;
  readonly volume?: number;
  readonly compressor?: boolean;
}

/** The standard buses, all routed through `master`. */
export function standardBusLayout(): readonly BusLayoutEntry[] {
  return [
    // A compressor on the master bus stops a burst of simultaneous sounds from
    // clipping, which is the most common cause of a game "sounding bad" in a
    // way players cannot describe.
    { id: STANDARD_BUSES.master, compressor: true },
    { id: STANDARD_BUSES.music, parent: STANDARD_BUSES.master, volume: 0.7 },
    { id: STANDARD_BUSES.sfx, parent: STANDARD_BUSES.master },
    { id: STANDARD_BUSES.voice, parent: STANDARD_BUSES.master },
    { id: STANDARD_BUSES.ui, parent: STANDARD_BUSES.master, volume: 0.8 },
    { id: STANDARD_BUSES.ambience, parent: STANDARD_BUSES.master, volume: 0.6 },
  ];
}

/**
 * Player volume settings, one per standard bus.
 *
 * Values are explicitly `number | undefined` rather than merely optional: a
 * settings snapshot legitimately contains keys whose value is unset, and
 * requiring callers to strip those before passing them here would be busywork.
 */
export interface VolumeSettings {
  readonly master?: number | undefined;
  readonly music?: number | undefined;
  readonly sfx?: number | undefined;
  readonly voice?: number | undefined;
  readonly ui?: number | undefined;
  readonly ambience?: number | undefined;
}

/**
 * Applies player volume settings to the standard buses.
 *
 * Settings are stored linearly because that is what a slider produces, and
 * converted here — perceived loudness is roughly the cube of the linear value,
 * so a slider at half that maps to half gain sounds far louder than half.
 */
export function applyVolumeSettings(engine: MixerEngine, settings: VolumeSettings): void {
  for (const [name, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    if (!(value >= 0 && value <= 1)) throw new Error(`Volume "${name}" must lie in [0, 1] (got ${value}).`);
    engine.setBusVolume(name, perceptualGain(value));
  }
}

/** Converts a linear slider value to a gain that sounds proportional. */
export function perceptualGain(slider: number): number {
  if (!(slider >= 0 && slider <= 1)) throw new Error(`A volume slider value must lie in [0, 1] (got ${slider}).`);
  return slider ** 3;
}

/** The inverse, for showing a stored gain on a slider. */
export function gainToSlider(gain: number): number {
  if (!(gain >= 0)) throw new Error("A gain must not be negative.");
  return Math.min(1, Math.cbrt(gain));
}

export interface CrossfadeTrack {
  readonly clip: string;
  /** Gain in `[0, 1]`, applied on top of the bus volume. */
  readonly gain: number;
}

export type MusicState = "stopped" | "playing" | "crossfading" | "fadingOut";

/**
 * Music playback with crossfades.
 *
 * Produces the gains for the outgoing and incoming tracks each frame rather
 * than touching audio nodes, so the transition logic can be tested and reused
 * for a music system built on any playback backend.
 *
 * The curve is equal-power, not linear. Two linearly crossfaded tracks dip
 * audibly in the middle, because summed power — not summed amplitude — is what
 * the ear hears.
 */
export class MusicPlayer {
  #current: string | undefined;
  #incoming: string | undefined;
  #elapsed = 0;
  #duration = 0;
  #state: MusicState = "stopped";

  get state(): MusicState {
    return this.#state;
  }

  get currentClip(): string | undefined {
    return this.#current;
  }

  get incomingClip(): string | undefined {
    return this.#incoming;
  }

  /** Starts a track immediately, with no transition. */
  play(clip: string): void {
    if (!clip.trim()) throw new Error("A music clip id must not be empty.");
    this.#current = clip;
    this.#incoming = undefined;
    this.#state = "playing";
    this.#elapsed = 0;
    this.#duration = 0;
  }

  /**
   * Crossfades to another track.
   *
   * Crossfading to the track already playing is a no-op, because gameplay
   * commonly calls this whenever a state is entered and restarting the music
   * on every re-entry is jarring.
   */
  crossfadeTo(clip: string, seconds: number): void {
    if (!clip.trim()) throw new Error("A music clip id must not be empty.");
    if (!(seconds >= 0)) throw new Error("A crossfade duration must not be negative.");
    if (clip === this.#current && this.#state === "playing") return;
    if (clip === this.#incoming) return;
    if (this.#current === undefined || seconds === 0) {
      this.play(clip);
      return;
    }
    this.#incoming = clip;
    this.#duration = seconds;
    this.#elapsed = 0;
    this.#state = "crossfading";
  }

  fadeOut(seconds: number): void {
    if (!(seconds >= 0)) throw new Error("A fade-out duration must not be negative.");
    if (this.#current === undefined) return;
    if (seconds === 0) {
      this.stop();
      return;
    }
    this.#incoming = undefined;
    this.#duration = seconds;
    this.#elapsed = 0;
    this.#state = "fadingOut";
  }

  stop(): void {
    this.#current = undefined;
    this.#incoming = undefined;
    this.#state = "stopped";
    this.#elapsed = 0;
  }

  /** Advances the transition and returns the tracks that should be audible. */
  update(deltaSeconds: number): readonly CrossfadeTrack[] {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("Music update requires a finite, non-negative delta.");
    if (this.#state === "stopped") return [];
    if (this.#state === "playing") return [{ clip: this.#current!, gain: 1 }];

    this.#elapsed = Math.min(this.#duration, this.#elapsed + deltaSeconds);
    const t = this.#duration <= 0 ? 1 : this.#elapsed / this.#duration;

    if (this.#state === "fadingOut") {
      if (t >= 1) {
        this.stop();
        return [];
      }
      return [{ clip: this.#current!, gain: equalPowerOut(t) }];
    }

    if (t >= 1) {
      this.#current = this.#incoming;
      this.#incoming = undefined;
      this.#state = "playing";
      return [{ clip: this.#current!, gain: 1 }];
    }
    return [
      { clip: this.#current!, gain: equalPowerOut(t) },
      { clip: this.#incoming!, gain: equalPowerIn(t) },
    ];
  }
}

/** Equal-power fade curves: their squares sum to one at every point. */
export function equalPowerIn(t: number): number {
  return Math.sin((Math.min(1, Math.max(0, t)) * Math.PI) / 2);
}

export function equalPowerOut(t: number): number {
  return Math.cos((Math.min(1, Math.max(0, t)) * Math.PI) / 2);
}

export interface VoiceRequest {
  readonly bus: string;
  /** Higher wins when voices are scarce. */
  readonly priority?: number;
  /** Distance from the listener; nearer sounds win ties. */
  readonly distance?: number;
  /** Identifier for the sound, used to limit duplicates. */
  readonly clip?: string;
}

export interface VoiceHandle {
  readonly id: number;
  readonly bus: string;
  readonly priority: number;
  readonly distance: number;
  readonly clip: string | undefined;
}

export interface VoiceLimiterOptions {
  /** Total concurrent voices. */
  readonly maxVoices?: number;
  /** Per-bus caps, so effects cannot starve dialogue. */
  readonly perBus?: Readonly<Record<string, number>>;
  /** Concurrent instances of the same clip. */
  readonly maxPerClip?: number;
}

export interface VoiceLimiterStats {
  readonly active: number;
  readonly granted: number;
  readonly stolen: number;
  readonly rejected: number;
}

/**
 * Decides which sounds get to play when there are more than there is room for.
 *
 * Browsers degrade badly past a few dozen simultaneous voices: latency rises,
 * and on some platforms playback simply stops. A game that plays a sound per
 * impact will exceed that during any explosion, so the question is not whether
 * to limit but *which* sounds to drop.
 *
 * The policy is priority first, then distance. A quiet footstep across the map
 * loses to a nearby gunshot, and dialogue with a high priority never loses to
 * either.
 */
export class VoiceLimiter {
  readonly #options: Required<VoiceLimiterOptions>;
  readonly #active = new Map<number, VoiceHandle>();
  #nextId = 1;
  #granted = 0;
  #stolen = 0;
  #rejected = 0;

  constructor(options: VoiceLimiterOptions = {}) {
    this.#options = {
      maxVoices: options.maxVoices ?? 32,
      perBus: options.perBus ?? {},
      maxPerClip: options.maxPerClip ?? 4,
    };
    if (!Number.isInteger(this.#options.maxVoices) || this.#options.maxVoices < 1) {
      throw new Error("A voice limiter needs room for at least one voice.");
    }
    if (!Number.isInteger(this.#options.maxPerClip) || this.#options.maxPerClip < 1) {
      throw new Error("A voice limiter must allow at least one instance per clip.");
    }
  }

  get active(): readonly VoiceHandle[] {
    return [...this.#active.values()];
  }

  stats(): VoiceLimiterStats {
    return { active: this.#active.size, granted: this.#granted, stolen: this.#stolen, rejected: this.#rejected };
  }

  /**
   * Requests a voice.
   *
   * Returns the granted handle plus any voice that was stopped to make room, so
   * the caller can actually stop it. Returns `undefined` when the request lost.
   */
  request(request: VoiceRequest): { readonly voice: VoiceHandle; readonly stopped: VoiceHandle | undefined } | undefined {
    const priority = request.priority ?? 0;
    const distance = request.distance ?? 0;
    if (!Number.isFinite(priority)) throw new Error("A voice priority must be finite.");
    if (!(distance >= 0)) throw new Error("A voice distance must not be negative.");

    const busCap = this.#options.perBus[request.bus];
    const inBus = [...this.#active.values()].filter((voice) => voice.bus === request.bus);
    const sameClip = request.clip === undefined ? [] : [...this.#active.values()].filter((voice) => voice.clip === request.clip);

    // Duplicate limiting first: ten copies of one impact sound is a flam, not
    // a louder impact, and dropping the excess costs nothing audible.
    if (request.clip !== undefined && sameClip.length >= this.#options.maxPerClip) {
      const weakest = this.#weakest(sameClip);
      if (!weakest || !this.#losesTo(weakest, priority, distance)) {
        this.#rejected += 1;
        return undefined;
      }
      return this.#grant(request, priority, distance, weakest);
    }

    if (busCap !== undefined && inBus.length >= busCap) {
      const weakest = this.#weakest(inBus);
      if (!weakest || !this.#losesTo(weakest, priority, distance)) {
        this.#rejected += 1;
        return undefined;
      }
      return this.#grant(request, priority, distance, weakest);
    }

    if (this.#active.size >= this.#options.maxVoices) {
      const weakest = this.#weakest([...this.#active.values()]);
      if (!weakest || !this.#losesTo(weakest, priority, distance)) {
        this.#rejected += 1;
        return undefined;
      }
      return this.#grant(request, priority, distance, weakest);
    }

    return this.#grant(request, priority, distance, undefined);
  }

  /** Frees a voice when its sound finishes or is stopped. */
  release(id: number): boolean {
    return this.#active.delete(id);
  }

  releaseAll(): void {
    this.#active.clear();
  }

  /** Updates a voice's distance, so a receding sound can lose its slot. */
  setDistance(id: number, distance: number): void {
    const voice = this.#active.get(id);
    if (!voice) throw new Error(`Voice ${id} is not active.`);
    if (!(distance >= 0)) throw new Error("A voice distance must not be negative.");
    this.#active.set(id, { ...voice, distance });
  }

  #grant(request: VoiceRequest, priority: number, distance: number, steal: VoiceHandle | undefined): { voice: VoiceHandle; stopped: VoiceHandle | undefined } {
    if (steal) {
      this.#active.delete(steal.id);
      this.#stolen += 1;
    }
    const voice: VoiceHandle = { id: this.#nextId++, bus: request.bus, priority, distance, clip: request.clip };
    this.#active.set(voice.id, voice);
    this.#granted += 1;
    return { voice, stopped: steal };
  }

  /** Lowest priority, then furthest away. */
  #weakest(candidates: readonly VoiceHandle[]): VoiceHandle | undefined {
    let weakest: VoiceHandle | undefined;
    for (const candidate of candidates) {
      if (!weakest || candidate.priority < weakest.priority || (candidate.priority === weakest.priority && candidate.distance > weakest.distance)) {
        weakest = candidate;
      }
    }
    return weakest;
  }

  #losesTo(existing: VoiceHandle, priority: number, distance: number): boolean {
    if (priority !== existing.priority) return priority > existing.priority;
    return distance < existing.distance;
  }
}

export interface AudioZoneSettings {
  /** Reverb wet mix in `[0, 1]`. */
  readonly reverb?: number;
  /** Low-pass cutoff in hertz. Lower is more muffled. */
  readonly lowPassHz?: number;
  /** Multiplies every sound's gain in this zone. */
  readonly gain?: number;
}

export interface AudioZone extends AudioZoneSettings {
  readonly id: string;
  /** Axis-aligned bounds, as `[minX, minY, minZ, maxX, maxY, maxZ]`. */
  readonly bounds: readonly [number, number, number, number, number, number];
  /** Distance over which the zone blends with its surroundings. */
  readonly blendDistance?: number;
  /** Higher priority wins where zones overlap. */
  readonly priority?: number;
}

/**
 * Positional audio zones: a cave reverberates, a room muffles, water dulls.
 *
 * Zones blend rather than switching. A hard cut as the listener crosses a
 * boundary is audible and cheap to avoid, and the blend distance is what makes
 * a doorway sound like a doorway.
 */
export class AudioZones {
  readonly #zones = new Map<string, AudioZone>();
  readonly #defaults: Required<AudioZoneSettings>;

  constructor(defaults: AudioZoneSettings = {}) {
    this.#defaults = { reverb: defaults.reverb ?? 0, lowPassHz: defaults.lowPassHz ?? 22_050, gain: defaults.gain ?? 1 };
  }

  add(zone: AudioZone): void {
    if (!zone.id.trim()) throw new Error("An audio zone requires a non-empty id.");
    if (this.#zones.has(zone.id)) throw new Error(`An audio zone named "${zone.id}" is already registered.`);
    const [minX, minY, minZ, maxX, maxY, maxZ] = zone.bounds;
    if (minX > maxX || minY > maxY || minZ > maxZ) throw new Error(`Audio zone "${zone.id}" has inverted bounds.`);
    if (zone.blendDistance !== undefined && !(zone.blendDistance >= 0)) {
      throw new Error(`Audio zone "${zone.id}" has a negative blend distance.`);
    }
    this.#zones.set(zone.id, zone);
  }

  remove(id: string): boolean {
    return this.#zones.delete(id);
  }

  get ids(): readonly string[] {
    return [...this.#zones.keys()].sort();
  }

  /** The zone settings at a position, blended across boundaries. */
  sample(position: readonly [number, number, number]): Required<AudioZoneSettings> {
    let best: { zone: AudioZone; weight: number } | undefined;
    for (const zone of this.#zones.values()) {
      const weight = this.#weightOf(zone, position);
      if (weight <= 0) continue;
      const priority = zone.priority ?? 0;
      const bestPriority = best?.zone.priority ?? -Infinity;
      if (!best || priority > bestPriority || (priority === bestPriority && weight > best.weight)) {
        best = { zone, weight };
      }
    }
    if (!best) return this.#defaults;
    const blend = (value: number | undefined, fallback: number): number => fallback + ((value ?? fallback) - fallback) * best!.weight;
    return {
      reverb: blend(best.zone.reverb, this.#defaults.reverb),
      lowPassHz: blend(best.zone.lowPassHz, this.#defaults.lowPassHz),
      gain: blend(best.zone.gain, this.#defaults.gain),
    };
  }

  /** 1 inside, falling to 0 across the blend distance outside. */
  #weightOf(zone: AudioZone, position: readonly [number, number, number]): number {
    const [minX, minY, minZ, maxX, maxY, maxZ] = zone.bounds;
    const dx = Math.max(minX - position[0], 0, position[0] - maxX);
    const dy = Math.max(minY - position[1], 0, position[1] - maxY);
    const dz = Math.max(minZ - position[2], 0, position[2] - maxZ);
    const outside = Math.hypot(dx, dy, dz);
    if (outside === 0) return 1;
    const blend = zone.blendDistance ?? 0;
    if (blend <= 0 || outside >= blend) return 0;
    return 1 - outside / blend;
  }
}
