export interface VehicleAudioInput {
  /** Engine speed normalized between idle and redline. */
  readonly rpm: number;
  /** Signed drivetrain load: braking/coast -1, full throttle +1. */
  readonly load: number;
  readonly speedMetersPerSecond: number;
  readonly slip: number;
  readonly interior?: boolean;
}
export interface VehicleAudioLayer { readonly layer: "idle" | "low" | "high" | "tire" | "wind"; readonly gain: number; readonly pitch: number }
export interface VehicleAudioMix { readonly layers: readonly VehicleAudioLayer[]; readonly lowPassHz: number }

/** Continuous engine, tire, and wind parameters for a layered vehicle sound rig. */
export function mixVehicleAudio(input: VehicleAudioInput): VehicleAudioMix {
  const rpm = unit(input.rpm, "Vehicle audio RPM");
  const load = signedUnit(input.load, "Vehicle audio load");
  const speed = nonNegative(input.speedMetersPerSecond, "Vehicle audio speed");
  const slip = unit(input.slip, "Vehicle audio slip");
  const powered = 0.55 + Math.max(0, load) * 0.45;
  const idle = smoothstep(0.38, 0, rpm);
  const high = smoothstep(0.38, 0.9, rpm);
  const low = Math.max(0, 1 - idle - high * 0.65);
  return {
    layers: [
      { layer: "idle", gain: idle * (0.65 + Math.abs(load) * 0.2), pitch: 0.9 + rpm * 0.35 },
      { layer: "low", gain: low * powered, pitch: 0.78 + rpm * 0.75 },
      { layer: "high", gain: high * powered, pitch: 0.72 + rpm * 0.65 },
      { layer: "tire", gain: Math.min(1, slip * 1.3 + smoothstep(12, 38, speed) * 0.18), pitch: 0.85 + Math.min(speed, 45) / 90 },
      { layer: "wind", gain: smoothstep(8, 45, speed) * 0.7, pitch: 0.85 + Math.min(speed, 55) / 110 },
    ],
    lowPassHz: input.interior ? 2400 + rpm * 1800 : 22_050,
  };
}

export interface AmbienceVariant { readonly clip: string; readonly weight?: number; readonly volume?: number }
export interface AmbienceEmitterDefinition {
  readonly id: string;
  readonly variants: readonly AmbienceVariant[];
  readonly minInterval: number;
  readonly maxInterval: number;
  readonly seed?: number;
}
export interface AmbienceEvent { readonly emitter: string; readonly clip: string; readonly volume: number }

/** Seeded one-shot ambience scheduler; save/load can preserve its elapsed state. */
export class AmbienceEmitter {
  readonly #definition: AmbienceEmitterDefinition;
  #random: number;
  #remaining: number;

  constructor(definition: AmbienceEmitterDefinition) {
    if (definition.id.trim() === "") throw new Error("An ambience emitter requires a non-empty ID.");
    if (definition.variants.length === 0) throw new Error(`Ambience emitter '${definition.id}' requires at least one variant.`);
    positive(definition.minInterval, `Ambience emitter '${definition.id}' minimum interval`);
    positive(definition.maxInterval, `Ambience emitter '${definition.id}' maximum interval`);
    if (definition.maxInterval < definition.minInterval) throw new Error(`Ambience emitter '${definition.id}' maximum interval cannot be less than its minimum.`);
    for (const variant of definition.variants) { if (variant.clip.trim() === "") throw new Error(`Ambience emitter '${definition.id}' contains an empty clip ID.`); positive(variant.weight ?? 1, `Ambience variant '${variant.clip}' weight`); unit(variant.volume ?? 1, `Ambience variant '${variant.clip}' volume`); }
    this.#definition = definition;
    this.#random = (definition.seed ?? hash(definition.id)) >>> 0;
    this.#remaining = this.#nextInterval();
  }

  get remainingSeconds(): number { return this.#remaining; }

  update(deltaSeconds: number): readonly AmbienceEvent[] {
    let delta = nonNegative(deltaSeconds, "Ambience emitter delta");
    const events: AmbienceEvent[] = [];
    while (delta >= this.#remaining) {
      delta -= this.#remaining;
      const variant = this.#choose();
      events.push({ emitter: this.#definition.id, clip: variant.clip, volume: variant.volume ?? 1 });
      this.#remaining = this.#nextInterval();
      // Prevent malformed/high-delta callers from monopolizing a frame.
      if (events.length === 64) break;
    }
    this.#remaining -= Math.min(delta, this.#remaining);
    return events;
  }

  #choose(): AmbienceVariant {
    const total = this.#definition.variants.reduce((sum, item) => sum + (item.weight ?? 1), 0);
    let cursor = this.#nextRandom() * total;
    for (const item of this.#definition.variants) { cursor -= item.weight ?? 1; if (cursor <= 0) return item; }
    return this.#definition.variants[this.#definition.variants.length - 1]!;
  }
  #nextInterval(): number { return this.#definition.minInterval + this.#nextRandom() * (this.#definition.maxInterval - this.#definition.minInterval); }
  #nextRandom(): number { this.#random = (Math.imul(this.#random, 1664525) + 1013904223) >>> 0; return this.#random / 0x100000000; }
}

function smoothstep(start: number, end: number, value: number): number { if (start === end) return value >= end ? 1 : 0; const t = Math.max(0, Math.min(1, (value-start)/(end-start))); return t*t*(3-2*t); }
function hash(value: string): number { let result = 2166136261; for (let i=0;i<value.length;i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619); return result >>> 0; }
function positive(value: number, label: string): number { if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive.`); return value; }
function nonNegative(value: number, label: string): number { if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative.`); return value; }
function unit(value: number, label: string): number { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be in [0, 1].`); return value; }
function signedUnit(value: number, label: string): number { if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error(`${label} must be in [-1, 1].`); return value; }
