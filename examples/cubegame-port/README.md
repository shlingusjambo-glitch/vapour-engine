# CubeGame → Vapour port

This is the executable porting project used to force Vapour Engine against a
real voxel-survival workload. It targets
[`KiwiOnGit/CubeGame`](https://github.com/KiwiOnGit/CubeGame) at commit
`125b70ef6a48e84678e46ef583986429daa4be93`.

The upstream repository does not currently include a software licence, so this
project does **not** copy its source code or assets. It is a clean Vapour-native
port of the first gameplay slice and a continuously expanding compatibility
benchmark. Every implemented feature uses public `@vapour/engine` APIs.

## Playable now

- deterministic 7×7 streaming-ready voxel chunk field;
- runtime-generated, vertex-coloured chunk geometry uploaded through WASM;
- binary per-frame submission with one draw per chunk mesh;
- first-person pointer-lock camera and keyboard/gamepad movement;
- fixed-step gravity and swept voxel AABB collision;
- block selection through DDA raycasting;
- primary-button breaking and secondary-button placement;
- deployable static browser build from the normal Vapour CLI.

Click the viewport to capture the pointer. Use WASD to move, Space to jump,
left click to break, and right click to place.

```sh
pnpm vapour validate examples/cubegame-port --json
pnpm vapour build examples/cubegame-port --json
pnpm vapour dev examples/cubegame-port --port 4174
```

## Next port gates

The next slices are worker-backed terrain generation and radius streaming,
texture-atlas materials with cutout/transparent layers, fog/sky, inventory and
save APIs, audio buses, particles, and the upstream WebSocket protocol. See
[`docs/cubegame-port.md`](../../docs/cubegame-port.md) for the audited map.
