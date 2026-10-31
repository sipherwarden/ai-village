import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const hub = `http://127.0.0.1:${process.env.AI_VILLAGE_PORT ?? 7777}`;

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  plugins: [react(), tailwindcss()],
  // The 3D village (three.js + postprocessing) is one ~1.7 MB chunk by design; see STATUS.md.
  build: { outDir: 'dist', emptyOutDir: true, target: 'safari16', chunkSizeWarningLimit: 2000 },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': hub,
      '/mcp': hub,
      '/ws': { target: hub.replace('http', 'ws'), ws: true },
    },
  },
});
