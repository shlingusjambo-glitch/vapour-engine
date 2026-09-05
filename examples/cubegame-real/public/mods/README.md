# Built Client Mods

Put runtime mods for packaged/web-hosted clients in this folder.

The Node server exposes both this built-client folder (`dist/mods` after `npm run build`) and the workspace `mods` folder through `/api/mods`. Mods may provide an `index.js`, `mod.js`, or TypeScript entrypoint during development.

