# Development

## Browser requirements

Use a current browser with WebGPU. Worker-backed simulation additionally needs
cross-origin isolation. The Vapour development server sends:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The editor reports missing WebGPU, secure-context, cross-origin isolation, and
WebXR capabilities separately so projects can choose appropriate degradation.

## Repository rules

- Source assets remain outside `.vapour/cache` and generated builds.
- Scene arrays are sorted by stable identifiers before writing.
- Runtime code must not silently swallow errors.
- Required features do not get placeholder UI. Panels appear when their
  backing service is available.
- Per-frame paths avoid allocations after warm-up where practical.

