import { openRawLog, type RawLog } from '../persist/raw-log';
import { decodeAll } from '../packet/decode';
import { applyEvent } from '../state/apply';
import { WorldState } from '../state/world';
import { startDashboard } from '../state/dashboard';
import { startBrain, pauseBrain, resumeBrain } from '../bot/brain';
import type { ServerWebSocket } from 'bun';

type FrameKind = 'text' | 'binary' | 'blob-pending' | 'unknown';

interface WireMessage {
  t: 'hello' | 'ws-open' | 'ws-send' | 'ws-recv' | 'ws-close';
  id?: number;
  url?: string;
  code?: number;
  reason?: string;
  ts: number;
  kind?: FrameKind;
  data?: string;
  size?: number;
  type?: string;
  ua?: string;
  href?: string;
}

interface InjectorSocket extends ServerWebSocket<unknown> {}

interface RelayOpts {
  port: number;
}

export function startRelay(opts: RelayOpts) {
  const log = openRawLog();
  const world = new WorldState();
  let seq = 0;
  let injector: InjectorSocket | undefined;
  let activeWsId: number | undefined;

  const send = (bytes: Uint8Array) => {
    if (!injector || !activeWsId) {
      console.warn('[relay] send skipped: no injector or ws not open');
      return;
    }
    const b64 = Buffer.from(bytes).toString('base64');
    injector.send(JSON.stringify({ t: 'inject', wsId: activeWsId, data: b64 }));
  };

  startDashboard(world);
  const brain = startBrain(world, send);

  Bun.serve({
    port: opts.port,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response('rk-bot relay', { status: 200 });
    },
    websocket: {
      open(ws) {
        injector = ws as InjectorSocket;
        console.log('[relay] injector connected');
        ws.send(JSON.stringify({ t: 'welcome', phase: 3 }));
      },
      close(ws) {
        if (injector === ws) injector = undefined;
        console.log('[relay] injector disconnected');
      },
      message(ws, raw) {
        let msg: WireMessage;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          console.warn('[relay] bad json');
          return;
        }
        seq++;
        handle(log, world, seq, msg, (id) => {
          activeWsId = id;
        });
      },
    },
  });

  // simple CLI over stdin — type "pause" / "resume" / "stat"
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (buf) => {
    const line = buf.toString().trim().toLowerCase();
    if (line === 'pause') pauseBrain(brain);
    else if (line === 'resume') resumeBrain(brain);
    else if (line === 'stat') dumpStat(world);
  });
  console.log('[relay] cli: type "pause", "resume", "stat"');
}

function dumpStat(world: WorldState) {
  console.log('[stat]', {
    self: world.self,
    actors: world.actors.size,
    drops: world.drops.size,
    kills: world.killsSession,
    loot: world.lootedSession,
    exp: world.expGainedSession,
  });
}

function handle(
  log: RawLog,
  world: WorldState,
  seq: number,
  msg: WireMessage,
  setActiveWs: (id: number) => void,
): void {
  switch (msg.t) {
    case 'hello':
      log.event(seq, msg.ts, 'hello', JSON.stringify({ ua: msg.ua, href: msg.href }));
      console.log(`[relay] hello from ${msg.href}`);
      return;
    case 'ws-open':
      console.log(`[relay] ws#${msg.id} open ${msg.url}`);
      log.event(seq, msg.ts, 'open', JSON.stringify({ id: msg.id, url: msg.url }));
      if (typeof msg.id === 'number') setActiveWs(msg.id);
      return;
    case 'ws-close':
      console.log(`[relay] ws#${msg.id} close code=${msg.code}`);
      log.event(seq, msg.ts, 'close', JSON.stringify({ id: msg.id, code: msg.code, reason: msg.reason }));
      return;
    case 'ws-send':
    case 'ws-recv': {
      const dir = msg.t === 'ws-send' ? 'send' : 'recv';
      const kind = msg.kind ?? 'unknown';
      let bytes: Uint8Array | null = null;
      let text: string | null = null;
      if (kind === 'binary' && msg.data) bytes = base64ToBytes(msg.data);
      else if (kind === 'text' && msg.data) text = msg.data;
      log.frame(seq, msg.ts, msg.id ?? 0, dir, kind, bytes, text);
      if (dir === 'recv' && bytes) {
        if (typeof msg.id === 'number') setActiveWs(msg.id);
        try {
          for (const ev of decodeAll(bytes, msg.ts)) applyEvent(world, ev);
        } catch (e) {
          console.warn('[relay] decode error', e);
        }
      }
      return;
    }
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
