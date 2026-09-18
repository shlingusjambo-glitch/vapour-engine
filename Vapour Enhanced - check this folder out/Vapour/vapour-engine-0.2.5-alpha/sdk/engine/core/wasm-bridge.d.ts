import type { SceneData, TransformData } from "./scene-document.js";
export type RuntimeCommand = {
    readonly type: "spawn";
    readonly id: string;
    readonly transform: TransformData;
} | {
    readonly type: "despawn";
    readonly id: string;
} | {
    readonly type: "setTransform";
    readonly id: string;
    readonly transform: TransformData;
} | {
    readonly type: "setParent";
    readonly id: string;
    readonly parent: string | null;
};
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
export declare class WasmRuntimeBridge {
    #private;
    constructor(engine: WasmEngineInstance);
    enqueue(command: RuntimeCommand): void;
    loadScene(scene: Readonly<SceneData>): void;
    flush(): number;
    step(deltaSeconds: number): {
        readonly fixedSteps: number;
        readonly snapshot: RuntimeSnapshot;
    };
}
//# sourceMappingURL=wasm-bridge.d.ts.map