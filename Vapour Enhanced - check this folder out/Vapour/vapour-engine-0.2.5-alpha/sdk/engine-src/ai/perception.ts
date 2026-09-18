import type { Vector3Like } from "./ai.js";

export interface PerceptionTarget {
  readonly id: string;
  readonly position: Vector3Like;
  readonly tags?: readonly string[];
  readonly threat?: number;
}

export interface VisionSensorOptions {
  readonly range: number;
  /** Full horizontal field of view in degrees. */
  readonly fieldOfView: number;
  readonly eye?: Vector3Like;
  readonly forward?: Vector3Like;
  /** Return true when geometry blocks the segment. */
  readonly occluded?: (from: Vector3Like, to: Vector3Like, target: PerceptionTarget) => boolean;
}

export interface PerceivedTarget extends PerceptionTarget {
  readonly distance: number;
  readonly score: number;
}

/** Allocation-conscious vision query with range, cone, tags, and pluggable LOS. */
export function perceiveVision(targets: Iterable<PerceptionTarget>, options: VisionSensorOptions, requiredTag?: string): PerceivedTarget[] {
  requirePositive(options.range, "Vision range");
  if (!Number.isFinite(options.fieldOfView) || options.fieldOfView <= 0 || options.fieldOfView > 360) throw new Error("Vision field of view must be finite and in (0, 360].");
  const eye = options.eye ?? ZERO;
  const forward = normalize(options.forward ?? FORWARD, "Vision forward vector");
  const threshold = options.fieldOfView >= 360 ? -1 : Math.cos(options.fieldOfView * Math.PI / 360);
  const visible: PerceivedTarget[] = [];
  for (const target of targets) {
    requireId(target.id, "Perception target");
    if (requiredTag !== undefined && !target.tags?.includes(requiredTag)) continue;
    const dx = target.position.x - eye.x, dy = target.position.y - eye.y, dz = target.position.z - eye.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > options.range || distance <= Number.EPSILON) continue;
    if ((dx * forward.x + dy * forward.y + dz * forward.z) / distance < threshold) continue;
    if (options.occluded?.(eye, target.position, target)) continue;
    const threat = target.threat ?? 0;
    if (!Number.isFinite(threat)) throw new Error(`Perception target '${target.id}' has a non-finite threat.`);
    visible.push({ ...target, distance, score: threat + 1 - distance / options.range });
  }
  return visible.sort((a, b) => b.score - a.score || a.distance - b.distance || a.id.localeCompare(b.id));
}

export interface SoundStimulus {
  readonly id: string;
  readonly position: Vector3Like;
  readonly loudness: number;
  readonly tags?: readonly string[];
}

export interface HeardStimulus extends SoundStimulus {
  readonly distance: number;
  readonly strength: number;
}

/** Distance-attenuated hearing; an optional obstruction callback can model walls. */
export function perceiveHearing(listener: Vector3Like, range: number, sounds: Iterable<SoundStimulus>, obstruction?: (from: Vector3Like, to: Vector3Like, sound: SoundStimulus) => number): HeardStimulus[] {
  requirePositive(range, "Hearing range");
  const heard: HeardStimulus[] = [];
  for (const sound of sounds) {
    requireId(sound.id, "Sound stimulus");
    if (!Number.isFinite(sound.loudness) || sound.loudness < 0) throw new Error(`Sound stimulus '${sound.id}' loudness must be finite and non-negative.`);
    const distance = Math.hypot(sound.position.x - listener.x, sound.position.y - listener.y, sound.position.z - listener.z);
    const blocked = obstruction?.(listener, sound.position, sound) ?? 0;
    if (!Number.isFinite(blocked) || blocked < 0 || blocked > 1) throw new Error("Hearing obstruction must return a finite value in [0, 1].");
    const strength = sound.loudness * Math.max(0, 1 - distance / range) * (1 - blocked);
    if (strength > 0) heard.push({ ...sound, distance, strength });
  }
  return heard.sort((a, b) => b.strength - a.strength || a.distance - b.distance || a.id.localeCompare(b.id));
}

export interface BlackboardKey<T> { readonly name: string; readonly defaultValue?: T }
export function blackboardKey<T>(name: string, defaultValue?: T): BlackboardKey<T> {
  requireId(name, "Blackboard key");
  return defaultValue === undefined ? { name } : { name, defaultValue };
}

