import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { JsonMapSource, TICK_MS, WORLD_SEED, type JsonMapFile } from '@rpg/shared';
import vellReaches from '@rpg/shared/data/maps/vell-reaches.json';
import { WebSocketServer } from 'ws';
import { makeVerifier } from './auth';
import { GameHost } from './GameHost';
import { MemoryStore, SupabaseStore, type SaveStore } from './store';

/**
 * The Oath of Stur game server: runs the shared world on its 600 ms tick and
 * talks to browsers over a WebSocket at /ws. It also serves the built client
 * (client/dist), so the server's own address is a playable copy of the game.
 */
const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? 'client/dist');
/** Pages allowed to connect: the game's own site, this server, and local dev. */
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://michaelsturrup.com,https://www.michaelsturrup.com').split(',');
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://abeqdmurddrkrqbnfylb.supabase.co';
/** The project's secret key (a Fly secret): the only key that can read or write saves_oath_online. */
const SECRET = process.env.SUPABASE_SECRET_KEY;
/** Local testing only: any token "dev-<name>" signs in as that name. Never with real saves. */
const DEV_ACCOUNTS = process.env.DEV_ACCOUNTS === '1' && !SECRET;
const store: SaveStore = SECRET ? new SupabaseStore(SUPABASE_URL, SECRET) : new MemoryStore();

const map = new JsonMapSource('vell-reaches', vellReaches as unknown as JsonMapFile).load();
const host = new GameHost({
  map,
  seed: WORLD_SEED,
  verify: DEV_ACCOUNTS
    ? async (token) => (token.startsWith('dev-') ? { id: token, email: '' } : null)
    : makeVerifier({ url: SUPABASE_URL, key: process.env.SUPABASE_KEY ?? 'sb_publishable_8WUpbX-clRvdKgset72mkQ_C_NFL5E8' }),
  store,
  maxPlayers: Number(process.env.MAX_PLAYERS ?? 50),
});
setInterval(() => host.autosave(), 60_000);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.ico': 'image/x-icon',
};

const http = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: host.playerCount, tick: host.sim.tick }));
    return;
  }
  const file = normalize(join(STATIC_DIR, path.endsWith('/') ? path + 'index.html' : path));
  let size = -1;
  try {
    if (file.startsWith(STATIC_DIR)) size = statSync(file).isFile() ? statSync(file).size : -1;
  } catch {
    // not there
  }
  if (size < 0) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': size,
    // Built assets have hashed names; the page itself must always be fresh.
    'Cache-Control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    // Not a public page yet: keep it out of search results.
    'X-Robots-Tag': 'noindex',
  });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({
  server: http,
  path: '/ws',
  // A join carries the whole save; nothing else comes close.
  maxPayload: 512 * 1024,
  verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => !origin || ORIGINS.includes(origin) || LOCAL.test(origin) || origin === `https://${req.headers.host}`,
});

wss.on('connection', (ws) => {
  const client = host.open({ send: (text) => ws.readyState === ws.OPEN && ws.send(text), close: (code, reason) => ws.close(code, reason) });
  let alive = true;
  ws.on('pong', () => (alive = true));
  // Dead connections (a phone that lost signal) are noticed within a minute.
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);
  // A connection that never joins is dropped.
  const joinTimer = setTimeout(() => client.playerId === null && ws.close(4001, 'no join'), 15_000);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) void host.receive(client, data.toString());
  });
  ws.on('close', () => {
    clearInterval(ping);
    clearTimeout(joinTimer);
    host.close(client);
  });
  ws.on('error', () => ws.terminate());
});

setInterval(() => {
  try {
    host.step();
  } catch (err) {
    console.error('tick failed', err);
  }
}, TICK_MS);

http.listen(PORT, () => console.log(`Oath of Stur server on :${PORT}, serving ${STATIC_DIR}, characters in ${store.label}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  // Fly gives a stopping machine a few seconds: everyone is stored before it goes.
  process.on(signal, async () => {
    const stop = setTimeout(() => process.exit(1), 8000);
    await host.saveAll();
    for (const ws of wss.clients) ws.close(1012, 'restarting');
    clearTimeout(stop);
    setTimeout(() => process.exit(0), 300);
  });
}
