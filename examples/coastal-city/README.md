# Port Solace vertical slice

Mariner's Reach is an original coastal-city runtime forcing function for Vapour Engine. It uses the engine's WebGPU renderer, glTF resource pipeline, Rapier physics, action input, spatial audio, fixed-step simulation and distance-based cell activation. Blender is used only to author/export the original CC0 art kit.

```sh
pnpm build:wasm
pnpm --filter @vapour/coastal-city dev
```

Controls: WASD, Shift, E to enter/exit the sedan, mouse to orbit, and N to cycle daylight. The runtime reports frame/draw/triangle counts. Assets and licensed field recordings have provenance under `public/assets`.

This is a development vertical slice, not a completed AAA game. GPU skinning, final humanoid art/animation, full traffic crowds, weapons, missions, and enough licensed audio categories remain production gates. The included art should be judged as a reusable authored kit and systems integration proof rather than a claim of final fidelity.
