import { defineConfig, type Plugin } from "vite";
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wasmRoot = fileURLToPath(new URL("../../packages/engine/wasm", import.meta.url));
const wasmFiles = ["vapour_runtime.js", "vapour_runtime_bg.wasm"];
const vapourRuntime: Plugin = {
  name: "vapour-runtime",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const file = wasmFiles.find(candidate => request.url?.split("?", 1)[0] === `/${candidate}`);
      if (!file) { next(); return; }
      response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8");
      response.end(readFileSync(path.join(wasmRoot, file)));
    });
  },
  writeBundle(options) {
    const output = path.resolve(options.dir ?? "dist");
    for (const file of wasmFiles) copyFileSync(path.join(wasmRoot, file), path.join(output, file));
  }
};

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [vapourRuntime],
  build: { target: "es2023", sourcemap: true },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  }
});
