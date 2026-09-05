import type { SceneData, TransformData } from "./scene-document.js";
import { defaultTransform } from "./scene-document.js";

export type RuntimeCommand =
  | { readonly type: "spawn"; readonly id: string; readonly transform: TransformData }
  | { readonly type: "despawn"; readonly id: string }
  | { readonly type: "setTransform"; readonly id: string; readonly transform: TransformData }
  | { readonly type: "setParent"; readonly id: string; readonly parent: string | null };

export interface WasmEngineInstance {
  apply_commands(json: string): void;
  tick(deltaSeconds: number): number;
  snapshot_json(): string;
}

export interface RuntimeSnapshot {
  readonly entityCount: number;
  readonly entities: readonly {
    readonly id: string;
    readonly transform: TransformData;
    readonly worldMatrix: readonly number[];
  }[];
}

/** Owns the coarse-grained TypeScript/WASM boundary. Callers enqueue many
 * mutations; one serialized array crosses into Rust per frame. */
export class WasmRuntimeBridge {
  readonly #engine: WasmEngineInstance;
  readonly #commands: RuntimeCommand[] = [];

  constructor(engine: WasmEngineInstance) {
    this.#engine = engine;
  }

  enqueue(command: RuntimeCommand): void {
    this.#commands.push(structuredClone(command));
  }

  loadScene(scene: Readonly<SceneData>): void {
    for (const entity of scene.entities) {
      const transform = entity.components.find((component) => component.typeName === "vapour.Transform")?.data;
      this.enqueue({ type: "spawn", id: entity.id, transform: isTransform(transform) ? transform : defaultTransform() });
    }
    for (const entity of scene.entities) {
      if (entity.parent !== undefined) this.enqueue({ type: "setParent", id: entity.id, parent: entity.parent });
    }
  }

  flush(): number {
    if (this.#commands.length === 0) return 0;
    const count = this.#commands.length;
    const batch = JSON.stringify(this.#commands);
    this.#commands.length = 0;
    try { this.#engine.apply_commands(batch); } catch (error) { throw new Error(`Rust runtime rejected a ${String(count)}-command batch: ${messageOf(error)}`, { cause: error }); }
    return count;
  }

  step(deltaSeconds: number): { readonly fixedSteps: number; readonly snapshot: RuntimeSnapshot } {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("Frame delta must be finite and non-negative.");
    this.flush();
    const fixedSteps = this.#engine.tick(deltaSeconds);
    let snapshot: RuntimeSnapshot;
    try { snapshot = JSON.parse(this.#engine.snapshot_json()) as RuntimeSnapshot; } catch (error) { throw new Error(`Rust runtime returned an invalid snapshot: ${messageOf(error)}`, { cause: error }); }
    if (!Number.isInteger(snapshot.entityCount) || !Array.isArray(snapshot.entities)) throw new Error("Rust runtime snapshot is missing entityCount or entities.");
    return { fixedSteps, snapshot };
  }
}

function isTransform(value: unknown): value is TransformData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TransformData>;
  return isNumbers(candidate.position, 3) && isNumbers(candidate.rotation, 4) && isNumbers(candidate.scale, 3);
}
function isNumbers(value: unknown, length: number): boolean { return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item)); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

