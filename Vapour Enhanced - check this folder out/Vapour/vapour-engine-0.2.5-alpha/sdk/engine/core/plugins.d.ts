import type { Behaviour } from "../scripting/scripting.js";
export interface ComponentType<T = unknown> {
    readonly typeName: string;
    readonly version: number;
    readonly createDefault: () => T;
    readonly validate: (data: unknown) => data is T;
}
export interface AssetImporter {
    readonly id: string;
    readonly extensions: readonly string[];
    import(source: ArrayBuffer, settings: Readonly<Record<string, unknown>>): Promise<{
        data: ArrayBuffer;
        dependencies: readonly string[];
    }>;
}
export interface RuntimeSystem {
    readonly id: string;
    readonly order: number;
    update(deltaSeconds: number): void;
}
export interface BuildStep {
    readonly id: string;
    readonly order: number;
    run(context: {
        readonly projectRoot: string;
        readonly outputRoot: string;
    }): Promise<void>;
}
export interface EditorPanelRegistration {
    readonly id: string;
    readonly title: string;
    readonly mount: (container: HTMLElement) => () => void;
}
export interface VapourPlugin {
    readonly id: string;
    readonly version: string;
    readonly engineRange: string;
    register(context: PluginContext): void | Promise<void>;
    dispose?(): void | Promise<void>;
}
export interface PluginContext {
    registerComponent<T>(type: ComponentType<T>): void;
    registerImporter(importer: AssetImporter): void;
    registerSystem(system: RuntimeSystem): void;
    registerBuildStep(step: BuildStep): void;
    registerEditorPanel(panel: EditorPanelRegistration): void;
    registerBehaviour(name: string, constructor: new () => Behaviour): void;
}
export declare class PluginRegistry implements PluginContext {
    #private;
    readonly components: Map<string, ComponentType<unknown>>;
    readonly importers: Map<string, AssetImporter>;
    readonly systems: Map<string, RuntimeSystem>;
    readonly buildSteps: Map<string, BuildStep>;
    readonly editorPanels: Map<string, EditorPanelRegistration>;
    readonly behaviours: Map<string, new () => Behaviour>;
    load(plugin: VapourPlugin): Promise<void>;
    dispose(): Promise<void>;
    registerComponent<T>(type: ComponentType<T>): void;
    registerImporter(importer: AssetImporter): void;
    registerSystem(system: RuntimeSystem): void;
    registerBuildStep(step: BuildStep): void;
    registerEditorPanel(panel: EditorPanelRegistration): void;
    registerBehaviour(name: string, constructor: new () => Behaviour): void;
    orderedSystems(): readonly RuntimeSystem[];
    orderedBuildSteps(): readonly BuildStep[];
}
//# sourceMappingURL=plugins.d.ts.map