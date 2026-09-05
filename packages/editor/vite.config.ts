import { defineConfig, type Plugin } from "vite";
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wasmRoot = fileURLToPath(new URL("../engine/wasm", import.meta.url));
const wasmFiles = new Map([
  ["/vapour_runtime.js", { file: "vapour_runtime.js", type: "text/javascript; charset=utf-8" }],
  ["/vapour_runtime_bg.wasm", { file: "vapour_runtime_bg.wasm", type: "application/wasm" }],
]);

const wasmAssetsPlugin: Plugin = {
  name: "vapour-wasm-assets",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const asset = wasmFiles.get((request.url ?? "").split("?", 1)[0] ?? "");
      if (asset === undefined) { next(); return; }
      try {
        response.setHeader("Content-Type", asset.type);
        response.setHeader("Cache-Control", "no-store");
        response.end(readFileSync(path.join(wasmRoot, asset.file)));
      } catch (error) {
        response.statusCode = 500;
        response.end(`Vapour WASM asset is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  },
  writeBundle(options) {
    const output = path.resolve(options.dir ?? "dist");
    for (const asset of wasmFiles.values()) copyFileSync(path.join(wasmRoot, asset.file), path.join(output, asset.file));
  },
};

export default defineConfig({
  publicDir: false,
  plugins: [wasmAssetsPlugin],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: { target: "es2023", sourcemap: true },
});
