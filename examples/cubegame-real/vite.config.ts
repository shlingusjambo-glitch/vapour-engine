import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: true,
    strictPort: true,
  },
  worker: {
    format: 'iife',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('three')) {
            return 'vendor-three';
          }
          if (id.includes('src/tf2/')) {
            return 'tf2-game-mode';
          }
          if (id.includes('src/cob/') || id.includes('src/cbgo/')) {
            return 'cob-game-mode';
          }
        }
      }
    }
  },
});
