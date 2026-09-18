# CubeGame port guidance

This project is a forcing-function benchmark for Vapour Engine. Use only public
`@vapour/engine` APIs. When a required feature is missing, implement and test it
in the engine before using it here. Do not introduce Three.js, WebGL, sample-only
renderer hooks, or copies of unlicensed upstream source/assets.

Before handing work back, run:

```sh
pnpm vapour validate examples/cubegame-port --json
pnpm vapour build examples/cubegame-port --json
pnpm test
```
