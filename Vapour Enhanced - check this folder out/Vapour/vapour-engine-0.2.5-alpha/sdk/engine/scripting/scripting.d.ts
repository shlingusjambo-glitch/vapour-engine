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
export declare class ScriptExecutionError extends Error {
    readonly entityId: string;
    readonly phase: string;
    readonly cause: unknown;
    constructor(entityId: string, phase: string, cause: unknown);
}
export declare abstract class Behaviour {
    #private;
    get context(): ScriptContext;
    /** @internal */
    attach(context: ScriptContext): void;
    initialize(): void;
    start(): void;
    update(_deltaSeconds: number): void;
    fixedUpdate(_fixedDeltaSeconds: number): void;
    lateUpdate(_deltaSeconds: number): void;
    destroy(): void;
    collisionEnter(_otherEntityId: string): void;
    collisionExit(_otherEntityId: string): void;
    triggerEnter(_otherEntityId: string): void;
    triggerExit(_otherEntityId: string): void;
}
export declare class ScriptScheduler {
    #private;
    add(behaviour: Behaviour, context: ScriptContext): void;
    /** Adds an ESM script module compiled from either VS or TypeScript. */
    addModule(module: GameplayScriptModule, context: ScriptContext): Behaviour;
    remove(behaviour: Behaviour): void;
    update(deltaSeconds: number): void;
    fixedUpdate(fixedDeltaSeconds: number): void;
    lateUpdate(deltaSeconds: number): void;
    collisionEnter(entityId: string, otherEntityId: string): void;
    collisionExit(entityId: string, otherEntityId: string): void;
    triggerEnter(entityId: string, otherEntityId: string): void;
    triggerExit(entityId: string, otherEntityId: string): void;
}
//# sourceMappingURL=scripting.d.ts.map