# XR playground

A Mirage showcase. It drives the XR systems from synthetic headset frames —
the same `XrFrameSnapshot` a live WebXR session produces — so the composition
is proven headlessly, and the file doubles as the reference for wiring a
session. Every part is public engine API.

```sh
pnpm --filter @vapour/example-xr-playground run
```

```
XR playground — composed from Mirage systems

  head         1.60 m, ipd 64 mm
  grab         crate carried to (0.50, 1.30, -0.50)
  hand poses   left open
  ui           1 click(s) by pinch on the world-space panel
  locomotion   moved to (0.00, 0.00, -1.00), yaw -45°
  haptics      2 pulse(s) played
  frames       71 at 0.037 ms mean
  wall clock   4 ms
```

## What it exercises together

| System | Used for |
| ------ | -------- |
| [XR rig](../../docs/xr.md) | Floor-aware reference space, per-eye cameras, IPD |
| [XR input](../../docs/input.md) | Squeeze, thumbsticks, and a `Move` composite bound through the action map |
| [Hand poses](../../docs/xr.md) | Pinch and open recognised from 25 tracked joints with hysteresis |
| [Grabbing](../../docs/xr.md) | A direct grab on squeeze, the crate following the hand, release on let-go |
| [Locomotion](../../docs/xr-locomotion.md) | Stick movement relative to the head and a snap turn with its comfort fade |
| [World-space UI](../../docs/ui.md) | An upright-billboarded panel clicked by pinching while pointing at it |
| [Haptics](../../docs/xr.md) | Queued pulses on grab and on UI click, merged per hand and flushed per frame |
| [XR debugging](../../docs/xr.md) | Frame counters recorded into diagnostics |

Running this on a headset means replacing the synthetic frames with
`XrSessionManager.startFrameLoop`'s callback; nothing else changes.
