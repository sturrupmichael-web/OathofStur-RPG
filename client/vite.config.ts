import { defineConfig } from 'vite';

// Relative base so the build works from any static host or sub-path.
export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