/** Typed shared memory for behavior trees and controllers. */
export class Blackboard {
  readonly #values = new Map<string, unknown>();
  readonly #listeners = new Map<string, Set<(value: unknown, previous: unknown) => void>>();

  has(key: BlackboardKey<unknown>): boolean { return this.#values.has(key.name); }
  get<T>(key: BlackboardKey<T>): T | undefined { return (this.#values.has(key.name) ? this.#values.get(key.name) : key.defaultValue) as T | undefined; }
  require<T>(key: BlackboardKey<T>): T {
    const value = this.get(key);
    if (value === undefined) throw new Error(`Blackboard key '${key.name}' has no value and no default.`);
    return value;
  }
  set<T>(key: BlackboardKey<T>, value: T): void {
    const previous = this.get(key);
    this.#values.set(key.name, value);
    for (const listener of this.#listeners.get(key.name) ?? []) listener(value, previous);
  }
  delete(key: BlackboardKey<unknown>): boolean { return this.#values.delete(key.name); }
  clear(): void { this.#values.clear(); }
  observe<T>(key: BlackboardKey<T>, listener: (value: T, previous: T | undefined) => void): () => void {
    const listeners = this.#listeners.get(key.name) ?? new Set();
    this.#listeners.set(key.name, listeners);
    listeners.add(listener as (value: unknown, previous: unknown) => void);
    return () => listeners.delete(listener as (value: unknown, previous: unknown) => void);
  }
  snapshot(): Readonly<Record<string, unknown>> { return Object.freeze(Object.fromEntries([...this.#values].sort(([a], [b]) => a.localeCompare(b)))); }
}

export type TargetPolicy = "highest-score" | "nearest" | "highest-threat";
export function selectTarget(targets: readonly PerceivedTarget[], policy: TargetPolicy = "highest-score"): PerceivedTarget | undefined {
  let best: PerceivedTarget | undefined;
  for (const target of targets) {
    if (!best || compareTarget(target, best, policy) < 0) best = target;
  }
  return best;
}

/** Small orchestration primitive. Games supply sensors and decisions; the engine owns cadence and memory. */
export class AiController<TContext> {
  readonly blackboard = new Blackboard();
  readonly #sense: (context: TContext, blackboard: Blackboard) => void;
  readonly #decide: (context: TContext, blackboard: Blackboard, deltaSeconds: number) => void;
  readonly #interval: number;
  #elapsed = 0;
  #enabled = true;

  constructor(options: { readonly sense: (context: TContext, blackboard: Blackboard) => void; readonly decide: (context: TContext, blackboard: Blackboard, deltaSeconds: number) => void; readonly sensingInterval?: number }) {
    this.#interval = options.sensingInterval ?? 0.1;
    requirePositive(this.#interval, "AI sensing interval");
    this.#elapsed = this.#interval;
    this.#sense = options.sense;
    this.#decide = options.decide;
  }
  get enabled(): boolean { return this.#enabled; }
  set enabled(value: boolean) { this.#enabled = value; }
  update(context: TContext, deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("AI controller delta time must be finite and non-negative.");
    if (!this.#enabled) return;
    this.#elapsed += deltaSeconds;
    if (this.#elapsed >= this.#interval) { this.#elapsed %= this.#interval; this.#sense(context, this.blackboard); }
    this.#decide(context, this.blackboard, deltaSeconds);
  }
}

const ZERO: Vector3Like = Object.freeze({ x: 0, y: 0, z: 0 });
const FORWARD: Vector3Like = Object.freeze({ x: 0, y: 0, z: -1 });
function requirePositive(value: number, label: string): void { if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive.`); }
function requireId(value: string, label: string): void { if (value.trim() === "") throw new Error(`${label} ID cannot be empty.`); }
function normalize(value: Vector3Like, label: string): Vector3Like { const length = Math.hypot(value.x, value.y, value.z); if (!(length > 1e-8)) throw new Error(`${label} cannot be zero.`); return { x: value.x / length, y: value.y / length, z: value.z / length }; }
function compareTarget(a: PerceivedTarget, b: PerceivedTarget, policy: TargetPolicy): number {
  const primary = policy === "nearest" ? a.distance - b.distance : policy === "highest-threat" ? (b.threat ?? 0) - (a.threat ?? 0) : b.score - a.score;
  return primary || a.id.localeCompare(b.id);
}
