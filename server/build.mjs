// Bundles the server, shared code and ws into one file, so the runtime image needs no node_modules.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/main.js',
  // ws's optional native speed-ups; it runs without them.
  external: ['bufferutil', 'utf-8-validate'],
  // ws is CommonJS and requires Node built-ins, which an ES module bundle needs a require for.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
