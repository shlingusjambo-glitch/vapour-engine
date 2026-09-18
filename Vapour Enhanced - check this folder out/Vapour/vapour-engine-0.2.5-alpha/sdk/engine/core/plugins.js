export class PluginRegistry {
    components = new Map();
    importers = new Map();
    systems = new Map();
    buildSteps = new Map();
    editorPanels = new Map();
    behaviours = new Map();
    #plugins = new Map();
    #registeringPlugin;
    async load(plugin) {
        validateKey(plugin.id, "plugin ID");
        if (this.#plugins.has(plugin.id))
            throw new Error(`Plugin '${plugin.id}' is already loaded.`);
        this.#registeringPlugin = plugin.id;
        try {
            await plugin.register(this);
            this.#plugins.set(plugin.id, plugin);
        }
        finally {
            this.#registeringPlugin = undefined;
        }
    }
    async dispose() {
        for (const plugin of [...this.#plugins.values()].reverse())
            await plugin.dispose?.();
        this.#plugins.clear();
    }
    registerComponent(type) { this.#register(this.components, type.typeName, type); }
    registerImporter(importer) { this.#register(this.importers, importer.id, importer); }
    registerSystem(system) { this.#register(this.systems, system.id, system); }
    registerBuildStep(step) { this.#register(this.buildSteps, step.id, step); }
    registerEditorPanel(panel) { this.#register(this.editorPanels, panel.id, panel); }
    registerBehaviour(name, constructor) { this.#register(this.behaviours, name, constructor); }
    orderedSystems() { return [...this.systems.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)); }
    orderedBuildSteps() { return [...this.buildSteps.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)); }
    #register(registry, key, value) {
        if (this.#registeringPlugin === undefined)
            throw new Error("Extensions may only be registered while a plugin is loading.");
        validateKey(key, "extension ID");
        if (registry.has(key))
            throw new Error(`Extension '${key}' is already registered.`);
        registry.set(key, value);
    }
}
function validateKey(value, label) {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/i.test(value))
        throw new Error(`${label} '${value}' must be a namespaced identifier.`);
}
//# sourceMappingURL=plugins.js.map