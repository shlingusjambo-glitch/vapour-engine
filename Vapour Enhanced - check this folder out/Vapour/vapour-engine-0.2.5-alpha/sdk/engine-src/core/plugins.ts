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
  import(source: ArrayBuffer, settings: Readonly<Record<string, unknown>>): Promise<{ data: ArrayBuffer; dependencies: readonly string[] }>;
}

export interface RuntimeSystem {
  readonly id: string;
  readonly order: number;
  update(deltaSeconds: number): void;
}

export interface BuildStep {
  readonly id: string;
  readonly order: number;
  run(context: { readonly projectRoot: string; readonly outputRoot: string }): Promise<void>;
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

export class PluginRegistry implements PluginContext {
  readonly components = new Map<string, ComponentType>();
  readonly importers = new Map<string, AssetImporter>();
  readonly systems = new Map<string, RuntimeSystem>();
  readonly buildSteps = new Map<string, BuildStep>();
  readonly editorPanels = new Map<string, EditorPanelRegistration>();
  readonly behaviours = new Map<string, new () => Behaviour>();
  readonly #plugins = new Map<string, VapourPlugin>();
  #registeringPlugin: string | undefined;

  async load(plugin: VapourPlugin): Promise<void> {
    validateKey(plugin.id, "plugin ID");
    if (this.#plugins.has(plugin.id)) throw new Error(`Plugin '${plugin.id}' is already loaded.`);
    this.#registeringPlugin = plugin.id;
    try {
      await plugin.register(this);
      this.#plugins.set(plugin.id, plugin);
    } finally {
      this.#registeringPlugin = undefined;
    }
  }

  async dispose(): Promise<void> {
    for (const plugin of [...this.#plugins.values()].reverse()) await plugin.dispose?.();
    this.#plugins.clear();
  }

  registerComponent<T>(type: ComponentType<T>): void { this.#register(this.components, type.typeName, type); }
  registerImporter(importer: AssetImporter): void { this.#register(this.importers, importer.id, importer); }
  registerSystem(system: RuntimeSystem): void { this.#register(this.systems, system.id, system); }
  registerBuildStep(step: BuildStep): void { this.#register(this.buildSteps, step.id, step); }
  registerEditorPanel(panel: EditorPanelRegistration): void { this.#register(this.editorPanels, panel.id, panel); }
  registerBehaviour(name: string, constructor: new () => Behaviour): void { this.#register(this.behaviours, name, constructor); }

  orderedSystems(): readonly RuntimeSystem[] { return [...this.systems.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)); }
  orderedBuildSteps(): readonly BuildStep[] { return [...this.buildSteps.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)); }

  #register<T>(registry: Map<string, T>, key: string, value: T): void {
    if (this.#registeringPlugin === undefined) throw new Error("Extensions may only be registered while a plugin is loading.");
    validateKey(key, "extension ID");
    if (registry.has(key)) throw new Error(`Extension '${key}' is already registered.`);
    registry.set(key, value);
  }
}

function validateKey(value: string, label: string): void {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/i.test(value)) throw new Error(`${label} '${value}' must be a namespaced identifier.`);
}

