import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: "../../packages/engine/wasm",
  build: { target: "es2022", sourcemap: true },
  server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
});
