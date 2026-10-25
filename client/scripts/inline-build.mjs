// Produces dist/single.html with the JS and CSS inlined, for hosts that only
// take one file. The normal dist/ output is what gets deployed to a static site.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
let html = readFileSync(join(dist, 'index.html'), 'utf8');

html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/g, (_, file) => {
  const js = readFileSync(join(dist, file), 'utf8').replace(/<\/script/g, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/g, (_, file) => {
  return `<style>${readFileSync(join(dist, file), 'utf8')}</style>`;
});

writeFileSync(join(dist, 'single.html'), html);
console.log('wrote dist/single.html', Math.round(html.length / 1024), 'KB');
