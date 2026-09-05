import type { InputSystem } from "../input/input.js";
import type { SceneDocument } from "../core/scene-document.js";

export interface ScriptContext {
  readonly scene: SceneDocument;
  readonly input: InputSystem;
  readonly entityId: string;
}

export interface GameplayScriptModule {
  readonly initialize?: (context: ScriptContext) => void;
  readonly start?: (context: ScriptContext) => void;
  readonly update?: (context: ScriptContext, deltaSeconds: number) => void;
  readonly fixedUpdate?: (context: ScriptContext, fixedDeltaSeconds: number) => void;
  readonly lateUpdate?: (context: ScriptContext, deltaSeconds: number) => void;
  readonly destroy?: (context: ScriptContext) => void;
  readonly collisionEnter?: (context: ScriptContext, otherEntityId: string) => void;
  readonly collisionExit?: (context: ScriptContext, otherEntityId: string) => void;
  readonly triggerEnter?: (context: ScriptContext, otherEntityId: string) => void;
  readonly triggerExit?: (context: ScriptContext, otherEntityId: string) => void;
}

export class ScriptExecutionError extends Error {
  readonly entityId: string;
  readonly phase: string;
  readonly cause: unknown;
  constructor(entityId: string, phase: string, cause: unknown) {
    super(`Script on entity '${entityId}' failed during ${phase}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ScriptExecutionError"; this.entityId = entityId; this.phase = phase; this.cause = cause;
  }
}

export abstract class Behaviour {
  #context: ScriptContext | undefined;

  get context(): ScriptContext {
    if (this.#context === undefined) throw new Error("Behaviour is not attached to a runtime.");
    return this.#context;
  }

  /** @internal */
  attach(context: ScriptContext): void {
    if (this.#context !== undefined) throw new Error("Behaviour is already attached.");
    this.#context = context;
    this.initialize();
  }

  initialize(): void {}
  start(): void {}
  update(_deltaSeconds: number): void {}
  fixedUpdate(_fixedDeltaSeconds: number): void {}
  lateUpdate(_deltaSeconds: number): void {}
  destroy(): void {}
  collisionEnter(_otherEntityId: string): void {}
  collisionExit(_otherEntityId: string): void {}
  triggerEnter(_otherEntityId: string): void {}
  triggerExit(_otherEntityId: string): void {}
}

interface ScriptEntry {
  readonly behaviour: Behaviour;
  readonly context: ScriptContext;
  started: boolean;
}

export class ScriptScheduler {
  readonly #scripts: ScriptEntry[] = [];
  readonly #pendingRemoval = new Set<Behaviour>();

  add(behaviour: Behaviour, context: ScriptContext): void {
    invoke(context, "initialize", () => behaviour.attach(context));
    this.#scripts.push({ behaviour, context, started: false });
  }

  /** Adds an ESM script module compiled from either VS or TypeScript. */
  addModule(module: GameplayScriptModule, context: ScriptContext): Behaviour {
    const behaviour = new ModuleBehaviour(module);
    this.add(behaviour, context);
    return behaviour;
  }

  remove(behaviour: Behaviour): void {
    this.#pendingRemoval.add(behaviour);
  }

  update(deltaSeconds: number): void {
    this.#flushRemovals();
    for (const entry of this.#scripts) {
      if (!entry.started) {
        entry.started = true;
        invoke(entry.context, "start", () => entry.behaviour.start());
      }
      invoke(entry.context, "update", () => entry.behaviour.update(deltaSeconds));
    }
  }

  fixedUpdate(fixedDeltaSeconds: number): void {
    for (const entry of this.#scripts) invoke(entry.context, "fixedUpdate", () => entry.behaviour.fixedUpdate(fixedDeltaSeconds));
  }

  lateUpdate(deltaSeconds: number): void {
    for (const entry of this.#scripts) invoke(entry.context, "lateUpdate", () => entry.behaviour.lateUpdate(deltaSeconds));
  }

  collisionEnter(entityId: string, otherEntityId: string): void { this.#dispatch(entityId, "collisionEnter", (script) => script.collisionEnter(otherEntityId)); }
  collisionExit(entityId: string, otherEntityId: string): void { this.#dispatch(entityId, "collisionExit", (script) => script.collisionExit(otherEntityId)); }
  triggerEnter(entityId: string, otherEntityId: string): void { this.#dispatch(entityId, "triggerEnter", (script) => script.triggerEnter(otherEntityId)); }
  triggerExit(entityId: string, otherEntityId: string): void { this.#dispatch(entityId, "triggerExit", (script) => script.triggerExit(otherEntityId)); }

  #dispatch(entityId: string, phase: string, callback: (script: Behaviour) => void): void {
    let found = false;
    for (const entry of this.#scripts) if (entry.context.entityId === entityId && !this.#pendingRemoval.has(entry.behaviour)) { found = true; invoke(entry.context, phase, () => callback(entry.behaviour)); }
    if (!found) throw new Error(`Cannot dispatch ${phase}: entity '${entityId}' has no active scripts.`);
  }

  #flushRemovals(): void {
    if (this.#pendingRemoval.size === 0) return;
    for (let index = this.#scripts.length - 1; index >= 0; index -= 1) {
      const entry = this.#scripts[index];
      if (entry !== undefined && this.#pendingRemoval.has(entry.behaviour)) {
        invoke(entry.context, "destroy", () => entry.behaviour.destroy());
        this.#scripts.splice(index, 1);
      }
    }
    this.#pendingRemoval.clear();
  }
}

class ModuleBehaviour extends Behaviour {
  readonly #module: GameplayScriptModule;
  constructor(module: GameplayScriptModule) { super(); this.#module = module; }
  override initialize(): void { this.#module.initialize?.(this.context); }
  override start(): void { this.#module.start?.(this.context); }
  override update(delta: number): void { this.#module.update?.(this.context, delta); }
  override fixedUpdate(delta: number): void { this.#module.fixedUpdate?.(this.context, delta); }
  override lateUpdate(delta: number): void { this.#module.lateUpdate?.(this.context, delta); }
  override destroy(): void { this.#module.destroy?.(this.context); }
  override collisionEnter(other: string): void { this.#module.collisionEnter?.(this.context, other); }
  override collisionExit(other: string): void { this.#module.collisionExit?.(this.context, other); }
  override triggerEnter(other: string): void { this.#module.triggerEnter?.(this.context, other); }
  override triggerExit(other: string): void { this.#module.triggerExit?.(this.context, other); }
}

function invoke(context: ScriptContext, phase: string, callback: () => void): void {
  try { callback(); } catch (error) { if (error instanceof ScriptExecutionError) throw error; throw new ScriptExecutionError(context.entityId, phase, error); }
}
