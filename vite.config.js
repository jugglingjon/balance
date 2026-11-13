import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works under /balance/ on GitHub Pages.
  base: './',
  // three.js alone is larger than the default 500 kB warning threshold.
  build: { chunkSizeWarningLimit: 800 },
});
