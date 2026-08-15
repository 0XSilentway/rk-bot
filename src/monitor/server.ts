import { readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { WorldState } from '../state/world';
import { logBus, recentLogs, type LogLine } from './events';
import type { ServerWebSocket } from 'bun';

interface BrainControl {
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
}

const STATIC = join(import.meta.dir, 'static');
const CONFIG_DIR = join(import.meta.dir, '..', '..', 'control');
const ALLOWED_CONFIG_FILES = new Set(['config.txt', 'mon_control.txt', 'login.yaml']);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export function startMonitor(port: number, world: WorldState, brain: BrainControl) {
  const clients = new Set<ServerWebSocket<unknown>>();

  const unsub = logBus.on((ev) => {
    const msg = JSON.stringify({ t: 'log', ...ev });
    for (const c of clients) c.send(msg);
  });

  const snapshot = () => ({
    t: 'state',
    self: world.self,
    actors: [...world.actors.values()].slice(0, 200).map((a) => ({
      id: a.id, kind: a.kind, name: a.name, pos: a.pos, alive: a.alive,
    })),
    drops: [...world.drops.values()].map((d) => ({
      dropId: d.dropId, itemId: d.itemId, amount: d.amount, at: d.at, age: Date.now() - d.spawnedTs,
    })),
    counters: {
      kills: world.killsSession, loot: world.lootedSession, exp: world.expGainedSession,
    },
    paused: brain.isPaused(),
    lastHitBy: world.lastHitBy,
  });

  setInterval(() => {
    if (clients.size === 0) return;
    const msg = JSON.stringify(snapshot());
    for (const c of clients) c.send(msg);
  }, 1000);

  Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade for /events
      if (url.pathname === '/events') {
        if (server.upgrade(req)) return;
        return new Response('upgrade failed', { status: 400 });
      }

      // API: brain control
      if (url.pathname === '/api/pause' && req.method === 'POST') { brain.pause(); return json({ ok: true }); }
      if (url.pathname === '/api/resume' && req.method === 'POST') { brain.resume(); return json({ ok: true }); }
      if (url.pathname === '/api/state' && req.method === 'GET') return json(snapshot());
      if (url.pathname === '/api/logs' && req.method === 'GET') return json({ logs: recentLogs() });

      // Config read/write
      const m = url.pathname.match(/^\/api\/config\/([^/]+)$/);
      if (m) {
        const name = m[1]!;
        if (!ALLOWED_CONFIG_FILES.has(name)) return new Response('forbidden', { status: 403 });
        const path = join(CONFIG_DIR, name);
        if (req.method === 'GET') {
          try { return new Response(readFileSync(path, 'utf-8'), { headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
          catch (e) { return new Response(String(e), { status: 500 }); }
        }
        if (req.method === 'PUT') {
          const body = await req.text();
          try { writeFileSync(path, body); return json({ ok: true }); }
          catch (e) { return json({ ok: false, error: String(e) }, 500); }
        }
      }

      // Static files
      let file = url.pathname === '/' ? '/index.html' : url.pathname;
      const abs = join(STATIC, file);
      if (!abs.startsWith(STATIC)) return new Response('not found', { status: 404 });
      const f = Bun.file(abs);
      if (!(await f.exists())) return new Response('not found', { status: 404 });
      const ct = MIME[extname(file)] ?? 'application/octet-stream';
      return new Response(f, { headers: { 'content-type': ct } });
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ t: 'hello' }));
        ws.send(JSON.stringify(snapshot()));
        for (const ln of recentLogs()) ws.send(JSON.stringify({ t: 'log', ...ln }));
      },
      close(ws) { clients.delete(ws); },
      message() {},
    },
  });

  console.log(`[monitor] dashboard http://localhost:${port}/`);

  return { close: () => { unsub(); } };
}

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
}
