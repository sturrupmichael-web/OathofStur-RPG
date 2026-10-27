import { defineConfig } from 'vite';

// Relative base so the build works from any static host or sub-path.
export default defineConfig({
  base: './',
  // AI-made creature models (src/render/models), imported with ?inline so the one-file build carries them.
  assetsInclude: ['**/*.glb'],
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
