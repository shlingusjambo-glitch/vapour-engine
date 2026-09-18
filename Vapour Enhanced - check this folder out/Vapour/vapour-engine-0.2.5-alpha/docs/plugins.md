# Plugins

Plugins implement `VapourPlugin` from `@vapour/engine`. Registration is scoped
to the plugin's `register` call, preventing unrelated runtime code from
silently mutating global registries.

```ts
import type { VapourPlugin } from "@vapour/engine";

export const plugin: VapourPlugin = {
  id: "studio.example",
  version: "1.0.0",
  engineRange: "^0.2.0-alpha",
  register(vapour) {
    vapour.registerSystem({
      id: "studio.example.motion",
      order: 100,
      update(deltaSeconds) {
        // Update plugin-owned state.
      },
    });
  },
};
```

The registry accepts component schemas, asset importers, ordered runtime
systems, build steps, editor panels, and gameplay behaviours. Identifiers must
be namespaced. Duplicate registrations fail loudly. Plugins are disposed in
reverse load order.

